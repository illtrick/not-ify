import React from 'react';
import { COLORS } from '../constants';

// ---------------------------------------------------------------------------
// SkeletonCard — shimmer placeholder
// ---------------------------------------------------------------------------
export function SkeletonCard() {
  return (
    <div style={{ background: COLORS.card, borderRadius: 8, overflow: 'hidden', padding: 12 }}>
      <div className="skeleton" style={{ width: '100%', paddingBottom: '100%', borderRadius: 4, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '80%', borderRadius: 4, marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 12, width: '60%', borderRadius: 4 }} />
    </div>
  );
}

export default SkeletonCard;
