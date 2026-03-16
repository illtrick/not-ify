/**
 * Pull Last.fm data: recent tracks, top artists, top albums.
 * Compare with Spotify history to see overlap.
 */
const fs = require('fs');
const BASE = 'http://localhost:3000';

async function main() {
  // 1. Check Last.fm status
  const status = await fetch(`${BASE}/api/lastfm/status`).then(r => r.json());
  console.log('Last.fm status:', JSON.stringify(status));

  if (!status.authenticated) {
    console.log('Last.fm not authenticated — skipping');
    return;
  }

  // 2. Recent tracks (max 200)
  const recent = await fetch(`${BASE}/api/lastfm/recent?limit=200`).then(r => r.json());
  console.log('\nRecent tracks:', recent.length);
  if (recent.length > 0) {
    console.log('Sample:', recent.slice(0, 5).map(t => `${t.artist} - ${t.name}`).join('\n  '));
  }

  // 3. Top artists (3 months)
  const topArtists = await fetch(`${BASE}/api/lastfm/top/artists?period=3month&limit=50`).then(r => r.json());
  console.log('\nTop artists (3mo):', topArtists.length);
  for (const a of topArtists.slice(0, 20)) {
    console.log(`  ${a.playcount}x ${a.name}`);
  }

  // 4. Top albums (3 months)
  const topAlbums = await fetch(`${BASE}/api/lastfm/top/albums?period=3month&limit=50`).then(r => r.json());
  console.log('\nTop albums (3mo):', topAlbums.length);
  for (const a of topAlbums.slice(0, 20)) {
    console.log(`  ${a.playcount}x ${a.artist} - ${a.name}`);
  }

  // 5. Cross-reference with Spotify catalogue
  const catalogue = JSON.parse(fs.readFileSync('listening-catalogue.json', 'utf8'));
  const spotifyArtists = new Set(catalogue.map(c => c.artist.toLowerCase()));

  const lastfmOnlyArtists = topArtists.filter(a => !spotifyArtists.has(a.name.toLowerCase()));
  console.log('\nLast.fm top artists NOT in Spotify 120-day history:', lastfmOnlyArtists.length);
  for (const a of lastfmOnlyArtists.slice(0, 10)) {
    console.log(`  ${a.name} (${a.playcount} plays)`);
  }

  // Write for analysis
  fs.writeFileSync('lastfm-data.json', JSON.stringify({
    recentCount: recent.length,
    topArtists: topArtists.slice(0, 50),
    topAlbums: topAlbums.slice(0, 50),
  }, null, 2));
  console.log('\nWrote lastfm-data.json');
}

main().catch(console.error);
