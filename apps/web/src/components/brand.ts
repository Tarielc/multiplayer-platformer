import { ABILITY_NAMES, CHARACTER_ABILITY, type CharacterId } from '@platformer/shared';

/** Working title: the logo, page titles and footer all read it from here. */
export const GAME_TITLE = 'Overgrown';

/** Pixel-art jungle shrine behind the home page, lobby and menus. */
export const BACKDROP_URL = '/ui/shrine.png';

/** One line per special ability, for the character cards. */
export const ABILITY_BLURBS: Readonly<Record<CharacterId, string>> = {
  'bunny-man': 'Throws out his arms, pulls the nearest teammate in and hugs them back to health.',
  'virtual-guy': 'Sits down and flies a claw drone that picks up players and boxes. Attack calls it back.',
  'mask-dude': 'Grows huge for a while: bonus hearts, longer reach and bigger knockback.',
  'ninja-frog': 'Aims its tongue, swallows a player or a box, then spits it out as a projectile.',
};

export function abilityName(id: CharacterId): string {
  return ABILITY_NAMES[CHARACTER_ABILITY[id]];
}
