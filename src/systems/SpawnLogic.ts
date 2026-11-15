/**
 * Pure game rules: wave composition, spawn placement, scaling and scoring.
 * Nothing in this module touches Phaser, which keeps it unit-testable.
 */
import {
  ARENA,
  BOSS,
  BUDDY,
  BULLET,
  CLONER,
  type CoachTip,
  ENEMY_SPECS,
  NAV,
  OBSTACLES,
  PICKUPS,
  SCORE,
  SPAWN,
  TELEPORTER,
  UPGRADES,
  WAVE_CONFIG,
  type Band,
  type EnemyKind,
  type MapObstacle,
  type PickupKind,
  type WaveConfig,
} from '../config';

export type Rng = () => number;

export interface Vec {
  x: number;
  y: number;
}

export interface ArenaSize {
  width: number;
  height: number;
}

export interface SpawnOptions {
  safeRadius?: number;
  margin?: number;
  arena?: ArenaSize;
  attempts?: number;
  /** How far outside the view rect a point is sampled. */
  viewMargin?: number;
}

/** Rect in world coordinates, normally the camera's visible area. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a float rng result into a valid integer index. */
export function randomIndex(rng: Rng, length: number): number {
  const raw = Math.floor(rng() * length);
  return Math.min(length - 1, Math.max(0, raw));
}

/**
 * Normalise a movement input so diagonal travel is not faster than straight travel.
 * Returns a zero vector for no input.
 */
export function normalizeMovement(inputX: number, inputY: number): Vec {
  const length = Math.hypot(inputX, inputY);
  if (length === 0) return { x: 0, y: 0 };
  return { x: inputX / length, y: inputY / length };
}

/**
 * Which way a dash goes: straight along the direction the player is pointing, so the dash is an
 * aimed lunge rather than an extension of the walk keys.
 */
export function dashVector(aimAngle: number): Vec {
  return { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
}

/* ------------------------------------------------------------- obstacles */

/** Nearest point on the rectangle, then a circle test — cheap and exact enough for walls. */
export function circleHitsObstacle(
  x: number,
  y: number,
  radius: number,
  obstacle: MapObstacle,
): boolean {
  const nearestX = Math.min(Math.max(x, obstacle.x), obstacle.x + obstacle.width);
  const nearestY = Math.min(Math.max(y, obstacle.y), obstacle.y + obstacle.height);
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}

/** True when a body of `radius` at this point would overlap any block. */
export function pointBlocked(
  x: number,
  y: number,
  radius: number,
  obstacles: readonly MapObstacle[],
): boolean {
  // A plain loop rather than `some`: this runs for every steering probe, and the closure it would
  // build is an allocation on the hot path.
  for (const obstacle of obstacles) {
    if (circleHitsObstacle(x, y, radius, obstacle)) return true;
  }
  return false;
}

/**
 * Where a moving bullet first enters a block, as a fraction of the way from `from` to `to`.
 *
 * Blocks are thin enough (40 px on some layouts) that a fast bullet can step right over one
 * between two physics frames, and Arcade only tests where bodies *are*, not the path they took.
 * This is the swept test that closes that gap; it clips the travel segment against the block
 * padded by the bullet radius (Liang–Barsky), so it answers for one step of any length.
 *
 * Returns null when the segment stays clear.
 */
export function segmentObstacleHit(
  from: Vec,
  to: Vec,
  radius: number,
  obstacle: MapObstacle,
): number | null {
  const left = obstacle.x - radius;
  const right = obstacle.x + obstacle.width + radius;
  const top = obstacle.y - radius;
  const bottom = obstacle.y + obstacle.height + radius;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  let entry = 0;
  let exit = 1;

  // Edges in the order left, right, top, bottom. The p/q pairs are computed inline rather than put
  // in scratch arrays: this is called for every live bullet against every block, every frame.
  for (let side = 0; side < 4; side += 1) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy;
    const q =
      side === 0 ? from.x - left : side === 1 ? right - from.x : side === 2 ? from.y - top : bottom - from.y;

    if (p === 0) {
      // Parallel to this edge: only a problem when the segment starts outside it.
      if (q < 0) return null;
      continue;
    }

    const t = q / p;
    if (p < 0) {
      if (t > exit) return null;
      if (t > entry) entry = t;
    } else {
      if (t < entry) return null;
      if (t < exit) exit = t;
    }
  }

  return entry;
}

/**
 * Where a shot should actually start. The drawn muzzle sits in front of the player, so hugging a
 * wall puts it inside the block; this pulls that point back to the wall face (just short of it)
 * along the aim direction. A shot fired at the wall then sparks on its face instead of vanishing
 * inside it, and a shot fired along the wall still gets away.
 */
export function clipMuzzleToCover(
  from: Vec,
  angle: number,
  reach: number,
  obstacles: readonly MapObstacle[],
  radius: number,
  clearance: number = BULLET.muzzleClearance,
): Vec {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const muzzle = { x: from.x + direction.x * reach, y: from.y + direction.y * reach };
  if (obstacles.length === 0) return muzzle;

  let nearest = 1;
  let blocked = false;
  for (const obstacle of obstacles) {
    const hit = segmentObstacleHit(from, muzzle, radius, obstacle);
    if (hit !== null && hit < nearest) {
      nearest = hit;
      blocked = true;
    }
  }
  if (!blocked) return muzzle;

  const distance = Math.max(0, nearest * reach - clearance);
  return { x: from.x + direction.x * distance, y: from.y + direction.y * distance };
}

/** True when walking `direction` from `from` would run a body into cover within the look-ahead. */
export function directionBlocked(
  from: Vec,
  direction: Vec,
  obstacles: readonly MapObstacle[],
  radius: number,
  lookAhead: number = NAV.lookAhead,
): boolean {
  return blockedAhead(
    from.x,
    from.y,
    direction.x,
    direction.y,
    obstacles,
    radius,
    lookAhead,
  );
}

/**
 * The probe behind `directionBlocked`, in scalars. Deflection tests one candidate direction per try,
 * so it walks those numbers rather than building a vector object for each one.
 */
function blockedAhead(
  fromX: number,
  fromY: number,
  dirX: number,
  dirY: number,
  obstacles: readonly MapObstacle[],
  radius: number,
  lookAhead: number,
): boolean {
  const length = Math.hypot(dirX, dirY);
  if (length === 0 || obstacles.length === 0) return false;
  const x = fromX + (dirX / length) * lookAhead;
  const y = fromY + (dirY / length) * lookAhead;
  return pointBlocked(x, y, radius, obstacles);
}

/**
 * Fills `out` with a direction, or makes a new vector when no buffer is given. Steering runs for every
 * enemy every frame, so callers that hold a buffer pass it and the call allocates nothing at all.
 * `out` must not be the same object as any input vector.
 */
function writeVec(out: Vec | undefined, x: number, y: number): Vec {
  if (!out) return { x, y };
  out.x = x;
  out.y = y;
  return out;
}

/**
 * Where a kiting enemy should actually move. Retreating and strafing are not trying to reach a
 * specific point, so instead of routing around a whole block they simply swing the way they wanted
 * further to one side until it is clear — a shooter with its back to a wall slides along it rather
 * than pressing into it.
 *
 * Always returns a unit vector.
 */
export function deflectAroundCover(
  from: Vec,
  direction: Vec,
  obstacles: readonly MapObstacle[],
  radius: number,
  lookAhead: number = NAV.lookAhead,
  out?: Vec,
): Vec {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0) return writeVec(out, 0, 0);

  const dirX = direction.x / length;
  const dirY = direction.y / length;
  if (!blockedAhead(from.x, from.y, dirX, dirY, obstacles, radius, lookAhead)) {
    return writeVec(out, dirX, dirY);
  }

  // One turned candidate per try, tested as scalars: only the direction that clears gets an object.
  for (let step = 1; step <= NAV.deflectTries; step += 1) {
    for (let side = 0; side < 2; side += 1) {
      const sideSign = side === 0 ? 1 : -1;
      const angle = sideSign * step * NAV.deflectStepRadians;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const turnedX = dirX * cos - dirY * sin;
      const turnedY = dirX * sin + dirY * cos;
      if (!blockedAhead(from.x, from.y, turnedX, turnedY, obstacles, radius, lookAhead)) {
        return writeVec(out, turnedX, turnedY);
      }
    }
  }

  return writeVec(out, dirX, dirY);
}

/**
 * Walking steering around cover. Probes a short way toward the target; if a block is in the way it
 * heads for the padded corner of that block nearest the target, so the enemy walks around the edge
 * instead of pushing into a flat wall. The corner is a fixed waypoint (it depends only on the block
 * and the target), which is what stops the detour oscillating at a corner.
 *
 * The result is always a unit vector (or zero when the target is the current position), which keeps
 * `speed` meaningful.
 */
export function avoidObstacles(
  from: Vec,
  target: Vec,
  obstacles: readonly MapObstacle[],
  radius: number,
  lookAhead: number = NAV.lookAhead,
  out?: Vec,
): Vec {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return writeVec(out, 0, 0);

  const dirX = dx / length;
  const dirY = dy / length;
  if (obstacles.length === 0) return writeVec(out, dirX, dirY);

  const probeX = from.x + dirX * lookAhead;
  const probeY = from.y + dirY * lookAhead;
  let blocker: MapObstacle | null = null;
  for (const obstacle of obstacles) {
    if (circleHitsObstacle(probeX, probeY, radius, obstacle)) {
      blocker = obstacle;
      break;
    }
  }
  if (!blocker) return writeVec(out, dirX, dirY);

  const margin = radius + NAV.cornerClearance;
  const left = blocker.x - margin;
  const right = blocker.x + blocker.width + margin;
  const top = blocker.y - margin;
  const bottom = blocker.y + blocker.height + margin;

  // Four corners as scalars, in the same order as before: the nearest to the target wins.
  let waypointX = left;
  let waypointY = top;
  let nearest = Math.hypot(target.x - left, target.y - top);
  for (let corner = 1; corner < 4; corner += 1) {
    const cornerX = corner === 1 || corner === 3 ? right : left;
    const cornerY = corner === 1 || corner === 2 ? top : bottom;
    const gap = Math.hypot(target.x - cornerX, target.y - cornerY);
    if (gap < nearest) {
      nearest = gap;
      waypointX = cornerX;
      waypointY = cornerY;
    }
  }

  const toCornerX = waypointX - from.x;
  const toCornerY = waypointY - from.y;
  const cornerLength = Math.hypot(toCornerX, toCornerY);
  if (cornerLength === 0) return writeVec(out, dirX, dirY);

  return writeVec(out, toCornerX / cornerLength, toCornerY / cornerLength);
}

/**
 * A committed sideways step for a walker that has stopped making progress: the heading it wanted is
 * turned a quarter turn to one side and then deflected around cover, so the enemy travels along a
 * block face and rounds its corner instead of pressing into it. Callers hold the same side for a
 * while, which is what turns a livelock into a detour.
 *
 * Always returns a unit vector.
 */
export function slipAlongCover(
  from: Vec,
  wanted: Vec,
  obstacles: readonly MapObstacle[],
  radius: number,
  side: 1 | -1,
  lookAhead: number = NAV.lookAhead,
): Vec {
  const slide = { x: -wanted.y * side, y: wanted.x * side };
  return deflectAroundCover(from, slide, obstacles, radius, lookAhead);
}

/**
 * Moves a spawn, drop or teleport landing out of any block while keeping it inside the arena.
 * Tries a handful of random offsets; if the spot is still blocked it is returned unchanged, so a
 * caller never loses a spawn because of a wall.
 */
export function nudgeClearPoint(
  point: Vec,
  radius: number,
  obstacles: readonly MapObstacle[],
  rng: Rng = Math.random,
  arena: ArenaSize = { width: ARENA.width, height: ARENA.height },
): Vec {
  if (obstacles.length === 0) return point;

  const margin = OBSTACLES.clearance + radius;
  const clear = (candidate: Vec): boolean =>
    !pointBlocked(candidate.x, candidate.y, margin, obstacles) &&
    candidate.x >= margin &&
    candidate.x <= arena.width - margin &&
    candidate.y >= margin &&
    candidate.y <= arena.height - margin;

  if (clear(point)) return point;

  for (let attempt = 0; attempt < OBSTACLES.nudgeAttempts; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = OBSTACLES.nudgeRadius * (0.35 + 0.65 * Math.min(1, Math.max(0, rng())));
    const candidate = {
      x: point.x + Math.cos(angle) * distance,
      y: point.y + Math.sin(angle) * distance,
    };
    if (clear(candidate)) return candidate;
  }

  // Random nudges can keep missing a point buried deep inside a large slab, so finish with a
  // widening ring sweep: it always finds a way out when there is open floor nearby.
  const ringStep = OBSTACLES.nudgeRadius / 2;
  for (let ring = 1; ring <= OBSTACLES.nudgeRings; ring += 1) {
    const distance = ring * ringStep;
    for (let index = 0; index < OBSTACLES.nudgeAngles; index += 1) {
      const angle = (index / OBSTACLES.nudgeAngles) * Math.PI * 2;
      const candidate = {
        x: point.x + Math.cos(angle) * distance,
        y: point.y + Math.sin(angle) * distance,
      };
      if (clear(candidate)) return candidate;
    }
  }

  return point;
}

/** Every wave after the first adds a percentage to enemy health. */
export function healthMultiplier(wave: number, cfg: WaveConfig = WAVE_CONFIG): number {
  return 1 + cfg.healthGrowthPerWave * Math.max(0, wave - 1);
}

/** Health is whole numbers so hit counts stay predictable. */
export function scaledHealth(baseHealth: number, wave: number, cfg: WaveConfig = WAVE_CONFIG): number {
  return Math.max(1, Math.ceil(baseHealth * healthMultiplier(wave, cfg)));
}

/** enemies per wave = base + growth x wave number. */
export function enemyCount(wave: number, cfg: WaveConfig = WAVE_CONFIG): number {
  return Math.max(0, cfg.baseCount + cfg.countPerWave * wave);
}

/** The highest `fromWave` band at or below this wave decides the mix. */
export function activeBand(wave: number, cfg: WaveConfig = WAVE_CONFIG): Band {
  let band = cfg.bands[0];
  for (const candidate of cfg.bands) {
    if (wave >= candidate.fromWave) band = candidate;
  }
  return band;
}

/**
 * Deterministic (given an rng) list of enemy types for a wave.
 * Weighted picks are used so a band is a mix, not a rotating schedule.
 */
export function rollComposition(wave: number, cfg: WaveConfig = WAVE_CONFIG, rng: Rng = Math.random): EnemyKind[] {
  const band = activeBand(wave, cfg);
  const weighted: EnemyKind[] = [];
  for (const entry of band.types) {
    for (let i = 0; i < entry.weight; i += 1) weighted.push(entry.type);
  }
  if (weighted.length === 0) return [];

  const total = enemyCount(wave, cfg);
  const composition: EnemyKind[] = [];
  for (let i = 0; i < total; i += 1) {
    composition.push(weighted[randomIndex(rng, weighted.length)]);
  }
  return composition;
}

export function isBossWave(wave: number, cfg: WaveConfig = WAVE_CONFIG): boolean {
  return cfg.bossEveryWaves > 0 && wave > 0 && wave % cfg.bossEveryWaves === 0;
}

/** One enemy the cloner could copy. Structural, so this module stays free of Phaser types. */
export interface CloneCandidate {
  kind: EnemyKind;
  clone: boolean;
  boss: boolean;
}

/**
 * What a cloner copies: one of the enemies actually standing on the field with it. A copy of a copy
 * would let one cloner multiply without limit, so copies are never a source; neither is the cloner
 * itself nor a boss (a boss is a role of the tank, so a copied tank is always an ordinary one).
 *
 * Picking a whole instance rather than a kind weights the result by what is really around: three
 * chasers on the field are three times as likely to be copied as a lone healer. Returns null when
 * nothing eligible is in range, and then the pulse simply does nothing.
 */
export function pickCloneKind(
  candidates: Iterable<CloneCandidate>,
  rng: Rng = Math.random,
): EnemyKind | null {
  const eligible = [...candidates].filter(
    (enemy) => !enemy.clone && !enemy.boss && enemy.kind !== 'cloner',
  );
  if (eligible.length === 0) return null;
  return eligible[randomIndex(rng, eligible.length)].kind;
}

export function bossHealth(wave: number, cfg: WaveConfig = WAVE_CONFIG): number {
  const growth = 1 + cfg.boss.healthGrowthPerWave * Math.max(0, wave - 1);
  return Math.ceil(cfg.boss.health * growth);
}

/**
 * Bullet angles (radians) for one step of the boss's spiral: `arms` streams spaced evenly around
 * the circle, starting from `offsetRadians`. Arm count is floored, so a fractional value cannot
 * produce a partial stream.
 */
export function spiralAngles(arms: number, offsetRadians: number): number[] {
  const count = Math.max(0, Math.floor(arms));
  const angles: number[] = [];
  for (let i = 0; i < count; i += 1) {
    angles.push(offsetRadians + (Math.PI * 2 * i) / count);
  }
  return angles;
}

/** Stages of a boss charge, in order. */
export type ChargePhase = 'windup' | 'lunge' | 'recover' | 'done';

/**
 * Which part of a charge is running `elapsedMs` after it began. The windup is the telegraph, the
 * lunge is the threat, and the recovery is the window to punish it.
 */
export function chargePhase(
  elapsedMs: number,
  windupMs: number,
  lungeMs: number,
  recoverMs: number,
): ChargePhase {
  const elapsed = Math.max(0, elapsedMs);
  const windup = Math.max(0, windupMs);
  if (elapsed < windup) return 'windup';
  if (elapsed < windup + Math.max(0, lungeMs)) return 'lunge';
  if (elapsed < windup + Math.max(0, lungeMs) + Math.max(0, recoverMs)) return 'recover';
  return 'done';
}

/** A random point on the arena edge, at least `safeRadius` away from the player. */
export function spawnPoint(
  player: Vec,
  rng: Rng = Math.random,
  options: SpawnOptions = {},
): Vec {
  const arena = options.arena ?? { width: ARENA.width, height: ARENA.height };
  const margin = options.margin ?? SPAWN.edgeMargin;
  const safeRadius = options.safeRadius ?? SPAWN.safeRadius;
  const attempts = options.attempts ?? 18;

  const minX = margin;
  const maxX = arena.width - margin;
  const minY = margin;
  const maxY = arena.height - margin;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const sampleEdge = (): Vec => {
    const edge = randomIndex(rng, 4);
    const t = rng();
    switch (edge) {
      case 0:
        return { x: minX + t * spanX, y: minY };
      case 1:
        return { x: maxX, y: minY + t * spanY };
      case 2:
        return { x: minX + t * spanX, y: maxY };
      default:
        return { x: minX, y: minY + t * spanY };
    }
  };

  for (let i = 0; i < attempts; i += 1) {
    const point = sampleEdge();
    if (distance(point, player) >= safeRadius) return point;
  }

  // Fallback: the inset corner farthest from the player, which is the safest legal spot.
  const corners: Vec[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  let best = corners[0];
  for (const corner of corners) {
    if (distanceSq(corner, player) > distanceSq(best, player)) best = corner;
  }
  return { ...best };
}

/**
 * Spawn just outside the visible camera rect so enemies walk in from off-screen in a scrolling
 * arena. Points are clamped into the arena, never placed on screen, and kept outside the safe
 * radius around the player. Falls back to the arena edge sampler if no spot is found.
 */
export function spawnPointAroundView(
  player: Vec,
  view: ViewRect,
  rng: Rng = Math.random,
  options: SpawnOptions = {},
): Vec {
  const arena = options.arena ?? { width: ARENA.width, height: ARENA.height };
  const margin = options.margin ?? SPAWN.edgeMargin;
  const safeRadius = options.safeRadius ?? SPAWN.safeRadius;
  const viewMargin = options.viewMargin ?? SPAWN.viewMargin;
  const attempts = options.attempts ?? 24;

  const minX = margin;
  const maxX = arena.width - margin;
  const minY = margin;
  const maxY = arena.height - margin;

  const left = view.x - viewMargin;
  const right = view.x + view.width + viewMargin;
  const top = view.y - viewMargin;
  const bottom = view.y + view.height + viewMargin;

  for (let i = 0; i < attempts; i += 1) {
    const edge = randomIndex(rng, 4);
    const t = rng();
    let candidate: Vec;
    switch (edge) {
      case 0:
        candidate = { x: left + t * (right - left), y: top };
        break;
      case 1:
        candidate = { x: right, y: top + t * (bottom - top) };
        break;
      case 2:
        candidate = { x: left + t * (right - left), y: bottom };
        break;
      default:
        candidate = { x: left, y: top + t * (bottom - top) };
    }

    const point = {
      x: Math.min(maxX, Math.max(minX, candidate.x)),
      y: Math.min(maxY, Math.max(minY, candidate.y)),
    };

    if (isInsideView(point, view)) continue;
    if (distance(point, player) < safeRadius) continue;
    return point;
  }

  return spawnPoint(player, rng, options);
}

function isInsideView(point: Vec, view: ViewRect): boolean {
  return (
    point.x > view.x &&
    point.x < view.x + view.width &&
    point.y > view.y &&
    point.y < view.y + view.height
  );
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Weighted pick used for both wave bands and pickup drops. */
export function pickWeighted<T>(items: T[], weights: number[], rng: Rng = Math.random): T {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return items[randomIndex(rng, items.length)];

  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= Math.max(0, weights[i]);
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

export function rollDrop(rng: Rng = Math.random, chance: number = PICKUPS.dropChance): boolean {
  return rng() < chance;
}

/** Bosses always leave something behind; every other kill relies on the drop chance. */
export function shouldDropPickup(
  isBoss: boolean,
  rng: Rng = Math.random,
  chance: number = PICKUPS.dropChance,
): boolean {
  return isBoss || rollDrop(rng, chance);
}

/**
 * The wave a drop fades on. A drop left in wave 3 lasts to the start of wave 7 (lifetime 4), so it
 * survives the rest of the wave it fell in plus three more.
 */
export function pickupExpiryWave(
  dropWave: number,
  lifetimeWaves: number = PICKUPS.lifetimeWaves,
): number {
  return dropWave + lifetimeWaves;
}

export function rollPickupKind(rng: Rng = Math.random): PickupKind {
  const kinds = Object.keys(PICKUPS.weights) as PickupKind[];
  return pickWeighted(
    kinds,
    kinds.map((kind) => PICKUPS.weights[kind]),
    rng,
  );
}

/* ---------------------------------------------------------------- buddy */

/** The ranges the battle buddy works to. Defaults to the tuned values in `config.ts`. */
export interface BuddyRange {
  preferredRange: number;
  slack: number;
  fireRange: number;
  followRange: number;
  followSlack: number;
}

export interface BuddyPlan {
  /** Point to walk toward, or null to stand and shoot. A point, not a heading, so cover can be routed. */
  walkTo: Vec | null;
  /** Facing in radians: at the enemy in front, or at the player when the field is clear. */
  aimAngle: number;
  /** True when the target is close enough to shoot. */
  inRange: boolean;
}

/**
 * What the battle buddy does this frame: hold a kiting distance from the nearest enemy and shoot
 * inside range, exactly the way the shooter enemy fights — only for the player. With nothing on the
 * field it tags along near the player rather than standing where it was left.
 */
export function buddyPlan(
  buddy: Vec,
  player: Vec,
  enemy: Vec | null,
  range: BuddyRange = BUDDY,
): BuddyPlan {
  if (enemy) {
    const gap = distance(buddy, enemy);
    const aimAngle = Math.atan2(enemy.y - buddy.y, enemy.x - buddy.x);
    const inRange = gap <= range.fireRange;

    if (gap > range.preferredRange + range.slack) return { walkTo: enemy, aimAngle, inRange };
    if (gap < range.preferredRange - range.slack) {
      return { walkTo: standOff(enemy, buddy, range.preferredRange), aimAngle, inRange };
    }
    return { walkTo: null, aimAngle, inRange };
  }

  const gap = distance(buddy, player);
  const aimAngle = Math.atan2(player.y - buddy.y, player.x - buddy.x);
  if (gap > range.followRange + range.followSlack) {
    return { walkTo: player, aimAngle, inRange: false };
  }
  if (gap < range.followRange - range.followSlack) {
    return { walkTo: standOff(player, buddy, range.followRange), aimAngle, inRange: false };
  }
  return { walkTo: null, aimAngle, inRange: false };
}

/** A point `range` px from `anchor`, on the side `from` is already standing. */
function standOff(anchor: Vec, from: Vec, range: number): Vec {
  const dx = from.x - anchor.x;
  const dy = from.y - anchor.y;
  const length = Math.hypot(dx, dy);
  // Dead centre — it spawned on top of the anchor — so pick a side instead of dividing by zero.
  if (length === 0) return { x: anchor.x + range, y: anchor.y };
  return { x: anchor.x + (dx / length) * range, y: anchor.y + (dy / length) * range };
}

/** Score for a kill, including the score multiplier. Always a whole number. */
export function computeScore(baseValue: number, multiplier = 1): number {
  return Math.round(baseValue * multiplier);
}

/**
 * What killing a cloner's copy pays, before the score multiplier: a share of the real enemy's value,
 * so copies are worth clearing but never a better farm than the enemies they were copied from.
 */
export function cloneScore(
  baseScore: number,
  factor: number = CLONER.cloneScoreFactor,
): number {
  return Math.max(0, Math.round(baseScore * Math.max(0, factor)));
}

export function waveClearBonus(wave: number): number {
  return SCORE.waveClearBase + SCORE.waveClearPerWave * wave;
}

/** Health math used by enemies and the player, clamped at zero. */
export function applyDamage(health: number, damage: number): number {
  return Math.max(0, health - Math.max(0, damage));
}

/** Healing never overshoots the maximum and never subtracts health. */
export function applyHeal(health: number, maxHealth: number, amount: number): number {
  return Math.min(Math.max(0, maxHealth), health + Math.max(0, amount));
}

/**
 * Permanent max-health gain (the vitality drop). Only the cap grows: current health is left
 * untouched, so the drop never doubles as a heal.
 */
export function applyMaxHealthGain(
  health: number,
  maxHealth: number,
  amount: number,
): { health: number; maxHealth: number } {
  const nextMax = maxHealth + Math.max(0, amount);
  return { health: Math.min(health, nextMax), maxHealth: nextMax };
}

/**
 * How far a lit fuse has burned, as 0..1. Used by the bomber telegraph so the warning ring
 * reaches exactly the blast radius when the fuse runs out.
 */
export function fuseProgress(elapsedMs: number, fuseMs: number): number {
  if (fuseMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / fuseMs));
}

/** Random wait between teleporter blink checks: never shorter than the configured minimum. */
export function randomTeleportDelay(
  rng: Rng = Math.random,
  cfg: typeof TELEPORTER = TELEPORTER,
): number {
  const t = Math.min(1, Math.max(0, rng()));
  return cfg.minIntervalMs + t * (cfg.maxIntervalMs - cfg.minIntervalMs);
}

/** The band a blink landing is picked from; both the teleporter and the boss warp satisfy it. */
export interface BlinkBand {
  arriveMin: number;
  arriveMax: number;
  landingMargin: number;
}

/**
 * Where a blinking enemy lands: a random bearing around the player at a distance inside the
 * configured band, kept clear of the arena walls. If the player is pinned against a wall so no
 * bearing fits, the nearest legal point is used instead of dropping the blink.
 */
export function teleportPoint(
  player: Vec,
  rng: Rng = Math.random,
  cfg: BlinkBand = TELEPORTER,
  arena: ArenaSize = { width: ARENA.width, height: ARENA.height },
  obstacles: readonly MapObstacle[] = [],
  bodyRadius: number = ENEMY_SPECS.teleporter.radius,
): Vec {
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
  const minX = cfg.landingMargin;
  const maxX = Math.max(minX, arena.width - cfg.landingMargin);
  const minY = cfg.landingMargin;
  const maxY = Math.max(minY, arena.height - cfg.landingMargin);

  let point: Vec = { x: player.x, y: player.y };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const t = Math.min(1, Math.max(0, rng()));
    const radius = cfg.arriveMin + t * (cfg.arriveMax - cfg.arriveMin);
    point = {
      x: player.x + Math.cos(angle) * radius,
      y: player.y + Math.sin(angle) * radius,
    };
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) break;
  }

  const landing = { x: clamp(point.x, minX, maxX), y: clamp(point.y, minY, maxY) };
  // Never land inside a block: the blink would put the teleporter in cover it cannot leave.
  return nudgeClearPoint(landing, bodyRadius, obstacles, rng, arena);
}

/**
 * Where a cloner's copies appear: a ring around it, evenly spaced but with a little jitter per copy
 * so a squad never lands in a perfect pattern. Points are kept inside the arena walls and pushed
 * clear of cover, because a copy spawned inside a slab would be stuck there for its whole life.
 */
export function clonePoints(
  center: Vec,
  count: number,
  radius: number,
  rng: Rng = Math.random,
  obstacles: readonly MapObstacle[] = [],
  bodyRadius: number = OBSTACLES.bodyRadius,
  arena: ArenaSize = { width: ARENA.width, height: ARENA.height },
): Vec[] {
  const total = Math.max(0, Math.floor(count));
  const points: Vec[] = [];
  if (total === 0) return points;

  const start = rng() * Math.PI * 2;
  const margin = SPAWN.edgeMargin;
  for (let index = 0; index < total; index += 1) {
    const angle = start + (Math.PI * 2 * index) / total;
    const out = Math.max(0, radius) * (0.7 + 0.3 * Math.min(1, Math.max(0, rng())));
    const point = {
      x: Math.min(arena.width - margin, Math.max(margin, center.x + Math.cos(angle) * out)),
      y: Math.min(arena.height - margin, Math.max(margin, center.y + Math.sin(angle) * out)),
    };
    points.push(nudgeClearPoint(point, bodyRadius, obstacles, rng, arena));
  }
  return points;
}

/**
 * Whether the boss spends a warp pass closing the gap: only when the player is far enough away and
 * the roll comes in under the configured chance, so a close fight is never interrupted by a jump.
 */
export function shouldWarpIn(
  distance: number,
  rng: Rng = Math.random,
  farRange: number = BOSS.warp.farRange,
  chance: number = BOSS.warp.chance,
): boolean {
  if (distance < farRange) return false;
  return rng() < Math.max(0, Math.min(1, chance));
}

/**
 * True once the player has gone the configured number of waves without a weapon upgrade, which is
 * when the guaranteed drop steps in.
 */
export function weaponUpgradeDue(
  wavesSinceUpgrade: number,
  everyWaves: number = UPGRADES.weaponEveryWaves,
): boolean {
  if (everyWaves <= 0) return false;
  return wavesSinceUpgrade >= everyWaves;
}

/**
 * Bomber blast: full damage anywhere inside the radius, nothing outside it.
 * Distance is measured from the blast centre to the player.
 */
export function blastDamageAt(distance: number, radius: number, damage: number): number {
  if (radius <= 0 || distance > radius) return 0;
  return Math.max(0, damage);
}

/**
 * Thrown-bomb damage after the target's blast resistance. Armoured enemies (the tank) take a
 * fraction, so a single throw can hurt them without ever finishing them off.
 */
export function bombDamageAgainst(kind: EnemyKind, damage: number): number {
  const factor = ENEMY_SPECS[kind].bombDamageFactor ?? 1;
  return Math.max(0, damage) * Math.max(0, Math.min(1, factor));
}

export function enemyScore(kind: EnemyKind): number {
  return ENEMY_SPECS[kind].score;
}

/** One Know Your Enemy row: the numbers the panel shows for an enemy at a given wave. */
export interface KnowYourEnemyEntry {
  kind: EnemyKind;
  /** Health the enemy spawns with on the wave the table was asked for. */
  health: number;
  speed: number;
  contactDamage: number;
  score: number;
}

/* ------------------------------------------------------------------ coaching */

export interface CoachTiming {
  firstDelayMs: number;
  staggerMs: number;
}

/**
 * Which first-run coach tip is due, if any. Tips queue in order: the first fires `firstDelayMs` into
 * a run and each later one `staggerMs` after the previous, so two banners never land together.
 * Pure so the ordering stays testable without a scene.
 */
export function coachTipDue(
  pending: readonly CoachTip[],
  shownThisRun: number,
  runMs: number,
  timing: CoachTiming,
): CoachTip | null {
  const tip = pending[0];
  if (!tip) return null;
  const dueAt = timing.firstDelayMs + Math.max(0, shownThisRun) * timing.staggerMs;
  return runMs >= dueAt ? tip : null;
}

/** The table's numbers at a given wave, so the panel can show what is actually on the field. */
export function knowYourEnemyEntries(wave: number, cfg: WaveConfig = WAVE_CONFIG): KnowYourEnemyEntry[] {
  return (Object.keys(ENEMY_SPECS) as EnemyKind[]).map((kind) => {
    const spec = ENEMY_SPECS[kind];
    return {
      kind,
      health: scaledHealth(spec.health, wave, cfg),
      speed: spec.speed,
      contactDamage: spec.contactDamage,
      score: spec.score,
    };
  });
}
