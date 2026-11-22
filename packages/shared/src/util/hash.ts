/** Incremental 32-bit FNV-1a hash. Deterministic across JS engines; used for level checksums. */
export class Fnv1a {
  private hash = 0x811c9dc5;

  byte(value: number): this {
    this.hash ^= value & 0xff;
    this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
    return this;
  }

  bytes(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.byte(values[i] ?? 0);
    return this;
  }

  int(value: number): this {
    const v = value | 0;
    return this.byte(v).byte(v >>> 8).byte(v >>> 16).byte(v >>> 24);
  }

  /** Hashes a number through its canonical string form (stable for floats). */
  num(value: number): this {
    return this.str(String(value));
  }

  str(value: string): this {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      this.byte(code).byte(code >>> 8);
    }
    return this.byte(0);
  }

  digest(): string {
    return this.hash.toString(16).padStart(8, '0');
  }
}
