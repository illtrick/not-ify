import React, { useState } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';

// ---------------------------------------------------------------------------
// AlbumCard — used in both search results and library
// ---------------------------------------------------------------------------
export function AlbumCard({ album, onPlay, onClick, isDownloading, inLibrary }) {
  const [hovered, setHovered] = useState(false);

  // Clean secondary label: for library show track count, for search show year only
  const subLabel = album.sources
    ? (album.year || null)  // search result: just year
    : (album.trackCount ? `${album.trackCount} tracks` : null); // library

  return (
    <div
      className="album-card"
      style={{
        background: hovered ? '#222' : COLORS.card,
        borderRadius: 10, padding: 14, cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* Art with play overlay */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', marginBottom: 10 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden', background: COLORS.hover }}>
          <AlbumArt src={album.coverArt} size="100%" radius={0} style={{ width: '100%', height: '100%' }} artist={album.artist} album={album.album} />
          {/* Hover overlay */}
          <div
            className="play-overlay"
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
            onClick={e => { e.stopPropagation(); if (!isDownloading) onPlay?.(); }}
          >
            <button
              style={{
                width: 52, height: 52, borderRadius: '50%',
                background: isDownloading ? COLORS.hover : COLORS.accent,
                border: 'none',
                cursor: isDownloading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: hovered ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.9)',
                transition: 'transform 0.2s',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
              disabled={isDownloading}
              aria-label={`Play ${album.artist} - ${album.album}`}
            >
              {Icon.play(22, '#fff')}
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="card-title" style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {album.album || album.artist}
        {inLibrary && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success, flexShrink: 0 }} />}
        {album.availableVia === 'youtube' && !inLibrary && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.1)', color: COLORS.textSecondary, flexShrink: 0, letterSpacing: 0.5 }}>YT</span>
        )}
      </div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {album.artist}{subLabel ? ` · ${subLabel}` : ''}
      </div>
    </div>
  );
}

export default AlbumCard;
