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

  // SSE status stream when casting
  useEffect(() => {
    if (!isCasting || !activeDevice) return;

    const url = api.castStatusStreamUrl(activeDevice);
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'deviceLost') {
          addLog('Device lost — stopping cast');
          setIsCasting(false);
          return;
        }
        if (data.event === 'error') {
          addLog(`Device error: ${data.message}`);
          return;
        }
        setCastState({
          position: data.position ?? 0,
          duration: data.duration ?? 0,
          state: data.state ?? 'STOPPED',
          volume: data.volume ?? 50,
          currentTrack: data.currentTrack,
        });
      } catch {}
    };

    es.onerror = () => {
      addLog('SSE connection lost — stopping cast');
      setIsCasting(false);
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [isCasting, activeDevice]);

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

  const castTrack = useCallback(async (track, albumInfo, queue, overrideDevice) => {
    const device = overrideDevice || activeDevice;
    if (!device) return;
    try {
      await api.castPlay({
        deviceUsn: device,
        trackId: track.id,
        albumInfo,
        queue: (queue || [track]).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
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
