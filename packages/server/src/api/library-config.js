const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../services/db');

const router = express.Router();

function isDocker() {
  return fs.existsSync('/.dockerenv') || process.env.DOCKER === 'true';
}

function getMusicDir() {
  const fromDb = db.getGlobalSetting('musicDir');
  if (fromDb) return { musicDir: fromDb, source: 'db' };

  const fromEnv = process.env.MUSIC_DIR;
  if (fromEnv) return { musicDir: fromEnv, source: 'env' };

  return { musicDir: '/app/music', source: 'default' };
}

// GET /api/library-config — return current music directory config
router.get('/', (req, res) => {
  const { musicDir, source } = getMusicDir();
  res.json({ musicDir, source, isDocker: isDocker() });
});

// POST /api/library-config — save new music directory path
router.post('/', (req, res) => {
  const { musicDir } = req.body;
  if (!musicDir || typeof musicDir !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid musicDir' });
  }

  const resolved = path.resolve(musicDir);

  // Validate: path exists and is a directory
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return res.status(400).json({ error: `Path does not exist: ${resolved}` });
  }

  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Path is not a directory: ${resolved}` });
  }

  // Validate: path is writable
  const testFile = path.join(resolved, `.notify-write-test-${process.pid}`);
  try {
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (err) {
    return res.status(400).json({ error: `Path is not writable: ${err.message}` });
  }

  const { musicDir: oldPath } = getMusicDir();

  db.setGlobalSetting('musicDir', resolved);

  res.json({ saved: true, restartRequired: true, oldPath, newPath: resolved });
});

// GET /api/library-config/browse — filesystem directory browser
router.get('/browse', (req, res) => {
  const requestedPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
  const fullPath = path.resolve(requestedPath);

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(fullPath, e.name),
      }));

    const parent = path.dirname(fullPath) !== fullPath ? path.dirname(fullPath) : null;
    res.json({ current: fullPath, parent, directories: dirs });
  } catch (err) {
    res.status(400).json({ error: `Cannot read: ${err.message}` });
  }
});

module.exports = router;
