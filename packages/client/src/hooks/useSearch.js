import { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';

export function useSearch({ setView }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchAlbums, setSearchAlbums] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [searchArtistResults, setSearchArtistResults] = useState([]);
  const [streamingResults, setStreamingResults] = useState([]);
  const [otherResults, setOtherResults] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);

  // Load search history from server on mount
  useEffect(() => {
    api.getSearchHistory()
      .then(rows => setSearchHistory(rows.map(r => r.query)))
      .catch(() => {});
  }, []);

  function addToSearchHistory(q) {
    // Optimistic update
    setSearchHistory(prev => {
      const filtered = prev.filter(s => s.toLowerCase() !== q.toLowerCase());
      return [q, ...filtered];
    });
    // Persist to server
    api.addSearchHistoryEntry(q).catch(() => {});
  }

  function removeFromSearchHistory(q) {
    // Optimistic update
    setSearchHistory(prev => prev.filter(s => s !== q));
    // Persist to server
    api.removeSearchHistoryEntry(q).catch(() => {});
  }

  async function handleSearch(e, overrideQuery) {
    if (e?.preventDefault) e.preventDefault();
    const q = (overrideQuery || query).trim();
    if (!q) return;
    if (overrideQuery) setQuery(q);
    addToSearchHistory(q);
    setSearching(true);
    setSearchDone(false);
    setSearchAlbums([]);
    setSearchArtistResults([]);
    setStreamingResults([]);
    setOtherResults([]);
    setView('search');
    try {
      const data = await api.search(q);
      const torrentAlbums = data.albums || [];
      const mbOnly = (data.mbAlbums || []).map(a => ({ ...a, sources: a.sources || [] }));
      setSearchAlbums([...torrentAlbums, ...mbOnly]);
      setSearchArtistResults(data.artists || []);
      setStreamingResults((data.streamingResults || []).filter(r => r.duration));
      setOtherResults(data.otherResults || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }

  return {
    query, setQuery,
    searching,
    searchAlbums,
    searchDone,
    searchArtistResults,
    streamingResults,
    otherResults,
    searchHistory,
    handleSearch,
    addToSearchHistory,
    removeFromSearchHistory,
  };
}
