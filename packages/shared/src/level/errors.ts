/** A map that can't be loaded, with a message that says how to fix it. */
export class LevelFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelFormatError';
  }
}
