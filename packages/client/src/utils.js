import { COLORS } from './constants';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
export function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function buildTrackPath(id) { return `/api/stream/${id}`; }

// Context menu props: right-click on desktop + long-press on mobile
export function contextMenuProps(callback, ms = 500) {
  let timer = null;
  let moved = false;
  return {
    className: 'ctx-target',
    onContextMenu: (e) => callback(e),
    onTouchStart: (e) => {
      moved = false;
      const touch = e.touches[0];
      timer = setTimeout(() => {
        if (!moved) {
          // Clear any text selection the browser started during the long-press
          window.getSelection()?.removeAllRanges();
          callback({ preventDefault: () => {}, stopPropagation: () => {}, clientX: touch.clientX, clientY: touch.clientY });
        }
      }, ms);
    },
    onTouchMove: () => { moved = true; if (timer) { clearTimeout(timer); timer = null; } },
    onTouchEnd: () => { if (timer) { clearTimeout(timer); timer = null; } },
  };
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function trackRowStyle(isActive, isHovered, mobile) {
  return {
    display: 'flex', alignItems: 'center',
    padding: mobile ? '10px 8px' : `10px 16px 10px ${isActive ? 13 : 16}px`,
    borderRadius: 4, cursor: 'pointer', gap: 0, minHeight: 44,
    background: isActive ? `rgba(${COLORS.accentRgb || '233,69,96'},0.12)` : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
    borderLeft: isActive ? `3px solid ${COLORS.accent}` : '3px solid transparent',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  };
}

export function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const palette = ['#e94560','#1db954','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#ff9800','#ff5722','#795548'];
  return palette[Math.abs(h) % palette.length];
}
