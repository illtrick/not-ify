'use strict';

const express = require('express');
const router = express.Router();

// Lazy-load heavy services to avoid triggering DB schema init at module load
// time (which would crash in test environments that mock the DB)
function getJobQueue() { return require('../services/job-queue'); }
function getQualityUpgrader() { return require('../services/quality-upgrader'); }
function getRd() { return require('../services/realdebrid'); }
function getDownloader() { return require('../services/downloader'); }
function getSearchMusic() { return require('../services/search').searchMusic; }

// ---------------------------------------------------------------------------
// GET /api/upgrade/status — current upgrade queue status (all jobs + stats)
// ---------------------------------------------------------------------------
router.get('/upgrade/status', (req, res) => {
  const jobQueue = getJobQueue();
  const jobs = jobQueue.getAll().filter(j => j.type === 'upgrade' || j.type === 'download');

  const stats = { pending: 0, active: 0, done: 0, failed: 0 };
  for (const job of jobs) {
    if (stats[job.status] !== undefined) stats[job.status]++;
  }

  res.json({ jobs, stats });
});

// ---------------------------------------------------------------------------
// POST /api/upgrade/album — manual: upgrade specific album now
// body: { artist, album }
// ---------------------------------------------------------------------------
router.post('/upgrade/album', async (req, res) => {
  const { artist, album } = req.body || {};
  if (!artist || !album) {
    return res.status(400).json({ error: 'Missing artist and album in request body' });
  }

  const upgrader = getUpgrader();
  const jobId = await upgrader.upgradeAlbum(artist, album);
  res.json({ queued: true, jobId });
});

// ---------------------------------------------------------------------------
// POST /api/upgrade/scan — manual: trigger full library scan
// ---------------------------------------------------------------------------
router.post('/upgrade/scan', async (req, res) => {
  const upgrader = getUpgrader();
  const candidates = await upgrader.scanForUpgrades('flac');
  res.json({ started: true, found: candidates.length });
});

// ---------------------------------------------------------------------------
// Lazy singleton upgrader — shared with the server lifecycle timer
// ---------------------------------------------------------------------------
let _upgrader = null;

function getUpgrader() {
  if (_upgrader) return _upgrader;
  _upgrader = buildUpgrader();
  return _upgrader;
}

function buildUpgrader() {
  const QualityUpgrader = getQualityUpgrader();
  return new QualityUpgrader({
    jobQueue: getJobQueue(),
    library: getLibraryTracks,
    search: searchForUpgrade,
    downloader: getDownloader(),
    rd: getRd(),
  });
}

// ---------------------------------------------------------------------------
// Helpers — adapters that match the QualityUpgrader constructor API
// ---------------------------------------------------------------------------

async function getLibraryTracks() {
  const libraryRouter = require('./library');
  const { tracks } = libraryRouter.getTrackMap();
  return tracks;
}

async function searchForUpgrade({ artist, album }) {
  const searchMusic = getSearchMusic();
  const query = `${artist} ${album}`;
  const results = await searchMusic(query);
  if (!results || results.length === 0) return null;
  return { magnetLink: results[0].magnetLink, sources: results };
}

module.exports = router;
module.exports.getUpgrader = getUpgrader;
module.exports.buildUpgrader = buildUpgrader;
