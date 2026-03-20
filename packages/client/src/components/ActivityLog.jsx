import React, { useState, useEffect, useRef } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import * as api from '@not-ify/shared';

const CATEGORY_COLORS = {
  youtube: '#E94560',
  torrent: '#F59E0B',
  upgrade: '#8B5CF6',
  download: '#3B82F6',
  pipeline: '#6B7280',
  library: '#10B981',
};

const LEVEL_COLORS = {
  success: COLORS.success,
  error: COLORS.error || '#EF4444',
  warn: '#F59E0B',
  info: COLORS.textSecondary,
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ActivityLog({ open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all'); // all, youtube, torrent, upgrade
  const logEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Load initial entries and connect SSE
  useEffect(() => {
    if (!open) {
      // Disconnect SSE when closed
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    // Load recent history
    api.getActivityLog({ limit: 100 }).then(setEntries).catch(() => {});

    // Connect SSE for real-time updates
    const url = api.getActivityStreamUrl();
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data);
        setEntries(prev => {
          const next = [...prev, entry];
          return next.length > 200 ? next.slice(-200) : next;
        });
      } catch {}
    };

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logEndRef.current && open) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, open]);

  if (!open) return null;

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => e.category === filter);

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: 300, background: COLORS.surface,
      borderTop: `2px solid ${COLORS.border}`,
      display: 'flex', flexDirection: 'column',
      zIndex: 1000, fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.background, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>
          Activity Log
        </span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {['all', 'youtube', 'torrent', 'upgrade'].map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                background: filter === cat ? (CATEGORY_COLORS[cat] || COLORS.accent) : COLORS.hover,
                color: filter === cat ? '#fff' : COLORS.textSecondary,
                opacity: filter === cat ? 1 : 0.7,
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: COLORS.textSecondary }}>
          {filtered.length} events
        </span>
        <button
          onClick={() => setEntries([])}
          style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 3, border: `1px solid ${COLORS.border}`,
            background: 'none', color: COLORS.textSecondary, cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {Icon.close(14, COLORS.textSecondary)}
        </button>
      </div>

      {/* Log entries */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '4px 12px',
        fontSize: 11, lineHeight: 1.6,
      }}>
        {filtered.length === 0 && (
          <div style={{ color: COLORS.textSecondary, padding: 20, textAlign: 'center' }}>
            No activity yet. Play an album or start a download to see events.
          </div>
        )}
        {filtered.map(entry => (
          <div key={entry.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ color: COLORS.textSecondary, flexShrink: 0, fontSize: 10 }}>
              {formatTime(entry.ts)}
            </span>
            <span style={{
              fontSize: 9, padding: '0 4px', borderRadius: 2, flexShrink: 0,
              background: CATEGORY_COLORS[entry.category] || '#666',
              color: '#fff', fontWeight: 600, textTransform: 'uppercase',
            }}>
              {entry.category}
            </span>
            <span style={{ color: LEVEL_COLORS[entry.level] || COLORS.textPrimary }}>
              {entry.message}
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
