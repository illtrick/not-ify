import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { AlbumArt } from './AlbumArt';

export function QueuePanel({
  queue, setQueue,
  showQueue, setShowQueue,
  dragIdx, setDragIdx,
  dragOverIdx, setDragOverIdx,
  clearQueue, removeFromQueue,
  playlist, playlistIdx,
  currentTrack, currentCoverArt, currentAlbumInfo,
  isMobile,
}) {
  const upcomingPlaylist = playlist.length > 0
    ? playlist.slice(playlistIdx + 1).concat(playlist.slice(0, playlistIdx))
    : [];

  return (
    <div style={{
      ...(isMobile ? {
        position: 'fixed', inset: 0, zIndex: 50,
        background: COLORS.surface,
        display: showQueue ? 'flex' : 'none', flexDirection: 'column',
        overflowY: 'auto',
      } : {
        width: showQueue ? 320 : 0, minWidth: showQueue ? 320 : 0,
        background: COLORS.surface,
        borderLeft: showQueue ? `1px solid ${COLORS.border}` : 'none',
        overflowY: 'auto', overflowX: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
      }),
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>Queue</span>
        <button onClick={() => setShowQueue(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close(16, COLORS.textSecondary)}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {/* Now Playing */}
        {currentTrack && (
          <div style={{ padding: '0 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Now playing</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <AlbumArt src={currentCoverArt} size={48} radius={4} artist={currentAlbumInfo?.artist} album={currentAlbumInfo?.album} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.artist}</div>
              </div>
            </div>
          </div>
        )}

        {/* User queue */}
        {queue.length > 0 && (
          <div style={{ padding: '0 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1 }}>Next in queue</span>
              <button onClick={clearQueue} style={{ background: 'none', border: 'none', color: COLORS.textSecondary, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            </div>
            {queue.map((track, idx) => (
              <div
                key={`q-${idx}`}
                draggable
                onDragStart={e => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx); }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={e => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== idx) {
                    setQueue(prev => {
                      const updated = [...prev];
                      const [moved] = updated.splice(dragIdx, 1);
                      updated.splice(idx, 0, moved);
                      return updated;
                    });
                  }
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0',
                  opacity: dragIdx === idx ? 0.4 : 1,
                  borderTop: dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? `2px solid ${COLORS.accent}` : '2px solid transparent',
                  cursor: 'grab', transition: 'opacity 0.15s',
                }}
              >
                <span style={{ fontSize: 12, color: COLORS.textSecondary, cursor: 'grab', padding: '0 2px', userSelect: 'none' }}>⠿</span>
                <AlbumArt src={track.coverArt} size={40} radius={4} artist={track.artist} album={track.album} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                </div>
                <button onClick={() => removeFromQueue(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close(14, COLORS.textSecondary)}</button>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming from playlist */}
        {upcomingPlaylist.length > 0 && (
          <div style={{ padding: '0 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Next from {currentAlbumInfo?.album || 'playlist'}
            </div>
            {upcomingPlaylist.slice(0, 20).map((track, idx) => (
              <div key={`pl-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
                <AlbumArt src={track.coverArt || currentCoverArt} size={40} radius={4} artist={track.artist || currentAlbumInfo?.artist} album={track.album || currentAlbumInfo?.album} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!currentTrack && queue.length === 0 && (
          <div style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, padding: '40px 16px' }}>
            Nothing in the queue yet
          </div>
        )}
      </div>
    </div>
  );
}
