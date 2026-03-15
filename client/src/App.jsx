import React, { useState, useEffect, useRef, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLORS = {
  bg: '#121212',
  surface: '#1e1e1e',
  hover: '#282828',
  card: '#181818',
  accent: '#e94560',
  accentHover: '#ff6b81',
  textPrimary: '#f5f5f5',
  textSecondary: '#b0b0b0',
  border: '#333',
  success: '#4caf50',
  error: '#e94560',
};

// ---------------------------------------------------------------------------
// SVG Icons — crisp at any size, consistent across platforms
// ---------------------------------------------------------------------------
const Icon = {
  play: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  ),
  pause: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  ),
  skipPrev: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
  ),
  skipNext: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M16 18h2V6h-2v12zM6 18l8.5-6L6 6v12z" />
    </svg>
  ),
  plus: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" style={{ display: 'block' }}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  queue: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h12v2H3v-2zm16-1v-3.5l4 4.5-4 4.5V17h-4v-2h4z" />
    </svg>
  ),
  volumeHigh: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  ),
  volumeLow: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  ),
  volumeMute: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  ),
  close: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" style={{ display: 'block' }}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  back: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  music: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  ),
  chevronUp: (size = 12, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
  chevronDown: (size = 12, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  search: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  libraryIcon: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
    </svg>
  ),
  // Track status indicators — subtle, small
  checkCircle: (size = 14, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" fill="none" />
      <path d="M8 12l3 3 5-5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  downloading: (size = 14, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M12 4v12m0 0l-4-4m4 4l4-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  clock: (size = 14, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" fill="none" />
      <path d="M12 6v6l4 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  gear: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  ),
  menu: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" style={{ display: 'block' }}>
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function buildTrackPath(id) { return `/api/stream/${id}`; }

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

const SESSION_KEY = 'notify-session';
const SEARCH_HISTORY_KEY = 'notify-search-history';
const RECENTLY_PLAYED_KEY = 'notify-recently-played';
const MAX_SEARCH_HISTORY = 8;
const MAX_RECENTLY_PLAYED = 12;

function trackRowStyle(isActive, isHovered) {
  return {
    display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: 4,
    cursor: 'pointer', gap: 0, minHeight: 44,
    background: isActive ? 'rgba(255,255,255,0.08)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
    transition: 'background 0.15s ease',
  };
}

// ---------------------------------------------------------------------------
// AlbumArt component — shows cover with placeholder fallback
// ---------------------------------------------------------------------------
function AlbumArt({ src, size = 48, radius = 4, style = {}, artist, album }) {
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

// ---------------------------------------------------------------------------
// SkeletonCard — shimmer placeholder
// ---------------------------------------------------------------------------
function SkeletonCard() {
  return (
    <div style={{ background: COLORS.card, borderRadius: 8, overflow: 'hidden', padding: 12 }}>
      <div className="skeleton" style={{ width: '100%', paddingBottom: '100%', borderRadius: 4, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '80%', borderRadius: 4, marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 12, width: '60%', borderRadius: 4 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopResultCard — large featured card for best search match
// ---------------------------------------------------------------------------
function TopResultCard({ album, onClick, onPlay, isDownloading, inLibrary }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        background: hovered ? '#222' : COLORS.card,
        borderRadius: 8, padding: 20, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 16,
        minHeight: 280, position: 'relative',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{ width: 120, height: 120, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
        <AlbumArt src={album.coverArt} size={120} radius={4} style={{ width: 120, height: 120 }} artist={album.artist} album={album.album} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

// ---------------------------------------------------------------------------
// ArtistPill — circular artist card with real photo from Deezer
// ---------------------------------------------------------------------------
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const palette = ['#e94560','#1db954','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#ff9800','#ff5722','#795548'];
  return palette[Math.abs(h) % palette.length];
}

function ArtistPill({ name, type, onClick }) {
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

// ---------------------------------------------------------------------------
// SectionHeader — uppercase label for search sections
// ---------------------------------------------------------------------------
function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 16, marginTop: 8 }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingTopResult — large featured card for best streaming match (mirrors TopResultCard)
// ---------------------------------------------------------------------------
function StreamingTopResult({ result, onPlay, onDownload, isDownloading }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        background: hovered ? '#222' : COLORS.card,
        borderRadius: 8, padding: 20, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 16,
        minHeight: 280, position: 'relative',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPlay}
    >
      <div style={{ width: 120, height: 120, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: COLORS.hover, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.music(40, COLORS.textSecondary)}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.artist || result.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: COLORS.textSecondary }}>
          <span style={{ padding: '3px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>Artist</span>
          <span style={{
            background: result.source === 'youtube' ? 'rgba(255,0,0,0.85)' : 'rgba(255,85,0,0.85)',
            color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          }}>
            {result.source === 'youtube' ? 'YouTube' : 'SoundCloud'}
          </span>
        </div>
      </div>
      {/* Hover buttons */}
      {hovered && (
        <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={e => { e.stopPropagation(); if (!isDownloading) onDownload?.(); }}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: isDownloading ? COLORS.hover : COLORS.success, border: 'none',
              cursor: isDownloading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
            title="Save to library"
            disabled={isDownloading}
          >{Icon.plus(18, '#fff')}</button>
          <button
            onClick={e => { e.stopPropagation(); onPlay?.(); }}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: COLORS.accent, border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >{Icon.play(20, '#fff')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingSongRow — track row for streaming results (mirrors Spotify Songs list)
// ---------------------------------------------------------------------------
function StreamingSongRow({ result, isActive, onPlay, onDownload, isDownloading }) {
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

// ---------------------------------------------------------------------------
// AlbumCard — used in both search results and library
// ---------------------------------------------------------------------------
function AlbumCard({ album, onPlay, onClick, isDownloading, inLibrary }) {
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
        borderRadius: 8, padding: 12, cursor: 'pointer',
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
                width: 48, height: 48, borderRadius: '50%',
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
              {Icon.play(20, '#fff')}
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="card-title" style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {album.album || album.artist}
        {inLibrary && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success, flexShrink: 0 }} />}
      </div>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {album.artist}{subLabel ? ` · ${subLabel}` : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
function App() {
  // Navigation
  const [view, setView] = useState('search');
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const prevViewRef = useRef('search');

  // Search
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchAlbums, setSearchAlbums] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [searchArtistResults, setSearchArtistResults] = useState([]);
  const [streamingResults, setStreamingResults] = useState([]);
  const [mbAlbums, setMbAlbums] = useState([]);
  const [otherResults, setOtherResults] = useState([]);

  // Download
  const [downloading, setDownloading] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [dlExpanded, setDlExpanded] = useState(false);
  const pendingPlayRef = useRef(false);

  // Library
  const [library, setLibrary] = useState([]);
  const [librarySortBy, setLibrarySortBy] = useState('recents');
  const [libraryFilter, setLibraryFilter] = useState('');
  const [showLibraryFilter, setShowLibraryFilter] = useState(false);

  // Player
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentAlbumInfo, setCurrentAlbumInfo] = useState(null); // { artist, album, coverArt }
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playlist, setPlaylist] = useState([]);
  const [playlistIdx, setPlaylistIdx] = useState(0);
  const [currentCoverArt, setCurrentCoverArt] = useState(null);
  const audioRef = useRef(null);

  // Hover state
  const [hoveredTrack, setHoveredTrack] = useState(null);
  const [hoveredMbTrack, setHoveredMbTrack] = useState(null);

  // MusicBrainz track listing for search album detail
  const [mbTracks, setMbTracks] = useState([]);

  // Gradient album header
  const [albumColor, setAlbumColor] = useState(null);
  const albumHeaderRef = useRef(null);
  const mainContentRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  // Queue
  const [queue, setQueue] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  // YouTube quick-play
  const [ytSearching, setYtSearching] = useState(false);
  const [ytPendingTrack, setYtPendingTrack] = useState(null); // title of track being resolved

  // Artist page
  const [selectedArtist, setSelectedArtist] = useState(null); // { mbid, name, type }
  const [artistReleases, setArtistReleases] = useState([]);

  // Background download status (discrete indicator)
  const [bgDownloadStatus, setBgDownloadStatus] = useState(null); // { type: 'yt'|'torrent', message, count, done }
  const bgPollRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items: [{label, action, danger?}] }

  // Last.fm
  const [lastfmStatus, setLastfmStatus] = useState({ configured: false, authenticated: false, username: null });
  const [showSettings, setShowSettings] = useState(false);
  const [lastfmApiKey, setLastfmApiKey] = useState('');
  const [lastfmApiSecret, setLastfmApiSecret] = useState('');
  const [lastfmAuthStep, setLastfmAuthStep] = useState(0); // 0=config, 1=authorize, 2=done
  const [lastfmAuthUrl, setLastfmAuthUrl] = useState('');
  const [lastfmAuthToken, setLastfmAuthToken] = useState('');
  const [lastfmError, setLastfmError] = useState('');
  const [lastfmTopArtists, setLastfmTopArtists] = useState([]);
  const scrobbleRef = useRef({ artist: '', track: '', album: '', startTime: 0, duration: 0, scrobbled: false });

  // Search & play history
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || []; } catch { return []; }
  });
  const [recentlyPlayed, setRecentlyPlayed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || []; } catch { return []; }
  });

  // Track download status (per-title tracking for status indicators)
  // Map of normalized "artist::title" → 'queued' | 'active' | 'done'
  const [dlTrackStatus, setDlTrackStatus] = useState(new Map());

  // Mobile responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Ref mirror of lastfmStatus so onTimeUpdate closure always sees latest
  const lastfmStatusRef = useRef(lastfmStatus);
  useEffect(() => { lastfmStatusRef.current = lastfmStatus; }, [lastfmStatus]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Session restore on mount
  useEffect(() => {
    loadLibrary();
    // Check Last.fm status
    fetch('/api/lastfm/status').then(r => r.json()).then(s => {
      setLastfmStatus(s);
      if (s.authenticated && s.username) {
        fetch(`/api/lastfm/top/artists?period=overall&limit=8`).then(r => r.json()).then(a => setLastfmTopArtists(a || [])).catch(() => {});
      }
    }).catch(() => {});
    // Check for URL query param search (e.g. ?q=daft+punk)
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('q');
    if (urlQuery) {
      // Clean the URL without reload
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => handleSearch(null, urlQuery), 0);
      return; // Skip session restore when URL search is present
    }
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.volume != null) setVolume(s.volume);
      if (s.view) setView(s.view);
      if (s.selectedAlbum) setSelectedAlbum(s.selectedAlbum);
      if (s.queue) setQueue(s.queue);
      if (s.playlist) setPlaylist(s.playlist);
      if (s.playlistIdx != null) setPlaylistIdx(s.playlistIdx);
      if (s.currentTrack && !s.currentTrack.isYtPreview) {
        setCurrentTrack(s.currentTrack);
        setCurrentAlbumInfo(s.currentAlbumInfo || null);
        setCurrentCoverArt(s.currentTrack.coverArt || null);
        if (audioRef.current) {
          audioRef.current.src = s.currentTrack.path || buildTrackPath(s.currentTrack.id);
          audioRef.current.addEventListener('loadedmetadata', () => {
            if (s.progress) audioRef.current.currentTime = s.progress;
          }, { once: true });
        }
      }
    } catch {}
  }, []);

  // Session save — stable debounced fn reads from ref to always have latest values
  const sessionDataRef = useRef({});
  useEffect(() => {
    sessionDataRef.current = { currentTrack, currentAlbumInfo, playlist, playlistIdx, volume, view, selectedAlbum, queue };
  }, [currentTrack, currentAlbumInfo, playlist, playlistIdx, volume, view, selectedAlbum, queue]);

  const saveSession = useRef(debounce(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        ...sessionDataRef.current,
        progress: audioRef.current?.currentTime || 0,
      }));
    } catch {}
  }, 500)).current;

  useEffect(() => { saveSession(); }, [currentTrack, currentAlbumInfo, playlist, playlistIdx, volume, view, selectedAlbum, queue]);

  // Save progress on beforeunload for accurate resume
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : {};
        s.progress = audioRef.current?.currentTime || 0;
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      } catch {}
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Fetch MB track listing when opening a search album with an mbid or rgid
  useEffect(() => {
    if (selectedAlbum?.fromSearch && (selectedAlbum?.mbid || selectedAlbum?.rgid)) {
      setMbTracks([]);
      if (selectedAlbum.mbid) {
        fetch(`/api/mb/release/${selectedAlbum.mbid}/tracks`)
          .then(r => r.json())
          .then(d => setMbTracks(d.tracks || []))
          .catch(() => {});
      } else if (selectedAlbum.rgid) {
        fetch(`/api/mb/release-group/${selectedAlbum.rgid}/tracks`)
          .then(r => r.json())
          .then(d => {
            setMbTracks(d.tracks || []);
            // Update mbid if we resolved one
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

  // Fetch dominant color from cover art for gradient header
  useEffect(() => {
    setAlbumColor(null);
    setShowStickyHeader(false);
    if (!selectedAlbum?.coverArt) return;
    const url = selectedAlbum.coverArt.replace('/api/cover/', '/api/cover/') + '/color';
    fetch(url).then(r => r.json()).then(d => { if (d.color) setAlbumColor(d.color); }).catch(() => {});
  }, [selectedAlbum]);

  // Sticky header via IntersectionObserver
  useEffect(() => {
    if (view !== 'album' || !albumHeaderRef.current || !mainContentRef.current) {
      setShowStickyHeader(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHeader(!entry.isIntersecting),
      { root: mainContentRef.current, threshold: 0 }
    );
    observer.observe(albumHeaderRef.current);
    return () => observer.disconnect();
  }, [view, selectedAlbum]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // -------------------------------------------------------------------------
  // Library
  // -------------------------------------------------------------------------
  async function loadLibrary() {
    try {
      const res = await fetch('/api/library');
      const data = await res.json();
      setLibrary(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Library load failed:', err);
    }
  }

  function groupLibrary(tracks) {
    return tracks.reduce((acc, t) => {
      const artist = t.artist || 'Unknown Artist';
      const album = t.album || 'Unknown Album';
      if (!acc[artist]) acc[artist] = {};
      if (!acc[artist][album]) acc[artist][album] = { tracks: [], coverArt: t.coverArt || null, mbid: t.mbid || null };
      acc[artist][album].tracks.push(t);
      return acc;
    }, {});
  }

  // Build library as flat album list for card grid
  function libraryAlbums() {
    const grouped = groupLibrary(library);
    const albums = [];
    for (const [artist, albumMap] of Object.entries(grouped)) {
      for (const [albumName, { tracks, coverArt, mbid }] of Object.entries(albumMap)) {
        albums.push({ artist, album: albumName, tracks, coverArt, mbid, trackCount: tracks.length });
      }
    }
    return albums;
  }

  // Set of normalized "artist::album" keys for quick library membership checks
  const libraryKeys = useMemo(() => {
    const s = new Set();
    libraryAlbums().forEach(a => s.add((a.artist + '::' + a.album).toLowerCase()));
    return s;
  }, [library]);

  function isInLibrary(artist, album) {
    return libraryKeys.has((artist + '::' + album).toLowerCase());
  }

  // Track download status for a given artist + track title
  // Returns: 'library' | 'active' | 'queued' | null
  function getTrackDlStatus(artist, trackTitle) {
    // Check if this specific track is in the library
    const norm = (artist + '::' + trackTitle).toLowerCase();
    // Check library: match any track with this artist + title
    const inLib = library.some(t =>
      t.artist?.toLowerCase() === artist?.toLowerCase() &&
      t.title?.toLowerCase() === trackTitle?.toLowerCase()
    );
    if (inLib) return 'library';
    // Check active downloads
    const dlStatus = dlTrackStatus.get(norm);
    if (dlStatus) return dlStatus; // 'active' or 'queued'
    return null;
  }

  // Render a subtle status indicator for a track
  function TrackStatusIcon({ status }) {
    if (!status) return null;
    if (status === 'library') return <span title="In library" style={{ opacity: 0.5, flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.checkCircle(13, COLORS.success)}</span>;
    if (status === 'active') return <span title="Downloading" className="spin-slow" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.downloading(13, COLORS.accent)}</span>;
    if (status === 'queued') return <span title="Queued" style={{ opacity: 0.4, flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.clock(13, COLORS.textSecondary)}</span>;
    return null;
  }

  // Sorted + filtered library for sidebar
  function sidebarAlbums() {
    let albums = libraryAlbums();
    if (libraryFilter) {
      const f = libraryFilter.toLowerCase();
      albums = albums.filter(a => a.album.toLowerCase().includes(f) || a.artist.toLowerCase().includes(f));
    }
    if (librarySortBy === 'alpha') {
      albums.sort((a, b) => a.album.localeCompare(b.album));
    } else if (librarySortBy === 'artist') {
      albums.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    }
    return albums;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  function addToSearchHistory(q) {
    setSearchHistory(prev => {
      const filtered = prev.filter(s => s.toLowerCase() !== q.toLowerCase());
      const next = [q, ...filtered].slice(0, MAX_SEARCH_HISTORY);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function removeFromSearchHistory(q) {
    setSearchHistory(prev => {
      const next = prev.filter(s => s !== q);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function addToRecentlyPlayed(item) {
    // item: { artist, album, coverArt, mbid, rgid }
    setRecentlyPlayed(prev => {
      const key = (item.artist + '::' + item.album).toLowerCase();
      const filtered = prev.filter(r => (r.artist + '::' + r.album).toLowerCase() !== key);
      const next = [{ ...item, playedAt: Date.now() }, ...filtered].slice(0, MAX_RECENTLY_PLAYED);
      try { localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function handleSearch(e, overrideQuery) {
    if (e?.preventDefault) e.preventDefault();
    const q = (overrideQuery || query).trim();
    if (!q) return;
    if (overrideQuery) setQuery(q);
    addToSearchHistory(q);
    setSearching(true);
    setSearchDone(false);
    setSearchAlbums([]);
    setSearchArtistResults([]);
    setStreamingResults([]);
    setMbAlbums([]);
    setOtherResults([]);
    setView('search');
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchAlbums(data.albums || []);
      setSearchArtistResults(data.artists || []);
      setStreamingResults((data.streamingResults || []).filter(r => r.duration));
      setMbAlbums(data.mbAlbums || []);
      setOtherResults(data.otherResults || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------
  function playTrack(track, pl, idx, albumInfo) {
    const i = idx ?? (pl ? pl.findIndex(t => t.id === track.id) : 0);
    setCurrentTrack(track);
    setCurrentCoverArt(track.coverArt || null);
    setCurrentAlbumInfo(albumInfo || { artist: track.artist, album: track.album, coverArt: track.coverArt });
    setIsPlaying(true);
    if (pl) { setPlaylist(pl); setPlaylistIdx(i >= 0 ? i : 0); }
    if (audioRef.current) {
      audioRef.current.src = track.path || buildTrackPath(track.id);
      audioRef.current.play().catch(() => {});
    }
    // Record recently played album
    const artist = track.artist || albumInfo?.artist || '';
    const album = track.album || albumInfo?.album || '';
    if (artist && album) {
      addToRecentlyPlayed({
        artist, album,
        coverArt: track.coverArt || albumInfo?.coverArt || null,
        mbid: albumInfo?.mbid || null,
        rgid: albumInfo?.rgid || null,
      });
    }

    // Last.fm: now playing + reset scrobble state
    scrobbleRef.current = { artist, track: track.title, album, startTime: Math.floor(Date.now() / 1000), duration: 0, scrobbled: false };
    if (lastfmStatus.authenticated && artist && track.title) {
      fetch('/api/lastfm/nowplaying', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, track: track.title, album }),
      }).catch(() => {});
    }
  }

  function togglePlay() {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setIsPlaying(true); }
  }

  function playNext() {
    // Play from user queue first
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      // If this is a pending YT track, resolve it first
      if (next.ytPending) {
        playFromYouTube(next.title, next.artist, next.album, next.coverArt);
        return;
      }
      playTrack(next, playlist, playlistIdx, currentAlbumInfo);
      return;
    }
    if (!playlist.length) return;
    const next = (playlistIdx + 1) % playlist.length;
    playTrack(playlist[next], null, next);
    setPlaylistIdx(next);
  }

  function addToQueue(track) {
    setQueue(prev => [...prev, track]);
  }

  function removeFromQueue(index) {
    setQueue(prev => prev.filter((_, i) => i !== index));
  }

  function clearQueue() {
    setQueue([]);
  }

  // YouTube quick-play: search YT and stream immediately
  async function playFromYouTube(trackTitle, albumArtist, albumName, coverArt) {
    if (ytSearching) return; // Prevent double-trigger
    setYtSearching(true);
    setYtPendingTrack(trackTitle);
    try {
      const q = `${albumArtist} ${trackTitle} audio`;
      const res = await fetch(`/api/yt/search?q=${encodeURIComponent(q)}`);
      const results = await res.json();
      if (!results.length) throw new Error('No results');
      const best = results[0];
      const track = {
        id: `yt-${best.id}`,
        title: trackTitle,
        artist: albumArtist,
        album: albumName,
        coverArt,
        path: `/api/yt/stream/${best.id}`,
        isYtPreview: true,
        ytVideoId: best.id,
      };
      playTrack(track, [], 0, { artist: albumArtist, album: albumName, coverArt });
      // Auto-download this single track in background
      if (albumArtist && !isInLibrary(albumArtist, albumName || 'Singles')) {
        fetch('/api/download/yt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: `https://www.youtube.com/watch?v=${best.id}`,
            title: trackTitle,
            artist: albumArtist,
            album: albumName || 'Singles',
            coverArt: coverArt || null,
          }),
        }).then(() => startBgPoll()).catch(() => {});
        setBgDownloadStatus({ type: 'yt', message: `Saving: ${trackTitle}`, count: 1, done: false });
      }
    } catch (err) {
      console.error('YouTube play failed:', err);
    } finally {
      setYtSearching(false);
      setYtPendingTrack(null);
    }
  }

  // Play a streaming result (YouTube direct or SoundCloud via YT search)
  function playStreamingResult(r) {
    if (r.source === 'youtube') {
      const track = {
        id: `yt-${r.id}`,
        title: r.title,
        artist: r.artist,
        album: '',
        coverArt: r.thumbnail,
        path: `/api/yt/stream/${r.id}`,
        isYtPreview: true,
        ytVideoId: r.id,
      };
      playTrack(track, [], 0, { artist: r.artist, album: r.title, coverArt: r.thumbnail });
    } else {
      playFromYouTube(r.title, r.artist, '', r.thumbnail);
    }
  }

  // Play all MB tracks via YouTube (first track immediate, rest queued)
  // Also triggers auto-download of the album
  async function playAllFromYouTube(tracks, albumArtist, albumName, coverArt) {
    if (!tracks.length) return;
    // Play first track
    await playFromYouTube(tracks[0].title, albumArtist, albumName, coverArt);
    // Queue remaining tracks as YT lookups (lazy — resolved when played)
    const queueTracks = tracks.slice(1).map(t => ({
      id: `yt-pending-${t.position}`,
      title: t.title,
      artist: albumArtist,
      album: albumName,
      coverArt,
      isYtPreview: true,
      ytPending: true, // needs YT search when it's time to play
    }));
    setQueue(queueTracks);

    // Auto-acquire the album in background
    if (!isInLibrary(albumArtist, albumName)) {
      autoAcquireAlbum({
        artist: albumArtist,
        album: albumName,
        coverArt,
        sources: selectedAlbum?.sources || [],
        mbid: selectedAlbum?.mbid,
        rgid: selectedAlbum?.rgid,
        year: selectedAlbum?.year,
        mbTracks: tracks,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Auto-acquire: download album in background when user plays something
  // -------------------------------------------------------------------------
  function autoAcquireAlbum(albumInfo) {
    // albumInfo: { artist, album, coverArt, sources, mbid, rgid, mbTracks }
    if (!albumInfo?.artist || !albumInfo?.album) return;

    // Check: does this album have torrent sources? If so, use torrent (better quality, full album)
    const torrentSrc = albumInfo.sources?.find(s => s.magnetLink);
    if (torrentSrc) {
      // Background torrent download
      setBgDownloadStatus({ type: 'torrent', message: `Saving ${albumInfo.album}...`, count: 0, done: false });
      fetch('/api/download/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magnetLink: torrentSrc.magnetLink,
          name: torrentSrc.name,
          mbid: albumInfo.mbid || null,
          artist: albumInfo.artist,
          albumName: albumInfo.album,
          year: albumInfo.year || '',
          coverArt: albumInfo.coverArt || null,
        }),
      }).then(r => r.json()).then(() => {
        // Poll for completion
        startBgPoll();
      }).catch(err => console.warn('Bg torrent start failed:', err));
      return;
    }

    // No torrent — use yt-dlp for each track
    const tracks = albumInfo.mbTracks || [];
    if (tracks.length === 0) return;

    setBgDownloadStatus({ type: 'yt', message: `Saving ${albumInfo.album}...`, count: tracks.length, done: false });

    // Resolve YT URLs for all tracks and batch-queue downloads
    (async () => {
      const ytTracks = [];
      for (const t of tracks) {
        try {
          const q = `${albumInfo.artist} ${t.title} audio`;
          const res = await fetch(`/api/yt/search?q=${encodeURIComponent(q)}`);
          const results = await res.json();
          if (results.length) {
            ytTracks.push({
              url: `https://www.youtube.com/watch?v=${results[0].id}`,
              title: t.title,
              artist: albumInfo.artist,
              album: albumInfo.album,
              coverArt: albumInfo.coverArt || null,
            });
          }
        } catch {}
      }
      if (ytTracks.length) {
        fetch('/api/download/yt/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: ytTracks }),
        }).then(() => startBgPoll()).catch(() => {});
      }
    })();
  }

  const libRefreshCountRef = useRef(0);
  function startBgPoll() {
    if (bgPollRef.current) return;
    libRefreshCountRef.current = 0;
    bgPollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/download/yt/queue');
        const data = await res.json();
        // Build per-track download status map
        const statusMap = new Map();
        if (data.active) {
          statusMap.set((data.active.artist + '::' + data.active.title).toLowerCase(), 'active');
        }
        for (const q of (data.queued || [])) {
          statusMap.set((q.artist + '::' + q.title).toLowerCase(), 'queued');
        }
        setDlTrackStatus(statusMap);
        if (data.active) {
          setBgDownloadStatus(prev => ({
            ...prev,
            message: `Saving: ${data.active.title}`,
            count: data.queued.length + 1,
            done: false,
          }));
        } else if (data.queued.length === 0) {
          // Check bg torrent status too
          const bgRes = await fetch('/api/download/background/status');
          const bgData = await bgRes.json();
          if (bgData.active) {
            setBgDownloadStatus(prev => ({
              ...prev,
              message: bgData.message || 'Downloading...',
              done: false,
            }));
          } else {
            // All done
            setBgDownloadStatus(prev => prev ? { ...prev, message: 'All saved!', done: true, count: 0 } : null);
            setDlTrackStatus(new Map());
            loadLibrary();
            clearInterval(bgPollRef.current);
            bgPollRef.current = null;
            // Auto-hide after 3s
            setTimeout(() => setBgDownloadStatus(null), 3000);
            // Run dedupe
            fetch('/api/library/dedupe', { method: 'POST' }).catch(() => {});
          }
        } else {
          setBgDownloadStatus(prev => ({
            ...prev,
            message: `Queued: ${data.queued.length} tracks`,
            count: data.queued.length,
            done: false,
          }));
        }
        // Refresh library every ~15s (not every 3s poll) to avoid re-render churn during playback
        libRefreshCountRef.current++;
        if (libRefreshCountRef.current % 5 === 0) loadLibrary();
      } catch {}
    }, 3000);
  }

  // -------------------------------------------------------------------------
  // Artist page
  // -------------------------------------------------------------------------
  async function openArtistPage(mbid, name, type) {
    setSelectedArtist({ mbid, name, type: type || null });
    setArtistReleases([]);
    prevViewRef.current = view;
    setView('artist');

    try {
      const res = await fetch(`/api/artist/${mbid}?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setArtistReleases(data.releases || []);
    } catch (err) {
      console.error('Artist page load failed:', err);
    }
  }

  function playPrev() {
    if (!playlist.length) return;
    if (audioRef.current?.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    const prev = (playlistIdx - 1 + playlist.length) % playlist.length;
    playTrack(playlist[prev], null, prev);
    setPlaylistIdx(prev);
  }

  function handleSeekClick(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  }

  // -------------------------------------------------------------------------
  // Download & SSE
  // -------------------------------------------------------------------------
  async function handleCancel() {
    try { await fetch('/api/download', { method: 'DELETE' }); } catch {}
  }

  function handleSSEEvent(event) {
    setDownloadStatus(prev => {
      const logs = [...(prev?.logs || [])];

      if (event.type === 'step') {
        logs.push(event.message);
        return { ...prev, step: event.step, total: event.total, message: event.message, logs };
      }
      if (event.type === 'progress') {
        return { ...prev, step: event.step, total: event.total, message: event.message, percent: event.percent, logs };
      }
      if (event.type === 'file') {
        if (!event.done || event.error) {
          logs.push(event.message);
        } else {
          const last = logs.length - 1;
          if (last >= 0 && (logs[last].startsWith('Downloading:') || logs[last].startsWith('Extracting:'))) {
            logs[last] = event.message;
          } else {
            logs.push(event.message);
          }
          // Auto-play first completed track
          if (event.trackId && pendingPlayRef.current) {
            pendingPlayRef.current = false;
            const track = {
              id: event.trackId,
              title: event.filename || 'Track',
              artist: prev?.artist || '',
              album: prev?.albumName || '',
              coverArt: prev?.coverArt || null,
              path: buildTrackPath(event.trackId),
            };
            playTrack(track, [track], 0, { artist: prev?.artist, album: prev?.albumName, coverArt: prev?.coverArt });
          }
          loadLibrary();
        }
        return { ...prev, step: event.step, message: event.message, fileIndex: event.fileIndex, fileTotal: event.fileTotal, logs };
      }
      if (event.type === 'complete') {
        logs.push(event.message);
        setDownloading(null);
        pendingPlayRef.current = false;
        loadLibrary();
        return { ...prev, message: event.message, complete: true, logs };
      }
      if (event.type === 'cancelled') {
        setDownloading(null);
        pendingPlayRef.current = false;
        return { ...prev, message: 'Cancelled.', cancelled: true, logs: [...logs, 'Cancelled.'] };
      }
      if (event.type === 'error') {
        setDownloading(null);
        pendingPlayRef.current = false;
        return { ...prev, message: event.message, error: true, logs: [...logs, `Error: ${event.message}`] };
      }
      return prev;
    });
  }

  async function startDownload(source, albumMeta, autoPlay) {
    setDownloading(source.id);
    setDownloadStatus({
      step: 0, message: 'Starting...', percent: null, logs: [],
      artist: albumMeta?.artist || '',
      albumName: albumMeta?.album || '',
      coverArt: albumMeta?.coverArt || null,
    });
    pendingPlayRef.current = !!autoPlay;

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magnetLink: source.magnetLink,
          name: source.name,
          mbid: albumMeta?.mbid || null,
          artist: albumMeta?.artist || '',
          albumName: albumMeta?.album || '',
          year: albumMeta?.year || '',
          coverArt: albumMeta?.coverArt || null,
        }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { handleSSEEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    } catch (err) {
      setDownloadStatus(prev => ({ ...prev, message: `Error: ${err.message}`, error: true }));
      setDownloading(null);
      pendingPlayRef.current = false;
    }
  }

  // Download a streaming result (YouTube/SoundCloud) via yt-dlp
  async function startYtDownload(result) {
    setDownloading(`stream-${result.id}`);
    setDownloadStatus({
      step: 0, message: 'Starting...', percent: null, logs: [],
      artist: result.artist || '',
      albumName: result.title || '',
      coverArt: result.thumbnail || null,
    });
    pendingPlayRef.current = true;

    try {
      const res = await fetch('/api/download/yt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: result.url,
          title: result.title,
          artist: result.artist || 'Unknown Artist',
          album: 'Singles',
          coverArt: result.thumbnail || null,
        }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { handleSSEEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    } catch (err) {
      setDownloadStatus(prev => ({ ...prev, message: `Error: ${err.message}`, error: true }));
      setDownloading(null);
      pendingPlayRef.current = false;
    }
  }

  // Cancel yt-dlp download
  async function handleYtCancel() {
    try { await fetch('/api/download/yt', { method: 'DELETE' }); } catch {}
  }

  // -------------------------------------------------------------------------
  // Open album detail
  // -------------------------------------------------------------------------
  function openAlbumFromSearch(album) {
    // Check if this album already exists in the library
    const libMatch = libraryAlbums().find(la =>
      la.artist.toLowerCase() === album.artist.toLowerCase() &&
      la.album.toLowerCase() === album.album.toLowerCase()
    );
    if (libMatch) {
      // Open as library album with playable tracks, but keep search sources
      const pl = libMatch.tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt: libMatch.coverArt }));
      setSelectedAlbum({
        artist: libMatch.artist, album: libMatch.album, year: album.year,
        tracks: pl, coverArt: libMatch.coverArt || album.coverArt,
        mbid: album.mbid || libMatch.mbid, sources: album.sources || [],
        trackCount: libMatch.trackCount, fromSearch: false, inLibrary: true,
      });
    } else {
      setSelectedAlbum({
        artist: album.artist, album: album.album, year: album.year,
        coverArt: album.coverArt, mbid: album.mbid, rgid: album.rgid,
        trackCount: album.trackCount, sources: album.sources || [],
        tracks: [], fromSearch: true,
      });
    }
    prevViewRef.current = view;
    setView('album');
  }

  function openAlbumFromLibrary(artist, albumName, tracks, coverArt, mbid) {
    const pl = tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt }));
    setSelectedAlbum({ artist, album: albumName, tracks: pl, coverArt, mbid, sources: [], fromSearch: false });
    prevViewRef.current = view;
    setView('album');
  }

  // Navigate to currently-playing album in library
  function goToCurrentAlbum() {
    if (!currentAlbumInfo) return;
    const albums = libraryAlbums();
    const match = albums.find(a => a.artist === currentAlbumInfo.artist && a.album === currentAlbumInfo.album);
    if (match) {
      openAlbumFromLibrary(match.artist, match.album, match.tracks, match.coverArt, match.mbid);
    }
  }

  // -------------------------------------------------------------------------
  // Renders
  // -------------------------------------------------------------------------

  // Search view
  function renderSearch() {
    // Pick top result: first album with mbid + cover art
    const topResult = searchAlbums.find(a => a.mbid && a.coverArt) || searchAlbums[0] || null;
    const restAlbums = searchAlbums.filter(a => a !== topResult);

    return (
      <div>
        {/* Search bar */}
        <form onSubmit={handleSearch} style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for artists, albums..."
              style={{
                flex: 1, padding: '14px 18px', borderRadius: 8,
                border: `1px solid ${COLORS.border}`, background: COLORS.hover,
                color: COLORS.textPrimary, fontSize: 16, outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = COLORS.accent}
              onBlur={e => e.target.style.borderColor = COLORS.border}
              aria-label="Search"
            />
            <button
              type="submit"
              style={{
                padding: '14px 24px', borderRadius: 8, border: 'none',
                background: COLORS.accent, color: '#fff', fontSize: 15,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Search
            </button>
          </div>
        </form>

        {/* Loading skeletons */}
        {searching && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* No torrent results — show streaming results in same layout or empty state */}
        {!searching && searchDone && searchAlbums.length === 0 && (
          streamingResults.length > 0 ? (
            <div>
              {/* Top row: Top Result + Artists/Songs — same layout as torrent results */}
              <div style={{ display: 'grid', gridTemplateColumns: searchArtistResults.length > 0 ? '1fr 1fr' : '1fr', gap: 24, marginBottom: 32 }}>
                {/* Top Result */}
                <div>
                  <SectionHeader>Top Result</SectionHeader>
                  {(() => {
                    const top = streamingResults[0];
                    return (
                      <StreamingTopResult
                        result={top}
                        onPlay={() => playStreamingResult(top)}
                        onDownload={() => startYtDownload(top)}
                        isDownloading={!!downloading}
                      />
                    );
                  })()}
                </div>

                {/* Artists (from MusicBrainz) */}
                {searchArtistResults.length > 0 && (
                  <div>
                    <SectionHeader>Artists</SectionHeader>
                    <div style={{ background: COLORS.card, borderRadius: 8, padding: 8 }}>
                      {searchArtistResults.slice(0, 5).map(a => (
                        <ArtistPill
                          key={a.mbid}
                          name={a.name}
                          type={a.type}
                          onClick={() => openArtistPage(a.mbid, a.name, a.type)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Songs list */}
              <div style={{ marginBottom: 32 }}>
                <SectionHeader>Songs</SectionHeader>
                <div style={{ background: COLORS.card, borderRadius: 8, padding: '4px 0' }}>
                  {streamingResults.slice(0, 8).map(r => (
                    <StreamingSongRow
                      key={`${r.source}-${r.id}`}
                      result={r}
                      isActive={currentTrack?.id === `yt-${r.id}`}
                      onPlay={() => playStreamingResult(r)}
                      onDownload={() => startYtDownload(r)}
                      isDownloading={!!downloading}
                    />
                  ))}
                </div>
              </div>

              {/* Albums grid (from MusicBrainz) */}
              {mbAlbums.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <SectionHeader>Albums</SectionHeader>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
                    {mbAlbums.map(album => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        isDownloading={!!downloading}
                        inLibrary={isInLibrary(album.artist, album.album)}
                        onPlay={() => openAlbumFromSearch({ ...album, sources: [] })}
                        onClick={() => openAlbumFromSearch({ ...album, sources: [] })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* More songs list */}
              {streamingResults.length > 8 && (
                <div>
                  <SectionHeader>More Songs</SectionHeader>
                  <div style={{ background: COLORS.card, borderRadius: 8, padding: '4px 0' }}>
                    {streamingResults.slice(8).map(r => (
                      <StreamingSongRow
                        key={`${r.source}-${r.id}`}
                        result={r}
                        isActive={currentTrack?.id === `yt-${r.id}`}
                        onPlay={() => playStreamingResult(r)}
                        onDownload={() => startYtDownload(r)}
                        isDownloading={!!downloading}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 80, fontSize: 15 }}>
              No results found. Try a different search.
            </div>
          )
        )}

        {/* Home state — search history, recently played, top artists */}
        {!searching && !searchDone && (
          <div>
            {/* Recent searches */}
            {searchHistory.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 10 }}>Recent Searches</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {searchHistory.map((q, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 0, background: COLORS.hover, borderRadius: 16, overflow: 'hidden' }}>
                      <button
                        onClick={() => handleSearch(null, q)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '6px 4px 6px 14px', fontSize: 13, color: COLORS.textPrimary,
                        }}
                      >{q}</button>
                      <button
                        onClick={() => removeFromSearchHistory(q)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '6px 10px 6px 4px', display: 'flex', alignItems: 'center',
                          opacity: 0.4,
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                        title="Remove"
                      >{Icon.close(10, COLORS.textSecondary)}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recently played */}
            {recentlyPlayed.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Recently Played</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
                  {recentlyPlayed.map((r, i) => {
                    const libAlbum = libraryAlbums().find(la =>
                      la.artist.toLowerCase() === r.artist.toLowerCase() && la.album.toLowerCase() === r.album.toLowerCase()
                    );
                    return (
                      <div key={i}
                        style={{ background: COLORS.card, borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                        onClick={() => {
                          if (libAlbum) openAlbumFromLibrary(libAlbum.artist, libAlbum.album, libAlbum.tracks, libAlbum.coverArt, libAlbum.mbid);
                          else handleSearch(null, `${r.artist} ${r.album}`);
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                        onMouseLeave={e => e.currentTarget.style.background = COLORS.card}
                      >
                        <div style={{ width: '100%', paddingBottom: '100%', borderRadius: 4, overflow: 'hidden', position: 'relative', marginBottom: 10, background: COLORS.hover }}>
                          {(() => {
                            const coverUrl = r.coverArt || `/api/cover/search?artist=${encodeURIComponent(r.artist)}&album=${encodeURIComponent(r.album)}`;
                            return <img src={coverUrl} alt="" loading="lazy" onError={e => e.target.style.display = 'none'}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
                          })()}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.album}</div>
                        <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.artist}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Last.fm top artists */}
            {lastfmTopArtists.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Your Top Artists</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                  {lastfmTopArtists.map((a, i) => (
                    <div key={i} style={{ background: COLORS.card, borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                      onClick={() => handleSearch(null, a.name)}
                      onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                      onMouseLeave={e => e.currentTarget.style.background = COLORS.card}>
                      <div style={{ width: '100%', paddingBottom: '100%', borderRadius: '50%', overflow: 'hidden', position: 'relative', marginBottom: 10, background: COLORS.hover }}>
                        <img src={`/api/artist/image?name=${encodeURIComponent(a.name)}`} alt="" loading="lazy"
                          onError={e => e.target.style.display = 'none'}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textSecondary }}>{parseInt(a.playcount).toLocaleString()} plays</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fallback empty state when no history at all */}
            {searchHistory.length === 0 && recentlyPlayed.length === 0 && lastfmTopArtists.length === 0 && (
              <div style={{ textAlign: 'center', marginTop: 80 }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🎵</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 8 }}>Discover music</div>
                <div style={{ fontSize: 15, color: COLORS.textSecondary }}>Search for your favorite artists and albums</div>
              </div>
            )}
          </div>
        )}

        {/* Categorized results */}
        {!searching && searchAlbums.length > 0 && (
          <div>
            {/* Top row: Top Result + Artists */}
            <div style={{ display: 'grid', gridTemplateColumns: searchArtistResults.length > 0 ? '1fr 1fr' : '1fr', gap: 24, marginBottom: 32 }}>
              {/* Top Result */}
              {topResult && (
                <div>
                  <SectionHeader>Top Result</SectionHeader>
                  <TopResultCard
                    album={topResult}
                    isDownloading={!!downloading}
                    inLibrary={isInLibrary(topResult.artist, topResult.album)}
                    onPlay={() => {
                      const best = topResult.sources?.[0];
                      if (best) startDownload(best, topResult, true);
                    }}
                    onClick={() => openAlbumFromSearch(topResult)}
                  />
                </div>
              )}

              {/* Artists */}
              {searchArtistResults.length > 0 && (
                <div>
                  <SectionHeader>Artists</SectionHeader>
                  <div style={{ background: COLORS.card, borderRadius: 8, padding: 8 }}>
                    {searchArtistResults.slice(0, 5).map(a => (
                      <ArtistPill
                        key={a.mbid}
                        name={a.name}
                        type={a.type}
                        onClick={() => openArtistPage(a.mbid, a.name, a.type)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Albums grid */}
            {restAlbums.length > 0 && (
              <div>
                <SectionHeader>Albums</SectionHeader>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
                  {restAlbums.map(album => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      isDownloading={!!downloading}
                      inLibrary={isInLibrary(album.artist, album.album)}
                      onPlay={() => {
                        const best = album.sources?.[0];
                        if (best) startDownload(best, album, true);
                      }}
                      onClick={() => openAlbumFromSearch(album)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other Results — unmatched torrents that passed filters */}
            {otherResults.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <SectionHeader>Other Results</SectionHeader>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
                  {otherResults.map(album => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      isDownloading={!!downloading}
                      inLibrary={isInLibrary(album.artist, album.album)}
                      onPlay={() => {
                        const best = album.sources?.[0];
                        if (best) startDownload(best, album, true);
                      }}
                      onClick={() => openAlbumFromSearch(album)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Album detail view
  function renderAlbum() {
    if (!selectedAlbum) return null;
    const { artist, album, year, coverArt, tracks, sources, fromSearch, trackCount } = selectedAlbum;

    const isLib = !fromSearch && tracks.length > 0;
    const pl = tracks;

    const primarySrc = sources?.[0];
    const qualityLabel = primarySrc?.quality ? `${primarySrc.quality} · ${primarySrc.sizeFormatted}` : primarySrc?.sizeFormatted || '';

    const gradBg = albumColor
      ? `linear-gradient(to bottom, rgba(${albumColor.join(',')},0.55) 0%, rgba(${albumColor.join(',')},0.15) 60%, ${COLORS.bg} 100%)`
      : `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`;

    const stickyBg = albumColor
      ? `rgba(${albumColor.join(',')},0.3)`
      : COLORS.surface;

    return (
      <div>
        {/* Sticky header (shown when main header scrolls out) */}
        {showStickyHeader && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: stickyBg, backdropFilter: 'blur(12px)',
            padding: isMobile ? '10px 12px' : '10px 28px', margin: isMobile ? '-12px -12px 0' : '-28px -28px 0',
            display: 'flex', alignItems: 'center', gap: 12,
            borderBottom: `1px solid rgba(255,255,255,0.06)`,
          }}>
            <AlbumArt src={coverArt} size={40} radius={4} artist={artist} album={album} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album}</div>
              <div style={{ fontSize: 11, color: COLORS.textSecondary }}>{artist}</div>
            </div>
            {(isLib ? pl.length > 0 : mbTracks.length > 0) && (() => {
              const isThisPlaying = isPlaying && currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
              return (
                <button
                  onClick={() => {
                    if (isThisPlaying) { togglePlay(); return; }
                    if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt });
                    else playAllFromYouTube(mbTracks, artist, album, coverArt);
                  }}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: COLORS.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >{isThisPlaying ? Icon.pause(14, '#fff') : Icon.play(14, '#fff')}</button>
              );
            })()}
          </div>
        )}

        {/* Gradient header */}
        <div ref={albumHeaderRef} style={{ margin: isMobile ? '-12px -12px 0' : '-28px -28px 0', padding: isMobile ? '12px 12px 20px' : '20px 28px 32px', background: gradBg }}>
          <button
            onClick={() => setView(prevViewRef.current === 'album' ? 'search' : (prevViewRef.current || 'search'))}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {Icon.back(16, 'rgba(255,255,255,0.7)')} Back
          </button>

          <div style={{ display: 'flex', gap: isMobile ? 14 : 24, alignItems: 'flex-end' }}>
            <AlbumArt src={coverArt} size={isMobile ? 120 : 200} radius={6} style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', flexShrink: 0 }} artist={artist} album={album} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Album</div>
              <h1 style={{ fontSize: isMobile ? 20 : 32, fontWeight: 800, color: COLORS.textPrimary, margin: '0 0 8px', lineHeight: 1.15 }}>{album}</h1>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                <span
                  style={{ cursor: 'pointer', transition: 'color 0.15s' }}
                  onClick={async () => {
                    const match = searchArtistResults.find(a => a.name.toLowerCase() === artist.toLowerCase());
                    if (match) { openArtistPage(match.mbid, match.name, match.type); return; }
                    // Search MB for artist MBID
                    try {
                      const res = await fetch(`/api/search?q=${encodeURIComponent(artist)}`);
                      const data = await res.json();
                      const mbArtist = data.artists?.find(a => a.name.toLowerCase() === artist.toLowerCase()) || data.artists?.[0];
                      if (mbArtist?.mbid) { openArtistPage(mbArtist.mbid, mbArtist.name, mbArtist.type); return; }
                    } catch {}
                    handleSearch(null, artist);
                  }}
                  onMouseEnter={e => e.target.style.color = COLORS.textPrimary}
                  onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.7)'}
                >{artist}</span>{year ? ` · ${year}` : ''}{(trackCount || mbTracks.length) ? ` · ${trackCount || mbTracks.length} tracks` : ''}
              </div>

              {(selectedAlbum.inLibrary || isInLibrary(artist, album)) && (
                <div style={{ fontSize: 12, color: COLORS.success, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                  In Your Library
                </div>
              )}

              {fromSearch && sources.length === 0 && mbTracks.length === 0 && (
                <div style={{ fontSize: 12, color: COLORS.textSecondary, opacity: 0.6, marginTop: 4 }}>No sources available</div>
              )}

              {/* Play/Pause button — inline with album info */}
              {(isLib ? pl.length > 0 : mbTracks.length > 0) && (() => {
                const isThisAlbumPlaying = isPlaying && currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
                return (
                  <button
                    onClick={() => {
                      if (isThisAlbumPlaying) { togglePlay(); return; }
                      if (ytSearching) return;
                      if (isLib) playTrack(pl[0], pl, 0, { artist, album, coverArt });
                      else playAllFromYouTube(mbTracks, artist, album, coverArt);
                    }}
                    style={{
                      width: 48, height: 48, borderRadius: '50%', border: 'none',
                      background: ytSearching && !isLib && !isThisAlbumPlaying ? COLORS.hover : COLORS.accent,
                      cursor: ytSearching && !isLib && !isThisAlbumPlaying ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      transition: 'transform 0.1s ease, background 0.15s',
                      marginTop: 12,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = COLORS.accentHover; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = COLORS.accent; }}
                    title={isThisAlbumPlaying ? 'Pause' : 'Play'}
                  >
                    {isThisAlbumPlaying ? Icon.pause(22, '#fff') : Icon.play(22, '#fff')}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Track list (library) */}
        {isLib && (
          <div role="list" style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
              <span style={{ width: 32, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', marginRight: 16 }}>#</span>
              <span style={{ flex: 1, fontSize: 12, color: COLORS.textSecondary }}>Title</span>
              <span style={{ width: 56, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right' }}>Format</span>
            </div>
            {pl.map((track, idx) => {
              const isActive = currentTrack?.id === track.id;
              const isHovered = hoveredTrack === track.id;
              return (
                <div
                  key={track.id}
                  role="listitem"
                  style={trackRowStyle(isActive, isHovered)}
                  onClick={() => playTrack(track, pl, idx, { artist, album, coverArt })}
                  onMouseEnter={() => setHoveredTrack(track.id)}
                  onMouseLeave={() => setHoveredTrack(null)}
                  onContextMenu={e => showContextMenu(e, [
                    { label: 'Play', action: () => playTrack(track, pl, idx, { artist, album, coverArt }) },
                    { label: 'Play Next', action: () => { setQueue(prev => [track, ...prev]); } },
                    { label: 'Add to Queue', action: () => addToQueue(track) },
                    { divider: true },
                    { label: 'Remove Track', danger: true, action: () => removeTrackFromLibrary(track.id) },
                  ])}
                >
                  <span style={{ width: 32, textAlign: 'right', marginRight: 16, fontSize: 13, color: isActive ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    {isActive ? Icon.music(14, COLORS.accent) : isHovered ? Icon.play(12, COLORS.accent) : idx + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: isActive ? COLORS.accent : COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </span>
                  {/* Add to queue button (hover) */}
                  <button
                    onClick={e => { e.stopPropagation(); addToQueue(track); }}
                    title="Add to queue"
                    style={{
                      background: 'none', border: 'none',
                      cursor: 'pointer', padding: '2px 8px', opacity: isHovered ? 0.7 : 0,
                      transition: 'opacity 0.15s', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >{Icon.plus(14, COLORS.textSecondary)}</button>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: COLORS.textSecondary, textAlign: 'right', width: 36 }}>
                      {track.format?.toUpperCase()}
                    </span>
                    <span style={{ opacity: 0.45, display: 'flex', alignItems: 'center' }} title={['flac', 'wav'].includes(track.format?.toLowerCase()) ? 'Lossless' : 'Downloaded'}>
                      {Icon.checkCircle(13, ['flac', 'wav'].includes(track.format?.toLowerCase()) ? COLORS.success : COLORS.textSecondary)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* MusicBrainz track listing preview (search view) — now playable via YouTube */}
        {fromSearch && mbTracks.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
              <span style={{ width: 32, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', marginRight: 16 }}>#</span>
              <span style={{ flex: 1, fontSize: 12, color: COLORS.textSecondary }}>Title</span>
              <span style={{ width: 50, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right' }}>Duration</span>
            </div>
            {mbTracks.map((t, i) => {
              const isHovered = hoveredMbTrack === i;
              const isActive = currentTrack?.isYtPreview && currentTrack?.title === t.title && currentTrack?.artist === artist;
              const isPending = ytPendingTrack === t.title;
              return (
                <div
                  key={i}
                  style={{ ...trackRowStyle(isActive, isHovered), opacity: (ytSearching && !isPending && !isActive) ? 0.5 : 1 }}
                  onMouseEnter={() => setHoveredMbTrack(i)}
                  onMouseLeave={() => setHoveredMbTrack(null)}
                  onClick={() => {
                    if (ytSearching) return; // Block while resolving
                    const remaining = mbTracks.slice(i);
                    playAllFromYouTube(remaining, artist, album, coverArt);
                  }}
                >
                  <span style={{ width: 32, textAlign: 'right', marginRight: 16, flexShrink: 0, fontSize: 13, color: isActive ? COLORS.accent : isPending ? COLORS.accent : isHovered ? COLORS.accent : COLORS.textSecondary, cursor: ytSearching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    {isPending ? <span className="spin-slow">{Icon.music(14, COLORS.accent)}</span> : isActive ? Icon.music(14, COLORS.accent) : isHovered ? Icon.play(12, COLORS.accent) : t.position}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: isActive ? COLORS.accent : isPending ? COLORS.accent : COLORS.textPrimary }}>{t.title}</span>
                  <TrackStatusIcon status={getTrackDlStatus(artist, t.title)} />
                  {t.lengthMs && (
                    <span style={{ width: 50, textAlign: 'right', flexShrink: 0, fontSize: 13, color: COLORS.textSecondary, opacity: 0.5 }}>{formatTime(t.lengthMs / 1000)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Other versions (collapsed) */}
        {sources.length > 1 && (
          <details style={{ marginTop: 24 }}>
            <summary style={{ fontSize: 13, color: COLORS.textSecondary, cursor: 'pointer', userSelect: 'none', marginBottom: 8 }}>
              Other versions ({sources.length - 1})
            </summary>
            <div style={{ marginTop: 8 }}>
              {sources.slice(1).map((src) => (
                <div key={src.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  borderRadius: 6, marginBottom: 4, border: `1px solid ${COLORS.border}`,
                }}>
                  <button
                    onClick={() => startDownload(src, selectedAlbum, true)}
                    disabled={!!downloading}
                    style={{
                      padding: '5px 14px', borderRadius: 20, border: `1px solid ${COLORS.border}`,
                      background: 'transparent',
                      color: downloading ? COLORS.textSecondary : COLORS.textPrimary,
                      fontSize: 12, fontWeight: 500, cursor: downloading ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  ><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{Icon.plus(12, downloading ? COLORS.textSecondary : COLORS.textPrimary)} Add</span></button>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    {[src.quality, src.sizeFormatted].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

      </div>
    );
  }

  // Artist page view
  function renderArtist() {
    if (!selectedArtist) return null;
    const { mbid, name, type } = selectedArtist;
    const imageUrl = `/api/artist/image?name=${encodeURIComponent(name)}`;
    const typeLabel = type === 'Group' ? 'Band' : type === 'Person' ? 'Artist' : 'Artist';

    return (
      <div>
        {/* Artist header */}
        <div style={{ margin: isMobile ? '-12px -12px 0' : '-28px -28px 0', padding: isMobile ? '12px 12px 20px' : '40px 28px 32px', background: `linear-gradient(to bottom, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`, display: 'flex', alignItems: 'flex-end', gap: isMobile ? 14 : 24 }}>
          <button
            onClick={() => setView(prevViewRef.current === 'artist' ? 'search' : (prevViewRef.current || 'search'))}
            style={{ position: 'absolute', top: isMobile ? 8 : 20, left: isMobile ? 12 : 28, background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {Icon.back(16, 'rgba(255,255,255,0.7)')} Back
          </button>
          <img
            src={imageUrl}
            alt={name}
            style={{ width: isMobile ? 100 : 200, height: isMobile ? 100 : 200, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', flexShrink: 0 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{typeLabel}</div>
            <h1 style={{ fontSize: isMobile ? 24 : 48, fontWeight: 800, color: COLORS.textPrimary, margin: 0, lineHeight: 1.1 }}>{name}</h1>
          </div>
        </div>

        {/* Discography */}
        {artistReleases.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 16 }}>Discography</h2>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
              {artistReleases.map(rel => {
                const album = {
                  id: `mb:${rel.rgid || rel.mbid}`,
                  artist: name,
                  album: rel.album,
                  year: rel.year || '',
                  coverArt: rel.coverArt,
                  mbid: rel.mbid,
                  rgid: rel.rgid,
                  trackCount: rel.trackCount,
                  sources: [],
                };
                return (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    isDownloading={false}
                    inLibrary={isInLibrary(name, rel.album)}
                    onPlay={() => openAlbumFromSearch(album)}
                    onClick={() => openAlbumFromSearch(album)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {artistReleases.length === 0 && (
          <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 60, fontSize: 15 }}>
            Loading discography...
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Last.fm settings + auth
  // -------------------------------------------------------------------------
  async function lastfmSaveConfig() {
    setLastfmError('');
    try {
      const res = await fetch('/api/lastfm/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: lastfmApiKey, apiSecret: lastfmApiSecret }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setLastfmStatus(s => ({ ...s, configured: true }));
      // Get auth token
      const tokenRes = await fetch('/api/lastfm/auth/token');
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error);
      setLastfmAuthToken(tokenData.token);
      setLastfmAuthUrl(tokenData.authUrl);
      setLastfmAuthStep(1);
    } catch (err) {
      setLastfmError(err.message);
    }
  }

  async function lastfmCompleteAuth() {
    setLastfmError('');
    try {
      const res = await fetch('/api/lastfm/auth/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: lastfmAuthToken }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLastfmStatus({ configured: true, authenticated: true, username: data.username });
      setLastfmAuthStep(2);
      // Load top artists
      fetch('/api/lastfm/top/artists?period=overall&limit=8').then(r => r.json()).then(a => setLastfmTopArtists(a || [])).catch(() => {});
    } catch (err) {
      setLastfmError(err.message);
    }
  }

  async function lastfmDisconnect() {
    await fetch('/api/lastfm/disconnect', { method: 'POST' });
    setLastfmStatus({ configured: true, authenticated: false, username: null });
    setLastfmTopArtists([]);
    setLastfmAuthStep(0);
  }

  function renderSettingsModal() {
    if (!showSettings) return null;
    const inputStyle = {
      width: '100%', padding: '10px 12px', borderRadius: 6,
      border: `1px solid ${COLORS.border}`, background: COLORS.hover,
      color: COLORS.textPrimary, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    };
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setShowSettings(false)}>
        <div style={{ background: COLORS.surface, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>Settings</span>
            <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              {Icon.close(18, COLORS.textSecondary)}
            </button>
          </div>

          {/* Last.fm section */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Last.fm</span>
              {lastfmStatus.authenticated && (
                <span style={{ fontSize: 12, color: COLORS.success, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                  {lastfmStatus.username}
                </span>
              )}
            </div>

            {lastfmStatus.authenticated ? (
              <div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                  Connected as <strong style={{ color: COLORS.textPrimary }}>{lastfmStatus.username}</strong>. Scrobbling is active.
                </div>
                <button onClick={lastfmDisconnect} style={{
                  padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.error}`,
                  background: 'transparent', color: COLORS.error, fontSize: 13, cursor: 'pointer',
                }}>Disconnect</button>
              </div>
            ) : lastfmAuthStep === 1 ? (
              <div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                  Step 2: Authorize Not-ify on Last.fm, then click the button below.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={lastfmAuthUrl} target="_blank" rel="noopener noreferrer" style={{
                    padding: '8px 16px', borderRadius: 6, border: 'none', textDecoration: 'none',
                    background: '#d51007', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>Open Last.fm</a>
                  <button onClick={lastfmCompleteAuth} style={{
                    padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                    background: COLORS.hover, color: COLORS.textPrimary, fontSize: 13, cursor: 'pointer',
                  }}>I've Authorized</button>
                </div>
                {lastfmError && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{lastfmError}</div>}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                  Enter your Last.fm API credentials.{' '}
                  <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer"
                    style={{ color: COLORS.accent }}>Get API key</a>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  <input type="text" placeholder="API Key" value={lastfmApiKey} onChange={e => setLastfmApiKey(e.target.value)}
                    style={inputStyle} />
                  <input type="text" placeholder="Shared Secret" value={lastfmApiSecret} onChange={e => setLastfmApiSecret(e.target.value)}
                    style={inputStyle} />
                </div>
                <button onClick={lastfmSaveConfig} disabled={!lastfmApiKey || !lastfmApiSecret} style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: lastfmApiKey && lastfmApiSecret ? COLORS.accent : COLORS.hover,
                  color: lastfmApiKey && lastfmApiSecret ? '#fff' : COLORS.textSecondary,
                  fontSize: 13, fontWeight: 600, cursor: lastfmApiKey && lastfmApiSecret ? 'pointer' : 'default',
                }}>Connect</button>
                {lastfmError && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{lastfmError}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Context menu
  // -------------------------------------------------------------------------
  function showContextMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  async function removeAlbumFromLibrary(artist, album) {
    try {
      await fetch('/api/library/album', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, album }),
      });
      loadLibrary();
      // If viewing this album, go back
      if (view === 'album' && selectedAlbum?.artist === artist && selectedAlbum?.album === album) {
        setView('search');
      }
    } catch (err) {
      console.error('Failed to remove album:', err);
    }
  }

  async function removeTrackFromLibrary(trackId) {
    try {
      await fetch(`/api/library/track/${trackId}`, { method: 'DELETE' });
      loadLibrary();
    } catch (err) {
      console.error('Failed to remove track:', err);
    }
  }

  function renderContextMenu() {
    if (!contextMenu) return null;
    // Adjust position to stay within viewport
    const menuW = 200, menuH = contextMenu.items.length * 36 + 8;
    const x = Math.min(contextMenu.x, window.innerWidth - menuW - 8);
    const y = Math.min(contextMenu.y, window.innerHeight - menuH - 8);
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
        onClick={() => setContextMenu(null)}
        onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
      >
        <div style={{
          position: 'absolute', left: x, top: y, width: menuW,
          background: '#282828', borderRadius: 6, padding: '4px 0',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', border: `1px solid ${COLORS.border}`,
        }}>
          {contextMenu.items.map((item, i) => item.divider ? (
            <div key={i} style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />
          ) : (
            <div
              key={i}
              onClick={e => { e.stopPropagation(); setContextMenu(null); item.action(); }}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                color: item.danger ? '#e74c3c' : COLORS.textPrimary,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Background download indicator (discrete)
  function renderBgDownloadIndicator() {
    if (!bgDownloadStatus) return null;
    return (
      <div style={{
        padding: '6px 12px', fontSize: 11, color: bgDownloadStatus.done ? COLORS.success : COLORS.accent,
        background: COLORS.hover, borderTop: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'default',
      }}>
        {!bgDownloadStatus.done && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.accent, animation: 'pulse 1.5s ease-in-out infinite' }} />
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bgDownloadStatus.message}
        </span>
        {bgDownloadStatus.done && (
          <button onClick={() => setBgDownloadStatus(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {Icon.close(12, COLORS.textSecondary)}
          </button>
        )}
      </div>
    );
  }

  // Download indicator in sidebar
  function renderDownloadIndicator() {
    if (!downloadStatus && !downloading) return null;
    const isDone = downloadStatus?.complete || downloadStatus?.error || downloadStatus?.cancelled;
    const dots = [1, 2, 3, 4].map(s => {
      if (!downloadStatus?.step) return COLORS.border;
      if (s < downloadStatus.step) return COLORS.success;
      if (s === downloadStatus.step) return COLORS.accent;
      return COLORS.border;
    });

    return (
      <div style={{ marginTop: 'auto', padding: 12 }}>
        <div style={{ background: COLORS.hover, borderRadius: 8, padding: '10px 12px', border: `1px solid ${COLORS.border}`, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {dots.map((c, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}
              </div>
              {downloadStatus?.albumName && (
                <div style={{ fontSize: 11, color: COLORS.accentHover, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {downloadStatus.artist ? `${downloadStatus.artist} — ${downloadStatus.albumName}` : downloadStatus.albumName}
                </div>
              )}
              <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {downloadStatus?.message || 'Starting...'}
              </div>
              {downloadStatus?.percent != null && downloadStatus?.step === 3 && (
                <div style={{ height: 3, background: COLORS.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: COLORS.accent, width: `${downloadStatus.percent}%`, transition: 'width 0.4s ease' }} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {downloading && !isDone && (
                <button onClick={() => { handleCancel(); handleYtCancel(); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${COLORS.accent}`, background: 'transparent', color: COLORS.accent, cursor: 'pointer' }}>
                  Cancel
                </button>
              )}
              {isDone && (
                <button
                  onClick={() => { setDownloadStatus(null); if (downloadStatus?.complete) { loadLibrary(); } }}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none', background: downloadStatus?.complete ? COLORS.success : COLORS.error, color: '#fff', cursor: 'pointer' }}
                >
                  {downloadStatus?.complete ? 'View' : 'OK'}
                </button>
              )}
              <button
                onClick={() => setDlExpanded(v => !v)}
                style={{ padding: '3px 6px', borderRadius: 4, border: `1px solid ${COLORS.border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {dlExpanded ? Icon.chevronUp(12, COLORS.textSecondary) : Icon.chevronDown(12, COLORS.textSecondary)}
              </button>
            </div>
          </div>

          {dlExpanded && downloadStatus?.logs?.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 140, overflowY: 'auto', fontSize: 10, color: COLORS.textSecondary, fontFamily: 'monospace', background: COLORS.bg, borderRadius: 4, padding: 6 }}>
              {downloadStatus.logs.map((log, i) => <div key={i} style={{ marginBottom: 2 }}>{log}</div>)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Queue panel
  function renderQueuePanel() {
    const upcomingPlaylist = playlist.length > 0
      ? playlist.slice(playlistIdx + 1).concat(playlist.slice(0, playlistIdx))
      : [];

    return (
      <div style={{
        width: showQueue ? 320 : 0, minWidth: showQueue ? 320 : 0,
        background: COLORS.surface,
        borderLeft: showQueue ? `1px solid ${COLORS.border}` : 'none',
        overflowY: 'auto', overflowX: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>Queue</span>
          <button onClick={() => setShowQueue(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close(16, COLORS.textSecondary)}</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {/* Now Playing */}
          {currentTrack && (
            <div style={{ padding: '0 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Now playing</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <AlbumArt src={currentCoverArt} size={40} radius={4} artist={currentAlbumInfo?.artist} album={currentAlbumInfo?.album} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
                  <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.artist}</div>
                </div>
              </div>
            </div>
          )}

          {/* User queue */}
          {queue.length > 0 && (
            <div style={{ padding: '0 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1 }}>Next in queue</span>
                <button onClick={clearQueue} style={{ background: 'none', border: 'none', color: COLORS.textSecondary, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
              </div>
              {queue.map((track, idx) => (
                <div key={`q-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                  <AlbumArt src={track.coverArt} size={32} radius={3} artist={track.artist} album={track.album} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                  </div>
                  <button onClick={() => removeFromQueue(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close(12, COLORS.textSecondary)}</button>
                </div>
              ))}
            </div>
          )}

          {/* Upcoming from playlist */}
          {upcomingPlaylist.length > 0 && (
            <div style={{ padding: '0 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Next from {currentAlbumInfo?.album || 'playlist'}
              </div>
              {upcomingPlaylist.slice(0, 20).map((track, idx) => (
                <div key={`pl-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                  <AlbumArt src={track.coverArt || currentCoverArt} size={32} radius={3} artist={track.artist || currentAlbumInfo?.artist} album={track.album || currentAlbumInfo?.album} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!currentTrack && queue.length === 0 && (
            <div style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, padding: '40px 16px' }}>
              Nothing in the queue yet
            </div>
          )}
        </div>
      </div>
    );
  }

  // Player bar
  function renderPlayer() {
    const has = !!currentTrack;
    const pct = duration ? (progress / duration) * 100 : 0;
    const canGoToAlbum = has && currentAlbumInfo && library.length > 0;

    return (
      <footer style={{
        height: isMobile ? 64 : 80, minHeight: isMobile ? 64 : 80, background: COLORS.surface,
        borderTop: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', padding: isMobile ? '0 8px' : '0 16px', gap: isMobile ? 8 : 12,
      }} role="region" aria-label="Music player">

        {/* Album art + info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? undefined : 220, minWidth: 0, flexShrink: isMobile ? 1 : 0, flex: isMobile ? 1 : undefined, overflow: 'hidden' }}>
          <AlbumArt src={currentCoverArt} size={isMobile ? 40 : 52} radius={4} artist={currentAlbumInfo?.artist} album={currentAlbumInfo?.album} />
          <div
            style={{ minWidth: 0, cursor: canGoToAlbum ? 'pointer' : 'default' }}
            onClick={canGoToAlbum ? goToCurrentAlbum : undefined}
            title={canGoToAlbum ? 'Go to album' : undefined}
          >
            {has ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {currentTrack.title}
                  {currentTrack.isYtPreview && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.accent, background: 'rgba(233,69,96,0.15)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>YT</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: canGoToAlbum ? COLORS.textSecondary : COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                  {[currentTrack.artist, currentTrack.album].filter(Boolean).join(' — ') || 'Unknown'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: COLORS.textSecondary }}>No track playing</div>
            )}
          </div>
        </div>

        {/* Controls + seek */}
        <div style={{ flex: isMobile ? undefined : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 0 : 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 12 }}>
            <button onClick={playPrev} disabled={!has} aria-label="Previous"
              style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.skipPrev(isMobile ? 16 : 18, has ? COLORS.textPrimary : COLORS.border)}
            </button>
            <button onClick={togglePlay} disabled={!has} aria-label={isPlaying ? 'Pause' : 'Play'}
              style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: '50%', border: 'none', background: has ? COLORS.accent : COLORS.hover, cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {isPlaying ? Icon.pause(isMobile ? 16 : 18, has ? '#fff' : COLORS.textSecondary) : Icon.play(isMobile ? 16 : 18, has ? '#fff' : COLORS.textSecondary)}
            </button>
            <button onClick={playNext} disabled={!has} aria-label="Next"
              style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.skipNext(isMobile ? 16 : 18, has ? COLORS.textPrimary : COLORS.border)}
            </button>
          </div>

          {/* Seek — hidden on mobile */}
          {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480 }}>
            <span style={{ fontSize: 11, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(progress)}</span>
            <div
              style={{ flex: 1, height: 12, cursor: has ? 'pointer' : 'default', position: 'relative', display: 'flex', alignItems: 'center' }}
              onClick={has ? handleSeekClick : undefined}
              onMouseEnter={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '1'; }}
              onMouseLeave={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '0'; }}
              role="slider" tabIndex={has ? 0 : -1}
              aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(progress)}
              onKeyDown={e => {
                if (!audioRef.current || !duration) return;
                if (e.key === 'ArrowRight') audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
                if (e.key === 'ArrowLeft') audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
              }}
            >
              <div style={{ position: 'absolute', width: '100%', height: 4, background: COLORS.border, borderRadius: 2 }} />
              <div style={{ position: 'absolute', height: 4, background: has ? COLORS.accent : COLORS.border, borderRadius: 2, width: `${pct}%`, transition: 'width 0.1s linear' }} />
              {has && <div className="seek-thumb" style={{ position: 'absolute', left: `calc(${pct}% - 6px)`, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} />}
            </div>
            <span style={{ fontSize: 11, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(duration)}</span>
          </div>}
        </div>

        {/* Volume + Queue toggle — hidden on mobile */}
        {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setVolume(v => v === 0 ? 0.7 : 0)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label={volume === 0 ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? Icon.volumeMute(16, COLORS.textSecondary) : volume < 0.5 ? Icon.volumeLow(16, COLORS.textSecondary) : Icon.volumeHigh(16, COLORS.textSecondary)}
          </button>
          <div
            style={{ width: 90, height: 12, display: 'flex', alignItems: 'center', position: 'relative', cursor: 'pointer' }}
            onMouseEnter={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '1'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.accent; }}
            onMouseLeave={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '0'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.textPrimary; }}
          >
            <div style={{ position: 'absolute', width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            <div className="vol-fill" style={{ position: 'absolute', width: `${volume * 100}%`, height: 4, borderRadius: 2, background: COLORS.textPrimary, transition: 'background 0.15s' }} />
            <div className="vol-thumb" style={{ position: 'absolute', left: `calc(${volume * 100}% - 6px)`, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s' }} />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
              aria-label="Volume" />
          </div>
          <button
            onClick={() => setShowQueue(v => !v)}
            title="Queue"
            style={{
              position: 'relative', background: showQueue ? COLORS.hover : 'transparent', border: 'none',
              cursor: 'pointer', padding: '6px 8px', borderRadius: 4, marginLeft: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {Icon.queue(18, showQueue ? COLORS.accent : COLORS.textSecondary)}
            {queue.length > 0 && (
              <span style={{
                position: 'absolute', top: 0, right: 0,
                width: 14, height: 14, borderRadius: '50%',
                background: COLORS.accent, color: '#fff', fontSize: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700,
              }}>{queue.length}</span>
            )}
          </button>
        </div>}
      </footer>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  const albumCount = libraryAlbums().length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', overflow: 'hidden' }}>

      {/* Mobile header bar */}
      {isMobile && (
        <div style={{ height: 48, minHeight: 48, background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12 }}>
          <button onClick={() => setSidebarOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            {sidebarOpen ? Icon.close(20, COLORS.textPrimary) : Icon.menu(20, COLORS.textPrimary)}
          </button>
          <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.5px' }}>Not-ify</div>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Sidebar overlay backdrop on mobile */}
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 20 }} />
        )}

        {/* Sidebar */}
        <aside style={{
          width: 280, minWidth: 280, background: COLORS.surface,
          borderRight: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isMobile ? {
            position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 25,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.2s ease',
          } : {}),
        }}>
          {/* Top nav */}
          <div style={{ padding: '16px 12px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.5px' }}>Not-ify</div>
              <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.6 }}
                onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                title="Settings">
                {Icon.gear(18, COLORS.textSecondary)}
              </button>
            </div>
            <div
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 12px',
                borderRadius: 6, cursor: 'pointer', fontSize: 14,
                background: view === 'search' ? COLORS.hover : 'transparent',
                color: view === 'search' ? COLORS.textPrimary : COLORS.textSecondary,
                fontWeight: view === 'search' ? 600 : 400,
              }}
              onClick={() => { setView('search'); setSidebarOpen(false); }}
              role="button" tabIndex={0}
            >
              <span style={{ marginRight: 10 }}>{Icon.search(16, 'currentColor')}</span>
              <span>Search</span>
            </div>
          </div>

          {/* Library section */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', borderTop: `1px solid ${COLORS.border}`, marginTop: 4 }}>
            {/* Library header */}
            <div style={{ padding: '12px 12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: COLORS.textSecondary }}>{Icon.libraryIcon(18, COLORS.textSecondary)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>Your Library</span>
                  {albumCount > 0 && (
                    <span style={{ fontSize: 11, color: COLORS.textSecondary, background: COLORS.bg, borderRadius: 10, padding: '1px 6px' }}>
                      {albumCount}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowLibraryFilter(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
                  title="Filter library"
                >
                  {Icon.search(14, showLibraryFilter ? COLORS.accent : COLORS.textSecondary)}
                </button>
              </div>

              {/* Filter input */}
              {showLibraryFilter && (
                <input
                  type="text"
                  placeholder="Filter albums..."
                  value={libraryFilter}
                  onChange={e => setLibraryFilter(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%', padding: '6px 10px', marginBottom: 8,
                    background: COLORS.hover, border: `1px solid ${COLORS.border}`,
                    borderRadius: 4, color: COLORS.textPrimary, fontSize: 12,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              )}

              {/* Sort controls */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {[
                  { key: 'recents', label: 'Recents' },
                  { key: 'alpha', label: 'A-Z' },
                  { key: 'artist', label: 'Artist' },
                ].map(s => (
                  <button
                    key={s.key}
                    onClick={() => setLibrarySortBy(s.key)}
                    style={{
                      padding: '3px 8px', borderRadius: 12, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 600,
                      background: librarySortBy === s.key ? COLORS.textPrimary : COLORS.hover,
                      color: librarySortBy === s.key ? COLORS.bg : COLORS.textSecondary,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable album list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 6px' }}>
              {sidebarAlbums().length === 0 ? (
                <div style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, padding: '24px 12px' }}>
                  {libraryFilter ? 'No matches' : 'No music yet. Search and add some!'}
                </div>
              ) : sidebarAlbums().map(({ artist, album, tracks, coverArt, mbid }) => {
                const isActive = view === 'album' && selectedAlbum && !selectedAlbum.fromSearch
                  && selectedAlbum.artist === artist && selectedAlbum.album === album;
                const isPlaying_ = currentAlbumInfo?.artist === artist && currentAlbumInfo?.album === album;
                return (
                  <div
                    key={`${artist}::${album}`}
                    onClick={() => { openAlbumFromLibrary(artist, album, tracks, coverArt, mbid); setSidebarOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px',
                      borderRadius: 6, cursor: 'pointer',
                      background: isActive ? COLORS.hover : 'transparent',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    onContextMenu={e => showContextMenu(e, [
                      { label: 'Play', action: () => playTrack(tracks[0], tracks, 0, { artist, album, coverArt }) },
                      { label: 'Add to Queue', action: () => tracks.forEach(t => addToQueue(t)) },
                      { label: 'Go to Artist', action: async () => {
                        try {
                          const res = await fetch(`/api/search?q=${encodeURIComponent(artist)}`);
                          const data = await res.json();
                          const a = data.artists?.find(x => x.name.toLowerCase() === artist.toLowerCase()) || data.artists?.[0];
                          if (a?.mbid) openArtistPage(a.mbid, a.name, a.type);
                        } catch {}
                      }},
                      { divider: true },
                      { label: 'Remove from Library', danger: true, action: () => removeAlbumFromLibrary(artist, album) },
                    ])}
                  >
                    <AlbumArt src={coverArt} size={48} radius={4} artist={artist} album={album} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: isPlaying_ ? COLORS.accent : COLORS.textPrimary,
                      }}>
                        {album}
                      </div>
                      <div style={{
                        fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {artist}
                      </div>
                    </div>
                    {isPlaying_ && (
                      <span style={{ flexShrink: 0 }}>{Icon.volumeHigh(14, COLORS.accent)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {renderBgDownloadIndicator()}
          {renderDownloadIndicator()}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          <div ref={mainContentRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 28 }}>
            {view === 'search' && renderSearch()}
            {view === 'album' && renderAlbum()}
            {view === 'artist' && renderArtist()}
            {!['search', 'album', 'artist'].includes(view) && (
              <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 80, fontSize: 15 }}>
                Select an album from your library, or search for new music.
              </div>
            )}
          </div>
          {renderQueuePanel()}
        </main>
      </div>

      {renderPlayer()}
      {renderContextMenu()}
      {renderSettingsModal()}

      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (!audioRef.current) return;
          const ct = audioRef.current.currentTime;
          const dur = audioRef.current.duration || 0;
          setProgress(ct); setDuration(dur);
          // Last.fm scrobble check
          const sr = scrobbleRef.current;
          if (sr.duration === 0 && dur > 0) sr.duration = dur;
          if (!sr.scrobbled && sr.artist && sr.track && lastfmStatusRef.current.authenticated && dur > 30 && (ct > dur * 0.5 || ct > 240)) {
            sr.scrobbled = true;
            fetch('/api/lastfm/scrobble', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ artist: sr.artist, track: sr.track, album: sr.album, timestamp: sr.startTime, duration: Math.round(dur) }),
            }).catch(() => {});
          }
        }}
        onEnded={playNext}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => {
          // Track unavailable (deleted, stream expired) — clear it
          if (currentTrack) {
            console.warn('Audio load failed for:', currentTrack.title);
            setCurrentTrack(null);
            setIsPlaying(false);
          }
        }}
      />
    </div>
  );
}

export default App;
