// Suite D — Pure utility function tests from App.jsx
import { describe, test, expect, vi } from 'vitest';
import { formatTime, buildTrackPath, debounce, trackRowStyle, hashColor } from '../src/App.jsx';

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
describe('formatTime', () => {
  test('formats whole seconds', () => {
    expect(formatTime(90)).toBe('1:30');
  });

  test('pads seconds to 2 digits', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  test('handles zero', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  test('handles null/undefined gracefully', () => {
    expect(formatTime(null)).toBe('0:00');
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  test('handles large duration (full album)', () => {
    expect(formatTime(3600)).toBe('60:00');
  });

  test('floors fractional seconds', () => {
    expect(formatTime(61.9)).toBe('1:01');
  });
});

// ---------------------------------------------------------------------------
// buildTrackPath
// ---------------------------------------------------------------------------
describe('buildTrackPath', () => {
  test('builds correct stream URL', () => {
    expect(buildTrackPath('abc123')).toBe('/api/stream/abc123');
  });

  test('works with MD5 hash IDs', () => {
    const md5 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    expect(buildTrackPath(md5)).toBe(`/api/stream/${md5}`);
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------
describe('debounce', () => {
  test('calls function after delay', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a');
    vi.useRealTimers();
  });

  test('cancels earlier call when invoked again before delay', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('first');
    vi.advanceTimersByTime(50);
    debounced('second');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
    vi.useRealTimers();
  });

  test('allows subsequent calls after delay passes', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced('a');
    vi.advanceTimersByTime(50);
    debounced('b');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// trackRowStyle
// ---------------------------------------------------------------------------
describe('trackRowStyle', () => {
  test('active row has highlight background', () => {
    const style = trackRowStyle(true, false, false);
    expect(style.background).toContain('rgba');
    expect(style.background).not.toBe('transparent');
  });

  test('hovered-only row has subtle highlight', () => {
    const activeStyle = trackRowStyle(true, false, false);
    const hoveredStyle = trackRowStyle(false, true, false);
    expect(hoveredStyle.background).not.toBe('transparent');
    // Active should be more prominent than hovered
    expect(activeStyle.background).not.toBe(hoveredStyle.background);
  });

  test('inactive non-hovered row is transparent', () => {
    const style = trackRowStyle(false, false, false);
    expect(style.background).toBe('transparent');
  });

  test('mobile vs desktop: different padding', () => {
    const desktop = trackRowStyle(false, false, false);
    const mobile  = trackRowStyle(false, false, true);
    expect(desktop.padding).not.toBe(mobile.padding);
  });

  test('returns display:flex layout', () => {
    const style = trackRowStyle(false, false, false);
    expect(style.display).toBe('flex');
    expect(style.alignItems).toBe('center');
  });
});

// ---------------------------------------------------------------------------
// hashColor
// ---------------------------------------------------------------------------
describe('hashColor', () => {
  test('returns a hex color string', () => {
    const color = hashColor('Pink Floyd');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('deterministic — same input gives same color', () => {
    expect(hashColor('Radiohead')).toBe(hashColor('Radiohead'));
  });

  test('different inputs produce different colors (generally)', () => {
    // There can be collisions in theory, but these specific strings shouldn't collide
    expect(hashColor('Artist A')).not.toBe(hashColor('Artist B'));
  });

  test('handles empty string', () => {
    const color = hashColor('');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
