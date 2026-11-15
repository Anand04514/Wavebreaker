import Phaser from 'phaser';
import { BOMB } from '../config';

type BombPhase = 'idle' | 'flying' | 'fusing';

/**
 * Thrown sidearm. It flies to the aimed point (clamped to the throw range), blinks through a short
 * fuse, then reports that its fuse burned out; the scene resolves the blast so the damage runs
 * through the normal kill/score path.
 */
export class Bomb extends Phaser.GameObjects.Image {
  private phase: BombPhase = 'idle';
  private directionX = 0;
  private directionY = 0;
  private remaining = 0;
  private fuseAt = 0;
  private nextBlinkAt = 0;
  private blinkOn = false;

  // Created through the scene's pool (`Group.get`), which puts it on the display list.
  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, BOMB.texture);
    this.setDepth(19).setActive(false).setVisible(false);
  }

  get isFlying(): boolean {
    return this.phase === 'flying';
  }

  /** Throw from (fromX, fromY) toward the aim point, never landing further than maxRange. */
  launch(fromX: number, fromY: number, targetX: number, targetY: number): void {
    const dx = targetX - fromX;
    const dy = targetY - fromY;
    const aimLength = Math.hypot(dx, dy);
    const directionX = aimLength > 0 ? dx / aimLength : 1;
    const directionY = aimLength > 0 ? dy / aimLength : 0;

    this.directionX = directionX;
    this.directionY = directionY;
    this.remaining = Phaser.Math.Clamp(aimLength, BOMB.minRange, BOMB.maxRange);
    this.phase = 'flying';
    this.blinkOn = false;
    this.setPosition(fromX + directionX * BOMB.muzzleOffset, fromY + directionY * BOMB.muzzleOffset);
    this.clearTint();
    this.setActive(true).setVisible(true).setAlpha(1);
  }

  /** Advance one frame. Returns true on the frame the fuse burns out. */
  step(now: number, deltaMs: number): boolean {
    if (this.phase === 'flying') {
      const travelled = Math.min((BOMB.travelSpeed * deltaMs) / 1000, this.remaining);
      this.remaining -= travelled;
      this.x += this.directionX * travelled;
      this.y += this.directionY * travelled;
      if (this.remaining > 0.5) return false;

      this.phase = 'fusing';
      this.fuseAt = now + BOMB.fuseMs;
      this.nextBlinkAt = now;
      return false;
    }

    if (this.phase !== 'fusing') return false;
    if (now >= this.fuseAt) return true;

    if (now >= this.nextBlinkAt) {
      this.nextBlinkAt = now + BOMB.blinkIntervalMs;
      this.blinkOn = !this.blinkOn;
      if (this.blinkOn) this.setTint(BOMB.fuseTint);
      else this.clearTint();
    }
    return false;
  }

  deactivate(): void {
    this.phase = 'idle';
    this.clearTint();
    this.setActive(false).setVisible(false);
  }
}
