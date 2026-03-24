import { useEffect, useRef } from 'react';
import * as api from '@not-ify/shared';
import { SESSION_KEY } from '../constants';
import { debounce } from '../utils';

/**
 * Manages session persistence — saves to server (per-user, cross-device)
 * with localStorage as a fast local mirror for instant restore.
 *
 * On mount: restores from localStorage immediately, then overwrites from server.
 * On state change: debounced save to server + localStorage mirror.
 * On beforeunload: saves audio progress to localStorage synchronously.
 */
export function useSession({
  audioRef,
  onRestoreVolume,
  onRestoreView,
  onRestoreAlbum,
  onRestoreQueue,
  onRestorePlaylist,
  onRestorePlaylistIdx,
  onRestoreTrack,
  sessionData,
}) {
  const sessionDataRef = useRef(sessionData);
  useEffect(() => {
    sessionDataRef.current = sessionData;
  }, [sessionData]);

  // Debounced save — server (per-user) + localStorage mirror
  const saveSession = useRef(debounce(() => {
    const s = {
      ...sessionDataRef.current,
      progress: audioRef.current?.currentTime || 0,
    };
    // Per-user server save (cross-device)
    api.saveUserSession({ queue: s.queue || [], state: s }).catch(() => {});
    // Fast local mirror for instant restore on next load
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
  }, 500)).current;

  const deps = sessionData ? Object.values(sessionData) : [];
  useEffect(() => { saveSession(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronous progress save on unload (localStorage only)
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : {};
        s.progress = audioRef.current?.currentTime || 0;
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      } catch {}
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Restore on mount: localStorage first (instant), then server (authoritative)
  useEffect(() => {
    // 1. Instant restore from local mirror
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) _applySession(JSON.parse(raw), { onRestoreVolume, onRestoreView, onRestoreAlbum, onRestoreQueue, onRestorePlaylist, onRestorePlaylistIdx, onRestoreTrack });
    } catch {}

    // 2. Authoritative restore from server (per-user, cross-device)
    api.getUserSession()
      .then(({ state }) => {
        if (state && Object.keys(state).length > 0) {
          _applySession(state, { onRestoreVolume, onRestoreView, onRestoreAlbum, onRestoreQueue, onRestorePlaylist, onRestorePlaylistIdx, onRestoreTrack });
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch {}
        }
      })
      .catch(() => {}); // graceful degradation — localStorage already applied
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function _applySession(s, { onRestoreVolume, onRestoreView, onRestoreAlbum, onRestoreQueue, onRestorePlaylist, onRestorePlaylistIdx, onRestoreTrack }) {
  // Don't restore volume of 0 — likely a muted state, not intentional silence
  if (s.volume != null && s.volume > 0) onRestoreVolume?.(s.volume);
  if (s.view) onRestoreView?.(s.view);
  if (s.selectedAlbum) onRestoreAlbum?.(s.selectedAlbum);
  if (s.queue) onRestoreQueue?.(s.queue);
  if (s.playlist) onRestorePlaylist?.(s.playlist);
  if (s.playlistIdx != null) onRestorePlaylistIdx?.(s.playlistIdx);
  if (s.currentTrack && !s.currentTrack.isYtPreview) {
    onRestoreTrack?.(s.currentTrack, s.currentAlbumInfo, s.progress);
  }
}
