import Phaser from 'phaser';
import { PICKUPS, WEAPONS, type PickupKind, type WeaponId } from '../config';
import { pickupExpiryWave } from '../systems/SpawnLogic';

/** Dropped item: health, a weapon unlock, or a temporary score multiplier. */
export class Pickup extends Phaser.Physics.Arcade.Image {
  kind: PickupKind = 'health';
  weaponId: WeaponId | null = null;
  /** Wave at which the drop fades; it stays put until the wave counter reaches it. */
  expiresOnWave = 0;
  /** Drop order, so a full floor knows which pickup is the oldest. */
  droppedAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, PICKUPS.textureFor.health);
  }

  spawn(
    x: number,
    y: number,
    kind: PickupKind,
    weaponId: WeaponId | null = null,
    wave = 0,
  ): void {
    this.kind = kind;
    this.weaponId = weaponId;
    this.enableBody(true, x, y, true, true);
    this.setTexture(PICKUPS.textureFor[kind]);
    this.clearTint();
    if (kind === 'weapon' && weaponId) {
      this.setTint(Phaser.Display.Color.HexStringToColor(WEAPONS[weaponId].color).color);
    }
    this.setDepth(12);
    this.setAlpha(1);
    this.expiresOnWave = pickupExpiryWave(wave);
    this.droppedAt = this.scene.time.now;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(this.width / 2, 0, 0);

    this.scene.tweens.killTweensOf(this);
    this.setScale(0);
    this.scene.tweens.add({
      targets: this,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!this.active) return;
        this.scene.tweens.add({
          targets: this,
          scale: 1.12,
          duration: 780,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  collect(): void {
    // The overlap keeps firing while the player stands on the pickup, so the body is disabled
    // up front. Otherwise every frame restarts this tween, it never completes, and the pickup
    // is never actually collected.
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!body?.enable) return;
    this.disableBody(false, false);

    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      scale: 1.9,
      alpha: 0,
      duration: 140,
      onComplete: () => this.disableBody(true, true),
    });
  }

  kill(): void {
    this.scene.tweens.killTweensOf(this);
    this.disableBody(true, true);
  }
}
