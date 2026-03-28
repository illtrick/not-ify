import React from 'react';
import { COLORS } from '../constants';

export function ContextMenu({ contextMenu, setContextMenu, isMobile }) {
  if (!contextMenu) return null;

  if (isMobile) {
    // Bottom sheet on mobile
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)' }}
        onClick={() => setContextMenu(null)}
      >
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: '#282828', borderRadius: '14px 14px 0 0',
            paddingTop: 8, paddingBottom: `calc(8px + env(safe-area-inset-bottom))`,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.border, margin: '0 auto 8px' }} />
          {contextMenu.items.map((item, i) => item.divider ? (
            <div key={i} style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />
          ) : (
            <div
              key={i}
              onClick={() => { setContextMenu(null); item.action(); }}
              style={{
                padding: '12px 16px', fontSize: 15, cursor: 'pointer',
                color: item.danger ? '#e74c3c' : COLORS.textPrimary,
                minHeight: 48, display: 'flex', alignItems: 'center',
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop: positioned dropdown
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
