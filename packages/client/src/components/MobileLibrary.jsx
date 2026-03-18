import React from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { contextMenuProps } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';

export function MobileLibrary({
  sidebarAlbums,
  recentlyPlayed,
  libraryAlbums,
  libraryFilter, setLibraryFilter,
  showLibraryFilter, setShowLibraryFilter,
  librarySortBy, setLibrarySortBy,
  currentAlbumInfo,
  isMobile,
  setShowSettings,
  openAlbumFromLibrary,
  openAlbumFromSearch,
  openArtistPage,
  handleSearch,
  playTrack,
  addToQueue,
  showContextMenu,
  removeAlbumFromLibrary,
}) {
  const albums = sidebarAlbums();
  return (
    <div style={{ padding: 12 }}>
      {/* Recently Played — horizontal scroll */}
      {recentlyPlayed.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Recently Played</div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {recentlyPlayed.slice(0, 8).map((r, i) => (
              <div key={`mrp-${i}`} style={{ flexShrink: 0, width: 100, cursor: 'pointer' }}
                onClick={() => {
                  const libMatch = libraryAlbums().find(la =>
                    la.artist.toLowerCase() === r.artist.toLowerCase() &&
                    la.album.toLowerCase() === r.album.toLowerCase()
                  );
                  if (libMatch) openAlbumFromLibrary(libMatch.artist, libMatch.album, libMatch.tracks, libMatch.coverArt, libMatch.mbid);
                  else handleSearch(null, `${r.artist} ${r.album}`);
                }}>
                <AlbumArt src={r.coverArt} size={100} radius={6} artist={r.artist} album={r.album} />
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textPrimary, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.album}</div>
                <div style={{ fontSize: 10, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.artist}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: COLORS.textPrimary }}>Your Library</span>
          {albums.length > 0 && (
            <span style={{ fontSize: 12, color: COLORS.textSecondary, background: COLORS.hover, borderRadius: 10, padding: '2px 8px' }}>{albums.length}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setShowLibraryFilter(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
            {Icon.search(16, showLibraryFilter ? COLORS.accent : COLORS.textSecondary)}
          </button>
          <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
            {Icon.gear(16, COLORS.textSecondary)}
          </button>
        </div>
      </div>

      {/* Filter */}
      {showLibraryFilter && (
        <input type="text" placeholder="Filter albums..." value={libraryFilter} onChange={e => setLibraryFilter(e.target.value)} autoFocus
          style={{ width: '100%', padding: '8px 12px', marginBottom: 10, background: COLORS.hover, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
      )}

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[{ key: 'recents', label: 'Recents' }, { key: 'alpha', label: 'A-Z' }, { key: 'artist', label: 'Artist' }].map(s => (
          <button key={s.key} onClick={() => setLibrarySortBy(s.key)}
            style={{ padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: librarySortBy === s.key ? COLORS.textPrimary : COLORS.hover,
              color: librarySortBy === s.key ? COLORS.bg : COLORS.textSecondary }} >
            {s.label}
          </button>
        ))}
      </div>

      {/* Album list */}
      {albums.length === 0 ? (
        <div style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 14, padding: '32px 12px' }}>
          {libraryFilter ? 'No matches' : 'No music yet. Search and add some!'}
        </div>
      ) : albums.map(({ artist, album, tracks, coverArt, mbid }) => {
        const isPlaying_ = currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
        return (
          <div key={`${artist}::${album}`}
            onClick={() => { openAlbumFromLibrary(artist, album, tracks, coverArt, mbid); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', minHeight: 56 }}
            {...contextMenuProps(e => showContextMenu(e, [
              { label: 'Play', action: () => playTrack(tracks[0], tracks, 0, { artist, album, coverArt }) },
              { label: 'Add to Queue', action: () => tracks.forEach(t => addToQueue(t)) },
              { label: 'Go to Artist', action: async () => {
                try { const data = await api.search(artist);
                  const a = data.artists?.find(x => x.name.toLowerCase() === artist.toLowerCase()) || data.artists?.[0];
                  if (a?.mbid) openArtistPage(a.mbid, a.name, a.type); } catch {} }},
              { divider: true },
              { label: 'Remove from Library', danger: true, action: () => removeAlbumFromLibrary(artist, album) },
            ]))}
          >
            <AlbumArt src={coverArt} size={52} radius={4} artist={artist} album={album} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isPlaying_ ? COLORS.accent : COLORS.textPrimary }}>{album}</div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{artist}</div>
            </div>
            {isPlaying_ && <span style={{ flexShrink: 0 }}>{Icon.volumeHigh(16, COLORS.accent)}</span>}
          </div>
        );
      })}
    </div>
  );
}
