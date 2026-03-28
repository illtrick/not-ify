import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';
import { formatTime, contextMenuProps, trackRowStyle } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';
import { AlbumCard } from './AlbumCard';
import { QualityBadge } from './QualityBadge';
import { useTelemetry } from '../hooks/useTelemetry';

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
  restoreExcludedTrack,
  getTrackDlStatus,
  onUpgradeTriggered,
  upgradeOutcome,
  updatePlaylist,
  trackError,
  mbEditions,
  switchEdition,
}) {
  const telemetry = useTelemetry();
  const renderStartRef = useRef(null);
  const albumHeaderRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [upgradeState, setUpgradeState] = useState(null); // null | 'triggering' | 'queued' | 'not_available' | 'error'
  const [lastUpgrade, setLastUpgrade] = useState(null); // { outcome, reason, quality, timestamp }
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  const editionPickerRef = useRef(null);

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

  // BUG-U02: React to SSE upgrade outcomes for this album
  useEffect(() => {
    if (!upgradeOutcome || !selectedAlbum) return;
    const matchesAlbum = upgradeOutcome.artist?.toLowerCase() === artist?.toLowerCase()
      && upgradeOutcome.album?.toLowerCase() === album?.toLowerCase();
    if (!matchesAlbum && upgradeState !== 'queued' && upgradeState !== 'triggering') return;
    // If we're waiting for a result and get any outcome, apply it
    if (upgradeState === 'queued' || upgradeState === 'triggering') {
      if (upgradeOutcome.type === 'not_available') {
        setUpgradeState('not_available');
        setTimeout(() => setUpgradeState(null), 10000);
      } else if (upgradeOutcome.type === 'success') {
        setUpgradeState(null); // Clear — badge will update via library refresh
      }
    }
  }, [upgradeOutcome]);

  // Fetch last upgrade attempt for this album
  useEffect(() => {
    if (!selectedAlbum) return;
    const { artist, album } = selectedAlbum;
    if (!artist || !album) return;
    api.getAlbumUpgradeHistory(artist, album)
      .then(r => setLastUpgrade(r?.lastAttempt || null))
      .catch(() => {});
  }, [selectedAlbum]);

  // Record render start timestamp when album changes
  useEffect(() => {
    if (selectedAlbum) {
      renderStartRef.current = performance.now();
    }
  }, [selectedAlbum]);

  // Emit render timing after paint
  useEffect(() => {
    if (selectedAlbum && renderStartRef.current) {
      try {
        const latencyMs = Math.round(performance.now() - renderStartRef.current);
        telemetry.emit('render_complete', { component: 'album_view', latencyMs });
      } catch {}
    }
  }, [selectedAlbum]);

  // Layout anomaly detection — runs after tracks render
  useEffect(() => {
    if (!selectedAlbum) return;
    const { tracks: albumTracks, fromSearch: isFromSearch } = selectedAlbum;
    if (!albumTracks) return;
    try {
      const active = albumTracks.filter(t => !t.excluded);
      const isLibAlbum = !isFromSearch && active.length > 0;

      // Detect empty track list when tracks should exist
      if (isLibAlbum && active.length === 0 && albumTracks.length > 0) {
        telemetry.emit('layout_anomaly', { component: 'album_tracks', issue: 'empty_after_render' });
      }

      // Detect format badges showing missing format for library tracks
      if (isLibAlbum && active.length > 0) {
        const missingFormat = active.filter(t => !t.format || t.format === '\u2014').length;
        if (missingFormat > 0) {
          telemetry.emit('layout_anomaly', { component: 'format_badge', issue: 'missing_format', count: missingFormat });
        }
      }
    } catch {}
  }, [selectedAlbum]);

  // Close edition picker on click outside
  useEffect(() => {
    if (!showEditionPicker) return;
    const handleClickOutside = (e) => {
      if (editionPickerRef.current && !editionPickerRef.current.contains(e.target)) {
        setShowEditionPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEditionPicker]);

  // Reset edition picker when album changes
  useEffect(() => {
    setShowEditionPicker(false);
  }, [selectedAlbum]);

  if (!selectedAlbum) return null;
  const { artist, album, year, coverArt: rawCoverArt, tracks, sources, fromSearch, trackCount, rgid } = selectedAlbum;
  // Fallback: if no cover art URL but we have an rgid, use the cover art API endpoint
  const coverArt = rawCoverArt || (rgid ? `/api/cover/rg/${rgid}` : null);

  // Build a map of library tracks for this album — keyed by both ID and lowercase title.
  // When tracks download while the user stays on the page, this map lets us replace stale
  // YT preview / MB track objects with the real library versions (correct ID, path, format).
  // Library is re-fetched via SSE on upgrade events — see App.jsx SSE listener.
  const libraryTrackMap = React.useMemo(() => {
    const byId = new Map();
    const byTitle = new Map();
    if (library) {
      const lAlbum = (album || '').toLowerCase();
      const lArtist = (artist || '').toLowerCase();
      library.filter(t => {
        const tAlbum = (t.album || '').toLowerCase();
        const tArtist = (t.artist || '').toLowerCase();
        // Exact album match only — fuzzy startsWith caused cross-album track bleed (BUG-022)
        return tArtist === lArtist && tAlbum === lAlbum;
      }).forEach(t => {
        byId.set(t.id, t);
        const key = (t.title || '').toLowerCase();
        if (!byTitle.has(key)) byTitle.set(key, t);
      });
    }
    return { byId, byTitle };
  }, [library, artist, album]);

  // Separate active tracks from excluded ones (excluded come from server with excluded:true)
  const activeTracks = tracks.filter(t => !t.excluded);
  const excludedTracks = tracks.filter(t => t.excluded);
  const isLib = !fromSearch && (activeTracks.length > 0 || excludedTracks.length > 0);

  // Build the live playlist: replace stale track objects with library versions when available.
  // This ensures click handlers always capture fresh track IDs/paths — fixing the stale-closure
  // bug where playback controls break when staying on an album page during downloads.
  const pl = activeTracks.map(t => {
    const libTrack = libraryTrackMap.byId.get(t.id)
      || libraryTrackMap.byTitle.get((t.title || '').toLowerCase());
    if (libTrack) {
      return {
        ...t,                          // preserve MB metadata (trackNumber, coverArt, etc.)
        id: libTrack.id,               // use library track ID
        path: undefined,               // clear stale YT path — buildTrackPath(id) will be used
        format: libTrack.format,       // use live format
        isYtPreview: false,            // no longer a preview
      };
    }
    // No library file — mark as YT preview so the player uses YT streaming instead of
    // generating a /api/stream/{mbTrackId} URL that will 404 (BUG-P01)
    return { ...t, isYtPreview: !t.format, path: t.format ? `/api/stream/${t.id}` : undefined };
  });

  // Sync the live playlist to the player when library tracks update (BUG-018/019/020)
  // This ensures playNext/playPrev always use fresh track IDs/paths
  const plRef = React.useRef(pl);
  React.useEffect(() => {
    plRef.current = pl;
    if (pl.length > 0) updatePlaylist?.(pl);
  }, [pl, updatePlaylist]);

  const primarySrc = sources?.[0];
  const qualityLabel = primarySrc?.quality ? `${primarySrc.quality} · ${primarySrc.sizeFormatted}` : primarySrc?.sizeFormatted || '';

  const gradBg = albumColor
    ? `linear-gradient(to bottom, rgba(${albumColor.join(',')},0.85) 0%, rgba(${albumColor.join(',')},0.45) 50%, rgba(${albumColor.join(',')},0.15) 80%, ${COLORS.bg} 100%)`
    : `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`;

  const stickyBg = albumColor
    ? `rgba(${albumColor.join(',')},0.3)`
    : COLORS.surface;

  // Compute total duration — prefer album-level duration from DB, then sum tracks
  const totalTrackCount = mbTracks.length || trackCount || pl.length;
  const computeTotalDuration = () => {
    // Prefer album-level duration from DB (already populated by MB data)
    if (selectedAlbum.duration) return selectedAlbum.duration;
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
          <AlbumArt src={coverArt} size={48} radius={4} artist={artist} album={album} rgid={rgid} />
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
                  if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt, rgid });
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
          <AlbumArt src={coverArt} size={isMobile ? 140 : 220} radius={8} style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 2px 12px rgba(0,0,0,0.3)', flexShrink: 0 }} artist={artist} album={album} rgid={rgid} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Album</div>
            <h1 style={{ fontSize: isMobile ? 28 : 52, fontWeight: 900, color: COLORS.textPrimary, margin: '0 0 8px', lineHeight: 1.15, letterSpacing: '-0.5px' }}>{album}</h1>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              {/* Color circle removed — clean layout */}
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

            {/* Edition picker pill */}
            {mbEditions?.length > 1 && (() => {
              const selected = mbEditions.find(e => e.selected);
              const formatLabel = (ed) => {
                const discPrefix = ed.discCount > 1 ? `${ed.discCount}\u00d7` : '';
                const fmt = ed.format || '';
                const disambig = ed.disambiguation ? ` \u00b7 ${ed.disambiguation}` : '';
                return `${discPrefix}${fmt}${disambig}`;
              };
              const pillLabel = selected ? formatLabel(selected) : 'Select edition\u2026';
              return (
                <div ref={editionPickerRef} style={{ position: 'relative', marginTop: 8, marginBottom: 4 }}>
                  <button
                    onClick={() => setShowEditionPicker(prev => !prev)}
                    style={{
                      background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: 16,
                      padding: '4px 12px', fontSize: 12, color: COLORS.textSecondary, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.textSecondary; e.currentTarget.style.color = COLORS.textPrimary; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.textSecondary; }}
                  >
                    {pillLabel} <span style={{ fontSize: 10, marginLeft: 2 }}>{showEditionPicker ? '\u25b4' : '\u25be'}</span>
                  </button>
                  {showEditionPicker && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
                      background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 320, maxHeight: 300, overflowY: 'auto',
                      padding: '4px 0',
                    }}>
                      {mbEditions.map((ed) => {
                        const label = formatLabel(ed);
                        const meta = [
                          ed.trackCount ? `${ed.trackCount} tracks` : null,
                          ed.discCount ? `${ed.discCount} disc${ed.discCount > 1 ? 's' : ''}` : null,
                          ed.date ? ed.date.slice(0, 4) : null,
                        ].filter(Boolean).join(' \u00b7 ');
                        return (
                          <div
                            key={ed.mbid}
                            onClick={() => { switchEdition(ed.mbid); setShowEditionPicker(false); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                              cursor: 'pointer', transition: 'background 0.1s',
                              background: ed.selected ? 'rgba(233,69,96,0.1)' : 'transparent',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = ed.selected ? 'rgba(233,69,96,0.15)' : COLORS.hover}
                            onMouseLeave={e => e.currentTarget.style.background = ed.selected ? 'rgba(233,69,96,0.1)' : 'transparent'}
                          >
                            <span style={{ width: 18, fontSize: 13, color: ed.selected ? COLORS.accent : 'transparent', flexShrink: 0 }}>
                              {ed.selected ? '\u2713' : ''}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: ed.selected ? 600 : 400, color: ed.selected ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {label || 'Unknown format'}
                              </div>
                              {meta && <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 1 }}>{meta}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {(selectedAlbum.inLibrary || isInLibrary(artist, album)) && (() => {
              const selectedEdition = mbEditions?.find(e => e.selected);
              const editionTrackCount = selectedEdition?.trackCount || mbTracks.length;
              const libraryCount = activeTracks.length;
              const showPartial = editionTrackCount > 0 && libraryCount > 0 && libraryCount < editionTrackCount;
              return (
                <div style={{ fontSize: 12, color: COLORS.success, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                  {showPartial ? `${libraryCount} of ${editionTrackCount} tracks in library` : 'In Your Library'}
                </div>
              );
            })()}

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
                      if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt, rgid });
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

              {/* Upgrade button — show on all library albums (server decides if upgrade is possible) */}
              {isLib && pl.length > 0 && (
                <button
                  onClick={async () => {
                    if (upgradeState === 'triggering' || upgradeState === 'queued') return;
                    setUpgradeState('triggering');
                    try {
                      await api.triggerAlbumUpgrade(artist, album, selectedAlbum.rgid);
                      setUpgradeState('queued');
                      onUpgradeTriggered?.();
                      setTimeout(() => setUpgradeState(null), 5000);
                    } catch (err) {
                      console.warn('[AlbumView] Upgrade failed:', err.message);
                      setUpgradeState('error');
                      setTimeout(() => setUpgradeState(null), 4000);
                    }
                  }}
                  disabled={upgradeState === 'triggering' || upgradeState === 'queued' || upgradeState === 'not_available'}
                  style={{
                    padding: '7px 14px', borderRadius: 20,
                    border: `1px solid ${upgradeState === 'queued' ? COLORS.success : upgradeState === 'error' ? COLORS.danger || '#e94560' : COLORS.border}`,
                    background: 'transparent',
                    color: upgradeState === 'queued' ? COLORS.success : upgradeState === 'not_available' ? COLORS.textSecondary : upgradeState === 'error' ? (COLORS.danger || '#e94560') : COLORS.textSecondary,
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
                  {upgradeState === 'queued' ? 'Upgrade queued' : upgradeState === 'not_available' ? 'No upgrade available' : upgradeState === 'error' ? 'Upgrade failed' : 'Upgrade'}
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
          {(() => {
            const hasMultipleDiscs = pl.some(t => (t.discNumber || 1) > 1);
            let prevDiscNumber = null;
            let discIdx = -1;
            return pl.map((track, idx) => {
            const currentDiscNumber = track.discNumber || 1;
            let discHeader = null;
            if (hasMultipleDiscs && currentDiscNumber !== prevDiscNumber) {
              discIdx++;
              discHeader = (
                <div key={`disc-${currentDiscNumber}`} style={{ padding: '12px 16px 4px', fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: discIdx > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginTop: discIdx > 0 ? 8 : 0 }}>
                  Disc {currentDiscNumber}
                </div>
              );
              prevDiscNumber = currentDiscNumber;
            }
            const isActive = currentTrack?.id === track.id
              || (currentTrack?.isYtPreview && currentTrack?.title === track.title
                  && currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album);
            const isHovered = hoveredTrack === track.id;
            const trackArtist = track.artist || artist;
            const displayNumber = track.trackNumber || (idx + 1);
            return (
              <React.Fragment key={track.id}>
                {discHeader}
              <div
                role="listitem"
                style={trackRowStyle(isActive, isHovered, isMobile)}
                onClick={() => {
                  // BUG-P01: undownloaded tracks (isYtPreview) should stream via YT, not 404
                  if (track.isYtPreview && !track.format) {
                    playAllFromYouTube([{ title: track.title, artist: track.artist || artist, position: track.trackNumber || idx + 1 }], artist, album, coverArt);
                  } else {
                    playTrack(track, pl, idx, { artist, album, coverArt, rgid });
                  }
                }}
                onMouseEnter={() => setHoveredTrack(track.id)}
                onMouseLeave={() => setHoveredTrack(null)}
                {...contextMenuProps(e => showContextMenu(e, [
                  { label: 'Play', action: () => {
                    if (track.isYtPreview && !track.format) {
                      playAllFromYouTube([{ title: track.title, artist: track.artist || artist, position: track.trackNumber || idx + 1 }], artist, album, coverArt);
                    } else {
                      playTrack(track, pl, idx, { artist, album, coverArt, rgid });
                    }
                  }},
                  { label: 'Play Next', action: () => { setQueue(prev => [track, ...prev]); } },
                  { label: 'Add to Queue', action: () => addToQueue(track) },
                  { divider: true },
                  { label: 'Remove Track', danger: true, action: () => removeTrackFromLibrary(track.id) },
                ]))}
              >
                <span style={{ width: isMobile ? 28 : 32, textAlign: 'right', marginRight: isMobile ? 12 : 16, fontSize: 14, color: isActive ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <TrackNum isActive={isActive} isHovered={isHovered} number={displayNumber} />
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
                  <QualityBadge format={track.format} fileStatus={track.fileStatus || (track.format ? 'available' : null)} />
                </span>}
                {!isMobile && (
                  <span style={{ width: 50, textAlign: 'right', fontSize: 12, color: COLORS.textSecondary, flexShrink: 0, marginLeft: 12 }}>
                    {track.duration ? formatTime(track.duration) : trackDurations[track.id] ? formatTime(trackDurations[track.id]) : ''}
                  </span>
                )}
                {isMobile && (
                  <span style={{ opacity: 0.45, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {Icon.checkCircle(13, ['flac', 'wav'].includes(track.format?.toLowerCase()) ? COLORS.success : COLORS.textSecondary)}
                  </span>
                )}
              </div>
              </React.Fragment>
            );
          });
          })()}
          {excludedTracks.map((track) => {
            const trackArtist = track.artist || artist;
            // Extract original filename for restore — stored in track.id as "excluded-<filename>"
            const filename = track.id.replace(/^excluded-/, '');
            return (
              <div
                key={track.id}
                role="listitem"
                className="track-excluded"
                style={{ ...trackRowStyle(false, false, isMobile), opacity: 0.4, cursor: 'default' }}
                {...contextMenuProps(e => showContextMenu(e, [
                  { label: 'Restore Track', action: () => restoreExcludedTrack && restoreExcludedTrack(track.artist || artist, album, filename) },
                ]))}
              >
                <span style={{ width: isMobile ? 28 : 32, textAlign: 'right', marginRight: isMobile ? 12 : 16, fontSize: 14, color: COLORS.textSecondary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  —
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {trackArtist}
                  </div>
                </div>
                {!isMobile && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="excluded-label" style={{ color: COLORS.textSecondary, fontSize: '0.75rem' }}>Removed</span>
                  </span>
                )}
                {!isMobile && (
                  <span style={{ width: 50, textAlign: 'right', fontSize: 12, color: COLORS.textSecondary, flexShrink: 0, marginLeft: 12 }} />
                )}
                {isMobile && (
                  <span style={{ fontSize: '0.7rem', color: COLORS.textSecondary, flexShrink: 0 }}>Removed</span>
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
            const mbHasMultipleDiscs = mbTracks.some(t => (t.discNumber || 1) > 1);
            let mbPrevDiscNumber = null;
            let mbDiscIdx = -1;
            return mbTracks.map((t, i) => {
            const currentDiscNum = t.discNumber || 1;
            let mbDiscHeader = null;
            if (mbHasMultipleDiscs && currentDiscNum !== mbPrevDiscNumber) {
              mbDiscIdx++;
              mbDiscHeader = (
                <div key={`mb-disc-${currentDiscNum}`} style={{ padding: '12px 0 4px', fontSize: 11, color: COLORS.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, borderTop: mbDiscIdx > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                  Disc {currentDiscNum}
                </div>
              );
              mbPrevDiscNumber = currentDiscNum;
            }
            const isHovered = hoveredMbTrack === i;
            const trackArtist = t.artist || artist;
            const libTrack = albumLibTracks.find(lt =>
              norm(lt.title) === norm(t.title)
            );
            const isActive = (currentTrack?.isYtPreview
                && currentTrack?.title === t.title
                && currentTrack?.artist === artist
                && currentAlbumInfo?.album === album)
              || (!currentTrack?.isYtPreview
                  && currentTrack?.title === t.title
                  && (currentAlbumInfo?.album === album || currentTrack?.album === album));
            const isPending = ytPendingTrack === t.title;
            return (
              <React.Fragment key={i}>
                {mbDiscHeader}
              <div
                style={{ ...trackRowStyle(isActive, isHovered, isMobile), opacity: (ytSearching && !isPending && !isActive) ? 0.5 : ((selectedAlbum.inLibrary || isInLibrary(artist, album)) && !libTrack) ? 0.5 : 1 }}
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
                  {(selectedAlbum.inLibrary || isInLibrary(artist, album)) && !libTrack ? (
                    <span style={{ fontSize: 11, color: COLORS.textSecondary, opacity: 0.4, fontWeight: 500 }}>{'\u2014'}</span>
                  ) : (
                    <QualityBadge
                      format={libTrack?.format}
                      fileStatus={libTrack ? 'available' : getTrackDlStatus(artist, t.title, t.artist)}
                    />
                  )}
                </span>
                {!isMobile && t.lengthMs && (
                  <span style={{ width: 50, textAlign: 'right', flexShrink: 0, fontSize: 13, color: COLORS.textSecondary, opacity: 0.5 }}>{formatTime(t.lengthMs / 1000)}</span>
                )}
              </div>
              </React.Fragment>
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
