import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '@not-ify/shared';

const STORAGE_KEY = 'notify-cast-device';
const POLL_INTERVAL = 10000; // refresh device list every 10s

export function useCast() {
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDeviceState] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const [isCasting, setIsCasting] = useState(false);
  const [castState, setCastState] = useState({ position: 0, duration: 0, state: 'STOPPED', volume: 50 });
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [castLog, setCastLog] = useState([]); // { id, message, timestamp }
  const sseRef = useRef(null);
  const pollRef = useRef(null);

  const addLog = useCallback((message) => {
    const entry = { id: Date.now(), message, timestamp: new Date().toLocaleTimeString() };
    setCastLog(prev => [entry, ...prev].slice(0, 20)); // keep last 20
    console.log(`[cast] ${message}`);
    // Auto-clear non-casting log entries after 5 seconds
    setTimeout(() => {
      setCastLog(prev => prev.filter(e => e.id !== entry.id));
    }, 5000);
  }, []);

  // Refresh device list periodically
  const refreshDevices = useCallback(() => {
    api.getCastDevices().then(setDevices).catch(() => {});
  }, []);

  useEffect(() => {
    refreshDevices();
    pollRef.current = setInterval(refreshDevices, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [refreshDevices]);

  // SSE status stream — runs whenever a cast device is selected
  useEffect(() => {
    if (!activeDevice) return;

    const url = api.castStatusStreamUrl(activeDevice);
    const es = new EventSource(url);
    sseRef.current = es;
    let prevState = null;
    let prevPosition = 0;
    let autoAdvancing = false;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'deviceLost') {
          addLog('Device lost');
          setIsCasting(false);
          return;
        }
        if (data.event === 'error') return;

        const newState = data.state ?? 'STOPPED';
        const pos = data.position ?? 0;
        const dur = data.duration ?? 0;

        // Detect external play (someone started playback from Sonos/WiiM app)
        if (!isCasting && (newState === 'PLAYING' || newState === 'TRANSITIONING') && dur > 0) {
          setIsCasting(true);
          autoAdvancing = false;
        }

        // Detect track ended naturally (was PLAYING, now STOPPED, position was near end)
        if (isCasting && newState === 'STOPPED' && prevState === 'PLAYING' && !autoAdvancing) {
          const nearEnd = dur > 0 && prevPosition > 0 && (dur - prevPosition) < 5;
          if (nearEnd) {
            // Auto-advance to next track in queue
            autoAdvancing = true;
            addLog('Track ended — advancing queue');
            api.castNext(activeDevice).then(() => {
              autoAdvancing = false;
            }).catch(() => {
              autoAdvancing = false;
              setIsCasting(false);
              addLog('No more tracks in queue');
            });
          } else {
            // Stopped externally (not at end of track)
            setIsCasting(false);
            addLog('Playback stopped');
          }
        }

        // Two consecutive STOPPED with no auto-advance = truly stopped
        if (isCasting && newState === 'STOPPED' && prevState === 'STOPPED' && !autoAdvancing) {
          setIsCasting(false);
        }

        prevState = newState;
        prevPosition = pos;

        setCastState({
          position: pos,
          duration: dur,
          state: newState,
          volume: data.volume ?? 50,
          currentTrack: data.currentTrack,
        });
      } catch {}
    };

    es.onerror = () => {};

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [activeDevice]);

  const selectDevice = useCallback((usn) => {
    setActiveDeviceState(usn);
    if (usn) {
      localStorage.setItem(STORAGE_KEY, usn);
      const name = devices.find(d => d.usn === usn)?.friendlyName || 'device';
      addLog(`Selected device: ${name}`);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      addLog('Disconnected from device');
    }
    setShowDevicePicker(false);
  }, [devices, addLog]);

  const castTrack = useCallback(async (track, albumInfo, queue, overrideDevice, startPosition) => {
    const device = overrideDevice || activeDevice;
    if (!device) return;
    // Pre-seed cast state so UI doesn't flash to 0
    if (startPosition) {
      setCastState(s => ({ ...s, position: startPosition, state: 'TRANSITIONING' }));
    }
    try {
      await api.castPlay({
        deviceUsn: device,
        trackId: track.id,
        albumInfo,
        queue: (queue || [track]).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
        startPosition: startPosition || undefined,
      });
      setIsCasting(true);
      addLog(`Casting "${track.title}" to ${devices.find(d => d.usn === device)?.friendlyName || 'device'}`);
    } catch (err) {
      addLog(`Cast failed: ${err.message}`);
    }
  }, [activeDevice, devices]);

  const castYtTrack = useCallback(async (videoId, title, artist, album, coverArt, overrideDevice) => {
    const device = overrideDevice || activeDevice;
    if (!device) return;
    try {
      await api.castPlayYt({ deviceUsn: device, videoId, title, artist, album, coverArt });
      setIsCasting(true);
      addLog(`Casting "${title}" (YT) to ${devices.find(d => d.usn === device)?.friendlyName || 'device'}`);
    } catch (err) {
      addLog(`Cast failed: ${err.message}`);
    }
  }, [activeDevice, devices]);

  const castPause = useCallback(async () => {
    if (!activeDevice) return;
    if (castState.state === 'PLAYING') {
      await api.castPause(activeDevice);
    } else {
      // Resume by sending play with current track — server handles this via the device's own play action
      await api.castPause(activeDevice); // device will toggle; rely on SSE to update state
    }
  }, [activeDevice, castState.state]);

  const castStop = useCallback(async () => {
    if (!activeDevice) return;
    try {
      await api.castStop(activeDevice);
      addLog('Cast stopped');
    } catch (err) {
      addLog(`Stop failed: ${err.message}`);
    }
    setIsCasting(false);
    setCastState({ position: 0, duration: 0, state: 'STOPPED', volume: castState.volume });
  }, [activeDevice, castState.volume, addLog]);

  const castSeek = useCallback(async (seconds) => {
    if (!activeDevice) return;
    await api.castSeek(activeDevice, seconds);
  }, [activeDevice]);

  const castSetVolume = useCallback(async (level) => {
    if (!activeDevice) return;
    await api.castVolume(activeDevice, level);
    setCastState(s => ({ ...s, volume: level }));
  }, [activeDevice]);

  const castNext = useCallback(async () => {
    if (!activeDevice) return;
    await api.castNext(activeDevice);
  }, [activeDevice]);

  const castPrev = useCallback(async () => {
    if (!activeDevice) return;
    await api.castPrev(activeDevice);
  }, [activeDevice]);

  return {
    // State
    devices,
    activeDevice,
    isCasting,
    castState,
    showDevicePicker,
    castLog,
    // Actions
    selectDevice,
    refreshDevices,
    setShowDevicePicker,
    castTrack,
    castYtTrack,
    castPause,
    castStop,
    castSeek,
    castSetVolume,
    castNext,
    castPrev,
    addLog,
  };
}
