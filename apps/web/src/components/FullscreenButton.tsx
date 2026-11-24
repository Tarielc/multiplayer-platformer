'use client';

import { useFullscreen } from '@/hooks/useFullscreen';

/** Four pixel corners: pointing out to enter, in to leave. */
export function FullscreenIcon({ exit = false, size = 16 }: { exit?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 8 8" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      <path
        fill="currentColor"
        d={
          exit
            ? 'M2 0h1v3h-3v-1h2zM5 0h1v2h2v1h-3zM0 5h3v3h-1v-2h-2zM5 5h3v1h-2v2h-1z'
            : 'M0 0h3v1h-2v2h-1zM5 0h3v3h-1v-2h-2zM0 5h1v2h2v1h-3zM7 5h1v3h-3v-1h2z'
        }
      />
    </svg>
  );
}

/** Icon button that toggles full screen; renders nothing where the browser can't (iPhone). */
export function FullscreenButton({ className }: { className?: string }) {
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label={active ? 'Exit full screen' : 'Full screen'}
      title={active ? 'Exit full screen' : 'Full screen'}
      onClick={toggle}
    >
      <FullscreenIcon exit={active} />
    </button>
  );
}
