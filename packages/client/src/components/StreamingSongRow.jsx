import React, { useState } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// StreamingSongRow — track row for streaming results (mirrors Spotify Songs list)
// ---------------------------------------------------------------------------
export function StreamingSongRow({ result, isActive, onPlay, onDownload, isDownloading }) {
  const [hovered, setHovered] = useState(false);
  const dur = result.duration ? `${Math.floor(result.duration / 60)}:${String(Math.floor(result.duration % 60)).padStart(2, '0')}` : '';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 12,
        cursor: 'pointer',
        background: isActive ? 'rgba(255,255,255,0.08)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.15s ease',
        borderRadius: 4, margin: '0 4px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPlay}
    >
      {/* Thumbnail */}
      <div style={{ width: 40, height: 40, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative', background: COLORS.hover }}>
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.music(16, COLORS.textSecondary)}</div>
        )}
      </div>

      {/* Title + Artist */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: isActive ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {result.title}
        </div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
          <span style={{
            background: result.source === 'youtube' ? 'rgba(255,0,0,0.7)' : 'rgba(255,85,0,0.7)',
            color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
          }}>
            {result.source === 'youtube' ? 'YT' : 'SC'}
          </span>
          {result.artist}
        </div>
      </div>

      {/* Download button (hover) */}
      <button
        onClick={e => { e.stopPropagation(); if (!isDownloading) onDownload?.(); }}
        title="Save to library"
        style={{
          background: 'none', border: 'none',
          cursor: isDownloading ? 'not-allowed' : 'pointer', padding: '4px 6px',
          opacity: hovered ? 0.8 : 0, transition: 'opacity 0.15s', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        disabled={isDownloading}
      >{Icon.plus(16, COLORS.success)}</button>

      {/* Duration */}
      {dur && (
        <span style={{ width: 44, fontSize: 13, color: COLORS.textSecondary, textAlign: 'right', flexShrink: 0 }}>
          {dur}
        </span>
      )}
    </div>
  );
}

export default StreamingSongRow;
