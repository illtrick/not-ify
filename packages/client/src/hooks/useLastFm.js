import { useState, useRef, useEffect } from 'react';
import * as api from '@not-ify/shared';

export function useLastFm() {
  const [lastfmStatus, setLastfmStatus] = useState({ configured: false, authenticated: false, username: null });
  const [lastfmApiKey, setLastfmApiKey] = useState('');
  const [lastfmApiSecret, setLastfmApiSecret] = useState('');
  const [lastfmAuthStep, setLastfmAuthStep] = useState(0);
  const [lastfmAuthUrl, setLastfmAuthUrl] = useState('');
  const [lastfmAuthToken, setLastfmAuthToken] = useState('');
  const [lastfmError, setLastfmError] = useState('');
  const [lastfmTopArtists, setLastfmTopArtists] = useState([]);

  // Ref mirror for use in closures (e.g. onTimeUpdate)
  const statusRef = useRef(lastfmStatus);
  useEffect(() => { statusRef.current = lastfmStatus; }, [lastfmStatus]);

  // Per-track scrobble state
  const scrobbleRef = useRef({ artist: '', track: '', album: '', startTime: 0, duration: 0, scrobbled: false });

  function load() {
    api.getLastfmStatus().then(s => {
      setLastfmStatus(s);
      if (s.authenticated && s.username) {
        api.getLastfmTopArtists('overall', 8).then(a => setLastfmTopArtists(a || [])).catch(() => {});
      }
    }).catch(() => {});
  }

  async function saveConfig() {
    setLastfmError('');
    try {
      await api.lastfmSaveConfig({ apiKey: lastfmApiKey, apiSecret: lastfmApiSecret });
      setLastfmStatus(s => ({ ...s, configured: true }));
      const tokenData = await api.lastfmGetAuthToken();
      if (tokenData.error) throw new Error(tokenData.error);
      setLastfmAuthToken(tokenData.token);
      setLastfmAuthUrl(tokenData.authUrl);
      setLastfmAuthStep(1);
    } catch (err) {
      setLastfmError(err.message);
    }
  }

  async function completeAuth() {
    setLastfmError('');
    try {
      const data = await api.lastfmCompleteAuth(lastfmAuthToken);
      if (data.error) throw new Error(data.error);
      setLastfmStatus({ configured: true, authenticated: true, username: data.username });
      setLastfmAuthStep(2);
      api.getLastfmTopArtists('overall', 8).then(a => setLastfmTopArtists(a || [])).catch(() => {});
    } catch (err) {
      setLastfmError(err.message);
    }
  }

  async function disconnect() {
    await api.lastfmDisconnect();
    setLastfmStatus({ configured: true, authenticated: false, username: null });
    setLastfmTopArtists([]);
    setLastfmAuthStep(0);
  }

  function initScrobble(artist, track, album) {
    scrobbleRef.current = {
      artist, track, album,
      startTime: Math.floor(Date.now() / 1000),
      duration: 0, scrobbled: false,
    };
  }

  function nowPlaying(artist, track, album) {
    if (statusRef.current.authenticated && artist && track) {
      api.lastfmNowPlaying({ artist, track, album }).catch(() => {});
    }
  }

  function checkScrobble(currentTime, dur) {
    const sr = scrobbleRef.current;
    if (sr.duration === 0 && dur > 0) sr.duration = dur;
    if (
      !sr.scrobbled && sr.artist && sr.track &&
      statusRef.current.authenticated &&
      dur > 30 && (currentTime > dur * 0.5 || currentTime > 240)
    ) {
      sr.scrobbled = true;
      api.lastfmScrobble({
        artist: sr.artist, track: sr.track, album: sr.album,
        timestamp: sr.startTime, duration: Math.round(dur),
      }).catch(() => {});
    }
  }

  function loadTopArtists(period, limit) {
    api.getLastfmTopArtists(period, limit).then(a => setLastfmTopArtists(a || [])).catch(() => {});
  }

  return {
    status: lastfmStatus, setStatus: setLastfmStatus,
    apiKey: lastfmApiKey, setApiKey: setLastfmApiKey,
    apiSecret: lastfmApiSecret, setApiSecret: setLastfmApiSecret,
    authStep: lastfmAuthStep, setAuthStep: setLastfmAuthStep,
    authUrl: lastfmAuthUrl,
    authToken: lastfmAuthToken,
    error: lastfmError,
    topArtists: lastfmTopArtists,
    statusRef,
    scrobbleRef,
    load,
    saveConfig,
    completeAuth,
    disconnect,
    initScrobble,
    nowPlaying,
    checkScrobble,
    loadTopArtists,
  };
}
