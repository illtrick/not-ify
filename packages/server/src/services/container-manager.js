'use strict';

/**
 * Container Manager — manages sibling Docker containers via the Docker socket.
 * Used by Settings UI to persist credentials to .env and restart containers.
 *
 * On Linux (Docker): uses Unix socket at /var/run/docker.sock
 * On Windows (dev): uses named pipe //./pipe/dockerDesktopLinuxEngine
 * If neither is available, operations are no-ops with warnings.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Docker socket path
const UNIX_SOCKET = '/var/run/docker.sock';
const WINDOWS_PIPE = '//./pipe/dockerDesktopLinuxEngine';

function getSocketPath() {
  if (fs.existsSync(UNIX_SOCKET)) return UNIX_SOCKET;
  // Windows named pipe — can't check existence, just try it
  if (process.platform === 'win32') return WINDOWS_PIPE;
  return null;
}

function dockerAvailable() {
  return !!getSocketPath();
}

/**
 * Make a request to the Docker Engine API via Unix socket.
 */
function dockerApi(method, apiPath, body) {
  const socketPath = getSocketPath();
  if (!socketPath) return Promise.reject(new Error('Docker socket not available'));

  return new Promise((resolve, reject) => {
    const options = {
      socketPath,
      path: apiPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Docker API timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Restart a named container. Returns true on success.
 * @param {string} name — container name (e.g., 'slskd', 'gluetun')
 * @param {number} timeout — seconds to wait before killing (default 10)
 */
async function restartContainer(name, timeout = 10) {
  // Whitelist of containers we're allowed to restart
  const ALLOWED = ['slskd', 'gluetun', 'clamav', 'not-ify', 'watchtower'];
  if (!ALLOWED.includes(name)) {
    throw new Error(`Container "${name}" is not in the allowed restart list`);
  }

  if (!dockerAvailable()) {
    console.warn(`[container-manager] Docker socket not available — cannot restart ${name}`);
    return false;
  }

  try {
    const result = await dockerApi('POST', `/containers/${name}/restart?t=${timeout}`);
    if (result.status === 204) {
      console.log(`[container-manager] Restarted container: ${name}`);
      return true;
    }
    console.warn(`[container-manager] Restart ${name} returned status ${result.status}: ${result.data}`);
    return false;
  } catch (err) {
    console.error(`[container-manager] Failed to restart ${name}: ${err.message}`);
    return false;
  }
}

/**
 * Get status of a named container.
 * @returns {{ running: boolean, healthy: boolean, status: string } | null}
 */
async function getContainerStatus(name) {
  if (!dockerAvailable()) return null;

  try {
    const result = await dockerApi('GET', `/containers/${name}/json`);
    if (result.status === 404) return { running: false, healthy: false, status: 'not found' };
    const info = JSON.parse(result.data);
    return {
      running: info.State?.Running || false,
      healthy: info.State?.Health?.Status === 'healthy',
      status: info.State?.Status || 'unknown',
      image: info.Config?.Image || '',
    };
  } catch {
    return null;
  }
}

/**
 * Get status of all known containers.
 */
async function getAllContainerStatus() {
  const names = ['not-ify', 'slskd', 'gluetun', 'clamav', 'watchtower'];
  const results = {};
  for (const name of names) {
    results[name] = await getContainerStatus(name);
  }
  return results;
}

/**
 * Find the .env file path.
 * Priority: INSTALL_DIR env var > CONFIG_DIR parent > cwd
 */
function getEnvFilePath() {
  const installDir = process.env.INSTALL_DIR;
  if (installDir) {
    const envPath = path.join(installDir, '.env');
    if (fs.existsSync(envPath)) return envPath;
  }

  // Fallback: config dir parent
  const configDir = process.env.CONFIG_DIR || '/app/config';
  const parentEnv = path.join(path.dirname(configDir), '.env');
  if (fs.existsSync(parentEnv)) return parentEnv;

  return null;
}

/**
 * Update one or more keys in the .env file.
 * Creates the key if it doesn't exist, updates if it does.
 * @param {Object} updates — { KEY: 'value', ... }
 * @returns {boolean} true if file was updated
 */
function updateEnvFile(updates) {
  const envPath = getEnvFilePath();
  if (!envPath) {
    console.warn('[container-manager] .env file not found — cannot persist settings');
    return false;
  }

  try {
    let content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        // Update existing line
        content = content.replace(regex, `${key}=${value}`);
      } else {
        // Append new line (before any trailing newlines)
        const trimmed = content.trimEnd();
        content = trimmed + '\n' + `${key}=${value}` + '\n';
      }
    }

    fs.writeFileSync(envPath, content);
    console.log(`[container-manager] Updated .env: ${Object.keys(updates).join(', ')}`);
    return true;
  } catch (err) {
    console.error(`[container-manager] Failed to update .env: ${err.message}`);
    return false;
  }
}

/**
 * Write slskd config file with API key.
 * Called after slskd container starts (it overwrites config on first boot).
 * @param {string} apiKey — the API key value
 */
async function writeSlskdApiKeyConfig(apiKey) {
  if (!dockerAvailable()) return false;

  const configYml = `web:\n  authentication:\n    api_keys:\n      notify:\n        key: ${apiKey}\n        role: administrator\n`;

  try {
    // Write config inside the slskd container
    const cmd = `cat > /app/slskd.yml << 'CFGEOF'\n${configYml}CFGEOF`;
    const result = await dockerApi('POST', `/containers/slskd/exec`, {
      Cmd: ['sh', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true,
    });

    if (result.status === 201) {
      const execId = JSON.parse(result.data).Id;
      await dockerApi('POST', `/exec/${execId}/start`, { Detach: false, Tty: false });
      console.log('[container-manager] Wrote slskd API key config');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[container-manager] Failed to write slskd config: ${err.message}`);
    return false;
  }
}

module.exports = {
  dockerAvailable,
  restartContainer,
  getContainerStatus,
  getAllContainerStatus,
  updateEnvFile,
  getEnvFilePath,
  writeSlskdApiKeyConfig,
};
