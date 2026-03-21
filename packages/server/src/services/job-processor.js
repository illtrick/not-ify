'use strict';

const fs = require('fs');
const path = require('path');
const rd = require('./realdebrid');
const downloader = require('./downloader');
const fileValidator = require('./file-validator');
const downloadValidator = require('./download-validator');
const activityLog = require('./activity-log');

// Read lazily so that tests can set process.env.MUSIC_DIR before each test case.
// In production this is effectively read-once on first job, which is fine.
function getMusicDir() {
  return (process.env && process.env.MUSIC_DIR) || '/app/music';
}
function getStagingDir() {
  return path.join(getMusicDir(), '_staging');
}
const RD_FILE_SELECTION_TIMEOUT = 2 * 60 * 1000;  // 2 minutes
const RD_DOWNLOAD_TIMEOUT = 5 * 60 * 1000;         // 5 minutes
const POLL_INTERVAL = 2000;                         // 2 seconds

function log(category, level, message) {
  activityLog.log(category, level, message);
}

/**
 * Poll RD until torrent reaches target status.
 * Returns the torrent info object.
 */
async function pollRd(torrentId, targetStatus, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await rd.getTorrentInfo(torrentId);
    if (info.status === targetStatus) return info;
    if (info.status === 'magnet_error' || info.status === 'error' || info.status === 'virus' || info.status === 'dead') {
      throw new Error(`RD torrent failed with status: ${info.status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`RD timeout waiting for ${targetStatus} (${timeoutMs}ms)`);
}

/**
 * Process a download job: magnet → RD → download → validate → replace.
 */
async function processDownload(job, payload) {
  const { magnetLink, artist, album, mbid, rgid, isDiscography, upgradeFrom } = payload;
  const stagingDir = path.join(getStagingDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
  let torrentId = null;

  try {
    // Step 1: Check concurrency with manual pipeline downloads
    const pipeline = require('../api/pipeline');
    if (pipeline.isDownloadActive()) {
      throw new Error('REQUEUE: manual download active');
    }

    // Step 2: Add magnet
    log('pipeline', 'info', `[job ${job.id}] Adding magnet for ${artist} - ${album}`);
    const magnet = await rd.addMagnet(magnetLink);
    torrentId = magnet.id;

    // Step 3: Wait for file selection, get file list
    log('pipeline', 'info', `[job ${job.id}] Waiting for RD file selection...`);
    const fileInfo = await pollRd(torrentId, 'waiting_files_selection', RD_FILE_SELECTION_TIMEOUT);

    // Step 4: Select files (discography-aware)
    const selection = downloader.selectAlbumFiles(fileInfo.files || [], artist, album);
    if (selection.noMatch) {
      throw new Error(`No matching album folder found in torrent for "${album}"`);
    }
    const fileIdStr = selection.fileIds.join(',');
    if (!fileIdStr) {
      throw new Error('No audio files found in torrent');
    }
    await rd.selectFiles(torrentId, fileIdStr);
    log('pipeline', 'info', `[job ${job.id}] Selected ${selection.fileIds.length} files${selection.isDiscography ? ' (from discography)' : ''}`);

    // Step 5: Wait for RD to cache
    log('pipeline', 'info', `[job ${job.id}] Waiting for RD download...`);
    const cached = await pollRd(torrentId, 'downloaded', RD_DOWNLOAD_TIMEOUT);

    // Step 6: Unrestrict + download to staging
    fs.mkdirSync(stagingDir, { recursive: true });
    const downloadedFiles = [];
    const links = cached.links || [];

    for (const link of links) {
      const unrestricted = await rd.unrestrictLink(link);
      if (!downloader.isAudioFile(unrestricted.filename) && !downloader.isArchive(unrestricted.filename)) {
        continue; // skip non-audio, non-archive
      }
      const destPath = path.join(stagingDir, downloader.sanitizePath(unrestricted.filename));
      log('pipeline', 'info', `[job ${job.id}] Downloading: ${unrestricted.filename}`);
      await downloader.downloadFile(unrestricted.download, destPath);

      // Step 7: Extract archives
      if (downloader.isArchive(unrestricted.filename)) {
        const extracted = await downloader.extractArchive(destPath, stagingDir);
        downloadedFiles.push(...extracted);
      } else {
        downloadedFiles.push(destPath);
      }
    }

    if (downloadedFiles.length === 0) {
      throw new Error('No audio files downloaded');
    }

    // Step 8: File validation (MIME + ffprobe + ClamAV)
    for (const filePath of downloadedFiles) {
      const validation = await fileValidator.validateFile(filePath);
      if (!validation.passed) {
        const failedChecks = validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
        throw new Error(`File validation failed for ${path.basename(filePath)}: ${failedChecks}`);
      }
    }
    log('pipeline', 'info', `[job ${job.id}] All ${downloadedFiles.length} files passed validation`);

    // Step 9: Download validation (MusicBrainz track matching)
    const existingDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    let existingTrackCount;
    try {
      if (fs.existsSync(existingDir)) {
        existingTrackCount = fs.readdirSync(existingDir).filter(f => downloader.isAudioFile(f)).length;
      }
    } catch { /* no existing files */ }

    const validation = await downloadValidator.validate({
      files: downloadedFiles,
      mbid,
      rgid,
      artist,
      album,
      existingTrackCount,
    });

    log('pipeline', 'info', `[job ${job.id}] Validation: ${validation.confidence} confidence (score ${validation.score}) — ${validation.details}`);

    // Step 10: Replace or reject
    if (validation.confidence === 'low') {
      throw new Error(`Download validation failed (score ${validation.score}): ${validation.details}`);
    }

    // Move files from staging to library
    const destDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    for (const filePath of downloadedFiles) {
      const destPath = path.join(destDir, path.basename(filePath));
      fs.renameSync(filePath, destPath);
    }

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${downloadedFiles.length} files replaced (${validation.confidence} confidence, ${upgradeFrom ? upgradeFrom + ' → ' : ''}upgraded)`);

    return {
      success: true,
      artist,
      album,
      files: downloadedFiles.length,
      confidence: validation.confidence,
      score: validation.score,
    };
  } finally {
    // Step 11: Cleanup staging
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    // Step 12: Cleanup RD torrent
    if (torrentId) {
      try { await rd.deleteTorrent(torrentId); } catch {}
    }
  }
}

/**
 * Process an upgrade job: search for a better quality source, then enqueue a download job.
 */
async function processUpgrade(job, payload) {
  const { artist, album } = payload;
  log('pipeline', 'info', `[job ${job.id}] Searching for upgrade: ${artist} - ${album}`);

  const { searchForUpgrade } = require('./search');
  const result = await searchForUpgrade({ artist, album, targetQuality: 'flac' });

  if (!result) {
    log('pipeline', 'info', `[job ${job.id}] No upgrade found for ${artist} - ${album}`);
    return { skipped: true, reason: 'no upgrade source found' };
  }

  log('pipeline', 'info', `[job ${job.id}] Found upgrade: ${result.name} (score ${result.score?.toFixed(3)}, ${result.seeders} seeders)`);

  // Enqueue a download job with the found magnet
  const jobQueue = require('./job-queue');
  const dedupeKey = `download:${artist}|${album}`;
  const downloadJobId = jobQueue.enqueue(
    'download',
    {
      magnetLink: result.magnetLink,
      artist,
      album,
      isDiscography: result.isDiscography || false,
      source_meta: { quality: 'flac', name: result.name, seeders: result.seeders, score: result.score },
    },
    { dedupeKey, priority: 5 }
  );

  log('pipeline', 'info', `[job ${job.id}] Enqueued download job ${downloadJobId} for ${artist} - ${album}`);
  return { success: true, downloadJobId, source: result.name, score: result.score };
}

/**
 * Main job processor — dispatches by job type.
 * Registered with job-worker via setProcessor().
 */
async function process(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

  switch (job.type) {
    case 'download':
      return processDownload(job, payload);

    case 'upgrade':
      return processUpgrade(job, payload);

    default:
      log('pipeline', 'warn', `[job ${job.id}] Unknown job type: ${job.type}`);
      return { skipped: true, reason: `unknown type: ${job.type}` };
  }
}

module.exports = { process };
