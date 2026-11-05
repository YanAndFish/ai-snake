# AGENTS.md

Single npm package: Vite + TypeScript + Three.js 2.5D snake game. `index.html` is the app shell; `src/main.ts` wires the session, fixed-step loop, renderer, audio, input, and plain-DOM UI. No framework, backend, workspace, or CI. Design details are in `docs/architecture.md`, `docs/testing.md`, `docs/hot-path.md`, and `spec/README.md` (Chinese).

## Commands

- `npm install`, then `npm run dev` — dev server at `http://127.0.0.1:5173` (host is pinned in `vite.config.ts`).
- `npm test` — all Vitest tests (`test/**/*.test.ts`, node environment). Single file: `npx vitest run test/sim/game.test.ts`; single case: add `-t "name"`.
- `npm run test:coverage` — enforces 85% statements/lines/functions and 80% branches on selected simulation/AI/loop/session files; `render/` and `ui/` are excluded.
- `npm run build` — `tsc --noEmit && npm run lint:hot && vite build`; there is no separate typecheck script.
- `npm run lint:hot` — allocation lint for `*.hot.ts`.
- `npm run verify:tla` — runs TLC for both models; requires Java 17+ and `tla2tools.jar` via `TLA_TOOLS_JAR`, `spec/tla2tools.jar`, or the mise path searched by `scripts/verify-tla.mjs`.
- `npm run check` — `lint:hot` → `test` → `build` → `verify:tla`. No CI or pre-commit config exists; this is the gate.

## Architecture

- `GameState` in `src/sim/types.ts` is the single source of truth. Rules live in `src/sim/game.ts`; lifecycle, AI requests, and console semantics live in `src/app/session.ts`.
- Fixed 60 Hz loop. Each tick only advances the clock and runs bitmask invariants; `advanceMove` runs at move boundaries (one move every 4–13 ticks depending on difficulty/eaten). Do not run movement or observation/UI work every frame.
- `advanceClockHot` mutates clock fields in place; `advanceMove` returns `{state, events}`. Account for that when snapshotting or testing.
- Score and length are derived, never separately maintained: `score = 10 * eaten`, `snake.length = 3 + eaten`. Runtime invariants run every tick and after session mutations, including production builds; a violation freezes the session and throws `InvariantError`.
- Directions are `direction` plus a max-2 queue. Reversals and duplicates are ignored; one queued direction is consumed per move.
- Phases are only `menu | playing | paused | over`. AI “thinking” is not a phase: it is `control: "ai"` plus controller state. The simulation must never pause for AI; at most one request is in flight, and a slow response can kill the snake by design.
- Keep simulation deterministic: use `src/engine/rng.ts`; avoid `Math.random`, wall-clock time, or DOM reads in `src/sim`.

## Hot Path (`*.hot.ts`)

- Current hot files: `src/engine/loop.hot.ts`, `src/sim/tick.hot.ts`, `src/sim/invariants.hot.ts`, `src/app/frame.hot.ts`, `src/render/scene.hot.ts`.
- `npm run lint:hot` runs in `build` and bans object/array literals, `new`, arrow/function closures, template strings, spread, regex, `for...of`, and allocating calls such as `map`, `filter`, `slice`, `push`, `Object.keys`, `JSON.parse/stringify`, and `structuredClone`. Keep edits allocation-free.
- `scripts/lint-hot.mjs` deliberately imports the `typescript5` alias; TypeScript 7’s root package no longer exposes the compiler API. Do not “simplify” that import.
- Snapshotting (`viewState`), observation text, and DOM updates belong on state changes, not in the frame or tick loop.

## AI and Secrets

- The browser calls the Decisions API directly; `DEFAULT_MODEL` and `OPENAI_ENDPOINT` are in `src/config.ts`. There is no proxy.
- The API key is memory-only in `KeyStore.#value`. Never write it to localStorage/sessionStorage/IndexedDB, cookies, URLs, or logs, and never include it in error messages. `snake-best` in localStorage is the only persisted game value.
- Exercise the AI path without a key with `__snake.ai.useMock(...)` or a controller mock; it still goes through the real parser and direction validation.
- `window.__snake` is the console test API (`src/app/testApi.ts`). Its mutating methods call `detach()` so the rAF loop stops competing with scripted steps; call `attach()` to resume real time.

## Invariants and TLA+

- Runtime invariant names in `src/sim/invariants.ts` are kept aligned with `spec/SnakeFlow.tla` and `spec/SnakeRules.tla`; `test/sim/conformance.test.ts` maps TLA+ actions to the real reducers/session.
- Adding or changing an invariant requires `src/sim/invariants.hot.ts` (bit and check), `src/sim/invariants.ts` (name/bit order), the relevant `.tla` spec, and conformance tests.
- `SnakeFlow` covers lifecycle and pending AI requests; `SnakeRules` is a bounded 3×3 abstraction, not the real 19×19 board.

## Testing and UI

- Tests live under `test/`, mirroring `src/` (`test/sim/game.test.ts` covers `src/sim/game.ts`). Keep new tests out of `src/`; Vitest only includes `test/**/*.test.ts`.
- Vitest is node-only; `src/render` and `src/ui` have no unit tests. Do not fake WebGL with jsdom—verify visuals and DOM behavior in a real browser.
- Browser acceptance: run `npm run dev`, open the page, then in the console run `const source = await (await fetch('/docs/console-acceptance.js')).text(); await eval(source);`. Expect `PASS`.
- UI is plain DOM: markup in `index.html`, bindings/updates in `src/ui/dom.ts`, styles in `src/styles.css`. New controls usually require changes in all three plus `src/main.ts`.
- `dist/`, `coverage/`, and `states/` are generated/ignored output; do not edit them.
