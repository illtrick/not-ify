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
      const entry = {
        traceId,
        event,
        timestamp: Date.now(),
        latencyMs: Math.round(performance.now() - traceStart),
        ...eventDetail,
      };
      queueRef.current.push(entry);
    };

    // Emit the initial event
    emit(initialEvent, detail);

    return { traceId, emit };
  }, []);

  // Emit a standalone event (not part of a trace)
  const emit = useCallback((event, detail = {}) => {
    queueRef.current.push({
      traceId: null,
      event,
      timestamp: Date.now(),
      latencyMs: 0,
      ...detail,
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
