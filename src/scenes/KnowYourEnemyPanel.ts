import Phaser from 'phaser';
import {
  BOSS,
  CLONER,
  COLORS,
  ENEMY_SPECS,
  FONT_MONO,
  HEALER,
  PICKUPS,
  SHOCK,
  WAVE_CONFIG,
  type EnemyKind,
} from '../config';
import { knowYourEnemyEntries, bossHealth } from '../systems/SpawnLogic';

/** Where the table draws, and which wave its health column is scaled to. */
export interface KnowYourEnemyLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  wave: number;
}

/** Reading order for the table: melee first, then the ranged and support units, boss last. */
const KIND_ORDER: EnemyKind[] = [
  'chaser',
  'runner',
  'tank',
  'shooter',
  'shocker',
  'cloner',
  'bomber',
  'healer',
  'teleporter',
];

/** One line of how an enemy fights, with its numbers pulled from config. */
function behaviour(kind: EnemyKind): string {
  switch (kind) {
    case 'chaser':
      return 'walks straight at you';
    case 'runner':
      return 'fast and fragile · weaves in';
    case 'tank':
      return `bomb resistant: takes ${Math.round((ENEMY_SPECS.tank.bombDamageFactor ?? 1) * 100)}% of a blast`;
    case 'shooter':
      return 'keeps distance and shoots you from far';
    case 'shocker':
      return `jams your gun for ${SHOCK.disarmMs / 1000}s`;
    case 'cloner':
      return `makes clones every ${CLONER.cloneIntervalMs / 1000}s`;
    case 'bomber':
      return 'blows up and does heavy damage';
    case 'healer':
      return `heals +${HEALER.healAmount} for nearby enemies`;
    case 'teleporter':
      return 'teleports near you when far';
  }
}

/**
 * Draws the Know Your Enemy table into an existing panel container. The scene owns the frame, title and
 * close hint; this owns the data, so the menu copy and the mid-run copy can never disagree. Every
 * number comes from `config.ts` and `waves.json`, and the health column is scaled to `layout.wave`,
 * which is what makes the table read correctly when it is opened part-way through a run.
 */
export function renderKnowYourEnemy(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  layout: KnowYourEnemyLayout,
): void {
  const { left, top, width, height, wave } = layout;
  const centerX = left + width / 2;
  // Columns are placed as fractions of the panel width, so the table keeps an even rhythm and still
  // fits when the layout hands it a different width. The numeric block steps by the same amount
  // (0.099 of the width) and the behaviour column starts one more step on, which leaves its longest
  // line — the boss note — inside the panel's right edge.
  const column = {
    icon: left + 40,
    name: left + 56,
    health: left + width * 0.285,
    speed: left + width * 0.384,
    damage: left + width * 0.483,
    score: left + width * 0.582,
    note: left + width * 0.681,
  };

  const header = (x: number, text: string, align: 0 | 1): void => {
    const label = scene.add
      .text(x, top + 104, text, {
        fontFamily: FONT_MONO,
        fontSize: '10px',
        fontStyle: 'bold',
        color: COLORS.textDim,
      })
      .setOrigin(align, 0.5);
    label.setLetterSpacing(2);
    container.add(label);
  };

  // The title names the panel; this line tells the player what to do with it.
  container.add(
    scene.add
      .text(centerX, top + 60, 'READ A ROW BEFORE IT REACHES YOU', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#8fa9ba',
      })
      .setOrigin(0.5),
  );

  const growth = Math.round(WAVE_CONFIG.healthGrowthPerWave * 100);
  container.add(
    scene.add
      .text(
        centerX,
        top + 82,
        wave <= 1
          ? `BASE STATS AT WAVE 1  ·  HEALTH +${growth}% PER WAVE`
          : `WAVE ${wave} HEALTH  ·  +${growth}% PER WAVE AFTER WAVE 1`,
        { fontFamily: FONT_MONO, fontSize: '11px', color: '#5f798b' },
      )
      .setOrigin(0.5),
  );

  header(column.name, 'ENEMY', 0);
  header(column.health, 'HEALTH', 1);
  header(column.speed, 'SPEED', 1);
  header(column.damage, 'DAMAGE', 1);
  header(column.score, 'SCORE', 1);
  header(column.note, 'BEHAVIOUR', 0);

  const entries = knowYourEnemyEntries(wave);
  const byKind = new Map(entries.map((entry) => [entry.kind, entry]));

  const rows = KIND_ORDER.map((kind) => {
    const spec = ENEMY_SPECS[kind];
    const entry = byKind.get(kind);
    return {
      icon: spec.texture,
      size: 20,
      name: kind.toUpperCase(),
      health: `${entry ? entry.health : spec.health}`,
      speed: `${spec.speed}`,
      damage: `${spec.contactDamage}`,
      score: `${spec.score}`,
      note: behaviour(kind),
      color: '#c8dbe8',
    };
  });

  rows.push({
    icon: BOSS.texture,
    size: 24,
    name: 'OVERSHARD',
    health: `${bossHealth(wave)}`,
    speed: `${WAVE_CONFIG.boss.speed}`,
    damage: `${WAVE_CONFIG.boss.contactDamage}`,
    score: `${WAVE_CONFIG.boss.score}`,
    note: `boss · ${WAVE_CONFIG.boss.burstCount}-bolt bursts · +${Math.round(
      WAVE_CONFIG.boss.healthGrowthPerWave * 100,
    )}% hp per wave`,
    color: '#ffb3c1',
  });

  const cell = (x: number, y: number, text: string): Phaser.GameObjects.Text =>
    scene.add
      .text(x, y, text, { fontFamily: FONT_MONO, fontSize: '12px', color: '#c8dbe8' })
      .setOrigin(1, 0.5);

  rows.forEach((row, index) => {
    const y = top + 132 + index * 29;
    container.add([
      scene.add.image(column.icon, y, row.icon).setDisplaySize(row.size, row.size),
      scene.add
        .text(column.name, y, row.name, {
          fontFamily: FONT_MONO,
          fontSize: '12px',
          fontStyle: 'bold',
          color: row.color,
        })
        .setOrigin(0, 0.5),
      cell(column.health, y, row.health),
      cell(column.speed, y, row.speed),
      cell(column.damage, y, row.damage),
      cell(column.score, y, row.score),
      scene.add
        .text(column.note, y, row.note, { fontFamily: FONT_MONO, fontSize: '11px', color: '#7d95a6' })
        .setOrigin(0, 0.5),
    ]);
  });

  container.add(
    scene.add
      .text(
        centerX,
        top + height - 62,
        `speed in px/s  ·  clones pay x${CLONER.cloneScoreFactor}  ·  SCORE pickup x${
          PICKUPS.multiplierFactor
        } for ${PICKUPS.multiplierDurationMs / 1000}s`,
        { fontFamily: FONT_MONO, fontSize: '11px', color: '#5f798b' },
      )
      .setOrigin(0.5),
  );
}
