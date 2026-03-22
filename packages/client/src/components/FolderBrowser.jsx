import React, { useState, useEffect, useRef } from 'react';
import { COLORS } from '../constants';
import * as api from '@not-ify/shared';

export function FolderBrowser({ initialPath, onSelect, onCancel }) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/');
  const [inputPath, setInputPath] = useState(initialPath || '/');
  const [directories, setDirectories] = useState([]);
  const [parentPath, setParentPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const browse = async (path) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/library-config/browse?path=${encodeURIComponent(path)}`);
      setCurrentPath(data.current);
      setInputPath(data.current);
      setParentPath(data.parent);
      setDirectories(data.directories || []);
    } catch (err) {
      setError(err.body?.error || err.message || 'Cannot read directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse(initialPath || '/');
  }, []);

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      browse(inputPath);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 10px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, color: COLORS.textPrimary,
    userSelect: 'none',
  };

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: `1px solid ${COLORS.border}`, background: COLORS.hover,
    color: COLORS.textPrimary, fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, overflow: 'hidden', marginTop: 12,
    }}>
      {/* Path input */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.border}` }}>
        <input
          ref={inputRef}
          type="text"
          value={inputPath}
          onChange={e => setInputPath(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Enter path and press Enter"
          style={inputStyle}
          spellCheck={false}
        />
      </div>

      {/* Directory listing */}
      <div style={{
        minHeight: 140, maxHeight: 220, overflowY: 'auto',
        padding: '6px 6px',
      }}>
        {loading && (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: COLORS.textSecondary, fontSize: 12 }}>
            Loading…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: '12px 10px', color: COLORS.error, fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            {parentPath && (
              <div
                style={rowStyle}
                onClick={() => browse(parentPath)}
                onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 15 }}>📁</span>
                <span style={{ color: COLORS.textSecondary }}>..</span>
              </div>
            )}
            {directories.length === 0 && !parentPath && (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: COLORS.textSecondary, fontSize: 12 }}>
                No subdirectories
              </div>
            )}
            {directories.map(dir => (
              <div
                key={dir.path}
                style={rowStyle}
                onClick={() => browse(dir.path)}
                onMouseEnter={e => e.currentTarget.style.background = COLORS.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 15 }}>📁</span>
                <span>{dir.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Current path display + buttons */}
      <div style={{
        padding: '10px 12px', borderTop: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{ fontSize: 11, color: COLORS.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentPath}
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px', borderRadius: 5, border: `1px solid ${COLORS.border}`,
              background: COLORS.hover, color: COLORS.textPrimary, fontSize: 12, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 5, border: 'none',
              background: loading ? COLORS.hover : COLORS.accent,
              color: loading ? COLORS.textSecondary : '#fff',
              fontSize: 12, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
