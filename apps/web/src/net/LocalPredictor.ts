import {
  NET_CONFIG,
  bodyFromNetState,
  lerp,
  stepPlayerBody,
  type MovementBody,
  type MovementContext,
  type NetConfig,
  type NetPlayerState,
  type Vec2,
} from '@platformer/shared';

interface PendingInput {
  seq: number;
  buttons: number;
}

/**
 * Client-side prediction + reconciliation for the local player.
 *
 * Every local fixed step applies the input immediately (`step`) and keeps it until the server
 * acknowledges it. When an authoritative state arrives (`reconcile`), un-acked inputs are
 * replayed on top of it with the exact same `stepPlayerBody` the server runs (movement and
 * attack timers), so with no
 * packet loss or stalls the replayed state equals the prediction. Any residual error is hidden
 * by a visual offset that decays exponentially (or snapped when large / on teleports).
 */
export class LocalPredictor {
  private body: MovementBody | null = null;
  private prevX = 0;
  private prevY = 0;
  private pending: PendingInput[] = [];
  private tp = -1;
  private offsetX = 0;
  private offsetY = 0;
  /** Size of the last correction in px (debug stats). */
  lastCorrection = 0;
  /** Server state the last reconcile started from (debug "ghost"). */
  lastServer: NetPlayerState | null = null;

  constructor(
    private readonly ctx: MovementContext,
    private readonly config: Readonly<NetConfig['client']> = NET_CONFIG.client,
  ) {}

  get ready(): boolean {
    return this.body !== null;
  }

  get current(): Readonly<MovementBody> | null {
    return this.body;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Server teleport counter of the current state (respawns). */
  get teleports(): number {
    return this.tp;
  }

  reset(): void {
    this.body = null;
    this.pending = [];
    this.tp = -1;
    this.offsetX = this.offsetY = 0;
    this.lastServer = null;
  }

  /** After a reconnect the server forgot our queue; old inputs will never be acked. */
  clearPending(): void {
    this.pending = [];
  }

  step(seq: number, buttons: number): void {
    const body = this.body;
    if (!body) return;
    this.prevX = body.x;
    this.prevY = body.y;
    stepPlayerBody(body, buttons, this.ctx);
    this.pending.push({ seq, buttons });
    const overflow = this.pending.length - this.config.maxPendingInputs;
    if (overflow > 0) this.pending.splice(0, overflow);
  }

  reconcile(server: NetPlayerState): void {
    this.lastServer = server;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.seq <= server.ack) drop++;
    if (drop > 0) this.pending.splice(0, drop);

    const replayed = bodyFromNetState(server);
    for (const input of this.pending) stepPlayerBody(replayed, input.buttons, this.ctx);

    const body = this.body;
    if (!body || server.tp !== this.tp || replayed.alive !== body.alive) {
      // First state, respawn/teleport, or death: snap.
      this.tp = server.tp;
      this.body = replayed;
      this.prevX = replayed.x;
      this.prevY = replayed.y;
      this.offsetX = this.offsetY = 0;
      this.lastCorrection = 0;
      return;
    }

    const dx = body.x - replayed.x;
    const dy = body.y - replayed.y;
    this.lastCorrection = Math.hypot(dx, dy);
    // Shift the previous position too, so render interpolation stays continuous.
    this.prevX -= dx;
    this.prevY -= dy;
    if (this.lastCorrection > this.config.snapDistance) {
      this.offsetX = this.offsetY = 0;
    } else {
      this.offsetX += dx;
      this.offsetY += dy;
    }
    this.body = replayed;
  }

  /** Decays the visual correction offset; call once per rendered frame. */
  decay(frameMs: number): void {
    const k = Math.pow(0.5, frameMs / Math.max(1, this.config.correctionHalfLifeMs));
    this.offsetX *= k;
    this.offsetY *= k;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;
  }

  /** Top-left of the hitbox to draw, interpolated between fixed steps by `alpha` (0..1). */
  renderPosition(alpha: number): Vec2 | null {
    const body = this.body;
    if (!body) return null;
    return {
      x: lerp(this.prevX, body.x, alpha) + this.offsetX,
      y: lerp(this.prevY, body.y, alpha) + this.offsetY,
    };
  }
}
