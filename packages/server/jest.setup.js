// Ensure CONFIG_DIR points to a writable temp directory for all tests
// This prevents db.js from trying to create /app/config in CI
const os = require('os');
const path = require('path');
if (!process.env.CONFIG_DIR) {
  process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);
}
