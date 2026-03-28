import { useState } from 'react';
import * as api from '@not-ify/shared';

export function useArtistPage({ setView, prevViewRef, view }) {
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [artistReleases, setArtistReleases] = useState([]);
  const [artistDetails, setArtistDetails] = useState(null);
  const [artistBio, setArtistBio] = useState(null);
  const [artistTopTracks, setArtistTopTracks] = useState([]);

  async function openArtistPage(mbid, name, type) {
    setSelectedArtist({ mbid, name, type: type || null });
    setArtistReleases([]);
    setArtistDetails(null);
    setArtistBio(null);
    setArtistTopTracks([]);
    prevViewRef.current = view;
    setView('artist');

    // Fetch top tracks from Last.fm (fires immediately, independent of MB data)
    api.getLastfmTopTracks(name, 10)
      .then(tracks => { if (Array.isArray(tracks) && tracks.length) setArtistTopTracks(tracks); })
      .catch(() => {});

    try {
      const data = await api.getArtist(mbid, name);
      setArtistReleases(data.releases || []);
      if (data.details) {
        setArtistDetails(data.details);
        // Lazy-load Wikipedia bio if link available (prefer Wikipedia, fall back to Wikidata)
        const wikiUrl = data.details.links?.wikipedia || data.details.links?.wikidata;
        if (wikiUrl) {
          api.getWikiSummary(wikiUrl)
            .then(bio => { if (bio) setArtistBio(bio); })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('Artist page load failed:', err);
    }
  }

  return {
    selectedArtist,
    artistReleases,
    artistDetails,
    artistBio,
    artistTopTracks,
    openArtistPage,
  };
}
