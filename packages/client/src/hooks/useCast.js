import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '@not-ify/shared/api-client';

const STORAGE_KEY = 'notify-cast-device';
const POLL_INTERVAL = 10000; // refresh device list every 10s

export function useCast() {
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDeviceState] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const [isCasting, setIsCasting] = useState(false);
  const [castState, setCastState] = useState({ position: 0, duration: 0, state: 'STOPPED', volume: 50 });
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const sseRef = useRef(null);
  const pollRef = useRef(null);

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
          setIsCasting(false);
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
      // SSE disconnected — stop casting
      setIsCasting(false);
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [isCasting, activeDevice]);

  const selectDevice = useCallback((usn) => {
    setActiveDeviceState(usn);
    if (usn) localStorage.setItem(STORAGE_KEY, usn);
    else localStorage.removeItem(STORAGE_KEY);
    setShowDevicePicker(false);
  }, []);

  const castTrack = useCallback(async (track, albumInfo, queue) => {
    if (!activeDevice) return;
    await api.castPlay({
      deviceUsn: activeDevice,
      trackId: track.id,
      albumInfo,
      queue: (queue || [track]).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
    });
    setIsCasting(true);
  }, [activeDevice]);

  const castYtTrack = useCallback(async (videoId, title, artist, album, coverArt) => {
    if (!activeDevice) return;
    await api.castPlayYt({ deviceUsn: activeDevice, videoId, title, artist, album, coverArt });
    setIsCasting(true);
  }, [activeDevice]);

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
    await api.castStop(activeDevice);
    setIsCasting(false);
    setCastState({ position: 0, duration: 0, state: 'STOPPED', volume: castState.volume });
  }, [activeDevice, castState.volume]);

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
  };
}
