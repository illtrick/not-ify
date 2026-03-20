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

function StatusTab() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    setLoading(true);
    api.getServiceHealth()
      .then(setHealth)
      .catch(err => setHealth({ status: 'error', error: err.message, checks: {} }))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  if (!health) return <div style={{ color: COLORS.textSecondary, padding: 16 }}>Loading...</div>;

  const statusColor = health.status === 'ok' ? COLORS.success : '#F59E0B';

  return (
    <div style={{ padding: '8px 12px', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
        <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
          System {health.status === 'ok' ? 'Healthy' : 'Degraded'}
        </span>
        <span style={{ color: COLORS.textSecondary, fontSize: 10 }}>v{health.version}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 3,
            border: `1px solid ${COLORS.border}`, background: 'none',
            color: COLORS.textSecondary, cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(health.checks || {}).map(([name, svc]) => (
          <div key={name} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 8px', borderRadius: 4, background: COLORS.hover,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: svc.status === 'ok' ? COLORS.success
                : svc.status === 'disabled' ? COLORS.textSecondary
                : '#EF4444',
            }} />
            <span style={{ color: COLORS.textPrimary, fontWeight: 500, width: 90 }}>{name}</span>
            <span style={{ color: COLORS.textSecondary, fontSize: 11, flex: 1 }}>
              {svc.status === 'ok' && svc.ip && `${svc.ip} `}
              {svc.status === 'ok' && svc.region && `(${svc.region}) `}
              {svc.status === 'disabled' ? 'disabled' : `${svc.latency}ms`}
            </span>
            {svc.status === 'error' && (
              <span style={{ color: '#EF4444', fontSize: 10 }}>{svc.error}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityLog({ open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('log'); // log, status
  const logEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!open) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    api.getActivityLog({ limit: 100 }).then(setEntries).catch(() => {});

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

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (logEndRef.current && open && tab === 'log') {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, open, tab]);

  if (!open) return null;

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => e.category === filter);

  return (
    <div style={{
      height: 260, background: COLORS.surface,
      borderTop: `2px solid ${COLORS.border}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.background, flexShrink: 0,
      }}>
        {/* Tabs */}
        {['log', 'status'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 3, border: 'none', cursor: 'pointer',
              background: tab === t ? COLORS.accent : 'transparent',
              color: tab === t ? '#fff' : COLORS.textSecondary,
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === 'log' ? 'Activity' : 'Status'}
          </button>
        ))}

        {/* Category filters — only for log tab */}
        {tab === 'log' && (
          <>
            <span style={{ width: 1, height: 14, background: COLORS.border, margin: '0 4px' }} />
            {['all', 'youtube', 'torrent', 'upgrade'].map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                  background: filter === cat ? (CATEGORY_COLORS[cat] || COLORS.accent) : 'transparent',
                  color: filter === cat ? '#fff' : COLORS.textSecondary,
                  opacity: filter === cat ? 1 : 0.7,
                }}
              >
                {cat}
              </button>
            ))}
          </>
        )}

        <span style={{ flex: 1 }} />
        {tab === 'log' && (
          <>
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
          </>
        )}
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {Icon.close(14, COLORS.textSecondary)}
        </button>
      </div>

      {/* Content */}
      {tab === 'log' ? (
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
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <StatusTab />
        </div>
      )}
    </div>
  );
}
