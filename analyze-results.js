const fs = require('fs');
const results = JSON.parse(fs.readFileSync('findability-results.json', 'utf8'));

console.log('=== DEEP ANALYSIS OF FINDABILITY RESULTS ===\n');

// 1. Torrent-found albums: what do they have in common?
const torrentFound = results.filter(r => r.torrentMatch);
const ytOnly = results.filter(r => r.ytFallback && !r.torrentMatch);

console.log('--- TORRENT-FOUND (14/80) ---');
for (const r of torrentFound) {
  console.log(`  [${r.bestQuality}] ${r.bestSeeders}s | ${r.artist} - ${r.album} (${r.minutesPlayed}min)`);
}

console.log('\n--- PATTERN ANALYSIS ---');

// Genre/category patterns in YT-only
const categories = {
  gameOST: [],
  filmOST: [],
  neoClassical: [],
  niche_indie: [],
  polish: [],
  ambient: [],
  mainstream: [],
  other: [],
};

const ostKeywords = ['soundtrack', 'original', 'ost', 'score', 'motion picture', 'game', 'series'];
const classicalKeywords = ['piano', 'concerto', 'symphony', 'quartet'];
const ambientKeywords = ['ambient', 'drone', 'meditat', 'healing', 'soundscape'];

for (const r of ytOnly) {
  const fullName = (r.artist + ' ' + r.album).toLowerCase();
  if (ostKeywords.some(k => fullName.includes(k))) {
    if (fullName.includes('game') || fullName.includes('stardew') || fullName.includes('fez') ||
        fullName.includes('spiritfarer') || fullName.includes('manifold') || fullName.includes('twodots') ||
        fullName.includes('samorost') || fullName.includes('machinarium')) {
      categories.gameOST.push(r);
    } else {
      categories.filmOST.push(r);
    }
  } else if (classicalKeywords.some(k => fullName.includes(k)) ||
             ['hania rani', 'nils frahm', 'bersarin quartett', 'federico albanese', 'eydís evensen',
              'dobrawa czocher', 'erland cooper'].some(a => fullName.includes(a))) {
    categories.neoClassical.push(r);
  } else if (ambientKeywords.some(k => fullName.includes(k)) ||
             ['green-house', 'takashi kokubo', 'brian eno'].some(a => fullName.includes(a))) {
    categories.ambient.push(r);
  } else if (['wojtek', 'grzegorz', 'petr'].some(a => fullName.includes(a))) {
    categories.polish.push(r);
  } else {
    // Check if obscure based on MB results
    if (r.mbAlbumCount === 0 && r.mbArtistCount === 0) {
      categories.niche_indie.push(r);
    } else {
      categories.other.push(r);
    }
  }
}

console.log('\nYT-Only albums by category:');
for (const [cat, items] of Object.entries(categories)) {
  if (items.length > 0) {
    console.log(`\n  ${cat} (${items.length}):`);
    for (const r of items) {
      console.log(`    ${r.artist} - ${r.album} (${r.mbAlbumCount} MB albums, ${r.mbArtistCount} MB artists)`);
    }
  }
}

// 2. MB coverage: how many had MB results at all?
console.log('\n--- MB SEARCH COVERAGE ---');
const withMbAlbums = results.filter(r => r.mbAlbumCount > 0);
const withMbArtists = results.filter(r => r.mbArtistCount > 0);
const noMbAtAll = results.filter(r => r.mbAlbumCount === 0 && r.mbArtistCount === 0);
console.log(`Albums with MB album results: ${withMbAlbums.length}/80 (${Math.round(withMbAlbums.length/80*100)}%)`);
console.log(`Albums with MB artist results: ${withMbArtists.length}/80 (${Math.round(withMbArtists.length/80*100)}%)`);
console.log(`Albums with NO MB data at all: ${noMbAtAll.length}/80`);
if (noMbAtAll.length > 0) {
  console.log('  These albums:');
  for (const r of noMbAtAll) {
    console.log(`    ${r.artist} - ${r.album}`);
  }
}

// 3. Torrent gap: albums that DO have MB metadata but no torrent
const mbButNoTorrent = results.filter(r => r.mbAlbumCount > 0 && !r.torrentMatch);
console.log(`\nMB data but no torrent: ${mbButNoTorrent.length}/80`);
console.log('  (These could potentially be found with better torrent sources or different search strategies)');

// 4. Key insight: search query effectiveness
console.log('\n--- SEARCH QUERY EFFECTIVENESS ---');
console.log('Current strategy: concatenates "artist album" as a single query to ApiBay');
console.log('Problem categories:');
console.log(`  1. Long/complex album names (subtitles, editions): ${results.filter(r => r.album.length > 40 && !r.torrentMatch).length} failures`);
console.log(`  2. Game/Film OST (niche, rarely on TPB): ${categories.gameOST.length + categories.filmOST.length} failures`);
console.log(`  3. Neo-classical/ambient (small genre on TPB): ${categories.neoClassical.length + categories.ambient.length} failures`);
console.log(`  4. Non-English characters in name: ${results.filter(r => /[^\x00-\x7F]/.test(r.artist + r.album) && !r.torrentMatch).length} failures`);

// 5. What would help?
console.log('\n--- IMPROVEMENT OPPORTUNITIES ---');
const totalYtOnly = ytOnly.length;
console.log(`Total falling back to YT: ${totalYtOnly}/80 (${Math.round(totalYtOnly/80*100)}%)`);
console.log(`If YT-audio download works well, effective coverage is: ${torrentFound.length + totalYtOnly}/80 = ${Math.round((torrentFound.length + totalYtOnly)/80*100)}%`);
console.log(`But YT downloads are: single-track, compressed (opus/m4a), no album structure`);
console.log(`True "album-quality with metadata" coverage: ${torrentFound.length}/80 = ${Math.round(torrentFound.length/80*100)}%`);
