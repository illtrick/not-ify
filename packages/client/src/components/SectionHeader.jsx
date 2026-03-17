import React from 'react';
import { COLORS } from '../constants';

// ---------------------------------------------------------------------------
// SectionHeader — uppercase label for search sections
// ---------------------------------------------------------------------------
export function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 16, marginTop: 8 }}>
      {children}
    </div>
  );
}

export default SectionHeader;
