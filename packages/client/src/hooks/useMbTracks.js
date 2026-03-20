import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { getCachedMbTracks } from '@not-ify/shared';

export function useMbTracks(selectedAlbum, setSelectedAlbum) {
  const [mbTracks, setMbTracks] = useState([]);

  useEffect(() => {
    if (selectedAlbum?.fromSearch && (selectedAlbum?.mbid || selectedAlbum?.rgid)) {
      setMbTracks([]);
      const cacheKey = selectedAlbum.mbid || selectedAlbum.rgid;
      const cached = getCachedMbTracks(cacheKey);
      if (selectedAlbum.mbid) {
        (cached || api.getMbReleaseTracks(selectedAlbum.mbid))
          .then(d => setMbTracks(d.tracks || []))
          .catch(() => {});
      } else if (selectedAlbum.rgid) {
        (cached || api.getMbRgTracks(selectedAlbum.rgid))
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

  return mbTracks;
}
