import React, { useRef, useEffect, useState } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

// Derive a clean display name for each device
function getDeviceLabel(device) {
  // Sonos: use roomName (e.g. "Quarentown", "Living Room")
  if (device.roomName) return device.roomName;
  // WiiM / generic: friendlyName is usually clean
  return device.friendlyName || 'Unknown Device';
}

// Derive a subtitle (model info) for each device
function getDeviceSubtitle(device) {
  if (device.deviceType === 'sonos' && device.displayName) {
    return `Sonos ${device.displayName}`;
  }
  if (device.deviceType === 'wiim') {
    return device.modelName || 'WiiM';
  }
  if (device.manufacturer) {
    return device.modelName ? `${device.manufacturer} ${device.modelName}` : device.manufacturer;
  }
  return null;
}

// Pick icon based on device type
function DeviceIcon({ deviceType, size = 20, color }) {
  if (deviceType === 'sonos') return Icon.speaker(size, color);
  if (deviceType === 'wiim') return Icon.soundbar(size, color);
  return Icon.speaker(size, color);
}

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
  const [hoveredUsn, setHoveredUsn] = useState(null);

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
        title={isCasting ? `Casting to ${getDeviceLabel(activeDeviceInfo || {})}` : 'Cast to a device'}
        style={{
          background: showDevicePicker ? COLORS.hover : 'transparent',
          border: 'none', cursor: 'pointer', padding: '8px 10px',
          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s',
        }}
      >
        {isCasting ? Icon.castConnected(20, iconColor) : Icon.cast(20, iconColor)}
      </button>

      {showDevicePicker && (
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: 8,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: 10, minWidth: 260, maxWidth: 320,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 200, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px 8px', fontSize: 11, color: COLORS.textSecondary,
            fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Cast to device
          </div>

          {/* This Device option */}
          <button
            onClick={() => { if (activeDevice) selectDevice(null); }}
            onMouseEnter={() => setHoveredUsn('__local__')}
            onMouseLeave={() => setHoveredUsn(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', textAlign: 'left',
              background: !activeDevice
                ? `rgba(${COLORS.accentRgb}, 0.15)`
                : hoveredUsn === '__local__' ? COLORS.hover : 'transparent',
              border: 'none', cursor: activeDevice ? 'pointer' : 'default',
              padding: '10px 16px', fontSize: 14,
              color: !activeDevice ? COLORS.accent : COLORS.textSecondary,
              fontWeight: !activeDevice ? 600 : 400,
              transition: 'background 0.15s',
            }}
          >
            {Icon.laptop(20, !activeDevice ? COLORS.accent : COLORS.textSecondary)}
            <span>This Device</span>
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />

          {/* Device list */}
          {devices.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 13, color: COLORS.textSecondary }}>
              Searching for speakers...
            </div>
          )}

          {devices.map(device => {
            const isActive = device.usn === activeDevice;
            const isHovered = hoveredUsn === device.usn;
            const label = getDeviceLabel(device);
            const subtitle = getDeviceSubtitle(device);
            const itemColor = isActive ? COLORS.accent : COLORS.textPrimary;

            return (
              <button
                key={device.usn}
                onClick={() => { if (!isActive) selectDevice(device.usn); }}
                onMouseEnter={() => setHoveredUsn(device.usn)}
                onMouseLeave={() => setHoveredUsn(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', textAlign: 'left',
                  background: isActive
                    ? `rgba(${COLORS.accentRgb}, 0.15)`
                    : isHovered ? COLORS.hover : 'transparent',
                  border: 'none', cursor: isActive ? 'default' : 'pointer',
                  padding: '10px 16px',
                  transition: 'background 0.15s',
                }}
              >
                <DeviceIcon
                  deviceType={device.deviceType}
                  size={20}
                  color={isActive ? COLORS.accent : COLORS.textSecondary}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 14, fontWeight: isActive ? 600 : 400,
                    color: itemColor,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {label}
                    {isActive && isCasting && (
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: COLORS.accent, flexShrink: 0,
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                  {subtitle && (
                    <div style={{
                      fontSize: 11, color: COLORS.textSecondary,
                      marginTop: 1, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {subtitle}
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          {/* Bottom padding */}
          <div style={{ height: 4 }} />
        </div>
      )}
    </div>
  );
}
