import React, { useState, useEffect } from 'react';
import * as api from '@not-ify/shared';
import { COLORS } from '../constants';

const USER_KEY = 'notify-user';

export function UserPicker({ onUserSelected }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAvailableUsers()
      .then(setUsers)
      .catch(() => setUsers([
        { id: 'nathan', displayName: 'Nathan' },
        { id: 'sarah', displayName: 'Sarah' },
      ]))
      .finally(() => setLoading(false));
  }, []);

  function selectUser(user) {
    localStorage.setItem(USER_KEY, user.id);
    api.setUser(user.id);
    // Pass full user object (id, displayName, role) to parent before reloading.
    // Note: the page reload means onUserSelected is primarily for future use
    // (e.g. if reload is removed). The role is resolved server-side on reload.
    onUserSelected(user);
    // Reload so all hooks re-initialize with the correct user context
    window.location.reload();
  }

  if (loading) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: COLORS.bg, color: COLORS.textPrimary,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ marginBottom: 8, fontSize: 32, fontWeight: 700 }}>Not-ify</div>
      <div style={{ marginBottom: 40, fontSize: 15, color: COLORS.textSecondary }}>Who's listening?</div>
      <div style={{ display: 'flex', gap: 32 }}>
        {users.map(user => (
          <button
            key={user.id}
            onClick={() => selectUser(user)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              background: 'none', border: '2px solid transparent', borderRadius: 12,
              padding: 24, cursor: 'pointer', transition: 'all 0.2s',
              color: COLORS.textPrimary,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = COLORS.accent;
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.background = 'none';
            }}
          >
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: user.id === 'nathan' ? '#1DB954' : '#E91E63',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, fontWeight: 700, color: '#fff',
            }}>
              {user.displayName.charAt(0)}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{user.displayName}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Helper to get current user from localStorage
export function getCurrentUser() {
  return localStorage.getItem(USER_KEY);
}

// Helper to clear user (for switching)
export function clearCurrentUser() {
  localStorage.removeItem(USER_KEY);
}
