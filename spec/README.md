# TLA+ models

Two models check the same run from different angles. `SnakeFlow` checks the lifecycle and the AI request behavior. `SnakeRules` checks the board rules.

## SnakeFlow

`SnakeFlow.tla` models the run phase: menu, playing, paused, and over. An AI request sets `aiPending` but never changes the phase and never stops the tick. TLC checked 64 states and 172 steps. The generated chart is `SnakeFlow.mmd`.

| Invariant | Meaning |
|---|---|
| `TypeOK` | Every variable stays in its declared set. |
| `HaltFreezesTicks` | Pausing or ending the run keeps the tick at the halt value. |
| `AIPendingOnlyInAI` | Only an AI run can have a request pending. |
| `NoReverse` | The queued direction is never the reverse of the current direction. |
| `LengthAtLeastThree` | The snake never has fewer than three segments. |
| `MenuAtZero` | The menu does not advance the tick. |
| `NoDeadlock` | Every state has an enabled step. |

The `Tick` action is enabled while `aiPending` is true. That is the model's statement of the product rule: the game keeps moving while the decision API is being called. If the answer is slow, the snake can die.

## SnakeRules

`SnakeRules.tla` models a 3x3 board with at most two food pickups. TLC checked 38,707 states and found no error. The bound keeps model checking finite. The real game uses a 19x19 board, and the Vitest fuzz test covers states beyond the bound.

| Invariant | Meaning |
|---|---|
| `TypeOK` | Every variable stays in its declared type. |
| `BodyOnBoard` | Every segment is a board cell. |
| `NoOverlap` | No two segments occupy the same cell. |
| `FoodOnEmpty` | Food is null or on a cell the snake does not occupy. |
| `FoodExistsInPlay` | A playing or paused run always has food. |
| `ScoreMatchesFood` | `score = 10 * eaten`. |
| `LengthMatchesFood` | `snake.length = 3 + eaten`. |
| `NoReverse` | The next direction is not the reverse of the current direction. |
| `HaltFreezesTicks` | A paused or ended run does not advance its tick. |
| `AIPendingOnlyInAI` | A pending request belongs to an AI run. |
| `HeadIsFirst` | The body sequence has a head. |
| `MenuAtZero` | The menu does not advance the tick. |
| `NoDeadlock` | Every state has an enabled step. |

## Abstraction

- The model uses a 3x3 board and `eaten <= 2`. The game uses a 19x19 board and has no food limit.
- TLA+ `food = 0` means no food. The game uses `food = null`.
- TLA+ has one `nextDir`. The game holds a two-slot direction queue, and the runtime invariant checks every adjacent pair in `[direction, ...queue]`.
- TLA+ `aiPending` maps to a live request in the controller. `GameState.phase` remains `playing` or `paused`, never an AI thinking phase.
- The model allows one pending request at a time. The session enforces one in-flight request and starts the next only after the previous decision has been consumed by a move.
- The model does not cover network latency, failures, or rendering. The session tests cover the one-request rule and the no-pause path. The AI request and the game are separate: the request can finish or fail while the snake keeps moving.
- The chart hides self-loops and manual steering. It draws the states a reader needs: menu, playing, playing with an AI request in flight, paused, and game over.

## Run the checker

The checker needs Java 17 or later. It uses `TLA_TOOLS_JAR` when set. Otherwise it looks for the jar installed by mise.

```sh
npm run verify:tla
```

The command runs TLC for both models and exits non-zero when a rule breaks.

## Regenerate the chart

The chart comes from the `statechart` skill. Use a new output folder each run.

```sh
statechart spec/SnakeFlow.tla --view spec/SnakeFlowView.ts --out /tmp/snake-flow-chart
```

Copy the generated `chart.mmd` to `spec/SnakeFlow.mmd`. `SnakeRules` has more than the 500-state chart budget, so the command writes its report but no chart.
