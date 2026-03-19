// Test: AlbumView MB track list shows QualityBadge with format when track exists in library
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlbumView } from '../src/components/AlbumView';

// Minimal props required to render AlbumView in MB track list mode
function makeProps(overrides = {}) {
  return {
    selectedAlbum: {
      artist: 'Radiohead',
      album: 'OK Computer',
      year: '1997',
      coverArt: null,
      tracks: [],
      sources: [],
      fromSearch: true,
      trackCount: 2,
    },
    mbTracks: [
      { position: 1, title: 'Paranoid Android', lengthMs: 388000 },
      { position: 2, title: 'Karma Police', lengthMs: 264000 },
    ],
    library: [
      { id: 'lib-1', title: 'Paranoid Android', artist: 'Radiohead', album: 'OK Computer', format: 'FLAC' },
    ],
    albumColor: null,
    mainContentRef: { current: null },
    moreByArtist: [],
    trackDurations: {},
    isMobile: false,
    isPlaying: false,
    currentTrack: null,
    currentAlbumInfo: null,
    hoveredTrack: null, setHoveredTrack: vi.fn(),
    hoveredMbTrack: null, setHoveredMbTrack: vi.fn(),
    ytSearching: false, ytPendingTrack: null,
    downloading: null,
    searchArtistResults: [],
    isInLibrary: vi.fn(() => false),
    prevViewRef: { current: 'search' },
    setView: vi.fn(),
    playTrack: vi.fn(),
    togglePlay: vi.fn(),
    playAllFromYouTube: vi.fn(),
    openAlbumFromSearch: vi.fn(),
    openArtistPage: vi.fn(),
    handleSearch: vi.fn(),
    startDownload: vi.fn(),
    showContextMenu: vi.fn(),
    addToQueue: vi.fn(),
    setQueue: vi.fn(),
    removeTrackFromLibrary: vi.fn(),
    getTrackDlStatus: vi.fn(() => null),
    ...overrides,
  };
}

describe('AlbumView MB track list — quality badge from library', () => {
  test('shows FLAC badge for MB track that exists in library', () => {
    const props = makeProps();
    const { container } = render(<AlbumView {...props} />);
    // "Paranoid Android" is in library with FLAC format — should render FLAC badge
    expect(screen.getByText('FLAC')).toBeTruthy();
  });

  test('shows dash for MB track not in library', () => {
    const props = makeProps();
    const { container } = render(<AlbumView {...props} />);
    // "Karma Police" is NOT in library — should show a dash (—)
    const dashes = container.querySelectorAll('span');
    const dashSpan = Array.from(dashes).find(s => s.textContent === '—');
    expect(dashSpan).toBeTruthy();
  });

  test('shows dash for all tracks when library is empty', () => {
    const props = makeProps({ library: [] });
    const { container } = render(<AlbumView {...props} />);
    expect(screen.queryByText('FLAC')).toBeNull();
    const dashes = container.querySelectorAll('span');
    const dashSpans = Array.from(dashes).filter(s => s.textContent === '—');
    expect(dashSpans.length).toBeGreaterThanOrEqual(1);
  });

  test('shows dash for all tracks when library prop is undefined', () => {
    const props = makeProps({ library: undefined });
    const { container } = render(<AlbumView {...props} />);
    expect(screen.queryByText('FLAC')).toBeNull();
  });

  test('matches tracks case-insensitively', () => {
    const props = makeProps({
      library: [
        { id: 'lib-1', title: 'paranoid android', artist: 'radiohead', album: 'ok computer', format: 'MP3' },
      ],
    });
    render(<AlbumView {...props} />);
    expect(screen.getByText('MP3')).toBeTruthy();
  });
});
