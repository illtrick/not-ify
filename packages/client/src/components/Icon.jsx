import React from 'react';

// ---------------------------------------------------------------------------
// SVG Icons — crisp at any size, consistent across platforms
// ---------------------------------------------------------------------------
export const Icon = {
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
  // Standard cast icon — screen with WiFi waves (Google Cast style)
  cast: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
    </svg>
  ),
  castConnected: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" fill={color} />
    </svg>
  ),
  // Device type icons for cast menu
  speaker: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 16c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  ),
  laptop: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
    </svg>
  ),
  soundbar: (size = 16, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M2 9c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V9zm4 3c0 .83.67 1.5 1.5 1.5S9 12.83 9 12s-.67-1.5-1.5-1.5S6 11.17 6 12zm4.5 0c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5zm4.5 0c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5z" />
    </svg>
  ),
};

export default Icon;
