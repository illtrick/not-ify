import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as api from '@not-ify/shared';
import { COLORS, SESSION_KEY, SEARCH_HISTORY_KEY, RECENTLY_PLAYED_KEY, MAX_SEARCH_HISTORY, MAX_RECENTLY_PLAYED } from './constants';
import { formatTime, buildTrackPath, contextMenuProps, debounce, trackRowStyle, hashColor } from './utils';
import { Icon } from './components/Icon';
import { AlbumArt } from './components/AlbumArt';
import { SkeletonCard } from './components/SkeletonCard';
import { TopResultCard } from './components/TopResultCard';
import { ArtistPill } from './components/ArtistPill';
import { AlbumCard } from './components/AlbumCard';
import { SectionHeader } from './components/SectionHeader';
import { StreamingTopResult } from './components/StreamingTopResult';
import { StreamingSongRow } from './components/StreamingSongRow';
import { TrackStatusIcon } from './components/TrackStatusIcon';
import { SearchView } from './components/SearchView';
import { AlbumView } from './components/AlbumView';
import { ArtistView } from './components/ArtistView';
import { SettingsModal } from './components/SettingsModal';
import { ContextMenu } from './components/ContextMenu';
import { BgDownloadIndicator } from './components/BgDownloadIndicator';
import { DownloadIndicator } from './components/DownloadIndicator';
import { QueuePanel } from './components/QueuePanel';
import { PlayerBar } from './components/PlayerBar';
import { MobileLibrary } from './components/MobileLibrary';
import { BottomTabBar } from './components/BottomTabBar';
import { useQueue } from './hooks/useQueue';
import { useRecentlyPlayed } from './hooks/useRecentlyPlayed';
import { useSearch } from './hooks/useSearch';
import { useLastFm } from './hooks/useLastFm';
import { useLibrary } from './hooks/useLibrary';
import { usePlayer } from './hooks/usePlayer';
import { useDownload } from './hooks/useDownload';
import { useSession } from './hooks/useSession';


// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
function App() {
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

  // Album page state (stays in App)
  const [mbTracks, setMbTracks] = useState([]);
  const [albumColor, setAlbumColor] = useState(null);
  const albumHeaderRef = useRef(null);
  const mainContentRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [moreByArtist, setMoreByArtist] = useState([]);
  const [trackDurations, setTrackDurations] = useState({});

  // Artist page state (stays in App)
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [artistReleases, setArtistReleases] = useState([]);
  const [artistDetails, setArtistDetails] = useState(null);
  const [artistBio, setArtistBio] = useState(null);
  const [artistTopTracks, setArtistTopTracks] = useState([]);

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
    status: lastfmStatus, setStatus: setLastfmStatus,
    apiKey: lastfmApiKey, setApiKey: setLastfmApiKey,
    apiSecret: lastfmApiSecret, setApiSecret: setLastfmApiSecret,
    authStep: lastfmAuthStep, setAuthStep: setLastfmAuthStep,
    authUrl: lastfmAuthUrl,
    authToken: lastfmAuthToken,
    error: lastfmError,
    topArtists: lastfmTopArtists,
    statusRef: lastfmStatusRef,
    scrobbleRef,
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
    handleSearch,
    addToSearchHistory,
    removeFromSearchHistory,
  } = useSearch({ setView });

  const {
    library,
    librarySortBy, setLibrarySortBy,
    libraryFilter, setLibraryFilter,
    showLibraryFilter, setShowLibraryFilter,
    loadLibrary,
    libraryAlbums,
    libraryKeys,
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
    isPlaying, setIsPlaying,
    volume, setVolume,
    progress, setProgress,
    duration, setDuration,
    playlist, setPlaylist,
    playlistIdx, setPlaylistIdx,
    currentCoverArt, setCurrentCoverArt,
    crossfadeDuration, setCrossfadeDuration,
    ytSearching,
    ytPendingTrack,
    hoveredTrack, setHoveredTrack,
    hoveredMbTrack, setHoveredMbTrack,
    audioRef, nextAudioRef,
    recentlyPlayedAddedRef,
    playTrack, togglePlay, playNext, playPrev,
    handleSeekClick,
    cancelCrossfade,
    peekNextTrack,
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
    downloading, setDownloading,
    downloadStatus, setDownloadStatus,
    dlExpanded, setDlExpanded,
    bgDownloadStatus, setBgDownloadStatus,
    dlTrackStatus,
    startDownload,
    startYtDownload,
    downloadAlbumViaYouTube,
    startBgPoll,
    autoAcquireAlbum,
    handleCancel,
    handleYtCancel,
  } = download;

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

  // Initial load: library + Last.fm + URL param search
  useEffect(() => {
    loadLibrary();
    lastfm.load();
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('q');
    if (urlQuery) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => handleSearch(null, urlQuery), 0);
    }
  }, []);

  // MB track listing for album detail
  useEffect(() => {
    if (selectedAlbum?.fromSearch && (selectedAlbum?.mbid || selectedAlbum?.rgid)) {
      setMbTracks([]);
      if (selectedAlbum.mbid) {
        api.getMbReleaseTracks(selectedAlbum.mbid)
          .then(d => setMbTracks(d.tracks || []))
          .catch(() => {});
      } else if (selectedAlbum.rgid) {
        api.getMbRgTracks(selectedAlbum.rgid)
          .then(d => {
            setMbTracks(d.tracks || []);
            if (d.releaseMbid && !selectedAlbum.mbid) {
              setSelectedAlbum(prev => prev ? { ...prev, mbid: d.releaseMbid } : prev);
            }
          })
          .catch(() => {});
      }
    } else {
      setMbTracks([]);
    }
  }, [selectedAlbum?.mbid, selectedAlbum?.rgid, selectedAlbum?.fromSearch]);

  // "More by Artist" for album page
  useEffect(() => {
    setMoreByArtist([]);
    if (!selectedAlbum?.artist || view !== 'album') return;
    const artistName = selectedAlbum.artist;
    const currentAlbumTitle = selectedAlbum.album;
    const cached = searchArtistResults.find(a => a.name.toLowerCase() === artistName.toLowerCase());
    const fetchArtist = cached?.mbid
      ? Promise.resolve(cached.mbid)
      : api.search(artistName)
          .then(d => {
            const match = d.artists?.find(a => a.name.toLowerCase() === artistName.toLowerCase());
            return match?.mbid || null;
          })
          .catch(() => null);
    fetchArtist.then(artistMbid => {
      if (!artistMbid) return;
      api.getArtist(artistMbid, artistName)
        .then(d => {
          const other = (d.releases || [])
            .filter(r => r.album.toLowerCase() !== currentAlbumTitle.toLowerCase())
            .slice(0, 6);
          setMoreByArtist(other);
        })
        .catch(() => {});
    });
  }, [selectedAlbum?.artist, selectedAlbum?.album, view]);

  // Load track durations sequentially for library album view
  useEffect(() => {
    if (!selectedAlbum || selectedAlbum.fromSearch) return;
    const tracks = selectedAlbum.tracks || [];
    if (!tracks.length) return;
    let cancelled = false;
    let activeAudio = null;
    const seen = new Set();
    const loadNext = (idx) => {
      if (cancelled || idx >= tracks.length) return;
      const track = tracks[idx];
      const id = track.id;
      if (!id || seen.has(id)) { loadNext(idx + 1); return; }
      seen.add(id);
      const audio = new Audio();
      activeAudio = audio;
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const dur = audio.duration;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        activeAudio = null;
        if (!cancelled && dur && isFinite(dur)) {
          setTrackDurations(prev => prev[id] !== undefined ? prev : { ...prev, [id]: dur });
        }
        setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.onerror = () => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        activeAudio = null;
        setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.src = track.path || buildTrackPath(id);
    };
    loadNext(0);
    return () => {
      cancelled = true;
      if (activeAudio) {
        activeAudio.onloadedmetadata = null;
        activeAudio.onerror = null;
        activeAudio.src = '';
        activeAudio = null;
      }
    };
  }, [selectedAlbum]);

  // Album header gradient color
  useEffect(() => {
    setAlbumColor(null);
    setShowStickyHeader(false);
    if (!selectedAlbum?.coverArt) return;
    const url = selectedAlbum.coverArt.replace('/api/cover/', '/api/cover/') + '/color';
    api.getCoverColor(url).then(d => { if (d.color) setAlbumColor(d.color); }).catch(() => {});
  }, [selectedAlbum]);

  // Sticky album header via IntersectionObserver
  useEffect(() => {
    if (view !== 'album' || !albumHeaderRef.current || !mainContentRef.current) {
      setShowStickyHeader(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHeader(!entry.isIntersecting),
      { root: mainContentRef.current, threshold: 0 }
    );
    observer.observe(albumHeaderRef.current);
    return () => observer.disconnect();
  }, [view, selectedAlbum]);

  // -------------------------------------------------------------------------
  // Artist page
  // -------------------------------------------------------------------------
  async function openArtistPage(mbid, name, type) {
    setSelectedArtist({ mbid, name, type: type || null });
    setArtistReleases([]);
    setArtistDetails(null);
    setArtistBio(null);
    setArtistTopTracks([]);
    prevViewRef.current = view;
    setView('artist');

    // Fetch top tracks from Last.fm (fires immediately, independent of MB data)
    api.getLastfmTopTracks(name, 10)
      .then(tracks => { if (Array.isArray(tracks) && tracks.length) setArtistTopTracks(tracks); })
      .catch(() => {});

    try {
      const data = await api.getArtist(mbid, name);
      setArtistReleases(data.releases || []);
      if (data.details) {
        setArtistDetails(data.details);
        // Lazy-load Wikipedia bio if link available (prefer Wikipedia, fall back to Wikidata)
        const wikiUrl = data.details.links?.wikipedia || data.details.links?.wikidata;
        if (wikiUrl) {
          api.getWikiSummary(wikiUrl)
            .then(bio => { if (bio) setArtistBio(bio); })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('Artist page load failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Open album detail
  // -------------------------------------------------------------------------
  function openAlbumFromSearch(album) {
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
    const pl = tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt }));
    setSelectedAlbum({ artist, album: albumName, tracks: pl, coverArt, mbid, sources: [], fromSearch: false });
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
      autoAcquireAlbum({
        artist: albumArtist,
        album: albumName,
        coverArt,
        sources: selectedAlbum?.sources || [],
        mbid: selectedAlbum?.mbid,
        rgid: selectedAlbum?.rgid,
        year: selectedAlbum?.year,
        mbTracks: missingTracks,
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
      loadLibrary();
    } catch (err) {
      console.error('Failed to remove track:', err);
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

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Sidebar — desktop only */}
        {!isMobile && (
          <aside style={{ width: 280, minWidth: 280, background: COLORS.surface, borderRight: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Top nav */}
            <div style={{ padding: '16px 12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.5px' }}>Not-ify</div>
                <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                  title="Settings">
                  {Icon.gear(18, COLORS.textSecondary)}
                </button>
              </div>
              <div
                style={{
                  display: 'flex', alignItems: 'center', padding: '10px 12px',
                  borderRadius: 6, cursor: 'pointer', fontSize: 14,
                  background: view === 'search' ? COLORS.hover : 'transparent',
                  color: view === 'search' ? COLORS.textPrimary : COLORS.textSecondary,
                  fontWeight: view === 'search' ? 600 : 400,
                }}
                onClick={() => setView('search')}
                role="button" tabIndex={0}
              >
                <span style={{ marginRight: 10 }}>{Icon.search(16, 'currentColor')}</span>
                <span>Search</span>
              </div>
            </div>

            {/* Recently Played section — sticky between Search and Library */}
            {recentlyPlayed.length > 0 && (
              <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 4, padding: '8px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 6px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recently Played</span>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {recentlyPlayed.slice(0, 8).map((r, i) => {
                    const isPlaying_ = currentAlbumInfo?.artist === r.artist && currentAlbumInfo?.album === r.album;
                    return (
                      <div key={`rp-${i}`}
                        onClick={() => {
                          const libMatch = libraryAlbums().find(la =>
                            la.artist.toLowerCase() === r.artist.toLowerCase() &&
                            la.album.toLowerCase() === r.album.toLowerCase()
                          );
                          if (libMatch) openAlbumFromLibrary(libMatch.artist, libMatch.album, libMatch.tracks, libMatch.coverArt, libMatch.mbid);
                          else handleSearch(null, `${r.artist} ${r.album}`);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <AlbumArt src={r.coverArt} size={36} radius={3} artist={r.artist} album={r.album} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isPlaying_ ? COLORS.accent : COLORS.textPrimary }}>{r.album}</div>
                          <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.artist}</div>
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
                    <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>Your Library</span>
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
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px', borderRadius: 6, cursor: 'pointer', background: isActive ? COLORS.hover : 'transparent' }}
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
                      <AlbumArt src={coverArt} size={48} radius={4} artist={artist} album={album} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isPlaying_ ? COLORS.accent : COLORS.textPrimary }}>{album}</div>
                        <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artist}</div>
                      </div>
                      {isPlaying_ && <span style={{ flexShrink: 0 }}>{Icon.volumeHigh(14, COLORS.accent)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <BgDownloadIndicator bgDownloadStatus={bgDownloadStatus} setBgDownloadStatus={setBgDownloadStatus} />
            <DownloadIndicator
              downloadStatus={downloadStatus} setDownloadStatus={setDownloadStatus}
              downloading={downloading}
              dlExpanded={dlExpanded} setDlExpanded={setDlExpanded}
              handleCancel={handleCancel} handleYtCancel={handleYtCancel}
              loadLibrary={loadLibrary}
            />
          </aside>
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
                openArtistPage={openArtistPage}
                handleSearch={handleSearch}
                playTrack={playTrack}
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
                    albumColor={albumColor}
                    showStickyHeader={showStickyHeader}
                    albumHeaderRef={albumHeaderRef}
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
                    playTrack={playTrack}
                    togglePlay={togglePlay}
                    playAllFromYouTube={playAllFromYouTube}
                    openAlbumFromSearch={openAlbumFromSearch}
                    openArtistPage={openArtistPage}
                    handleSearch={handleSearch}
                    startDownload={startDownload}
                    showContextMenu={showContextMenu}
                    addToQueue={addToQueue}
                    setQueue={setQueue}
                    removeTrackFromLibrary={removeTrackFromLibrary}
                    getTrackDlStatus={getTrackDlStatus}
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

      <PlayerBar
        currentTrack={currentTrack} currentAlbumInfo={currentAlbumInfo} currentCoverArt={currentCoverArt}
        isPlaying={isPlaying} volume={volume} setVolume={setVolume}
        progress={progress} duration={duration}
        queue={queue} showQueue={showQueue} setShowQueue={setShowQueue}
        isMobile={isMobile}
        audioRef={audioRef}
        goToCurrentAlbum={goToCurrentAlbum}
        togglePlay={togglePlay} playNext={playNext} playPrev={playPrev}
        handleSeekClick={handleSeekClick}
        library={library}
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
      />
      {/* Hidden secondary audio element for gapless pre-buffering and crossfade */}
      <audio ref={nextAudioRef} preload="auto" style={{ display: 'none' }} />
    </div>
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
