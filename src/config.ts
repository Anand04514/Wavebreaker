/**
 * Every tuning number in the game lives here (or in the data/*.json tables it reads).
 * Behaviour code should never hard-code balance values.
 */
import mapsJson from './data/maps.json';
import weaponsJson from './data/weapons.json';
import wavesJson from './data/waves.json';

/* ------------------------------------------------------------------ types */

export type WeaponId = 'pistol' | 'shotgun' | 'smg';
export type EnemyKind =
  | 'chaser'
  | 'runner'
  | 'tank'
  | 'shooter'
  | 'bomber'
  | 'healer'
  | 'teleporter'
  | 'shocker'
  | 'cloner';
export type PickupKind =
  | 'health'
  | 'weapon'
  | 'multiplier'
  | 'damage'
  | 'shield'
  | 'vitality'
  | 'buddy';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  shotsPerSecond: number;
  damage: number;
  bulletSpeed: number;
  pellets: number;
  spreadRadians: number;
  color: string;
  accent: string;
}

export interface WeaponsData {
  startingWeapon: WeaponId;
  order: WeaponId[];
  weapons: WeaponSpec[];
}

export interface EnemySpec {
  health: number;
  speed: number;
  contactDamage: number;
  score: number;
  /** Collision radius in pixels. */
  radius: number;
  texture: string;
  /**
   * Multiplier applied to thrown-bomb damage (defaults to 1). Armoured enemies trade blast
   * resistance for speed, which keeps one throw from deleting them outright.
   */
  bombDamageFactor?: number;
}

export interface BandType {
  type: EnemyKind;
  weight: number;
}

export interface Band {
  fromWave: number;
  types: BandType[];
}

export interface BossSpec {
  health: number;
  speed: number;
  contactDamage: number;
  score: number;
  healthGrowthPerWave: number;
  burstEveryMs: number;
  burstCount: number;
  burstDamage: number;
}

export type BossPatternKind = 'burst' | 'spiral' | 'charge' | 'warp';

/** One entry in the boss's repeating pattern cycle. */
export interface BossPatternSpec {
  kind: BossPatternKind;
  /** How long the boss stays in this pattern before the next one starts, in ms. */
  durationMs: number;
}

export interface WaveConfig {
  baseCount: number;
  countPerWave: number;
  healthGrowthPerWave: number;
  spawnIntervalMs: number;
  firstSpawnDelayMs: number;
  breakDurationMs: number;
  /** Breather between the scene starting and wave 1 arriving. */
  runStartDelayMs: number;
  bossEveryWaves: number;
  bands: Band[];
  boss: BossSpec;
}

export interface MapObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameMap {
  id: string;
  name: string;
  /** Solid blocks inside the arena. The outer walls and arena bounds are separate. */
  obstacles: MapObstacle[];
}

export interface MapsData {
  defaultMap: string;
  maps: GameMap[];
}

/* -------------------------------------------------------------- data */

export const WEAPONS_DATA = weaponsJson as WeaponsData;

export const WEAPONS: Record<WeaponId, WeaponSpec> = WEAPONS_DATA.weapons.reduce(
  (acc, weapon) => {
    acc[weapon.id] = weapon;
    return acc;
  },
  {} as Record<WeaponId, WeaponSpec>,
);

export const WAVE_CONFIG = wavesJson as WaveConfig;

export const MAPS = mapsJson as MapsData;

/* -------------------------------------------------------------- arena */

/** Canvas size. The arena is larger than the viewport, so the camera scrolls. */
export const VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

/**
 * Playable world size: 2x2 screens. Menus and the HUD stay VIEWPORT-sized; anything positioned
 * in world space (spawns, pickups, walls) works off ARENA.
 */
export const ARENA = {
  width: VIEWPORT.width * 2,
  height: VIEWPORT.height * 2,
  /** Distance from the arena edge to the playable inset (walls live here). */
  wallThickness: 10,
} as const;

/**
 * Interior blocks. They block the player, enemies and both kinds of bullet, so a map is cover as
 * well as decoration. Spawns, drops and teleport landings are nudged clear of them.
 */
export const OBSTACLES = {
  fill: 0x16242f,
  edge: 0x33526b,
  glow: 0x2a4b63,
  glowAlpha: 0.35,
  /** Extra space kept between a block and any spawn, drop or teleport landing. */
  clearance: 34,
  /** Body radius assumed when pushing an enemy spawn clear of a block. */
  bodyRadius: 26,
  /** Random nudges tried before a blocked point is accepted as-is. */
  nudgeAttempts: 16,
  /** How far a random nudge may move a point, in px. */
  nudgeRadius: 140,
  /** Deterministic fallback sweep for points buried deep in a big slab. */
  nudgeAngles: 12,
  nudgeRings: 8,
} as const;

/**
 * Dash: a short burst along the direction the player is aiming (the pointer, not the walk keys),
 * spent with SPACE. Three charges, one back every 15 s, and brief invulnerability, so it doubles
 * as a dodge.
 */
export const DASH = {
  maxCharges: 3,
  startingCharges: 3,
  chargeMs: 15000,
  /** Burst speed in px/s. About 3.5x the walk speed, so it reads as a blink. */
  speed: 900,
  durationMs: 170,
  invulnerable: true,
  /** Afterimages left along the dash path. */
  trailIntervalMs: 34,
  trailTint: 0x8fe6ff,
  trailAlpha: 0.4,
  trailFadeMs: 240,
} as const;

/** The one-off tips that teach the two abilities, and the ability each one belongs to. */
export type CoachTip = 'bomb' | 'dash';

/**
 * First-run coach banners: each is shown once, when its ability is first in hand, then remembered in
 * storage so a returning player is never nagged. The delays run from the start of a run and leave
 * the opening wave banner time to clear first.
 */
export const COACH = {
  /** A tip never fires earlier than this into a run. */
  firstDelayMs: 3200,
  /** Each tip after the first waits this much longer, so two never land on top of each other. */
  staggerMs: 7000,
} as const;

/**
 * How enemies walk around cover. Steering is a pure probe-then-slide rule (see
 * `SpawnLogic.avoidObstacles`), so it is cheap enough to run for every enemy every frame.
 */
export const NAV = {
  /** How far ahead of an enemy a block is noticed, in px. */
  lookAhead: 54,
  /**
   * Extra room kept when routing around a corner, on top of the body radius. Aiming straight at the
   * padded corner leaves the path exactly tangent to the block, so an enemy would crawl or stall
   * there; a few pixels of daylight keeps the detour walkable.
   */
  cornerClearance: 10,
  /** Kiting enemies try turning this far, then wider, when their chosen way is walled off. */
  deflectStepRadians: Math.PI / 4,
  /** How many turns each way before giving up and taking the original direction. */
  deflectTries: 3,
  /**
   * Stall watchdog. An enemy that has moved less than `stallTravel` px in `stallWindowMs` while it
   * was trying to walk is wedged against cover rather than walking round it. It then commits to
   * sliding along the face for `slideMs` before re-trying the direct route, and a second stall in a
   * row escalates to a hard step along the face, alternating sides. This is what keeps one stuck
   * enemy from stalling a wave clear forever.
   *
   * The measure is the enemy's own displacement, not the distance it has closed on the player. A
   * player who is running away leaves a walker sliding along a face with nothing closed at all, and
   * counting that as stuck turns it back the other way every window — the walker hovers at the
   * corner instead of rounding it. 14 px is well under the slowest walker's honest travel (a tank
   * covers 38 px in 700 ms) and well over the jitter of one pressed into a face it cannot enter.
   */
  stallTravel: 14,
  stallWindowMs: 700,
  slideMs: 900,
} as const;

export const PLAYER = {
  maxHealth: 100,
  speed: 260,
  /** Body radius; also used for spacing checks. */
  radius: 14,
  invulnerabilityMs: 950,
  /** Tint applied while the invulnerability pickup's shield is up. */
  shieldTint: 0x8ab4ff,
  /** Texture is 44x44, so the barrel tip sits 20px from the centre. */
  muzzleOffset: 20,
  pickupRadius: 26,
} as const;

export const BULLET = {
  radius: 4,
  /**
   * A shot whose muzzle would sit inside cover is pulled back to the wall face and then spawned
   * this far short of it, so the bullet never starts the frame already overlapping the block.
   */
  muzzleClearance: 2,
  lifetimeMs: 1100,
  maxActive: 240,
  /** Extra room before a bullet is culled past the arena edge. */
  cullPadding: 48,
} as const;

export const WEAPON_SWITCH = {
  /** Mouse wheel: keep one flick from spinning through the whole arsenal. */
  scrollCooldownMs: 80,
};

/**
 * Thrown sidearm. Charges regenerate over time, so its power is rationed rather than aimed by
 * accuracy: a landing zone wide enough to clear a pack of small enemies, but too light to break
 * anything armoured.
 */
export const BOMB = {
  /** One charge regenerates every this many ms, up to maxCharges. */
  chargeMs: 16000,
  maxCharges: 3,
  /** The run starts with one in hand. */
  startingCharges: 1,
  damage: 10,
  radius: 190,
  /** Throw speed in px/s; the fuse starts when the throw lands. */
  travelSpeed: 560,
  /** Furthest the throw can land, measured from the player. */
  maxRange: 420,
  minRange: 30,
  fuseMs: 620,
  blinkIntervalMs: 70,
  fuseTint: 0xff5c5c,
  texture: 'bomb',
  poolSize: 6,
  /** Spawned this far in front of the player (texture radius plus clearance). */
  muzzleOffset: 18,
} as const;

/**
 * Shared detonation feedback. Every blast on the field renders through the same recipe — a scorch
 * mark, a soft filled glow, a warm shockwave, a faster white-hot core, sparks, shake and a screen
 * flash — so a thrown bomb and a bomber going off read as the same kind of event. Each blast
 * supplies its own radius; only the timings and colours live here.
 */
export const BLAST = {
  shockwaveMs: 420,
  coreMs: 190,
  /** How far the hot core ring spreads, as a fraction of the blast radius. */
  coreScale: 0.75,
  /** Soft filled flash behind the rings; the line-only rings read too thin at this size. */
  glowMs: 260,
  glowScale: 0.9,
  glowAlpha: 0.55,
  /** Floor mark left behind, and how long it takes to fade. */
  scorchMs: 1600,
  scorchScale: 0.62,
  scorchAlpha: 0.7,
  particles: 46,
  sparks: 20,
  shockTint: 0xffb35c,
  coreTint: 0xfff6d6,
  glowTint: 0xffcf7a,
  scorchTint: 0x0a0d12,
  /** Short screen flash at the moment of detonation. */
  flash: { durationMs: 90, red: 255, green: 214, blue: 150 },
} as const;

export const ENEMY_SPECS: Record<EnemyKind, EnemySpec> = {
  chaser: { health: 2, speed: 90, contactDamage: 10, score: 10, radius: 11, texture: 'enemy-chaser' },
  runner: { health: 1, speed: 160, contactDamage: 5, score: 15, radius: 8, texture: 'enemy-runner' },
  // Armoured: a throw only chips it for 4 of its 8 HP (10 x 0.4), so the bomb stays a crowd tool
  // and the tank always has to be shot.
  tank: {
    health: 8,
    speed: 55,
    contactDamage: 20,
    score: 30,
    radius: 17,
    texture: 'enemy-tank',
    bombDamageFactor: 0.4,
  },
  shooter: { health: 3, speed: 70, contactDamage: 10, score: 25, radius: 13, texture: 'enemy-shooter' },
  // The bomber does no contact damage: everything it does happens in the blast.
  bomber: { health: 3, speed: 140, contactDamage: 0, score: 35, radius: 12, texture: 'enemy-bomber' },
  healer: { health: 5, speed: 66, contactDamage: 8, score: 45, radius: 14, texture: 'enemy-healer' },
  // It hits for 15 and will not let you kite it around the arena, so it gets enough health to
  // survive a stray shot on its way in.
  teleporter: {
    health: 4,
    speed: 80,
    contactDamage: 15,
    score: 40,
    radius: 11,
    texture: 'enemy-teleporter',
  },
  // Slow, loud and dangerous to trade with: its jolt hits harder than a shooter's bolt and takes
  // your gun away for a moment, so eating one costs a lot more than the 20 damage.
  shocker: {
    health: 6,
    speed: 62,
    contactDamage: 10,
    score: 55,
    radius: 14,
    texture: 'enemy-shocker',
  },
  // The cloner only ever arrives through the wave bands (from wave 6 on). Killing it matters: it
  // pays well, because leaving one alive turns the rest of the wave into a crowd.
  cloner: {
    health: 6,
    speed: 70,
    contactDamage: 10,
    score: 60,
    radius: 14,
    texture: 'enemy-cloner',
  },
};

export const SHOOTER = {
  /** Distance the shooter tries to keep from the player. */
  preferredRange: 300,
  /** Hysteresis band around the preferred range. */
  slack: 50,
  fireRange: 560,
  fireIntervalMs: 1700,
  firstShotDelayMs: 700,
  bulletSpeed: 330,
  bulletDamage: 8,
  /**
   * The shared 1.1 s bullet lifetime culls a bolt ~363 px out, short of the 560 px the shooter
   * opens fire at, so distant shots used to vanish mid-flight. 2 s at 330 px/s reaches ~660 px.
   */
  bulletLifetimeMs: 2000,
} as const;

/** The runner's weave: a sine offset on its heading, so it arrives off the straight line. */
export const RUNNER = {
  /** Period of the weave, in ms per radian of phase. */
  wobbleRateMs: 130,
  /** Peak heading deviation, in radians. */
  wobbleRadians: 0.4,
} as const;

/**
 * The cloner: a support enemy that keeps a wave populated by copying whatever else is on the field.
 * It walks and holds range exactly like the shooter but never fires — the squad it makes is its
 * attack. A copy is a normal enemy for the rest of its short life (a copied bomber still fuses, a
 * copied healer still heals); it is only tinted, worth less and on a timer.
 */
export const CLONER = {
  /** Same kiting band as the shooter, so it moves like one. */
  preferredRange: 340,
  slack: 60,
  /** How often it makes a squad of copies, in ms. */
  cloneIntervalMs: 5000,
  /** Its first pulse lands sooner than a full cycle: it arrives already working. */
  firstCloneDelayMs: 2400,
  /** Copies per pulse. */
  clonesPerPulse: 3,
  /** Copies appear inside this radius of the cloner, in px. */
  cloneRadius: 170,
  /** How long a copy lives, in ms. */
  cloneLifetimeMs: 10000,
  /** Pale wash that marks a copy as temporary. A tint, not a fill, so the original art reads. */
  cloneTint: 0xa9d8ff,
  /** A copy pays this share of what the real enemy pays. */
  cloneScoreFactor: 0.5,
} as const;

export const SHOCK = {
  /** Distance the shocker tries to keep from the player, wider than the shooter's. */
  preferredRange: 330,
  /** Hysteresis band around the preferred range. */
  slack: 60,
  fireRange: 600,
  /** One heavy jolt every five seconds, so a miss gives you a long window. */
  fireIntervalMs: 5000,
  firstShotDelayMs: 1200,
  bulletSpeed: 240,
  bulletDamage: 20,
  /**
   * Jolts are slow, so the shared 1.1 s bullet lifetime would cull them ~264 px out — short of
   * the range the shocker actually fires from. This one covers the whole fire range.
   */
  bulletLifetimeMs: 2800,
  /** A landed jolt locks the player's weapon out for this long. */
  disarmMs: 3000,
  /** Its own projectile art, so a jolt can be told apart from a shooter's bolt mid-flight. */
  bulletTexture: 'enemy-bullet-shock',
} as const;

export const BOMBER = {
  /** The fuse lights when the bomber gets this close to the player. */
  triggerRange: 54,
  /** Warning window between the fuse lighting and the blast, in ms. Escape it. */
  fuseMs: 640,
  /** The bomber keeps crawling at this fraction of its speed while the fuse burns. */
  fuseSpeedFactor: 0.5,
  /** Blink rate of the fuse, in ms per half-cycle. */
  blinkIntervalMs: 45,
  /** Everything inside this radius takes the full blast damage. */
  blastRadius: 130,
  blastDamage: 33,
  /**
   * Fuse telegraph: a warning ring around the bomber that grows from a fraction of the blast radius
   * to the real radius as the fuse burns, so escaping is a judgement instead of a guess.
   */
  telegraphTint: 0xff5c5c,
  telegraphStartScale: 0.45,
  telegraphAlpha: 0.55,
  telegraphFillAlpha: 0.07,
  telegraphWidth: 3,
} as const;

export const HEALER = {
  /** Distance the healer tries to keep from the player. */
  preferredRange: 360,
  /** Hysteresis band around the preferred range. */
  slack: 70,
  /** Every enemy inside this radius of the healer is healed by one pulse. */
  healRadius: 240,
  healAmount: 3,
  healIntervalMs: 1500,
  firstHealDelayMs: 900,
} as const;

export const TELEPORTER = {
  /** It only blinks when the player is farther away than this; up close it just walks in. */
  farRange: 520,
  /** A blink lands somewhere in this distance band around the player. */
  arriveMin: 150,
  arriveMax: 240,
  /** Random wait between blink checks. The minimum is the promised floor. */
  minIntervalMs: 3000,
  maxIntervalMs: 6000,
  /** Warning window between the decision to blink and the jump. */
  warnMs: 420,
  /** Blink rate while the jump charges, in ms per half cycle. */
  blinkIntervalMs: 50,
  /** Landing spots stay this far inside the arena walls. */
  landingMargin: 40,
  /** Tint of the warp flash and of the enemy just after it lands. */
  warpTint: 0xb18cff,
  landingTintMs: 120,
  /** Warp flash drawn at both ends of a blink. */
  warpMs: 260,
  warpStartScale: 0.15,
  warpEndScale: 0.55,
  warpAlpha: 0.9,
} as const;

export const BOSS = {
  radius: 30,
  texture: 'enemy-boss',
  /** Wait before the first pattern after a boss spawns, in ms. */
  firstPatternDelayMs: 700,
  /** Slow spin of the boss sprite, in radians per second. Cosmetic, but it reads as "alive". */
  spinPerSecond: 0.24,
  /** HUD badge shown on the boss bar for whichever pattern is running. */
  phaseLabels: {
    burst: { text: 'BURST', color: '#ff8fa3' },
    spiral: { text: 'SPIRAL', color: '#6ee7ff' },
    charge: { text: 'CHARGE', color: '#ff9f6b' },
    warp: { text: 'WARP', color: '#b18cff' },
  } as Record<BossPatternKind, { text: string; color: string }>,
  /** Speed of the radial burst's bullets, in px/s. */
  burstBulletSpeed: 264,
  /**
   * The boss cycles these in order and never repeats one twice in a row. Each punch has a job:
   * the burst denies space, the spiral makes the boss move, and the charge forces a dodge.
   */
  patterns: [
    // Two radial volleys, one per WAVE_CONFIG.boss.burstEveryMs, then the boss changes gear.
    { kind: 'burst', durationMs: WAVE_CONFIG.boss.burstEveryMs * 2 },
    { kind: 'spiral', durationMs: 3000 },
    { kind: 'charge', durationMs: 1700 },
    { kind: 'warp', durationMs: 1200 },
  ] as readonly BossPatternSpec[],
  /**
   * Spiral: a slow fan of `arms` streams whose origin angle twists every step, so the safe gap
   * between the streams moves and has to be chased instead of stood in.
   */
  spiral: {
    arms: 2,
    stepMs: 240,
    /** How far the whole fan turns between steps, in radians. */
    twistRadians: 0.42,
    /** Bullets are slower than the boss's radial burst, so the spiral is about positioning. */
    bulletSpeed: 264,
    bulletDamage: 6,
    /** The boss keeps walking while spiralling, but at this fraction of its speed. */
    speedFactor: 0.55,
  },
  /**
   * Charge: a telegraphed lunge at the player, then a recovery window long enough to punish it.
   * The windup is the tell (a blinking tint and a full stop), so being hit is a read, not a dice roll.
   */
  charge: {
    windupMs: 620,
    lungeMs: 380,
    recoverMs: 700,
    /** Lunge speed in px/s; roughly twice the boss's walk speed. */
    speed: 560,
    tint: 0xff9f6b,
    blinkMs: 90,
  },
  /**
   * Warp: the answer to kiting. When the player is very far away the boss may spend this pattern
   * blinking in close instead of walking, so a run around the arena cannot stall the fight out.
   * It is a chance roll, not a timer, so most passes of the cycle are still a walk-in.
   */
  warp: {
    /** Only worth spending when the player is farther than this, in px. */
    farRange: 620,
    /** Where it lands, as a distance band around the player. */
    arriveMin: 170,
    arriveMax: 250,
    /** Landing spots stay this far from the arena walls. */
    landingMargin: 60,
    /** Chance the move fires each time the pattern comes around. */
    chance: 0.55,
    /** Tell: the boss stops and blinks before the jump, like the teleporter's. */
    windupMs: 420,
    blinkMs: 80,
    /** Tint of the warp flash at both ends of the blink. */
    warpTint: 0xb18cff,
    landingTintMs: 160,
  },
} as const;

export const PICKUPS = {
  dropChance: 0.16,
  healthAmount: 25,
  multiplierFactor: 2,
  multiplierDurationMs: 9000,
  /** Overdrive: every shot deals this multiple of its base damage while active. */
  damageFactor: 2,
  damageDurationMs: 25000,
  /** Full invulnerability: every source of damage is ignored while active. */
  shieldDurationMs: 10000,
  /** Permanent max-health gain (no healing on top). Rolls as often as the other drops. */
  vitalityAmount: 10,
  /** Waves a drop waits on the floor before it fades; it outlives the wave it fell in. */
  lifetimeWaves: 4,
  /** Relative weights inside a drop roll. */
  weights: {
    health: 30,
    weapon: 20,
    multiplier: 25,
    damage: 15,
    shield: 10,
    /** A second gun on the field for 20 s: as strong as the shield, and just as temporary. */
    buddy: 12,
    // Permanent, but no longer a slow trickle: it rolls at the same rate as the other drops.
    vitality: 12,
  } as Record<PickupKind, number>,
  textureFor: {
    health: 'pickup-health',
    weapon: 'pickup-weapon',
    multiplier: 'pickup-multiplier',
    damage: 'pickup-damage',
    shield: 'pickup-shield',
    vitality: 'pickup-vitality',
    buddy: 'pickup-buddy',
  } as Record<PickupKind, string>,
} as const;

/**
 * Battle Buddy: the ally drop. Collecting it puts a temporary clone of the player on the field — a
 * pale, translucent twin carrying the player's own pistol — on a 20 s lease. It fights like the
 * shooter enemy, holding a kiting distance from whichever enemy is nearest, but it has no health
 * and nothing targets it: it is extra firepower, not a second body to lose. A second pickup extends
 * the lease, exactly like the other timed drops.
 */
export const BUDDY = {
  durationMs: 20000,
  /** It reuses the player's art; the tint and alpha are what make it read as a phantom ally. */
  texture: 'player',
  /** Pale lavender wash: apart from the player's cyan and from every hostile's warm colour. */
  tint: 0xd9cfff,
  alpha: 0.9,
  /** Distance it tries to hold from the enemy it is fighting. */
  preferredRange: 260,
  /** Hysteresis band around that range, so it does not twitch while in position. */
  slack: 60,
  /** It opens fire inside this range. */
  fireRange: 520,
  /** With the field clear it trails the player at this distance instead. */
  followRange: 90,
  followSlack: 40,
  /** Walk speed in px/s: a touch under the player's, so it never outruns you. */
  speed: 240,
  /** Muzzle distance borrowed from the player sprite, which is the same art. */
  muzzleOffset: PLAYER.muzzleOffset,
  /** Its first shot lands sooner than a full pistol cycle, so the pickup reads as instant help. */
  firstShotDelayMs: 260,
  /** How far beside the player it pops in. */
  spawnOffset: 44,
  /** Pop-in time for the spawn scale tween, in ms. */
  appearMs: 180,
  /** Sparks shown where it appears and where it fades out. */
  puffSparks: 10,
} as const;

export const UPGRADES = {
  /**
   * Guarantee: while a weapon is still locked, the player is offered one at least this many waves
   * apart, no matter what the random drop roll does. Random drops can still arrive sooner.
   */
  weaponEveryWaves: 5,
  /**
   * Once every gun is owned, a weapon pickup becomes an Ordnance rank instead: a permanent damage
   * bump for the whole arsenal, paid out with the same score bonus as before. Ranks are uncapped,
   * because enemy health grows every wave without a ceiling of its own.
   */
  ordnance: {
    damagePerRank: 0.15,
    scoreBonus: 150,
  },
} as const;

export const SPAWN = {
  /** Never spawn an enemy this close to the player. */
  safeRadius: 230,
  /** Inset used when sampling points on the arena edge. */
  edgeMargin: 36,
  /** How far outside the visible camera rect an enemy appears. */
  viewMargin: 70,
  /** Enemies alive at once; protects the frame budget. */
  maxEnemiesAlive: 60,
  /** Teleport-in effect length, in ms. */
  telegraphMs: 260,
} as const;

export const SCORE = {
  waveClearBase: 50,
  waveClearPerWave: 10,
} as const;

export const COMBAT = {
  /** How long an enemy flashes white after a hit. */
  hitFlashMs: 70,
  damageNumberMs: 460,
  damageNumberPool: 18,
  /** Pause between the death blow and the game-over screen, so the blast reads first. */
  deathDelayMs: 1250,
} as const;

/**
 * Fixed pool caps. A group never grows past these, so a runaway wave costs recycled objects rather
 * than new ones.
 */
export const POOLS = {
  enemyBullets: 90,
  pickups: 24,
} as const;

export const CAMERA = {
  /** Follow smoothing for the scrolling arena camera (0 = no follow, 1 = locked to player). */
  followLerp: 0.16,
  shakeHit: { duration: 70, intensity: 0.0022 },
  shakePlayerHit: { duration: 220, intensity: 0.008 },
  shakeBossDeath: { duration: 500, intensity: 0.016 },
  shakeBlast: { duration: 320, intensity: 0.016 },
  shakeDash: { duration: 90, intensity: 0.003 },
  shakeDeath: { duration: 400, intensity: 0.014 },
  /** Red flash on the frame the player is hit, with the same shape as `BLAST.flash`. */
  flashPlayerHit: { durationMs: 110, red: 120, green: 18, blue: 34 },
} as const;

export const AUDIO = {
  masterVolume: 0.55,
  /** How much the volume buttons in the options panel move the master volume. */
  volumeStep: 0.1,
  muteStorageKey: 'wavebreaker.muted',
  volumeStorageKey: 'wavebreaker.volume',
  musicStorageKey: 'wavebreaker.music',
} as const;

/**
 * Background music: a slow, quiet pad of sine/triangle notes synthesised like every other sound in
 * the game, so there is still nothing to license. `menu` drifts, `game` runs a little faster and
 * an octave lower with an occasional soft bell on top.
 */
export const MUSIC = {
  /** Music bus level against the master volume. A bed, not a track — keep it low. */
  volume: 0.16,
  /** Fade used when the music starts, stops or changes mood, in ms. */
  fadeMs: 1400,
  /** Portion of each pad note spent swelling in; the remainder is the release. */
  attackFraction: 0.3,
  /** How long a chord rings, as a multiple of its step, so consecutive chords overlap. */
  sustain: 1.15,
  menu: {
    stepMs: 2800,
    wave: 'sine',
    gain: 0.5,
    /** Am · F · C · Em, voiced low and wide. */
    chords: [
      [220, 261.63, 329.63],
      [174.61, 220, 349.23],
      [261.63, 329.63, 392],
      [164.81, 246.94, 329.63],
    ],
  },
  game: {
    stepMs: 1600,
    wave: 'triangle',
    gain: 0.45,
    /** Am · F · G · Em an octave down, under the action. */
    chords: [
      [110, 220, 329.63],
      [87.31, 174.61, 261.63],
      [98, 246.94, 293.66],
      [82.41, 164.81, 246.94],
    ],
    /** A soft high note every few steps keeps the loop from feeling static. */
    bell: [440, 523.25, 659.25],
    bellEverySteps: 4,
    bellGain: 0.12,
  },
} as const;

export const STORAGE = {
  highScoreKey: 'wavebreaker.highScore',
  mapKey: 'wavebreaker.map',
  coachBombKey: 'wavebreaker.coach.bomb',
  coachDashKey: 'wavebreaker.coach.dash',
} as const;

export const COLORS = {
  bg: 0x0a0f15,
  floor: 0x101821,
  grid: 0x18242f,
  wall: 0x2b3f52,
  wallGlow: 0x3d6c8c,
  text: '#e6f1f8',
  textDim: '#8ba3b5',
  accent: '#6ee7ff',
  danger: '#ff5e7a',
  health: 0x4ade80,
  healthLow: 0xff5e6b,
  multiplier: '#ffd166',
  damage: '#ff9f6b',
  shield: '#8ab4ff',
  vitality: '#ff7ac6',
  bomb: '#ffd166',
  buddy: '#d9cfff',
  dash: '#9fe9ff',
  disarm: '#ffe14d',
} as const;

export const FONT_FAMILY = "'Segoe UI', 'Trebuchet MS', system-ui, sans-serif";
export const FONT_MONO = "'Consolas', 'SFMono-Regular', monospace";
