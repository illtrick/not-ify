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
  // Gated by setup status: don't persist session data during first-run setup (BUG-001)
  const setupCompleteRef = useRef(false);
  const saveSession = useRef(debounce(() => {
    if (!setupCompleteRef.current) return; // setup not complete — don't save stale data
    const s = {
      ...sessionDataRef.current,
      progress: audioRef.current?.currentTime || 0,
    };
    // Per-user server save (cross-device)
    api.saveUserSession({ queue: s.queue || [], state: s }).catch(() => {});
    // Fast local mirror for instant restore on next load
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
  }, 500)).current;

  const sessionKey = sessionData ? JSON.stringify(sessionData) : '';
  useEffect(() => { saveSession(); }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Restore on mount: check setup status first, then localStorage, then server.
  // If setup is required (fresh install), clear any stale session data to prevent
  // ghost state from a previous installation (BUG-001).
  useEffect(() => {
    api.getSetupStatus()
      .then(status => {
        if (status.needsSetup) {
          // Fresh install — wipe stale session data from previous install
          try { localStorage.removeItem(SESSION_KEY); } catch {}
          return;
        }
        setupCompleteRef.current = true;
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
      })
      .catch(() => {
        // Can't check setup status — fall back to normal restore (assume setup is complete)
        setupCompleteRef.current = true;
        try {
          const raw = localStorage.getItem(SESSION_KEY);
          if (raw) _applySession(JSON.parse(raw), { onRestoreVolume, onRestoreView, onRestoreAlbum, onRestoreQueue, onRestorePlaylist, onRestorePlaylistIdx, onRestoreTrack });
        } catch {}
      });
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
