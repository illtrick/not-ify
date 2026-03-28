import { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '@not-ify/shared';
import { buildTrackPath } from '../utils';
import { useTelemetry } from './useTelemetry';

/**
 * Core player hook — manages playback, queue, and audio element lifecycle.
 *
 * Architecture (informed by Navidrome/Jellyfin patterns):
 * - Playlist and index stored in REFS (not state) to avoid stale closures
 * - A `playlistVersion` state counter triggers UI re-renders when playlist changes
 * - Audio element in a ref, playback functions read refs directly
 * - UI state (isPlaying, progress, duration) derived from audio events
 */
export function usePlayer({
  queue = [],
  setQueue,
  addToRecentlyPlayed,
  lastfm,
  loadLibrary,
  isInLibrary,
  library = [],
  trackPathMap,
  onStartBgPoll,
  onSetBgStatus,
} = {}) {
  // ── UI state (triggers re-renders) ──────────────────────────────────────
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentAlbumInfo, setCurrentAlbumInfo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentCoverArt, setCurrentCoverArt] = useState(null);
  const [crossfadeDuration, setCrossfadeDuration] = useState(() => {
    try { return parseInt(localStorage.getItem('notify_crossfade') || '0', 10); } catch { return 0; }
  });
  const [ytSearching, setYtSearching] = useState(false);
  const [ytPendingTrack, setYtPendingTrack] = useState(null);
  const [hoveredTrack, setHoveredTrack] = useState(null);
  const [hoveredMbTrack, setHoveredMbTrack] = useState(null);
  const [trackError, setTrackError] = useState(null);

  // Serial skip queue — prevents rapid-click cascades (BUG-P04)
  const skipQueueRef = useRef([]);
  const skipProcessingRef = useRef(false);

  // Playlist version counter — bumped when playlist ref changes, triggers UI re-render
  const [playlistVersion, setPlaylistVersion] = useState(0);

  // ── Refs (stable across renders, no stale closures) ─────────────────────
  const playlistRef = useRef([]);       // the live playlist — always current
  const playlistIdxRef = useRef(0);     // current index into playlistRef
  const currentTrackRef = useRef(null); // sync mirror of currentTrack
  const currentAlbumInfoRef = useRef(null);
  const audioRef = useRef(null);
  const nextAudioRef = useRef(null);
  const crossfadeAnimRef = useRef(null);
  const preBufferedTrackRef = useRef(null);
  const recentlyPlayedAddedRef = useRef(false);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const libraryRef = useRef(library);

  // Keep refs in sync with their state/prop counterparts
  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { currentAlbumInfoRef.current = currentAlbumInfo; }, [currentAlbumInfo]);

  // Telemetry
  const telemetry = useTelemetry();
  const traceRef = useRef(null);
  const prevQueueLenRef = useRef(queue.length);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    try { localStorage.setItem('notify_crossfade', String(crossfadeDuration)); } catch {}
  }, [crossfadeDuration]);

  useEffect(() => {
    if (queue.length !== prevQueueLenRef.current) {
      prevQueueLenRef.current = queue.length;
      try { telemetry.emit('queue_state', { length: queue.length, trackIds: queue.map(t => t.id) }); } catch {}
    }
  }, [queue, telemetry]);

  // ── Playlist ref helpers ────────────────────────────────────────────────
  // These update the ref AND bump the version counter for UI re-renders.

  function _setPlaylist(pl) {
    playlistRef.current = pl;
    setPlaylistVersion(v => v + 1);
  }

  function _setPlaylistIdx(idx) {
    playlistIdxRef.current = idx;
    // No version bump needed — index changes are reflected via currentTrack state
  }

  // ── Public API: read playlist (for session persistence, UI) ─────────────
  // These provide state-like access for components that need to render playlist data.
  const playlist = playlistRef.current;
  const playlistIdx = playlistIdxRef.current;

  // ── Core playback ───────────────────────────────────────────────────────

  function peekNextTrack() {
    if (queue.length > 0) return queue[0];
    const pl = playlistRef.current;
    if (!pl.length) return null;
    const next = (playlistIdxRef.current + 1) % pl.length;
    return pl[next] || null;
  }

  function cancelCrossfade() {
    if (crossfadeAnimRef.current) {
      cancelAnimationFrame(crossfadeAnimRef.current);
      crossfadeAnimRef.current = null;
    }
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.removeAttribute('src');
      nextAudioRef.current.load();
    }
    preBufferedTrackRef.current = null;
  }

  function playTrack(track, pl, idx, albumInfo, _source) {
    try {
      const source = _source || 'direct';
      traceRef.current = telemetry.startTrace('play_requested', {
        trackId: track.id, title: track.title, source,
      });
    } catch {}

    cancelCrossfade();
    setTrackError(null);
    const i = idx ?? (pl ? pl.findIndex(t => t.id === track.id) : 0);
    setCurrentTrack(track);
    setCurrentCoverArt(track.coverArt || albumInfo?.coverArt || null);
    setCurrentAlbumInfo(albumInfo || { artist: track.artist, album: track.album, coverArt: track.coverArt });
    setIsPlaying(true);
    isPlayingRef.current = true;
    if (pl) {
      _setPlaylist(pl);
      _setPlaylistIdx(i >= 0 ? i : 0);
      setQueue([]);
    }
    if (audioRef.current) {
      audioRef.current.volume = volumeRef.current;
      // Library-first: if this is a YT preview but the track exists in the library,
      // use the library stream (faster, higher quality, no YT dependency)
      let src = track.path || buildTrackPath(track.id);
      if (track.isYtPreview && trackPathMap && trackPathMap.size > 0) {
        const libPath = trackPathMap.get(track.id);
        if (libPath) {
          src = libPath.startsWith('/') ? libPath : `/api/stream/${track.id}`;
          setCurrentTrack({ ...track, path: undefined, isYtPreview: false });
        }
      }
      // BUG-P01: If track is a YT preview with no library match, don't use a
      // /api/stream/{mbTrackId} URL that will 404 — use the YT stream path or
      // show an error if no YT video ID is available
      if (track.isYtPreview && !trackPathMap?.get(track.id)) {
        if (track.path && !track.path.startsWith('/api/stream/')) {
          src = track.path; // Already a YT stream URL
        } else if (track.ytVideoId) {
          src = `/api/yt/stream/${track.ytVideoId}`;
        } else {
          // No YT video ID and no library file — can't play this track
          setTrackError({ trackId: track.id, message: 'Track not yet downloaded' });
          return;
        }
      }
      audioRef.current.src = src;

      try {
        traceRef.current?.emit('audio_src_set', { streamUrl: src, isYtPreview: !!track.isYtPreview });
      } catch {}

      audioRef.current.play().catch(() => {});
    }
    recentlyPlayedAddedRef.current = false;
    const artist = track.artist || albumInfo?.artist || '';
    const album = track.album || albumInfo?.album || '';
    lastfm.initScrobble(artist, track.title, album);
    lastfm.nowPlaying(artist, track.title, album);
  }

  function togglePlay() {
    if (!audioRef.current || !currentTrackRef.current) return;
    if (isPlayingRef.current) {
      audioRef.current.pause();
      cancelCrossfade();
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
  }

  function _applyTrackState(nextTrack) {
    if (queue.length > 0 && queue[0].id === nextTrack.id) {
      setQueue(prev => prev.slice(1));
    } else {
      const pl = playlistRef.current;
      if (pl.length > 0) {
        const nextIdx = (playlistIdxRef.current + 1) % pl.length;
        _setPlaylistIdx(nextIdx);
      }
    }
    setCurrentTrack(nextTrack);
    setCurrentCoverArt(nextTrack.coverArt || currentAlbumInfoRef.current?.coverArt || null);
    recentlyPlayedAddedRef.current = false;
    const artist = nextTrack.artist || '';
    const album = nextTrack.album || '';
    lastfm.initScrobble(artist, nextTrack.title, album);
    lastfm.nowPlaying(artist, nextTrack.title, album);
  }

  // Internal: advance to next track immediately (used by ended/crossfade and skip queue)
  function _advanceNext(_reason) {
    const fromTrackId = currentTrackRef.current?.id || null;
    const reason = _reason || 'skip';

    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);

      try { telemetry.emit('track_advance', { fromTrackId, toTrackId: next.id, reason }); } catch {}

      const lib = libraryRef.current;
      const libTrack = lib.find(t =>
        t.title === next.title && t.artist === (next.trackArtist || next.artist)
      );
      if (libTrack) {
        playTrack(libTrack, playlistRef.current, playlistIdxRef.current, currentAlbumInfoRef.current, reason === 'ended' ? 'next' : 'queue');
        return;
      }

      if (next.ytPending) {
        cancelCrossfade();
        playFromYouTube(next.title, next.artist, next.album, next.coverArt, next.trackArtist);
        return;
      }
      playTrack(next, playlistRef.current, playlistIdxRef.current, currentAlbumInfoRef.current, reason === 'ended' ? 'next' : 'queue');
      return;
    }

    const pl = playlistRef.current;
    if (!pl.length) return;

    const next = (playlistIdxRef.current + 1) % pl.length;

    try { telemetry.emit('track_advance', { fromTrackId, toTrackId: pl[next]?.id, reason }); } catch {}

    playTrack(pl[next], null, next, undefined, reason === 'ended' ? 'next' : 'skip');
    _setPlaylistIdx(next);
  }

  // Internal: go to previous track immediately
  function _advancePrev() {
    const pl = playlistRef.current;
    if (!pl.length) return;
    const prev = (playlistIdxRef.current - 1 + pl.length) % pl.length;
    playTrack(pl[prev], null, prev, undefined, 'prev');
    _setPlaylistIdx(prev);
  }

  // Serial skip queue processor — ensures rapid skip clicks are processed one at a time
  function processSkipQueue() {
    if (skipProcessingRef.current || skipQueueRef.current.length === 0) return;
    skipProcessingRef.current = true;
    const direction = skipQueueRef.current.shift();

    if (direction === 'next') {
      _advanceNext('skip');
    } else {
      _advancePrev();
    }

    // Allow next skip after a short delay (ensures audio src is set)
    setTimeout(() => {
      skipProcessingRef.current = false;
      if (skipQueueRef.current.length > 0) processSkipQueue();
    }, 50);
  }

  function playNext(_reason) {
    const reason = _reason || 'skip';
    // For 'ended' source (natural track transition), execute immediately
    if (reason === 'ended') {
      _advanceNext('ended');
      return;
    }
    // For user-initiated skips, queue them to prevent rapid-click cascades
    skipQueueRef.current.push('next');
    processSkipQueue();
  }

  const prevRestartedAt = useRef(0);
  function playPrev() {
    const pl = playlistRef.current;
    if (!pl.length) return;
    const now = Date.now();
    const recentlyRestarted = (now - prevRestartedAt.current) < 2000;
    if (audioRef.current?.currentTime > 3 && !recentlyRestarted) {
      audioRef.current.currentTime = 0;
      prevRestartedAt.current = now;
      return;
    }
    prevRestartedAt.current = 0;
    skipQueueRef.current.push('prev');
    processSkipQueue();
  }

  function handleSeekClick(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  }

  // ── Crossfade & gapless ─────────────────────────────────────────────────

  function startCrossfade(nextTrack, fadeDuration) {
    if (!nextAudioRef.current || !audioRef.current) return;
    const nextSrc = nextTrack.path || buildTrackPath(nextTrack.id);
    if (preBufferedTrackRef.current?.id !== nextTrack.id) {
      nextAudioRef.current.src = nextSrc;
      nextAudioRef.current.load();
    }
    nextAudioRef.current.volume = 0;
    nextAudioRef.current.play().catch(() => {});
    const startTime = performance.now();
    const fadeMs = fadeDuration * 1000;
    const startVol = volumeRef.current;
    function fadeStep(now) {
      const elapsed = now - startTime;
      const pct = Math.min(1, elapsed / fadeMs);
      if (audioRef.current) audioRef.current.volume = startVol * (1 - pct);
      if (nextAudioRef.current) nextAudioRef.current.volume = startVol * pct;
      if (pct < 1) {
        crossfadeAnimRef.current = requestAnimationFrame(fadeStep);
      } else {
        crossfadeAnimRef.current = null;
        const resumeTime = nextAudioRef.current?.currentTime || 0;
        if (nextAudioRef.current) {
          nextAudioRef.current.pause();
          nextAudioRef.current.removeAttribute('src');
          nextAudioRef.current.load();
        }
        preBufferedTrackRef.current = null;
        if (audioRef.current) {
          audioRef.current.src = nextSrc;
          audioRef.current.volume = startVol;
          audioRef.current.addEventListener('loadedmetadata', () => {
            if (audioRef.current) {
              audioRef.current.currentTime = resumeTime;
              audioRef.current.play().catch(() => {});
            }
          }, { once: true });
          audioRef.current.load();
        }
        _applyTrackState(nextTrack);
      }
    }
    crossfadeAnimRef.current = requestAnimationFrame(fadeStep);
  }

  function preBufferNext() {
    const nextTrack = peekNextTrack();
    if (!nextTrack) return;
    if (preBufferedTrackRef.current?.id === nextTrack.id) return;
    if (!nextAudioRef.current) return;

    if (nextTrack.ytPending) {
      const lib = libraryRef.current;
      const libTrack = lib.find(t =>
        t.title === nextTrack.title && t.artist === (nextTrack.trackArtist || nextTrack.artist)
      );
      if (libTrack) {
        const nextSrc = libTrack.path || buildTrackPath(libTrack.id);
        nextAudioRef.current.src = nextSrc;
        nextAudioRef.current.load();
        preBufferedTrackRef.current = libTrack;
        return;
      }
      return;
    }

    const nextSrc = nextTrack.path || buildTrackPath(nextTrack.id);
    nextAudioRef.current.src = nextSrc;
    nextAudioRef.current.load();
    preBufferedTrackRef.current = nextTrack;
  }

  // ── YouTube streaming ───────────────────────────────────────────────────

  async function playFromYouTube(trackTitle, albumArtist, albumName, coverArt, trackArtist, artistMbid, albumRgid, albumMbid) {
    if (ytSearching) return;
    setYtSearching(true);
    setYtPendingTrack(trackTitle);
    try {
      const searchArtist = trackArtist || albumArtist;
      const q = `${searchArtist} ${trackTitle} audio`;
      const results = await api.ytSearch(q);
      if (!results.length) throw new Error('No results');
      const best = results[0];
      const track = {
        id: `yt-${best.id}`,
        title: trackTitle,
        artist: trackArtist || albumArtist,
        album: albumName,
        coverArt,
        path: `/api/yt/stream/${best.id}`,
        isYtPreview: true,
        ytVideoId: best.id,
      };
      const info = { artist: albumArtist, album: albumName, coverArt };
      if (artistMbid) info.artistMbid = artistMbid;
      if (albumRgid) info.rgid = albumRgid;
      if (albumMbid) info.mbid = albumMbid;
      playTrack(track, [], 0, info);
      const dlArtist = trackArtist || albumArtist;
      if (dlArtist && isInLibrary && !isInLibrary(dlArtist, albumName || 'Singles')) {
        api.startYtDownload({
          url: `https://www.youtube.com/watch?v=${best.id}`,
          title: trackTitle,
          artist: dlArtist,
          album: albumName || 'Singles',
          coverArt: coverArt || null,
        }).then(() => onStartBgPoll?.()).catch(() => {});
        onSetBgStatus?.({ type: 'yt', message: `Saving: ${trackTitle}`, count: 1, done: false });
      }
    } catch (err) {
      console.error('YouTube play failed:', err);
    } finally {
      setYtSearching(false);
      setYtPendingTrack(null);
    }
  }

  function playStreamingResult(r) {
    if (r.source === 'youtube') {
      const track = {
        id: `yt-${r.id}`, title: r.title, artist: r.artist, album: '',
        coverArt: r.thumbnail, path: `/api/yt/stream/${r.id}`, isYtPreview: true, ytVideoId: r.id,
      };
      playTrack(track, [], 0, { artist: r.artist, album: r.title, coverArt: r.thumbnail });
    } else {
      playFromYouTube(r.title, r.artist, '', r.thumbnail);
    }
  }

  // ── Update playlist when AlbumView rebuilds it (library changes via SSE) ─
  // This is the key fix for BUG-014/18/19/20: when AlbumView passes a new `pl`
  // to playTrack, the ref updates immediately. But we also need to handle the
  // case where AlbumView rebuilds pl WITHOUT the user clicking a track.
  const updatePlaylist = useCallback((newPl) => {
    if (!newPl || !newPl.length) return;
    // Only update if we're currently playing from this album
    const currentPl = playlistRef.current;
    if (currentPl.length === 0) return;
    // Check if the new playlist is for the same album (same track titles)
    const currentFirst = currentPl[0]?.title;
    const newFirst = newPl[0]?.title;
    if (currentFirst !== newFirst && currentPl.length !== newPl.length) return;
    _setPlaylist(newPl);
  }, []);

  // ── Audio element event handlers ────────────────────────────────────────

  const audioHandlers = {
    onTimeUpdate: () => {
      if (!audioRef.current) return;
      const ct = audioRef.current.currentTime;
      const dur = audioRef.current.duration || 0;
      setProgress(ct);
      setDuration(dur);
      if (!recentlyPlayedAddedRef.current && ct >= 2 && currentAlbumInfoRef.current) {
        recentlyPlayedAddedRef.current = true;
        addToRecentlyPlayed?.({
          artist: currentAlbumInfoRef.current.artist || currentTrackRef.current?.artist || '',
          album: currentAlbumInfoRef.current.album || currentTrackRef.current?.album || '',
          coverArt: currentAlbumInfoRef.current.coverArt || currentTrackRef.current?.coverArt || null,
          mbid: currentAlbumInfoRef.current.mbid || null,
          rgid: currentAlbumInfoRef.current.rgid || null,
        });
      }
      lastfm.checkScrobble(ct, dur);
      if (dur > 0 && !crossfadeAnimRef.current) {
        const remaining = dur - ct;
        const fadeTime = crossfadeDuration || 0;
        const preBufferThreshold = Math.max(10, fadeTime + 2);
        if (remaining <= preBufferThreshold && remaining > 0) {
          preBufferNext();
        }
        if (fadeTime > 0 && remaining <= fadeTime && remaining > 0.5) {
          const nextTrack = peekNextTrack();
          if (nextTrack && (!nextTrack.ytPending || preBufferedTrackRef.current?.id)) {
            startCrossfade(nextTrack, remaining);
          }
        }
      }
    },
    onEnded: () => {
      try {
        traceRef.current?.emit('audio_ended', {
          trackId: currentTrackRef.current?.id,
          durationPlayed: audioRef.current?.currentTime,
        });
      } catch {}

      if (!isPlayingRef.current) return;
      if (crossfadeAnimRef.current) return;
      const nextTrack = peekNextTrack();
      if (nextTrack && !nextTrack.ytPending && preBufferedTrackRef.current?.id === nextTrack.id && nextAudioRef.current) {
        const nextSrc = nextAudioRef.current.src;
        nextAudioRef.current.pause();
        nextAudioRef.current.removeAttribute('src');
        nextAudioRef.current.load();
        preBufferedTrackRef.current = null;
        if (audioRef.current) {
          audioRef.current.src = nextSrc;
          audioRef.current.volume = volumeRef.current;
          audioRef.current.play().catch(() => {});
        }
        _applyTrackState(nextTrack);
      } else {
        playNext('ended');
      }
    },
    onCanPlay: () => {
      try { traceRef.current?.emit('audio_canplay', { trackId: currentTrackRef.current?.id }); } catch {}
      // Pre-buffer next track as soon as current starts playing (gives full track duration to load)
      preBufferNext();
    },
    onPlay: () => {
      setIsPlaying(true);
      isPlayingRef.current = true;
      try { traceRef.current?.emit('audio_playing', { trackId: currentTrackRef.current?.id }); } catch {}
    },
    onPause: () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
    },
    onError: (e) => {
      const src = audioRef.current?.src || '';
      console.warn('[player] Audio error:', e?.target?.error?.message || 'unknown', 'src:', src);
      try {
        traceRef.current?.emit('audio_error', {
          error: e?.target?.error?.message || 'unknown',
          src,
        });
      } catch {}
      setTrackError({ trackId: currentTrackRef.current?.id, message: e?.target?.error?.message || 'Failed to load' });
      setIsPlaying(false);
      isPlayingRef.current = false;
    },
    onStalled: () => {
      try {
        const buf = audioRef.current?.buffered;
        const buffered = buf && buf.length > 0
          ? Array.from({ length: buf.length }, (_, i) => [buf.start(i), buf.end(i)])
          : [];
        telemetry.emit('audio_stall', { trackId: currentTrackRef.current?.id, buffered });
      } catch {}
    },
  };

  return {
    currentTrack, setCurrentTrack,
    currentAlbumInfo, setCurrentAlbumInfo,
    isPlaying, setIsPlaying,
    volume, setVolume,
    progress, setProgress,
    duration, setDuration,
    // Playlist: expose ref values as state-like for compatibility, plus setter
    playlist, setPlaylist: _setPlaylist,
    playlistIdx, setPlaylistIdx: _setPlaylistIdx,
    playlistVersion, // UI components can depend on this to re-render
    currentCoverArt, setCurrentCoverArt,
    crossfadeDuration, setCrossfadeDuration,
    trackError,
    ytSearching,
    ytPendingTrack,
    hoveredTrack, setHoveredTrack,
    hoveredMbTrack, setHoveredMbTrack,
    audioRef, nextAudioRef,
    recentlyPlayedAddedRef,
    // Functions
    playTrack, togglePlay, playNext, playPrev,
    handleSeekClick,
    cancelCrossfade,
    peekNextTrack,
    playFromYouTube,
    playStreamingResult,
    updatePlaylist,
    // Audio event handlers
    audioHandlers,
  };
}
