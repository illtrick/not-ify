import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { formatTime, contextMenuProps, trackRowStyle } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';
import { AlbumCard } from './AlbumCard';
import { QualityBadge } from './QualityBadge';

export function AlbumView({
  selectedAlbum,
  mbTracks,
  library,
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
  onUpgradeTriggered,
}) {
  const albumHeaderRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [upgradeState, setUpgradeState] = useState(null); // null | 'triggering' | 'queued' | 'error'
  const [lastUpgrade, setLastUpgrade] = useState(null); // { outcome, reason, quality, timestamp }

  const lossyFormats = ['mp3', 'aac', 'm4a', 'ogg', 'opus'];
  const hasLossyTracks = useCallback(
    (trackList) => trackList.some(t => lossyFormats.includes(t.format?.toLowerCase())),
    []
  );

  useEffect(() => {
    setShowStickyHeader(false);
    setUpgradeState(null);
    setLastUpgrade(null);
    if (!albumHeaderRef.current || !mainContentRef?.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHeader(!entry.isIntersecting),
      { root: mainContentRef.current, threshold: 0 }
    );
    observer.observe(albumHeaderRef.current);
    return () => observer.disconnect();
  }, [selectedAlbum, mainContentRef]);

  // Fetch last upgrade attempt for this album
  useEffect(() => {
    if (!selectedAlbum) return;
    const { artist, album } = selectedAlbum;
    if (!artist || !album) return;
    api.getAlbumUpgradeHistory(artist, album)
      .then(r => setLastUpgrade(r?.lastAttempt || null))
      .catch(() => {});
  }, [selectedAlbum]);

  if (!selectedAlbum) return null;
  const { artist, album, year, coverArt, tracks, sources, fromSearch, trackCount } = selectedAlbum;

  const isLib = !fromSearch && tracks.length > 0;
  const pl = tracks;

  const primarySrc = sources?.[0];
  const qualityLabel = primarySrc?.quality ? `${primarySrc.quality} · ${primarySrc.sizeFormatted}` : primarySrc?.sizeFormatted || '';

  const gradBg = albumColor
    ? `linear-gradient(to bottom, rgba(${albumColor.join(',')},0.85) 0%, rgba(${albumColor.join(',')},0.45) 50%, rgba(${albumColor.join(',')},0.15) 80%, ${COLORS.bg} 100%)`
    : `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`;

  const stickyBg = albumColor
    ? `rgba(${albumColor.join(',')},0.3)`
    : COLORS.surface;

  // Compute total duration
  const totalTrackCount = mbTracks.length || trackCount || pl.length;
  const computeTotalDuration = () => {
    let totalSec = 0;
    if (isLib && trackDurations) {
      for (const t of pl) {
        if (trackDurations[t.id]) totalSec += trackDurations[t.id];
      }
    } else if (mbTracks.length > 0) {
      for (const t of mbTracks) {
        if (t.lengthMs) totalSec += t.lengthMs / 1000;
      }
    }
    return totalSec;
  };
  const totalDurationSec = computeTotalDuration();
  const totalMin = Math.floor(totalDurationSec / 60);
  const totalRemSec = Math.floor(totalDurationSec % 60);
  const durationStr = totalDurationSec > 0
    ? `${totalMin} min ${totalRemSec} sec`
    : '';

  // Separator dot component
  const Dot = () => <span style={{ opacity: 0.5, margin: '0 6px' }}>{'\u00b7'}</span>;

  // EQ bars for active playing track
  const EqBars = () => (
    <span className="eq-bars" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      <span style={{ width: 3, background: COLORS.accent, borderRadius: 1 }} className="eq-bar-1" />
      <span style={{ width: 3, background: COLORS.accent, borderRadius: 1 }} className="eq-bar-2" />
      <span style={{ width: 3, background: COLORS.accent, borderRadius: 1 }} className="eq-bar-3" />
    </span>
  );

  // Track number column renderer
  const TrackNum = ({ isActive, isHovered, number, isPending }) => {
    if (isPending) return <span className="spin-slow">{Icon.music(14, COLORS.accent)}</span>;
    if (isActive && isPlaying) return <EqBars />;
    if (isActive && !isPlaying) return <span style={{ color: COLORS.accent, fontWeight: 700, fontSize: 14 }}>{number}</span>;
    if (isHovered && !isActive) return Icon.play(12, COLORS.accent);
    return number;
  };

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
          <AlbumArt src={coverArt} size={48} radius={4} artist={artist} album={album} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album}</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{artist}</div>
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
                style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: COLORS.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
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

        <div style={{ display: 'flex', gap: isMobile ? 16 : 28, alignItems: 'flex-end' }}>
          <AlbumArt src={coverArt} size={isMobile ? 140 : 220} radius={8} style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 2px 12px rgba(0,0,0,0.3)', flexShrink: 0 }} artist={artist} album={album} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Album</div>
            <h1 style={{ fontSize: isMobile ? 28 : 52, fontWeight: 900, color: COLORS.textPrimary, margin: '0 0 8px', lineHeight: 1.15, letterSpacing: '-0.5px' }}>{album}</h1>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: albumColor ? `rgb(${albumColor.join(',')})` : COLORS.hover, flexShrink: 0 }} />
              <span
                style={{ cursor: 'pointer', transition: 'color 0.15s', fontWeight: 600 }}
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
              >{artist}</span>
              {year ? <><Dot /><span>{year}</span></> : null}
              {totalTrackCount ? <><Dot /><span>{totalTrackCount} {totalTrackCount === 1 ? 'song' : 'songs'}</span></> : null}
              {durationStr ? <><Dot /><span>{durationStr}</span></> : null}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
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
                      width: 52, height: 52, borderRadius: '50%', border: 'none',
                      background: ytSearching && !isLib && !isThisAlbumPlaying ? COLORS.hover : COLORS.accent,
                      cursor: ytSearching && !isLib && !isThisAlbumPlaying ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 16px rgba(233,69,96,0.4)',
                      transition: 'transform 0.1s ease, background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = COLORS.accentHover; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = COLORS.accent; }}
                    title={isThisAlbumPlaying ? 'Pause' : 'Play'}
                  >
                    {isThisAlbumPlaying ? Icon.pause(22, '#fff') : Icon.play(22, '#fff')}
                  </button>
                );
              })()}

              {/* Upgrade to FLAC button — only for library albums with lossy tracks */}
              {isLib && pl.length > 0 && hasLossyTracks(pl) && (
                <button
                  onClick={async () => {
                    if (upgradeState === 'triggering' || upgradeState === 'queued') return;
                    setUpgradeState('triggering');
                    try {
                      await api.triggerAlbumUpgrade(artist, album);
                      setUpgradeState('queued');
                      onUpgradeTriggered?.();
                      setTimeout(() => setUpgradeState(null), 5000);
                    } catch (err) {
                      console.warn('[AlbumView] Upgrade failed:', err.message);
                      setUpgradeState('error');
                      setTimeout(() => setUpgradeState(null), 4000);
                    }
                  }}
                  disabled={upgradeState === 'triggering' || upgradeState === 'queued'}
                  style={{
                    padding: '7px 14px', borderRadius: 20,
                    border: `1px solid ${upgradeState === 'queued' ? COLORS.success : upgradeState === 'error' ? COLORS.danger || '#e94560' : COLORS.border}`,
                    background: 'transparent',
                    color: upgradeState === 'queued' ? COLORS.success : upgradeState === 'error' ? (COLORS.danger || '#e94560') : COLORS.textSecondary,
                    fontSize: 12, fontWeight: 500,
                    cursor: upgradeState === 'triggering' || upgradeState === 'queued' ? 'default' : 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                  onMouseEnter={e => { if (!upgradeState) { e.currentTarget.style.color = COLORS.textPrimary; e.currentTarget.style.borderColor = COLORS.textSecondary; } }}
                  onMouseLeave={e => { if (!upgradeState) { e.currentTarget.style.color = COLORS.textSecondary; e.currentTarget.style.borderColor = COLORS.border; } }}
                  title={lastUpgrade ? `Last attempt: ${lastUpgrade.outcome}${lastUpgrade.reason ? ' — ' + lastUpgrade.reason : ''} (${(() => { const ago = Date.now() - lastUpgrade.timestamp; if (ago < 60000) return 'just now'; if (ago < 3600000) return Math.round(ago/60000) + 'm ago'; if (ago < 86400000) return Math.round(ago/3600000) + 'h ago'; return Math.round(ago/86400000) + 'd ago'; })()})` : 'Queue this album for quality upgrade'}
                >
                  {upgradeState === 'triggering' && <span className="spin-slow" style={{ display: 'inline-flex' }}>{Icon.music(12, COLORS.textSecondary)}</span>}
                  {upgradeState === 'queued' ? 'Upgrade queued' : upgradeState === 'error' ? 'Upgrade failed' : lastUpgrade ? `Upgrade (tried ${(() => { const ago = Date.now() - lastUpgrade.timestamp; if (ago < 60000) return 'just now'; if (ago < 3600000) return Math.round(ago/60000) + 'm ago'; if (ago < 86400000) return Math.round(ago/3600000) + 'h ago'; return Math.round(ago/86400000) + 'd ago'; })()})` : 'Upgrade'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Track list (library) */}
      {isLib && (
        <div role="list" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', padding: isMobile ? '8px 10px' : '10px 16px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
            <span style={{ width: isMobile ? 28 : 32, fontSize: 13, color: COLORS.textSecondary, textAlign: 'right', marginRight: isMobile ? 12 : 16 }}>#</span>
            <span style={{ flex: 1, fontSize: 13, color: COLORS.textSecondary }}>Title</span>
            {!isMobile && <span style={{ width: 56, fontSize: 13, color: COLORS.textSecondary, textAlign: 'right' }}></span>}
            {!isMobile && <span style={{ width: 50, textAlign: 'right', marginLeft: 12, display: 'flex', justifyContent: 'flex-end' }}>
              {Icon.clock(16, COLORS.textSecondary)}
            </span>}
          </div>
          {pl.map((track, idx) => {
            const isActive = currentTrack?.id === track.id
              || (currentTrack?.isYtPreview && currentTrack?.title === track.title);
            const isHovered = hoveredTrack === track.id;
            const trackArtist = track.artist || artist;
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
                <span style={{ width: isMobile ? 28 : 32, textAlign: 'right', marginRight: isMobile ? 12 : 16, fontSize: 14, color: isActive ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <TrackNum isActive={isActive} isHovered={isHovered} number={idx + 1} />
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: isActive ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 12, color: isActive ? COLORS.accent : COLORS.textSecondary, marginTop: 2, opacity: isActive ? 0.7 : 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {trackArtist}
                  </div>
                </div>
                {!isMobile && <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <QualityBadge format={track.format} />
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
          <div style={{ display: 'flex', padding: isMobile ? '8px 10px' : '10px 12px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
            <span style={{ width: isMobile ? 28 : 32, fontSize: 13, color: COLORS.textSecondary, textAlign: 'right', marginRight: isMobile ? 12 : 16 }}>#</span>
            <span style={{ flex: 1, fontSize: 13, color: COLORS.textSecondary }}>Title</span>
            {!isMobile && <span style={{ width: 50, textAlign: 'right', marginLeft: 12, display: 'flex', justifyContent: 'flex-end' }}>
              {Icon.clock(16, COLORS.textSecondary)}
            </span>}
          </div>
          {(() => {
            // Normalize for fuzzy matching: lowercase, strip non-alphanumeric
            // (handles sanitizePath differences like : → _, whitespace variations, etc.)
            const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const normAlbum = norm(album);
            const normArtist = norm(artist);
            // Pre-filter library tracks for this album to avoid O(n*m) on every track
            const albumLibTracks = library?.filter(lt =>
              norm(lt.album) === normAlbum
            ) || [];
            return mbTracks.map((t, i) => {
            const isHovered = hoveredMbTrack === i;
            const trackArtist = t.artist || artist;
            const libTrack = albumLibTracks.find(lt =>
              norm(lt.title) === norm(t.title)
            );
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
                  ...(libTrack ? [{ divider: true }, { label: 'Remove Track', danger: true, action: () => removeTrackFromLibrary(libTrack.id) }] : []),
                ]))}
              >
                <span style={{ width: isMobile ? 28 : 32, textAlign: 'right', marginRight: isMobile ? 12 : 16, flexShrink: 0, fontSize: 14, color: isActive ? COLORS.accent : isPending ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, cursor: ytSearching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <TrackNum isActive={isActive} isHovered={isHovered} number={t.position} isPending={isPending} />
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: isActive ? COLORS.accent : isPending ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title}
                  </div>
                  <div
                    style={{ fontSize: 12, color: isActive ? COLORS.accent : COLORS.textSecondary, marginTop: 2, opacity: isActive ? 0.7 : 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: t.artist ? 'pointer' : 'default' }}
                    onClick={t.artist ? (e => {
                      e.stopPropagation();
                      if (t.artistMbid) {
                        openArtistPage(t.artistMbid, t.artist);
                      } else {
                        handleSearch(null, t.artist);
                      }
                    }) : undefined}
                    onMouseEnter={t.artist ? (e => e.target.style.color = COLORS.textPrimary) : undefined}
                    onMouseLeave={t.artist ? (e => e.target.style.color = isActive ? COLORS.accent : COLORS.textSecondary) : undefined}
                  >
                    {trackArtist}
                  </div>
                </div>
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>
                  <QualityBadge
                    format={libTrack?.format}
                    status={!libTrack ? getTrackDlStatus(artist, t.title, t.artist) : null}
                  />
                </span>
                {!isMobile && t.lengthMs && (
                  <span style={{ width: 50, textAlign: 'right', flexShrink: 0, fontSize: 13, color: COLORS.textSecondary, opacity: 0.5 }}>{formatTime(t.lengthMs / 1000)}</span>
                )}
              </div>
            );
          });
          })()}
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
