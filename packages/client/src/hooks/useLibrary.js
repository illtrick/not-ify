import { useState, useMemo } from 'react';
import * as api from '@not-ify/shared';
import { buildTrackPath } from '../utils';
import { useTelemetry } from './useTelemetry';

export function useLibrary({ recentlyPlayed = [] } = {}) {
  const telemetry = useTelemetry();
  const [library, setLibrary] = useState([]);
  const [librarySortBy, setLibrarySortBy] = useState('recents');
  const [libraryFilter, setLibraryFilter] = useState('');
  const [showLibraryFilter, setShowLibraryFilter] = useState(false);

  async function loadLibrary() {
    try {
      try { telemetry.emit('library_fetch_start', {}); } catch {}
      const fetchStart = performance.now();
      const data = await api.getLibrary();
      const latencyMs = Math.round(performance.now() - fetchStart);
      setLibrary(Array.isArray(data) ? data : []);
      try { telemetry.emit('library_fetch_complete', { trackCount: Array.isArray(data) ? data.length : 0, latencyMs }); } catch {}
    } catch (err) {
      console.error('Library load failed:', err);
    }
  }

  function groupLibrary(tracks) {
    return tracks.reduce((acc, t) => {
      const artist = t.artist || 'Unknown Artist';
      const album = t.album || 'Unknown Album';
      if (!acc[artist]) acc[artist] = {};
      if (!acc[artist][album]) acc[artist][album] = { tracks: [], coverArt: t.coverArt || null, mbid: t.mbid || null };
      acc[artist][album].tracks.push(t);
      return acc;
    }, {});
  }

  function libraryAlbums() {
    const grouped = groupLibrary(library);
    const byAlbumName = {};
    for (const [artist, albumMap] of Object.entries(grouped)) {
      for (const [albumName, data] of Object.entries(albumMap)) {
        if (!byAlbumName[albumName]) byAlbumName[albumName] = [];
        byAlbumName[albumName].push({ artist, ...data });
      }
    }
    const albums = [];
    const mergedAlbumNames = new Set();
    for (const [albumName, entries] of Object.entries(byAlbumName)) {
      if (entries.length >= 3) {
        const allTracks = entries.flatMap(e => e.tracks);
        const coverArt = entries.find(e => e.coverArt)?.coverArt || null;
        const mbid = entries.find(e => e.mbid)?.mbid || null;
        albums.push({ artist: 'Various Artists', album: albumName, tracks: allTracks, coverArt, mbid, trackCount: allTracks.length });
        mergedAlbumNames.add(albumName);
      }
    }
    for (const [artist, albumMap] of Object.entries(grouped)) {
      for (const [albumName, { tracks, coverArt, mbid }] of Object.entries(albumMap)) {
        if (!mergedAlbumNames.has(albumName)) {
          albums.push({ artist, album: albumName, tracks, coverArt, mbid, trackCount: tracks.length });
        }
      }
    }
    return albums;
  }

  const libraryKeys = useMemo(() => {
    const s = new Set();
    libraryAlbums().forEach(a => s.add((a.artist + '::' + a.album).toLowerCase()));
    return s;
  }, [library]);

  function isInLibrary(artist, album) {
    return libraryKeys.has((artist + '::' + album).toLowerCase());
  }

  function sidebarAlbums() {
    let albums = libraryAlbums();
    if (libraryFilter) {
      const f = libraryFilter.toLowerCase();
      albums = albums.filter(a => a.album.toLowerCase().includes(f) || a.artist.toLowerCase().includes(f));
    }
    if (librarySortBy === 'recents') {
      const recencyMap = new Map();
      recentlyPlayed.forEach(r => {
        const key = (r.artist + '::' + r.album).toLowerCase();
        if (!recencyMap.has(key)) recencyMap.set(key, r.playedAt || 0);
      });
      albums.sort((a, b) => {
        const aTime = recencyMap.get((a.artist + '::' + a.album).toLowerCase()) || 0;
        const bTime = recencyMap.get((b.artist + '::' + b.album).toLowerCase()) || 0;
        return bTime - aTime;
      });
    } else if (librarySortBy === 'alpha') {
      albums.sort((a, b) => a.album.localeCompare(b.album));
    } else if (librarySortBy === 'artist') {
      albums.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    }
    return albums;
  }

  function buildLibraryTrackPath(track) {
    return { ...track, path: buildTrackPath(track.id) };
  }

  async function removeAlbum(artist, album) {
    await api.removeAlbum(artist, album);
    await loadLibrary();
  }

  async function removeTrack(id) {
    await api.removeTrack(id);
    await loadLibrary();
  }

  return {
    library, setLibrary,
    librarySortBy, setLibrarySortBy,
    libraryFilter, setLibraryFilter,
    showLibraryFilter, setShowLibraryFilter,
    loadLibrary,
    libraryAlbums,
    libraryKeys,
    isInLibrary,
    sidebarAlbums,
    buildLibraryTrackPath,
    removeAlbum,
    removeTrack,
  };
}
