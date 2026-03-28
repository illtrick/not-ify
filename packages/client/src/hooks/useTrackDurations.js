import { useState, useEffect } from 'react';
import { buildTrackPath } from '../utils';

export function useTrackDurations(selectedAlbum) {
  const [trackDurations, setTrackDurations] = useState({});

  useEffect(() => {
    if (!selectedAlbum || selectedAlbum.fromSearch) return;
    const tracks = selectedAlbum.tracks || [];
    if (!tracks.length) return;
    let cancelled = false;
    const pendingAudios = new Set();
    const seen = new Set();
    const loadNext = (idx) => {
      if (cancelled || idx >= tracks.length) return;
      const track = tracks[idx];
      const id = track.id;
      if (!id || seen.has(id)) { loadNext(idx + 1); return; }
      seen.add(id);
      const audio = new Audio();
      pendingAudios.add(audio);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const dur = audio.duration;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        pendingAudios.delete(audio);
        if (!cancelled && dur && isFinite(dur)) {
          setTrackDurations(prev => prev[id] !== undefined ? prev : { ...prev, [id]: dur });
        }
        setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.onerror = () => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        pendingAudios.delete(audio);
        setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.src = track.path || buildTrackPath(id);
    };
    loadNext(0);
    return () => {
      cancelled = true;
      // Abort any pending Audio element requests
      for (const audio of pendingAudios) {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
      }
      pendingAudios.clear();
    };
  }, [selectedAlbum]);

  return { trackDurations, setTrackDurations };
}
