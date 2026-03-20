'use strict';

const childProcess = require('child_process');
const mb = require('./musicbrainz');

/**
 * Read duration (seconds) from an audio file using ffprobe.
 * Returns 0 on failure.
 */
function getFileDuration(filePath) {
  try {
    const raw = childProcess.execFileSync('ffprobe', [
      '-v', 'error', '-show_format', '-of', 'json', filePath
    ]).toString();
    const parsed = JSON.parse(raw);
    return parseFloat(parsed.format?.duration) || 0;
  } catch {
    return 0;
  }
}

/**
 * Greedy closest-match pairing.
 * For each expected track, find the closest unmatched actual duration.
 * Returns array of { expected, actual, delta } pairs.
 */
function pairTracks(expectedTracks, actualDurations) {
  const expectedSecs = expectedTracks.map(t => (t.lengthMs || 0) / 1000);
  const available = actualDurations.map((d, i) => ({ duration: d, idx: i, used: false }));
  const pairs = [];

  for (const exp of expectedSecs) {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < available.length; i++) {
      if (available[i].used) continue;
      const delta = Math.abs(available[i].duration - exp);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      available[bestIdx].used = true;
      pairs.push({ expected: exp, actual: available[bestIdx].duration, delta: bestDelta });
    } else {
      pairs.push({ expected: exp, actual: 0, delta: exp });
    }
  }
  return pairs;
}

/**
 * Compute match score between expected MB tracks and actual file durations.
 * Score: 0.0 = perfect match, 1.0 = no match.
 *
 * @param {Array<{position, title, lengthMs}>} expectedTracks - from MusicBrainz
 * @param {number[]} actualDurations - file durations in seconds
 * @returns {{ score, confidence, trackCount, durationDelta, details }}
 */
function computeScore(expectedTracks, actualDurations) {
  const expectedCount = expectedTracks.length;
  const actualCount = actualDurations.length;

  // Track count score (weight 0.3)
  let trackCountScore;
  const countDiff = Math.abs(expectedCount - actualCount);
  if (countDiff === 0) trackCountScore = 0;
  else if (countDiff === 1) trackCountScore = 0.5;
  else trackCountScore = 1.0;

  // Duration match score (weight 0.5) — greedy closest-match pairing
  const pairs = pairTracks(expectedTracks, actualDurations);
  let durationScoreSum = 0;
  for (const pair of pairs) {
    const delta = pair.delta;
    if (delta <= 10) durationScoreSum += 0;
    else if (delta <= 30) durationScoreSum += (delta - 10) / 20;
    else durationScoreSum += 1.0;
  }
  const durationScore = pairs.length > 0 ? durationScoreSum / pairs.length : 1.0;

  // Total duration score (weight 0.2)
  // Compare totals only over paired tracks so count mismatches don't inflate this penalty.
  const expectedTotal = pairs.reduce((s, p) => s + p.expected, 0);
  const actualTotal = pairs.reduce((s, p) => s + p.actual, 0);
  const totalDelta = Math.abs(expectedTotal - actualTotal);
  let totalDurationScore;
  if (totalDelta <= 30) totalDurationScore = 0;
  else if (totalDelta <= 120) totalDurationScore = (totalDelta - 30) / 90;
  else totalDurationScore = 1.0;

  const score = 0.3 * trackCountScore + 0.5 * durationScore + 0.2 * totalDurationScore;
  const avgPerTrackDelta = pairs.length > 0 ? pairs.reduce((s, p) => s + p.delta, 0) / pairs.length : 0;

  let confidence;
  if (score < 0.15) confidence = 'high';
  else if (score < 0.40) confidence = 'medium';
  else confidence = 'low';

  return {
    score: +score.toFixed(3),
    confidence,
    trackCount: { expected: expectedCount, actual: actualCount },
    durationDelta: { avgPerTrack: +avgPerTrackDelta.toFixed(1), total: +totalDelta.toFixed(1) },
    details: `${actualCount}/${expectedCount} tracks, avg delta ${avgPerTrackDelta.toFixed(1)}s`,
  };
}

/**
 * Validate downloaded files against MusicBrainz release data.
 *
 * @param {object} opts
 * @param {string[]} opts.files - paths to downloaded audio files
 * @param {string} [opts.mbid] - MusicBrainz release ID
 * @param {string} [opts.rgid] - MusicBrainz release-group ID
 * @param {string} [opts.artist] - for search fallback
 * @param {string} [opts.album] - for search fallback
 * @param {number} [opts.existingTrackCount] - library track count for fallback
 * @returns {Promise<{ score, confidence, trackCount, durationDelta, details }>}
 */
async function validate({ files, mbid, rgid, artist, album, existingTrackCount }) {
  const actualDurations = files.map(f => getFileDuration(f));

  // Try to get MB track data
  let mbTracks = null;
  try {
    if (mbid) {
      mbTracks = await mb.getReleaseTracks(mbid);
    } else if (rgid) {
      // Release-group ID: search for releases in this group, pick best
      const releases = await mb.searchReleases(`rgid:${rgid}`);
      if (releases.length > 0) {
        mbTracks = await mb.getReleaseTracks(releases[0].mbid);
      }
    }
    if (!mbTracks && artist && album) {
      const releases = await mb.searchReleases(`${artist} ${album}`);
      if (releases.length > 0) {
        mbTracks = await mb.getReleaseTracks(releases[0].mbid);
      }
    }
  } catch {
    mbTracks = null;
  }

  if (mbTracks && mbTracks.length > 0) {
    return computeScore(mbTracks, actualDurations);
  }

  // Fallback: no MB data available
  const totalDuration = actualDurations.reduce((s, d) => s + d, 0);
  const totalMinutes = totalDuration / 60;

  if (existingTrackCount != null) {
    // Compare against existing library
    const countDiff = Math.abs(files.length - existingTrackCount);
    if (countDiff <= 2) {
      return {
        score: 0.20,
        confidence: 'medium',
        trackCount: { expected: existingTrackCount, actual: files.length },
        durationDelta: { avgPerTrack: 0, total: 0 },
        details: `fallback: ${files.length} files vs ${existingTrackCount} existing (±${countDiff})`,
      };
    }
    return {
      score: 0.60,
      confidence: 'low',
      trackCount: { expected: existingTrackCount, actual: files.length },
      durationDelta: { avgPerTrack: 0, total: 0 },
      details: `fallback: ${files.length} files vs ${existingTrackCount} existing — count mismatch`,
    };
  }

  // New album, no existing — check file count + duration range
  if (files.length >= 4 && totalMinutes >= 15 && totalMinutes <= 150) {
    return {
      score: 0.25,
      confidence: 'medium',
      trackCount: { expected: 0, actual: files.length },
      durationDelta: { avgPerTrack: 0, total: 0 },
      details: `fallback: new album, ${files.length} files, ${totalMinutes.toFixed(0)}min total`,
    };
  }

  return {
    score: 0.60,
    confidence: 'low',
    trackCount: { expected: 0, actual: files.length },
    durationDelta: { avgPerTrack: 0, total: 0 },
    details: `fallback: rejected — ${files.length} files, ${totalMinutes.toFixed(0)}min total (outside 15-150min range)`,
  };
}

module.exports = { validate, computeScore, _test: { getFileDuration, pairTracks } };
