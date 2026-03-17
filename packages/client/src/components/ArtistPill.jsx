import React, { useState } from 'react';
import { COLORS } from '../constants';
import { hashColor } from '../utils';

// ---------------------------------------------------------------------------
// ArtistPill — circular artist card with real photo from Deezer
// ---------------------------------------------------------------------------
export function ArtistPill({ name, type, onClick }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const color = hashColor(name);
  const initial = name.charAt(0).toUpperCase();
  const imgSrc = `/api/artist/image?name=${encodeURIComponent(name)}`;
  const subtitle = type === 'Person' ? 'Artist' : type === 'Group' ? 'Band' : 'Artist';

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent', transition: 'background 0.15s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
        {!imgError ? (
          <img
            src={imgSrc}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : initial}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{name}</div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{subtitle}</div>
      </div>
    </div>
  );
}

export default ArtistPill;
