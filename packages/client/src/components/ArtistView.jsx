import React from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { AlbumCard } from './AlbumCard';

export function ArtistView({
  selectedArtist,
  artistDetails,
  artistBio,
  artistTopTracks,
  artistReleases,
  isMobile,
  isPlaying,
  currentTrack,
  currentAlbumInfo,
  ytSearching, ytPendingTrack,
  isInLibrary,
  prevViewRef,
  setView,
  openAlbumFromSearch,
  openArtistPage,
  playFromYouTube,
}) {
  if (!selectedArtist) return null;
  const { mbid, name, type } = selectedArtist;
  const imageUrl = `/api/artist/image?name=${encodeURIComponent(name)}`;
  const det = artistDetails;
  const typeLabel = det?.type === 'Group' ? 'Band' : det?.type === 'Person' ? 'Artist' : type === 'Group' ? 'Band' : 'Artist';

  // Build info line parts
  const infoParts = [];
  if (det?.area) infoParts.push(det.area);
  else if (det?.country) infoParts.push(det.country);
  if (det?.activeYears?.begin) {
    const beginYear = det.activeYears.begin.slice(0, 4);
    infoParts.push(det.activeYears.ended && det.activeYears.end
      ? `${beginYear}–${det.activeYears.end.slice(0, 4)}`
      : `Active since ${beginYear}`);
  }
  const activeMembers = det?.members?.filter(m => m.active) || [];
  if (activeMembers.length > 0) infoParts.push(`${activeMembers.length} member${activeMembers.length > 1 ? 's' : ''}`);

  // Categorize links for display
  const linkItems = [];
  if (det?.links?.wikipedia) linkItems.push({ label: 'Wikipedia', url: det.links.wikipedia });
  else if (det?.links?.wikidata) linkItems.push({ label: 'Wikipedia', url: det.links.wikidata });
  if (det?.links?.official) linkItems.push({ label: 'Official Site', url: det.links.official });
  if (det?.links?.bandcamp) linkItems.push({ label: 'Bandcamp', url: det.links.bandcamp });
  if (det?.links?.youtube) linkItems.push({ label: 'YouTube', url: det.links.youtube });
  for (const s of (det?.links?.social || []).slice(0, 4)) {
    const domain = (() => { try { return new URL(s).hostname.replace('www.', ''); } catch { return null; } })();
    if (!domain) continue;
    // Skip defunct services
    if (domain.includes('plus.google') || domain.includes('myspace.com')) continue;
    const label = domain.includes('instagram') ? 'Instagram' : domain.includes('twitter') || domain.includes('x.com') ? 'X' : domain.includes('facebook') ? 'Facebook' : domain.includes('tiktok') ? 'TikTok' : domain.includes('soundcloud') ? 'SoundCloud' : domain.split('.')[0];
    linkItems.push({ label, url: s });
  }

  return (
    <div>
      {/* Artist header */}
      <div style={{ margin: isMobile ? '-12px -12px 0' : '-28px -28px 0', padding: isMobile ? '12px 12px 20px' : '40px 28px 32px', background: `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`, display: 'flex', alignItems: 'flex-end', gap: isMobile ? 14 : 24 }}>
        <button
          onClick={() => setView(prevViewRef.current === 'artist' ? 'search' : (prevViewRef.current || 'search'))}
          style={{ position: 'absolute', top: isMobile ? 8 : 20, left: isMobile ? 12 : 28, background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {Icon.back(16, 'rgba(255,255,255,0.7)')} Back
        </button>
        <img
          src={imageUrl}
          alt={name}
          style={{ width: isMobile ? 100 : 200, height: isMobile ? 100 : 200, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', flexShrink: 0 }}
          onError={e => { e.target.style.display = 'none'; }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{typeLabel}</div>
          <h1 style={{ fontSize: isMobile ? 24 : 48, fontWeight: 800, color: COLORS.textPrimary, margin: 0, lineHeight: 1.1 }}>{name}</h1>
          {infoParts.length > 0 && (
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6 }}>
              {infoParts.join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* Genre tags */}
      {det?.genres?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
          {det.genres.map(g => (
            <span key={g} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: COLORS.surface, color: COLORS.textSecondary, border: `1px solid ${COLORS.hover}` }}>{g}</span>
          ))}
        </div>
      )}

      {/* Top Songs (from Last.fm) */}
      {artistTopTracks.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 4 }}>Top Songs</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {artistTopTracks.map((t, i) => {
              const isPending = ytPendingTrack === t.name;
              const isActive = currentTrack && currentTrack.title === t.name && currentAlbumInfo?.artist?.toLowerCase() === name.toLowerCase();
              const highlight = isPending || isActive;
              return (
                <div
                  key={t.name}
                  onClick={async () => {
                    if (ytSearching) return;
                    // Look up which album this track belongs to
                    let albumName = null, albumCover = artistReleases[0]?.coverArt || null, rgid = null, albumMbid = null;
                    try {
                      const info = await api.getRecordingLookup(name, t.name);
                      if (info) {
                        albumName = info.album || null;
                        rgid = info.rgid || null;
                        albumMbid = info.mbid || null;
                        if (info.coverArt) albumCover = info.coverArt;
                      }
                    } catch {}
                    playFromYouTube(t.name, name, albumName, albumCover, null, mbid, rgid, albumMbid);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: isActive ? '10px 8px 10px 5px' : '10px 8px',
                    borderRadius: 6, transition: 'background 0.15s, border-color 0.15s',
                    cursor: ytSearching ? 'default' : 'pointer',
                    opacity: (ytSearching && !isPending) ? 0.5 : 1,
                    background: isActive ? `rgba(${COLORS.accentRgb},0.12)` : 'transparent',
                    borderLeft: isActive ? `3px solid ${COLORS.accent}` : '3px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = COLORS.hover; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 20, textAlign: 'right', fontSize: 13, color: highlight ? COLORS.accent : COLORS.textSecondary, flexShrink: 0 }}>
                    {isActive ? '♫' : isPending ? '▶' : i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: highlight ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isActive ? 600 : 400 }}>{t.name}</span>
                  {t.listeners && (
                    <span style={{ fontSize: 12, color: COLORS.textSecondary, flexShrink: 0 }}>
                      {parseInt(t.listeners).toLocaleString()} listeners
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discography */}
      {artistReleases.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 16 }}>Discography</h2>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
            {artistReleases.map(rel => {
              const album = {
                id: `mb:${rel.rgid || rel.mbid}`,
                artist: name,
                album: rel.album,
                year: rel.year || '',
                coverArt: rel.coverArt,
                mbid: rel.mbid,
                rgid: rel.rgid,
                trackCount: rel.trackCount,
                sources: [],
              };
              return (
                <AlbumCard
                  key={album.id}
                  album={album}
                  isDownloading={false}
                  inLibrary={isInLibrary(name, rel.album)}
                  onPlay={() => openAlbumFromSearch(album)}
                  onClick={() => openAlbumFromSearch(album)}
                />
              );
            })}
          </div>
        </div>
      )}

      {artistReleases.length === 0 && (
        <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 60, fontSize: 15 }}>
          Loading discography...
        </div>
      )}

      {/* Band members */}
      {det?.type === 'Group' && det?.members?.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 8 }}>Members</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 14 }}>
            {det.members.map((m, i) => (
              <span key={m.mbid || m.name}>
                <span
                  style={{ color: m.active ? COLORS.textPrimary : COLORS.textSecondary, cursor: m.mbid ? 'pointer' : 'default', opacity: m.active ? 1 : 0.6 }}
                  onClick={() => { if (m.mbid) openArtistPage(m.mbid, m.name); }}
                  onMouseEnter={e => { if (m.mbid) e.target.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.target.style.textDecoration = 'none'; }}
                >
                  {m.name}
                </span>
                {i < det.members.length - 1 && <span style={{ color: COLORS.textSecondary }}>{' · '}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* External links */}
      {linkItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 24, paddingBottom: 4 }}>
          {linkItems.map(l => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: COLORS.textSecondary, textDecoration: 'none', padding: '4px 0', borderBottom: '1px solid transparent', transition: 'color 0.15s, border-color 0.15s' }}
              onMouseEnter={e => { e.target.style.color = COLORS.textPrimary; e.target.style.borderBottomColor = COLORS.textPrimary; }}
              onMouseLeave={e => { e.target.style.color = COLORS.textSecondary; e.target.style.borderBottomColor = 'transparent'; }}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}

      {/* About / Wikipedia bio — shown at the bottom */}
      {artistBio?.extract && (
        <div style={{ marginTop: 32, paddingTop: 32, borderTop: `1px solid ${COLORS.hover}` }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 12 }}>About</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: COLORS.textSecondary, margin: 0, maxWidth: 700 }}>
            {artistBio.extract.length > 600 ? artistBio.extract.slice(0, 600).replace(/\s\S*$/, '') + '...' : artistBio.extract}
          </p>
          {(det?.links?.wikipedia || det?.links?.wikidata) && (
            <a
              href={det.links.wikipedia || `https://en.wikipedia.org/wiki/${name.replace(/\s/g, '_')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: COLORS.accent, textDecoration: 'none', marginTop: 10, display: 'inline-block' }}
            >
              Read more on Wikipedia &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
