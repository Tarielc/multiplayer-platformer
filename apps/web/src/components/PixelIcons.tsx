'use client';

import { useId } from 'react';

const HEART = 'M1 0h2v1h1v-1h2v1h1v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-2h1z';
const HEART_FILL = { full: '#e5484d', empty: '#3a2226', bonus: '#f2c14e' } as const;
const HEART_SHINE = { full: '#ffb3b6', empty: null, bonus: '#fff3b0' } as const;

/** A 7×6 pixel heart, `scale` px per pixel. `bonus`: a giant-form extra heart. */
export function PixelHeart({
  kind,
  scale = 4,
  className,
}: {
  kind: keyof typeof HEART_FILL;
  scale?: number;
  className?: string;
}) {
  const shine = HEART_SHINE[kind];
  return (
    <svg
      className={className}
      data-kind={kind}
      width={7 * scale}
      height={6 * scale}
      viewBox="0 0 7 6"
      shapeRendering="crispEdges"
      aria-hidden
    >
      <path fill={HEART_FILL[kind]} d={HEART} />
      {shine && <path fill={shine} d="M1 1h1v1h-1z" />}
    </svg>
  );
}

/** The trophy: team score and race wins. */
export function PixelTrophy({ scale = 4, className }: { scale?: number; className?: string }) {
  return (
    <svg className={className} width={8 * scale} height={8 * scale} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      <path fill="#f2c14e" d="M0 0h8v1h-8zM0 1h1v2h-1zM7 1h1v2h-1zM1 1h6v3h-6zM2 4h4v1h-4zM3 5h2v1h-2zM2 6h4v2h-4z" />
      <path fill="#fff3b0" d="M2 1h1v2h-1z" />
    </svg>
  );
}

/** The firefly cursor that marks the focused menu item. */
export function MenuArrow({ className, color = '#f2c14e' }: { className?: string; color?: string }) {
  return (
    <svg className={className} width="15" height="20" viewBox="0 0 6 8" shapeRendering="crispEdges" aria-hidden>
      <path fill={color} d="M0 0h2v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-2z" />
    </svg>
  );
}

/** Moss draped over the top edge of a stone panel (place it absolutely at the panel's top). */
export function MossCap({ className }: { className?: string }) {
  const id = `moss${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={className} width="100%" height="16" shapeRendering="crispEdges" aria-hidden>
      <defs>
        <pattern id={id} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect x="0" y="2" width="32" height="6" fill="#6e9f33" />
          <rect x="4" y="0" width="8" height="2" fill="#a9cf4e" />
          <rect x="18" y="0" width="8" height="2" fill="#a9cf4e" />
          <rect x="0" y="2" width="14" height="2" fill="#a9cf4e" />
          <rect x="18" y="2" width="10" height="2" fill="#8dbf3f" />
          <rect x="0" y="8" width="20" height="2" fill="#3f6b2a" />
          <rect x="24" y="8" width="8" height="2" fill="#3f6b2a" />
          <rect x="2" y="10" width="4" height="2" fill="#3f6b2a" />
          <rect x="12" y="10" width="4" height="4" fill="#3f6b2a" />
          <rect x="26" y="10" width="2" height="2" fill="#3f6b2a" />
        </pattern>
      </defs>
      <rect width="100%" height="16" fill={`url(#${id})`} />
    </svg>
  );
}
