import type { ClientMessage, ServerMessage } from './messages';

/**
 * Wire encoding seam. JSON keeps the template debuggable (readable in DevTools); swap in a
 * binary codec (MessagePack, custom bit-packing with quantization) here without touching
 * game code. `decode` never throws: invalid input yields `undefined`.
 */
export interface MessageCodec {
  encode(message: ClientMessage | ServerMessage): string;
  decode(raw: string): unknown;
}

export const jsonCodec: MessageCodec = {
  encode: (message) => JSON.stringify(message),
  decode: (raw) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  },
};
