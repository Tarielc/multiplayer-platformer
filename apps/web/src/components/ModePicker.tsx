'use client';

import { GAME_MODES, MODE_CONFIG, type GameMode } from '@platformer/shared';
import styles from './ModePicker.module.css';

/**
 * The game modes as a segmented stone switch, with the picked mode's summary under it. Only the
 * host can change it (`disabled` for everyone else).
 */
export function ModePicker({
  value,
  onChange,
  disabled = false,
  title,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <fieldset className={styles.picker} disabled={disabled} title={title}>
      <div className={styles.head}>
        <legend className="px-label">Mode</legend>
        <div className={styles.options}>
          {GAME_MODES.map((mode) => (
            <label key={mode} className={styles.option} data-selected={value === mode} data-mode={mode}>
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={value === mode}
                onChange={() => onChange(mode)}
                aria-describedby="mode-summary"
              />
              {MODE_CONFIG[mode].name}
            </label>
          ))}
        </div>
      </div>
      <p className={styles.summary} id="mode-summary">
        {MODE_CONFIG[value].summary}
      </p>
    </fieldset>
  );
}
