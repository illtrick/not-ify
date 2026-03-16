/**
 * Test the not-ify search API against the Spotify listening history.
 * Samples albums across different listening tiers (heavy, moderate, light)
 * and tests: MusicBrainz match, torrent availability, YouTube fallback.
 */
const fs = require('fs');

const catalogue = JSON.parse(fs.readFileSync('listening-catalogue.json', 'utf8'));
const BASE = 'http://localhost:3000';

// Sample strategy: top 30 + 30 random from middle + 20 from tail = 80 albums
const top30 = catalogue.slice(0, 30);
const middle = catalogue.slice(30, Math.floor(catalogue.length / 2));
const tail = catalogue.slice(Math.floor(catalogue.length / 2));

function sampleRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const sample = [
  ...top30,
  ...sampleRandom(middle, 30),
  ...sampleRandom(tail, 20),
];

async function testAlbum(entry) {
  const query = `${entry.artist} ${entry.album}`;
  const result = {
    artist: entry.artist,
    album: entry.album,
    minutesPlayed: entry.minutesPlayed,
    trackCount: entry.trackCount,
    // Search results
    searchOk: false,
    mbMatch: false,
    torrentMatch: false,
    ytFallback: false,
    bestQuality: null,
    bestSeeders: 0,
    mbAlbumCount: 0,
    mbArtistCount: 0,
    streamingCount: 0,
    error: null,
  };

  try {
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }
    const body = await res.json();
    result.searchOk = true;

    // Check MB-matched albums
    const albums = body.albums || [];
    result.mbAlbumCount = albums.length;
    result.mbArtistCount = (body.artists || []).length;
    result.streamingCount = (body.streamingResults || []).length;

    // Check if any album matches our target
    const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetArtist = normalise(entry.artist);
    const targetAlbum = normalise(entry.album);

    for (const a of albums) {
      const aArtist = normalise(a.artist || '');
      const aAlbum = normalise(a.album || '');
      const artistMatch = aArtist.includes(targetArtist) || targetArtist.includes(aArtist);
      const albumMatch = aAlbum.includes(targetAlbum) || targetAlbum.includes(aAlbum);
      if (artistMatch && albumMatch) {
        result.mbMatch = !!a.mbid || !!a.rgid;
        if (a.sources && a.sources.length > 0) {
          result.torrentMatch = true;
          result.bestQuality = a.sources[0].quality || 'unknown';
          result.bestSeeders = a.sources[0].seeders || 0;
        }
        break;
      }
    }

    // Check mbAlbums (Phase 2: always-present MB-only albums)
    const mbOnlyAlbums = body.mbAlbums || [];
    result.mbOnlyCount = mbOnlyAlbums.length;
    if (!result.mbMatch && !result.torrentMatch) {
      for (const a of mbOnlyAlbums) {
        const aArtist = normalise(a.artist || '');
        const aAlbum = normalise(a.album || '');
        const artistMatch = aArtist.includes(targetArtist) || targetArtist.includes(aArtist);
        const albumMatch = aAlbum.includes(targetAlbum) || targetAlbum.includes(aAlbum);
        if (artistMatch && albumMatch) {
          result.mbMatch = true;
          result.mbOnlyMatch = true;
          break;
        }
      }
    }

    // Check streaming fallback
    if (!result.torrentMatch && !result.mbMatch && result.streamingCount > 0) {
      result.ytFallback = true;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function main() {
  console.log(`Testing ${sample.length} albums against not-ify search API...`);
  console.log('(This will take a while due to rate limiting)\n');

  const results = [];
  for (let i = 0; i < sample.length; i++) {
    const entry = sample[i];
    process.stdout.write(`[${i+1}/${sample.length}] ${entry.artist} - ${entry.album}... `);
    const r = await testAlbum(entry);
    results.push(r);

    if (r.error) {
      console.log(`ERROR: ${r.error}`);
    } else if (r.torrentMatch) {
      console.log(`TORRENT [${r.bestQuality}] ${r.bestSeeders}s`);
    } else if (r.mbMatch) {
      console.log('MB-ONLY (no torrent sources)');
    } else if (r.ytFallback) {
      console.log(`YT-FALLBACK (${r.streamingCount} results)`);
    } else {
      console.log(`NOT FOUND (${r.mbAlbumCount} albums, ${r.mbArtistCount} artists)`);
    }

    // Rate limit: 1 req/sec for MusicBrainz
    await new Promise(r => setTimeout(r, 1500));
  }

  // Summarise
  const total = results.length;
  const torrentFound = results.filter(r => r.torrentMatch).length;
  const mbOnly = results.filter(r => r.mbMatch && !r.torrentMatch).length;
  const ytOnly = results.filter(r => r.ytFallback && !r.torrentMatch && !r.mbMatch).length;
  const notFound = results.filter(r => !r.torrentMatch && !r.mbMatch && !r.ytFallback).length;
  const errors = results.filter(r => r.error).length;

  console.log('\n========================================');
  console.log('RESULTS SUMMARY');
  console.log('========================================');
  console.log(`Total tested:     ${total}`);
  console.log(`Torrent found:    ${torrentFound} (${Math.round(torrentFound/total*100)}%)`);
  console.log(`MB-only (no DL):  ${mbOnly} (${Math.round(mbOnly/total*100)}%)`);
  console.log(`YT fallback only: ${ytOnly} (${Math.round(ytOnly/total*100)}%)`);
  console.log(`Not found at all: ${notFound} (${Math.round(notFound/total*100)}%)`);
  console.log(`Errors:           ${errors}`);

  // Quality breakdown
  const qualities = {};
  for (const r of results.filter(r => r.torrentMatch)) {
    const q = r.bestQuality || 'unknown';
    qualities[q] = (qualities[q] || 0) + 1;
  }
  console.log('\nQuality breakdown (torrent matches):');
  for (const [q, n] of Object.entries(qualities).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${q}: ${n}`);
  }

  // Categories of failures
  console.log('\nNOT FOUND albums (for analysis):');
  for (const r of results.filter(r => !r.torrentMatch && !r.mbMatch && !r.ytFallback && !r.error)) {
    console.log(`  ${r.artist} - ${r.album} (${r.minutesPlayed}min, ${r.mbAlbumCount} MB albums returned)`);
  }

  console.log('\nMB-ONLY albums (metadata found, no download):');
  for (const r of results.filter(r => r.mbMatch && !r.torrentMatch)) {
    console.log(`  ${r.artist} - ${r.album} (${r.minutesPlayed}min)`);
  }

  // Write full results
  fs.writeFileSync('findability-results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results written to findability-results.json');
}

main().catch(console.error);
