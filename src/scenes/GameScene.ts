import Phaser from 'phaser';
import {
  ARENA,
  BLAST,
  BOMB,
  BOMBER,
  BUDDY,
  BULLET,
  CAMERA,
  COMBAT,
  CLONER,
  COACH,
  DASH,
  FONT_MONO,
  OBSTACLES,
  PICKUPS,
  PLAYER,
  POOLS,
  SHOCK,
  SPAWN,
  TELEPORTER,
  UPGRADES,
  WAVE_CONFIG,
  WEAPONS,
  WEAPON_SWITCH,
  type CoachTip,
  type EnemyKind,
  type GameMap,
  type MapObstacle,
  type PickupKind,
  type WeaponId,
} from '../config';
import { BattleBuddy } from '../entities/BattleBuddy';
import { Bomb } from '../entities/Bomb';
import { Bullet, type BulletEffect } from '../entities/Bullet';
import { Bomber, ENEMY_CLASSES, type Enemy, type EnemyHost, type EnemyTarget } from '../entities/Enemy';
import { Pickup } from '../entities/Pickup';
import { Player } from '../entities/Player';
import { audio } from '../systems/AudioManager';
import { activateBuff, buffedValue, buffRemainingMs, isBuffActive } from '../systems/Buffs';
import { getMap } from '../systems/MapLogic';
import {
  blastDamageAt,
  bombDamageAgainst,
  clipMuzzleToCover,
  clonePoints,
  coachTipDue,
  computeScore,
  dashVector,
  distance,
  nudgeClearPoint,
  pickCloneKind,
  rollPickupKind,
  segmentObstacleHit,
  shouldDropPickup,
  spawnPointAroundView,
  weaponUpgradeDue,
} from '../systems/SpawnLogic';
import {
  loadCoachTipSeen,
  loadHighScore,
  loadMapId,
  saveCoachTipSeen,
  saveHighScore,
} from '../systems/Storage';
import { WaveManager, type WaveEvent } from '../systems/WaveManager';
import { advanceBombCharges, advanceCharges, WeaponSystem } from '../systems/WeaponSystem';

/** Snapshot the HUD polls each frame. Keeping it a plain object avoids event churn. */
export interface HudState {
  health: number;
  maxHealth: number;
  score: number;
  wave: number;
  kills: number;
  multiplierMs: number;
  multiplier: number;
  /** Milliseconds left on the damage overdrive, 0 when inactive. */
  damageMs: number;
  /** Milliseconds left on the invulnerability shield, 0 when inactive. */
  shieldMs: number;
  /** Milliseconds left on the battle buddy's lease, 0 when no clone is on the field. */
  buddyMs: number;
  weaponId: WeaponId;
  weapons: WeaponId[];
  breakMs: number;
  bossRatio: number;
  bossLabel: string | null;
  /** Badge for the boss's current attack; null when there is no boss or it shows no phases. */
  bossPhase: { text: string; color: string } | null;
  /** Sidearm charges in hand, out of bombMaxCharges. */
  bombCharges: number;
  bombMaxCharges: number;
  /** Milliseconds until the next charge; 0 when the rack is full. */
  bombChargeMs: number;
  /** Dash charges in hand, out of dashMaxCharges. */
  dashCharges: number;
  dashMaxCharges: number;
  /** Milliseconds until the next dash charge; 0 when the rack is full. */
  dashChargeMs: number;
  /** Milliseconds left with the weapon locked out by a shocker jolt, 0 when it can fire. */
  disarmMs: number;
}

export type BannerTone = 'wave' | 'boss' | 'info' | 'danger';

export interface BannerMessage {
  text: string;
  sub?: string;
  tone: BannerTone;
}

export interface RunSummary {
  score: number;
  wave: number;
  kills: number;
  best: number;
  newBest: boolean;
}

export class GameScene extends Phaser.Scene implements EnemyHost {
  private player!: Player;
  /** The battle buddy: one clone, reused between pickups rather than pooled. */
  private buddy!: BattleBuddy;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.Group;
  private bombs!: Phaser.GameObjects.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private hitSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private deathBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private healSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private fuseTelegraph!: Phaser.GameObjects.Graphics;

  private waves = new WaveManager();
  private weapons = new WeaponSystem();
  private enemyPool: Enemy[] = [];
  private damageNumbers: Phaser.GameObjects.Text[] = [];
  private banners: BannerMessage[] = [];
  private arenaBounds = new Phaser.Geom.Rectangle(0, 0, ARENA.width, ARENA.height);
  private readonly target: EnemyTarget = { x: ARENA.width / 2, y: ARENA.height / 2, active: true };

  private score = 0;
  private kills = 0;
  /** Waves cleared since the last weapon unlock; drives the guaranteed upgrade drop. */
  private wavesSinceWeaponUpgrade = 0;
  private multiplierUntil = 0;
  private damageBuffUntil = 0;
  private shieldUntil = 0;
  private shieldTintOn = false;
  private runOver = false;
  private lastWeaponScrollAt = 0;
  private bombCharges: number = BOMB.startingCharges;
  private bombChargeElapsed = 0;
  private dashCharges: number = DASH.startingCharges;
  private dashChargeElapsed = 0;
  private lastDashTrailAt = 0;
  /** `time.now` until which a shocker jolt keeps the trigger dead. */
  private disarmUntil = 0;
  /** `time.now` at which the battle buddy's lease runs out; 0 when no clone is out. */
  private buddyUntil = 0;
  /** True while the pointer is over a HUD control, so a click there never doubles as a shot. */
  private pointerOverHud = false;
  /**
   * Scratch objects reused every frame. None of them is retained by a caller: each is overwritten on
   * the next frame, which is what keeps a steady frame from allocating at all.
   */
  private readonly moveInput = { x: 0, y: 0 };
  private readonly pointerWorld = new Phaser.Math.Vector2();
  private readonly buddyPlayerPoint = { x: 0, y: 0 };
  private readonly buddyTargetPoint = { x: 0, y: 0 };
  private readonly sweepFrom = { x: 0, y: 0 };
  private readonly sweepTo = { x: 0, y: 0 };
  private hudSnapshot?: HudState;
  /** First-run tips still to show this run, in order; each is remembered once shown or used. */
  private coachPending: CoachTip[] = [];
  private coachShownThisRun = 0;
  private runStartedAt = 0;
  /** Bodies for the layout's solid blocks; empty on the open floor. */
  private obstacleBodies: Phaser.Physics.Arcade.StaticGroup | null = null;
  private currentMap: GameMap = getMap('');

  constructor() {
    super('GameScene');
  }

  /* ------------------------------------------------------------ lifecycle */

  create(): void {
    // Scene instances are reused across restarts, so every field is reset here.
    this.waves = new WaveManager();
    this.weapons = new WeaponSystem();
    this.enemyPool = [];
    this.damageNumbers = [];
    this.banners = [];
    this.score = 0;
    this.kills = 0;
    this.wavesSinceWeaponUpgrade = 0;
    this.multiplierUntil = 0;
    this.damageBuffUntil = 0;
    this.shieldUntil = 0;
    this.shieldTintOn = false;
    this.runOver = false;
    this.lastWeaponScrollAt = 0;
    this.bombCharges = BOMB.startingCharges;
    this.bombChargeElapsed = 0;
    this.dashCharges = DASH.startingCharges;
    this.dashChargeElapsed = 0;
    this.lastDashTrailAt = 0;
    this.disarmUntil = 0;
    this.buddyUntil = 0;
    this.pointerOverHud = false;
    this.coachPending = (['bomb', 'dash'] as CoachTip[]).filter((tip) => !loadCoachTipSeen(tip));
    this.coachShownThisRun = 0;
    this.runStartedAt = this.time.now;
    this.obstacleBodies = null;
    this.currentMap = getMap(loadMapId());

    this.createArena();
    this.createObstacles();
    this.createPools();
    this.createEffects();
    this.createPlayer();
    this.createInput();
    this.createCollisions();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    this.scene.launch('HudScene');
    audio.playMusic('game');
    this.waves.start(WAVE_CONFIG.runStartDelayMs);
    this.cameras.main.fadeIn(260, 0, 0, 0);
  }

  update(time: number, delta: number): void {
    if (this.runOver) return;

    this.readMovement(this.moveInput);
    this.player.move(this.moveInput);

    // `positionToCamera` hands back the same vector it was given, which keeps the frame allocation-free.
    const pointer = this.input.activePointer.positionToCamera(
      this.cameras.main,
      this.pointerWorld,
    ) as Phaser.Math.Vector2;
    const aim = this.player.aimAt(pointer.x, pointer.y);

    // The HUD's own switches eat the click, so hovering one never fires the gun.
    if (this.input.activePointer.leftButtonDown() && !this.pointerOverHud) this.tryShoot(time, aim);

    this.target.x = this.player.x;
    this.target.y = this.player.y;

    this.updateBullets(time);
    this.updateBombs(time, delta);
    this.updateEnemies(time, delta);
    this.updateBuddy(time);
    this.updatePickups();
    this.updateBuffs();

    this.updateBombCharges(delta);
    this.updateDashCharges(delta);
    this.updateDashTrail(time);
    this.updateCoachTips(time);

    for (const event of this.waves.update(delta, this.activeEnemyCount())) {
      this.handleWaveEvent(event);
    }
  }

  /* --------------------------------------------------------------- public */

  get playerTarget(): EnemyTarget {
    return this.target;
  }

  isPlayerAlive(): boolean {
    return !this.runOver && this.player.isAlive;
  }

  /** The HUD tells the run when the pointer sits on one of its clickable controls. */
  setPointerOverHud(over: boolean): void {
    this.pointerOverHud = over;
  }

  fireEnemyBullet(
    x: number,
    y: number,
    angle: number,
    damage: number,
    speed: number,
    effect: BulletEffect = 'none',
    lifetimeMs?: number,
  ): void {
    const bullet = this.enemyBullets.get(x, y) as Bullet | null;
    if (!bullet) return;
    bullet.fire(x, y, angle, speed, damage, true, lifetimeMs, effect);
  }

  /** Healer pulse: tops up every wounded enemy in range, capped at its own maximum health. */
  healEnemiesNear(x: number, y: number, radius: number, amount: number): number {
    let healed = 0;
    for (const enemy of this.enemyPool) {
      if (!enemy.active || enemy.health >= enemy.maxHealth) continue;
      if (distance({ x, y }, { x: enemy.x, y: enemy.y }) > radius) continue;
      if (enemy.heal(amount) <= 0) continue;
      healed += 1;
      this.healSparks.explode(6, enemy.x, enemy.y);
    }
    if (healed > 0) this.spawnHealPulse(x, y, radius);
    return healed;
  }

  get isRunOver(): boolean {
    return this.runOver;
  }

  /**
   * The run's state for the HUD. One snapshot object is reused for every poll (the HUD reads it in
   * the same tick), so polling sixty times a second does not churn a fresh object each time.
   */
  get hudState(): HudState {
    const snapshot = (this.hudSnapshot ??= {
      health: 0,
      maxHealth: PLAYER.maxHealth,
      score: 0,
      wave: 0,
      kills: 0,
      multiplierMs: 0,
      multiplier: 1,
      damageMs: 0,
      shieldMs: 0,
      buddyMs: 0,
      weaponId: this.weapons.current,
      weapons: this.weapons.ownedWeapons,
      breakMs: 0,
      bossRatio: 0,
      bossLabel: null,
      bossPhase: null,
      bombCharges: 0,
      bombMaxCharges: BOMB.maxCharges,
      bombChargeMs: 0,
      dashCharges: 0,
      dashMaxCharges: DASH.maxCharges,
      dashChargeMs: 0,
      disarmMs: 0,
    });

    let boss: Enemy | null = null;
    for (const enemy of this.enemyPool) {
      if (enemy.active && enemy.boss) {
        boss = enemy;
        break;
      }
    }

    const now = this.time.now;
    const multiplierMs = Math.max(0, this.multiplierUntil - now);

    snapshot.health = Math.max(0, Math.round(this.player?.health ?? 0));
    snapshot.maxHealth = this.player?.maxHealth ?? PLAYER.maxHealth;
    snapshot.score = this.score;
    snapshot.wave = this.waves.wave;
    snapshot.kills = this.kills;
    snapshot.multiplierMs = multiplierMs;
    snapshot.multiplier = multiplierMs > 0 ? PICKUPS.multiplierFactor : 1;
    snapshot.damageMs = buffRemainingMs(this.damageBuffUntil, now);
    snapshot.shieldMs = buffRemainingMs(this.shieldUntil, now);
    snapshot.buddyMs = buffRemainingMs(this.buddyUntil, now);
    snapshot.weaponId = this.weapons.current;
    snapshot.weapons = this.weapons.ownedWeapons;
    snapshot.breakMs = this.waves.breakRemainingMs;
    snapshot.bossRatio = boss ? Phaser.Math.Clamp(boss.health / boss.maxHealth, 0, 1) : 0;
    snapshot.bossLabel = boss ? `OVERSHARD · WAVE ${this.waves.wave}` : null;
    snapshot.bossPhase = boss?.phaseBadge ?? null;
    snapshot.bombCharges = this.bombCharges;
    snapshot.bombChargeMs =
      this.bombCharges >= BOMB.maxCharges ? 0 : Math.max(0, BOMB.chargeMs - this.bombChargeElapsed);
    snapshot.dashCharges = this.dashCharges;
    snapshot.dashChargeMs =
      this.dashCharges >= DASH.maxCharges ? 0 : Math.max(0, DASH.chargeMs - this.dashChargeElapsed);
    snapshot.disarmMs = buffRemainingMs(this.disarmUntil, now);
    return snapshot;
  }

  /** Banners are queued so the HUD can pick them up without event timing races. */
  takeBanner(): BannerMessage | null {
    return this.banners.shift() ?? null;
  }

  /* ----------------------------------------------------------------- setup */

  private createArena(): void {
    const { width, height } = ARENA;

    this.add.tileSprite(0, 0, width, height, 'floor').setOrigin(0).setDepth(0);

    const glow = this.add.graphics().setDepth(1);
    for (let i = 5; i >= 1; i -= 1) {
      glow.fillStyle(0x1b4d63, 0.035);
      glow.fillCircle(width / 2, height / 2, i * 130);
    }

    const walls = this.add.graphics().setDepth(2);
    walls.lineStyle(ARENA.wallThickness, 0x22384a, 1);
    walls.strokeRect(0, 0, width, height);
    walls.lineStyle(2, 0x3d6c8c, 0.75);
    walls.strokeRect(ARENA.wallThickness / 2, ARENA.wallThickness / 2, width - ARENA.wallThickness, height - ARENA.wallThickness);

    const inset = ARENA.wallThickness;
    this.arenaBounds = new Phaser.Geom.Rectangle(inset, inset, width - inset * 2, height - inset * 2);
    this.physics.world.setBounds(inset, inset, width - inset * 2, height - inset * 2);
  }

  /**
   * The chosen layout's interior blocks: drawn as lit slabs and given static Arcade bodies, so the
   * player, enemies and bullets all treat them as cover.
   */
  private createObstacles(): void {
    const group = this.physics.add.staticGroup();
    this.obstacleBodies = group;

    const glow = this.add.graphics().setDepth(2);
    for (const block of this.currentMap.obstacles) {
      glow.fillStyle(OBSTACLES.glow, OBSTACLES.glowAlpha);
      glow.fillRect(block.x - 5, block.y - 5, block.width + 10, block.height + 10);

      const slab = this.add
        .rectangle(block.x + block.width / 2, block.y + block.height / 2, block.width, block.height, OBSTACLES.fill)
        .setStrokeStyle(2, OBSTACLES.edge, 1)
        .setDepth(3);
      group.add(slab);
    }

    group.refresh();
  }

  /** Blocks of the current layout, for spawn, drop and teleport checks. */
  get obstacles(): readonly MapObstacle[] {
    return this.currentMap.obstacles;
  }

  private createPools(): void {
    this.playerBullets = this.physics.add.group({
      classType: Bullet,
      maxSize: BULLET.maxActive,
      runChildUpdate: false,
    });
    this.enemyBullets = this.physics.add.group({
      classType: Bullet,
      maxSize: POOLS.enemyBullets,
      runChildUpdate: false,
    });
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.pickups = this.physics.add.group({
      classType: Pickup,
      maxSize: POOLS.pickups,
      runChildUpdate: false,
    });
    this.bombs = this.add.group({ classType: Bomb, maxSize: BOMB.poolSize, runChildUpdate: false });
  }

  private createEffects(): void {
    this.hitSparks = this.add
      .particles(0, 0, 'particle', {
        speed: { min: 70, max: 210 },
        lifespan: 220,
        scale: { start: 0.9, end: 0 },
        quantity: 0,
        emitting: false,
        tint: 0xffe066,
        blendMode: 'ADD',
      })
      .setDepth(30);

    this.deathBurst = this.add
      .particles(0, 0, 'particle', {
        speed: { min: 40, max: 260 },
        lifespan: 420,
        scale: { start: 1.1, end: 0 },
        quantity: 0,
        emitting: false,
        tint: [0xff8a5c, 0xff5e6b, 0xffd6a0],
        blendMode: 'ADD',
      })
      .setDepth(29);

    this.healSparks = this.add
      .particles(0, 0, 'particle', {
        speed: { min: 30, max: 110 },
        lifespan: 300,
        scale: { start: 0.7, end: 0 },
        quantity: 0,
        emitting: false,
        tint: 0x4ade80,
        blendMode: 'ADD',
      })
      .setDepth(28);

    // Drawn beneath the enemies so the ring never hides the bomber itself.
    this.fuseTelegraph = this.add.graphics().setDepth(10);

    for (let i = 0; i < COMBAT.damageNumberPool; i += 1) {
      const text = this.add
        .text(0, 0, '', {
          fontFamily: FONT_MONO,
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#06090d',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(40)
        .setActive(false)
        .setVisible(false);
      this.damageNumbers.push(text);
    }
  }

  private createPlayer(): void {
    this.player = new Player(this, ARENA.width / 2, ARENA.height / 2);

    // The arena is larger than the viewport, so the camera scrolls with the player.
    this.cameras.main.setBounds(0, 0, ARENA.width, ARENA.height);
    this.cameras.main.startFollow(this.player, true, CAMERA.followLerp, CAMERA.followLerp);

    // The ally is a single body that is summoned and retired, so it is not pooled.
    this.buddy = new BattleBuddy(this, this.player.x, this.player.y, this);
  }

  private createInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    keyboard.on('keydown-SPACE', () => this.tryDash());
    keyboard.on('keydown-ONE', () => this.selectWeapon(0));
    keyboard.on('keydown-TWO', () => this.selectWeapon(1));
    keyboard.on('keydown-THREE', () => this.selectWeapon(2));

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _over: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => this.onWheelScroll(deltaY),
    );

    // Right click throws the sidearm; without this the browser menu pops up on the canvas.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.throwBomb();
    });
  }

  /** End-of-run cleanup: a dash mid-burst must not survive into the next run. */
  private stopDash(): void {
    this.player.cancelDash();
  }

  /** Mouse wheel cycles the unlocked weapons: down for the next slot, up for the previous. */
  private onWheelScroll(deltaY: number): void {
    if (this.runOver || deltaY === 0) return;

    const now = this.time.now;
    if (now - this.lastWeaponScrollAt < WEAPON_SWITCH.scrollCooldownMs) return;
    this.lastWeaponScrollAt = now;

    if (!this.weapons.cycle(deltaY > 0 ? 1 : -1)) return;
    audio.play('click');
    this.pushBanner({ text: this.weapons.spec.name.toUpperCase(), tone: 'info' });
  }

  private createCollisions(): void {
    this.physics.add.overlap(this.playerBullets, this.enemies, this.onBulletHitsEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.onEnemyBulletHitsPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.onEnemyTouchesPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.pickups, this.onPickupCollected, undefined, this);

    const blocks = this.obstacleBodies;
    if (!blocks) return;
    // Cover: bodies stop at the walls, bullets stop dead against them.
    this.physics.add.collider(this.player, blocks);
    this.physics.add.collider(this.buddy, blocks);
    this.physics.add.collider(this.enemies, blocks);
    this.physics.add.collider(this.playerBullets, blocks, this.onBulletHitsObstacle, undefined, this);
    this.physics.add.collider(this.enemyBullets, blocks, this.onBulletHitsObstacle, undefined, this);
  }

  private readonly onBulletHitsObstacle = (bulletObj: unknown): void => {
    const bullet = bulletObj as Bullet;
    if (!(bullet instanceof Bullet) || !bullet.active) return;
    this.hitSparks.explode(6, bullet.x, bullet.y);
    bullet.kill();
  };

  private handleShutdown(): void {
    if (this.scene.isActive('HudScene')) this.scene.stop('HudScene');
    this.enemyPool = [];
    this.damageNumbers = [];
    this.banners = [];
  }

  /* -------------------------------------------------------------- movement */

  /** Fills `out` rather than returning a fresh vector: this runs sixty times a second. */
  private readMovement(out: { x: number; y: number }): void {
    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    out.x = (right ? 1 : 0) - (left ? 1 : 0);
    out.y = (down ? 1 : 0) - (up ? 1 : 0);
  }

  private selectWeapon(index: number): void {
    if (this.runOver) return;
    if (!this.weapons.select(index)) return;
    audio.play('click');
    this.pushBanner({ text: this.weapons.spec.name.toUpperCase(), tone: 'info' });
  }

  /* --------------------------------------------------------------- shooting */

  /** True while a shocker jolt is still scrambling the weapon. */
  get isDisarmed(): boolean {
    return this.time.now < this.disarmUntil;
  }

  private tryShoot(time: number, aim: number): void {
    // A jolt locks the trigger, not the movement: you can still run, dash and throw bombs.
    if (this.isDisarmed) return;

    const shots = this.weapons.fire(time, aim);
    if (shots.length === 0) return;

    // Hugging a wall puts the drawn muzzle inside the block, so start the shot on the wall face.
    const muzzle = clipMuzzleToCover(
      { x: this.player.x, y: this.player.y },
      aim,
      PLAYER.muzzleOffset,
      this.obstacles,
      BULLET.radius,
    );
    const muzzleX = muzzle.x;
    const muzzleY = muzzle.y;
    const weapon = this.weapons.current;
    const boosted = this.isDamageBuffed;

    for (const shot of shots) {
      const bullet = this.playerBullets.get(muzzleX, muzzleY) as Bullet | null;
      if (!bullet) break;
      const damage = buffedValue(shot.damage * this.weapons.damageScale, PICKUPS.damageFactor, boosted);
      bullet.fire(muzzleX, muzzleY, shot.angle, shot.speed, damage, false);
    }

    this.spawnMuzzleFlash(muzzleX, muzzleY, aim, weapon);
    audio.play(weapon === 'shotgun' ? 'shotgun' : 'shoot');
  }

  private spawnMuzzleFlash(x: number, y: number, angle: number, weapon: WeaponId): void {
    const flash = this.add
      .image(x, y, 'bullet')
      .setRotation(angle)
      .setDepth(21)
      .setScale(weapon === 'shotgun' ? 1.6 : 1)
      .setTint(0xfff3b0)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.tweens.add({
      targets: flash,
      scale: 0,
      alpha: 0,
      duration: 90,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private updateBullets(now: number): void {
    for (const child of this.playerBullets.getChildren()) {
      const bullet = child as Bullet;
      if (bullet.active) this.sweepAgainstCover(bullet, now);
    }
    for (const child of this.enemyBullets.getChildren()) {
      const bullet = child as Bullet;
      if (bullet.active) this.sweepAgainstCover(bullet, now);
    }
  }

  /**
   * Kills a bullet at the point where its travel since the last frame crossed a block. The Arcade
   * collider only tests where the bullet *is*, so a fast shot (or a slow frame) can step clean over
   * a thin wall between two physics steps; this tests the whole path instead.
   */
  private sweepAgainstCover(bullet: Bullet, now: number): void {
    if (bullet.isSpent(now, this.arenaBounds)) {
      bullet.kill();
      return;
    }

    // Scratch vectors: this runs for every live bullet, every frame.
    const from = this.sweepFrom;
    const to = this.sweepTo;
    from.x = bullet.lastX;
    from.y = bullet.lastY;
    to.x = bullet.x;
    to.y = bullet.y;
    let entry = 1;
    let blocked = false;

    for (const block of this.obstacles) {
      const hit = segmentObstacleHit(from, to, BULLET.radius, block);
      if (hit !== null && hit < entry) {
        entry = hit;
        blocked = true;
      }
    }

    if (blocked) {
      const x = from.x + (to.x - from.x) * entry;
      const y = from.y + (to.y - from.y) * entry;
      this.hitSparks.explode(6, x, y);
      bullet.kill();
      return;
    }

    bullet.lastX = bullet.x;
    bullet.lastY = bullet.y;
  }

  /* ---------------------------------------------------------------- enemies */

  /**
   * Live enemies the wave is waiting on. Copies are ignored on purpose: they are on a ten second
   * clock, so counting them would hold a wave open until the last one faded.
   */
  private activeEnemyCount(): number {
    let count = 0;
    for (const enemy of this.enemyPool) if (enemy.active && !enemy.clone) count += 1;
    return count;
  }

  /** Every live enemy, copies included. The frame-budget cap uses this one. */
  private liveEnemyCount(): number {
    let count = 0;
    for (const enemy of this.enemyPool) if (enemy.active) count += 1;
    return count;
  }

  private spawnEnemy(kind: EnemyKind, boss: boolean): void {
    const view = this.cameras.main.worldView;
    const spawn = spawnPointAroundView(
      { x: this.player.x, y: this.player.y },
      { x: view.x, y: view.y, width: view.width, height: view.height },
      Math.random,
      { arena: { width: ARENA.width, height: ARENA.height } },
    );
    // A layout with cover can put an edge point inside a slab; push it clear before spawning.
    const point = nudgeClearPoint(spawn, OBSTACLES.bodyRadius, this.obstacles);

    this.takeEnemy(kind, point.x, point.y, boss);
    this.spawnTelegraph(point.x, point.y);
  }

  /** Pulls a pooled enemy of this kind into the world at a point, and pops it in. */
  private takeEnemy(kind: EnemyKind, x: number, y: number, boss = false): Enemy {
    let enemy = this.enemyPool.find((candidate) => candidate.kind === kind && !candidate.active);
    if (!enemy) {
      const EnemyClass = ENEMY_CLASSES[kind];
      enemy = new EnemyClass(this, x, y, this);
      this.enemies.add(enemy);
      this.enemyPool.push(enemy);
    }

    enemy.spawn(x, y, this.waves.wave, boss);
    enemy.setScale(boss ? 1.6 : 0.5);
    this.tweens.add({
      targets: enemy,
      scale: 1,
      duration: boss ? 420 : 190,
      ease: 'Back.easeOut',
    });
    return enemy;
  }

  /**
   * Cloner pulse: copy one of the real enemies on the field and drop three duplicates into the space
   * around the cloner. A copy is an ordinary enemy — a copied bomber still fuses, a copied healer
   * still heals — but it pays a share of the real score, carries a pale tint and fades when its
   * lifetime runs out. Copies are never a source: no copying itself, another cloner, the boss, or an
   * existing copy, so a squad can never compound.
   */
  spawnCloneSquad(x: number, y: number, count: number): void {
    const kind = pickCloneKind(this.enemyPool);
    if (!kind) return;

    const points = clonePoints({ x, y }, count, CLONER.cloneRadius, Math.random, this.obstacles);
    for (const point of points) {
      // Copies respect the same frame-budget ceiling as normal spawns.
      if (this.liveEnemyCount() >= SPAWN.maxEnemiesAlive) return;
      const enemy = this.takeEnemy(kind, point.x, point.y);
      enemy.markAsClone(this.time.now + CLONER.cloneLifetimeMs);
      this.spawnTelegraph(point.x, point.y);
    }
  }

  /** Short warp flash drawn at both ends of a teleport. */
  spawnWarp(x: number, y: number, tint: number): void {
    const ring = this.add
      .image(x, y, 'ring')
      .setDepth(16)
      .setScale(TELEPORTER.warpStartScale)
      .setAlpha(TELEPORTER.warpAlpha)
      .setTint(tint);
    this.tweens.add({
      targets: ring,
      scale: TELEPORTER.warpEndScale,
      alpha: 0,
      duration: TELEPORTER.warpMs,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private spawnTelegraph(x: number, y: number): void {
    const ring = this.add.image(x, y, 'ring').setDepth(9).setScale(0.2).setAlpha(0.7);
    this.tweens.add({
      targets: ring,
      scale: 1.3,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private updateEnemies(time: number, delta: number): void {
    for (const enemy of this.enemyPool) {
      if (!enemy.active) continue;
      // A copy is on a clock: when it runs out it simply goes, paying nothing and dropping nothing.
      if (enemy.expiresAt > 0 && time >= enemy.expiresAt) {
        this.expireClone(enemy);
        continue;
      }
      enemy.tick(time, delta);
      // Bombers carry their fuse in the entity but the blast runs through the scene, so it
      // respects shields, i-frames and the death transition like every other damage source.
      if (enemy.active && enemy instanceof Bomber && enemy.consumeDetonation()) {
        this.detonateBomber(enemy);
      }
    }

    this.updateFuseTelegraph(time);
  }

  /** Retires a copy whose lease is up: a small puff, then the slot goes back to the pool. */
  private expireClone(enemy: Enemy): void {
    this.hitSparks.explode(6, enemy.x, enemy.y);
    enemy.deactivate();
  }

  /**
   * Warning ring for every bomber whose fuse is lit. It grows from a fraction of the blast radius to
   * the real radius as the fuse burns and pulses with the fuse blink, so the danger zone — and how
   * much time is left — is readable at a glance instead of being guessed.
   */
  private updateFuseTelegraph(time: number): void {
    const graphics = this.fuseTelegraph;
    graphics.clear();

    for (const enemy of this.enemyPool) {
      if (!enemy.active || !(enemy instanceof Bomber) || !enemy.isFusing) continue;

      const progress = enemy.fuseProgressAt(time);
      const radius = Phaser.Math.Linear(
        BOMBER.blastRadius * BOMBER.telegraphStartScale,
        BOMBER.blastRadius,
        progress,
      );
      const pulse = 0.65 + 0.35 * Math.abs(Math.sin(time / BOMBER.blinkIntervalMs));

      graphics.fillStyle(BOMBER.telegraphTint, BOMBER.telegraphFillAlpha * pulse);
      graphics.fillCircle(enemy.x, enemy.y, radius);
      graphics.lineStyle(BOMBER.telegraphWidth, BOMBER.telegraphTint, BOMBER.telegraphAlpha * pulse);
      graphics.strokeCircle(enemy.x, enemy.y, radius);
    }
  }

  private detonateBomber(bomber: Bomber): void {
    const { x, y } = bomber;
    const damage = blastDamageAt(
      distance({ x, y }, { x: this.player.x, y: this.player.y }),
      BOMBER.blastRadius,
      BOMBER.blastDamage,
    );

    this.spawnBlast(x, y, BOMBER.blastRadius);

    // A bomber that reaches you still counts as a kill, but it drops nothing.
    this.score += computeScore(bomber.scoreValue, this.multiplier);
    this.kills += 1;
    bomber.deactivate();

    if (damage > 0) this.damagePlayer(damage);
  }

  /**
   * One detonation look for every blast on the field, so a thrown bomb and a bomber going off read
   * as the same kind of event: a scorch mark on the floor, a soft glow, a warm shockwave, a faster
   * white-hot core, sparks, shake, a screen flash and the heavy blast sound. Only the radius differs.
   */
  private spawnBlast(x: number, y: number, radius: number): void {
    const scorch = this.add
      .circle(x, y, radius * BLAST.scorchScale, BLAST.scorchTint, BLAST.scorchAlpha)
      .setDepth(3);
    this.tweens.add({
      targets: scorch,
      alpha: 0,
      duration: BLAST.scorchMs,
      ease: 'Quad.easeIn',
      onComplete: () => scorch.destroy(),
    });

    // A soft filled flash so the blast has body behind the thin outline rings.
    const glow = this.add
      .circle(x, y, radius * BLAST.glowScale, BLAST.glowTint, BLAST.glowAlpha)
      .setDepth(17)
      .setScale(0.25)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: glow,
      scale: 1,
      alpha: 0,
      duration: BLAST.glowMs,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy(),
    });

    const shockwave = this.add.image(x, y, 'ring').setDepth(18).setTint(BLAST.shockTint).setScale(0.2).setAlpha(0.95);
    this.tweens.add({
      targets: shockwave,
      scale: (radius * 2) / shockwave.width,
      alpha: 0,
      duration: BLAST.shockwaveMs,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy(),
    });

    const core = this.add.image(x, y, 'ring').setDepth(19).setTint(BLAST.coreTint).setScale(0.2).setAlpha(1);
    this.tweens.add({
      targets: core,
      scale: (radius * 2 * BLAST.coreScale) / core.width,
      alpha: 0,
      duration: BLAST.coreMs,
      ease: 'Expo.easeOut',
      onComplete: () => core.destroy(),
    });

    this.deathBurst.explode(BLAST.particles, x, y);
    this.hitSparks.explode(BLAST.sparks, x, y);
    this.cameras.main.shake(CAMERA.shakeBlast.duration, CAMERA.shakeBlast.intensity);
    this.cameras.main.flash(BLAST.flash.durationMs, BLAST.flash.red, BLAST.flash.green, BLAST.flash.blue, false);
    audio.play('blast');
  }

  private spawnHealPulse(x: number, y: number, radius: number): void {
    const ring = this.add.image(x, y, 'ring').setDepth(17).setTint(0x4ade80).setScale(0.2).setAlpha(0.6);
    this.tweens.add({
      targets: ring,
      scale: (radius * 2) / ring.width,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /* ----------------------------------------------------------------- buddy */

  /** Nearest live enemy to a point: what the battle buddy aims and kites around. */
  nearestEnemy(from: { x: number; y: number }): { x: number; y: number } | null {
    let closest: Enemy | null = null;
    let closestGap = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemyPool) {
      if (!enemy.active) continue;
      const gap = distance(from, enemy);
      if (gap < closestGap) {
        closestGap = gap;
        closest = enemy;
      }
    }
    if (!closest) return null;
    this.buddyTargetPoint.x = closest.x;
    this.buddyTargetPoint.y = closest.y;
    return this.buddyTargetPoint;
  }

  /** Where the player is: the buddy's fallback post while the field is clear. */
  playerPoint(): { x: number; y: number } {
    this.buddyPlayerPoint.x = this.player.x;
    this.buddyPlayerPoint.y = this.player.y;
    return this.buddyPlayerPoint;
  }

  /**
   * One pistol round from the battle buddy, fired from the player's own bullet pool so it damages,
   * scores and drops through the ordinary path. The numbers are the player's pistol — ordnance
   * ranks and the overdrive included — so the clone's gun keeps pace with the real one. No firing
   * sound: at four shots a second it would double every gunfight's audio.
   */
  fireBuddyPistol(x: number, y: number, angle: number): void {
    const pistol = WEAPONS.pistol;
    const muzzle = clipMuzzleToCover({ x, y }, angle, BUDDY.muzzleOffset, this.obstacles, BULLET.radius);
    const bullet = this.playerBullets.get(muzzle.x, muzzle.y) as Bullet | null;
    if (!bullet) return;

    const damage = buffedValue(
      pistol.damage * this.weapons.damageScale,
      PICKUPS.damageFactor,
      this.isDamageBuffed,
    );
    bullet.fire(muzzle.x, muzzle.y, angle, pistol.bulletSpeed, damage, false);
    this.spawnMuzzleFlash(muzzle.x, muzzle.y, angle, 'pistol');
  }

  /** Summons the clone beside the player and starts (or extends) its lease. */
  private summonBuddy(): void {
    const spot = nudgeClearPoint(
      { x: this.player.x + BUDDY.spawnOffset, y: this.player.y - BUDDY.spawnOffset },
      PLAYER.radius,
      this.obstacles,
    );
    this.buddy.appear(spot.x, spot.y, this.time.now);
    this.spawnWarp(spot.x, spot.y, BUDDY.tint);
  }

  private updateBuddy(time: number): void {
    if (!this.buddy.active) return;
    // The lease, a run ending, or the clone stepping out all end the same way.
    if (this.runOver || time >= this.buddyUntil) {
      this.retireBuddy();
      return;
    }
    this.buddy.tick(time);
  }

  /** The lease is up (or the run is): the clone puffs out and the field is the player's again. */
  private retireBuddy(): void {
    if (!this.buddy.active) return;
    this.hitSparks.explode(BUDDY.puffSparks, this.buddy.x, this.buddy.y);
    this.buddy.retire();
    this.buddyUntil = 0;
  }

  /* ------------------------------------------------------------------ bombs */

  private updateBombCharges(delta: number): void {
    const next = advanceBombCharges(
      this.bombCharges,
      this.bombChargeElapsed,
      delta,
      BOMB.chargeMs,
      BOMB.maxCharges,
    );
    this.bombCharges = next.charges;
    this.bombChargeElapsed = next.elapsedMs;
  }

  /* ------------------------------------------------------------------- dash */

  private updateDashCharges(delta: number): void {
    const next = advanceCharges(
      this.dashCharges,
      this.dashChargeElapsed,
      delta,
      DASH.chargeMs,
      DASH.maxCharges,
    );
    this.dashCharges = next.charges;
    this.dashChargeElapsed = next.elapsedMs;
  }

  /** SPACE: spend a dash charge and burst along the direction the player is pointing. */
  private tryDash(): void {
    if (this.runOver || this.dashCharges <= 0) return;
    if (this.player.isDashing) return;

    // Aim, not movement keys: the sprite's rotation is the pointer direction.
    const direction = dashVector(this.player.rotation);
    this.dashCharges -= 1;
    this.learnCoach('dash');
    this.player.startDash(direction, this.time.now);
    this.lastDashTrailAt = 0;
    this.spawnDashTrail();
    this.cameras.main.shake(CAMERA.shakeDash.duration, CAMERA.shakeDash.intensity);
    audio.play('dash');
  }

  /** Afterimages along the burst, spawned on a timer rather than every frame. */
  private updateDashTrail(time: number): void {
    if (!this.player.isDashing) return;
    if (time - this.lastDashTrailAt < DASH.trailIntervalMs) return;
    this.lastDashTrailAt = time;
    this.spawnDashTrail();
  }

  private spawnDashTrail(): void {
    const ghost = this.add
      .image(this.player.x, this.player.y, 'player')
      .setRotation(this.player.rotation)
      .setDepth(19)
      .setTint(DASH.trailTint)
      .setAlpha(DASH.trailAlpha);
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      scale: 0.8,
      duration: DASH.trailFadeMs,
      ease: 'Quad.easeOut',
      onComplete: () => ghost.destroy(),
    });
  }

  /** Right click: throw a charge at the cursor, or nothing happens when the rack is empty. */
  private throwBomb(): void {
    if (this.runOver || this.bombCharges <= 0) return;

    const bomb = this.bombs.get(this.player.x, this.player.y) as Bomb | null;
    if (!bomb) return;

    const pointer = this.input.activePointer.positionToCamera(
      this.cameras.main,
      this.pointerWorld,
    ) as Phaser.Math.Vector2;
    bomb.launch(this.player.x, this.player.y, pointer.x, pointer.y);
    this.bombCharges -= 1;
    this.learnCoach('bomb');
    audio.play('click');
  }

  private updateBombs(time: number, delta: number): void {
    for (const child of this.bombs.getChildren()) {
      const bomb = child as Bomb;
      if (!bomb.active) continue;
      if (bomb.step(time, delta)) this.explodeBomb(bomb);
    }
  }

  /** Flat damage inside the radius, through the normal damage/kill path so score and drops follow. */
  private explodeBomb(bomb: Bomb): void {
    const { x, y } = bomb;
    bomb.deactivate();
    this.spawnBlast(x, y, BOMB.radius);

    for (const enemy of this.enemyPool) {
      if (!enemy.active) continue;
      const damage = bombDamageAgainst(
        enemy.kind,
        blastDamageAt(distance({ x, y }, { x: enemy.x, y: enemy.y }), BOMB.radius, BOMB.damage),
      );
      if (damage <= 0) continue;
      const killed = enemy.takeDamage(damage);
      this.showDamageNumber(enemy.x, enemy.y, damage);
      if (killed) this.killEnemy(enemy);
    }
  }

  private killEnemy(enemy: Enemy): void {
    const wasBoss = enemy.boss;
    const wasClone = enemy.clone;
    const { x, y } = enemy;

    this.score += computeScore(enemy.scoreValue, this.multiplier);
    this.kills += 1;
    this.deathBurst.explode(wasBoss ? 40 : 12, x, y);
    audio.play(wasBoss ? 'explode' : 'hit');

    if (wasBoss) {
      this.cameras.main.shake(CAMERA.shakeBossDeath.duration, CAMERA.shakeBossDeath.intensity);
      this.pushBanner({ text: 'OVERSHARD DOWN', sub: 'THE WAVE BREAKS', tone: 'boss' });
    } else {
      this.cameras.main.shake(CAMERA.shakeHit.duration, CAMERA.shakeHit.intensity);
    }

    enemy.deactivate();
    // Bosses skip the drop roll and always leave a pickup behind. Copies never drop — otherwise a
    // cloner would be a pickup farm.
    if (!wasClone && shouldDropPickup(wasBoss)) this.dropPickup(x, y);
  }

  private dropPickup(x: number, y: number): void {
    this.dropPickupOfKind(x, y, rollPickupKind());
  }

  private dropPickupOfKind(x: number, y: number, kind: PickupKind): void {
    // A kill next to a wall must not hide its drop inside it.
    const spot = nudgeClearPoint({ x, y }, 0, this.obstacles);
    const pickup = this.pickups.get(spot.x, spot.y) as Pickup | null;
    if (!pickup) {
      // The floor is full: the oldest drop yields its slot, so a new drop is never silently lost.
      this.oldestPickup()?.kill();
    }
    const slot = pickup ?? (this.pickups.get(spot.x, spot.y) as Pickup | null);
    if (!slot) return;
    const weaponId = kind === 'weapon' ? this.weapons.nextLockedWeapon() : null;
    slot.spawn(spot.x, spot.y, kind, weaponId, this.waves.wave);
  }

  /** The drop closest to fading, for recycling a slot when the pickup pool is full. */
  private oldestPickup(): Pickup | null {
    let oldest: Pickup | null = null;
    for (const child of this.pickups.getChildren()) {
      const pickup = child as Pickup;
      if (!pickup.active) continue;
      if (
        !oldest ||
        pickup.expiresOnWave < oldest.expiresOnWave ||
        (pickup.expiresOnWave === oldest.expiresOnWave && pickup.droppedAt < oldest.droppedAt)
      ) {
        oldest = pickup;
      }
    }
    return oldest;
  }

  /**
   * Guarantee that a run cannot stall on firepower: once enough waves have gone by without a
   * weapon unlock, the next one is laid at the player's feet. The counter only resets when a
   * weapon is actually granted, so an ignored drop is offered again on the following wave.
   */
  private dropGuaranteedWeapon(): boolean {
    if (!weaponUpgradeDue(this.wavesSinceWeaponUpgrade)) return false;
    // With the arsenal full this pickup becomes an Ordnance rank, so the guarantee keeps paying out.
    this.dropPickupOfKind(this.player.x, this.player.y, 'weapon');
    return true;
  }

  /* -------------------------------------------------------------- collisions */

  private readonly onBulletHitsEnemy = (bulletObj: unknown, enemyObj: unknown): void => {
    const bullet = bulletObj as Bullet;
    const enemy = enemyObj as Enemy;
    if (!bullet.active || !enemy.active) return;

    bullet.kill();
    const killed = enemy.takeDamage(bullet.damage);
    this.hitSparks.explode(4, enemy.x, enemy.y);
    this.showDamageNumber(enemy.x, enemy.y, bullet.damage);
    audio.play('hit');
    if (killed) this.killEnemy(enemy);
  };

  // Phaser passes callback arguments in the order (object1, object2) it resolves them, so a
  // sprite-vs-group overlap always yields (player, bullet) regardless of the registration order.
  // The instanceof guards keep a wrong guess from throwing and killing the game loop.
  private readonly onEnemyBulletHitsPlayer = (_playerObj: unknown, bulletObj: unknown): void => {
    const bullet = bulletObj as Bullet;
    if (!(bullet instanceof Bullet) || !bullet.active) return;
    bullet.kill();
    if (!this.damagePlayer(bullet.damage)) return;
    // Only a jolt that actually landed counts: shields and i-frames still save the trigger.
    if (bullet.effect === 'disarm') this.applyDisarm();
  };

  /** Locks the weapon out for the configured window and says so on the HUD. */
  private applyDisarm(): void {
    this.disarmUntil = this.time.now + SHOCK.disarmMs;
    this.pushBanner({ text: 'WEAPON JAMMED', sub: 'NO FIRE', tone: 'danger' });
  }

  private readonly onEnemyTouchesPlayer = (_playerObj: unknown, enemyObj: unknown): void => {
    const enemy = enemyObj as Enemy;
    if (!enemy.active) return;
    // Bombers deal no contact damage: their whole threat is the blast.
    if (enemy.contactDamage <= 0) return;
    this.damagePlayer(enemy.contactDamage);
  };

  private readonly onPickupCollected = (_playerObj: unknown, pickupObj: unknown): void => {
    const pickup = pickupObj as Pickup;
    if (!(pickup instanceof Pickup) || !pickup.active || this.runOver) return;
    // A pickup that is mid-collect has its body disabled; never apply it twice.
    const body = pickup.body as Phaser.Physics.Arcade.Body | null;
    if (!body?.enable) return;

    switch (pickup.kind) {
      case 'health': {
        const healed = this.player.heal(PICKUPS.healthAmount);
        this.pushBanner({ text: `+${Math.round(healed)} HP`, tone: 'info' });
        break;
      }
      case 'vitality': {
        const maxHealth = this.player.gainMaxHealth(PICKUPS.vitalityAmount);
        this.pushBanner({
          text: `MAX HP +${PICKUPS.vitalityAmount}`,
          sub: `MAX HEALTH NOW ${Math.round(maxHealth)}`,
          tone: 'info',
        });
        break;
      }
      case 'weapon': {
        const weaponId = pickup.weaponId ?? this.weapons.nextLockedWeapon();
        if (weaponId) {
          this.weapons.grant(weaponId);
          this.pushBanner({ text: `${this.weapons.spec.name.toUpperCase()} UNLOCKED`, tone: 'info' });
        } else {
          // Every gun is owned: the pickup buys permanent damage for the whole arsenal and still
          // pays the old score bonus on top.
          const bonus = computeScore(UPGRADES.ordnance.scoreBonus, this.multiplier);
          this.score += bonus;
          this.weapons.addOrdnanceRank();
          this.pushBanner({
            text: `ORDNANCE +${bonus}`,
            sub: `RANK ${this.weapons.ordnanceRank} · ALL WEAPONS x${this.weapons.damageScale.toFixed(2)} DAMAGE`,
            tone: 'info',
          });
        }
        // Any weapon pickup is an upgrade, whether it unlocked a gun or a damage rank.
        this.wavesSinceWeaponUpgrade = 0;
        break;
      }
      case 'multiplier': {
        this.multiplierUntil = activateBuff(
          this.time.now,
          PICKUPS.multiplierDurationMs,
          this.multiplierUntil,
        );
        this.pushBanner({
          text: `SCORE x${PICKUPS.multiplierFactor}`,
          sub: `${(buffRemainingMs(this.multiplierUntil, this.time.now) / 1000).toFixed(1)}s ACTIVE`,
          tone: 'info',
        });
        break;
      }
      case 'damage': {
        this.damageBuffUntil = activateBuff(
          this.time.now,
          PICKUPS.damageDurationMs,
          this.damageBuffUntil,
        );
        this.pushBanner({
          text: `DAMAGE x${PICKUPS.damageFactor}`,
          sub: `${(buffRemainingMs(this.damageBuffUntil, this.time.now) / 1000).toFixed(1)}s OVERDRIVE`,
          tone: 'info',
        });
        break;
      }
      case 'shield': {
        this.shieldUntil = activateBuff(this.time.now, PICKUPS.shieldDurationMs, this.shieldUntil);
        this.pushBanner({
          text: 'INVULNERABLE',
          sub: `${(buffRemainingMs(this.shieldUntil, this.time.now) / 1000).toFixed(1)}s SHIELD`,
          tone: 'info',
        });
        break;
      }
      case 'buddy': {
        // A second drop extends the lease instead of stacking up a second clone.
        this.buddyUntil = activateBuff(this.time.now, BUDDY.durationMs, this.buddyUntil);
        this.summonBuddy();
        this.pushBanner({
          text: 'BATTLE BUDDY',
          sub: `${(buffRemainingMs(this.buddyUntil, this.time.now) / 1000).toFixed(1)}s ALLY`,
          tone: 'info',
        });
        break;
      }
      default:
        break;
    }

    audio.play('pickup');
    pickup.collect();
  };

  /** Returns true only when the hit actually applied, so callers can attach on-hit effects. */
  private damagePlayer(amount: number): boolean {
    if (this.runOver) return false;
    // The shield pickup blocks every damage source outright: no hit, no i-frames burned.
    if (this.isShielded) return false;
    if (!this.player.takeDamage(amount, this.time.now)) return false;

    audio.play('hurt');
    this.cameras.main.shake(CAMERA.shakePlayerHit.duration, CAMERA.shakePlayerHit.intensity);
    const hitFlash = CAMERA.flashPlayerHit;
    this.cameras.main.flash(hitFlash.durationMs, hitFlash.red, hitFlash.green, hitFlash.blue, false);
    this.showDamageNumber(this.player.x, this.player.y, amount, '#ff8fa3');

    if (!this.player.isAlive) this.handlePlayerDeath();
    return true;
  }

  private handlePlayerDeath(): void {
    if (this.runOver) return;
    this.runOver = true;

    this.stopDash();
    this.retireBuddy();
    this.player.stopMoving();
    this.player.setVisible(false);
    this.deathBurst.explode(48, this.player.x, this.player.y);
    this.cameras.main.shake(CAMERA.shakeDeath.duration, CAMERA.shakeDeath.intensity);
    audio.play('gameover');
    this.pushBanner({ text: 'RUN ENDED', tone: 'danger' });

    this.time.delayedCall(COMBAT.deathDelayMs, () => this.finishRun());
  }

  private finishRun(): void {
    const previousBest = loadHighScore();
    const newBest = saveHighScore(this.score);
    const summary: RunSummary = {
      score: this.score,
      wave: this.waves.wave,
      kills: this.kills,
      best: Math.max(previousBest, this.score),
      newBest,
    };

    if (this.scene.isActive('HudScene')) this.scene.stop('HudScene');
    this.scene.start('GameOverScene', summary);
  }

  /* ------------------------------------------------------------------ waves */

  private handleWaveEvent(event: WaveEvent): void {
    switch (event.type) {
      case 'waveStart':
        this.pushBanner({
          text: event.boss ? `BOSS WAVE ${event.wave}` : `WAVE ${event.wave}`,
          sub: event.boss ? 'THE OVERSHARD AWAKENS' : `${event.count} HOSTILES INBOUND`,
          tone: event.boss ? 'boss' : 'wave',
        });
        audio.play(event.boss ? 'boss' : 'wave');
        break;
      case 'spawn':
        this.spawnEnemy(event.kind, event.boss);
        break;
      case 'waveClear': {
        this.score += computeScore(event.bonus, 1);
        this.wavesSinceWeaponUpgrade += 1;
        const guaranteed = this.dropGuaranteedWeapon();
        this.pushBanner({
          text: `WAVE ${event.wave} CLEARED`,
          sub: guaranteed
            ? `+${event.bonus} BONUS · WEAPON DROP AT YOUR FEET`
            : `+${event.bonus} BONUS · BREATHE`,
          tone: 'info',
        });
        audio.play('wave');
        break;
      }
      default:
        break;
    }
  }

  /* ----------------------------------------------------------------- pickups */

  private updatePickups(): void {
    // Drops are timed in waves, not seconds: whatever is on the floor survives several rounds.
    for (const child of this.pickups.getChildren()) {
      const pickup = child as Pickup;
      if (pickup.active && this.waves.wave >= pickup.expiresOnWave) pickup.kill();
    }
  }

  /** Shield tint is toggled on the edges only, so the sprite is not touched every frame. */
  private updateBuffs(): void {
    const shielded = this.isShielded;
    if (shielded === this.shieldTintOn) return;
    this.shieldTintOn = shielded;
    if (shielded) this.player.setTint(PLAYER.shieldTint);
    else this.player.clearTint();
  }

  /* -------------------------------------------------------------------- misc */

  private get multiplier(): number {
    return isBuffActive(this.multiplierUntil, this.time.now) ? PICKUPS.multiplierFactor : 1;
  }

  private get isDamageBuffed(): boolean {
    return isBuffActive(this.damageBuffUntil, this.time.now);
  }

  private get isShielded(): boolean {
    return isBuffActive(this.shieldUntil, this.time.now);
  }

  /**
   * One-off ability tips. Each shows once, the first time its ability is in hand, then is remembered
   * in storage so a returning player is never told twice.
   */
  private updateCoachTips(time: number): void {
    const tip = coachTipDue(this.coachPending, this.coachShownThisRun, time - this.runStartedAt, COACH);
    if (!tip) return;

    this.coachPending = this.coachPending.filter((candidate) => candidate !== tip);
    this.coachShownThisRun += 1;
    saveCoachTipSeen(tip);

    if (tip === 'bomb') {
      this.pushBanner({
        text: 'BOMB IN HAND',
        sub: 'RIGHT CLICK THROWS IT AT YOUR CURSOR',
        tone: 'info',
      });
      return;
    }

    this.pushBanner({
      text: 'DASH READY',
      sub: 'SPACE BURSTS TOWARD YOUR AIM · NO DAMAGE TAKEN',
      tone: 'info',
    });
  }

  /** The player worked the ability out first: drop the tip and never show it. */
  private learnCoach(tip: CoachTip): void {
    if (!this.coachPending.includes(tip)) return;
    this.coachPending = this.coachPending.filter((candidate) => candidate !== tip);
    saveCoachTipSeen(tip);
  }

  private pushBanner(message: BannerMessage): void {
    this.banners.push(message);
    if (this.banners.length > 4) this.banners.shift();
  }

  private showDamageNumber(x: number, y: number, amount: number, color = '#ffffff'): void {
    const text = this.damageNumbers.find((candidate) => !candidate.active);
    if (!text) return;

    this.tweens.killTweensOf(text);
    text
      .setActive(true)
      .setVisible(true)
      .setPosition(x + Phaser.Math.Between(-6, 6), y - 14)
      .setAlpha(1)
      .setScale(1)
      .setColor(color)
      .setText(String(Math.round(amount * 10) / 10));

    this.tweens.add({
      targets: text,
      y: y - 48,
      alpha: 0,
      duration: COMBAT.damageNumberMs,
      ease: 'Cubic.easeOut',
      onComplete: () => text.setActive(false).setVisible(false),
    });
  }
}
