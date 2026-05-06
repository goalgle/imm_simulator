# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server on port 5173 (host: true, open: false)
- `npm run build` — `tsc && vite build` (full TypeScript check then bundle)
- `npm run typecheck` — `tsc --noEmit` only
- `npm run preview` — Preview the built bundle
- `npm test` — Vitest, picks up `tests/**/*.test.ts`
- Run a single test: `npx vitest run tests/domain/drives.test.ts` (or `npx vitest tests/domain/drives.test.ts -t "케이스 이름"` for a specific case)

Stack: Vite 5 + TypeScript 5 (strict, `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` on) + Phaser 3.80 (WebGL). ES2022 module target, bundler resolution.

## Architecture (the big picture)

This is a Phaser game where every cell is a **function evaluation**, not a sprite. Per-cell `Phaser.GameObjects.Graphics` redraws a polygon from `r(θ, t)` each frame. The renderer is intentionally swappable (a future SDF/fragment-shader renderer can replace `GraphicsCellRenderer` with zero changes to game logic) — keep that boundary clean.

Layered architecture, inward-pointing dependencies:

- **`src/domain/`** — pure logic, **zero Phaser imports**. Everything testable: `dna.ts` (canonical DNA + 8 species presets), `shapeFunction.ts` (`r(θ, t)` + polygon generation), `drives.ts` (8 drive evaluators + weighted vector composition), `separation.ts`, `shockwave.ts`, `contact.ts`, `color.ts` (HSL → 0xRRGGBB). Vitest covers this layer.
- **`src/entities/`** — game objects, may use Phaser. `LivingCell` is the abstract base for `WhiteCell` and `Bacteria`; it owns `vx/vy/hp/combatResponse/isAbsorbed`, corpse handling (gravity fall, gray-out, behavior freeze), and `applyAliveVisuals`. Children implement `updateAlive(t, dt, bounds)` and override `onDeath()` for cleanup. `Macrophage` deliberately does NOT extend `LivingCell` — it only interacts with corpses. `Nutrient`/`Antibody` are plain data.
- **`src/render/`** — adapter layer. `CellRenderer` is the interface; `GraphicsCellRenderer` is the current impl and composes the 3-channel `VisualState` (`shock` / `combat` / `life`) into hue/sat/light/amplitude. Game code only depends on the interface.
- **`src/systems/`** — per-frame logic across multiple entities. Each system takes virtual `t`/`dt` from `BloodScene` and mutates entities. `behaviorHelpers.applyDriveLerp` is the shared drives-evaluation + lerp helper used by both `BacteriaBehaviorSystem` and `WhiteCellBehaviorSystem`.
- **`src/scenes/BloodScene.ts`** — the single scene (장면 1, 혈관 속). Wires every system, runs the main loop, owns virtual time.

### DNA is canonical

`domain/dna.ts` defines the only DNA representation game logic uses. Every trait is a number (or an object of numbers) so virus mutations are uniform arithmetic (`dna.drives.avoidPredator.weight *= 1.3`). Adding a new species means adding a preset to `dna.ts` and (only if needed) a behavior branch in an existing system — usually no new entity class. UI hex codes and minigame segments are derived views, never authoritative.

### Virtual time

`BloodScene.gameTime` (not `this.time.now`) is the authoritative clock. Every system receives `t`/`dt` explicitly and the scene scales `dt` by `speedMultiplier` (1×/2×/4×). **Anything time-related — including the `pointerdown` shockwave handler — must read `gameTime`**, otherwise mechanics desync at higher speeds. Substepping for 8×+ is not implemented; current 4× cap is bounded by max per-frame movement vs collision radius.

### Drives + inertia (behavior model)

Behavior is the weighted sum of unit-direction vectors from each active drive (`avoidPredator`, `seekNutrient`, `seekPrey`, `seekCommander`, `avoidWorker`, `spaceAlly`, `seekAlly`, `followCommander`). The result becomes a desired velocity that's lerped via `v += (desired - v) * (1 - exp(-turnRate * dt))`. Drive weight 0 = inactive. All species share the schema; differences are values only.

### Visual feedback (3 channels)

Stimuli go into `VisualState { shock, combat, life }` and the renderer composes them: `shock` darkens + saturates + boosts amp ("self color intensifies"), `combat` lerps hue toward red ("becomes a different color"), `life=0` desaturates and freezes amplitude. Add new stimuli as new channels rather than ad-hoc render branches.

### Game-design files are authoritative

`docs/시스템_구현_기획서.md` is a long, evolving spec (sessions logged in order at the top). When making non-trivial mechanic changes, read the relevant `§` and update the doc in the same change. `docs/immune_simulator_기획서.md` is the higher-level concept doc.

## Conventions

- **Comment markers**: `// Phaser:` for things Phaser defines/requires (API surface, behaviors); `// 게임:` for project decisions/parameter choices. Used pervasively — preserve them and follow the pattern in new code.
- Korean is the primary language for comments, doc files, and commit messages. Code identifiers stay English.
- `src/domain/` must remain free of Phaser imports — this enforces the renderer-swap and unit-test guarantees. Don't import Phaser there even for types.
- Constants tuned for game balance live as `const` at the top of `BloodScene.ts` or the relevant entity/system file (e.g. `WEAK_HP_THRESHOLD` in `WhiteCell.ts`, `ANTIBODY_MAX_STOPPED` in scene). Keep them named and commented with the reason for the value.

## Working style

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style (Korean comments, `// 게임:` / `// Phaser:` markers, naming) even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that **your** changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

## Debug controls (in-scene)

`[N]` +10 neutrophils · `[B]` +10 bacteria · `[P]` pause · `[R]` restart scene · `[1]/[2]/[3]` 1× / 2× / 4× speed · `pointerdown` fires a shockwave. The scene starts in a `placing` phase where TCELL / BACTERIA_COMMANDER / BCELL are placed by clicking — simulation is paused until the queue is empty.
