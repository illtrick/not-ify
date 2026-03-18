import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { SkeletonCard } from './SkeletonCard';
import { SectionHeader } from './SectionHeader';
import { TopResultCard } from './TopResultCard';
import { ArtistPill } from './ArtistPill';
import { AlbumCard } from './AlbumCard';
import { StreamingTopResult } from './StreamingTopResult';
import { StreamingSongRow } from './StreamingSongRow';

export function SearchView({
  query, setQuery, handleSearch, searching,
  searchAlbums, searchDone, searchArtistResults,
  streamingResults, otherResults, searchHistory,
  removeFromSearchHistory,
  recentlyPlayed, lastfmTopArtists,
  libraryAlbums, openAlbumFromLibrary, openAlbumFromSearch, openArtistPage,
  startDownload, startYtDownload, playStreamingResult,
  isInLibrary, downloading,
  isMobile,
  currentTrack,
}) {
  // Determine if the query is primarily an artist name
  const topArtist = searchArtistResults[0];
  const qLower = query.trim().toLowerCase();
  const isArtistQuery = topArtist && topArtist.score >= 95 &&
    topArtist.name.toLowerCase() === qLower;

  // Pick top result: prefer artist's album when query matches an artist
  let topResult = null;
  if (isArtistQuery && searchAlbums.length > 0) {
    // Find the newest album by the matched artist
    topResult = searchAlbums
      .filter(a => a.artist.toLowerCase() === topArtist.name.toLowerCase() && a.coverArt)
      .sort((a, b) => (b.year || 0) - (a.year || 0))[0]
      || searchAlbums.find(a => a.mbid && a.coverArt) || searchAlbums[0] || null;
  } else {
    topResult = searchAlbums.find(a => a.mbid && a.coverArt) || searchAlbums[0] || null;
  }

  // Sort remaining albums: newest first
  const restAlbums = searchAlbums
    .filter(a => a !== topResult)
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ marginBottom: isMobile ? 20 : 32 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for artists, albums..."
              style={{
                width: '100%', padding: isMobile ? '12px 14px' : '14px 18px',
                paddingRight: query ? 40 : undefined,
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`, background: COLORS.hover,
                color: COLORS.textPrimary, fontSize: 16, outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = COLORS.accent}
              onBlur={e => e.target.style.borderColor = COLORS.border}
              aria-label="Search"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); }}
                aria-label="Clear search"
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
                  width: 24, height: 24, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0,
                }}
              >
                {Icon.close(14, COLORS.textSecondary)}
              </button>
            )}
          </div>
          <button
            type="submit"
            style={{
              padding: isMobile ? '12px 16px' : '14px 24px', borderRadius: 8, border: 'none',
              background: COLORS.accent, color: '#fff', fontSize: 15,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Search
          </button>
        </div>
      </form>

      {/* Loading skeletons */}
      {searching && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* No album results at all — show streaming results or empty state */}
      {!searching && searchDone && searchAlbums.length === 0 && (
        streamingResults.length > 0 ? (
          <div>
            {/* Top row: Top Result + Artists/Songs — same layout as torrent results */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (searchArtistResults.length > 0 ? '1fr 1fr' : '1fr'), gap: isMobile ? 16 : 24, marginBottom: isMobile ? 20 : 32 }}>
              {/* Top Result */}
              <div>
                <SectionHeader>Top Result</SectionHeader>
                {(() => {
                  const top = streamingResults[0];
                  return (
                    <StreamingTopResult
                      result={top}
                      onPlay={() => playStreamingResult(top)}
                      onDownload={() => startYtDownload(top)}
                      isDownloading={!!downloading}
                      compact={isMobile}
                    />
                  );
                })()}
              </div>

              {/* Artists (from MusicBrainz) */}
              {searchArtistResults.length > 0 && (
                <div>
                  <SectionHeader>Artists</SectionHeader>
                  <div style={{ background: COLORS.card, borderRadius: 8, padding: 8 }}>
                    {searchArtistResults.slice(0, 5).map(a => (
                      <ArtistPill
                        key={a.mbid}
                        name={a.name}
                        type={a.type}
                        onClick={() => openArtistPage(a.mbid, a.name, a.type)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Songs list */}
            <div style={{ marginBottom: 32 }}>
              <SectionHeader>Songs</SectionHeader>
              <div style={{ background: COLORS.card, borderRadius: 8, padding: '4px 0' }}>
                {streamingResults.slice(0, 8).map(r => (
                  <StreamingSongRow
                    key={`${r.source}-${r.id}`}
                    result={r}
                    isActive={currentTrack?.id === `yt-${r.id}`}
                    onPlay={() => playStreamingResult(r)}
                    onDownload={() => startYtDownload(r)}
                    isDownloading={!!downloading}
                  />
                ))}
              </div>
            </div>

            {/* More songs list */}
            {streamingResults.length > 8 && (
              <div>
                <SectionHeader>More Songs</SectionHeader>
                <div style={{ background: COLORS.card, borderRadius: 8, padding: '4px 0' }}>
                  {streamingResults.slice(8).map(r => (
                    <StreamingSongRow
                      key={`${r.source}-${r.id}`}
                      result={r}
                      isActive={currentTrack?.id === `yt-${r.id}`}
                      onPlay={() => playStreamingResult(r)}
                      onDownload={() => startYtDownload(r)}
                      isDownloading={!!downloading}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 80, fontSize: 15 }}>
            No results found. Try a different search.
          </div>
        )
      )}

      {/* Home state — search history, recently played, top artists */}
      {!searching && !searchDone && (
        <div>
          {/* Recent searches */}
          {searchHistory.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 10 }}>Recent Searches</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {searchHistory.map((q, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 0, background: COLORS.hover, borderRadius: 16, overflow: 'hidden' }}>
                    <button
                      onClick={() => handleSearch(null, q)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '6px 4px 6px 14px', fontSize: 13, color: COLORS.textPrimary,
                      }}
                    >{q}</button>
                    <button
                      onClick={() => removeFromSearchHistory(q)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '6px 10px 6px 4px', display: 'flex', alignItems: 'center',
                        opacity: 0.4,
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                      title="Remove"
                    >{Icon.close(10, COLORS.textSecondary)}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recently played */}
          {recentlyPlayed.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Recently Played</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
                {recentlyPlayed.map((r, i) => {
                  const libAlbum = libraryAlbums().find(la =>
                    la.artist.toLowerCase() === r.artist.toLowerCase() && la.album.toLowerCase() === r.album.toLowerCase()
                  );
                  return (
                    <div key={i}
                      style={{ background: COLORS.card, borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                      onClick={() => {
                        if (libAlbum) openAlbumFromLibrary(libAlbum.artist, libAlbum.album, libAlbum.tracks, libAlbum.coverArt, libAlbum.mbid);
                        else handleSearch(null, `${r.artist} ${r.album}`);
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                      onMouseLeave={e => e.currentTarget.style.background = COLORS.card}
                    >
                      <div style={{ width: '100%', paddingBottom: '100%', borderRadius: 4, overflow: 'hidden', position: 'relative', marginBottom: 10, background: COLORS.hover }}>
                        {(() => {
                          const coverUrl = r.coverArt || `/api/cover/search?artist=${encodeURIComponent(r.artist)}&album=${encodeURIComponent(r.album)}`;
                          return <img src={coverUrl} alt="" loading="lazy" onError={e => e.target.style.display = 'none'}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
                        })()}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.album}</div>
                      <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.artist}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Last.fm top artists */}
          {lastfmTopArtists.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Your Top Artists</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                {lastfmTopArtists.map((a, i) => (
                  <div key={i} style={{ background: COLORS.card, borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                    onClick={() => handleSearch(null, a.name)}
                    onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                    onMouseLeave={e => e.currentTarget.style.background = COLORS.card}>
                    <div style={{ width: '100%', paddingBottom: '100%', borderRadius: '50%', overflow: 'hidden', position: 'relative', marginBottom: 10, background: COLORS.hover }}>
                      <img src={`/api/artist/image?name=${encodeURIComponent(a.name)}`} alt="" loading="lazy"
                        onError={e => e.target.style.display = 'none'}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary }}>{parseInt(a.playcount).toLocaleString()} plays</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback empty state when no history at all */}
          {searchHistory.length === 0 && recentlyPlayed.length === 0 && lastfmTopArtists.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 80 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🎵</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 8 }}>Discover music</div>
              <div style={{ fontSize: 15, color: COLORS.textSecondary }}>Search for your favorite artists and albums</div>
            </div>
          )}
        </div>
      )}

      {/* Categorized results */}
      {!searching && searchAlbums.length > 0 && (
        <div>
          {/* Top row: Top Result + Artists */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (searchArtistResults.length > 0 ? '1fr 1fr' : '1fr'), gap: isMobile ? 16 : 24, marginBottom: isMobile ? 20 : 32 }}>
            {/* Top Result */}
            {topResult && (
              <div>
                <SectionHeader>Top Result</SectionHeader>
                <TopResultCard
                  album={topResult}
                  isDownloading={!!downloading}
                  inLibrary={isInLibrary(topResult.artist, topResult.album)}
                  compact={isMobile}
                  onPlay={() => {
                    const best = topResult.sources?.[0];
                    if (best) startDownload(best, topResult, true);
                    else openAlbumFromSearch(topResult); // MB-only: open detail for YT playback
                  }}
                  onClick={() => openAlbumFromSearch(topResult)}
                />
              </div>
            )}

            {/* Artists */}
            {searchArtistResults.length > 0 && (
              <div>
                <SectionHeader>Artists</SectionHeader>
                <div style={{ background: COLORS.card, borderRadius: 8, padding: 8 }}>
                  {searchArtistResults.slice(0, 5).map(a => (
                    <ArtistPill
                      key={a.mbid}
                      name={a.name}
                      type={a.type}
                      onClick={() => openArtistPage(a.mbid, a.name, a.type)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Albums grid */}
          {restAlbums.length > 0 && (
            <div>
              <SectionHeader>Albums</SectionHeader>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
                {restAlbums.map(album => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    isDownloading={!!downloading}
                    inLibrary={isInLibrary(album.artist, album.album)}
                    onPlay={() => {
                      const best = album.sources?.[0];
                      if (best) startDownload(best, album, true);
                      else openAlbumFromSearch(album);
                    }}
                    onClick={() => openAlbumFromSearch(album)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other Results — unmatched torrents that passed filters */}
          {otherResults.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <SectionHeader>Other Results</SectionHeader>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 20 }}>
                {otherResults.map(album => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    isDownloading={!!downloading}
                    inLibrary={isInLibrary(album.artist, album.album)}
                    onPlay={() => {
                      const best = album.sources?.[0];
                      if (best) startDownload(best, album, true);
                      else openAlbumFromSearch(album);
                    }}
                    onClick={() => openAlbumFromSearch(album)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
