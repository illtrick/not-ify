import { useRef, useCallback, useEffect } from 'react';
import { postTelemetry } from '@not-ify/shared';

export function useTelemetry() {
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);

  // Start a new trace for a user action
  const startTrace = useCallback((initialEvent, detail = {}) => {
    const traceId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const traceStart = performance.now();

    const emit = (event, eventDetail = {}) => {
      const { trackId, ...rest } = eventDetail;
      const entry = {
        traceId,
        event,
        timestamp: Date.now(),
        latencyMs: Math.round(performance.now() - traceStart),
        trackId: trackId || null,
        detail: Object.keys(rest).length > 0 ? rest : null,
      };
      queueRef.current.push(entry);
    };

    // Emit the initial event
    emit(initialEvent, detail);

    return { traceId, emit };
  }, []);

  // Emit a standalone event (not part of a trace)
  const emit = useCallback((event, eventDetail = {}) => {
    const { trackId, ...rest } = eventDetail;
    queueRef.current.push({
      traceId: null,
      event,
      timestamp: Date.now(),
      latencyMs: 0,
      trackId: trackId || null,
      detail: Object.keys(rest).length > 0 ? rest : null,
    });
  }, []);

  // Flush queue to server every 2 seconds
  useEffect(() => {
    flushTimerRef.current = setInterval(() => {
      if (queueRef.current.length === 0) return;
      const batch = queueRef.current.splice(0);
      // Fire and forget — never block UI
      postTelemetry(batch).catch(() => {});
    }, 2000);

    return () => clearInterval(flushTimerRef.current);
  }, []);

  return { startTrace, emit };
}
