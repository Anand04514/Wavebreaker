import Phaser from 'phaser';
import { BUDDY, PLAYER, WEAPONS, type MapObstacle } from '../config';
import { avoidObstacles, buddyPlan, type Vec } from '../systems/SpawnLogic';
import { fireIntervalMs } from '../systems/WeaponSystem';

/**
 * What the buddy needs from the scene: somewhere to aim, a fallback post, the cover to walk around,
 * and a way to put a round on the field. It owns nothing but its own movement and trigger, so the
 * clone's shots go through the scene's ordinary player-bullet path.
 */
export interface BuddyHost {
  readonly obstacles: readonly MapObstacle[];
  readonly isRunOver: boolean;
  nearestEnemy(from: Vec): Vec | null;
  playerPoint(): Vec;
  fireBuddyPistol(x: number, y: number, angle: number): void;
}

/**
 * The Battle Buddy: a temporary clone of the player, summoned by its pickup and retired when its
 * lease runs out. It moves and shoots like the shooter enemy — hold range, fire the player's pistol
 * on the pistol's own cadence — but it is not a combatant: it has no health, enemies never target
 * it, and nothing damages it. The scene drives `tick`; `appear` and `retire` are its whole life.
 */
export class BattleBuddy extends Phaser.Physics.Arcade.Sprite {
  /** `scene.time.now` at which the pistol is next ready. */
  private readyAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly host: BuddyHost) {
    super(scene, x, y, BUDDY.texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PLAYER.radius, this.width / 2 - PLAYER.radius, this.height / 2 - PLAYER.radius);
    body.setCollideWorldBounds(true);

    // Just under the player, so an overlapping clone never hides whose shots are whose.
    this.setDepth(19);
    this.setTint(BUDDY.tint);
    this.setAlpha(BUDDY.alpha);
    this.retire();
  }

  /** Brings the clone in at a point beside the player and starts its pistol clock. */
  appear(x: number, y: number, now: number): void {
    this.enableBody(true, x, y, true, true);
    (this.body as Phaser.Physics.Arcade.Body).stop();
    this.setAlpha(BUDDY.alpha).setTint(BUDDY.tint);

    this.readyAt = now + BUDDY.firstShotDelayMs;

    this.scene.tweens.killTweensOf(this);
    this.setScale(0.45);
    this.scene.tweens.add({
      targets: this,
      scale: 1,
      duration: BUDDY.appearMs,
      ease: 'Back.easeOut',
    });
  }

  /** Ends the lease (or the run): the body goes, and the scene recycles the sprite next pickup. */
  retire(): void {
    this.scene.tweens.killTweensOf(this);
    this.setScale(1);
    this.disableBody(true, true);
  }

  /** One frame of clone: kite the nearest enemy, shoot it, otherwise tag along behind the player. */
  tick(time: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!this.active || !body) return;
    if (this.host.isRunOver) {
      body.stop();
      return;
    }

    const plan = buddyPlan(this, this.host.playerPoint(), this.host.nearestEnemy(this), BUDDY);
    this.setRotation(plan.aimAngle);

    if (plan.walkTo) {
      const steered = avoidObstacles(
        { x: this.x, y: this.y },
        plan.walkTo,
        this.host.obstacles,
        body.halfWidth,
      );
      body.setVelocity(steered.x * BUDDY.speed, steered.y * BUDDY.speed);
    } else {
      // In the band: stand and shoot rather than drift, so its rounds go where they are aimed.
      body.stop();
    }

    if (!plan.inRange || time < this.readyAt) return;
    this.readyAt = time + fireIntervalMs(WEAPONS.pistol);
    this.host.fireBuddyPistol(this.x, this.y, plan.aimAngle);
  }
}
