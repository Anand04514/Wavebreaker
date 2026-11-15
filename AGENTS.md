# Agent Rules — Wavebreaker (Top-Down Shooter)

Read `PLAN.md` before starting a task. Implement one phase at a time; do not begin the next phase
or any Phase 6 extension until the current one plays correctly.

## Stack

- Phaser 3 + TypeScript, built with Vite. Arcade Physics only.
- Vitest for unit tests. No new runtime dependencies without asking first.

## Layout

Follow the tree in `PLAN.md` §5:

- `src/config.ts` — tuning values, plus the typed JSON data it exports.
- `src/data/*.json` — waves and weapons tables.
- `src/scenes/` — Boot, Menu, Game, Hud, GameOver.
- `src/entities/` — Player, Bullet, Enemy (+ subtypes), Pickup.
- `src/systems/` — WaveManager, WeaponSystem, SpawnLogic, AudioManager, Storage.
- `tests/` — Vitest specs for pure logic.

## Hard rules

- **All tuning numbers** (speeds, health, damage, fire rates, spawn radius, wave scaling, camera
  shake, audio levels) live in `src/config.ts` or `src/data/*.json`. Never inline magic numbers.
- Game rules that can be pure functions (wave composition, spawn placement, damage/health math,
  scoring, weapon spread) go in `src/systems/SpawnLogic.ts` or `WeaponSystem.ts` and get tests.
- Use object pools for bullets, enemies and pickups (`Phaser.Physics.Arcade.Group` + `get()`).
  Never create/destroy game objects every frame.
- Movement uses delta time; normalise direction vectors so diagonals aren't faster
  (`normalizeMovement`).
- Aim converts the pointer to world coordinates (`positionToCamera`) so it survives camera changes.
- Restart must reset all state: timers, pools, enemy list, score, wave counter, multiplier, weapons.
  Scene instances are reused, so reset fields at the top of `GameScene.create()`.
- Enemies, bullets and the player never touch `localStorage` directly; go through `Storage.ts`.
- Placeholder art stays procedural in `BootScene`; swapping in real sprites only changes texture keys.
- Do not hard-code arena size; read `ARENA`.

## Definition of done for any task

- `npm run typecheck`, `npm test` and `npm run build` pass.
- The game runs in `npm run dev` and the changed feature can be observed in play.
- Summarize changed files and which acceptance criteria are met.
