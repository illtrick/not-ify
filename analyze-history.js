const fs = require('fs');
const data = JSON.parse(fs.readFileSync('Spotify Extended Streaming History/Streaming_History_Audio_2025-2026_5.json', 'utf8'));
const cutoff = new Date('2025-11-15T00:00:00Z').getTime();
const recent = data.filter(r => new Date(r.ts).getTime() >= cutoff && r.ms_played > 30000 && r.master_metadata_track_name);
console.log('Total records in file:', data.length);
console.log('Records after cutoff (>30s played):', recent.length);

// Also check the 2024-2025 file for Nov/Dec 2025 data
let data2 = [];
try {
  data2 = JSON.parse(fs.readFileSync('Spotify Extended Streaming History/Streaming_History_Audio_2024-2025_4.json', 'utf8'));
  const recent2 = data2.filter(r => new Date(r.ts).getTime() >= cutoff && r.ms_played > 30000 && r.master_metadata_track_name);
  console.log('Additional records from 2024-2025 file:', recent2.length);
  recent.push(...recent2);
} catch(e) {}

console.log('Total recent records:', recent.length);

// Unique artists & albums
const artists = new Set();
const albums = new Map();
for (const r of recent) {
  const artist = r.master_metadata_album_artist_name || '';
  const album = r.master_metadata_album_album_name || '';
  const track = r.master_metadata_track_name || '';
  if (!artist || !album) continue;
  artists.add(artist);
  const key = artist + '::' + album;
  if (!albums.has(key)) albums.set(key, { artist, album, tracks: new Set(), totalMs: 0 });
  const entry = albums.get(key);
  entry.tracks.add(track);
  entry.totalMs += r.ms_played;
}

console.log('Unique artists:', artists.size);
console.log('Unique albums:', albums.size);
console.log('---');
const sorted = [...albums.values()].sort((a,b) => b.totalMs - a.totalMs);
console.log('Top 50 albums by listening time:');
for (const a of sorted.slice(0, 50)) {
  console.log(Math.round(a.totalMs/60000) + 'min | ' + a.tracks.size + 'trk | ' + a.artist + ' - ' + a.album);
}
console.log('---');
// Write full list as JSON for the test script
fs.writeFileSync('listening-catalogue.json', JSON.stringify(sorted.map(a => ({
  artist: a.artist, album: a.album, trackCount: a.tracks.size, minutesPlayed: Math.round(a.totalMs/60000)
})), null, 2));
console.log('Wrote listening-catalogue.json (' + sorted.length + ' albums)');
