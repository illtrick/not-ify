'use strict';

// ─── Pipeline Architecture ─────────────────────────────────────────────────
// Three download paths share the same post-download logic:
//
//   1. processDownload()       — Torrent via Real-Debrid (magnet → RD → download → validate → replace)
//   2. processSoulseekDownload() — Soulseek via slskd (enqueue → poll → copy → validate → replace)
//   3. youtube.js:ytQueueProcess() — YouTube via yt-dlp (see api/youtube.js)
//
// All three use replaceTracksIfBetter() for per-track quality comparison.
// Changes to post-download logic (validation, library move, badge refresh,
// metadata, cleanup) must be applied to ALL paths.
//
// The client refreshes library/badges via SSE — see App.jsx SSE listener
// which watches for 'upgrade' and 'pipeline' events with 'upgraded' in message.
// ────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const rd = require('./realdebrid');
const downloader = require('./downloader');
const fileValidator = require('./file-validator');
const downloadValidator = require('./download-validator');
const activityLog = require('./activity-log');
const { enqueueDownload, pollDownloads } = require('./soulseek');
const { probeFile, isUpgrade, QUALITY_RANK } = require('./library-check');

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
// Use _env() to avoid shadowing by the module's own process() function export.
function getMusicDir() {
  const db = require('./db');
  const dbVal = db.getGlobalSetting('musicDir');
  return dbVal || _env().MUSIC_DIR || '/app/music';
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
 * Extract a normalized title from a filename for matching.
 * Strips track number prefix, extension, punctuation, and whitespace.
 * E.g. "03-Better Give U Up.flac" → "bettergiveuup"
 *      "Better Give U Up.mp3"     → "bettergiveuup"
 */
function extractTitle(filename) {
  const base = path.basename(filename);
  // Strip extension
  const noExt = base.replace(/\.[^.]+$/, '');
  // Strip leading track number + separator (01-, 01 , 01_, etc.)
  const noTrackNum = noExt.replace(/^\d+[\s\-_]*/, '');
  // Normalize: lowercase, remove non-alphanumeric
  return noTrackNum.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract track number prefix from filename.
 * Returns the leading digits as a string, or null if none.
 * E.g. "01-Benzin.flac" → "01", "Benzin.mp3" → null
 */
function extractTrackNum(filename) {
  const base = path.basename(filename);
  const match = base.match(/^(\d+)/);
  return match ? match[1] : null;
}

/**
 * Replace library tracks with incoming files only if they're better quality.
 * Uses a matching cascade: track number → normalized title → duration proximity.
 * Same logic for torrent and Soulseek sources.
 *
 * @param {Object} opts
 * @param {string[]} opts.incomingFiles - Absolute paths to incoming audio files
 * @param {string} opts.destDir - Library destination directory
 * @param {number|string} opts.jobId - Job ID for logging
 * @returns {{ upgraded: string[], skippedWorse: string[], skippedExcluded: string[], skippedUnmatched: string[] }}
 */
function replaceTracksIfBetter({ incomingFiles, destDir, jobId }) {
  const upgraded = [];
  const skippedWorse = [];
  const skippedExcluded = [];
  const skippedUnmatched = [];

  // Load excluded list from .metadata.json
  let excludedTrackNums = [];
  let excludedTitles = [];
  try {
    const metaPath = path.join(destDir, '.metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const excluded = meta.excluded || [];
      excludedTrackNums = excluded.map(f => extractTrackNum(f)).filter(Boolean);
      excludedTitles = excluded.map(f => extractTitle(f)).filter(Boolean);
    }
  } catch { /* no metadata */ }

  // Build map of existing tracks in the destination directory
  const existingTracks = [];
  try {
    const existingFiles = fs.readdirSync(destDir).filter(f => downloader.isAudioFile(f));
    for (const file of existingFiles) {
      const filePath = path.join(destDir, file);
      const { quality, duration } = probeFile(filePath);
      existingTracks.push({
        path: filePath,
        filename: file,
        trackNum: extractTrackNum(file),
        normalizedTitle: extractTitle(file),
        quality,
        duration,
      });
    }
  } catch { /* directory may not exist yet — fresh album */ }

  // Fast path: no existing tracks → move everything (skip quality checks)
  if (existingTracks.length === 0) {
    for (const filePath of incomingFiles) {
      const basename = path.basename(filePath);
      const trackNum = extractTrackNum(basename);
      const normTitle = extractTitle(basename);

      // Still respect excluded list
      if ((trackNum && excludedTrackNums.includes(trackNum)) ||
          (normTitle && excludedTitles.includes(normTitle))) {
        log('pipeline', 'info', `[job ${jobId}] Track ${trackNum || '??'}: skipped-excluded — ${basename}`);
        skippedExcluded.push(basename);
        continue;
      }

      const destPath = path.join(destDir, basename);
      fs.renameSync(filePath, destPath);
      upgraded.push(basename);
      log('pipeline', 'info', `[job ${jobId}] Track ${trackNum || '??'}: added (new) — ${basename}`);
    }
    return { upgraded, skippedWorse, skippedExcluded, skippedUnmatched };
  }

  // Process each incoming file
  for (const filePath of incomingFiles) {
    const basename = path.basename(filePath);
    const incomingTrackNum = extractTrackNum(basename);
    const incomingTitle = extractTitle(basename);

    // Check excluded list
    if ((incomingTrackNum && excludedTrackNums.includes(incomingTrackNum)) ||
        (incomingTitle && excludedTitles.includes(incomingTitle))) {
      log('pipeline', 'info', `[job ${jobId}] Track ${incomingTrackNum || '??'}: skipped-excluded — ${basename}`);
      skippedExcluded.push(basename);
      continue;
    }

    // Match cascade: track number + title → track number alone → title alone → duration
    let matched = null;

    // 1. Track number match — prefer match where title also agrees
    if (incomingTrackNum) {
      const trackNumMatches = existingTracks.filter(t => t.trackNum && t.trackNum === incomingTrackNum);
      if (trackNumMatches.length === 1) {
        matched = trackNumMatches[0];
      } else if (trackNumMatches.length > 1 && incomingTitle) {
        // Multiple files with same track number (compilation/merged albums)
        // Use title to disambiguate
        const withTitle = trackNumMatches.find(t => t.normalizedTitle === incomingTitle);
        matched = withTitle || trackNumMatches[0]; // fall back to first if no title match
      }
    }

    // 2. Normalized title match (if track number didn't match or wasn't present)
    if (!matched && incomingTitle) {
      const titleMatches = existingTracks.filter(t => t.normalizedTitle === incomingTitle);
      if (titleMatches.length === 1) {
        matched = titleMatches[0];
      } else if (titleMatches.length > 1) {
        // Ambiguous title (e.g. remix album with multiple "Eyesdown" tracks)
        // Use duration proximity as tiebreaker
        const { duration: incomingDuration } = probeFile(filePath);
        if (incomingDuration > 0) {
          const withDeltas = titleMatches.map(t => ({
            ...t,
            delta: Math.abs(t.duration - incomingDuration),
          }));
          withDeltas.sort((a, b) => a.delta - b.delta);
          // Accept if closest match is within 5 seconds
          if (withDeltas[0].delta <= 5) {
            matched = withDeltas[0];
          }
        }
      }
    }

    if (!matched) {
      // No match — accept as new track
      const destPath = path.join(destDir, basename);
      fs.renameSync(filePath, destPath);
      upgraded.push(basename);
      log('pipeline', 'info', `[job ${jobId}] Track ${incomingTrackNum || '??'}: added (new) — ${basename}`);
      continue;
    }

    // Probe incoming file for quality comparison
    const { quality: incomingQuality } = probeFile(filePath);

    if (isUpgrade(matched.quality, incomingQuality)) {
      // Better quality — replace
      try { fs.unlinkSync(matched.path); } catch { /* already gone */ }
      const destPath = path.join(destDir, basename);
      fs.renameSync(filePath, destPath);
      upgraded.push(basename);
      log('pipeline', 'info', `[job ${jobId}] Track ${incomingTrackNum || '??'}: upgraded (${matched.quality} → ${incomingQuality}) — ${basename}`);

      // Remove from existingTracks so it can't match again
      const idx = existingTracks.indexOf(matched);
      if (idx >= 0) existingTracks.splice(idx, 1);
    } else {
      skippedWorse.push(basename);
      log('pipeline', 'info', `[job ${jobId}] Track ${incomingTrackNum || '??'}: skipped-worse (${incomingQuality} vs existing ${matched.quality}) — ${basename}`);
    }
  }

  return { upgraded, skippedWorse, skippedExcluded, skippedUnmatched };
}

/**
 * Process a download job: magnet → RD → download → validate → replace.
 *
 * ARCHITECTURE NOTE: This pipeline mirrors processSoulseekDownload() below.
 * Both use per-file processing: each file is validated and moved to the library
 * immediately after download via replaceTracksIfBetter(). Changes to the
 * validate → replace flow should be applied to BOTH functions.
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

    // Step 2: Add magnet (check for existing RD torrent to avoid duplicate adds on retry)
    log('pipeline', 'info', `[job ${job.id}] Adding magnet for ${artist} - ${album}`);
    const magnet = await rd.addMagnet(magnetLink);
    torrentId = magnet.id;

    // Step 3: Wait for file selection, get file list
    // If RD already has this torrent cached, it may skip straight to 'downloaded' —
    // check current status before waiting for 'waiting_files_selection'.
    log('pipeline', 'info', `[job ${job.id}] Waiting for RD file selection...`);
    const initialInfo = await rd.getTorrentInfo(torrentId);
    let fileInfo;
    if (initialInfo.status === 'waiting_files_selection') {
      fileInfo = initialInfo;
    } else if (initialInfo.status === 'downloaded') {
      fileInfo = initialInfo; // already cached, skip selection wait
    } else {
      fileInfo = await pollRd(torrentId, 'waiting_files_selection', RD_FILE_SELECTION_TIMEOUT);
    }

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

    // Step 6: Unrestrict + download + validate + replace per-file
    // Each file is validated and moved to library immediately after download.
    // This prevents losing work if later files fail.
    fs.mkdirSync(stagingDir, { recursive: true });
    const destDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    const links = cached.links || [];
    const upgraded = [];
    const skippedWorse = [];
    const skippedExcluded = [];
    const failedFiles = [];
    for (const link of links) {
      let unrestricted;
      try {
        unrestricted = await rd.unrestrictLink(link);
      } catch (err) {
        log('pipeline', 'info', `[job ${job.id}] Failed to unrestrict link: ${err.message}`);
        failedFiles.push(link);
        continue;
      }
      if (!downloader.isAudioFile(unrestricted.filename) && !downloader.isArchive(unrestricted.filename)) {
        continue; // skip non-audio, non-archive
      }
      const destPath = path.join(stagingDir, downloader.sanitizePath(unrestricted.filename));
      log('pipeline', 'info', `[job ${job.id}] Downloading: ${unrestricted.filename}`);

      try {
        await downloader.downloadFile(unrestricted.download, destPath);
      } catch (err) {
        log('pipeline', 'info', `[job ${job.id}] Download failed for ${unrestricted.filename}: ${err.message}`);
        failedFiles.push(unrestricted.filename);
        continue;
      }

      // Extract archives into individual files
      let filesToProcess = [destPath];
      if (downloader.isArchive(unrestricted.filename)) {
        try {
          const extracted = await downloader.extractArchive(destPath, stagingDir);
          filesToProcess = extracted;
        } catch (err) {
          log('pipeline', 'info', `[job ${job.id}] Archive extraction failed: ${err.message}`);
          failedFiles.push(unrestricted.filename);
          continue;
        }
      }

      // Validate + replace each file immediately
      // ClamAV runs sync for torrent/RD downloads (untrusted source)
      for (const filePath of filesToProcess) {
        const validation = await fileValidator.validateFile(filePath);
        if (!validation.passed) {
          const failedChecks = validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
          log('pipeline', 'info', `[job ${job.id}] Validation failed for ${path.basename(filePath)}: ${failedChecks}`);
          try { fs.unlinkSync(filePath); } catch {}
          failedFiles.push(path.basename(filePath));
          continue;
        }

        const trackResult = replaceTracksIfBetter({ incomingFiles: [filePath], destDir, jobId: job.id });
        upgraded.push(...trackResult.upgraded);
        skippedWorse.push(...trackResult.skippedWorse);
        skippedExcluded.push(...trackResult.skippedExcluded);

        // Clean up staging copy
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    if (upgraded.length === 0 && skippedWorse.length === 0) {
      throw new Error(`No audio files successfully processed (${failedFiles.length} failed)`);
    }

    const result = { upgraded, skippedWorse, skippedExcluded };

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${result.upgraded.length} upgraded, ${result.skippedWorse.length} skipped (worse), ${failedFiles.length} failed${upgradeFrom ? ', ' + upgradeFrom + ' → upgraded' : ''}`);

    // Sync tracks table with updated files — stable IDs persist across format upgrades
    try {
      const library = require('../api/library');
      library.syncAlbum(artist, album);
      library.invalidateCache();
    } catch (e) { console.warn('[pipeline] syncAlbum failed:', e.message); }

    // Sync new album schema (albums/album_tracks/track_files) — best-effort
    try {
      const db = require('./db');
      const { generateAlbumId, generateTrackId, normalize } = require('./track-id');
      const metaPath = path.join(destDir, '.metadata.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

      const albumId = generateAlbumId(meta.artist || artist, meta.album || album, meta.rgid);

      // Ensure album exists
      if (!db.getAlbumById(albumId)) {
        db.upsertAlbum({
          id: albumId,
          title: meta.album || album,
          albumArtist: meta.artist || artist,
          year: meta.year ? parseInt(meta.year, 10) : null,
          trackCount: meta.mbTracks ? meta.mbTracks.length : upgraded.length,
          duration: meta.mbTracks ? Math.round(meta.mbTracks.reduce((s, t) => s + (t.lengthMs || 0), 0) / 1000) : null,
          mbid: meta.mbid || null,
          rgid: meta.rgid || null,
          coverArtUrl: meta.coverArt || null,
          genres: null,
          compilation: 0,
        });

        if (meta.mbTracks) {
          for (const t of meta.mbTracks) {
            db.upsertAlbumTrack({
              id: generateTrackId(meta.artist || artist, meta.album || album, t.title, 0),
              albumId,
              title: t.title,
              artist: meta.artist || artist,
              trackNumber: t.position || 0,
              discNumber: 1,
              duration: t.lengthMs ? Math.round(t.lengthMs / 1000) : null,
              mbid: null,
            });
          }
        }
      }

      // Write track_files for each audio file in the album directory
      const albumTracks = db.getAlbumTracks(albumId);
      const audioFiles = fs.readdirSync(destDir).filter(f => /\.(mp3|flac|ogg|m4a|opus|wav|aiff|alac|aac|wma)$/i.test(f));
      for (const file of audioFiles) {
        const title = file.replace(/^\d+[-_\s]*/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
        // Track-number-first matching: unambiguous even when title matches album name
        const fileNum = parseInt(file.match(/^(\d+)/)?.[1], 10);
        const matchingTrack = (fileNum && albumTracks.find(at => at.track_number === fileNum))
          || albumTracks.find(at => normalize(at.title) === normalize(title));

        if (matchingTrack) {
          const filepath = path.join(destDir, file);
          const ext = path.extname(file).replace('.', '').toLowerCase();
          console.log(`[pipeline] track_files: ${matchingTrack.title} → ${ext} (${filepath})`);
          db.upsertTrackFile({
            trackId: matchingTrack.id,
            filepath,
            format: ext,
            bitrate: null,
            fileSize: fs.statSync(filepath).size,
            fileDuration: null,
            scanStatus: 'clean',
          });
        }
      }
    } catch (err) {
      console.warn('[pipeline] Failed to sync album schema:', err.message);
    }

    return {
      success: true,
      artist,
      album,
      files: result.upgraded.length,
      filesSkipped: result.skippedWorse.length,
      filesFailed: failedFiles.length,
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

  // Detect current library quality to find any upgrade, not just FLAC
  const { getExistingQuality } = require('./library-check');
  const currentQuality = getExistingQuality(artist, album) || 'unknown';
  log('pipeline', 'info', `[job ${job.id}] Searching for upgrade: ${artist} - ${album} (current: ${currentQuality})`);

  const { searchForUpgrade } = require('./search');
  const result = await searchForUpgrade({ artist, album, currentQuality });

  if (!result) {
    log('pipeline', 'info', `[job ${job.id}] No upgrade found for ${artist} - ${album}`);
    return { skipped: true, reason: 'no upgrade source found' };
  }

  log('pipeline', 'info', `[job ${job.id}] Found upgrade: ${result.name} (score ${result.score?.toFixed(3)}${result.seeders != null ? `, ${result.seeders} seeders` : ''})`);

  // Pre-check: skip if detected quality isn't actually better than what we have
  const { isUpgrade } = require('./library-check');
  const detectedQuality = (result.detectedQuality || result.source === 'soulseek' ? 'flac' : 'unknown').toLowerCase();
  if (currentQuality && currentQuality !== 'unknown' && detectedQuality !== 'unknown' && !isUpgrade(currentQuality, detectedQuality)) {
    log('pipeline', 'info', `[job ${job.id}] Skipping — detected quality (${detectedQuality}) is not better than current (${currentQuality})`);
    return { skipped: true, reason: `no quality improvement (have: ${currentQuality}, found: ${detectedQuality})` };
  }

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
        source_meta: { source: 'soulseek', quality: result.detectedQuality || 'flac', name: result.name, score: result.score },
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
      source_meta: { quality: result.detectedQuality || 'unknown', name: result.name, seeders: result.seeders, score: result.score },
    },
    { dedupeKey, priority: 5 }
  );

  log('pipeline', 'info', `[job ${job.id}] Enqueued download job ${downloadJobId} for ${artist} - ${album}`);
  return { success: true, downloadJobId, source: result.name, score: result.score };
}

/**
 * Recursively search a directory for a file by basename.
 * Returns the full path if found, null otherwise.
 */
function findFileInDir(dir, targetBasename) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileInDir(fullPath, targetBasename);
        if (found) return found;
      } else if (entry.name === targetBasename) {
        return fullPath;
      }
    }
  } catch {}
  return null;
}

/**
 * Process a Soulseek download job:
 * enqueue on slskd → poll per-file → validate + replace incrementally → library
 *
 * ARCHITECTURE NOTE: This pipeline mirrors processDownload() above.
 * Both use per-file processing: each file is validated and moved to the library
 * immediately after completion via replaceTracksIfBetter(). Changes to the
 * validate → replace flow should be applied to BOTH functions.
 */
async function processSoulseekDownload(job, payload) {
  const { soulseekUser, files, artist, album, mbid, rgid } = payload;
  const stagingDir = path.join(getStagingDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));

  try {
    // Step 0: Pre-clean downloads dir to avoid stale files from previous jobs
    const dlDir = getSlskdDownloadsDir();
    if (fs.existsSync(dlDir)) {
      for (const entry of fs.readdirSync(dlDir)) {
        try { fs.rmSync(path.join(dlDir, entry), { recursive: true, force: true }); } catch {}
      }
    }

    // Step 1: Enqueue download on slskd
    log('pipeline', 'info', `[job ${job.id}] Enqueuing ${files.length} files from Soulseek user ${soulseekUser}`);
    const enqueued = await enqueueDownload(soulseekUser, files);
    if (!enqueued) {
      throw new Error(`Failed to enqueue download from ${soulseekUser}`);
    }

    // Step 2: Poll and process files incrementally as they complete.
    // Each file is validated and moved to library immediately — no waiting
    // for the full album. This prevents losing work if some files timeout.
    const deadline = Date.now() + getSlskDownloadTimeout();
    const getBasename = (f) => f.split(/[\\/]/).pop();
    const processedBasenames = new Set();
    const destDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    const dlBase = getSlskdDownloadsDir();
    const userDir = path.join(dlBase, soulseekUser);
    const expectedBasenames = new Set(
      files.map(f => path.basename(f.filename.replace(/\\/g, '/')))
    );

    const upgraded = [];
    const skippedWorse = [];
    const skippedExcluded = [];
    const failedFiles = [];
    let lastLoggedCount = -1;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, getSlskPollInterval()));
      const transfers = await pollDownloads(soulseekUser);

      // Build current state map
      const fileStates = new Map();
      for (const t of transfers) {
        for (const dir of (t.directories || [])) {
          for (const f of (dir.files || [])) {
            fileStates.set(getBasename(f.filename), f.state || '');
          }
        }
      }

      // Track failed files (but don't abort — process what we can)
      for (const f of files) {
        const bn = getBasename(f.filename);
        const state = fileStates.get(bn) || '';
        if ((state.includes('Errored') || state.includes('Cancelled')) && !processedBasenames.has(bn)) {
          processedBasenames.add(bn);
          failedFiles.push(bn);
          log('pipeline', 'info', `[job ${job.id}] File failed to download: ${bn}`);
        }
      }

      // Find newly completed files and process them immediately
      for (const f of files) {
        const bn = getBasename(f.filename);
        if (processedBasenames.has(bn)) continue;
        const state = fileStates.get(bn) || '';
        if (!state.includes('Succeeded')) continue;

        processedBasenames.add(bn);

        // Find the file in the downloads directory
        const searchDir = fs.existsSync(userDir) ? userDir : dlBase;
        const foundPath = findFileInDir(searchDir, bn);
        if (!foundPath) {
          log('pipeline', 'info', `[job ${job.id}] Completed file not found on disk: ${bn}`);
          failedFiles.push(bn);
          continue;
        }

        // Copy to staging
        const safeName = downloader.sanitizePath(path.basename(bn));
        const stagingPath = path.join(stagingDir, safeName);
        fs.copyFileSync(foundPath, stagingPath);

        // Validate (MIME + ffprobe + ClamAV — Soulseek is untrusted source)
        const fileVal = await fileValidator.validateFile(stagingPath);
        if (!fileVal.passed) {
          const failedChecks = fileVal.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
          log('pipeline', 'info', `[job ${job.id}] Validation failed for ${bn}: ${failedChecks}`);
          try { fs.unlinkSync(stagingPath); } catch {}
          failedFiles.push(bn);
          continue;
        }

        // Per-track quality comparison and replacement
        const trackResult = replaceTracksIfBetter({ incomingFiles: [stagingPath], destDir, jobId: job.id });
        upgraded.push(...trackResult.upgraded);
        skippedWorse.push(...trackResult.skippedWorse);
        skippedExcluded.push(...trackResult.skippedExcluded);

        // Clean up staging copy
        try { fs.unlinkSync(stagingPath); } catch {}
      }

      // Log progress (only when count changes)
      const doneCount = processedBasenames.size;
      if (doneCount !== lastLoggedCount) {
        lastLoggedCount = doneCount;
        log('pipeline', 'info', `[job ${job.id}] Soulseek progress: ${upgraded.length} upgraded, ${failedFiles.length} failed, ${skippedWorse.length} skipped (${doneCount}/${files.length})`);
      }

      // All files accounted for — done
      if (processedBasenames.size >= files.length) break;
    }

    // Log any remaining unfinished files as timed out
    for (const f of files) {
      const bn = getBasename(f.filename);
      if (!processedBasenames.has(bn)) {
        failedFiles.push(bn);
        log('pipeline', 'info', `[job ${job.id}] File timed out: ${bn}`);
      }
    }

    if (upgraded.length === 0 && skippedWorse.length === 0) {
      throw new Error(`No files successfully processed from Soulseek (${failedFiles.length} failed)`);
    }

    const result = { upgraded, skippedWorse, skippedExcluded };

    // Step 7: Write .metadata.json (matches torrent pipeline behavior)
    const metadataPath = path.join(destDir, '.metadata.json');
    try {
      fs.writeFileSync(metadataPath, JSON.stringify({
        mbid: mbid || null,
        source: 'soulseek',
        soulseekUser,
        importedAt: new Date().toISOString(),
      }, null, 2));
    } catch {}

    // Step 8: Pre-warm cover art cache (fire-and-forget)
    try {
      fetch(`http://localhost:${globalThis.process.env.PORT || 3000}/api/cover/search?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`, {
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    } catch {}

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${result.upgraded.length} upgraded, ${result.skippedWorse.length} skipped (worse), ${failedFiles.length} failed from Soulseek`);

    // Sync tracks table — stable IDs persist across format upgrades
    try {
      const library = require('../api/library');
      library.syncAlbum(artist, album);
      library.invalidateCache();
    } catch (e) { console.warn('[pipeline] syncAlbum failed:', e.message); }

    // Sync new album schema (albums/album_tracks/track_files) — best-effort
    try {
      const db = require('./db');
      const { generateAlbumId, generateTrackId, normalize } = require('./track-id');
      const slskMetaPath = path.join(destDir, '.metadata.json');
      let slskMeta = {};
      try { slskMeta = JSON.parse(fs.readFileSync(slskMetaPath, 'utf8')); } catch {}

      const slskAlbumId = generateAlbumId(slskMeta.artist || artist, slskMeta.album || album, slskMeta.rgid);

      // Ensure album exists
      if (!db.getAlbumById(slskAlbumId)) {
        db.upsertAlbum({
          id: slskAlbumId,
          title: slskMeta.album || album,
          albumArtist: slskMeta.artist || artist,
          year: slskMeta.year ? parseInt(slskMeta.year, 10) : null,
          trackCount: slskMeta.mbTracks ? slskMeta.mbTracks.length : upgraded.length,
          duration: slskMeta.mbTracks ? Math.round(slskMeta.mbTracks.reduce((s, t) => s + (t.lengthMs || 0), 0) / 1000) : null,
          mbid: slskMeta.mbid || null,
          rgid: slskMeta.rgid || null,
          coverArtUrl: slskMeta.coverArt || null,
          genres: null,
          compilation: 0,
        });

        if (slskMeta.mbTracks) {
          for (const t of slskMeta.mbTracks) {
            db.upsertAlbumTrack({
              id: generateTrackId(slskMeta.artist || artist, slskMeta.album || album, t.title, 0),
              albumId: slskAlbumId,
              title: t.title,
              artist: slskMeta.artist || artist,
              trackNumber: t.position || 0,
              discNumber: 1,
              duration: t.lengthMs ? Math.round(t.lengthMs / 1000) : null,
              mbid: null,
            });
          }
        }
      }

      // Write track_files for each audio file in the album directory
      const slskAlbumTracks = db.getAlbumTracks(slskAlbumId);
      const slskAudioFiles = fs.readdirSync(destDir).filter(f => /\.(mp3|flac|ogg|m4a|opus|wav|aiff|alac|aac|wma)$/i.test(f));
      for (const file of slskAudioFiles) {
        const title = file.replace(/^\d+[-_\s]*/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
        // Track-number-first matching: unambiguous even when title matches album name
        const fileNum = parseInt(file.match(/^(\d+)/)?.[1], 10);
        const matchingTrack = (fileNum && slskAlbumTracks.find(at => at.track_number === fileNum))
          || slskAlbumTracks.find(at => normalize(at.title) === normalize(title));

        if (matchingTrack) {
          const filepath = path.join(destDir, file);
          const ext = path.extname(file).replace('.', '').toLowerCase();
          console.log(`[pipeline] track_files: ${matchingTrack.title} → ${ext} (${filepath})`);
          db.upsertTrackFile({
            trackId: matchingTrack.id,
            filepath,
            format: ext,
            bitrate: null,
            fileSize: fs.statSync(filepath).size,
            fileDuration: null,
            scanStatus: 'clean',
          });
        }
      }
    } catch (err) {
      console.warn('[pipeline] Failed to sync album schema:', err.message);
    }

    return {
      success: true,
      source: 'soulseek',
      artist, album,
      files: result.upgraded.length,
      filesSkipped: result.skippedWorse.length,
      filesFailed: failedFiles.length,
      soulseekUser,
    };
  } finally {
    // Cleanup staging
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    // Cleanup slskd downloads (via shared bind mount) — remove all contents
    try {
      const dlDir = getSlskdDownloadsDir();
      if (fs.existsSync(dlDir)) {
        for (const entry of fs.readdirSync(dlDir)) {
          fs.rmSync(path.join(dlDir, entry), { recursive: true, force: true });
        }
      }
    } catch {}
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
