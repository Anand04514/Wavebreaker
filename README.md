# Wavebreaker

A wave-survival arena shooter built with Phaser 3 + TypeScript. You are a lone gunner in a closed
arena: enemies close in from every edge, waves keep getting heavier, and the only goal is to beat
your own high score.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the built game
npm test         # Vitest unit tests for the pure game logic
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrow keys | Move (diagonals are normalised) |
| Mouse | Aim |
| Left click (hold) | Shoot |
| Right click | Throw a bomb |
| B | Know Your Enemy — enemy stats for the wave you are on (pauses the run) |
| `Space` | Dash in the direction you are aiming |
| `1` `2` `3` / mouse wheel | Switch to an unlocked weapon |
| `Esc` | Pause / resume |
| `M` | Music on / off |
| `N` or the HUD **SOUND** button | Sound effects on / off (music keeps its own switch) |
| `Enter` | Start, or retry from the game-over screen |

First run only, the game teaches the two abilities as they come into your hands: `BOMB IN HAND`
(right click throws it at your cursor) and `DASH READY` (space bursts toward your aim, and you take
no damage while dashing). Each tip shows once and is remembered in `localStorage`; using an ability
before its tip appears cancels that tip too.

## Game rules

- **Player:** 100 health, ~1 s of invulnerability and a blink after each hit. The arena is two
  screens square, so the camera scrolls to follow you.
- **Enemies** (contact damage in brackets):
  - *Chaser* — walks straight at you (10).
  - *Runner* — fast, fragile, weaves in (5).
  - *Tank* — slow and armoured, and a bomb only chips it for 40% (20).
  - *Shooter* — holds ~300 px of range and fires 8-damage bolts (10).
  - *Shocker* — keeps the shooter's range but fires one heavy jolt every 5 s. A hit deals 20
    damage and jams your gun for 3 s: no shooting, though moving, dashing and bombs still work.
    Its projectile is a yellow spiked star, not a round bolt, so you can tell what is inbound (10).
  - *Bomber* — no contact damage at all: it lights a 640 ms fuse at point-blank range, then
    detonates for 33 damage inside 130 px, with a warning ring that previews the blast.
  - *Healer* — hangs back and pulses 3 HP into every enemy within 240 px every 1.5 s (8).
  - *Teleporter* — blinks to a fresh angle 150–240 px from you whenever you pull more than 520 px
    away (it re-checks every 3–6 s), so kiting it across the arena does not work (15, 4 HP).
  - *Cloner* — walks and holds range exactly like a shooter, but never fires: every 5 s it copies
    one of the real enemies standing on the field three times over, dropping the duplicates into the
    space around itself (10, 6 HP). A copy is a real enemy for its whole life — a copied bomber
    still fuses, a copied healer still heals — but it is tinted pale, lives 10 s, pays half the
    score of the enemy it was copied from and never drops a pickup. It cannot copy itself, another
    cloner, the boss, or an existing copy, so a squad never compounds into itself. It joins the
    waves at 6.
  - *Overshard* — a boss every 5th wave: 70 HP plus 12% per wave, 25 contact damage, and four
    rotating attacks. It cycles a radial burst (two 8-bullet rings), a spiral (two streams sweeping
    around while it closes in), a charge (a blinking 620 ms windup, a fast lunge along a locked
    line, then a recovery window to punish it) and a warp (when you are more than 620 px away it
    may blink in beside you instead of walking, so kiting cannot stall the fight). The charge stops
    dead against cover. The boss health bar names the attack that is running (`BURST`, `SPIRAL`,
    `CHARGE`, `WARP`) so its colour and label give away the next thing to dodge.
- **Weapons:** Pistol (4 shots/s, 1 damage), Shotgun (1.3 shots/s, 5 pellets of 0.9 in a tight
  0.3 rad fan) and SMG (10 shots/s, 0.5 damage with slight spread). A weapon pickup unlocks and
  equips the next gun.
- **Ordnance ranks:** once all three guns are owned, a weapon pickup becomes a permanent +15%
  damage bump *for the whole arsenal* on top of its 150-point bonus. Ranks are uncapped, so
  firepower keeps pace with enemy health as the waves climb.
- **Dash:** `Space` lunges you 170 ms at 900 px/s along your aim, with invulnerability for the
  whole burst. Three charges, one back every 15 s (HUD pips under the arena on the left).
- **Bombs:** the right-click sidearm holds three charges, regenerating one per 16 s and starting
  with one. A throw lands up to 420 px away, fuses for 620 ms, then deals 10 damage inside 190 px.
  Tanks take 40% of that; a bomber's own blast hurts only you, not other enemies.
- **Pickups:** dropped by 16% of kills — bosses always drop one — and stay on the floor for
  4 waves, so an ignored drop is still there after the next few fights:

| Drop | Effect |
| --- | --- |
| Health | +25 HP, up to your current maximum |
| Max HP | +10 maximum health, permanent, with no healing on top |
| Weapon | unlock and equip the next gun, or an Ordnance rank when the arsenal is full |
| Score | ×2 score for 9 s |
| Damage | ×2 damage for 25 s |
| Shield | invulnerable for 10 s |
| Buddy | a pale-tinted clone of you fights alongside for 20 s |

While a gun is still locked, a weapon pickup is guaranteed at least every 5 waves, and that counter
only resets when a drop is actually collected.

The timed drops **stack**: collecting a second Damage, Score, Shield or Buddy pickup while one is
running adds its full duration to the time left instead of resetting the clock, so a lucky run of
drops can hold a buff for a long time. A second Buddy drop never stacks a second clone — it tops up
the lease on the one already beside you.

- **Battle buddy:** the ally drop summons a tinted clone of you for 20 s. It carries your pistol
  (same 4 shots/s, same damage, ordnance ranks and overdrive included), keeps ~260 px of distance
  from the nearest enemy, and otherwise trails you at ~90 px. It has no health and nothing targets
  it, so it is free firepower rather than a second life.

- **Maps:** three arena layouts — *Open Floor* (no cover), *Pillars* (four blocks) and *The Cross*
  (a plus-shaped set of walls) — picked in the **Maps** panel on the main menu and remembered
  between runs. Blocks
  stop you and the enemies and absorb bullets, so they are cover for both sides. Enemy spawns,
  pickups and teleporter landings are always nudged clear of the blocks.
- **Waves:** enemies per wave = 5 + 2 × wave, enemy health +5% per wave, and a 3.2 s break between
  waves. New types join at waves 2 (runner), 4 (shooter), 5 (tank, bomber), 6 (shocker, cloner), 7
  (healer) and 8 (teleporter); the mix gets heavier again at waves 6 and 9. The shocker and the
  cloner are both held back until after wave 5, so the early waves stay a straight fight.
- **Scoring:** each kill scores its base value (10–60, boss 250) times your current multiplier, and
  clearing a wave pays 50 + 10 × wave. A cloner's copies pay half, and their ten-second lease means
  a cloner left alone is a score tap as well as a threat.
- **High score** is stored in `localStorage`; clearing storage resets it.

## Tech

- **Phaser 3.90** with Arcade Physics, **TypeScript** in strict mode, **Vite** for dev/build,
  **Vitest** for unit tests.
- All tuning values live in `src/config.ts`; wave and weapon tables live in `src/data/*.json`.
- Pure game rules (wave composition, spawn placement, damage, scoring, weapon spread) live in
  `src/systems/SpawnLogic.ts` and `src/systems/WeaponSystem.ts` and are covered by `tests/`.
- Bullets, enemies and pickups are pooled, and the HUD's meters and score only redraw when their
  values change, so a steady frame creates no scene objects.
- The built bundle uses a relative `base`, so `dist/` can be uploaded to itch.io or served from a
  GitHub Pages subpath as-is.

## Asset credits

The game ships with **no third-party art or audio assets**:

- Every sprite and effect texture is generated procedurally with Phaser `Graphics` in
  `src/scenes/BootScene.ts`.
- Every sound effect, and the slow background music that plays under the menu and the run, is
  synthesised at runtime with the Web Audio API in `src/systems/AudioManager.ts` — no audio files.
  Effects and music have independent switches — the **SOUND** and **MUSIC** buttons in the menu
  corner, the matching rows in the Options panel, and the same two switches on the pause panel.

If you replace the generated art with a pack (for example Kenney's CC0 top-down shooter packs),
credit the pack and its license here, and keep the texture keys used in `BootScene` so the rest of
the code keeps working.

## Project docs

- `PLAN.md` — the phase-by-phase development plan and feature checklist.
- `AGENTS.md` — conventions and rules for an agent working on the repo.
