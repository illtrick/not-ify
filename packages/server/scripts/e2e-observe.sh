#!/bin/bash
# E2E Telemetry Observer — connects to telemetry SSE stream and formats traces
# Usage: ./e2e-observe.sh [host:port]

HOST="${1:-localhost:3000}"
echo "Connecting to http://${HOST}/api/telemetry/stream..."
echo "Watching for telemetry events (Ctrl+C to stop)"
echo ""

curl -sN "http://${HOST}/api/telemetry/stream" | while IFS= read -r line; do
  # Skip empty lines and SSE comments
  [[ -z "$line" ]] && continue
  [[ "$line" == :* ]] && continue
  [[ "$line" != data:* ]] && continue

  JSON="${line#data: }"

  echo "$JSON" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    const ts = new Date(d.timestamp).toLocaleTimeString();
    const lat = d.latencyMs ? ' (' + d.latencyMs + 'ms)' : '';
    const tid = d.traceId ? '[' + d.traceId.slice(0,12) + ']' : '          ';

    // Color coding
    const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', NC = '\x1b[0m';

    let prefix = DIM + ts + NC + ' ' + tid + ' ';

    if (d.event.includes('error') || d.event.includes('anomaly')) {
      console.log(prefix + RED + d.event + NC + lat + ' ' + JSON.stringify(d.detail || d));
    } else if (d.event.includes('complete') || d.event.includes('playing')) {
      console.log(prefix + GREEN + d.event + NC + lat);
    } else if (d.event.includes('stall') || d.event.includes('slow') || d.event.includes('stale')) {
      console.log(prefix + YELLOW + d.event + NC + lat);
    } else {
      console.log(prefix + CYAN + d.event + NC + lat);
    }
  " 2>/dev/null
done
