import React, { useRef, useEffect } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

export function CastButton({
  devices,
  activeDevice,
  isCasting,
  showDevicePicker,
  setShowDevicePicker,
  selectDevice,
  castStop,
}) {
  const ref = useRef(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showDevicePicker) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShowDevicePicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDevicePicker, setShowDevicePicker]);

  const activeDeviceInfo = devices.find(d => d.usn === activeDevice);
  const iconColor = isCasting ? COLORS.accent : COLORS.textSecondary;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setShowDevicePicker(v => !v)}
        title={isCasting ? `Casting to ${activeDeviceInfo?.friendlyName || 'device'}` : 'Cast to a device'}
        style={{
          background: showDevicePicker ? COLORS.hover : 'transparent',
          border: 'none', cursor: 'pointer', padding: '6px 8px',
          borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isCasting ? Icon.castConnected(18, iconColor) : Icon.cast(18, iconColor)}
      </button>

      {showDevicePicker && (
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: 8,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, minWidth: 200, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          zIndex: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px 6px', fontSize: 11, color: COLORS.textSecondary, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Cast to device
          </div>

          {devices.length === 0 && (
            <div style={{ padding: '8px 14px 12px', fontSize: 13, color: COLORS.textSecondary }}>
              No devices found
            </div>
          )}

          {devices.map(device => {
            const isActive = device.usn === activeDevice;
            return (
              <button
                key={device.usn}
                onClick={() => {
                  if (isActive && isCasting) return;
                  selectDevice(device.usn);
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: isActive ? COLORS.hover : 'transparent',
                  border: 'none', cursor: 'pointer',
                  padding: '10px 14px', fontSize: 13,
                  color: isActive ? COLORS.textPrimary : COLORS.textSecondary,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {isActive && isCasting ? '▶ ' : ''}{device.friendlyName}
              </button>
            );
          })}

          {isCasting && (
            <>
              <div style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />
              <button
                onClick={() => { castStop(); setShowDevicePicker(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '10px 14px 12px', fontSize: 13, color: COLORS.textSecondary,
                }}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
