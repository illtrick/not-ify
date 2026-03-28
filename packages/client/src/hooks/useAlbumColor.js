import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';

export function useAlbumColor(selectedAlbum) {
  const [albumColor, setAlbumColor] = useState(null);

  useEffect(() => {
    setAlbumColor(null);
    if (!selectedAlbum?.coverArt) return;
    const url = selectedAlbum.coverArt.replace('/api/cover/', '/api/cover/') + '/color';
    api.getCoverColor(url).then(d => { if (d.color) setAlbumColor(d.color); }).catch(() => {});
  }, [selectedAlbum]);

  return albumColor;
}
