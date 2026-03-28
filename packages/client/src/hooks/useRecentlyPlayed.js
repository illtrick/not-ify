import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { RECENTLY_PLAYED_KEY, MAX_RECENTLY_PLAYED } from '../constants';

export function useRecentlyPlayed() {
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  // SSE sync across devices
  useEffect(() => {
    const abort = new AbortController();
    let reconnectTimer;

    function connectSSE() {
      api.rawGet('/api/recently-played/stream', { signal: abort.signal })
        .then(res => {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          function read() {
            reader.read().then(({ done, value }) => {
              if (done) { scheduleReconnect(); return; }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const list = JSON.parse(line.slice(6)).filter(r => r.artist && r.album);
                    setRecentlyPlayed(prev => {
                      if (prev.length === list.length && prev[0]?.playedAt === list[0]?.playedAt) return prev;
                      return list;
                    });
                  } catch {}
                }
              }
              read();
            }).catch(err => {
              if (!abort.signal.aborted) {
                console.warn(`[recently-played] SSE read error, reconnecting in 3s: ${err.message || 'unknown'}`);
                scheduleReconnect();
              }
            });
          }
          read();
        })
        .catch(err => {
          if (!abort.signal.aborted) {
            console.warn(`[recently-played] SSE connection lost, reconnecting in 3s: ${err.message || 'unknown'}`);
            scheduleReconnect();
          }
        });
    }

    function scheduleReconnect() {
      if (abort.signal.aborted) return;
      reconnectTimer = setTimeout(connectSSE, 3000);
    }

    // Initial load: check server, migrate localStorage if needed, then connect SSE
    api.getRecentlyPlayed()
      .then(serverList => {
        if (serverList.length === 0) {
          try {
            const local = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || [];
            if (local.length > 0) {
              return api.setRecentlyPlayed(local)
                .then(list => {
                  setRecentlyPlayed(list);
                  try { localStorage.removeItem(RECENTLY_PLAYED_KEY); } catch {}
                });
            }
          } catch {}
        }
        setRecentlyPlayed(serverList.filter(r => r.artist && r.album));
        try { localStorage.removeItem(RECENTLY_PLAYED_KEY); } catch {}
      })
      .catch(() => {
        try { setRecentlyPlayed(JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || []); } catch {}
      })
      .finally(() => connectSSE());

    return () => { abort.abort(); clearTimeout(reconnectTimer); };
  }, []);

  function addToRecentlyPlayed(item) {
    // item: { artist, album, coverArt, mbid, rgid }
    if (!item.artist || !item.album) return; // Validate: skip empty entries
    setRecentlyPlayed(prev => {
      const key = (item.artist + '::' + item.album).toLowerCase();
      const filtered = prev.filter(r => (r.artist + '::' + r.album).toLowerCase() !== key);
      return [{ ...item, playedAt: Date.now() }, ...filtered].slice(0, MAX_RECENTLY_PLAYED);
    });
    api.addRecentlyPlayed(item)
      .then(list => { if (list) setRecentlyPlayed(list); })
      .catch(() => {});
  }

  return { list: recentlyPlayed, add: addToRecentlyPlayed, setList: setRecentlyPlayed };
}
