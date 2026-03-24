'use strict';

const pino = require('pino');
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'test' ? 'silent' : 'info');

// Ensure log directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// Build transport targets
const targets = [];

// File transport via pino-roll (worker thread — zero event loop impact)
if (NODE_ENV !== 'test') {
  targets.push({
    target: 'pino-roll',
    options: {
      file: path.join(LOG_DIR, 'not-ify'),
      frequency: 'daily',
      extension: '.log',
      limit: { count: 30 },
      mkdir: true,
    },
    level: LOG_LEVEL,
  });
}

// Stdout transport (for docker compose logs + pino-pretty in dev)
if (NODE_ENV !== 'test') {
  if (NODE_ENV === 'development') {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      level: LOG_LEVEL,
    });
  } else {
    targets.push({
      target: 'pino/file',
      options: { destination: 1 }, // stdout
      level: LOG_LEVEL,
    });
  }
}

// Create the transport (or use a simple destination for test)
let transport;
if (targets.length > 0) {
  transport = pino.transport({ targets });
}

const logger = pino(
  {
    level: LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    serializers: pino.stdSerializers,
    redact: {
      paths: [
        'password',
        'token',
        'apiKey',
        'api_key',
        'api_secret',
        'sessionKey',
        'session_key',
        'authorization',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  },
  transport,
);

// Bind env to root logger so all children inherit it
logger.setBindings({ env: NODE_ENV });

/**
 * Create a child logger with a service name.
 * @param {string} service - Service name (e.g. 'db', 'jobs', 'search')
 * @returns {pino.Logger}
 */
function createChild(service) {
  return logger.child({ service });
}

// Intercept global console to route through Pino (captures legacy console.log calls)
if (NODE_ENV !== 'test') {
  const consoleLogger = createChild('console');
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  console.log = (...args) => consoleLogger.info({ legacy: true }, args.map(String).join(' '));
  console.warn = (...args) => consoleLogger.warn({ legacy: true }, args.map(String).join(' '));
  console.error = (...args) => consoleLogger.error({ legacy: true }, args.map(String).join(' '));
  console.info = (...args) => consoleLogger.info({ legacy: true }, args.map(String).join(' '));

  // Preserve original console for cases where we need direct stdout (e.g. pino-pretty)
  logger._originalConsole = originalConsole;
}

/**
 * Flush buffered logs and close the transport.
 * Call this during graceful shutdown to ensure all logs are written.
 */
function flushAndClose() {
  return new Promise((resolve) => {
    logger.flush();
    if (transport && typeof transport.end === 'function') {
      transport.on('close', resolve);
      transport.end();
    } else {
      resolve();
    }
  });
}

logger.createChild = createChild;
logger.flushAndClose = flushAndClose;

module.exports = logger;
