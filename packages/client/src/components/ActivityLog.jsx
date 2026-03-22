import React, { useState, useEffect, useRef } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import * as api from '@not-ify/shared';
import { trackSseOpen, trackSseClose, trackSseEvent, copyDiagnostics } from '../services/client-diagnostics';

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

function formatDurationShort(ms) {
  if (!ms || ms <= 0) return '0s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
}

function ServiceRow({ name, color, detail }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 8px', borderRadius: 4, background: COLORS.hover,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color,
      }} />
      <span style={{ color: COLORS.textPrimary, fontWeight: 500, width: 100, fontSize: 11 }}>{name}</span>
      <span style={{ color: COLORS.textSecondary, fontSize: 11, flex: 1 }}>{detail}</span>
    </div>
  );
}

function getServiceRows(services) {
  const rows = [];
  const green = COLORS.success;
  const yellow = '#F59E0B';
  const red = '#EF4444';
  const gray = COLORS.textSecondary;

  if (services.jobWorker) {
    const w = services.jobWorker;
    const lastJob = w.lastJobAt ? `${formatDurationShort(Date.now() - w.lastJobAt)} ago` : 'never';
    rows.push({ name: 'job-worker', color: w.running ? green : gray, detail: `${w.running ? 'running' : 'idle'} | processed: ${w.jobsProcessed} | failed: ${w.jobsFailed} | last: ${lastJob}` });
  }
  if (services.jobQueue) {
    const q = services.jobQueue;
    const hasWork = q.pending > 0 || q.active > 0;
    rows.push({ name: 'job-queue', color: hasWork ? green : gray, detail: `${q.pending} pending, ${q.active} active, ${q.done} done, ${q.failed} failed` });
  }
  if (services.llm) {
    const l = services.llm;
    rows.push({ name: 'llm', color: l.healthy ? green : l.healthy === false ? red : yellow, detail: `${l.healthy ? 'healthy' : 'unhealthy'} | model: ${l.modelReady ? 'ready' : 'not ready'} | cache: ${l.cacheSize}` });
  }
  if (services.youtube) {
    const y = services.youtube;
    rows.push({ name: 'youtube', color: green, detail: `${y.activeProcesses}/${y.maxConcurrent} active | cache: ${y.searchCacheSize} search, ${y.urlCacheSize} url` });
  }
  if (services.dlna) {
    const d = services.dlna;
    rows.push({ name: 'dlna', color: d.enabled ? green : gray, detail: d.enabled ? `${d.deviceCount} devices | last scan: ${d.lastScanAt ? formatDurationShort(Date.now() - d.lastScanAt) + ' ago' : 'never'}` : 'disabled' });
  }
  if (services.fileValidator) {
    const f = services.fileValidator;
    const t = f.tools;
    const fmt = (v) => v === true ? 'ok' : v === false ? 'missing' : '?';
    rows.push({ name: 'file-validator', color: f.toolsProbed ? green : yellow, detail: `file: ${fmt(t.file)} | ffprobe: ${fmt(t.ffprobe)} | clam: ${fmt(t.clamdscan)}` });
  }
  if (services.realdebrid) {
    const r = services.realdebrid;
    const lastCall = r.lastCallAt ? `${formatDurationShort(Date.now() - r.lastCallAt)} ago` : 'no calls';
    rows.push({ name: 'realdebrid', color: r.configured ? (r.lastCallOk !== false ? green : red) : gray, detail: r.configured ? `last: ${lastCall}${r.lastCallOk === false ? ` (err: ${r.lastError})` : ''}` : 'not configured' });
  }
  if (services.downloader) {
    const d = services.downloader;
    rows.push({ name: 'downloader', color: d.activeDownloads > 0 ? green : gray, detail: `${d.activeDownloads > 0 ? `${d.activeDownloads} active` : 'idle'} | last: ${d.lastCompletedAt ? formatDurationShort(Date.now() - d.lastCompletedAt) + ' ago' : 'never'}` });
  }
  if (services.scrobbleSync) {
    const entries = Object.entries(services.scrobbleSync);
    if (entries.length) {
      for (const [name, v] of entries) {
        const when = v.lastSyncedAt ? formatDurationShort(Date.now() - new Date(v.lastSyncedAt).getTime()) + ' ago' : 'never';
        rows.push({ name: `sync:${name}`, color: v.state === 'syncing' ? green : v.error ? red : gray, detail: `${v.state} | synced: ${when} | ${v.fetched}/${v.total}` });
      }
    }
  }
  if (services.castSession) {
    const c = services.castSession;
    rows.push({ name: 'cast', color: c.activeSessions > 0 ? green : gray, detail: c.activeSessions > 0 ? `${c.activeSessions} active` : 'no sessions' });
  }
  if (services.activityLog) {
    const a = services.activityLog;
    rows.push({ name: 'activity-log', color: green, detail: `${a.entryCount} entries | ${a.errorCount} errors | up: ${formatDurationShort(a.uptimeMs)}` });
  }
  if (services.db) {
    rows.push({ name: 'database', color: services.db.error ? red : green, detail: services.db.error || `${services.db.sizeMB} MB` });
  }
  if (services.upgrader) {
    const u = services.upgrader;
    rows.push({ name: 'upgrader', color: u.idle === true ? gray : u.idle === false ? green : yellow, detail: u.idle === true ? 'idle' : u.idle === false ? 'busy' : 'unknown' });
  }

  return rows;
}

function StatusTab() {
  const [data, setData] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function refresh() {
    setLoading(true);
    // Try diagnostics first (admin), fall back to health
    api.getDiagnostics()
      .then(d => { setData(d); setHealthData(null); })
      .catch(() => {
        api.getServiceHealth()
          .then(h => { setHealthData(h); setData(null); })
          .catch(err => { setHealthData({ status: 'error', error: err.message, checks: {} }); setData(null); });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  async function handleCopy() {
    try {
      await copyDiagnostics();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Diagnostics copy failed:', err);
    }
  }

  if (!data && !healthData) return <div style={{ color: COLORS.textSecondary, padding: 16 }}>Loading...</div>;

  // Diagnostics view (admin)
  if (data) {
    const serviceRows = getServiceRows(data.services || {});

    return (
      <div style={{ padding: '8px 12px', fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>Internal Services</span>
          <span style={{ color: COLORS.textSecondary, fontSize: 10 }}>
            v{data.version} | up {formatDurationShort((data.serverUptime || 0) * 1000)}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={handleCopy}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 3,
              border: `1px solid ${COLORS.border}`, background: 'none',
              color: copied ? COLORS.success : COLORS.textSecondary,
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied!' : 'Copy Diagnostics'}
          </button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {serviceRows.map(r => <ServiceRow key={r.name} {...r} />)}
        </div>
        {data.recentErrors?.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: '#EF4444', fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Recent Errors</div>
            {data.recentErrors.slice(-5).map((e, i) => (
              <div key={i} style={{ fontSize: 10, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                <span style={{ color: '#EF4444' }}>[{formatTime(e.ts)}]</span> {e.category}: {e.message}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Fallback: external health checks only (non-admin)
  const statusColor = healthData.status === 'ok' ? COLORS.success : '#F59E0B';

  return (
    <div style={{ padding: '8px 12px', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
        <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
          System {healthData.status === 'ok' ? 'Healthy' : 'Degraded'}
        </span>
        <span style={{ color: COLORS.textSecondary, fontSize: 10 }}>v{healthData.version}</span>
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
        {Object.entries(healthData.checks || {}).map(([name, svc]) => (
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

    // Buffer SSE events while REST fetch is in-flight to avoid race condition.
    // Events arriving before the historical fetch completes are queued, then
    // merged (deduplicated by timestamp+message) after the fetch resolves.
    let sseBuffer = [];
    let historicalLoaded = false;

    const url = api.getActivityStreamUrl();
    const es = new EventSource(url);
    eventSourceRef.current = es;
    trackSseOpen('activity');

    es.onmessage = (event) => {
      trackSseEvent('activity');
      try {
        const entry = JSON.parse(event.data);
        if (!historicalLoaded) {
          sseBuffer.push(entry);
        } else {
          setEntries(prev => {
            const next = [...prev, entry];
            return next.length > 200 ? next.slice(-200) : next;
          });
        }
      } catch {}
    };

    // Reconnect on SSE error (network drop, server restart)
    es.onerror = () => {
      trackSseClose('activity');
      es.close();
      // Retry after 3 seconds
      const retryTimer = setTimeout(() => {
        if (!eventSourceRef.current || eventSourceRef.current === es) {
          const newEs = new EventSource(url);
          eventSourceRef.current = newEs;
          trackSseOpen('activity');
          newEs.onmessage = es.onmessage;
          newEs.onerror = es.onerror;
        }
      }, 3000);
      // Clean up retry timer on unmount
      es._retryTimer = retryTimer;
    };

    // Fetch historical entries, then flush any buffered SSE events
    api.getActivityLog({ limit: 100 }).then(historical => {
      const dedupeKey = (e) => `${e.timestamp || ''}|${e.message || ''}`;
      const seen = new Set((historical || []).map(dedupeKey));
      const newFromSse = sseBuffer.filter(e => !seen.has(dedupeKey(e)));
      setEntries([...(historical || []), ...newFromSse]);
      historicalLoaded = true;
      sseBuffer = [];
    }).catch(() => {
      // REST failed — use whatever SSE has collected
      setEntries(sseBuffer);
      historicalLoaded = true;
      sseBuffer = [];
    });

    return () => {
      es.close();
      if (es._retryTimer) clearTimeout(es._retryTimer);
      trackSseClose('activity');
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
    : filter === 'upgrade'
      ? entries.filter(e => e.category === 'pipeline' || e.category === 'upgrade')
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
            {['all', 'youtube', 'upgrade'].map(cat => (
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
