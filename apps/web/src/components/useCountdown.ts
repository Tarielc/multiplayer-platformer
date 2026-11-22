'use client';

import { useEffect, useState } from 'react';

/** Milliseconds left of a server timer that had `remainingMs` left at `receivedAt` (performance.now()). */
export function useCountdown(remainingMs: number, receivedAt: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, receivedAt + remainingMs - now);
}
