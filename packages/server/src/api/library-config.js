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

// GET /api/library-config/files-count — count music files and total size in current music dir
router.get('/files-count', (req, res) => {
  const dirPath = req.query.path || getMusicDir().musicDir;
  const resolved = path.resolve(dirPath);

  const musicExts = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.aac', '.opus', '.wma', '.alac']);

  let count = 0;
  let totalBytes = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable dirs
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && musicExts.has(path.extname(entry.name).toLowerCase())) {
        count++;
        try {
          totalBytes += fs.statSync(fullPath).size;
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  try {
    walk(resolved);
    res.json({ count, totalSizeMB: Math.round(totalBytes / (1024 * 1024)) });
  } catch (err) {
    res.status(400).json({ error: `Cannot scan: ${err.message}` });
  }
});

// POST /api/library-config/migrate — copy music files from old path to new path, stream progress via SSE
router.post('/migrate', (req, res) => {
  const { fromPath, toPath } = req.body;
  if (!fromPath || !toPath) {
    return res.status(400).json({ error: 'Missing fromPath or toPath' });
  }

  const resolvedFrom = path.resolve(fromPath);
  const resolvedTo = path.resolve(toPath);

  const musicExts = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.aac', '.opus', '.wma', '.alac']);

  // Collect all music files first
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && musicExts.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  try {
    walk(resolvedFrom);
  } catch (err) {
    return res.status(400).json({ error: `Cannot scan source: ${err.message}` });
  }

  if (files.length === 0) {
    return res.json({ done: true, copied: 0, total: 0 });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let copied = 0;
  const total = files.length;

  function sendProgress() {
    res.write(`data: ${JSON.stringify({ copying: true, copied, total, progress: `${copied}/${total} files` })}\n\n`);
  }

  async function copyFiles() {
    for (const srcFile of files) {
      const relative = path.relative(resolvedFrom, srcFile);
      const destFile = path.join(resolvedTo, relative);
      const destDir = path.dirname(destFile);

      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcFile, destFile);
        copied++;
        sendProgress();
      } catch (err) {
        // Log but continue copying other files
        res.write(`data: ${JSON.stringify({ error: `Failed to copy ${relative}: ${err.message}` })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, copied, total })}\n\n`);
    res.end();
  }

  sendProgress();
  copyFiles();
});

module.exports = router;
