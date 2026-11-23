'use client';

import { GAME_MODES, MODE_CONFIG, type GameMode } from '@platformer/shared';
import styles from './ModePicker.module.css';

/** Radio group of the game modes. Only the host can change it (`disabled` for everyone else). */
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
      <legend>Mode</legend>
      <div className={styles.options}>
        {GAME_MODES.map((mode) => {
          const config = MODE_CONFIG[mode];
          return (
            <label key={mode} className={styles.option} data-selected={value === mode} data-mode={mode}>
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={value === mode}
                onChange={() => onChange(mode)}
                aria-describedby={`mode-${mode}-summary`}
              />
              <span className={styles.name}>{config.name}</span>
              <span className={styles.summary} id={`mode-${mode}-summary`}>
                {config.summary}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
