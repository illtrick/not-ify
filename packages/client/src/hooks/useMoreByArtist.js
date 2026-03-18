import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';

export function useMoreByArtist(selectedAlbum, view, searchArtistResults) {
  const [moreByArtist, setMoreByArtist] = useState([]);

  useEffect(() => {
    setMoreByArtist([]);
    if (!selectedAlbum?.artist || view !== 'album') return;
    const artistName = selectedAlbum.artist;
    const currentAlbumTitle = selectedAlbum.album;
    const cached = searchArtistResults.find(a => a.name.toLowerCase() === artistName.toLowerCase());
    const fetchArtist = cached?.mbid
      ? Promise.resolve(cached.mbid)
      : api.search(artistName)
          .then(d => {
            const match = d.artists?.find(a => a.name.toLowerCase() === artistName.toLowerCase());
            return match?.mbid || null;
          })
          .catch(() => null);
    fetchArtist.then(artistMbid => {
      if (!artistMbid) return;
      api.getArtist(artistMbid, artistName)
        .then(d => {
          const other = (d.releases || [])
            .filter(r => r.album.toLowerCase() !== currentAlbumTitle.toLowerCase())
            .slice(0, 6);
          setMoreByArtist(other);
        })
        .catch(() => {});
    });
  }, [selectedAlbum?.artist, selectedAlbum?.album, view]);

  return moreByArtist;
}
