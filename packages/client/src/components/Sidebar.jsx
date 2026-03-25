import React from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { contextMenuProps } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';
import { BgDownloadIndicator } from './BgDownloadIndicator';
import { DownloadIndicator } from './DownloadIndicator';

export function Sidebar({
  view, setView,
  showSettings, setShowSettings,
  currentUser, switchUser, serverVersion,
  recentlyPlayed,
  currentAlbumInfo,
  libraryAlbums,
  sidebarAlbums,
  albumCount,
  libraryFilter, setLibraryFilter,
  showLibraryFilter, setShowLibraryFilter,
  librarySortBy, setLibrarySortBy,
  openAlbumFromLibrary,
  openAlbumFromSearch,
  openRecentlyPlayed,
  openArtistPage,
  handleSearch,
  playTrack,
  addToQueue,
  showContextMenu,
  removeAlbumFromLibrary,
  selectedAlbum,
  bgDownloadStatus, setBgDownloadStatus,
  jobQueueStats,
  onToggleLog,
  downloadStatus, setDownloadStatus,
  downloading,
  dlExpanded, setDlExpanded,
  handleCancel, handleYtCancel,
  loadLibrary,
}) {
  return (
    <aside style={{ width: 300, minWidth: 300, background: COLORS.surface, borderRight: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top nav */}
      <div style={{ padding: '16px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.5px', lineHeight: 1 }}>Not-ify</span>
            {serverVersion && <span style={{ fontSize: 10, fontWeight: 500, color: COLORS.textSecondary, opacity: 0.5, marginTop: 2, letterSpacing: '0.03em' }}>v{serverVersion}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {currentUser && (
              <button onClick={switchUser} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 8px', borderRadius: 12, fontSize: 11, color: COLORS.textSecondary, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4 }}
                onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
                title="Switch user">
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: currentUser === 'nathan' ? '#1DB954' : '#E91E63', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                  {currentUser === 'nathan' ? 'N' : 'S'}
                </span>
                {currentUser === 'nathan' ? 'Nathan' : 'Sarah'}
              </button>
            )}
          <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.6 }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
            title="Settings">
            {Icon.gear(20, COLORS.textSecondary)}
          </button>
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            borderRadius: 20, cursor: 'pointer', fontSize: 14,
            background: view === 'search' ? COLORS.hover : 'transparent',
            color: view === 'search' ? COLORS.textPrimary : COLORS.textSecondary,
            fontWeight: view === 'search' ? 600 : 400,
            transition: 'background 0.15s',
          }}
          onClick={() => setView('search')}
          onMouseEnter={e => { if (view !== 'search') e.currentTarget.style.background = COLORS.hover; }}
          onMouseLeave={e => { if (view !== 'search') e.currentTarget.style.background = 'transparent'; }}
          role="button" tabIndex={0}
        >
          {Icon.search(18, 'currentColor')}
          <span>Search</span>
        </div>
      </div>

      {/* Recently Played section — sticky between Search and Library */}
      {recentlyPlayed.length > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 4, padding: '8px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recently Played</span>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {recentlyPlayed.slice(0, 8).map((r, i) => {
              const isPlaying_ = currentAlbumInfo?.artist === r.artist && currentAlbumInfo?.album === r.album;
              return (
                <div key={`rp-${i}`}
                  onClick={() => {
                    const rArtist = r.artist.toLowerCase();
                    const rAlbum = r.album.toLowerCase();
                    const libMatch = libraryAlbums().find(la => {
                      const lArtist = la.artist.toLowerCase();
                      const lAlbum = la.album.toLowerCase();
                      return lArtist === rArtist && (lAlbum === rAlbum || rAlbum.startsWith(lAlbum) || lAlbum.startsWith(rAlbum));
                    });
                    openRecentlyPlayed(r, libMatch);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 4, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <AlbumArt src={r.coverArt} size={52} radius={4} artist={r.artist} album={r.album} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isPlaying_ ? COLORS.accent : COLORS.textPrimary }}>{r.album}</div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Album · {r.artist}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Library section */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', borderTop: `1px solid ${COLORS.border}`, marginTop: 4 }}>
        <div style={{ padding: '12px 12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: COLORS.textSecondary }}>{Icon.libraryIcon(18, COLORS.textSecondary)}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary }}>Your Library</span>
              {albumCount > 0 && (
                <span style={{ fontSize: 11, color: COLORS.textSecondary, background: COLORS.bg, borderRadius: 10, padding: '1px 6px' }}>{albumCount}</span>
              )}
            </div>
            <button onClick={() => setShowLibraryFilter(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              {Icon.search(14, showLibraryFilter ? COLORS.accent : COLORS.textSecondary)}
            </button>
          </div>
          {showLibraryFilter && (
            <input type="text" placeholder="Filter albums..." value={libraryFilter} onChange={e => setLibraryFilter(e.target.value)} autoFocus
              style={{ width: '100%', padding: '6px 10px', marginBottom: 8, background: COLORS.hover, border: `1px solid ${COLORS.border}`, borderRadius: 4, color: COLORS.textPrimary, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          )}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {[{ key: 'recents', label: 'Recents' }, { key: 'alpha', label: 'A-Z' }, { key: 'artist', label: 'Artist' }].map(s => (
              <button key={s.key} onClick={() => setLibrarySortBy(s.key)}
                style={{ padding: '3px 8px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  background: librarySortBy === s.key ? COLORS.textPrimary : COLORS.hover, color: librarySortBy === s.key ? COLORS.bg : COLORS.textSecondary }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 6px' }}>
          {sidebarAlbums().length === 0 ? (
            <div style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, padding: '24px 12px' }}>
              {libraryFilter ? 'No matches' : 'No music yet. Search and add some!'}
            </div>
          ) : sidebarAlbums().map(({ artist, album, tracks, coverArt, mbid }) => {
            const isActive = view === 'album' && selectedAlbum && !selectedAlbum.fromSearch
              && selectedAlbum.artist === artist && selectedAlbum.album === album;
            const isPlaying_ = currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
            return (
              <div key={`${artist}::${album}`} onClick={() => openAlbumFromLibrary(artist, album, tracks, coverArt, mbid)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px', borderRadius: 6, cursor: 'pointer', background: isActive ? COLORS.hover : 'transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                {...contextMenuProps(e => showContextMenu(e, [
                  { label: 'Play', action: () => playTrack(tracks[0], tracks, 0, { artist, album, coverArt }) },
                  { label: 'Add to Queue', action: () => tracks.forEach(t => addToQueue(t)) },
                  { label: 'Go to Artist', action: async () => {
                    try { const data = await api.search(artist);
                      const a = data.artists?.find(x => x.name.toLowerCase() === artist.toLowerCase()) || data.artists?.[0];
                      if (a?.mbid) openArtistPage(a.mbid, a.name, a.type); } catch {} }},
                  { divider: true },
                  { label: 'Remove from Library', danger: true, action: () => removeAlbumFromLibrary(artist, album) },
                ]))}>
                <AlbumArt src={coverArt} size={64} radius={6} artist={artist} album={album} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isPlaying_ ? COLORS.accent : COLORS.textPrimary }}>{album}</div>
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Album · {artist}</div>
                </div>
                {isPlaying_ && <span style={{ flexShrink: 0 }}>{Icon.volumeHigh(14, COLORS.accent)}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <BgDownloadIndicator bgDownloadStatus={bgDownloadStatus} setBgDownloadStatus={setBgDownloadStatus} jobQueueStats={jobQueueStats} onToggleLog={onToggleLog} />
      {/* Always-visible log toggle — shown when BgDownloadIndicator is hidden */}
      {!bgDownloadStatus && !(jobQueueStats && (jobQueueStats.active + jobQueueStats.pending > 0)) && (
        <div
          onClick={onToggleLog}
          style={{
            padding: '4px 12px', fontSize: 10, color: COLORS.textSecondary,
            borderTop: `1px solid ${COLORS.border}`,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}
          title="Toggle activity log"
        >
          <span>▲ Activity Log</span>
        </div>
      )}
      <DownloadIndicator
        downloadStatus={downloadStatus} setDownloadStatus={setDownloadStatus}
        downloading={downloading}
        dlExpanded={dlExpanded} setDlExpanded={setDlExpanded}
        handleCancel={handleCancel} handleYtCancel={handleYtCancel}
        loadLibrary={loadLibrary}
      />
    </aside>
  );
}
