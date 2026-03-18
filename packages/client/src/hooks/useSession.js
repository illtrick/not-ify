import { useEffect, useRef } from 'react';
import { SESSION_KEY } from '../constants';
import { buildTrackPath, debounce } from '../utils';

/**
 * Manages session persistence to localStorage.
 * On mount: restores saved state via the provided restore callbacks.
 * On state change: debounced save to localStorage.
 * On beforeunload: saves current audio progress.
 */
export function useSession({
  audioRef,
  // Restore callbacks (called once on mount)
  onRestoreVolume,
  onRestoreView,
  onRestoreAlbum,
  onRestoreQueue,
  onRestorePlaylist,
  onRestorePlaylistIdx,
  onRestoreTrack,
  // State to save (object that changes each render)
  sessionData,
}) {
  // Ref that always holds the latest sessionData so the debounced fn can read it
  const sessionDataRef = useRef(sessionData);
  useEffect(() => {
    sessionDataRef.current = sessionData;
  }, [sessionData]);

  // Debounced save fn — stable reference
  const saveSession = useRef(debounce(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        ...sessionDataRef.current,
        progress: audioRef.current?.currentTime || 0,
      }));
    } catch {}
  }, 500)).current;

  // Save on every relevant state change
  const deps = sessionData ? Object.values(sessionData) : [];
  useEffect(() => { saveSession(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Save progress accurately on page unload
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

  // Restore session on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.volume != null) onRestoreVolume?.(s.volume);
      if (s.view) onRestoreView?.(s.view);
      if (s.selectedAlbum) onRestoreAlbum?.(s.selectedAlbum);
      if (s.queue) onRestoreQueue?.(s.queue);
      if (s.playlist) onRestorePlaylist?.(s.playlist);
      if (s.playlistIdx != null) onRestorePlaylistIdx?.(s.playlistIdx);
      if (s.currentTrack && !s.currentTrack.isYtPreview) {
        onRestoreTrack?.(s.currentTrack, s.currentAlbumInfo, s.progress);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
