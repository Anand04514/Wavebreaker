import Phaser from 'phaser';
import { BULLET, SHOCK } from '../config';

/** Extra effect a hostile bullet carries when it lands. */
export type BulletEffect = 'none' | 'disarm';

/**
 * Pooled projectile. Both the player's bullets and enemy projectiles use this class;
 * `hostile` decides which group/collisions they belong to.
 */
export class Bullet extends Phaser.Physics.Arcade.Image {
  damage = 1;
  hostile = false;
  /** Set on shots that do more than damage, e.g. the shocker's jolt. */
  effect: BulletEffect = 'none';
  expiresAt = 0;
  /** Where the bullet was at the previous frame, so cover can be tested against the sweep. */
  lastX = 0;
  lastY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
  }

  fire(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    hostile: boolean,
    lifetimeMs: number = BULLET.lifetimeMs,
    effect: BulletEffect = 'none',
  ): void {
    this.enableBody(true, x, y, true, true);
    this.effect = effect;
    this.setTexture(hostile ? (effect === 'disarm' ? SHOCK.bulletTexture : 'enemy-bullet') : 'bullet');
    this.setRotation(angle);
    this.setDepth(hostile ? 18 : 19);
    this.setScale(1);
    this.damage = damage;
    this.hostile = hostile;
    this.expiresAt = this.scene.time.now + lifetimeMs;
    this.lastX = x;
    this.lastY = y;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(BULLET.radius, this.width / 2 - BULLET.radius, this.height / 2 - BULLET.radius);
    body.setAllowGravity(false);
    this.scene.physics.velocityFromRotation(angle, speed, body.velocity);
  }

  /** Cull when lifetime is up or the bullet has left the arena. */
  isSpent(now: number, bounds: Phaser.Geom.Rectangle): boolean {
    if (now >= this.expiresAt) return true;
    return (
      this.x < bounds.x - BULLET.cullPadding ||
      this.y < bounds.y - BULLET.cullPadding ||
      this.x > bounds.right + BULLET.cullPadding ||
      this.y > bounds.bottom + BULLET.cullPadding
    );
  }

  kill(): void {
    this.disableBody(true, true);
  }
}
