import { useState, useRef, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { buildTrackPath } from '../utils';
import { useTelemetry } from './useTelemetry';

export function usePlayer({
  queue = [],
  setQueue,
  addToRecentlyPlayed,
  lastfm,
  loadLibrary,
  isInLibrary,
  library = [],
  onStartBgPoll,
  onSetBgStatus,
} = {}) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentAlbumInfo, setCurrentAlbumInfo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playlist, setPlaylist] = useState([]);
  const [playlistIdx, setPlaylistIdx] = useState(0);
  const [currentCoverArt, setCurrentCoverArt] = useState(null);
  const [crossfadeDuration, setCrossfadeDuration] = useState(() => {
    try { return parseInt(localStorage.getItem('notify_crossfade') || '0', 10); } catch { return 0; }
  });
  const [ytSearching, setYtSearching] = useState(false);
  const [ytPendingTrack, setYtPendingTrack] = useState(null);
  const [hoveredTrack, setHoveredTrack] = useState(null);
  const [hoveredMbTrack, setHoveredMbTrack] = useState(null);

  const audioRef = useRef(null);
  const nextAudioRef = useRef(null);
  const crossfadeAnimRef = useRef(null);
  const preBufferedTrackRef = useRef(null);
  const recentlyPlayedAddedRef = useRef(false);

  // Telemetry — safe to call unconditionally (it's a hook)
  const telemetry = useTelemetry();
  const traceRef = useRef(null);
  const prevQueueLenRef = useRef(queue.length);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    try { localStorage.setItem('notify_crossfade', String(crossfadeDuration)); } catch {}
  }, [crossfadeDuration]);

  // Queue state telemetry — emit when queue length changes
  useEffect(() => {
    if (queue.length !== prevQueueLenRef.current) {
      prevQueueLenRef.current = queue.length;
      try {
        telemetry.emit('queue_state', { length: queue.length, trackIds: queue.map(t => t.id) });
      } catch {}
    }
  }, [queue, telemetry]);

  // -------------------------------------------------------------------------
  // Core playback
  // -------------------------------------------------------------------------

  function peekNextTrack() {
    if (queue.length > 0) return queue[0];
    if (!playlist.length) return null;
    const next = (playlistIdx + 1) % playlist.length;
    return playlist[next] || null;
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
    // Telemetry: start a trace for the play request
    try {
      const source = _source || 'direct';
      traceRef.current = telemetry.startTrace('play_requested', {
        trackId: track.id,
        title: track.title,
        source,
      });
    } catch {}

    cancelCrossfade();
    const i = idx ?? (pl ? pl.findIndex(t => t.id === track.id) : 0);
    setCurrentTrack(track);
    setCurrentCoverArt(track.coverArt || null);
    setCurrentAlbumInfo(albumInfo || { artist: track.artist, album: track.album, coverArt: track.coverArt });
    setIsPlaying(true);
    if (pl) {
      setPlaylist(pl);
      setPlaylistIdx(i >= 0 ? i : 0);
      // Clear the manual queue when starting a new album/playlist
      // so stale yt-pending or cross-album tracks don't hijack playback
      setQueue([]);
    }
    if (audioRef.current) {
      audioRef.current.volume = volume;
      // Library-first: if this is a YT preview but the track exists in the library,
      // use the library stream (faster, higher quality, no YT dependency)
      let src = track.path || buildTrackPath(track.id);
      if (track.isYtPreview && library.length > 0) {
        const titleLower = (track.title || '').toLowerCase();
        const artistLower = (track.artist || albumInfo?.artist || '').toLowerCase();
        const libMatch = library.find(t =>
          (t.title || '').toLowerCase() === titleLower &&
          (t.artist || '').toLowerCase() === artistLower
        );
        if (libMatch) {
          src = buildTrackPath(libMatch.id);
          // Update current track to reflect library state
          setCurrentTrack({ ...track, id: libMatch.id, path: undefined, isYtPreview: false, format: libMatch.format });
        }
      }
      audioRef.current.src = src;

      // Telemetry: audio source set
      try {
        traceRef.current?.emit('audio_src_set', {
          streamUrl: src,
          isYtPreview: !!track.isYtPreview,
        });
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
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setIsPlaying(true); }
  }

  function _applyTrackState(nextTrack) {
    if (queue.length > 0 && queue[0].id === nextTrack.id) {
      setQueue(prev => prev.slice(1));
    } else if (playlist.length > 0) {
      const nextIdx = (playlistIdx + 1) % playlist.length;
      setPlaylistIdx(nextIdx);
    }
    setCurrentTrack(nextTrack);
    setCurrentCoverArt(nextTrack.coverArt || null);
    recentlyPlayedAddedRef.current = false;
    const artist = nextTrack.artist || '';
    const album = nextTrack.album || '';
    lastfm.initScrobble(artist, nextTrack.title, album);
    lastfm.nowPlaying(artist, nextTrack.title, album);
  }

  function playNext(_reason) {
    const fromTrackId = currentTrack?.id || null;
    const reason = _reason || 'skip';

    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);

      // Telemetry: track advance
      try {
        telemetry.emit('track_advance', { fromTrackId, toTrackId: next.id, reason });
      } catch {}

      // Check if this queued track now exists in the library (it may have been
      // added to the queue as ytPending but since downloaded)
      const libTrack = library.find(t =>
        t.title === next.title && t.artist === (next.trackArtist || next.artist)
      );
      if (libTrack) {
        playTrack(libTrack, playlist, playlistIdx, currentAlbumInfo, reason === 'ended' ? 'next' : 'queue');
        return;
      }

      if (next.ytPending) {
        cancelCrossfade();
        playFromYouTube(next.title, next.artist, next.album, next.coverArt, next.trackArtist);
        return;
      }
      playTrack(next, playlist, playlistIdx, currentAlbumInfo, reason === 'ended' ? 'next' : 'queue');
      return;
    }
    if (!playlist.length) return;
    // Use pendingIdxRef to handle rapid clicks — each click advances from the
    // last requested position, not the stale React state
    const baseIdx = pendingIdxRef.current != null ? pendingIdxRef.current : playlistIdx;
    const next = (baseIdx + 1) % playlist.length;
    pendingIdxRef.current = next;
    // Clear the pending ref after React has a chance to flush state
    setTimeout(() => { pendingIdxRef.current = null; }, 0);

    // Telemetry: track advance (playlist)
    try {
      telemetry.emit('track_advance', { fromTrackId, toTrackId: playlist[next]?.id, reason });
    } catch {}

    playTrack(playlist[next], null, next, undefined, reason === 'ended' ? 'next' : 'skip');
    setPlaylistIdx(next);
  }

  // Track pending playlist index for rapid next clicks — prevents all clicks
  // reading the same stale playlistIdx from the same React render cycle
  const pendingIdxRef = useRef(null);

  const prevRestartedAt = useRef(0);
  function playPrev() {
    if (!playlist.length) return;
    const now = Date.now();
    const recentlyRestarted = (now - prevRestartedAt.current) < 2000;
    if (audioRef.current?.currentTime > 3 && !recentlyRestarted) {
      audioRef.current.currentTime = 0;
      prevRestartedAt.current = now;
      return;
    }
    prevRestartedAt.current = 0;
    const prev = (playlistIdx - 1 + playlist.length) % playlist.length;
    playTrack(playlist[prev], null, prev, undefined, 'prev');
    setPlaylistIdx(prev);
  }

  function handleSeekClick(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  }

  // -------------------------------------------------------------------------
  // Crossfade & gapless
  // -------------------------------------------------------------------------

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
    const startVol = volume;
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

    // Check if a YT-pending track has been downloaded to library since queuing
    if (nextTrack.ytPending) {
      const libTrack = library.find(t =>
        t.title === nextTrack.title && t.artist === (nextTrack.trackArtist || nextTrack.artist)
      );
      if (libTrack) {
        // Track was downloaded — pre-buffer from library
        const nextSrc = libTrack.path || buildTrackPath(libTrack.id);
        nextAudioRef.current.src = nextSrc;
        nextAudioRef.current.load();
        preBufferedTrackRef.current = libTrack;
        return;
      }
      // Still pending — can't pre-buffer, skip
      return;
    }

    const nextSrc = nextTrack.path || buildTrackPath(nextTrack.id);
    nextAudioRef.current.src = nextSrc;
    nextAudioRef.current.load();
    preBufferedTrackRef.current = nextTrack;
  }

  // -------------------------------------------------------------------------
  // YouTube streaming
  // -------------------------------------------------------------------------

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
      // Auto-download this single track in background
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
        id: `yt-${r.id}`,
        title: r.title,
        artist: r.artist,
        album: '',
        coverArt: r.thumbnail,
        path: `/api/yt/stream/${r.id}`,
        isYtPreview: true,
        ytVideoId: r.id,
      };
      playTrack(track, [], 0, { artist: r.artist, album: r.title, coverArt: r.thumbnail });
    } else {
      playFromYouTube(r.title, r.artist, '', r.thumbnail);
    }
  }

  // -------------------------------------------------------------------------
  // Audio element event handlers (returned for App.jsx to attach to <audio>)
  // -------------------------------------------------------------------------

  const audioHandlers = {
    onTimeUpdate: () => {
      if (!audioRef.current) return;
      const ct = audioRef.current.currentTime;
      const dur = audioRef.current.duration || 0;
      setProgress(ct);
      setDuration(dur);
      // Add to recently played after 2s of playback
      if (!recentlyPlayedAddedRef.current && ct >= 2 && currentAlbumInfo) {
        recentlyPlayedAddedRef.current = true;
        addToRecentlyPlayed?.({
          artist: currentAlbumInfo.artist || currentTrack?.artist || '',
          album: currentAlbumInfo.album || currentTrack?.album || '',
          coverArt: currentAlbumInfo.coverArt || currentTrack?.coverArt || null,
          mbid: currentAlbumInfo.mbid || null,
          rgid: currentAlbumInfo.rgid || null,
        });
      }
      // Last.fm scrobble
      lastfm.checkScrobble(ct, dur);
      // Gapless / crossfade pre-buffer
      if (dur > 0 && !crossfadeAnimRef.current) {
        const remaining = dur - ct;
        const fadeTime = crossfadeDuration || 0;
        const preBufferThreshold = Math.max(10, fadeTime + 2);
        if (remaining <= preBufferThreshold && remaining > 0) {
          preBufferNext();
        }
        if (fadeTime > 0 && remaining <= fadeTime && remaining > 0.5) {
          const nextTrack = peekNextTrack();
          // Allow crossfade if next track is pre-buffered (including downloaded yt-pending tracks)
          if (nextTrack && (!nextTrack.ytPending || preBufferedTrackRef.current?.id)) {
            startCrossfade(nextTrack, remaining);
          }
        }
      }
    },
    onEnded: () => {
      // Telemetry: audio ended
      try {
        traceRef.current?.emit('audio_ended', {
          trackId: currentTrack?.id,
          durationPlayed: audioRef.current?.currentTime,
        });
      } catch {}

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
          audioRef.current.volume = volume;
          audioRef.current.play().catch(() => {});
        }
        _applyTrackState(nextTrack);
      } else {
        playNext('ended');
      }
    },
    onCanPlay: () => {
      // Telemetry: audio can play
      try {
        traceRef.current?.emit('audio_canplay', { trackId: currentTrack?.id });
      } catch {}
    },
    onPlay: () => {
      setIsPlaying(true);
      // Telemetry: audio playing
      try {
        traceRef.current?.emit('audio_playing', { trackId: currentTrack?.id });
      } catch {}
    },
    onPause: () => setIsPlaying(false),
    onError: (e) => {
      // Telemetry: audio error
      try {
        traceRef.current?.emit('audio_error', {
          trackId: currentTrack?.id,
          error: e?.target?.error?.message || 'unknown',
        });
      } catch {}

      if (currentTrack) {
        console.warn('Audio load failed for:', currentTrack.title, '— skipping to next');
        // Auto-advance to next track (handles deleted/missing tracks)
        if (playlist.length > 0 && playlistIdx < playlist.length - 1) {
          playNext('error');
        } else {
          setCurrentTrack(null);
          setIsPlaying(false);
        }
      }
    },
    onStalled: () => {
      // Telemetry: audio stalled
      try {
        const buf = audioRef.current?.buffered;
        const buffered = buf && buf.length > 0
          ? Array.from({ length: buf.length }, (_, i) => [buf.start(i), buf.end(i)])
          : [];
        telemetry.emit('audio_stall', { trackId: currentTrack?.id, buffered });
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
    // Functions
    playTrack, togglePlay, playNext, playPrev,
    handleSeekClick,
    cancelCrossfade,
    peekNextTrack,
    playFromYouTube,
    playStreamingResult,
    // Audio event handlers (App.jsx attaches these to <audio> elements)
    audioHandlers,
  };
}
