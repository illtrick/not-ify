// Suite D — Presentational component tests
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlbumArt, SkeletonCard, TopResultCard, ArtistPill, AlbumCard } from '../src/App.jsx';

// ---------------------------------------------------------------------------
// AlbumArt — D1
// ---------------------------------------------------------------------------
describe('AlbumArt', () => {
  test('renders img when src provided', () => {
    const { container } = render(<AlbumArt src="https://example.com/cover.jpg" />);
    // alt="" means role=presentation, not img — query directly
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  test('renders music icon placeholder when src is null', () => {
    const { container } = render(<AlbumArt src={null} />);
    // No img tag — falls back to SVG icon
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('renders music icon placeholder when no src and no artist/album', () => {
    const { container } = render(<AlbumArt />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('falls back to /api/cover/search URL when src is null but artist+album given', () => {
    const { container } = render(<AlbumArt src={null} artist="Pink Floyd" album="Animals" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('/api/cover/search');
    expect(img.getAttribute('src')).toContain('Pink');
    expect(img.getAttribute('src')).toContain('Animals');
  });

  test('on image error falls back to none phase (shows icon)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AlbumArt src="https://example.com/cover.jpg" />
    );
    const img = container.querySelector('img');
    fireEvent.error(img);
    // After error with no fallback artist/album, should show icon
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('on error falls back to /api/cover/search when artist+album provided', () => {
    const { container } = render(<AlbumArt src="https://example.com/broken.jpg" artist="Radiohead" album="OK Computer" />);
    const img = container.querySelector('img');
    fireEvent.error(img);
    // Now shows the fallback URL
    const img2 = container.querySelector('img');
    expect(img2).not.toBeNull();
    expect(img2.getAttribute('src')).toContain('/api/cover/search');
  });

  test('applies custom size', () => {
    const { container } = render(<AlbumArt src="https://example.com/a.jpg" size={200} />);
    const wrapper = container.firstChild;
    expect(wrapper.style.width).toBe('200px');
    expect(wrapper.style.height).toBe('200px');
  });
});

// ---------------------------------------------------------------------------
// SkeletonCard — D1 (placeholder)
// ---------------------------------------------------------------------------
describe('SkeletonCard', () => {
  test('renders without crashing', () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstChild).toBeTruthy();
  });

  test('renders skeleton shimmer divs', () => {
    const { container } = render(<SkeletonCard />);
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// TopResultCard — D2
// ---------------------------------------------------------------------------
const sampleAlbum = {
  album: 'Dark Side of the Moon',
  artist: 'Pink Floyd',
  year: '1973',
  coverArt: 'https://example.com/dsotm.jpg',
  sources: [],
};

describe('TopResultCard', () => {
  test('renders album name', () => {
    render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} />);
    expect(screen.getByText('Dark Side of the Moon')).toBeTruthy();
  });

  test('renders artist name', () => {
    render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} />);
    expect(screen.getByText(/Pink Floyd/)).toBeTruthy();
  });

  test('renders year', () => {
    render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} />);
    expect(screen.getByText(/1973/)).toBeTruthy();
  });

  test('shows IN LIBRARY badge when inLibrary=true', () => {
    render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} inLibrary={true} />);
    expect(screen.getByText('IN LIBRARY')).toBeTruthy();
  });

  test('hides IN LIBRARY badge when inLibrary=false', () => {
    render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} inLibrary={false} />);
    expect(screen.queryByText('IN LIBRARY')).toBeNull();
  });

  test('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<TopResultCard album={sampleAlbum} onClick={onClick} onPlay={() => {}} />);
    fireEvent.click(screen.getByText('Dark Side of the Moon').closest('div[style]'));
    expect(onClick).toHaveBeenCalled();
  });

  test('play button appears on hover', () => {
    const { container } = render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} />);
    const card = container.firstChild;
    // No button before hover
    expect(container.querySelector('button')).toBeNull();
    fireEvent.mouseEnter(card);
    // Button appears after hover
    expect(container.querySelector('button')).toBeTruthy();
  });

  test('play button calls onPlay when clicked', () => {
    const onPlay = vi.fn();
    const { container } = render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={onPlay} />);
    fireEvent.mouseEnter(container.firstChild);
    const btn = container.querySelector('button');
    fireEvent.click(btn);
    expect(onPlay).toHaveBeenCalled();
  });

  test('compact mode: smaller art size (80px)', () => {
    const { container } = render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} compact={true} />);
    // card div → first child = art wrapper div
    const card = container.firstChild;
    const artWrapper = card.children[0];
    expect(artWrapper.style.width).toBe('80px');
  });

  test('standard mode: larger art size (120px)', () => {
    const { container } = render(<TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} compact={false} />);
    const card = container.firstChild;
    const artWrapper = card.children[0];
    expect(artWrapper.style.width).toBe('120px');
  });

  test('disabled play button when isDownloading=true', () => {
    const { container } = render(
      <TopResultCard album={sampleAlbum} onClick={() => {}} onPlay={() => {}} isDownloading={true} />
    );
    fireEvent.mouseEnter(container.firstChild);
    const btn = container.querySelector('button');
    expect(btn).toHaveAttribute('disabled');
  });
});

// ---------------------------------------------------------------------------
// ArtistPill — D2 (artist result card)
// ---------------------------------------------------------------------------
describe('ArtistPill', () => {
  test('renders artist name', () => {
    render(<ArtistPill name="Radiohead" type="artist" onClick={() => {}} />);
    expect(screen.getByText('Radiohead')).toBeTruthy();
  });

  test('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ArtistPill name="Tool" type="artist" onClick={onClick} />);
    fireEvent.click(screen.getByText('Tool').closest('div'));
    expect(onClick).toHaveBeenCalled();
  });

  test('renders without crashing for group type', () => {
    render(<ArtistPill name="The Beatles" type="group" onClick={() => {}} />);
    expect(screen.getByText('The Beatles')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AlbumCard — D2 (grid album card)
// ---------------------------------------------------------------------------
const sampleAlbumCard = {
  album: 'OK Computer',
  artist: 'Radiohead',
  year: '1997',
  coverArt: 'https://example.com/okc.jpg',
  sources: [],
};

describe('AlbumCard', () => {
  test('renders album name', () => {
    render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={() => {}} />);
    expect(screen.getByText('OK Computer')).toBeTruthy();
  });

  test('renders artist name', () => {
    render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={() => {}} />);
    expect(screen.getByText(/Radiohead/)).toBeTruthy();
  });

  test('calls onClick when card body is clicked', () => {
    const onClick = vi.fn();
    render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={onClick} />);
    // Click somewhere on the card (not a button)
    fireEvent.click(screen.getByText('OK Computer'));
    expect(onClick).toHaveBeenCalled();
  });

  test('shows green dot indicator when inLibrary=true', () => {
    // AlbumCard shows inLibrary as a small 8px green circle span (not text)
    const { container } = render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={() => {}} inLibrary={true} />);
    // Check for a span with green background in the title area
    const titleDiv = container.querySelector('.card-title');
    const dot = titleDiv.querySelector('span');
    expect(dot).not.toBeNull();
    expect(dot.style.background).toContain('rgb');
  });

  test('does not show dot indicator when inLibrary=false', () => {
    const { container } = render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={() => {}} inLibrary={false} />);
    const titleDiv = container.querySelector('.card-title');
    expect(titleDiv.querySelector('span')).toBeNull();
  });

  test('renders cover art image', () => {
    const { container } = render(<AlbumCard album={sampleAlbumCard} onPlay={() => {}} onClick={() => {}} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/okc.jpg');
  });
});
