'use strict';

const crypto = require('crypto');

// In-memory cast sessions — one per user. Lost on server restart (acceptable).
// Map<userId, { deviceUsn, deviceType, queue, queueIndex, queueHash }>
const _sessions = new Map();

function computeQueueHash(queue) {
  if (!queue || !queue.length) return '';
  return crypto.createHash('md5').update(queue.map(t => t.id).join(':')).digest('hex');
}

function setSession(userId, session) {
  const queueHash = computeQueueHash(session.queue);
  _sessions.set(userId, { ...session, queueHash });
}

function getSession(userId) {
  return _sessions.get(userId) || null;
}

function clearSession(userId) {
  _sessions.delete(userId);
}

// Returns the next track in the queue, or null if at end
function advanceQueue(userId) {
  const session = _sessions.get(userId);
  if (!session) return null;
  const next = session.queueIndex + 1;
  if (next >= session.queue.length) return null;
  session.queueIndex = next;
  return session.queue[next];
}

// Returns the previous track (or current if at start)
function previousInQueue(userId) {
  const session = _sessions.get(userId);
  if (!session) return null;
  const prev = Math.max(0, session.queueIndex - 1);
  session.queueIndex = prev;
  return session.queue[prev];
}

function currentTrack(userId) {
  const session = _sessions.get(userId);
  if (!session || !session.queue.length) return null;
  return session.queue[session.queueIndex] || null;
}

module.exports = { setSession, getSession, clearSession, advanceQueue, previousInQueue, currentTrack, computeQueueHash };
