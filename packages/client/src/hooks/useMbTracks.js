import { useState, useEffect, useCallback } from 'react';
import * as api from '@not-ify/shared';
import { getCachedMbTracks } from '@not-ify/shared';

export function useMbTracks(selectedAlbum, setSelectedAlbum) {
  const [tracks, setTracks] = useState([]);
  const [editions, setEditions] = useState([]);

  useEffect(() => {
    if (selectedAlbum?.mbid || selectedAlbum?.rgid) {
      setTracks([]);
      setEditions([]);
      const cacheKey = selectedAlbum.mbid || selectedAlbum.rgid;
      const cached = getCachedMbTracks(cacheKey);
      const meta = { artist: selectedAlbum.artist, album: selectedAlbum.album, year: selectedAlbum.year };
      if (selectedAlbum.mbid && !selectedAlbum.rgid) {
        // mbid only (no rgid) — fetch tracks for specific release, no editions available
        (cached || api.getMbReleaseTracks(selectedAlbum.mbid, { ...meta, rgid: selectedAlbum.rgid }))
          .then(d => setTracks(d.tracks || []))
          .catch(() => {});
      } else if (selectedAlbum.rgid) {
        (cached || api.getMbRgTracks(selectedAlbum.rgid, meta))
          .then(d => {
            setTracks(d.tracks || []);
            setEditions(d.editions || []);
            if (d.releaseMbid && !selectedAlbum.mbid) {
              setSelectedAlbum(prev => prev ? { ...prev, mbid: d.releaseMbid } : prev);
            }
          })
          .catch(() => {});
      }
    } else {
      setTracks([]);
      setEditions([]);
    }
  }, [selectedAlbum?.mbid, selectedAlbum?.rgid]);

  const switchEdition = useCallback(async (mbid) => {
    try {
      const data = await api.getMbReleaseTracks(mbid);
      setTracks(data.tracks || []);
      setEditions(prev => prev.map(e => ({ ...e, selected: e.mbid === mbid })));
      setSelectedAlbum(prev => ({
        ...prev,
        mbid,
        coverArt: `/api/cover/${mbid}`,
      }));
    } catch (err) {
      console.warn('[useMbTracks] Failed to switch edition:', err.message);
    }
  }, [setSelectedAlbum]);

  return { tracks, editions, switchEdition };
}
