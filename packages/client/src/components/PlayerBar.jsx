import React, { useState, useRef } from 'react';
import { COLORS } from '../constants';
import { formatTime } from '../utils';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';
import { CastButton } from './CastButton';

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
  // Cast props (optional — casting feature)
  cast,
}) {
  const has = !!currentTrack;
  const [seekDragging, setSeekDragging] = useState(false);
  const [seekDragValue, setSeekDragValue] = useState(0);
  const seekFreezeRef = useRef(null);
  const displayProgress = seekDragging ? seekDragValue : (seekFreezeRef.current !== null ? seekFreezeRef.current : progress);
  const pct = duration ? (displayProgress / duration) * 100 : 0;
  const canGoToAlbum = has && currentAlbumInfo && (library.length > 0 || currentAlbumInfo.artistMbid);

  return (
    <footer style={{
      height: isMobile ? 72 : 90, minHeight: isMobile ? 72 : 90, background: COLORS.surface,
      borderTop: `1px solid ${COLORS.border}`,
      display: 'flex', alignItems: 'center', padding: isMobile ? '0 10px' : '0 20px', gap: isMobile ? 10 : 16,
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
        style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 14, width: isMobile ? undefined : 260, minWidth: 0, flexShrink: isMobile ? 1 : 0, flex: isMobile ? 1 : undefined, overflow: 'hidden', cursor: canGoToAlbum ? 'pointer' : 'default' }}
        onClick={canGoToAlbum ? goToCurrentAlbum : undefined}
        title={canGoToAlbum ? 'Go to album' : undefined}
      >
        <AlbumArt src={currentCoverArt} size={isMobile ? 56 : 72} radius={6} artist={currentAlbumInfo?.artist} album={currentAlbumInfo?.album} />
        <div
          style={{ minWidth: 0 }}
        >
          {has ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                {currentTrack.title}
                {currentTrack.isYtPreview && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.accent, background: 'rgba(233,69,96,0.15)', padding: '1px 6px', borderRadius: 3, flexShrink: 0 }}>YT</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: canGoToAlbum ? COLORS.textSecondary : COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>
                {[currentTrack.artist, currentTrack.album].filter(Boolean).join(' — ') || 'Unknown'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 15, color: COLORS.textSecondary }}>No track playing</div>
          )}
        </div>
      </div>

      {/* Controls + seek */}
      <div style={{ flex: isMobile ? undefined : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 0 : 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
          <button onClick={playPrev} disabled={!has} aria-label="Previous"
            style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icon.skipPrev(isMobile ? 20 : 24, has ? COLORS.textPrimary : COLORS.border)}
          </button>
          <button onClick={togglePlay} disabled={!has} aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ width: isMobile ? 44 : 52, height: isMobile ? 44 : 52, borderRadius: '50%', border: 'none', background: has ? COLORS.accent : COLORS.hover, cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isPlaying ? Icon.pause(isMobile ? 20 : 24, has ? '#fff' : COLORS.textSecondary) : Icon.play(isMobile ? 20 : 24, has ? '#fff' : COLORS.textSecondary)}
          </button>
          <button onClick={playNext} disabled={!has} aria-label="Next"
            style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius: '50%', border: 'none', background: 'transparent', cursor: has ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icon.skipNext(isMobile ? 20 : 24, has ? COLORS.textPrimary : COLORS.border)}
          </button>
        </div>

        {/* Seek — hidden on mobile */}
        {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480 }}>
          <span style={{ fontSize: 12, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(displayProgress)}</span>
          <div
            style={{ flex: 1, height: 14, cursor: has ? 'pointer' : 'default', position: 'relative', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '1'; }}
            onMouseLeave={e => { const t = e.currentTarget.querySelector('.seek-thumb'); if (t) t.style.opacity = '0'; }}
          >
            <div style={{ position: 'absolute', width: '100%', height: 4, background: COLORS.border, borderRadius: 2 }} />
            <div style={{ position: 'absolute', height: 4, background: has ? COLORS.accent : COLORS.border, borderRadius: 2, width: `${pct}%`, transition: 'width 0.1s linear' }} />
            {has && <div className="seek-thumb" style={{ position: 'absolute', left: `calc(${pct}% - 7px)`, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} />}
            <input type="range" min={0} max={Math.round(duration) || 1} step={1} value={Math.round(displayProgress)}
              onMouseDown={() => setSeekDragging(true)}
              onTouchStart={() => setSeekDragging(true)}
              onChange={e => {
                const val = parseFloat(e.target.value);
                setSeekDragValue(val);
                // Only scrub local audio live — cast seeks on release only
                if (!cast?.isCasting && audioRef.current) audioRef.current.currentTime = val;
              }}
              onMouseUp={e => {
                const val = seekDragging ? seekDragValue : parseFloat(e.target.value);
                setSeekDragging(false);
                if (cast?.isCasting && cast.castSeek) {
                  cast.castSeek(Math.round(val));
                }
              }}
              onTouchEnd={e => {
                const val = seekDragging ? seekDragValue : parseFloat(e.target.value);
                setSeekDragging(false);
                if (cast?.isCasting && cast.castSeek) {
                  cast.castSeek(Math.round(val));
                }
              }}
              style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
              aria-label="Seek" disabled={!has} />
          </div>
          <span style={{ fontSize: 12, color: COLORS.textSecondary, flexShrink: 0 }}>{formatTime(duration)}</span>
        </div>}
      </div>

      {/* Mobile queue button */}
      {isMobile && (
        <button onClick={() => setShowQueue(v => !v)} style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {Icon.queue(22, showQueue ? COLORS.accent : COLORS.textSecondary)}
          {queue.length > 0 && (
            <span style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: '50%', background: COLORS.accent, color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{queue.length}</span>
          )}
        </button>
      )}

      {/* Volume + Queue toggle — desktop only */}
      {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button
          onClick={() => setVolume(v => v === 0 ? 0.7 : 0)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        >
          {volume === 0 ? Icon.volumeMute(22, COLORS.textSecondary) : volume < 0.5 ? Icon.volumeLow(22, COLORS.textSecondary) : Icon.volumeHigh(22, COLORS.textSecondary)}
        </button>
        <div
          style={{ width: 100, height: 14, display: 'flex', alignItems: 'center', position: 'relative', cursor: 'pointer' }}
          onMouseEnter={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '1'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.accent; }}
          onMouseLeave={e => { const thumb = e.currentTarget.querySelector('.vol-thumb'); if (thumb) thumb.style.opacity = '0'; const bar = e.currentTarget.querySelector('.vol-fill'); if (bar) bar.style.background = COLORS.textPrimary; }}
        >
          <div style={{ position: 'absolute', width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
          <div className="vol-fill" style={{ position: 'absolute', width: `${volume * 100}%`, height: 4, borderRadius: 2, background: COLORS.textPrimary, transition: 'background 0.15s' }} />
          <div className="vol-thumb" style={{ position: 'absolute', left: `calc(${volume * 100}% - 7px)`, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.15s' }} />
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
            cursor: 'pointer', padding: '10px 12px', borderRadius: 6, marginLeft: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {Icon.queue(22, showQueue ? COLORS.accent : COLORS.textSecondary)}
          {queue.length > 0 && (
            <span style={{
              position: 'absolute', top: 0, right: 0,
              width: 16, height: 16, borderRadius: '50%',
              background: COLORS.accent, color: '#fff', fontSize: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700,
            }}>{queue.length}</span>
          )}
        </button>
        {cast && (
          <CastButton
            devices={cast.devices}
            activeDevice={cast.activeDevice}
            isCasting={cast.isCasting}
            showDevicePicker={cast.showDevicePicker}
            setShowDevicePicker={cast.setShowDevicePicker}
            selectDevice={cast.onSelectDevice || cast.selectDevice}
            castStop={cast.castStop}
          />
        )}
      </div>}
      {/* Cast status bar — shown above main footer content when casting or has log */}
      {cast && (cast.isCasting || cast.castLog?.length > 0) && (
        <div style={{
          position: 'absolute', top: -28, left: 0, right: 0, height: 24,
          background: COLORS.hover, borderTop: `1px solid ${COLORS.border}`,
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 8,
        }}>
          {cast.isCasting && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.accent, animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 12, color: cast.isCasting ? COLORS.accent : COLORS.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {cast.isCasting
              ? `Casting to ${(() => { const d = cast.devices.find(d => d.usn === cast.activeDevice); return d?.roomName || d?.friendlyName || 'device'; })()}`
              : cast.castLog?.[0]?.message || ''
            }
          </span>
          {cast.castLog?.[0] && (
            <span style={{ fontSize: 11, color: COLORS.textSecondary, opacity: 0.5, flexShrink: 0 }}>
              {cast.castLog[0].timestamp}
            </span>
          )}
        </div>
      )}
    </footer>
  );
}
