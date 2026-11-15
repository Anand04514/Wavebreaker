import Phaser from 'phaser';
import {
  BOMBER,
  BOSS,
  CLONER,
  COMBAT,
  ENEMY_SPECS,
  HEALER,
  NAV,
  RUNNER,
  SHOCK,
  SHOOTER,
  TELEPORTER,
  WAVE_CONFIG,
  type EnemyKind,
  type MapObstacle,
} from '../config';
import type { BulletEffect } from './Bullet';
import {
  applyDamage,
  applyHeal,
  avoidObstacles,
  bossHealth,
  chargePhase,
  cloneScore,
  deflectAroundCover,
  directionBlocked,
  fuseProgress,
  randomTeleportDelay,
  scaledHealth,
  shouldWarpIn,
  slipAlongCover,
  spiralAngles,
  teleportPoint,
  type Vec,
} from '../systems/SpawnLogic';

export interface EnemyTarget extends Vec {
  active: boolean;
}

/** The bits of the game scene an enemy needs, kept narrow to avoid a circular import. */
export interface EnemyHost {
  readonly playerTarget: EnemyTarget;
  isPlayerAlive(): boolean;
  fireEnemyBullet(
    x: number,
    y: number,
    angle: number,
    damage: number,
    speed: number,
    effect?: BulletEffect,
    lifetimeMs?: number,
  ): void;
  /** Heals every wounded enemy (never the player) inside the radius. Returns how many were healed. */
  healEnemiesNear(x: number, y: number, radius: number, amount: number): number;
  /** Drops up to `count` short-lived copies of one random enemy kind around a point. */
  spawnCloneSquad(x: number, y: number, count: number): void;
  /** Short warp flash, drawn at both ends of a teleport. */
  spawnWarp(x: number, y: number, tint: number): void;
  /** Solid blocks of the current layout, so a blink never lands inside cover. */
  readonly obstacles: readonly MapObstacle[];
}

export interface EnemyStats {
  health: number;
  speed: number;
  contactDamage: number;
  score: number;
  radius: number;
  texture: string;
}

export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  abstract readonly kind: EnemyKind;

  health = 1;
  maxHealth = 1;
  speed = 0;
  contactDamage = 0;
  scoreValue = 0;
  boss = false;
  /** True while this enemy is a cloner's temporary copy. Copies pay less and drop nothing. */
  clone = false;
  /** Scene-clock time at which a copy fades out; 0 for a real enemy. */
  expiresAt = 0;

  protected host: EnemyHost;
  protected nextShotAt = 0;
  protected strafeDirection = 1;
  /** Stall watchdog: how close it was at the start of the current window, and any committed slide. */
  private progressAt = 0;
  private progressX = 0;
  private progressY = 0;
  private slideUntil = 0;
  private slideSide: 1 | -1 = 1;
  private slideDirection: Vec = { x: 0, y: 0 };
  private stallCount = 0;
  /**
   * Scratch points and directions for the steering calls below. Steering runs for every enemy every
   * frame, so none of these may be a fresh object; each is consumed before the next call overwrites it.
   */
  private readonly steerFrom: Vec = { x: 0, y: 0 };
  private readonly steerTarget: Vec = { x: 0, y: 0 };
  private readonly steerDirection: Vec = { x: 0, y: 0 };
  private readonly steerResult: Vec = { x: 0, y: 0 };

  /**
   * HUD badge for the attack the enemy is running, or null when it has no phases to show. Only the
   * boss reports one, so the HUD can render the bar without knowing about enemy types.
   */
  get phaseBadge(): { text: string; color: string } | null {
    return null;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, host: EnemyHost) {
    super(scene, x, y, texture);
    this.host = host;
    scene.add.existing(this);
  }

  protected abstract stats(boss: boolean): EnemyStats;
  protected abstract behave(time: number, delta: number): void;

  /** Called when the pool reuses this enemy. */
  spawn(x: number, y: number, wave: number, boss = false): void {
    const stats = this.stats(boss);
    this.boss = boss;
    this.clone = false;
    this.expiresAt = 0;
    this.maxHealth = boss ? bossHealth(wave) : scaledHealth(stats.health, wave);
    this.health = this.maxHealth;
    this.speed = stats.speed;
    this.contactDamage = stats.contactDamage;
    this.scoreValue = stats.score;
    this.strafeDirection = Math.random() < 0.5 ? -1 : 1;
    this.progressAt = 0;
    this.progressX = 0;
    this.progressY = 0;
    this.slideUntil = 0;
    this.slideSide = 1;
    this.slideDirection = { x: 0, y: 0 };
    this.stallCount = 0;

    this.setTexture(stats.texture);
    this.enableBody(true, x, y, true, true);
    this.setDepth(boss ? 14 : 11);
    this.setAlpha(1);
    this.setScale(1);
    this.setRotation(0);
    this.clearTint();

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(stats.radius, this.width / 2 - stats.radius, this.height / 2 - stats.radius);
    body.setCollideWorldBounds(true);
    body.stop();

    this.nextShotAt = this.scene.time.now + SHOOTER.firstShotDelayMs;
  }

  tick(time: number, delta: number): void {
    if (!this.active || !this.body) return;
    if (!this.host.isPlayerAlive()) {
      this.halt();
      return;
    }
    this.behave(time, delta);
  }

  /** Returns true when this hit killed the enemy. */
  takeDamage(amount: number): boolean {
    if (!this.active) return false;
    this.health = applyDamage(this.health, amount);
    this.flash();
    return this.health <= 0;
  }

  /**
   * Turns this enemy into a copy: worth a share of the real score, tinted so it reads as temporary,
   * and retired by the scene when `expiresAt` arrives. Only the scene calls this, right after spawn.
   */
  markAsClone(expiresAt: number): void {
    this.clone = true;
    this.expiresAt = expiresAt;
    this.scoreValue = cloneScore(this.scoreValue);
    this.setTint(CLONER.cloneTint);
  }

  /** Returns the health actually restored. Never overheals; returns 0 at full health. */
  heal(amount: number): number {
    if (!this.active) return 0;
    const next = applyHeal(this.health, this.maxHealth, amount);
    const restored = next - this.health;
    this.health = next;
    return restored;
  }

  deactivate(): void {
    this.disableBody(true, true);
    this.clone = false;
    this.expiresAt = 0;
    this.clearTint();
    this.setAlpha(1);
    this.setScale(1);
    this.setRotation(0);
  }

  protected moveTowardPlayer(): void {
    const target = this.host.playerTarget;
    this.steerToward(target.x, target.y, this.speed);
  }

  /**
   * Walks toward a point, steering around cover. Enemies have no pathfinder: they probe a short way
   * ahead and follow the face of any block in the way, which is enough to walk around a pillar or
   * around the end of a wall instead of grinding into it.
   *
   * The corner rule is greedy, so a walker can still deadlock against a face — and one enemy that
   * never arrives keeps a wave alive forever, because the clear check counts it. A watchdog spots a
   * walker that has stopped closing the distance and commits it to sliding along the face instead,
   * which always makes progress.
   */
  protected steerToward(x: number, y: number, speed: number = this.speed): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;

    const length = Math.hypot(x - this.x, y - this.y);
    if (length < 1) {
      body.stop();
      return;
    }

    const from = this.steerFrom;
    from.x = this.x;
    from.y = this.y;
    this.steerTarget.x = x;
    this.steerTarget.y = y;
    const obstacles = this.host.obstacles;
    const now = this.scene.time.now;

    // Already committed: keep the stored direction rather than re-deciding every frame. Re-deciding
    // is what makes a walker hover in front of a face, because the greedy choice flips.
    if (obstacles.length > 0 && now < this.slideUntil) {
      body.setVelocity(this.slideDirection.x * speed, this.slideDirection.y * speed);
      return;
    }

    const steered = avoidObstacles(
      from,
      this.steerTarget,
      obstacles,
      body.halfWidth,
      NAV.lookAhead,
      this.steerResult,
    );
    if (obstacles.length > 0 && this.checkStall(now)) {
      // First stall: commit to the way the corner rule was already sending it. A second stall means
      // that route goes nowhere, so take a hard step along the face instead. The committed direction
      // is copied, never aliased: `steered` is this enemy's scratch buffer.
      if (this.stallCount >= 2) {
        this.slideDirection = slipAlongCover(from, steered, obstacles, body.halfWidth, this.slideSide);
      } else {
        this.slideDirection.x = steered.x;
        this.slideDirection.y = steered.y;
      }
      this.slideUntil = now + NAV.slideMs;
      body.setVelocity(this.slideDirection.x * speed, this.slideDirection.y * speed);
      return;
    }
    body.setVelocity(steered.x * speed, steered.y * speed);
  }

  /**
   * True when the enemy has barely moved this window, so it is pressed against cover it cannot get
   * around rather than following it.
   *
   * This measures the enemy's own displacement, not the distance to its target. Distance-to-target
   * looks right until the player runs: a walker sliding along the face of a block closes almost
   * nothing while it is making honest progress, the watchdog declares it stuck every window, and
   * each hard slide turns it back the other way — which is exactly the hovering-at-a-corner this is
   * meant to prevent. A truly wedged enemy does not move either, so displacement catches it too.
   */
  private checkStall(now: number): boolean {
    const moved = Math.hypot(this.x - this.progressX, this.y - this.progressY);
    if (this.progressAt === 0 || moved >= NAV.stallTravel) {
      this.progressAt = now;
      this.progressX = this.x;
      this.progressY = this.y;
      this.stallCount = 0;
      return false;
    }
    if (now - this.progressAt < NAV.stallWindowMs) return false;

    this.progressAt = now;
    this.progressX = this.x;
    this.progressY = this.y;
    this.stallCount += 1;
    if (this.stallCount >= 2) {
      // Each hard slide goes the other way, so a bad guess is corrected rather than repeated.
      this.slideSide = this.slideSide === 1 ? -1 : 1;
    }
    return true;
  }

  protected halt(): void {
    (this.body as Phaser.Physics.Arcade.Body | null)?.stop();
  }

  protected angleToPlayer(): number {
    const target = this.host.playerTarget;
    return Math.atan2(target.y - this.y, target.x - this.x);
  }

  protected distanceToPlayer(): number {
    const target = this.host.playerTarget;
    return Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
  }

  /**
   * Kiting behaviour shared by the ranged enemies: close in from outside the band, back off
   * inside it, and strafe while inside it so they are not sitting ducks.
   */
  protected keepDistance(preferredRange: number, slack: number): void {
    const target = this.host.playerTarget;
    const distance = this.distanceToPlayer();
    const angle = this.angleToPlayer();

    if (distance > preferredRange + slack) {
      this.steerToward(target.x, target.y, this.speed);
    } else if (distance < preferredRange - slack) {
      this.moveAtAngle(angle + Math.PI, this.speed);
    } else {
      // Circle the player, but never into a wall: if this side is blocked, circle the other way.
      if (this.coverAhead(angle + (Math.PI / 2) * this.strafeDirection)) {
        this.strafeDirection *= -1;
      }
      const side = angle + (Math.PI / 2) * this.strafeDirection;
      this.moveAtAngle(side, this.speed * 0.8);
    }
  }

  /** True when stepping this way would put the enemy into cover within the look-ahead. */
  protected coverAhead(angle: number): boolean {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return false;
    this.steerFrom.x = this.x;
    this.steerFrom.y = this.y;
    this.steerDirection.x = Math.cos(angle);
    this.steerDirection.y = Math.sin(angle);
    return directionBlocked(
      this.steerFrom,
      this.steerDirection,
      this.host.obstacles,
      body.halfWidth,
    );
  }

  /** Moves along a direction, deflecting around cover instead of pressing into it. */
  protected moveWhere(direction: Vec, speed: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    this.steerFrom.x = this.x;
    this.steerFrom.y = this.y;
    const steered = deflectAroundCover(
      this.steerFrom,
      direction,
      this.host.obstacles,
      body.halfWidth,
      NAV.lookAhead,
      this.steerResult,
    );
    body.setVelocity(steered.x * speed, steered.y * speed);
  }

  /** `moveWhere` for an angle, so a kiting enemy does not build a direction vector each frame. */
  protected moveAtAngle(angle: number, speed: number): void {
    this.steerDirection.x = Math.cos(angle);
    this.steerDirection.y = Math.sin(angle);
    this.moveWhere(this.steerDirection, speed);
  }

  /** Back to the resting tint: a copy keeps its wash, a real enemy keeps none. */
  protected restoreTint(): void {
    if (this.clone) this.setTint(CLONER.cloneTint);
    else this.clearTint();
  }

  private flash(): void {
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(COMBAT.hitFlashMs, () => {
      if (this.active) this.restoreTint();
    });
  }
}

export class Chaser extends Enemy {
  readonly kind = 'chaser';

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.chaser.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.chaser;
  }

  protected behave(): void {
    this.moveTowardPlayer();
  }
}

export class Runner extends Enemy {
  readonly kind = 'runner';
  private wobblePhase = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.runner.texture, host);
    this.wobblePhase = Math.random() * Math.PI * 2;
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.runner;
  }

  /**
   * Fast, but weaves so it doesn't arrive in a perfectly straight line. The weave is heading only:
   * the wobbled point goes through the shared cover steering. Driving the velocity straight from the
   * wobbled angle (as this used to) walked runners into a pillar face and left them grinding there,
   * and an enemy that never arrives stalls the wave clear.
   */
  protected behave(time: number): void {
    const target = this.host.playerTarget;
    const angle = this.angleToPlayer();
    // Commit to the corner while cover is in the way: weaving on top of a detour makes the corner
    // rule flip sides every half cycle, which is exactly the shuttle that stalls a runner.
    const wobble = this.coverAhead(angle)
      ? 0
      : Math.sin(time / RUNNER.wobbleRateMs + this.wobblePhase) * RUNNER.wobbleRadians;
    const offset = this.distanceToPlayer() * Math.sin(wobble);
    this.steerToward(
      target.x - Math.sin(angle) * offset,
      target.y + Math.cos(angle) * offset,
      this.speed,
    );
  }
}

/**
 * The tank doubles as the wave boss. A normal tank just walks at the player; the boss works through
 * a cycle of patterns — radial burst, moving spiral, telegraphed charge — so the fight asks for a
 * different answer every few seconds instead of repeating one volley.
 */
export class Tank extends Enemy {
  readonly kind = 'tank';

  private patternIndex = 0;
  private patternStartsAt = 0;
  private patternEndsAt = 0;
  private nextBurstAt = 0;
  private nextSpiralAt = 0;
  private spiralStep = 0;
  private chargeAngle = 0;
  private chargeStarted = false;
  /** True/false once the warp pass has rolled; null means it has not rolled yet. */
  private warpArmed: boolean | null = null;
  private warpAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.tank.texture, host);
  }

  protected stats(boss: boolean): EnemyStats {
    if (!boss) return ENEMY_SPECS.tank;
    const bossStats = WAVE_CONFIG.boss;
    return {
      health: bossStats.health,
      speed: bossStats.speed,
      contactDamage: bossStats.contactDamage,
      score: bossStats.score,
      radius: BOSS.radius,
      texture: BOSS.texture,
    };
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    this.patternIndex = 0;
    this.patternStartsAt = 0;
    this.patternEndsAt = 0;
    this.nextBurstAt = 0;
    this.nextSpiralAt = 0;
    this.spiralStep = 0;
    this.chargeAngle = 0;
    this.chargeStarted = false;
    this.warpArmed = null;
    this.warpAt = 0;
  }

  /** The pattern currently running, as shown on the boss health bar. */
  get phaseBadge(): { text: string; color: string } | null {
    if (!this.boss || !this.active) return null;
    return BOSS.phaseLabels[BOSS.patterns[this.patternIndex].kind];
  }

  protected behave(time: number, delta: number): void {
    if (!this.boss) {
      this.moveTowardPlayer();
      return;
    }

    this.rotation += BOSS.spinPerSecond * (delta / 1000);

    if (this.patternEndsAt <= 0) {
      this.startPattern(time, 0);
      // Hold the opening volley back so the boss cannot shoot the instant it appears.
      this.nextBurstAt = time + BOSS.firstPatternDelayMs;
    } else if (time >= this.patternEndsAt) {
      this.startPattern(time, this.patternIndex + 1);
    }

    const kind = BOSS.patterns[this.patternIndex].kind;
    if (kind === 'burst') this.runBurst(time);
    else if (kind === 'spiral') this.runSpiral(time);
    else if (kind === 'charge') this.runCharge(time);
    else this.runWarp(time);
  }

  /** Enter (or re-enter) the pattern at `index`, wrapping around the cycle. */
  private startPattern(time: number, index: number): void {
    const count = BOSS.patterns.length;
    this.patternIndex = ((index % count) + count) % count;
    const spec = BOSS.patterns[this.patternIndex];
    this.patternStartsAt = time;
    this.patternEndsAt = time + spec.durationMs;
    this.spiralStep = 0;
    this.chargeStarted = false;
    this.warpArmed = null;
    this.warpAt = 0;
    this.nextBurstAt = spec.kind === 'burst' ? time : 0;
    this.nextSpiralAt = spec.kind === 'spiral' ? time : 0;
    this.clearTint();
    this.setAlpha(1);
  }

  /** Walks in and denies space with a ring of bullets aimed off the player. */
  private runBurst(time: number): void {
    this.moveTowardPlayer();
    if (time < this.nextBurstAt) return;

    this.nextBurstAt = time + WAVE_CONFIG.boss.burstEveryMs;
    const base = this.angleToPlayer();
    for (let i = 0; i < WAVE_CONFIG.boss.burstCount; i += 1) {
      const angle = base + (Math.PI * 2 * i) / WAVE_CONFIG.boss.burstCount;
      this.host.fireEnemyBullet(
        this.x,
        this.y,
        angle,
        WAVE_CONFIG.boss.burstDamage,
        BOSS.burstBulletSpeed,
      );
    }
  }

  /** Keeps closing while sweeping a rotating pair of streams, so the safe gap keeps moving. */
  private runSpiral(time: number): void {
    const target = this.host.playerTarget;
    this.steerToward(target.x, target.y, this.speed * BOSS.spiral.speedFactor);

    // The while loop only ever catches up on a long frame, and is capped so a hitch cannot
    // dump a wall of bullets in one tick.
    let steps = 0;
    while (time >= this.nextSpiralAt && this.nextSpiralAt < this.patternEndsAt && steps < 6) {
      const offset = this.angleToPlayer() + this.spiralStep * BOSS.spiral.twistRadians;
      for (const angle of spiralAngles(BOSS.spiral.arms, offset)) {
        this.host.fireEnemyBullet(
          this.x,
          this.y,
          angle,
          BOSS.spiral.bulletDamage,
          BOSS.spiral.bulletSpeed,
        );
      }
      this.spiralStep += 1;
      this.nextSpiralAt += BOSS.spiral.stepMs;
      steps += 1;
    }
  }

  /** Plant, blink as a tell, lunge along a locked line, then stand exposed while it recovers. */
  private runCharge(time: number): void {
    const elapsed = time - this.patternStartsAt;
    const phase = chargePhase(
      elapsed,
      BOSS.charge.windupMs,
      BOSS.charge.lungeMs,
      BOSS.charge.recoverMs,
    );

    if (phase === 'windup') {
      this.halt();
      const lit = Math.floor(elapsed / BOSS.charge.blinkMs) % 2 === 0;
      if (lit) this.setTint(BOSS.charge.tint);
      else this.clearTint();
      return;
    }

    if (phase === 'lunge') {
      if (!this.chargeStarted) {
        // Lock the line as the lunge begins: the windup is the player's chance to step aside.
        this.chargeStarted = true;
        this.chargeAngle = this.angleToPlayer();
        this.clearTint();
      }
      const body = this.body as Phaser.Physics.Arcade.Body | null;
      body?.setVelocity(
        Math.cos(this.chargeAngle) * BOSS.charge.speed,
        Math.sin(this.chargeAngle) * BOSS.charge.speed,
      );
      return;
    }

    this.halt();
    this.clearTint();
  }

  /**
   * Warp: if the player has run far enough away, roll once for a blink-in. A passed roll is
   * telegraphed with the same stop-and-blink tell the teleporter uses, then the boss jumps to a
   * fresh angle beside the player and the fight resumes from close range.
   */
  private runWarp(time: number): void {
    if (this.warpArmed === null) {
      this.warpArmed = shouldWarpIn(this.distanceToPlayer());
      if (this.warpArmed) this.warpAt = time + BOSS.warp.windupMs;
    }

    if (this.warpAt > 0) {
      this.halt();
      this.setAlpha(0.3 + 0.7 * Math.abs(Math.sin(time / BOSS.warp.blinkMs)));
      if (time >= this.warpAt) this.blinkToPlayer();
      return;
    }

    this.setAlpha(1);
    this.moveTowardPlayer();
  }

  private blinkToPlayer(): void {
    const target = this.host.playerTarget;
    const from = { x: this.x, y: this.y };
    const to = teleportPoint(
      { x: target.x, y: target.y },
      Math.random,
      BOSS.warp,
      undefined,
      this.host.obstacles,
      BOSS.radius,
    );

    this.warpAt = 0;
    this.setAlpha(1);
    this.host.spawnWarp(from.x, from.y, BOSS.warp.warpTint);

    (this.body as Phaser.Physics.Arcade.Body).reset(to.x, to.y);
    this.setPosition(to.x, to.y);
    this.host.spawnWarp(to.x, to.y, BOSS.warp.warpTint);

    this.setTint(BOSS.warp.warpTint);
    this.scene.time.delayedCall(BOSS.warp.landingTintMs, () => {
      if (this.active) this.clearTint();
    });
  }
}

export class Shooter extends Enemy {
  readonly kind = 'shooter';

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.shooter.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.shooter;
  }

  /** Keeps its distance, strafes inside the range band, and fires on an interval. */
  protected behave(time: number): void {
    this.keepDistance(SHOOTER.preferredRange, SHOOTER.slack);

    const distance = this.distanceToPlayer();
    const angle = this.angleToPlayer();
    this.setRotation(angle);

    if (distance <= SHOOTER.fireRange && time >= this.nextShotAt) {
      this.nextShotAt = time + SHOOTER.fireIntervalMs;
      const jitter = (Math.random() - 0.5) * 0.1;
      this.host.fireEnemyBullet(
        this.x,
        this.y,
        angle + jitter,
        SHOOTER.bulletDamage,
        SHOOTER.bulletSpeed,
        'none',
        SHOOTER.bulletLifetimeMs,
      );
    }
  }
}

/**
 * Cloner: walks and holds range exactly like the shooter, but spends its clock making copies
 * instead of shooting. Each pulse copies one of the real enemies standing on the field three times
 * over, right around itself — left alive, it quietly doubles the wave. It never copies itself,
 * another cloner, the boss, or a copy of anything (the scene only offers real enemies as sources),
 * and everything it makes is on a ten second lease.
 */
export class Cloner extends Enemy {
  readonly kind = 'cloner';
  private nextCloneAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.cloner.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.cloner;
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    this.nextCloneAt = this.scene.time.now + CLONER.firstCloneDelayMs;
  }

  protected behave(time: number): void {
    this.keepDistance(CLONER.preferredRange, CLONER.slack);

    if (time < this.nextCloneAt) return;
    this.nextCloneAt = time + CLONER.cloneIntervalMs;
    this.host.spawnCloneSquad(this.x, this.y, CLONER.clonesPerPulse);
  }
}

/**
 * Ranged disabler: keeps the shooter's spacing but trades rate of fire for weight. A landed jolt
 * deals heavy damage and locks the player's weapon for a few seconds, so one hit costs a window of
 * your damage instead of just health.
 */
export class Shocker extends Enemy {
  readonly kind = 'shocker';

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.shocker.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.shocker;
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    // Its own opening delay: the shared one is tuned for the shooter's faster cadence.
    this.nextShotAt = this.scene.time.now + SHOCK.firstShotDelayMs;
  }

  protected behave(time: number): void {
    this.keepDistance(SHOCK.preferredRange, SHOCK.slack);

    const distance = this.distanceToPlayer();
    const angle = this.angleToPlayer();
    this.setRotation(angle);

    if (distance <= SHOCK.fireRange && time >= this.nextShotAt) {
      this.nextShotAt = time + SHOCK.fireIntervalMs;
      this.host.fireEnemyBullet(
        this.x,
        this.y,
        angle,
        SHOCK.bulletDamage,
        SHOCK.bulletSpeed,
        'disarm',
        SHOCK.bulletLifetimeMs,
      );
    }
  }
}

/** Charges the player and detonates once it gets close. Killing it early defuses it. */
export class Bomber extends Enemy {
  readonly kind = 'bomber';
  private fuseStartedAt = 0;
  private fuseEndsAt = 0;
  private detonationPending = false;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.bomber.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.bomber;
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    this.fuseStartedAt = 0;
    this.fuseEndsAt = 0;
    this.detonationPending = false;
  }

  get isFusing(): boolean {
    return this.fuseEndsAt > 0;
  }

  /** 0..1 through the lit fuse; 0 while the fuse is cold. */
  fuseProgressAt(time: number): number {
    if (this.fuseEndsAt <= 0) return 0;
    return fuseProgress(time - this.fuseStartedAt, BOMBER.fuseMs);
  }

  /**
   * The scene polls this after ticking: true exactly once, when the fuse burns out. The blast
   * itself lives in the scene so it goes through the same shield / i-frame damage rules.
   */
  consumeDetonation(): boolean {
    if (!this.detonationPending) return false;
    this.detonationPending = false;
    return true;
  }

  protected behave(time: number): void {
    const target = this.host.playerTarget;

    if (this.fuseEndsAt > 0) {
      // Keep crawling while the fuse burns and blink faster as it runs out.
      this.scene.physics.moveTo(this, target.x, target.y, this.speed * BOMBER.fuseSpeedFactor);
      this.setAlpha(0.45 + 0.55 * Math.abs(Math.sin(time / BOMBER.blinkIntervalMs)));
      if (time >= this.fuseEndsAt) {
        this.halt();
        this.detonationPending = true;
      }
      return;
    }

    this.moveTowardPlayer();
    if (this.distanceToPlayer() <= BOMBER.triggerRange) {
      this.fuseStartedAt = time;
      this.fuseEndsAt = time + BOMBER.fuseMs;
    }
  }
}

/** Stays at range like the shooter and pulses health into every enemy around it. */
export class Healer extends Enemy {
  readonly kind = 'healer';
  private nextHealAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.healer.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.healer;
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    this.nextHealAt = this.scene.time.now + HEALER.firstHealDelayMs;
  }

  protected behave(time: number): void {
    this.keepDistance(HEALER.preferredRange, HEALER.slack);

    if (time < this.nextHealAt) return;
    this.nextHealAt = time + HEALER.healIntervalMs;
    const healed = this.host.healEnemiesNear(this.x, this.y, HEALER.healRadius, HEALER.healAmount);
    if (healed > 0) this.pulseHealAura();
  }

  /** Brief tint so the pulse is readable on the healer as well as on its targets. */
  private pulseHealAura(): void {
    this.setTint(0x4ade80);
    this.scene.time.delayedCall(HEALER.healIntervalMs / 3, () => {
      if (this.active) this.restoreTint();
    });
  }
}

/**
 * Walks in slowly, but whenever the player pulls too far ahead it blinks to a fresh angle around
 * them — the answer to kiting it from the other side of the arena. Its blink check runs on a
 * random timer (never shorter than the configured minimum), so a close teleporter simply closes in.
 */
export class Teleporter extends Enemy {
  readonly kind = 'teleporter';
  private nextBlinkCheckAt = 0;
  private warpAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, host: EnemyHost) {
    super(scene, x, y, ENEMY_SPECS.teleporter.texture, host);
  }

  protected stats(): EnemyStats {
    return ENEMY_SPECS.teleporter;
  }

  spawn(x: number, y: number, wave: number, boss = false): void {
    super.spawn(x, y, wave, boss);
    this.nextBlinkCheckAt = this.scene.time.now + randomTeleportDelay();
    this.warpAt = 0;
  }

  protected behave(time: number): void {
    if (this.warpAt > 0) {
      // Charge in place, blinking faster as the jump approaches.
      this.halt();
      this.setAlpha(0.3 + 0.7 * Math.abs(Math.sin(time / TELEPORTER.blinkIntervalMs)));
      if (time >= this.warpAt) this.blink();
      return;
    }

    this.moveTowardPlayer();
    if (time < this.nextBlinkCheckAt) return;

    this.nextBlinkCheckAt = time + randomTeleportDelay();
    // Only a real gap is worth spending the blink on; up close it just walks in.
    if (this.distanceToPlayer() < TELEPORTER.farRange) return;
    this.warpAt = time + TELEPORTER.warnMs;
  }

  private blink(): void {
    const target = this.host.playerTarget;
    const from = { x: this.x, y: this.y };
    const to = teleportPoint({ x: target.x, y: target.y }, Math.random, TELEPORTER, undefined, this.host.obstacles);

    this.warpAt = 0;
    this.nextBlinkCheckAt = this.scene.time.now + randomTeleportDelay();
    this.setAlpha(1);
    this.host.spawnWarp(from.x, from.y, TELEPORTER.warpTint);

    (this.body as Phaser.Physics.Arcade.Body).reset(to.x, to.y);
    this.setPosition(to.x, to.y);
    this.host.spawnWarp(to.x, to.y, TELEPORTER.warpTint);

    this.setTint(TELEPORTER.warpTint);
    this.scene.time.delayedCall(TELEPORTER.landingTintMs, () => {
      if (this.active) this.clearTint();
    });
  }
}

export type EnemyConstructor = new (
  scene: Phaser.Scene,
  x: number,
  y: number,
  host: EnemyHost,
) => Enemy;

export const ENEMY_CLASSES: Record<EnemyKind, EnemyConstructor> = {
  chaser: Chaser,
  runner: Runner,
  tank: Tank,
  shooter: Shooter,
  bomber: Bomber,
  healer: Healer,
  teleporter: Teleporter,
  shocker: Shocker,
  cloner: Cloner,
};
