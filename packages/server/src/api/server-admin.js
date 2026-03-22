'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');
const jobQueue = require('../services/job-queue');
const activity = require('../services/activity-log');

// GET /api/server/active-jobs
// Returns count and types of currently active/running jobs
router.get('/active-jobs', (req, res) => {
  const activeJobs = jobQueue.getByStatus('active');
  const types = [...new Set(activeJobs.map(j => j.type))];
  res.json({ activeJobs: activeJobs.length, types });
});

// POST /api/server/restart
// Pauses active jobs, logs the restart, then exits so Docker/nodemon restarts the process
router.post('/restart', (req, res) => {
  const activeJobs = jobQueue.getByStatus('active');

  // Reset active jobs back to 'pending' so they are retried on next startup
  if (activeJobs.length > 0) {
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'"
    );
    for (const job of activeJobs) {
      stmt.run(job.id);
    }
  }

  activity.log('system', 'info', 'Server restarting for config change', {
    pausedJobs: activeJobs.length,
  });

  res.json({ restarting: true });

  // Exit after flushing the response — Docker restart policy / nodemon handles restart
  setImmediate(() => process.exit(0));
});

module.exports = router;
