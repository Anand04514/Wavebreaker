import { describe, expect, it } from 'vitest';
import { SPAWN, WAVE_CONFIG, type EnemyKind } from '../src/config';
import { enemyCount, isBossWave, type Rng } from '../src/systems/SpawnLogic';
import { WaveManager } from '../src/systems/WaveManager';

function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function newManager(seed = 1): WaveManager {
  const manager = new WaveManager(seeded(seed));
  manager.start(0);
  return manager;
}

interface WaveRun {
  kinds: EnemyKind[];
  bossSpawns: number;
  cleared: boolean;
}

/**
 * Plays one wave to completion, treating every enemy as instantly killed
 * (alive count stays at zero) so the manager reaches its wave-clear branch.
 */
function playWave(manager: WaveManager): WaveRun {
  const kinds: EnemyKind[] = [];
  let bossSpawns = 0;
  let cleared = false;

  const startEvents = manager.update(WAVE_CONFIG.breakDurationMs + 1, 0);
  for (const event of startEvents) {
    if (event.type === 'spawn') kinds.push(event.kind);
  }

  for (let tick = 0; tick < 500 && !cleared; tick += 1) {
    for (const event of manager.update(WAVE_CONFIG.spawnIntervalMs, 0)) {
      if (event.type === 'spawn') {
        kinds.push(event.kind);
        if (event.boss) bossSpawns += 1;
      }
      if (event.type === 'waveClear') cleared = true;
    }
  }

  return { kinds, bossSpawns, cleared };
}

describe('WaveManager', () => {
  it('starts in a break and announces wave 1', () => {
    const manager = newManager();
    expect(manager.wave).toBe(0);
    expect(manager.state).toBe('break');
    expect(manager.breakRemainingMs).toBe(0);

    const events = manager.update(1, 0);
    expect(events[0]).toMatchObject({ type: 'waveStart', wave: 1 });
    expect(manager.state).toBe('spawning');
  });

  it('spawns the configured number of wave 1 chasers, then clears', () => {
    const manager = newManager(7);
    const run = playWave(manager);

    expect(manager.wave).toBe(1);
    expect(run.kinds).toHaveLength(enemyCount(1));
    expect(run.kinds.every((kind) => kind === 'chaser')).toBe(true);
    expect(run.cleared).toBe(true);
    expect(manager.state).toBe('break');
    expect(manager.breakRemainingMs).toBe(WAVE_CONFIG.breakDurationMs);
  });

  it('grows each wave and mixes in new enemy types', () => {
    const manager = newManager(11);
    const first = playWave(manager);
    const second = playWave(manager);

    expect(manager.wave).toBe(2);
    expect(second.kinds.length).toBe(enemyCount(2));
    expect(second.kinds.length).toBeGreaterThan(first.kinds.length);
    expect(new Set(second.kinds)).toEqual(new Set(['chaser', 'runner']));
  });

  it('drips enemies on the spawn interval instead of all at once', () => {
    const manager = newManager();
    manager.update(WAVE_CONFIG.breakDurationMs + 1, 0);

    expect(manager.update(WAVE_CONFIG.firstSpawnDelayMs - 50, 0)).toHaveLength(0);
    const firstBatch = manager.update(100, 0);
    expect(firstBatch.filter((event) => event.type === 'spawn')).toHaveLength(1);
  });

  it('stops spawning when the arena is at the enemy cap', () => {
    const manager = newManager();
    manager.update(WAVE_CONFIG.breakDurationMs + 1, 0);
    const events = manager.update(WAVE_CONFIG.spawnIntervalMs * 3, SPAWN.maxEnemiesAlive);
    expect(events.some((event) => event.type === 'spawn')).toBe(false);
  });

  it('adds a single boss on every fifth wave', () => {
    const manager = newManager(5);
    const runs: WaveRun[] = [];
    for (let i = 0; i < 5; i += 1) runs.push(playWave(manager));

    expect(manager.wave).toBe(5);
    expect(isBossWave(5)).toBe(true);
    expect(runs[4].bossSpawns).toBe(1);
    expect(runs[3].bossSpawns).toBe(0);
    expect(runs[4].kinds).toHaveLength(enemyCount(5) + 1);
  });

  it('waits out the full break before the next wave begins', () => {
    const manager = newManager(2);
    playWave(manager);
    const wave = manager.wave;

    expect(manager.update(WAVE_CONFIG.breakDurationMs - 100, 0)).toHaveLength(0);
    const events = manager.update(200, 0);
    expect(events[0]).toMatchObject({ type: 'waveStart', wave: wave + 1 });
  });

  it('resets wave and queue when a run restarts', () => {
    const manager = newManager(4);
    playWave(manager);
    manager.start(0);

    expect(manager.wave).toBe(0);
    expect(manager.queue).toHaveLength(0);
    expect(manager.state).toBe('break');
  });
});
