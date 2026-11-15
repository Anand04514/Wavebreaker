/**
 * Drives wave pacing: breaks, spawn drips, boss spawns and wave-clear detection.
 * Pure logic with an injected rng, so pacing can be unit-tested with fake deltas.
 */
import { SPAWN, WAVE_CONFIG, type EnemyKind, type WaveConfig } from '../config';
import { isBossWave, rollComposition, waveClearBonus, type Rng } from './SpawnLogic';

export type WaveState = 'idle' | 'break' | 'spawning';

export type WaveEvent =
  | { type: 'waveStart'; wave: number; count: number; boss: boolean }
  | { type: 'spawn'; kind: EnemyKind; boss: boolean }
  | { type: 'waveClear'; wave: number; bonus: number };

export class WaveManager {
  wave = 0;
  state: WaveState = 'idle';
  /** Enemy kinds still to be spawned this wave. */
  queue: EnemyKind[] = [];
  bossPending = false;
  private timer = 0;
  private spawnTimer = 0;

  constructor(
    private readonly rng: Rng = Math.random,
    private readonly cfg: WaveConfig = WAVE_CONFIG,
  ) {}

  /** Begin the run: short breather, then wave 1. */
  start(delayMs = 1400): void {
    this.wave = 0;
    this.queue = [];
    this.bossPending = false;
    this.state = 'break';
    this.timer = delayMs;
    this.spawnTimer = 0;
  }

  /** Milliseconds left in the between-wave break (for the HUD countdown). */
  get breakRemainingMs(): number {
    return this.state === 'break' ? Math.max(0, this.timer) : 0;
  }

  get isBossWave(): boolean {
    return this.bossPending || isBossWave(this.wave, this.cfg);
  }

  update(deltaMs: number, aliveEnemies: number): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.state === 'idle') return events;

    if (this.state === 'break') {
      this.timer -= deltaMs;
      if (this.timer <= 0) events.push(...this.beginWave());
      return events;
    }

    // Bosses get priority so they can't be starved by a full arena.
    if (this.bossPending && aliveEnemies < SPAWN.maxEnemiesAlive) {
      this.bossPending = false;
      events.push({ type: 'spawn', kind: 'tank', boss: true });
      aliveEnemies += 1;
      this.spawnTimer = Math.max(this.spawnTimer, this.cfg.spawnIntervalMs);
    }

    this.spawnTimer -= deltaMs;
    let spawnedThisTick = 0;

    while (
      this.spawnTimer <= 0 &&
      this.queue.length > 0 &&
      aliveEnemies + spawnedThisTick < SPAWN.maxEnemiesAlive
    ) {
      const kind = this.queue.shift() as EnemyKind;
      events.push({ type: 'spawn', kind, boss: false });
      spawnedThisTick += 1;
      this.spawnTimer += Math.max(1, this.cfg.spawnIntervalMs);
    }

    if (this.queue.length === 0 && !this.bossPending && aliveEnemies + spawnedThisTick === 0) {
      events.push({ type: 'waveClear', wave: this.wave, bonus: waveClearBonus(this.wave) });
      this.state = 'break';
      this.timer = this.cfg.breakDurationMs;
    }

    return events;
  }

  private beginWave(): WaveEvent[] {
    this.wave += 1;
    this.queue = rollComposition(this.wave, this.cfg, this.rng);
    this.bossPending = isBossWave(this.wave, this.cfg);
    this.state = 'spawning';
    this.spawnTimer = this.cfg.firstSpawnDelayMs;
    return [
      {
        type: 'waveStart',
        wave: this.wave,
        count: this.queue.length + (this.bossPending ? 1 : 0),
        boss: this.bossPending,
      },
    ];
  }
}
