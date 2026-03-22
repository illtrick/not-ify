import { useState, useRef, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { buildTrackPath } from '../utils';

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

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    try { localStorage.setItem('notify_crossfade', String(crossfadeDuration)); } catch {}
  }, [crossfadeDuration]);

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

  function playTrack(track, pl, idx, albumInfo) {
    cancelCrossfade();
    const i = idx ?? (pl ? pl.findIndex(t => t.id === track.id) : 0);
    setCurrentTrack(track);
    setCurrentCoverArt(track.coverArt || null);
    setCurrentAlbumInfo(albumInfo || { artist: track.artist, album: track.album, coverArt: track.coverArt });
    setIsPlaying(true);
    if (pl) { setPlaylist(pl); setPlaylistIdx(i >= 0 ? i : 0); }
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.src = track.path || buildTrackPath(track.id);
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

  function playNext() {
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      if (next.ytPending) {
        cancelCrossfade();
        playFromYouTube(next.title, next.artist, next.album, next.coverArt, next.trackArtist);
        return;
      }
      playTrack(next, playlist, playlistIdx, currentAlbumInfo);
      return;
    }
    if (!playlist.length) return;
    const next = (playlistIdx + 1) % playlist.length;
    playTrack(playlist[next], null, next);
    setPlaylistIdx(next);
  }

  function playPrev() {
    if (!playlist.length) return;
    if (audioRef.current?.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    const prev = (playlistIdx - 1 + playlist.length) % playlist.length;
    playTrack(playlist[prev], null, prev);
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
    if (!nextTrack || nextTrack.ytPending) return;
    if (preBufferedTrackRef.current?.id === nextTrack.id) return;
    if (!nextAudioRef.current) return;
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
          if (nextTrack && !nextTrack.ytPending) {
            startCrossfade(nextTrack, remaining);
          }
        }
      }
    },
    onEnded: () => {
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
        playNext();
      }
    },
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onError: () => {
      if (currentTrack) {
        console.warn('Audio load failed for:', currentTrack.title, '— skipping to next');
        // Auto-advance to next track (handles deleted/missing tracks)
        if (playlist.length > 0 && playlistIdx < playlist.length - 1) {
          playNext();
        } else {
          setCurrentTrack(null);
          setIsPlaying(false);
        }
      }
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
