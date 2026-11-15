import Phaser from 'phaser';
import { DASH, PLAYER } from '../config';
import { applyMaxHealthGain, normalizeMovement, type Vec } from '../systems/SpawnLogic';

export class Player extends Phaser.Physics.Arcade.Sprite {
  health: number = PLAYER.maxHealth;
  /** Grows permanently with vitality drops; reset() puts it back to the base value. */
  maxHealth: number = PLAYER.maxHealth;
  private invulnerableUntil = 0;
  private blinkTween: Phaser.Tweens.Tween | null = null;
  private dashUntil = 0;
  private dashVx = 0;
  private dashVy = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PLAYER.radius, this.width / 2 - PLAYER.radius, this.height / 2 - PLAYER.radius);
    body.setCollideWorldBounds(true);
    // The dash is faster than a walk, so the body cap has to allow for it.
    body.setMaxSpeed(Math.max(PLAYER.speed, DASH.speed) + 1);
    this.setDepth(20);
  }

  get isAlive(): boolean {
    return this.health > 0;
  }

  get isInvulnerable(): boolean {
    if (DASH.invulnerable && this.isDashing) return true;
    return this.scene.time.now < this.invulnerableUntil;
  }

  get isDashing(): boolean {
    return this.scene.time.now < this.dashUntil;
  }

  /** Starts the burst. Charges are the scene's business; this only moves and protects the body. */
  startDash(direction: Vec, now: number): void {
    this.dashUntil = now + DASH.durationMs;
    this.dashVx = direction.x * DASH.speed;
    this.dashVy = direction.y * DASH.speed;
    this.setVelocity(this.dashVx, this.dashVy);
  }

  /** Ends the burst early (a run ending, a restart) without waiting for the clock. */
  cancelDash(): void {
    this.dashUntil = 0;
    this.dashVx = 0;
    this.dashVy = 0;
  }

  get healthRatio(): number {
    return Phaser.Math.Clamp(this.health / this.maxHealth, 0, 1);
  }

  /**
   * Input is normalised so diagonals aren't faster, then applied as velocity. While the dash burst
   * lasts the stored dash velocity wins, so releasing the keys cannot shorten it.
   */
  move(input: Vec): void {
    if (this.isDashing) {
      this.setVelocity(this.dashVx, this.dashVy);
      return;
    }
    const direction = normalizeMovement(input.x, input.y);
    this.setVelocity(direction.x * PLAYER.speed, direction.y * PLAYER.speed);
  }

  stopMoving(): void {
    this.setVelocity(0, 0);
  }

  aimAt(worldX: number, worldY: number): number {
    const angle = Math.atan2(worldY - this.y, worldX - this.x);
    this.setRotation(angle);
    return angle;
  }

  /** Returns true when the hit actually landed (not while invulnerable). */
  takeDamage(amount: number, now: number): boolean {
    if (!this.isAlive || this.isInvulnerable) return false;

    this.health = Math.max(0, this.health - amount);
    this.invulnerableUntil = now + PLAYER.invulnerabilityMs;
    this.startBlink();
    return true;
  }

  heal(amount: number): number {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  /** Permanent upgrade: raises the cap only, without healing. Returns the new max. */
  gainMaxHealth(amount: number): number {
    const next = applyMaxHealthGain(this.health, this.maxHealth, amount);
    this.health = next.health;
    this.maxHealth = next.maxHealth;
    return this.maxHealth;
  }

  reset(x: number, y: number): void {
    this.maxHealth = PLAYER.maxHealth;
    this.health = this.maxHealth;
    this.invulnerableUntil = 0;
    this.cancelDash();
    this.blinkTween?.remove();
    this.blinkTween = null;
    this.clearTint();
    this.setAlpha(1).setVisible(true).setPosition(x, y).setRotation(0);
    this.enableBody(true, x, y, true, true);
    this.body?.stop();
  }

  private startBlink(): void {
    this.blinkTween?.remove();
    this.setAlpha(1);
    this.blinkTween = this.scene.tweens.add({
      targets: this,
      alpha: 0.3,
      duration: PLAYER.invulnerabilityMs / 8,
      yoyo: true,
      repeat: 3,
      onComplete: () => this.setAlpha(1),
    });
  }
}
