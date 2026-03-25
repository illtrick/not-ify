import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from './constants';
import { buildTrackPath, contextMenuProps } from './utils';
import { Icon } from './components/Icon';
import { AlbumArt } from './components/AlbumArt';
import { SearchView } from './components/SearchView';
import { AlbumView } from './components/AlbumView';
import { ArtistView } from './components/ArtistView';
import { SettingsModal } from './components/SettingsModal';
import { ContextMenu } from './components/ContextMenu';
import { BgDownloadIndicator } from './components/BgDownloadIndicator';
import { DownloadIndicator } from './components/DownloadIndicator';
import { ActivityLog } from './components/ActivityLog';
import { Sidebar } from './components/Sidebar';
import { QueuePanel } from './components/QueuePanel';
import { PlayerBar } from './components/PlayerBar';
import { MobileLibrary } from './components/MobileLibrary';
import { BottomTabBar } from './components/BottomTabBar';
import { UserPicker, getCurrentUser, clearCurrentUser } from './components/UserPicker';
import { SetupWizard } from './components/SetupWizard';
import { useQueue } from './hooks/useQueue';
import { useRecentlyPlayed } from './hooks/useRecentlyPlayed';
import { useSearch } from './hooks/useSearch';
import { useLastFm } from './hooks/useLastFm';
import { useLibrary } from './hooks/useLibrary';
import { usePlayer } from './hooks/usePlayer';
import { useDownload } from './hooks/useDownload';
import { useSession } from './hooks/useSession';
import { useMbTracks } from './hooks/useMbTracks';
import { useAlbumColor } from './hooks/useAlbumColor';
import { useMoreByArtist } from './hooks/useMoreByArtist';
import { useTrackDurations } from './hooks/useTrackDurations';
import { useArtistPage } from './hooks/useArtistPage';
import { useCast } from './hooks/useCast';
import { useServiceConfig } from './hooks/useServiceConfig';
import { onApiRequest, startErrorCapture } from './services/client-diagnostics';
import { useTelemetry } from './hooks/useTelemetry';


// ---------------------------------------------------------------------------
// Main App (rendered only when a user is selected — all hooks are unconditional)
// ---------------------------------------------------------------------------
function MainApp({ currentUser, isAdmin, setIsAdmin, switchUser }) {
  // Navigation (stays in App)
  const [view, setView] = useState('search');
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const prevViewRef = useRef('search');

  // Mobile (stays in App)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileTab, setMobileTab] = useState('search');
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // UI state (stays in App)
  const [contextMenu, setContextMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [versionWarning, setVersionWarning] = useState(null);
  const [serverVersion, setServerVersion] = useState(null);

  // Album page hooks
  const mainContentRef = useRef(null);

  // Artist page
  const {
    selectedArtist, artistReleases, artistDetails, artistBio, artistTopTracks,
    openArtistPage: _openArtistPageInner,
  } = useArtistPage({ setView, prevViewRef, view });

  // ===== HOOKS =====
  const {
    queue, setQueue,
    showQueue, setShowQueue,
    dragIdx, setDragIdx,
    dragOverIdx, setDragOverIdx,
    addToQueue, removeFromQueue, clearQueue,
  } = useQueue();

  const { list: recentlyPlayed, add: addToRecentlyPlayed } = useRecentlyPlayed();

  const lastfm = useLastFm();
  const {
    status: lastfmStatus,
    apiKey: lastfmApiKey, setApiKey: setLastfmApiKey,
    apiSecret: lastfmApiSecret, setApiSecret: setLastfmApiSecret,
    authStep: lastfmAuthStep, setAuthStep: setLastfmAuthStep,
    authUrl: lastfmAuthUrl,
    authToken: lastfmAuthToken,
    error: lastfmError,
    topArtists: lastfmTopArtists,
  } = lastfm;
  // Aliases so render functions stay unchanged
  const lastfmSaveConfig = lastfm.saveConfig;
  const lastfmCompleteAuth = lastfm.completeAuth;
  const lastfmDisconnect = lastfm.disconnect;

  const {
    query, setQuery,
    searching,
    searchAlbums,
    searchDone,
    searchArtistResults,
    streamingResults,
    otherResults,
    searchHistory,
    handleSearch: _handleSearchInner,
    removeFromSearchHistory,
  } = useSearch({ setView });

  const {
    library,
    librarySortBy, setLibrarySortBy,
    libraryFilter, setLibraryFilter,
    showLibraryFilter, setShowLibraryFilter,
    loadLibrary,
    libraryAlbums,
    isInLibrary,
    sidebarAlbums,
  } = useLibrary({ recentlyPlayed });

  const player = usePlayer({
    queue,
    setQueue,
    addToRecentlyPlayed,
    lastfm,
    loadLibrary,
    isInLibrary,
    library,
    onStartBgPoll: () => download.startBgPoll(),
    onSetBgStatus: (status) => download.setBgDownloadStatus(status),
  });
  const {
    currentTrack, setCurrentTrack,
    currentAlbumInfo, setCurrentAlbumInfo,
    isPlaying,
    volume, setVolume,
    progress,
    duration,
    playlist, setPlaylist,
    playlistIdx, setPlaylistIdx,
    currentCoverArt, setCurrentCoverArt,
    crossfadeDuration, setCrossfadeDuration,
    ytSearching,
    ytPendingTrack,
    hoveredTrack, setHoveredTrack,
    hoveredMbTrack, setHoveredMbTrack,
    audioRef, nextAudioRef,
    playTrack, togglePlay, playNext, playPrev,
    handleSeekClick,
    playFromYouTube,
    playStreamingResult,
    audioHandlers,
  } = player;

  const download = useDownload({
    playTrack,
    loadLibrary,
    library,
  });
  const {
    downloading,
    downloadStatus, setDownloadStatus,
    dlExpanded, setDlExpanded,
    bgDownloadStatus, setBgDownloadStatus,
    dlTrackStatus,
    jobQueueStats,
    startDownload,
    startYtDownload,
    downloadAlbumViaYouTube,
    startBgPoll,
    startJobQueuePoll,
    autoAcquireAlbum,
    handleCancel,
    handleYtCancel,
  } = download;

  // Album page hooks
  const mbTracks = useMbTracks(selectedAlbum, setSelectedAlbum);
  const albumColor = useAlbumColor(selectedAlbum);
  const moreByArtist = useMoreByArtist(selectedAlbum, view, searchArtistResults);
  const { trackDurations, setTrackDurations } = useTrackDurations(selectedAlbum);
  const cast = useCast();
  const telemetry = useTelemetry();

  // Service config (admin only)
  const rdConfig = useServiceConfig({
    getStatus: api.getRdStatus,
    saveConfig: api.saveRdConfig,
    testConn: api.testRdConnection,
    enabled: isAdmin,
  });

  const vpnConfig = useServiceConfig({
    getStatus: api.getVpnStatus,
    saveConfig: api.saveVpnConfig,
    testConn: api.testVpnConnection,
    enabled: isAdmin,
  });

  const [vpnRegions, setVpnRegions] = useState([]);
  useEffect(() => {
    if (isAdmin) api.getVpnRegions().then(setVpnRegions).catch(() => {});
  }, [isAdmin]);

  // ── Soulseek config ────────────────────────────────────────────────────────
  const slskConfig = useServiceConfig({
    getStatus: api.getSlskStatus,
    saveConfig: api.saveSlskConfig,
    testConn: api.testSlskConnection,
    enabled: isAdmin,
  });

  const handleSlskSave = useCallback(async (username, password) => {
    if (!username || !password) return;
    await slskConfig.save({ username, password });
  }, [slskConfig]);

  const handleSlskTest = useCallback(() => {
    slskConfig.test();
  }, [slskConfig]);

  // ── Library config ─────────────────────────────────────────────────────────
  const [libraryConfig, setLibraryConfig] = useState(null);

  const fetchLibraryConfig = useCallback(() => {
    if (!isAdmin) return;
    api.getLibraryConfig().then(setLibraryConfig).catch(() => {});
  }, [isAdmin]);

  useEffect(() => { fetchLibraryConfig(); }, [fetchLibraryConfig]);

  const handleLibrarySave = useCallback(async (newPath) => {
    await api.saveLibraryConfig({ musicDir: newPath });
    fetchLibraryConfig();
  }, [fetchLibraryConfig]);

  // ── Persistent SSE listener for upgrade completions ────────────────────────
  // Runs independently of the activity log panel — refreshes library when
  // background upgrades complete so format badges update in real time.
  useEffect(() => {
    const url = api.getActivityStreamUrl();
    let es;
    function connect() {
      es = new EventSource(url);
      es.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data);
          // Refresh library on: upgrade completion, per-track upgrades, or YT download saves
          if (
            (entry.category === 'upgrade' && entry.level === 'success') ||
            (entry.category === 'pipeline' && entry.level === 'info' && entry.message?.includes('upgraded')) ||
            (entry.category === 'youtube' && entry.level === 'success' && entry.message?.startsWith('Saved:'))
          ) {
            // Debounce rapid per-track updates — only refresh every 3s max
            if (!connect._debounce) {
              connect._debounce = setTimeout(() => {
                loadLibrary?.();
                connect._debounce = null;
              }, 3000);
            }
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 5000);
      };
    }
    connect();
    return () => { if (es) es.close(); };
  }, [loadLibrary]);

  // ── Server admin ───────────────────────────────────────────────────────────
  const handleServerRestart = useCallback(async () => {
    try {
      await api.restartServer();
    } catch {
      // Server exits immediately — connection error is expected
    }
    // Poll /api/health until server comes back, then reload
    const start = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - start > 60000) {
        clearInterval(poll);
        return;
      }
      try {
        const result = await api.checkHealth();
        if (!result.error) {
          clearInterval(poll);
          window.location.reload();
        }
      } catch {
        // still down
      }
    }, 2000);
  }, []);

  // ── Scrobble sync status polling ──────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState(null);
  useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    const fetchStatus = () => {
      api.getScrobbleSyncStatus().then(data => {
        if (!cancelled) setSyncStatus(data);
      }).catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, syncStatus?.state === 'syncing' ? 5000 : 60000);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, syncStatus?.state]);

  const handleSyncNow = useCallback(() => {
    api.triggerScrobbleSync().catch(() => {});
    api.getScrobbleSyncStatus().then(setSyncStatus).catch(() => {});
  }, []);

  // ── Sync UI when cast device changes tracks externally (e.g. Sonos skip) ──
  const lastCastTrackIdRef = useRef(null);
  useEffect(() => {
    if (!cast.activeDevice || !cast.castState?.currentTrack) return;
    const castTrack = cast.castState.currentTrack;
    if (castTrack.id === lastCastTrackIdRef.current) return;
    lastCastTrackIdRef.current = castTrack.id;
    // Don't sync on initial mount or if it matches what we already show
    if (currentTrack?.id === castTrack.id) return;
    // Find the matching track in our playlist and update UI without starting local audio
    const idx = playlist.findIndex(t => t.id === castTrack.id);
    if (idx >= 0) {
      setCurrentTrack(playlist[idx]);
      setPlaylistIdx(idx);
      setCurrentCoverArt(playlist[idx].coverArt || currentCoverArt);
    }
  }, [cast.activeDevice, cast.castState?.currentTrack]);

  // ── Diagnostics state getter ────────────────────────────────────────────────
  useEffect(() => {
    window.__notifyDiagnostics = () => ({
      view,
      user: currentUser,
      currentTrack: currentTrack ? { title: currentTrack.title, artist: currentAlbumInfo?.artist } : null,
      isPlaying,
      downloading: !!downloading,
      bgDownloadStatus: !!bgDownloadStatus,
      downloadStatus: downloadStatus ? { step: downloadStatus.step, message: downloadStatus.message, complete: downloadStatus.complete, error: downloadStatus.error } : null,
      queueLength: queue?.length || 0,
      libraryCount: library?.length || 0,
      castActive: !!cast?.activeDevice,
    });
    return () => { delete window.__notifyDiagnostics; };
  });

  // ── Single-output enforcement ──────────────────────────────────────────────
  // Core rule: if activeDevice is set, ALL audio goes to cast device.
  // playTrack always runs (updates UI state), then we mute local + cast.

  // Helper: cast a track to the active device, optionally starting at a position
  const _sendToCast = async (track, albumInfo, pl, usn, startPosition) => {
    if (!usn || !track) return;
    try {
      if (track.isYtPreview) {
        const videoId = track.ytVideoId || track.id?.replace('yt-', '');
        await cast.castYtTrack(videoId, track.title, track.artist, track.album, track.coverArt, usn);
      } else {
        await cast.castTrack(track, albumInfo || { artist: track.artist, album: track.album }, pl, usn, startPosition);
      }
    } catch (err) {
      cast.addLog(`Cast failed: ${err.message}`);
    }
  };

  // Wrap playTrack: always update UI, then route audio
  const handlePlayTrack = (track, pl, idx, albumInfo) => {
    // Always update UI state (currentTrack, playlist, cover art)
    playTrack(track, pl, idx, albumInfo);
    if (cast.activeDevice) {
      // Mute local audio, send to cast device
      setTimeout(() => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = true; }
        _sendToCast(track, albumInfo, pl, cast.activeDevice, 0);
      }, 100);
    }
  };

  // When a cast device is selected, transfer current playback
  const handleCastDeviceSelected = async (usn) => {
    // Stop previous cast device
    if (cast.isCasting && cast.activeDevice) {
      try { await cast.castStop(); } catch {}
    }
    // null usn = "This Device" (return to local playback)
    if (!usn) {
      // Sync local audio to where cast was playing, preserve play/pause state
      const castPos = cast.castState?.position || 0;
      const wasPlaying = cast.castState?.state === 'PLAYING';
      cast.selectDevice(null);
      if (audioRef.current) {
        audioRef.current.muted = false;
        if (castPos > 0) audioRef.current.currentTime = castPos;
        if (wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
      }
      return;
    }
    cast.selectDevice(usn);
    if (!currentTrack) return;
    // Capture position, mute local, cast
    const currentPos = audioRef.current ? audioRef.current.currentTime : 0;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = true; }
    await _sendToCast(currentTrack, currentAlbumInfo, playlist, usn, currentPos);
  };

  // Bridge play/pause
  const handleTogglePlay = () => {
    if (cast.isCasting && cast.activeDevice) {
      cast.castPause();
    } else {
      togglePlay();
    }
  };

  // Bridge next/prev
  const handlePlayNext = () => {
    if (cast.isCasting && cast.activeDevice) {
      cast.castNext();
    } else {
      playNext();
    }
  };
  const handlePlayPrev = () => {
    if (cast.isCasting && cast.activeDevice) {
      cast.castPrev();
    } else {
      playPrev();
    }
  };

  // Bridge function: uses library + download state
  function getTrackDlStatus(artist, trackTitle, trackArtist) {
    const titleLower = trackTitle?.toLowerCase();
    const artistLower = artist?.toLowerCase();
    const trackArtistLower = trackArtist?.toLowerCase();
    const inLib = library.some(t => {
      if (t.title?.toLowerCase() !== titleLower) return false;
      const tArtist = t.artist?.toLowerCase();
      return tArtist === artistLower || (trackArtistLower && tArtist === trackArtistLower);
    });
    if (inLib) return 'library';
    const norm = (artist + '::' + trackTitle).toLowerCase();
    const dlStatus = dlTrackStatus.get(norm);
    if (dlStatus) return dlStatus;
    return null;
  }

  // ── Telemetry-wrapped search ────────────────────────────────────────────
  async function handleSearch(e, overrideQuery) {
    const q = (overrideQuery || query).trim();
    const searchStart = performance.now();
    try { telemetry.emit('search_start', { query: q }); } catch {}
    await _handleSearchInner(e, overrideQuery);
    try { telemetry.emit('search_complete', { query: q, latencyMs: Math.round(performance.now() - searchStart), resultCount: searchAlbums.length }); } catch {}
  }

  // ── Telemetry-wrapped artist page navigation ─────────────────────────
  function openArtistPage(mbid, name, type) {
    try { telemetry.emit('nav_artist', { mbid, name }); } catch {}
    return _openArtistPageInner(mbid, name, type);
  }

  // ── Recently-played click with telemetry ──────────────────────────────
  function openRecentlyPlayed(r, libMatch) {
    try { telemetry.emit('nav_album', { source: 'recently_played', artist: r.artist, album: r.album }); } catch {}
    if (libMatch) {
      // Inline the library-open logic to avoid double-emitting nav_album
      loadLibrary();
      const pl = libMatch.tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt: libMatch.coverArt }));
      const year = libMatch.year || libMatch.tracks.find(t => t.year)?.year || '';
      setSelectedAlbum({ artist: libMatch.artist, album: libMatch.album, year, tracks: pl, coverArt: libMatch.coverArt, mbid: libMatch.mbid, sources: [], fromSearch: false });
      prevViewRef.current = view;
      setView('album');
    } else {
      // No library match — open as search-sourced album using saved metadata
      // so the user sees the album detail view (not a keyword search)
      setSelectedAlbum({
        artist: r.artist, album: r.album, year: r.year || '',
        coverArt: r.coverArt,
        mbid: r.mbid, rgid: r.rgid,
        sources: [],
        tracks: [],
        fromSearch: !!(r.mbid || r.rgid),  // triggers MB track fetch if we have an ID
      });
      prevViewRef.current = view;
      setView('album');
    }
  }

  // ===== SESSION =====
  useSession({
    audioRef,
    onRestoreVolume: setVolume,
    onRestoreView: setView,
    onRestoreAlbum: setSelectedAlbum,
    onRestoreQueue: setQueue,
    onRestorePlaylist: setPlaylist,
    onRestorePlaylistIdx: setPlaylistIdx,
    onRestoreTrack: (track, albumInfo, savedProgress) => {
      setCurrentTrack(track);
      setCurrentAlbumInfo(albumInfo || null);
      setCurrentCoverArt(track.coverArt || null);
      if (audioRef.current) {
        audioRef.current.src = track.path || buildTrackPath(track.id);
        audioRef.current.addEventListener('loadedmetadata', () => {
          if (savedProgress) audioRef.current.currentTime = savedProgress;
        }, { once: true });
      }
    },
    sessionData: { currentTrack, currentAlbumInfo, playlist, playlistIdx, volume, view, selectedAlbum, queue },
  });

  // ===== EFFECTS =====

  // Initial load: library + Last.fm + URL param search + version check + admin role
  useEffect(() => {
    loadLibrary();
    lastfm.load();

    // Resolve admin role for the current user (handles page reload case where
    // currentUser is restored from localStorage but isAdmin starts as false)
    api.getAvailableUsers().then(users => {
      const me = users?.find(u => u.id === currentUser);
      if (me) setIsAdmin(me.role === 'admin');
    }).catch(() => {});

    // Check API version compatibility
    api.checkHealth().then(result => {
      if (result.error) {
        console.warn('Health check failed:', result.error);
      }
      if (result.serverVersion) setServerVersion(result.serverVersion);
      if (!result.error && !result.compatible) {
        setVersionWarning(`Server API v${result.serverApiVersion} is not compatible with this client (expects v${result.clientApiVersion}). Please update your app.`);
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('q');
    if (urlQuery) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => handleSearch(null, urlQuery), 0);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Open album detail
  // -------------------------------------------------------------------------
  function openAlbumFromSearch(album) {
    try { telemetry.emit('nav_album', { source: 'search', artist: album.artist, album: album.album }); } catch {}
    // Check if this album already exists in the library
    const libMatch = libraryAlbums().find(la =>
      la.artist.toLowerCase() === album.artist.toLowerCase() &&
      la.album.toLowerCase() === album.album.toLowerCase()
    );
    const inLib = !!libMatch;
    const libTracks = libMatch
      ? libMatch.tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt: libMatch.coverArt }))
      : [];

    // Always use fromSearch: true when we have MB metadata (mbid/rgid) so the
    // full MB tracklist gets fetched — even if some tracks are already in the
    // library.  The album detail view shows the complete MB tracklist with
    // per-track download indicators, which is far more useful than showing only
    // the subset of tracks that have been downloaded.
    const hasMbMeta = !!(album.mbid || album.rgid || libMatch?.mbid);

    setSelectedAlbum({
      artist: album.artist, album: album.album, year: album.year,
      coverArt: (libMatch?.coverArt) || album.coverArt,
      mbid: album.mbid || libMatch?.mbid, rgid: album.rgid,
      trackCount: album.trackCount || libMatch?.trackCount,
      sources: album.sources || [],
      tracks: libTracks,
      fromSearch: hasMbMeta,          // triggers MB track fetch
      inLibrary: inLib,
    });
    prevViewRef.current = view;
    setView('album');
  }

  function openAlbumFromLibrary(artist, albumName, tracks, coverArt, mbid) {
    try { telemetry.emit('nav_album', { source: 'library', artist, album: albumName }); } catch {}
    // Refresh library to get latest format info (badges may be stale after upgrades)
    loadLibrary();
    const pl = tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt }));
    const year = tracks.find(t => t.year)?.year || '';
    setSelectedAlbum({ artist, album: albumName, year, tracks: pl, coverArt, mbid, sources: [], fromSearch: false });
    prevViewRef.current = view;
    setView('album');
  }

  // Navigate to currently-playing album in library
  function goToCurrentAlbum() {
    if (!currentAlbumInfo) return;
    const albums = libraryAlbums();
    const normArtist = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try to find matching library album by exact artist + album name
    if (currentAlbumInfo.album) {
      const match = albums.find(a => a.artist === currentAlbumInfo.artist && a.album === currentAlbumInfo.album);
      if (match && match.tracks.length > 1) {
        // Library album has multiple tracks — open from library (complete album)
        openAlbumFromLibrary(match.artist, match.album, match.tracks, match.coverArt, match.mbid);
        return;
      }
      // Library album has only 1 track (likely auto-downloaded single) and we have MB metadata
      // → prefer the MB search view which shows the full album tracklist
      if (currentAlbumInfo.rgid || currentAlbumInfo.mbid) {
        openAlbumFromSearch({
          artist: currentAlbumInfo.artist,
          album: currentAlbumInfo.album,
          coverArt: currentAlbumInfo.coverArt,
          mbid: currentAlbumInfo.mbid || null,
          rgid: currentAlbumInfo.rgid || null,
          sources: [],
        });
        return;
      }
      // Library album with 1 track and no MB metadata — open from library as fallback
      if (match) {
        openAlbumFromLibrary(match.artist, match.album, match.tracks, match.coverArt, match.mbid);
        return;
      }
    }

    // Fallback: find the currently playing track in ANY library album by this artist
    // (handles case where recording lookup found a different album name, e.g. a compilation,
    // but the track actually lives in a different library album)
    if (currentTrack?.title && currentAlbumInfo.artist) {
      const na = normArtist(currentAlbumInfo.artist);
      const nt = normArtist(currentTrack.title);
      const trackMatch = albums.find(a =>
        normArtist(a.artist) === na &&
        a.tracks.length > 1 &&
        a.tracks.some(t => normArtist(t.title) === nt)
      );
      if (trackMatch) {
        openAlbumFromLibrary(trackMatch.artist, trackMatch.album, trackMatch.tracks, trackMatch.coverArt, trackMatch.mbid);
        return;
      }
    }

    // Have MB metadata — open as search album (full tracklist from MusicBrainz)
    if (currentAlbumInfo.album && (currentAlbumInfo.rgid || currentAlbumInfo.mbid)) {
      openAlbumFromSearch({
        artist: currentAlbumInfo.artist,
        album: currentAlbumInfo.album,
        coverArt: currentAlbumInfo.coverArt,
        mbid: currentAlbumInfo.mbid || null,
        rgid: currentAlbumInfo.rgid || null,
        sources: [],
      });
      return;
    }
    // Fallback: navigate to artist page if we have an MBID
    if (currentAlbumInfo.artistMbid && currentAlbumInfo.artist) {
      openArtistPage(currentAlbumInfo.artistMbid, currentAlbumInfo.artist);
      return;
    }
    // Last fallback: search for the artist
    if (currentAlbumInfo.artist) {
      handleSearch(null, currentAlbumInfo.artist);
    }
  }

  // Play all MB tracks via YouTube (first track immediate, rest queued)
  // Also triggers auto-download of the album
  async function playAllFromYouTube(tracks, albumArtist, albumName, coverArt) {
    if (!tracks.length) return;
    // Play first track — pass track-specific artist for VA/compilation albums
    await playFromYouTube(tracks[0].title, albumArtist, albumName, coverArt, tracks[0].artist);
    // Queue remaining tracks as YT lookups (lazy — resolved when played)
    const queueTracks = tracks.slice(1).map(t => ({
      id: `yt-pending-${t.position}`,
      title: t.title,
      artist: t.artist || albumArtist,
      trackArtist: t.artist, // preserve per-track artist for YT search
      album: albumName,
      coverArt,
      isYtPreview: true,
      ytPending: true, // needs YT search when it's time to play
    }));
    setQueue(queueTracks);
    // Also set as playlist so playNext has a fallback when queue is consumed
    // (e.g., after tracks are downloaded and played from library, queue empties)
    const allTracks = [
      { id: `yt-pending-${tracks[0].position || 0}`, title: tracks[0].title, artist: tracks[0].artist || albumArtist, trackArtist: tracks[0].artist, album: albumName, coverArt, isYtPreview: true, ytPending: true },
      ...queueTracks,
    ];
    setPlaylist(allTracks);
    setPlaylistIdx(0);

    // Auto-acquire the FULL album in background (not just the tracks from click position)
    // Use mbTracks (full tracklist from state) rather than `tracks` (which may be a subset)
    const fullTrackList = mbTracks.length > tracks.length ? mbTracks : tracks;
    // Filter out tracks already in the library (check per-track artist for VA albums)
    const missingTracks = fullTrackList.filter(t => {
      const trackArtist = t.artist || albumArtist;
      return !library.some(lt =>
        lt.title?.toLowerCase() === t.title?.toLowerCase() &&
        (lt.artist?.toLowerCase() === trackArtist.toLowerCase() ||
         lt.artist?.toLowerCase() === albumArtist.toLowerCase()) &&
        lt.album?.toLowerCase() === albumName.toLowerCase()
      );
    });
    if (missingTracks.length > 0) {
      // Reorder: currently playing track + subsequent tracks first, then earlier tracks
      const clickedPos = tracks[0]?.position || 1;
      const fromClick = missingTracks.filter(t => (t.position || 0) >= clickedPos);
      const beforeClick = missingTracks.filter(t => (t.position || 0) < clickedPos);
      const orderedTracks = [...fromClick, ...beforeClick];

      autoAcquireAlbum({
        artist: albumArtist,
        album: albumName,
        coverArt,
        sources: selectedAlbum?.sources || [],
        mbid: selectedAlbum?.mbid,
        rgid: selectedAlbum?.rgid,
        year: selectedAlbum?.year,
        mbTracks: orderedTracks,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Context menu + library remove
  // -------------------------------------------------------------------------
  function showContextMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  async function removeAlbumFromLibrary(artist, album) {
    try {
      await api.removeAlbum(artist, album);
      loadLibrary();
      // If viewing this album, go back
      if (view === 'album' && selectedAlbum?.artist === artist && selectedAlbum?.album === album) {
        setView('search');
      }
    } catch (err) {
      console.error('Failed to remove album:', err);
    }
  }

  async function removeTrackFromLibrary(trackId) {
    try {
      await api.removeTrack(trackId);
      await loadLibrary();
      // Update selected album's track list to reflect the deletion
      if (selectedAlbum && selectedAlbum.tracks) {
        setSelectedAlbum(prev => prev ? {
          ...prev,
          tracks: prev.tracks.filter(t => t.id !== trackId),
        } : prev);
      }
    } catch (err) {
      console.error('Failed to remove track:', err);
    }
  }

  async function restoreExcludedTrackFromLibrary(artist, album, filename) {
    try {
      await api.restoreExcludedTrack(artist, album, filename);
      await loadLibrary();
      // Update selected album's track list — remove the excluded placeholder so it refreshes
      if (selectedAlbum && selectedAlbum.tracks) {
        setSelectedAlbum(prev => prev ? {
          ...prev,
          tracks: prev.tracks.filter(t => t.id !== `excluded-${filename}`),
        } : prev);
      }
    } catch (err) {
      console.error('Failed to restore excluded track:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  const albumCount = libraryAlbums().length;

  // Determine what the mobile main content shows
  const mobileShowLibrary = isMobile && mobileTab === 'library' && !['album', 'artist'].includes(view);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', overflow: 'hidden' }}>

      {versionWarning && (
        <div style={{ background: '#f59e0b', color: '#000', padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{versionWarning}</span>
          <button onClick={() => setVersionWarning(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Sidebar — desktop only */}
        {!isMobile && (
          <Sidebar
            view={view} setView={setView}
            showSettings={showSettings} setShowSettings={setShowSettings}
            currentUser={currentUser} switchUser={switchUser}
            serverVersion={serverVersion}
            recentlyPlayed={recentlyPlayed}
            currentAlbumInfo={currentAlbumInfo}
            libraryAlbums={libraryAlbums}
            sidebarAlbums={sidebarAlbums}
            albumCount={albumCount}
            libraryFilter={libraryFilter} setLibraryFilter={setLibraryFilter}
            showLibraryFilter={showLibraryFilter} setShowLibraryFilter={setShowLibraryFilter}
            librarySortBy={librarySortBy} setLibrarySortBy={setLibrarySortBy}
            openAlbumFromLibrary={openAlbumFromLibrary}
            openAlbumFromSearch={openAlbumFromSearch}
            openRecentlyPlayed={openRecentlyPlayed}
            openArtistPage={openArtistPage}
            handleSearch={handleSearch}
            playTrack={handlePlayTrack}
            addToQueue={addToQueue}
            showContextMenu={showContextMenu}
            removeAlbumFromLibrary={removeAlbumFromLibrary}
            selectedAlbum={selectedAlbum}
            bgDownloadStatus={bgDownloadStatus} setBgDownloadStatus={setBgDownloadStatus}
            jobQueueStats={jobQueueStats}
            onToggleLog={() => setShowActivityLog(v => !v)}
            downloadStatus={downloadStatus} setDownloadStatus={setDownloadStatus}
            downloading={downloading}
            dlExpanded={dlExpanded} setDlExpanded={setDlExpanded}
            handleCancel={handleCancel} handleYtCancel={handleYtCancel}
            loadLibrary={loadLibrary}
          />
        )}

        {/* Main content */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          <div ref={mainContentRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 28, paddingBottom: isMobile ? 8 : 28 }}>
            {mobileShowLibrary ? (
              <MobileLibrary
                sidebarAlbums={sidebarAlbums}
                recentlyPlayed={recentlyPlayed}
                libraryAlbums={libraryAlbums}
                libraryFilter={libraryFilter} setLibraryFilter={setLibraryFilter}
                showLibraryFilter={showLibraryFilter} setShowLibraryFilter={setShowLibraryFilter}
                librarySortBy={librarySortBy} setLibrarySortBy={setLibrarySortBy}
                currentAlbumInfo={currentAlbumInfo}
                isMobile={isMobile}
                setShowSettings={setShowSettings}
                openAlbumFromLibrary={openAlbumFromLibrary}
                openAlbumFromSearch={openAlbumFromSearch}
                openRecentlyPlayed={openRecentlyPlayed}
                openArtistPage={openArtistPage}
                handleSearch={handleSearch}
                playTrack={handlePlayTrack}
                addToQueue={addToQueue}
                showContextMenu={showContextMenu}
                removeAlbumFromLibrary={removeAlbumFromLibrary}
              />
            ) : (
              <>
                {view === 'search' && (
                  <SearchView
                    query={query} setQuery={setQuery}
                    handleSearch={handleSearch} searching={searching}
                    searchAlbums={searchAlbums} searchDone={searchDone}
                    searchArtistResults={searchArtistResults}
                    streamingResults={streamingResults} otherResults={otherResults}
                    searchHistory={searchHistory}
                    removeFromSearchHistory={removeFromSearchHistory}
                    recentlyPlayed={recentlyPlayed}
                    lastfmTopArtists={lastfmTopArtists}
                    libraryAlbums={libraryAlbums}
                    openAlbumFromLibrary={openAlbumFromLibrary}
                    openAlbumFromSearch={openAlbumFromSearch}
                    openRecentlyPlayed={openRecentlyPlayed}
                    openArtistPage={openArtistPage}
                    startDownload={startDownload}
                    startYtDownload={startYtDownload}
                    playStreamingResult={playStreamingResult}
                    isInLibrary={isInLibrary}
                    downloading={downloading}
                    isMobile={isMobile}
                    currentTrack={currentTrack}
                  />
                )}
                {view === 'album' && (
                  <AlbumView
                    selectedAlbum={selectedAlbum}
                    mbTracks={mbTracks}
                    library={library}
                    albumColor={albumColor}
                    mainContentRef={mainContentRef}
                    moreByArtist={moreByArtist}
                    trackDurations={trackDurations}
                    isMobile={isMobile}
                    isPlaying={isPlaying}
                    currentTrack={currentTrack}
                    currentAlbumInfo={currentAlbumInfo}
                    hoveredTrack={hoveredTrack} setHoveredTrack={setHoveredTrack}
                    hoveredMbTrack={hoveredMbTrack} setHoveredMbTrack={setHoveredMbTrack}
                    ytSearching={ytSearching} ytPendingTrack={ytPendingTrack}
                    downloading={downloading}
                    searchArtistResults={searchArtistResults}
                    isInLibrary={isInLibrary}
                    prevViewRef={prevViewRef}
                    setView={setView}
                    playTrack={handlePlayTrack}
                    togglePlay={handleTogglePlay}
                    playAllFromYouTube={playAllFromYouTube}
                    openAlbumFromSearch={openAlbumFromSearch}
                    openArtistPage={openArtistPage}
                    handleSearch={handleSearch}
                    startDownload={startDownload}
                    showContextMenu={showContextMenu}
                    addToQueue={addToQueue}
                    setQueue={setQueue}
                    removeTrackFromLibrary={removeTrackFromLibrary}
                    restoreExcludedTrack={restoreExcludedTrackFromLibrary}
                    getTrackDlStatus={getTrackDlStatus}
                    onUpgradeTriggered={startJobQueuePoll}
                  />
                )}
                {view === 'artist' && (
                  <ArtistView
                    selectedArtist={selectedArtist}
                    artistDetails={artistDetails}
                    artistBio={artistBio}
                    artistTopTracks={artistTopTracks}
                    artistReleases={artistReleases}
                    isMobile={isMobile}
                    isPlaying={isPlaying}
                    currentTrack={currentTrack}
                    currentAlbumInfo={currentAlbumInfo}
                    ytSearching={ytSearching} ytPendingTrack={ytPendingTrack}
                    isInLibrary={isInLibrary}
                    prevViewRef={prevViewRef}
                    setView={setView}
                    openAlbumFromSearch={openAlbumFromSearch}
                    openArtistPage={openArtistPage}
                    playFromYouTube={playFromYouTube}
                  />
                )}
                {!isMobile && !['search', 'album', 'artist'].includes(view) && (
                  <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 80, fontSize: 15 }}>
                    Select an album from your library, or search for new music.
                  </div>
                )}
              </>
            )}
          </div>
          <QueuePanel
            queue={queue} setQueue={setQueue}
            showQueue={showQueue} setShowQueue={setShowQueue}
            dragIdx={dragIdx} setDragIdx={setDragIdx}
            dragOverIdx={dragOverIdx} setDragOverIdx={setDragOverIdx}
            clearQueue={clearQueue} removeFromQueue={removeFromQueue}
            playlist={playlist} playlistIdx={playlistIdx}
            currentTrack={currentTrack} currentCoverArt={currentCoverArt} currentAlbumInfo={currentAlbumInfo}
            isMobile={isMobile}
          />
        </main>
      </div>

      <ActivityLog open={showActivityLog} onClose={() => setShowActivityLog(false)} onUpgradeComplete={loadLibrary} />

      <PlayerBar
        currentTrack={currentTrack} currentAlbumInfo={currentAlbumInfo} currentCoverArt={currentCoverArt}
        isPlaying={cast.isCasting ? cast.castState?.state === 'PLAYING' : isPlaying}
        volume={cast.isCasting ? (cast.castState?.volume ?? 50) / 100 : volume}
        setVolume={cast.isCasting
          ? (v) => { const level = typeof v === 'function' ? v((cast.castState?.volume ?? 50) / 100) : v; cast.castSetVolume(Math.round(level * 100)); }
          : setVolume}
        progress={cast.isCasting ? (cast.castState?.position ?? progress) : progress}
        duration={cast.isCasting ? (cast.castState?.duration || duration) : duration}
        queue={queue} showQueue={showQueue} setShowQueue={setShowQueue}
        isMobile={isMobile}
        audioRef={audioRef}
        goToCurrentAlbum={goToCurrentAlbum}
        togglePlay={handleTogglePlay} playNext={handlePlayNext} playPrev={handlePlayPrev}
        handleSeekClick={handleSeekClick}
        library={library}
        cast={{ ...cast, onSelectDevice: handleCastDeviceSelected }}
      />
      <BottomTabBar isMobile={isMobile} mobileTab={mobileTab} setMobileTab={setMobileTab} view={view} setView={setView} />
      <ContextMenu contextMenu={contextMenu} setContextMenu={setContextMenu} isMobile={isMobile} />
      <SettingsModal
        showSettings={showSettings} setShowSettings={setShowSettings}
        crossfadeDuration={crossfadeDuration} setCrossfadeDuration={setCrossfadeDuration}
        lastfmStatus={lastfmStatus}
        lastfmApiKey={lastfmApiKey} setLastfmApiKey={setLastfmApiKey}
        lastfmApiSecret={lastfmApiSecret} setLastfmApiSecret={setLastfmApiSecret}
        lastfmAuthStep={lastfmAuthStep}
        lastfmAuthUrl={lastfmAuthUrl}
        lastfmError={lastfmError}
        lastfmSaveConfig={lastfmSaveConfig}
        lastfmCompleteAuth={lastfmCompleteAuth}
        lastfmDisconnect={lastfmDisconnect}
        isAdmin={isAdmin}
        rdConfig={rdConfig}
        vpnConfig={vpnConfig}
        vpnRegions={vpnRegions}
        syncStatus={syncStatus}
        onSyncNow={handleSyncNow}
        slskConfig={slskConfig}
        onSlskSave={handleSlskSave}
        onSlskTest={handleSlskTest}
        libraryConfig={libraryConfig}
        onLibrarySave={handleLibrarySave}
        onServerRestart={handleServerRestart}
      />

      <audio
        ref={audioRef}
        onLoadedMetadata={() => {
          if (!audioRef.current || !currentTrack?.id) return;
          const dur = audioRef.current.duration;
          if (dur && isFinite(dur)) {
            setTrackDurations(prev => prev[currentTrack.id] === dur ? prev : { ...prev, [currentTrack.id]: dur });
          }
        }}
        onTimeUpdate={audioHandlers.onTimeUpdate}
        onEnded={audioHandlers.onEnded}
        onPlay={audioHandlers.onPlay}
        onPause={audioHandlers.onPause}
        onError={audioHandlers.onError}
        onCanPlay={audioHandlers.onCanPlay}
        onStalled={audioHandlers.onStalled}
      />
      {/* Hidden secondary audio element for gapless pre-buffering and crossfade */}
      <audio ref={nextAudioRef} preload="auto" style={{ display: 'none' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App — user gate wrapper. Only 2 hooks here, so hook count is always stable
// regardless of whether currentUser is set. MainApp handles the rest.
// ---------------------------------------------------------------------------
function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = getCurrentUser();
    if (saved) api.setUser(saved);
    return saved;
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [setupRequired, setSetupRequired] = useState(null); // null = loading

  useEffect(() => {
    api.configure({ onRequest: onApiRequest });
    startErrorCapture();
  }, []);

  // Check setup status on mount
  useEffect(() => {
    api.getSetupStatus()
      .then(status => setSetupRequired(status.needsSetup))
      .catch(() => setSetupRequired(false));
  }, []);

  // Listen for setup_required events dispatched by the api-client
  useEffect(() => {
    const handler = () => setSetupRequired(true);
    window.addEventListener('notify-setup-required', handler);
    return () => window.removeEventListener('notify-setup-required', handler);
  }, []);

  function switchUser() {
    clearCurrentUser();
    api.setUser(null);
    setCurrentUser(null);
    setIsAdmin(false);
  }

  // Show nothing while checking setup status
  if (setupRequired === null) return null;

  // Show setup wizard if setup is required
  if (setupRequired) {
    return (
      <SetupWizard onComplete={() => {
        setSetupRequired(false);
        window.location.reload();
      }} />
    );
  }

  if (!currentUser) {
    return <UserPicker onUserSelected={(user) => {
      setCurrentUser(user.id);
      setIsAdmin(user.role === 'admin');
    }} />;
  }

  return (
    <MainApp
      currentUser={currentUser}
      isAdmin={isAdmin}
      setIsAdmin={setIsAdmin}
      switchUser={switchUser}
    />
  );
}

export default App;

// Re-exports for test compatibility
export { COLORS } from './constants';
export { formatTime, buildTrackPath, debounce, trackRowStyle, hashColor } from './utils';
export { Icon } from './components/Icon';
export { AlbumArt } from './components/AlbumArt';
export { SkeletonCard } from './components/SkeletonCard';
export { TopResultCard } from './components/TopResultCard';
export { ArtistPill } from './components/ArtistPill';
export { AlbumCard } from './components/AlbumCard';
export { SectionHeader } from './components/SectionHeader';
export { StreamingTopResult } from './components/StreamingTopResult';
export { StreamingSongRow } from './components/StreamingSongRow';
export { TrackStatusIcon } from './components/TrackStatusIcon';
