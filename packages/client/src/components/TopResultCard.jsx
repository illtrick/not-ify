import React, { useState } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';

// ---------------------------------------------------------------------------
// TopResultCard — large featured card for best search match
// ---------------------------------------------------------------------------
export function TopResultCard({ album, onClick, onPlay, isDownloading, inLibrary, compact }) {
  const [hovered, setHovered] = useState(false);
  const artSize = compact ? 80 : 120;
  return (
    <div
      style={{
        background: hovered ? '#222' : COLORS.card,
        borderRadius: 8, padding: compact ? 14 : 20, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16,
        minHeight: compact ? 200 : 280, position: 'relative',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{ width: artSize, height: artSize, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
        <AlbumArt src={album.coverArt} size={artSize} radius={4} style={{ width: artSize, height: artSize }} artist={album.artist} album={album.album} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 20 : 28, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {album.album || album.artist}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: COLORS.textSecondary }}>
          {inLibrary && <span style={{ background: COLORS.success, color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>IN LIBRARY</span>}
          <span style={{ padding: '3px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>Album</span>
          <span>{album.artist}{album.year ? ` \u00b7 ${album.year}` : ''}</span>
        </div>
      </div>
      {/* Hover play button */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); if (!isDownloading) onPlay?.(); }}
          style={{
            position: 'absolute', bottom: 20, right: 20,
            width: 48, height: 48, borderRadius: '50%',
            background: COLORS.accent, border: 'none', color: '#fff',
            cursor: isDownloading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          disabled={isDownloading}
        >
          {Icon.play(20, '#fff')}
        </button>
      )}
    </div>
  );
}

export default TopResultCard;
