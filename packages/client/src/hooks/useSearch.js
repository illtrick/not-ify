import { useState } from 'react';
import * as api from '@not-ify/shared';
import { SEARCH_HISTORY_KEY, MAX_SEARCH_HISTORY } from '../constants';

export function useSearch({ setView }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchAlbums, setSearchAlbums] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [searchArtistResults, setSearchArtistResults] = useState([]);
  const [streamingResults, setStreamingResults] = useState([]);
  const [otherResults, setOtherResults] = useState([]);
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || []; } catch { return []; }
  });

  function addToSearchHistory(q) {
    setSearchHistory(prev => {
      const filtered = prev.filter(s => s.toLowerCase() !== q.toLowerCase());
      const next = [q, ...filtered].slice(0, MAX_SEARCH_HISTORY);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function removeFromSearchHistory(q) {
    setSearchHistory(prev => {
      const next = prev.filter(s => s !== q);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
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
