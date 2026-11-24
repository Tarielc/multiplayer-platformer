import type { CSSProperties } from 'react';
import styles from './Fireflies.module.css';

/** Where each firefly hovers (% of the layer) and when its drift starts. */
const FLIES: readonly [left: number, top: number, delay: number][] = [
  [58, 30, 0],
  [66, 58, 1.4],
  [80, 22, 2.4],
  [88, 64, 0.7],
  [74, 44, 3.2],
  [52, 70, 2],
  [93, 36, 4],
];

/** Drifting firefly sparks over the jungle backdrop (still under reduced motion). */
export function Fireflies({ className }: { className?: string }) {
  return (
    <div className={`${styles.layer} ${className ?? ''}`} aria-hidden>
      {FLIES.map(([left, top, delay]) => (
        <span
          key={`${left}-${top}`}
          className={styles.fly}
          style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}
