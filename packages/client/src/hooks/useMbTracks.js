import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { getCachedMbTracks } from '@not-ify/shared';

export function useMbTracks(selectedAlbum, setSelectedAlbum) {
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    if (selectedAlbum?.mbid || selectedAlbum?.rgid) {
      setTracks([]);
      const cacheKey = selectedAlbum.mbid || selectedAlbum.rgid;
      const cached = getCachedMbTracks(cacheKey);
      const meta = { artist: selectedAlbum.artist, album: selectedAlbum.album, year: selectedAlbum.year };
      if (selectedAlbum.mbid && !selectedAlbum.rgid) {
        (cached || api.getMbReleaseTracks(selectedAlbum.mbid, { ...meta, rgid: selectedAlbum.rgid }))
          .then(d => setTracks(d.tracks || []))
          .catch(() => {});
      } else if (selectedAlbum.rgid) {
        // rgid path: server scores releases and picks the best standard edition
        // editions data returned but not used in UI (removed in v1.8.4)
        (cached || api.getMbRgTracks(selectedAlbum.rgid, meta))
          .then(d => {
            setTracks(d.tracks || []);
            if (d.releaseMbid && !selectedAlbum.mbid) {
              setSelectedAlbum(prev => prev ? { ...prev, mbid: d.releaseMbid } : prev);
            }
          })
          .catch(() => {});
      }
    } else {
      setTracks([]);
    }
  }, [selectedAlbum?.mbid, selectedAlbum?.rgid]);

  return tracks;
}
