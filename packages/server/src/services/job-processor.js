'use strict';

const fs = require('fs');
const path = require('path');
const rd = require('./realdebrid');
const downloader = require('./downloader');
const fileValidator = require('./file-validator');
const downloadValidator = require('./download-validator');
const activityLog = require('./activity-log');
const { enqueueDownload, pollDownloads } = require('./soulseek');

// Read lazily so tests can set process.env before each test case
// Use globalThis.process to avoid shadowing by the module's own process() function
const _env = () => globalThis.process.env;
function getSlskdDownloadsDir() {
  return _env().SLSKD_DOWNLOADS_DIR || '/app/slskd-downloads';
}
function getSlskDownloadTimeout() {
  return parseInt(_env().SLSK_DOWNLOAD_TIMEOUT || '1800000', 10); // 30 minutes
}
function getSlskPollInterval() {
  return parseInt(_env().SLSK_POLL_INTERVAL || '5000', 10); // 5 seconds
}

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

  const jobQueue = require('./job-queue');

  // Route Soulseek results to soulseek-download job type
  if (result.source === 'soulseek') {
    const downloadJobId = jobQueue.enqueue(
      'soulseek-download',
      {
        soulseekUser: result.soulseekUser,
        files: result.files,
        artist, album,
        mbid: payload.mbid,
        rgid: payload.rgid,
        source_meta: { source: 'soulseek', name: result.name, score: result.score },
      },
      { dedupeKey: `slsk-dl:${artist}|${album}`, priority: 5 }
    );
    log('pipeline', 'info', `[job ${job.id}] Enqueued soulseek-download job ${downloadJobId}`);
    return { success: true, downloadJobId, source: result.name, score: result.score };
  }

  // Enqueue a torrent download job with the found magnet
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
 * Process a Soulseek download job:
 * enqueue on slskd → poll until complete → copy from shared volume → validate → library
 */
async function processSoulseekDownload(job, payload) {
  const { soulseekUser, files, artist, album, mbid, rgid } = payload;
  const stagingDir = path.join(getStagingDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));

  try {
    // Step 1: Enqueue download on slskd
    log('pipeline', 'info', `[job ${job.id}] Enqueuing ${files.length} files from Soulseek user ${soulseekUser}`);
    const enqueued = await enqueueDownload(soulseekUser, files);
    if (!enqueued) {
      throw new Error(`Failed to enqueue download from ${soulseekUser}`);
    }

    // Step 2: Poll until all files complete or timeout
    const deadline = Date.now() + getSlskDownloadTimeout();
    let allComplete = false;

    const getBasename = (f) => f.split(/[\\/]/).pop();

    while (Date.now() < deadline && !allComplete) {
      await new Promise(r => setTimeout(r, getSlskPollInterval()));
      const transfers = await pollDownloads(soulseekUser);

      const fileStates = new Map();
      for (const t of transfers) {
        for (const dir of (t.directories || [])) {
          for (const f of (dir.files || [])) {
            fileStates.set(getBasename(f.filename), f.state || '');
          }
        }
      }

      const completed = files.filter(f => {
        const state = fileStates.get(getBasename(f.filename)) || '';
        return state.includes('Succeeded');
      });

      const failed = files.filter(f => {
        const state = fileStates.get(getBasename(f.filename)) || '';
        return state.includes('Errored') || state.includes('Cancelled');
      });

      if (failed.length > 0) {
        throw new Error(`${failed.length} files failed to download from ${soulseekUser}`);
      }

      allComplete = completed.length >= files.length;
      if (!allComplete) {
        log('pipeline', 'info', `[job ${job.id}] Soulseek download progress: ${completed.length}/${files.length}`);
      }
    }

    if (!allComplete) {
      throw new Error(`Soulseek download timed out after ${getSlskDownloadTimeout() / 1000}s`);
    }

    // Step 3: Copy files from shared volume to staging
    fs.mkdirSync(stagingDir, { recursive: true });
    const downloadedFiles = [];

    const userDir = path.join(getSlskdDownloadsDir(), soulseekUser);
    if (!fs.existsSync(userDir)) {
      throw new Error(`Soulseek downloads directory not found: ${userDir}`);
    }

    // Walk the user's download directory for audio files
    const walkDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (downloader.isAudioFile(entry.name)) {
          const safeName = path.basename(entry.name);
          const destPath = path.join(stagingDir, downloader.sanitizePath(safeName));
          fs.copyFileSync(fullPath, destPath);
          downloadedFiles.push(destPath);
        }
      }
    };
    walkDir(userDir);

    if (downloadedFiles.length === 0) {
      throw new Error('No audio files found in Soulseek download');
    }

    log('pipeline', 'info', `[job ${job.id}] Copied ${downloadedFiles.length} files from Soulseek to staging`);

    // Step 4: File validation (MIME + ffprobe + ClamAV)
    for (const filePath of downloadedFiles) {
      const validation = await fileValidator.validateFile(filePath);
      if (!validation.passed) {
        const failedChecks = validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
        throw new Error(`File validation failed for ${path.basename(filePath)}: ${failedChecks}`);
      }
    }
    log('pipeline', 'info', `[job ${job.id}] All ${downloadedFiles.length} files passed validation`);

    // Step 5: Download validation (MusicBrainz track matching)
    const existingDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    let existingTrackCount;
    try {
      if (fs.existsSync(existingDir)) {
        existingTrackCount = fs.readdirSync(existingDir).filter(f => downloader.isAudioFile(f)).length;
      }
    } catch { /* no existing files */ }

    const validation = await downloadValidator.validate({
      files: downloadedFiles,
      mbid, rgid, artist, album, existingTrackCount,
    });

    log('pipeline', 'info', `[job ${job.id}] Validation: ${validation.confidence} confidence (score ${validation.score})`);

    if (validation.confidence === 'low') {
      throw new Error(`Download validation failed (score ${validation.score}): ${validation.details}`);
    }

    // Step 6: Move from staging to library
    const destDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    for (const filePath of downloadedFiles) {
      const destPath = path.join(destDir, path.basename(filePath));
      fs.renameSync(filePath, destPath);
    }

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${downloadedFiles.length} files from Soulseek (${validation.confidence} confidence)`);

    return {
      success: true,
      source: 'soulseek',
      artist, album,
      files: downloadedFiles.length,
      confidence: validation.confidence,
      score: validation.score,
      soulseekUser,
    };
  } finally {
    // Cleanup staging
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
  }
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

    case 'soulseek-download':
      return processSoulseekDownload(job, payload);

    case 'upgrade':
      return processUpgrade(job, payload);

    default:
      log('pipeline', 'warn', `[job ${job.id}] Unknown job type: ${job.type}`);
      return { skipped: true, reason: `unknown type: ${job.type}` };
  }
}

module.exports = { process };
