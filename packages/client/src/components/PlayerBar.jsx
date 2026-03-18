import React from 'react';
import { COLORS } from '../constants';
import { formatTime } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';

export function PlayerBar({
  currentTrack, currentAlbumInfo, currentCoverArt,
  isPlaying, volume, setVolume,
  progress, duration,
  queue, showQueue, setShowQueue,
  isMobile,
  audioRef,
  goToCurrentAlbum,
  togglePlay, playNext, playPrev,
  handleSeekClick,
  library,
}) {
  const has = !!currentTrack;
  const pct = duration ? (progress / duration) * 100 : 0;
  const canGoToAlbum = has && currentAlbumInfo && (library.length > 0 || currentAlbumInfo.artistMbid);

  return (
    <footer style={{
      height: isMobile ? 64 : 80, minHeight: isMobile ? 64 : 80, background: COLORS.surface,
      borderTop: `1px solid ${COLORS.border}`,
      display: 'flex', alignItems: 'center', padding: isMobile ? '0 8px' : '0 16px', gap: isMobile ? 8 : 12,
      position: 'relative',
    }} role="region" aria-label="Music player">

      {/* Mobile seek bar — slim progress at top of footer */}
      {isMobile && has && (
        <div style={{ position: 'absolute', top: -2, left: 0, right: 0, height: 16, cursor: 'pointer', zIndex: 1 }}
          onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const pctClick = (e.clientX - rect.left) / rect.width;
            if (audioRef.current && duration) audioRef.current.currentTime = pctClick * duration; }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: COLORS.border }}>
            <div style={{ height: '100%', width: `${pct}%`, background: COLORS.accent, transition: 'width 0.1s linear' }} />
          </div>
        </div>
      )}

      {/* Album art + info */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? undefined : 220, minWidth: 0, flexShrink: isMobile ? 1 : 0, flex: isMobile ? 1 : undefined, overflow: 'hidden', cursor: canGoToAlbum ? 'pointer' : 'default' }}
        onClick={canGoToAlbum ? goToCurrentAlbum : undefined}
        title={canGoToAlbum ? 'Go to album' : undefined}
      >
        <AlbumArt src={currentCoverArt} size={isMobile ? 40 : 52} radius={4} artist={currentAlbumInfo?.artist} album={currentAlbumInfo?.album} />
        <div
          style={{ minWidth: 0 }}
        >
          {has ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                {currentTrack.title}
                {currentTrack.isYtPreview && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.accent, background: 'rgba(233,69,96,0.15)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>YT</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: canGoToAlbum ? COLORS.textSecondary : COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                {[currentTrack.artist, currentTrack.album].filter(Boolean).join(' — ') || 'Unknown'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: COLORS.textSecondary }}>No track playing</div>
          )}
        </div>
      </div>

      {/* Controls + seek */}
      <div style={{ flex: isMobile ? undefined : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 0 : 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 12 }}>
          <button onClick={playPrev} disabled={!has} aria-label="Previous"
            style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icon.skipPrev(isMobile ? 16 : 18, has ? COLORS.textPrimary : COLORS.border)}
          </button>
          <button onClick={togglePlay} disabled={!has} aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: '50%', border: 'none', background: has ? COLORS.accent : COLORS.hover, cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isPlaying ? Icon.pause(isMobile ? 16 : 18, has ? '#fff' : COLORS.textSecondary) : Icon.play(isMobile ? 16 : 18, has ? '#fff' : COLORS.textSecondary)}
          </button>
          <button onClick={playNext} disabled={!has} aria-label="Next"
            style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icon.skipNext(isMobile ? 16 : 18, has ? COLORS.textPrimary : COLORS.border)}
          </button>
        </div>

        {/* Seek — hidden on mobile */}
        {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480 }}>
          <span style={{ fontSize: 11, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(progress)}</span>
          <div
            style={{ flex: 1, height: 12, cursor: has ? 'pointer' : 'default', position: 'relative', display: 'flex', alignItems: 'center' }}
            onClick={has ? handleSeekClick : undefined}
            onMouseEnter={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '1'; }}
            onMouseLeave={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '0'; }}
            role="slider" tabIndex={has ? 0 : -1}
            aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(progress)}
            onKeyDown={e => {
              if (!audioRef.current || !duration) return;
              if (e.key === 'ArrowRight') audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
              if (e.key === 'ArrowLeft') audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
            }}
          >
            <div style={{ position: 'absolute', width: '100%', height: 4, background: COLORS.border, borderRadius: 2 }} />
            <div style={{ position: 'absolute', height: 4, background: has ? COLORS.accent : COLORS.border, borderRadius: 2, width: `${pct}%`, transition: 'width 0.1s linear' }} />
            {has && <div className="seek-thumb" style={{ position: 'absolute', left: `calc(${pct}% - 6px)`, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} />}
          </div>
          <span style={{ fontSize: 11, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(duration)}</span>
        </div>}
      </div>

      {/* Mobile queue button */}
      {isMobile && (
        <button onClick={() => setShowQueue(v => !v)} style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {Icon.queue(18, showQueue ? COLORS.accent : COLORS.textSecondary)}
          {queue.length > 0 && (
            <span style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: '50%', background: COLORS.accent, color: '#fff', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{queue.length}</span>
          )}
        </button>
      )}

      {/* Volume + Queue toggle — desktop only */}
      {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => setVolume(v => v === 0 ? 0.7 : 0)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        >
          {volume === 0 ? Icon.volumeMute(16, COLORS.textSecondary) : volume < 0.5 ? Icon.volumeLow(16, COLORS.textSecondary) : Icon.volumeHigh(16, COLORS.textSecondary)}
        </button>
        <div
          style={{ width: 90, height: 12, display: 'flex', alignItems: 'center', position: 'relative', cursor: 'pointer' }}
          onMouseEnter={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '1'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.accent; }}
          onMouseLeave={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '0'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.textPrimary; }}
        >
          <div style={{ position: 'absolute', width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
          <div className="vol-fill" style={{ position: 'absolute', width: `${volume * 100}%`, height: 4, borderRadius: 2, background: COLORS.textPrimary, transition: 'background 0.15s' }} />
          <div className="vol-thumb" style={{ position: 'absolute', left: `calc(${volume * 100}% - 6px)`, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s' }} />
          <input type="range" min={0} max={1} step={0.01} value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
            aria-label="Volume" />
        </div>
        <button
          onClick={() => setShowQueue(v => !v)}
          title="Queue"
          style={{
            position: 'relative', background: showQueue ? COLORS.hover : 'transparent', border: 'none',
            cursor: 'pointer', padding: '6px 8px', borderRadius: 4, marginLeft: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {Icon.queue(18, showQueue ? COLORS.accent : COLORS.textSecondary)}
          {queue.length > 0 && (
            <span style={{
              position: 'absolute', top: 0, right: 0,
              width: 14, height: 14, borderRadius: '50%',
              background: COLORS.accent, color: '#fff', fontSize: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700,
            }}>{queue.length}</span>
          )}
        </button>
      </div>}
    </footer>
  );
}
