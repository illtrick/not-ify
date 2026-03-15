const { searchReleases } = require('/app/server/src/services/musicbrainz.js');
const albums = [
  ['Animal Collective', 'Merriweather Post Pavilion'],
  ['Dirty Projectors', 'Bitte Orca'],
  ['The xx', 'xx'],
  ['Flaming Lips', 'Embryonic'],
  ['Grizzly Bear', 'Veckatimest'],
  ['Bat for Lashes', 'Two Suns'],
  ['Phoenix', 'Wolfgang Amadeus Phoenix'],
  ['Fever Ray', 'Fever Ray'],
  ['Yeah Yeah Yeahs', 'Its Blitz'],
  ['St. Vincent', 'Actor'],
  ['Neon Indian', 'Psychic Chasms'],
  ['Japandroids', 'Post-Nothing'],
  ['Neko Case', 'Middle Cyclone'],
  ['Bill Callahan', 'Sometimes I Wish We Were an Eagle'],
  ['Bon Iver', 'Blood Bank'],
  ['Yo La Tengo', 'Popular Songs'],
  ['Passion Pit', 'Manners'],
  ['Dinosaur Jr', 'Farm'],
  ['The Antlers', 'Hospice'],
  ['Baroness', 'Blue Record'],
  ['Mountain Goats', 'The Life of the World to Come'],
  ['Dan Deacon', 'Bromst'],
  ['Raekwon', 'Only Built 4 Cuban Linx'],
  ['Girls', 'Album'],
  ['Sunn O', 'Monoliths and Dimensions'],
];

async function checkCaa(id, type) {
  const url = type === 'rg'
    ? 'https://coverartarchive.org/release-group/' + id + '/front-250'
    : 'https://coverartarchive.org/release/' + id + '/front-250';
  try {
    const r = await fetch(url, { headers: {'User-Agent': 'Notify/0.1.0'}, signal: AbortSignal.timeout(5000) });
    return r.ok || r.status === 307;
  } catch(e) { return false; }
}

async function run() {
  let mbMatch = 0, hasArt = 0, total = albums.length;
  for (const pair of albums) {
    const artist = pair[0], album = pair[1];
    const q = artist + ' ' + album;
    const results = await searchReleases(q);
    const hit = results.find(function(r) {
      const na = (r.artist||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const nb = (r.album||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const qa = artist.toLowerCase().replace(/[^a-z0-9]/g,'');
      const qb = album.toLowerCase().replace(/[^a-z0-9]/g,'');
      return (na.includes(qa) || qa.includes(na)) && (nb.includes(qb) || qb.includes(nb));
    });
    if (!hit) { console.log('no MB: ' + artist + ' - ' + album); continue; }
    mbMatch++;
    const rgArt = await checkCaa(hit.rgid, 'rg');
    const mbArt = (!rgArt && hit.mbid) ? await checkCaa(hit.mbid, 'release') : false;
    const art = rgArt || mbArt;
    if (art) { hasArt++; process.stdout.write('*'); }
    else { process.stdout.write('_'); console.log(' no art: ' + artist + ' - ' + album); }
  }
  console.log('\nMB matched: ' + mbMatch + '/' + total + ' (' + Math.round(mbMatch/total*100) + '%)');
  console.log('Cover art:  ' + hasArt + '/' + total + ' (' + Math.round(hasArt/total*100) + '%)');
}
run().catch(function(e) { console.error(e.message); });
