'use strict';

/**
 * Quality ranking — higher value means better quality.
 * Used to determine whether an album is a candidate for upgrade.
 */
const QUALITY_RANK = {
  flac: 5,
  wav: 4,
  alac: 4,
  aiff: 4,
  m4a: 3,
  ogg: 2,
  opus: 2,
  aac: 2,
  mp3: 1,
};

let _log = null;
function getLog() {
  if (!_log) {
    try { _log = require('./logger').createChild('upgrade'); } catch { _log = { info() {}, warn() {}, error() {} }; }
  }
  return _log;
}

/**
 * Return the numeric rank for a format string.
 * Unknown formats are ranked 0 (lowest).
 * @param {string} format
 * @returns {number}
 */
function rank(format) {
  return QUALITY_RANK[(format || '').toLowerCase()] || 0;
}

/**
 * QualityUpgrader
 *
 * Background service that scans the music library for tracks below a target
 * quality level, finds better sources via torrent search, and queues download
 * jobs to replace them.
 *
 * All dependencies are injected via the constructor so the class is fully
 * testable without touching real services, the database, or the filesystem.
 */
class QualityUpgrader {
  /**
   * @param {object} deps
   * @param {object} deps.jobQueue   - Job queue service ({ enqueue, dequeue, complete, fail, getByType, getByStatus })
   * @param {Function} deps.library  - Async fn that returns all library tracks as [{ artist, album, title, format, path }]
   * @param {Function} deps.search   - Async fn({ artist, album, quality? }) → { magnetLink, sources } | null
   * @param {object} deps.downloader - Downloader service ({ download })
   * @param {object} deps.rd         - Real-Debrid service ({ resolve })
   */
  constructor({ jobQueue, library, search, downloader, rd }) {
    this.jobQueue = jobQueue;
    this.library = library;
    this.search = search;
    this.downloader = downloader;
    this.rd = rd;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Scan the library for albums whose best track is below targetQuality.
   * Groups tracks by (artist, album), determines the best format present,
   * and enqueues an upgrade job for each qualifying album.
   *
   * @param {string} [targetQuality='flac']
   * @returns {Promise<Array<{ artist, album, currentQuality }>>} Albums queued for upgrade
   */
  async scanForUpgrades(targetQuality = 'flac') {
    const targetRank = rank(targetQuality);
    const tracks = await this.library();

    // Group tracks by "artist|album"
    const albumMap = new Map();
    for (const track of tracks) {
      const key = `${track.artist}|${track.album}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, { artist: track.artist, album: track.album, bestRank: 0, bestFormat: '' });
      }
      const entry = albumMap.get(key);
      const trackRank = rank(track.format);
      if (trackRank > entry.bestRank) {
        entry.bestRank = trackRank;
        entry.bestFormat = (track.format || '').toLowerCase();
      }
    }

    const candidates = [];
    getLog().info({ event: 'upgrade.scan.started', totalAlbums: albumMap.size, targetQuality }, 'Upgrade scan started');
    for (const entry of albumMap.values()) {
      if (entry.bestRank < targetRank) {
        const dedupeKey = `upgrade:${entry.artist}|${entry.album}`;
        this.jobQueue.enqueue(
          'upgrade',
          { artist: entry.artist, album: entry.album, currentQuality: entry.bestFormat, targetQuality },
          { dedupeKey, priority: 0 }
        );
        candidates.push({ artist: entry.artist, album: entry.album, currentQuality: entry.bestFormat });
        getLog().info({ event: 'upgrade.candidate.found', artist: entry.artist, album: entry.album, currentQuality: entry.bestFormat }, `Upgrade candidate: ${entry.artist} — ${entry.album} (${entry.bestFormat})`);
      }
    }

    getLog().info({ event: 'upgrade.scan.complete', candidateCount: candidates.length, totalAlbums: albumMap.size }, `Upgrade scan complete: ${candidates.length} candidates from ${albumMap.size} albums`);
    return candidates;
  }

  /**
   * Search torrent sources for a version of this album with better quality.
   *
   * @param {string} artist
   * @param {string} album
   * @param {string} currentQuality - Current best format (e.g. 'mp3')
   * @returns {Promise<{ magnetLink: string, sources: Array } | null>}
   */
  async findBetterSource(artist, album, currentQuality) {
    const result = await this.search({ artist, album, currentQuality });
    if (!result || !result.magnetLink) return null;
    return result;
  }

  /**
   * Handle a discography torrent by enqueuing a download job tagged with
   * isDiscography=true. The download pipeline is responsible for extracting
   * the target album's files and discarding the rest.
   *
   * Full in-process extraction logic (poll RD, identify album files, move,
   * clean up) is a later refinement — this stub keeps the queue moving.
   *
   * @param {string} magnetLink
   * @param {string} targetArtist
   * @param {string} targetAlbum
   * @returns {Promise<number>} Enqueued job ID
   */
  async handleDiscographyDownload(magnetLink, targetArtist, targetAlbum) {
    const dedupeKey = `discography-dl:${targetArtist}|${targetAlbum}`;
    const jobId = this.jobQueue.enqueue(
      'download',
      { magnetLink, artist: targetArtist, album: targetAlbum, isDiscography: true },
      { dedupeKey, priority: 1 }
    );
    return jobId;
  }

  /**
   * Check whether the system is idle (no active download jobs).
   * Upgrade jobs only run automatically when the system is idle to avoid
   * competing with user-initiated downloads.
   *
   * @returns {boolean}
   */
  isIdle() {
    const activeJobs = this.jobQueue.getByStatus('active');
    const activeDownloads = activeJobs.filter(j => j.type === 'download');
    return activeDownloads.length === 0;
  }

  /**
   * Periodic tick — called by the scheduler.
   * If the system is idle, dequeues one pending upgrade job and processes it.
   *
   * @returns {Promise<void>}
   */
  async tick() {
    if (!this.isIdle()) return;

    const job = this.jobQueue.dequeue('upgrade');
    if (!job) return;

    let payload;
    try {
      payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    } catch {
      this.jobQueue.fail(job.id, 'Invalid job payload — could not parse JSON');
      return;
    }

    const { artist, album, currentQuality } = payload;

    try {
      const source = await this.findBetterSource(artist, album, currentQuality);

      if (source) {
        getLog().info({ event: 'upgrade.queued', artist, album, magnetLink: source.magnetLink }, `Upgrade source found: ${artist} — ${album}`);
      }

      if (!source) {
        this.jobQueue.complete(job.id, { noSource: true, artist, album });
        return;
      }

      // Queue a download job for the found source
      const downloadJobId = this.jobQueue.enqueue(
        'download',
        { magnetLink: source.magnetLink, artist, album, upgradeFrom: currentQuality },
        { dedupeKey: `upgrade-dl:${artist}|${album}`, priority: 1 }
      );

      this.jobQueue.complete(job.id, { downloadJobId, magnetLink: source.magnetLink, artist, album });
    } catch (err) {
      this.jobQueue.fail(job.id, err.message || String(err));
    }
  }

  /**
   * Manually trigger an upgrade for a specific album, bypassing the idle check.
   * Jobs enqueued this way receive elevated priority so they are processed
   * ahead of background scan jobs.
   *
   * @param {string} artist
   * @param {string} album
   * @returns {Promise<number>} Enqueued job ID
   */
  async upgradeAlbum(artist, album, rgid) {
    const dedupeKey = `upgrade:${artist}|${album}`;
    const jobId = this.jobQueue.enqueue(
      'upgrade',
      { artist, album, rgid: rgid || null },
      { dedupeKey, priority: 10 }
    );
    return jobId;
  }
}

module.exports = QualityUpgrader;
module.exports.QUALITY_RANK = QUALITY_RANK;
