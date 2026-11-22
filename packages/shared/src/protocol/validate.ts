import { isCharacterId } from '../config/characters';
import { PLAYER_CONFIG } from '../config/players';
import { ALL_BUTTONS } from '../sim/input';
import { DEV_COMMANDS, type ClientMessage, type DevCommand } from './messages';

/** Room codes avoid look-alike characters (0/O, 1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function isRoomCode(code: string): boolean {
  return /^[A-Z0-9]{3,12}$/.test(code);
}

// Control characters, zero-width characters and bidi overrides.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export function sanitizePlayerName(
  raw: unknown,
  maxLength: number = PLAYER_CONFIG.nameMaxLength,
  fallback: string = PLAYER_CONFIG.defaultName,
): string {
  if (typeof raw !== 'string') return fallback;
  // Whitespace first (tabs/newlines are control characters too and would glue words together).
  const cleaned = raw.replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  const clipped = [...cleaned].slice(0, maxLength).join('').trim();
  return clipped || fallback;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Validates an untrusted, already-decoded client message. Returns a fresh object with only
 * known fields, or `null` if anything is off.
 */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isObj(value) || typeof value.t !== 'string') return null;
  switch (value.t) {
    case 'join': {
      if (
        !isInt(value.protocol, 0, 1_000_000) ||
        !isStr(value.roomId, 1, 32) ||
        !isStr(value.name, 0, 64) ||
        !isStr(value.clientId, 8, 64)
      ) {
        return null;
      }
      const join: ClientMessage = {
        t: 'join',
        protocol: value.protocol,
        roomId: value.roomId,
        name: value.name,
        clientId: value.clientId,
      };
      // Optional preference: an unknown id is ignored rather than rejecting the whole join
      // (a newer client may know characters this server doesn't).
      if (isCharacterId(value.characterId)) join.characterId = value.characterId;
      return join;
    }
    case 'ready':
      return isBool(value.ready) ? { t: 'ready', ready: value.ready } : null;
    case 'selectCharacter':
      return isCharacterId(value.characterId) ? { t: 'selectCharacter', characterId: value.characterId } : null;
    case 'selectLevel':
      return isStr(value.levelId, 1, 64) ? { t: 'selectLevel', levelId: value.levelId } : null;
    case 'input':
      return isInt(value.seq, 0, 2 ** 31 - 1) && isInt(value.buttons, 0, ALL_BUTTONS) && (value.buttons & ~ALL_BUTTONS) === 0
        ? { t: 'input', seq: value.seq, buttons: value.buttons }
        : null;
    case 'menu':
      return isBool(value.open) ? { t: 'menu', open: value.open } : null;
    case 'ping':
      return isInt(value.id, 0, 2 ** 31 - 1) && typeof value.at === 'number' && Number.isFinite(value.at)
        ? { t: 'ping', id: value.id, at: value.at }
        : null;
    case 'leave':
      return { t: 'leave' };
    case 'resync':
      return { t: 'resync' };
    case 'dev':
      return typeof value.cmd === 'string' && (DEV_COMMANDS as readonly string[]).includes(value.cmd)
        ? { t: 'dev', cmd: value.cmd as DevCommand }
        : null;
    default:
      return null;
  }
}
