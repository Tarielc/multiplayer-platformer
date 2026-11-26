import { PLAYER_CONFIG } from './players';

/**
 * Random starting names ("MossyNewt42") so new players aren't all "Player" in rooms and on the
 * leaderboard. Adjective + creature + two digits: 48 × 48 × 90 ≈ 207,000 names, each at most
 * 7 + 7 + 2 = 16 characters (`PLAYER_CONFIG.nameMaxLength`). Players can rename themselves.
 */
export const NAME_ADJECTIVES = [
  'Mossy', 'Ferny', 'Leafy', 'Misty', 'Sunny', 'Rainy', 'Dewy', 'Shady',
  'Sleepy', 'Jolly', 'Brave', 'Swift', 'Clever', 'Gentle', 'Lucky', 'Bold',
  'Quiet', 'Wild', 'Tiny', 'Mighty', 'Rusty', 'Golden', 'Silver', 'Amber',
  'Copper', 'Jade', 'Ruby', 'Velvet', 'Frosty', 'Stormy', 'Breezy', 'Cozy',
  'Fuzzy', 'Nimble', 'Plucky', 'Zesty', 'Witty', 'Merry', 'Hasty', 'Dapper',
  'Spry', 'Snowy', 'Ashen', 'Glowy', 'Rooty', 'Thorny', 'Bouncy', 'Peppy',
] as const;

export const NAME_CREATURES = [
  'Newt', 'Frog', 'Toad', 'Wren', 'Finch', 'Robin', 'Moth', 'Beetle',
  'Snail', 'Otter', 'Badger', 'Fox', 'Hare', 'Mole', 'Vole', 'Shrew',
  'Stoat', 'Lynx', 'Owl', 'Heron', 'Crane', 'Raven', 'Sparrow', 'Gecko',
  'Lizard', 'Turtle', 'Puffin', 'Bunny', 'Magpie', 'Kestrel', 'Bat', 'Bee',
  'Wasp', 'Cricket', 'Firefly', 'Mantis', 'Spider', 'Ant', 'Slug', 'Fawn',
  'Elk', 'Boar', 'Bear', 'Wolf', 'Mink', 'Ferret', 'Pika', 'Quokka',
] as const;

/** Uniform integer in [0, n) from a [0, 1) source. */
const pick = (n: number, random: () => number) => Math.min(n - 1, Math.floor(random() * n));

/** A random name like "MossyNewt42". `random` returns [0, 1) (defaults to Math.random). */
export function randomPlayerName(random: () => number = Math.random): string {
  const adjective = NAME_ADJECTIVES[pick(NAME_ADJECTIVES.length, random)]!;
  const creature = NAME_CREATURES[pick(NAME_CREATURES.length, random)]!;
  const digits = 10 + pick(90, random);
  return `${adjective}${creature}${digits}`.slice(0, PLAYER_CONFIG.nameMaxLength);
}
