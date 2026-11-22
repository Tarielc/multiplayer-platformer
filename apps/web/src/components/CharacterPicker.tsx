import { CHARACTER_IDS, CHARACTERS, type CharacterId } from '@platformer/shared';
import { CharacterPortrait } from './CharacterPortrait';
import styles from './CharacterPicker.module.css';

/**
 * Radio group of the playable characters, with animated portraits. Characters in `takenBy`
 * (id → who has it, e.g. "P2") are disabled and labelled.
 */
export function CharacterPicker({
  value,
  onChange,
  takenBy,
  disabled = false,
  legend = 'Character',
}: {
  value: CharacterId | null;
  onChange: (id: CharacterId) => void;
  takenBy?: ReadonlyMap<CharacterId, string>;
  disabled?: boolean;
  legend?: string;
}) {
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>{legend}</legend>
      <div className={styles.options}>
        {CHARACTER_IDS.map((id) => {
          const owner = takenBy?.get(id);
          const name = CHARACTERS[id].name;
          return (
            <label key={id} className={styles.option} data-selected={value === id} data-taken={Boolean(owner)}>
              <input
                type="radio"
                name="character"
                value={id}
                checked={value === id}
                disabled={Boolean(owner)}
                onChange={() => onChange(id)}
                aria-label={owner ? `${name} (taken by ${owner})` : name}
              />
              <CharacterPortrait characterId={id} scale={2} animated={value === id} />
              <span className={styles.name}>{name}</span>
              {owner && <span className={styles.owner}>{owner}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
