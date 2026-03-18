import React, { useState, useRef, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { formatTime, contextMenuProps, trackRowStyle } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';
import { AlbumCard } from './AlbumCard';
import { TrackStatusIcon } from './TrackStatusIcon';

export function AlbumView({
  selectedAlbum,
  mbTracks,
  albumColor,
  mainContentRef,
  moreByArtist,
  trackDurations,
  isMobile,
  isPlaying,
  currentTrack,
  currentAlbumInfo,
  hoveredTrack, setHoveredTrack,
  hoveredMbTrack, setHoveredMbTrack,
  ytSearching, ytPendingTrack,
  downloading,
  searchArtistResults,
  isInLibrary,
  prevViewRef,
  setView,
  playTrack,
  togglePlay,
  playAllFromYouTube,
  openAlbumFromSearch,
  openArtistPage,
  handleSearch,
  startDownload,
  showContextMenu,
  addToQueue,
  setQueue,
  removeTrackFromLibrary,
  getTrackDlStatus,
}) {
  const albumHeaderRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  useEffect(() => {
    setShowStickyHeader(false);
    if (!albumHeaderRef.current || !mainContentRef?.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHeader(!entry.isIntersecting),
      { root: mainContentRef.current, threshold: 0 }
    );
    observer.observe(albumHeaderRef.current);
    return () => observer.disconnect();
  }, [selectedAlbum, mainContentRef]);

  if (!selectedAlbum) return null;
  const { artist, album, year, coverArt, tracks, sources, fromSearch, trackCount } = selectedAlbum;

  const isLib = !fromSearch && tracks.length > 0;
  const pl = tracks;

  const primarySrc = sources?.[0];
  const qualityLabel = primarySrc?.quality ? `${primarySrc.quality} · ${primarySrc.sizeFormatted}` : primarySrc?.sizeFormatted || '';

  const gradBg = albumColor
    ? `linear-gradient(to bottom, rgba(${albumColor.join(',')},0.55) 0%, rgba(${albumColor.join(',')},0.15) 60%, ${COLORS.bg} 100%)`
    : `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`;

  const stickyBg = albumColor
    ? `rgba(${albumColor.join(',')},0.3)`
    : COLORS.surface;

  return (
    <div>
      {/* Sticky header (shown when main header scrolls out) */}
      {showStickyHeader && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: stickyBg, backdropFilter: 'blur(12px)',
          padding: isMobile ? '10px 12px' : '10px 28px', margin: isMobile ? '-12px -12px 0' : '-28px -28px 0',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <AlbumArt src={coverArt} size={40} radius={4} artist={artist} album={album} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album}</div>
            <div style={{ fontSize: 11, color: COLORS.textSecondary }}>{artist}</div>
          </div>
          {(isLib ? pl.length > 0 : mbTracks.length > 0) && (() => {
            const isThisPlaying = isPlaying && currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
            return (
              <button
                onClick={() => {
                  if (isThisPlaying) { togglePlay(); return; }
                  if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt });
                  else playAllFromYouTube(mbTracks, artist, album, coverArt);
                }}
                style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: COLORS.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >{isThisPlaying ? Icon.pause(14, '#fff') : Icon.play(14, '#fff')}</button>
            );
          })()}
        </div>
      )}

      {/* Gradient header */}
      <div ref={albumHeaderRef} style={{ margin: isMobile ? '-12px -12px 0' : '-28px -28px 0', padding: isMobile ? '12px 12px 20px' : '20px 28px 32px', background: gradBg }}>
        <button
          onClick={() => setView(prevViewRef.current === 'album' ? 'search' : (prevViewRef.current || 'search'))}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {Icon.back(16, 'rgba(255,255,255,0.7)')} Back
        </button>

        <div style={{ display: 'flex', gap: isMobile ? 14 : 24, alignItems: 'flex-end' }}>
          <AlbumArt src={coverArt} size={isMobile ? 120 : 200} radius={6} style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', flexShrink: 0 }} artist={artist} album={album} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Album</div>
            <h1 style={{ fontSize: isMobile ? 20 : 32, fontWeight: 800, color: COLORS.textPrimary, margin: '0 0 8px', lineHeight: 1.15 }}>{album}</h1>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
              <span
                style={{ cursor: 'pointer', transition: 'color 0.15s' }}
                onClick={async () => {
                  const match = searchArtistResults.find(a => a.name.toLowerCase() === artist.toLowerCase());
                  if (match) { openArtistPage(match.mbid, match.name, match.type); return; }
                  // Search MB for artist MBID
                  try {
                    const data = await api.search(artist);
                    const mbArtist = data.artists?.find(a => a.name.toLowerCase() === artist.toLowerCase()) || data.artists?.[0];
                    if (mbArtist?.mbid) { openArtistPage(mbArtist.mbid, mbArtist.name, mbArtist.type); return; }
                  } catch {}
                  handleSearch(null, artist);
                }}
                onMouseEnter={e => e.target.style.color = COLORS.textPrimary}
                onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.7)'}
              >{artist}</span>{year ? ` · ${year}` : ''}{(mbTracks.length || trackCount || pl.length) ? ` · ${mbTracks.length || trackCount || pl.length} tracks` : ''}
            </div>

            {(selectedAlbum.inLibrary || isInLibrary(artist, album)) && (
              <div style={{ fontSize: 12, color: COLORS.success, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                In Your Library
              </div>
            )}

            {fromSearch && sources.length === 0 && mbTracks.length === 0 && (
              <div style={{ fontSize: 12, color: COLORS.textSecondary, opacity: 0.6, marginTop: 4 }}>No sources available</div>
            )}

            {/* Play/Pause button — inline with album info */}
            {(isLib ? pl.length > 0 : mbTracks.length > 0) && (() => {
              const isThisAlbumPlaying = isPlaying && currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
              return (
                <button
                  onClick={() => {
                    if (isThisAlbumPlaying) { togglePlay(); return; }
                    if (ytSearching) return;
                    if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt });
                    else playAllFromYouTube(mbTracks, artist, album, coverArt);
                  }}
                  style={{
                    width: 48, height: 48, borderRadius: '50%', border: 'none',
                    background: ytSearching && !isLib && !isThisAlbumPlaying ? COLORS.hover : COLORS.accent,
                    cursor: ytSearching && !isLib && !isThisAlbumPlaying ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    transition: 'transform 0.1s ease, background 0.15s',
                    marginTop: 12,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = COLORS.accentHover; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = COLORS.accent; }}
                  title={isThisAlbumPlaying ? 'Pause' : 'Play'}
                >
                  {isThisAlbumPlaying ? Icon.pause(22, '#fff') : Icon.play(22, '#fff')}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Track list (library) */}
      {isLib && (
        <div role="list" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', padding: isMobile ? '6px 8px' : '6px 16px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
            <span style={{ width: isMobile ? 24 : 32, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', marginRight: isMobile ? 10 : 16 }}>#</span>
            <span style={{ flex: 1, fontSize: 12, color: COLORS.textSecondary }}>Title</span>
            {!isMobile && <span style={{ width: 56, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right' }}>Format</span>}
            {!isMobile && <span style={{ width: 50, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', marginLeft: 12 }}>Time</span>}
          </div>
          {pl.map((track, idx) => {
            // Match by ID (library-to-library) or by title when a YouTube
            // preview of the same song is playing. Title-only is safe here
            // because we're inside one specific album's track list.
            const isActive = currentTrack?.id === track.id
              || (currentTrack?.isYtPreview && currentTrack?.title === track.title);
            const isHovered = hoveredTrack === track.id;
            return (
              <div
                key={track.id}
                role="listitem"
                style={trackRowStyle(isActive, isHovered, isMobile)}
                onClick={() => playTrack(track, pl, idx, { artist, album, coverArt })}
                onMouseEnter={() => setHoveredTrack(track.id)}
                onMouseLeave={() => setHoveredTrack(null)}
                {...contextMenuProps(e => showContextMenu(e, [
                  { label: 'Play', action: () => playTrack(track, pl, idx, { artist, album, coverArt }) },
                  { label: 'Play Next', action: () => { setQueue(prev => [track, ...prev]); } },
                  { label: 'Add to Queue', action: () => addToQueue(track) },
                  { divider: true },
                  { label: 'Remove Track', danger: true, action: () => removeTrackFromLibrary(track.id) },
                ]))}
              >
                <span style={{ width: isMobile ? 24 : 32, textAlign: 'right', marginRight: isMobile ? 10 : 16, fontSize: 13, color: isActive ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {isActive ? Icon.music(14, COLORS.accent) : isHovered ? Icon.play(12, COLORS.accent) : idx + 1}
                </span>
                <span style={{ flex: 1, fontSize: 14, color: isActive ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.title}
                  {artist === 'Various Artists' && track.artist && (
                    <span style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 6 }}>{track.artist}</span>
                  )}
                </span>
                {/* Add to queue button (hover — desktop only) */}
                {!isMobile && <button
                  onClick={e => { e.stopPropagation(); addToQueue(track); }}
                  title="Add to queue"
                  style={{
                    background: 'none', border: 'none',
                    cursor: 'pointer', padding: '2px 8px', opacity: isHovered ? 0.7 : 0,
                    transition: 'opacity 0.15s', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >{Icon.plus(14, COLORS.textSecondary)}</button>}
                {!isMobile && <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: COLORS.textSecondary, textAlign: 'right', width: 36 }}>
                    {track.format?.toUpperCase()}
                  </span>
                  <span style={{ opacity: 0.45, display: 'flex', alignItems: 'center' }} title={['flac', 'wav'].includes(track.format?.toLowerCase()) ? 'Lossless' : 'Downloaded'}>
                    {Icon.checkCircle(13, ['flac', 'wav'].includes(track.format?.toLowerCase()) ? COLORS.success : COLORS.textSecondary)}
                  </span>
                </span>}
                {!isMobile && (
                  <span style={{ width: 50, textAlign: 'right', fontSize: 12, color: COLORS.textSecondary, flexShrink: 0, marginLeft: 12 }}>
                    {trackDurations[track.id] ? formatTime(trackDurations[track.id]) : ''}
                  </span>
                )}
                {isMobile && (
                  <span style={{ opacity: 0.45, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {Icon.checkCircle(13, ['flac', 'wav'].includes(track.format?.toLowerCase()) ? COLORS.success : COLORS.textSecondary)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MusicBrainz track listing preview (search view) — now playable via YouTube */}
      {fromSearch && mbTracks.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', padding: isMobile ? '6px 8px' : '6px 12px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
            <span style={{ width: isMobile ? 24 : 32, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', marginRight: isMobile ? 10 : 16 }}>#</span>
            <span style={{ flex: 1, fontSize: 12, color: COLORS.textSecondary }}>Title</span>
            {!isMobile && <span style={{ width: 50, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right' }}>Duration</span>}
          </div>
          {mbTracks.map((t, i) => {
            const isHovered = hoveredMbTrack === i;
            // Match YouTube previews by title+artist, OR library tracks by title
            // (handles navigating to MB view while a library track is playing)
            const isActive = (currentTrack?.isYtPreview
                && currentTrack?.title === t.title
                && currentTrack?.artist === artist)
              || (!currentTrack?.isYtPreview
                  && currentTrack?.title === t.title
                  && (currentAlbumInfo?.album === album || currentTrack?.album === album));
            const isPending = ytPendingTrack === t.title;
            return (
              <div
                key={i}
                style={{ ...trackRowStyle(isActive, isHovered, isMobile), opacity: (ytSearching && !isPending && !isActive) ? 0.5 : 1 }}
                onMouseEnter={() => setHoveredMbTrack(i)}
                onMouseLeave={() => setHoveredMbTrack(null)}
                onClick={() => {
                  if (ytSearching) return; // Block while resolving
                  const remaining = mbTracks.slice(i);
                  playAllFromYouTube(remaining, artist, album, coverArt);
                }}
                {...contextMenuProps(e => showContextMenu(e, [
                  { label: 'Play', action: () => { const remaining = mbTracks.slice(i); playAllFromYouTube(remaining, artist, album, coverArt); } },
                  { label: 'Play Next', action: () => { setQueue(prev => [{ id: `yt-pending-${t.position}`, title: t.title, artist: t.artist || artist, trackArtist: t.artist, album, coverArt, isYtPreview: true, ytPending: true }, ...prev]); } },
                  { label: 'Add to Queue', action: () => { setQueue(prev => [...prev, { id: `yt-pending-${t.position}`, title: t.title, artist: t.artist || artist, trackArtist: t.artist, album, coverArt, isYtPreview: true, ytPending: true }]); } },
                ]))}
              >
                <span style={{ width: isMobile ? 24 : 32, textAlign: 'right', marginRight: isMobile ? 10 : 16, flexShrink: 0, fontSize: 13, color: isActive ? COLORS.accent : isPending ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, cursor: ytSearching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {isPending ? <span className="spin-slow">{Icon.music(14, COLORS.accent)}</span> : isActive ? Icon.music(14, COLORS.accent) : isHovered ? Icon.play(12, COLORS.accent) : t.position}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: isActive ? COLORS.accent : isPending ? COLORS.accent : COLORS.textPrimary }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {t.title}
                    {t.artist && (
                      <span
                        style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 6, cursor: 'pointer' }}
                        onClick={e => {
                          e.stopPropagation();
                          if (t.artistMbid) {
                            openArtistPage(t.artistMbid, t.artist);
                          } else {
                            handleSearch(null, t.artist);
                          }
                        }}
                        onMouseEnter={e => e.target.style.color = COLORS.textPrimary}
                        onMouseLeave={e => e.target.style.color = COLORS.textSecondary}
                      >{t.artist}</span>
                    )}
                  </span>
                </span>
                <TrackStatusIcon status={getTrackDlStatus(artist, t.title, t.artist)} />
                {!isMobile && t.lengthMs && (
                  <span style={{ width: 50, textAlign: 'right', flexShrink: 0, fontSize: 13, color: COLORS.textSecondary, opacity: 0.5 }}>{formatTime(t.lengthMs / 1000)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Other versions (collapsed) */}
      {sources.length > 1 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 13, color: COLORS.textSecondary, cursor: 'pointer', userSelect: 'none', marginBottom: 8 }}>
            Other versions ({sources.length - 1})
          </summary>
          <div style={{ marginTop: 8 }}>
            {sources.slice(1).map((src) => (
              <div key={src.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                borderRadius: 6, marginBottom: 4, border: `1px solid ${COLORS.border}`,
              }}>
                <button
                  onClick={() => startDownload(src, selectedAlbum, true)}
                  disabled={!!downloading}
                  style={{
                    padding: '5px 14px', borderRadius: 20, border: `1px solid ${COLORS.border}`,
                    background: 'transparent',
                    color: downloading ? COLORS.textSecondary : COLORS.textPrimary,
                    fontSize: 12, fontWeight: 500, cursor: downloading ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                ><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{Icon.plus(12, downloading ? COLORS.textSecondary : COLORS.textPrimary)} Add</span></button>
                <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  {[src.quality, src.sizeFormatted].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* More by Artist */}
      {moreByArtist.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 14 }}>More by {artist}</h3>
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
            {moreByArtist.map(rel => {
              const a = {
                id: `mb:${rel.rgid || rel.mbid}`,
                artist: artist,
                album: rel.album,
                year: rel.year || '',
                coverArt: rel.coverArt,
                mbid: rel.mbid,
                rgid: rel.rgid,
                trackCount: rel.trackCount,
                sources: [],
              };
              return (
                <div key={a.id} style={{ flexShrink: 0, width: isMobile ? 130 : 160 }}>
                  <AlbumCard
                    album={a}
                    isDownloading={false}
                    inLibrary={isInLibrary(artist, rel.album)}
                    onPlay={() => openAlbumFromSearch(a)}
                    onClick={() => openAlbumFromSearch(a)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
