import { useState, useRef } from 'react';
import * as api from '@not-ify/shared';
import { buildTrackPath } from '../utils';

export function useDownload({ playTrack, loadLibrary, library = [] } = {}) {
  const [downloading, setDownloading] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [dlExpanded, setDlExpanded] = useState(false);
  const [bgDownloadStatus, setBgDownloadStatus] = useState(null);
  const [dlTrackStatus, setDlTrackStatus] = useState(new Map());
  const [jobQueueStats, setJobQueueStats] = useState(null);

  const pendingPlayRef = useRef(false);
  const bgPollRef = useRef(null);
  const jobQueuePollRef = useRef(null);
  const libRefreshCountRef = useRef(0);

  // -------------------------------------------------------------------------
  // SSE event handler for torrent + YT single downloads
  // -------------------------------------------------------------------------
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
            playTrack?.(track, [track], 0, { artist: prev?.artist, album: prev?.albumName, coverArt: prev?.coverArt });
          }
          loadLibrary?.();
        }
        return { ...prev, step: event.step, message: event.message, fileIndex: event.fileIndex, fileTotal: event.fileTotal, logs };
      }
      if (event.type === 'complete') {
        logs.push(event.message);
        setDownloading(null);
        pendingPlayRef.current = false;
        loadLibrary?.();
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

  // -------------------------------------------------------------------------
  // Torrent download (SSE stream)
  // -------------------------------------------------------------------------
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
      const res = await api.startDownload({
        magnetLink: source.magnetLink,
        name: source.name,
        mbid: albumMeta?.mbid || null,
        artist: albumMeta?.artist || '',
        albumName: albumMeta?.album || '',
        year: albumMeta?.year || '',
        coverArt: albumMeta?.coverArt || null,
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

  // -------------------------------------------------------------------------
  // YouTube single download (SSE stream)
  // -------------------------------------------------------------------------
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
      const res = await api.startYtDownload({
        url: result.url,
        title: result.title,
        artist: result.artist || 'Unknown Artist',
        album: 'Singles',
        coverArt: result.thumbnail || null,
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

  // -------------------------------------------------------------------------
  // YouTube album download
  // -------------------------------------------------------------------------
  async function downloadAlbumViaYouTube(albumInfo, tracks) {
    if (!tracks || tracks.length === 0) return;
    setDownloading(`yt-album-${albumInfo.rgid || albumInfo.mbid || 'unknown'}`);
    setDownloadStatus({
      step: 0, message: `Searching YouTube for ${tracks.length} tracks...`, percent: null, logs: [],
      artist: albumInfo.artist || '',
      albumName: albumInfo.album || '',
      coverArt: albumInfo.coverArt || null,
    });
    try {
      const data = await api.startYtAlbumDownload({
        artist: albumInfo.artist,
        album: albumInfo.album,
        tracks: tracks.map(t => ({ title: t.title, position: t.position, lengthMs: t.lengthMs })),
        rgid: albumInfo.rgid || null,
        mbid: albumInfo.mbid || null,
        coverArt: albumInfo.coverArt || null,
        year: albumInfo.year || null,
      });
      setDownloadStatus(prev => ({
        ...prev,
        message: `Queued ${data.queued} tracks${data.errors > 0 ? ` (${data.errors} failed)` : ''}`,
        percent: 100,
      }));
      const pollId = setInterval(async () => {
        try {
          const qData = await api.getYtQueue();
          const activeItems = Array.isArray(qData.active) ? qData.active : (qData.active ? [qData.active] : []);
          if (activeItems.length > 0) {
            const first = activeItems[0];
            const msg = activeItems.length > 1
              ? `Downloading ${activeItems.length} tracks (${Math.round(first.progress)}%)`
              : `Downloading: ${first.title} (${Math.round(first.progress)}%)`;
            setDownloadStatus(prev => ({
              ...prev,
              message: msg,
              percent: first.progress,
            }));
          } else if (qData.queued.length === 0) {
            clearInterval(pollId);
            setDownloadStatus(prev => ({ ...prev, message: 'Album download complete!', percent: 100 }));
            setTimeout(() => { setDownloading(null); loadLibrary?.(); }, 2000);
          }
        } catch { clearInterval(pollId); }
      }, 2000);
    } catch (err) {
      setDownloadStatus(prev => ({ ...prev, message: `Error: ${err.message}`, error: true }));
      setDownloading(null);
    }
  }

  // -------------------------------------------------------------------------
  // Background download poll (YT queue + torrent bg status)
  // -------------------------------------------------------------------------
  function startBgPoll() {
    if (bgPollRef.current) return;
    libRefreshCountRef.current = 0;
    bgPollRef.current = setInterval(async () => {
      try {
        const data = await api.getYtQueue();
        const activeItems = Array.isArray(data.active) ? data.active : (data.active ? [data.active] : []);
        const statusMap = new Map();
        for (const a of activeItems) {
          statusMap.set((a.artist + '::' + a.title).toLowerCase(), 'active');
        }
        for (const q of (data.queued || [])) {
          statusMap.set((q.artist + '::' + q.title).toLowerCase(), 'queued');
        }
        setDlTrackStatus(statusMap);
        if (activeItems.length > 0) {
          const first = activeItems[0];
          setBgDownloadStatus(prev => ({
            ...prev,
            message: activeItems.length > 1
              ? `Saving ${activeItems.length} tracks...`
              : `Saving: ${first.title}`,
            count: data.queued.length + activeItems.length,
            done: false,
          }));
        } else if (data.queued.length === 0) {
          const bgData = await api.getBgStatus();
          if (bgData.active) {
            setBgDownloadStatus(prev => ({
              ...prev,
              message: bgData.message || 'Downloading...',
              done: false,
            }));
          } else {
            setBgDownloadStatus(prev => prev ? { ...prev, message: 'All saved!', done: true, count: 0 } : null);
            setDlTrackStatus(new Map());
            loadLibrary?.();
            clearInterval(bgPollRef.current);
            bgPollRef.current = null;
            setTimeout(() => setBgDownloadStatus(null), 3000);
            api.dedupeLibrary().catch(() => {});
          }
        } else {
          setBgDownloadStatus(prev => ({
            ...prev,
            message: `Queued: ${data.queued.length} tracks`,
            count: data.queued.length,
            done: false,
          }));
        }
        libRefreshCountRef.current++;
        if (libRefreshCountRef.current % 5 === 0) loadLibrary?.();
      } catch {}
    }, 3000);
  }

  // -------------------------------------------------------------------------
  // Auto-acquire: background download when user plays something
  // -------------------------------------------------------------------------
  async function autoAcquireAlbum(albumInfo) {
    if (!albumInfo?.artist || !albumInfo?.album) return;
    console.log('[autoAcquire]', {
      artist: albumInfo.artist,
      album: albumInfo.album,
      hasSources: !!albumInfo.sources?.length,
      firstSource: albumInfo.sources?.[0]?.source,
      hasMagnet: !!albumInfo.sources?.[0]?.magnetLink,
      mbTrackCount: albumInfo.mbTracks?.length,
    });
    const torrentSrc = albumInfo.sources?.find(s => s.magnetLink);
    if (torrentSrc) {
      setBgDownloadStatus({ type: 'torrent', message: `Saving ${albumInfo.album}...`, count: 0, done: false });
      try {
        await api.startBgDownload({
          magnetLink: torrentSrc.magnetLink,
          name: torrentSrc.name,
          mbid: albumInfo.mbid || null,
          artist: albumInfo.artist,
          albumName: albumInfo.album,
          year: albumInfo.year || '',
          coverArt: albumInfo.coverArt || null,
        });
        startBgPoll();
        return;
      } catch (err) {
        console.warn('[autoAcquire] Torrent failed, falling back to YouTube:', err.message);
      }
    }
    const tracks = albumInfo.mbTracks || [];
    if (tracks.length === 0) return;
    setBgDownloadStatus({ type: 'yt', message: `Saving ${albumInfo.album}...`, count: tracks.length, done: false });
    // Use server-side album download (has better YT match scoring)
    api.startYtAlbumDownload({
      artist: albumInfo.artist,
      album: albumInfo.album,
      tracks: tracks.map(t => ({ title: t.title, position: t.position, lengthMs: t.lengthMs })),
      rgid: albumInfo.rgid || null,
      mbid: albumInfo.mbid || null,
      coverArt: albumInfo.coverArt || null,
      year: albumInfo.year || null,
    }).then(() => startBgPoll()).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Job queue polling (upgrade pipeline)
  // -------------------------------------------------------------------------
  function startJobQueuePoll() {
    if (jobQueuePollRef.current) return;
    jobQueuePollRef.current = setInterval(async () => {
      try {
        const data = await api.getJobQueue();
        const stats = data.stats || {};
        setJobQueueStats({
          pending: stats.pending || 0,
          active: stats.active || 0,
          done: stats.done || 0,
          failed: stats.failed || 0,
          jobs: data.jobs || [],
        });
        // Stop polling when queue is idle
        if ((stats.pending || 0) === 0 && (stats.active || 0) === 0) {
          clearInterval(jobQueuePollRef.current);
          jobQueuePollRef.current = null;
          loadLibrary?.();
          setTimeout(() => setJobQueueStats(null), 4000);
        }
      } catch {}
    }, 3000);
  }

  function stopJobQueuePoll() {
    if (jobQueuePollRef.current) {
      clearInterval(jobQueuePollRef.current);
      jobQueuePollRef.current = null;
    }
  }

  async function handleCancel() {
    try { await api.cancelDownload(); } catch {}
  }

  async function handleYtCancel() {
    try { await api.cancelYtDownload(); } catch {}
  }

  return {
    downloading, setDownloading,
    downloadStatus, setDownloadStatus,
    dlExpanded, setDlExpanded,
    bgDownloadStatus, setBgDownloadStatus,
    dlTrackStatus,
    jobQueueStats,
    startDownload,
    startYtDownload,
    downloadAlbumViaYouTube,
    startBgPoll,
    startJobQueuePoll,
    stopJobQueuePoll,
    autoAcquireAlbum,
    handleCancel,
    handleYtCancel,
  };
}
