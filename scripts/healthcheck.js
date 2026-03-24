#!/usr/bin/env node
'use strict';

// Lightweight Docker HEALTHCHECK — no dependencies beyond built-in http
const http = require('http');

const PORT = process.env.PORT || 3000;

const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: 5000 }, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
