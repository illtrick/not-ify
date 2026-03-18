import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

export function BottomTabBar({ isMobile, mobileTab, setMobileTab, view, setView }) {
  if (!isMobile) return null;
  const tabs = [
    { key: 'search', label: 'Search', icon: Icon.search },
    { key: 'library', label: 'Library', icon: Icon.libraryIcon },
  ];
  return (
    <nav style={{
      height: 56, minHeight: 56, background: COLORS.surface,
      borderTop: `1px solid ${COLORS.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {tabs.map(t => {
        const active = mobileTab === t.key && !['album', 'artist'].includes(view);
        const isInSubView = (t.key === 'search' && mobileTab === 'search' && ['album', 'artist'].includes(view))
          || (t.key === 'library' && mobileTab === 'library' && ['album', 'artist'].includes(view));
        const highlighted = active || isInSubView;
        return (
          <button key={t.key}
            onClick={() => {
              setMobileTab(t.key);
              if (t.key === 'search') setView('search');
              if (t.key === 'library') setView('search'); // triggers mobileShowLibrary via mobileTab
            }}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
              color: highlighted ? COLORS.accent : COLORS.textSecondary,
            }}>
            {t.icon(22, highlighted ? COLORS.accent : COLORS.textSecondary)}
            <span style={{ fontSize: 10, fontWeight: 600 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
