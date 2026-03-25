'use strict';

const express = require('express');
const router = express.Router();
const containerManager = require('../services/container-manager');

// GET /api/containers/status — status of all known containers
router.get('/status', async (req, res) => {
  const status = await containerManager.getAllContainerStatus();
  res.json({ dockerAvailable: containerManager.dockerAvailable(), containers: status });
});

// POST /api/containers/:name/restart — restart a container (admin only)
router.post('/:name/restart', async (req, res) => {
  const { name } = req.params;

  if (!containerManager.dockerAvailable()) {
    return res.status(503).json({ error: 'Docker socket not available', hint: 'Container management requires Docker socket mount' });
  }

  try {
    const success = await containerManager.restartContainer(name);
    if (success) {
      res.json({ restarted: true, container: name });
    } else {
      res.status(500).json({ error: `Failed to restart ${name}` });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
