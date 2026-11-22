/**
 * Minimal strongly-typed event emitter used across layers
 * (net client -> React stores, React <-> Phaser bridge, server internals).
 *
 * Events with a `void` payload are emitted without an argument:
 *   emitter.emit('booted')            // Events['booted'] = void
 *   emitter.emit('stats', { fps: 60 }) // Events['stats'] = { fps: number }
 */
export type EventMap = Record<string, unknown>;

type Handler<T> = (payload: T) => void;
type EmitArgs<T> = [T] extends [void] ? [] : [payload: T];

export class TypedEmitter<Events extends EventMap> {
  /** Type-level only (never assigned): lets generic helpers infer the event map, even from subclasses. */
  declare readonly eventTypes?: Events;
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribes and returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as Handler<never>);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof Events>(event: K, ...args: EmitArgs<Events[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy so handlers may unsubscribe while we iterate.
    for (const handler of [...set]) {
      (handler as Handler<Events[K]>)(args[0] as Events[K]);
    }
  }

  listenerCount(event?: keyof Events): number {
    if (event !== undefined) return this.handlers.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}
