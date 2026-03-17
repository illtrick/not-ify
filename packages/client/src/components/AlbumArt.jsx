import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// AlbumArt component — shows cover with placeholder fallback
// ---------------------------------------------------------------------------
export function AlbumArt({ src, size = 48, radius = 4, style = {}, artist, album }) {
  const fallbackUrl = artist && album
    ? `/api/cover/search?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
    : null;

  const [phase, setPhase] = useState(() => src ? 'primary' : fallbackUrl ? 'fallback' : 'none');

  useEffect(() => { setPhase(src ? 'primary' : fallbackUrl ? 'fallback' : 'none'); }, [src]);

  const baseStyle = {
    width: size, height: size, minWidth: size, minHeight: size,
    borderRadius: radius, overflow: 'hidden',
    background: COLORS.hover, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: typeof size === 'number' ? size * 0.4 : 24, color: COLORS.textSecondary,
    flexShrink: 0, ...style,
  };

  const imgUrl = phase === 'primary' ? src
    : phase === 'fallback' ? fallbackUrl
    : null;

  if (!imgUrl) {
    return <div style={baseStyle}>{Icon.music(typeof size === 'number' ? Math.max(16, size * 0.35) : 20, COLORS.textSecondary)}</div>;
  }

  return (
    <div style={baseStyle}>
      <img
        src={imgUrl}
        alt=""
        loading="lazy"
        onError={() => {
          if (phase === 'primary' && fallbackUrl) setPhase('fallback');
          else setPhase('none');
        }}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}

export default AlbumArt;
