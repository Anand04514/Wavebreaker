# Top-Down Shooter — Development Plan

Phaser 3 + TypeScript · Wave-survival arena shooter ("Wavebreaker")

## 1. Goal

Build a wave-survival arena shooter: you move around a map, aim with the mouse, and shoot
enemies that attack from every side. Version 1.0 is a small but polished game that anyone can
play in the browser from a link. After that you add depth (weapons, enemy types, upgrades) in
layers, so the game is always playable.

**Why this scope works:** all 2D, no complex physics, and every feature (a new weapon, enemy,
or effect) is a small, independent addition.

## 2. Tech Stack

- **Engine:** Phaser 3 with TypeScript, built with Vite
- **Physics:** Phaser Arcade Physics
- **Art:** procedural textures generated in `BootScene` (no binary assets, no licensing to track).
  Kenney's CC0 top-down packs can replace them later by swapping texture keys.
- **Audio:** synthesised with the Web Audio API in `AudioManager` (no audio files), including the
  looping menu and in-run music
- **Testing:** Vitest for pure logic (wave config, spawn positions, damage math, weapon spread,
  cover/steering maths, buffs) + manual playtesting
- **Deploy:** itch.io (HTML5 upload) or GitHub Pages (`base: './'` is already set)

## 3. Game Design

**Core loop:** survive a wave, get a short break, face a harder wave, and try to beat your high score.

**Controls:** WASD/arrows to move, mouse to aim, left click (hold) to shoot, right click to throw a
bomb, `Space` to dash toward the aim, `1`–`3` or the mouse wheel to switch weapons, `Esc` to pause,
`M` for music and `N` for sound effects, `Enter` to start or retry.

**Player:** 100 health, 260 px/s (diagonals normalised), ~950 ms of invulnerability plus a blink
after each hit. The arena is 2×2 screens (2560×1440) and the camera scrolls to follow you.

**Enemy types** (all values in `ENEMY_SPECS` / `SHOOTER` / `CLONER` / `SHOCK` / `BOMBER` / `HEALER` / `TELEPORTER`):

| Enemy | Health | Speed (px/s) | Contact damage | Score | Behavior |
| --- | --- | --- | --- | --- | --- |
| Chaser | 2 | 90 | 10 | 10 | Walks straight at the player |
| Runner | 1 | 160 | 5 | 15 | Fast and fragile, weaves toward the player |
| Tank | 8 | 55 | 20 | 30 | Slow and tough; takes only 40% of bomb damage |
| Shooter | 3 | 70 | 10 | 25 | Holds ~300 px and fires 8-damage bolts (330 px/s) |
| Shocker | 6 | 62 | 10 | 55 | Holds ~330 px and fires one 20-damage jolt every 5 s; a landed jolt jams the player's weapon for 3 s (240 px/s, its own star projectile) |
| Bomber | 3 | 140 | 0 | 35 | Lights a 640 ms fuse at point-blank range, then blasts for 33 damage inside 130 px; the warning ring previews the radius |
| Healer | 5 | 66 | 8 | 45 | Hangs back at ~360 px and pulses 3 HP into every enemy within 240 px every 1.5 s |
| Teleporter | 4 | 80 | 15 | 40 | Blinks to a fresh angle 150–240 px from the player whenever it is farther than 520 px away (re-checks every 3–6 s) |
| Cloner | 6 | 70 | 10 | 60 | Moves exactly like the shooter but never fires; every 5 s copies one of the real enemies on the field into three duplicates inside 170 px, each with a 10 s lease, a pale tint and half the score (no drops). Never copies itself, a copy, or the boss |
| Boss (every 5th wave) | 70 (+12%/wave) | 52 | 25 | 250 | Cycles four patterns: radial 8-bullet bursts (2.4 s apart), a two-stream spiral that sweeps while closing in, a telegraphed charge (620 ms windup, 380 ms lunge at 560 px/s, 700 ms recovery), and a warp that blinks it beside a distant player |

Enemies steer around cover with a greedy corner-rule (`SpawnLogic.avoidObstacles`): they probe
`NAV.lookAhead` px ahead and, when a block is in the way, aim for the padded corner nearest the
target. Kiting enemies (shooter, shocker, cloner, healer) never back into a wall — blocked
directions are deflected by ±45°/±90°/±135° (`deflectAroundCover`), and a walled-off strafe flips
sides. Runners weave only when the direct line is clear: their weave used to drive the velocity
directly, which ground them into a pillar face and left them there.

That is still not pathfinding, so a walker has a safety net. If it moves less than
`NAV.stallTravel` px in `NAV.stallWindowMs` it is wedged rather than walking, and it commits to the
direction the corner rule already chose for `NAV.slideMs` instead of re-deciding every frame; a
second stall in a row escalates to a hard step along the face (`SpawnLogic.slipAlongCover`),
alternating sides.

The watchdog measures the enemy's own displacement, not the distance it has closed on the player.
Distance-to-target looks right until the player runs: a walker sliding along a pillar face closes
almost nothing while it is making honest progress, so a distance-based rule fired every window and
each hard slide turned it back the other way — a six-wave playtest on Pillars caught chasers and a
tank hovering at a corner for seconds at a time, with the velocity reversing sign a second apart.
This matters beyond looks — one enemy that never arrives keeps its wave alive forever, because the
wave clear counts every live enemy.

**Weapons** (`src/data/weapons.json`):

| Weapon | Fire rate | Damage | Bullet speed | Notes |
| --- | --- | --- | --- | --- |
| Pistol (start) | 4 shots/s | 1 | 760 px/s | Single accurate shot |
| Shotgun | 1.3 shots/s | 0.9 × 5 pellets | 700 px/s | 0.3 rad fan: one-shots small enemies inside ~200 px, falls off past that |
| SMG | 10 shots/s | 0.5 | 840 px/s | 0.12 rad spread, best for sustained fire |

**Ordnance ranks:** once all three guns are owned, a weapon pickup becomes a permanent +15% damage
bump for the whole arsenal instead, with a 150-point bonus. Uncapped — enemy health grows every
wave (`waves.json`), so damage has to be able to grow with it.

**Pickups:** dropped by 16% of kills (bosses always drop one) and stay on the floor for four waves
(`PICKUPS.lifetimeWaves`; a full floor recycles its oldest drop). While a gun is
still locked, a weapon drop is guaranteed at least every 5 waves, however the random rolls go.

| Drop | Effect |
| --- | --- |
| Health | +25 HP, up to the current maximum |
| Max HP | +10 maximum health, permanent, no healing on top |
| Weapon | Unlock and equip the next gun, or an Ordnance rank once the arsenal is full |
| Score | ×2 score for 9 s |
| Damage | ×2 damage for 25 s |
| Shield | Full invulnerability for 10 s |
| Buddy | A tinted clone of you joins for 20 s: it holds a kiting distance from the nearest enemy and fires your pistol on the pistol's own cadence |

Timed effects are stored as "until" timestamps against the scene clock (`Buffs.ts`), so pausing
freezes them for free. Collecting a second copy of the same timed drop stacks: its full duration is
added to whatever time was left (`activateBuff`), and the banner and HUD timer show the total.

**Bombs:** a thrown sidearm, right click. Three charges, one back every 16 s, starting with one.
A throw lands up to 420 px away, fuses for 620 ms, then deals 10 damage inside 190 px. Tanks take
40%; a bomber's own blast hurts only the player, not other enemies.

**Dash:** `Space` lunges 900 px/s for 170 ms along the aim, with invulnerability for the whole
burst. Three charges, one back every 15 s, shown as pips on the HUD.

**First-run tips:** the bomb and dash are each taught once by a banner (`BOMB IN HAND`, `DASH READY`),
staggered by `COACH` in config, and remembered per tip in `localStorage` through `Storage.ts`. Using
an ability before its tip is due marks it learned, so the tip never fires.

**Know Your Enemy** (Help → `KNOW YOUR ENEMY · STATS` in the menu, or `B` mid-run): a table of every enemy's HP,
speed, contact damage, score, and what it does — the last in plain words rather than as stat strings.
Both entry points draw through the same `renderKnowYourEnemy` (`KnowYourEnemyPanel.ts`), so the two
copies can never disagree. Every cell is read from `src/config.ts` and `waves.json` — the HP column
from `knowYourEnemyEntries(wave)` (tested) — so the table cannot drift from the tuning values, and the
behaviour lines interpolate the numbers they quote (blast factor, disarm time, clone interval, heal
amount) instead of restating them by hand. The
menu copy is outside a run and shows wave-1 base HP; the `B` copy pauses the game and scales health to
the wave being fought (`scaledHealth` for enemies, `bossHealth` for the boss), so it reads as the
table of what is actually on the field.

**Maps and cover** (`src/data/maps.json`, chosen in the menu's own ARENA MAPS panel and remembered):
*Open Floor* (no cover), *Pillars* (four square blocks plus two slabs) and *The Cross*
(a plus of walls with corner blocks). Blocks are solid for the player and for enemies, absorb both
bullet groups (swept per frame, so fast shots never tunnel), and are ignored by blasts. Spawns,
drops and teleporter landings are nudged clear of them (`OBSTACLES.clearance`). A shot whose muzzle
would end up inside a block is pulled back to the wall face (`BULLET.muzzleClearance`) instead of
dying at the muzzle.

**Boss encounters:** the Overshard works through a four-step cycle instead of one repeated volley —
a radial burst to deny space, a rotating spiral that keeps the safe gap moving, a charge whose
blinking windup is the player's cue to step aside (it locks its line at release and stops against
cover), and a warp that answers kiting: when the player is more than `BOSS.warp.farRange` away it
rolls once per pass (55%) to blink to a fresh bearing 170–250 px from them. Timings live in
`BOSS.patterns` / `BOSS.spiral` / `BOSS.charge` / `BOSS.warp`, and the cycle maths is unit tested in
`tests/boss.test.ts`. The boss health bar carries a badge for the running attack
(`BOSS.phaseLabels`), so the player can read what is coming instead of guessing.

**Wave scaling:** enemies per wave = 5 + 2 × wave, enemy health +5% per wave, spawns drip in every
620 ms, and there is a 3.2 s break between waves. Bands in `src/data/waves.json` introduce the
runner at wave 2, the shooter at 4, the tank and bomber at 5, the shocker and cloner at 6 (never before, so the
early waves stay simple), the healer at 7 and the teleporter at 8, with heavier mixes again at waves
6 and 9. A boss joins every 5th wave.

## 4. Working with the agent

- This plan lives in the repo as `PLAN.md`. `AGENTS.md` states the stack, folder layout and
  "keep all tuning numbers in `config.ts`".
- **One phase = one agent task.** Give it a bounded scope, review the plan it proposes, and read the diffs.
- **Play it after every task.** Run the dev server, play for two minutes, note what feels wrong.
- Keep game rules in small pure functions (spawn positions, damage, wave composition) so they can be unit-tested.
- Make waves data-driven (`src/data/waves.json`), so balancing needs no code changes.
- Commit after each phase once it plays correctly.

**Prompt template per task:**

> Read PLAN.md. Implement Phase N, tasks N.x–N.y only. Keep tuning values in `config.ts`. Add unit
> tests for pure logic. Run the game and tests. Stop and summarize what changed when the acceptance
> criteria are met.

## 5. Repo Layout

```
top-down-shooter/
├── PLAN.md
├── AGENTS.md
├── README.md
├── index.html
├── src/
│   ├── main.ts                 # Phaser game config
│   ├── config.ts               # all tuning numbers in one place
│   ├── scenes/
│   │   ├── BootScene.ts        # procedural asset generation
│   │   ├── MenuScene.ts        # play/maps/options/help overlays, volume + music rows
│   │   ├── GameScene.ts        # main gameplay, pools, collisions, cover sweep, dash, bombs
│   │   ├── HudScene.ts         # health, score, wave, buff timers, bomb/dash meters, pause
│   │   ├── KnowYourEnemyPanel.ts # shared enemy table: menu panel and the mid-run B overlay
│   │   └── GameOverScene.ts
│   ├── entities/
│   │   ├── Player.ts
│   │   ├── Bullet.ts           # records its previous position for the cover sweep
│   │   ├── Enemy.ts            # base class + Chaser/Runner/Tank/Shooter/Shocker/Bomber/Healer/Teleporter/Cloner/Boss
│   │   ├── BattleBuddy.ts      # temporary ally clone (buddy pickup)
│   │   ├── Bomb.ts
│   │   └── Pickup.ts
│   ├── systems/
│   │   ├── WaveManager.ts
│   │   ├── WeaponSystem.ts
│   │   ├── SpawnLogic.ts       # pure functions, unit-tested (waves, spawns, cover, steering)
│   │   ├── MapLogic.ts         # layout lookup + cycling from maps.json
│   │   ├── Buffs.ts            # timed pickup effects
│   │   ├── AudioManager.ts
│   │   └── Storage.ts
│   └── data/
│       ├── waves.json
│       ├── weapons.json
│       └── maps.json
├── public/assets/              # replaces procedurally generated art later
└── tests/
    ├── spawnLogic.test.ts
    ├── waveManager.test.ts
    ├── weaponSystem.test.ts
    ├── buffs.test.ts
    ├── boss.test.ts
    ├── buddy.test.ts           # battle buddy kiting and firing rules
    ├── coach.test.ts           # first-run tip order and stagger
    └── maps.test.ts            # map selection, obstacle maths, cover sweep, dash, steering
```

## 6. Phases

### Phase 0 — Setup
- 0.1 Vite + TypeScript + Phaser; blank game window. ✅
- 0.2 Scene skeleton: Boot, Menu, Game, Hud, GameOver with transitions. ✅
- 0.3 `config.ts` and the rules file for the agent. ✅
- 0.4 Placeholder shapes for everything. ✅ (procedural shapes instead of raw placeholders)

**Done when:** `npm run dev` opens a game that moves between Menu, Game, and Game Over. ✅

### Phase 1 — Core Mechanics
- 1.1 WASD/arrow movement, normalised so diagonals aren't faster. ✅
- 1.2 Aim toward the mouse using world coordinates. ✅
- 1.3 Left-click shooting with a fire-rate limit. ✅
- 1.4 Bullet pooling, cull on lifetime/arena exit. ✅
- 1.5 Arena bounds and a fixed camera. ✅ (2×2-screen arena with a scrolling camera)

**Done when:** smooth 60 fps movement, equal diagonal speed, continuous fire without slowdown. ✅

### Phase 2 — Enemies and Combat
- 2.1 Chaser that moves toward the player. ✅
- 2.2 Health on player and enemies, bullet and contact damage. ✅
- 2.3 Bullet–enemy and enemy–player collisions, invulnerability after a hit. ✅
- 2.4 Enemy death (removal, score) and player death (game over). ✅
- 2.5 Enemy pooling and cleanup. ✅

**Done when:** kill chasers, take damage, die cleanly to Game Over. ✅

### Phase 3 — Waves and Game Loop
- 3.1 `WaveManager` reading `waves.json`. ✅
- 3.2 Spawns outside the camera view and outside a safe radius around the player. ✅
- 3.3 Between-wave pause with a wave counter. ✅
- 3.4 HUD: health bar, score, current wave. ✅
- 3.5 Game Over with final score, stored high score, restart. ✅
- 3.6 Unit tests for spawn positions and wave composition. ✅ (`tests/`)

**Done when:** a full run works and a second run behaves like the first (no leftover state). ✅

### Phase 4 — Content and Variety
- 4.1 Runner, Tank and Shooter enemies with their own projectiles. ✅ (+ Bomber, Healer, Teleporter, Cloner)
- 4.2 Pickups: health, max HP, weapon, score multiplier, damage overdrive, shield, battle buddy. ✅
- 4.3 Shotgun and SMG, switched by pickups or keys 1–3 (and the mouse wheel). ✅
- 4.4 Difficulty scaling per wave, new types over time. ✅
- 4.5 Boss every 5 waves. ✅
- 4.6 Ordnance ranks: weapon pickups keep mattering after the arsenal is full. ✅

**Done when:** waves feel different, weapons feel distinct, pickups matter. ⚠️ verified by code + tests,
needs hands-on tuning.

### Phase 5 — Polish and Game Feel
- 5.1 Real sprites and animation — replaced by generated art that reads clearly. ✅ (procedural)
- 5.2 Screen shake, hit flash, muzzle flash, impact particles, shared blast recipe. ✅
- 5.3 Death particles and floating damage numbers. ✅
- 5.4 Sound effects with a mute toggle, stored volume, synthesised music with its own toggle. ✅
- 5.5 Menu, options, maps, help and pause menu. ✅ (controls live in the pause panel and Help; no
  instructions are drawn over a running wave)
- 5.6 Readable fonts, colours, banner transitions. ✅

**Done when:** a first-time player can understand it without help. ⚠️ needs human playtesting.

### Phase 6 — Extensions (optional)
- [x] Obstacles and maps  - [ ] Upgrade choices  - [x] Dash  - [ ] Gamepad
- [ ] Co-op  - [ ] Online leaderboard  - [ ] Mobile controls  - [ ] Achievements

Add one extension at a time, keep the game playable after each.

### Phase 7 — Ship
- 7.1 Production build and test the built version. 🟡 `npm run build` passes; built copy not playtested yet.
- 7.2 Playtest with 3–5 people. ⬜
- 7.3 Fix the top issues from playtesting. ⬜
- 7.4 Upload to itch.io or GitHub Pages. ⬜
- 7.5 README with controls, how to run, stack, credits. ✅
- 7.6 Tag a release and write a devlog. ⬜

## 7. Feature Checklist

**Core**

- [x] Player movement and mouse aiming
- [x] Shooting with bullet pooling
- [x] Chaser enemies with health and collisions
- [x] Wave system
- [x] HUD, game over, restart, and high score

**Variety**

- [x] Runner, Tank, and Shooter enemies
- [x] Bomber, Healer, Teleporter, Shocker and Cloner enemies
- [x] Seven pickups (health, max HP, weapon, score, damage, shield, battle buddy)
- [x] Three weapons plus Ordnance ranks
- [x] Difficulty scaling
- [x] Boss every 5 waves

**Polish**

- [x] Art (procedural) and animation
- [x] Screen shake, hit flash, particles, damage numbers
- [x] Sound effects (synthesised), mute toggle, music toggle
- [x] Menus, options, maps, help, pause

**Extensions**

- [x] Obstacles and maps (three layouts, picked in Options)
- [ ] Upgrade choices
- [x] Dash (3 charges, 15 s recharge, aimed with SPACE)
- [x] Thrown bombs (3 charges, 16 s recharge, right click)
- [ ] Gamepad
- [ ] Co-op
- [ ] Leaderboard
- [ ] Mobile controls
- [x] Boss patterns beyond the radial burst (burst / spiral / charge / warp cycle)

## 8. Testing Plan

**Unit tests (Vitest):** wave composition from `waves.json`, spawn positions (outside the camera
view, outside the safe radius and inside the arena), damage and health math, weapon fire rates and
spreads, buff timers, obstacle maths (point/circle/segment-vs-block, swept bullets, muzzle
clipping), map selection, and the enemy steering/dash vector rules. Run with `npm test`.

**Playtest checklist, after every phase:**

- Does movement feel responsive? Is diagonal speed correct?
- Does aiming stay accurate across the whole arena?
- Can you restart three times in a row with no leftover enemies, bullets, or score?
- Does pause freeze everything, including timers and spawns?
- Do enemies route around cover instead of grinding into it, and do shots stop on walls?
- Does frame rate stay near 60 with 100+ enemies and bullets on screen?

**Performance:** active enemies are capped by `SPAWN.maxEnemiesAlive`, player bullets by
`BULLET.maxActive`, enemy bullets and pickups by `POOLS`, and bombs by `BOMB.poolSize`; all of them
are pooled. Camera shakes, the wave-1 delay and the death-to-summary pause live in `CAMERA`,
`WAVE_CONFIG.runStartDelayMs` and `COMBAT.deathDelayMs` rather than in the scene.

## 9. Common Pitfalls

- Diagonal movement being faster than straight movement. Normalise the direction vector.
- Creating and destroying objects every frame. Use pools for bullets, enemies, bombs, and particles.
- Tying movement to frame rate instead of delta time.
- Scattering tuning numbers through the code. Keep them in `config.ts` and the JSON files.
- State leaking between runs, such as timers or enemy lists not reset on restart.
- Mouse aim being wrong when the camera moves. Convert to world coordinates.
- Testing bullet-vs-wall with a single point per frame: fast shots tunnel. Sweep the segment.
- Leaving audio and polish for the last day.
- Adding extensions before v1.0 is shipped.
- Giving the agent huge tasks. Small scoped tasks, followed by playing the game, work better.

## 10. Suggested Timeline

- **Day 1:** Phase 0
- **Week 1:** Phase 1
- **Week 2:** Phase 2
- **Week 3:** Phase 3
- **Week 4:** Phase 4
- **Weeks 5–6:** Phase 5
- **Week 6:** Phase 7 (ship v1.0)
- **After v1.0:** Phase 6 extensions, one at a time

If time is tight, ship after Phase 3 as a playable prototype and continue from there.

## 11. Definition of Done

- The game is playable from a public link, with menus, pause, and restart.
- At least three enemy types, three weapons, and wave scaling work.
- It has sound, visual feedback, and in-menu help.
- Five people have playtested it, and the top issues are fixed.
- The README documents controls, setup, and asset credits.
