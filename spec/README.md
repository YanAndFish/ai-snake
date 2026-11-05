# TLA+ 模型

`SnakeFlow` 检查游戏阶段和 AI 请求的生命周期。`SnakeRules` 检查棋盘规则。

## SnakeFlow

`SnakeFlow.tla` 的游戏阶段只有 menu、playing、paused 和 over。AI 请求使用 `aiPending` 表示，等待响应时游戏照常移动。TLC 生成 214 个状态，发现 73 个不同状态，没有发现错误。生命周期图是 `SnakeFlow.mmd`。

| 不变量 | 含义 |
|---|---|
| `TypeOK` | 每个变量都在规定的取值范围内，包含 `aiReady` 和 `readyDir`。 |
| `HaltFreezesTicks` | 暂停或结束时，tick 等于停止时记录的值。 |
| `AIPendingOnlyInAI` | 只有 AI 游戏可以等待 AI 响应。 |
| `NoReverse` | 待执行方向不是当前方向的反方向。 |
| `LengthAtLeastThree` | 蛇至少有三节。 |
| `MenuAtZero` | 菜单中的 tick 为 0。 |
| `NoDeadlock` | 每个状态都有可执行动作。 |

AI 响应和方向应用是两个动作。

- `AIRequest` 只在没有待处理请求和缓存选择时发起请求。
- `AIRespond` 清除 `aiPending`，设置 `aiReady` 和 `readyDir`。它不改变待执行方向。
- `AIApply` 表示到达匹配的执行起点。它清除缓存，并把合法方向写入 `nextDir`。
- `AIDiscard` 表示结果过期或起点不匹配。它清除缓存，方向不变。
- 暂停、死亡和重开会清除请求和缓存。恢复或开始 AI 游戏后，由 `AIRequest` 发起请求。

`aiPending` 或 `aiReady` 为 true 时，`Tick` 都可以执行。响应过慢时蛇可能死亡。

## SnakeRules

`SnakeRules.tla` 使用 3×3 棋盘，最多吃两个食物。TLC 检查了 38,707 个不同状态，没有发现错误。这个限制让模型检查能够结束。实际游戏使用 19×19 棋盘，Vitest 随机测试覆盖模型范围以外的状态。

| 不变量 | 含义 |
|---|---|
| `TypeOK` | 每个变量都符合规定的类型。 |
| `BodyOnBoard` | 每一节蛇身都位于棋盘内。 |
| `NoOverlap` | 两节蛇身不会占据同一个格子。 |
| `FoodOnEmpty` | 食物为空，或位于蛇身以外的格子。 |
| `FoodExistsInPlay` | 游戏进行中和暂停时都有食物。 |
| `ScoreMatchesFood` | `score = 10 * eaten`。 |
| `LengthMatchesFood` | `snake.length = 3 + eaten`。 |
| `NoReverse` | 待执行方向不是当前方向的反方向。 |
| `HaltFreezesTicks` | 暂停或结束时 tick 不增加。 |
| `AIPendingOnlyInAI` | 等待响应的请求属于 AI 游戏。 |
| `HeadIsFirst` | 蛇身序列中存在蛇头。 |
| `MenuAtZero` | 菜单中的 tick 为 0。 |
| `NoDeadlock` | 每个状态都有可执行动作。 |

## 模型的范围

- `SnakeRules` 使用 3×3 棋盘和 `eaten <= 2`。实际游戏使用 19×19 棋盘，食物数量没有上限。
- TLA+ 的 `food = 0` 表示没有食物。游戏中用 `food = null` 表示。
- TLA+ 只有一个 `nextDir`。游戏使用最多两个方向的队列，运行时不变量检查 `[direction, ...queue]` 中每对相邻方向。
- `SnakeFlow` 的 `aiPending` 对应正在进行的请求。`aiReady` 对应已收到、等待未来起点的选择，它不会增加新的游戏阶段。
- 模型只覆盖网络请求分支。唯一安全候选在本地确定的分支没有单独建模。
- `AIRespondR` 只枚举 R 方向，用于检查生命周期。`AIApply` 把起点已到达且匹配抽象为一个动作。模型没有保存路线、蛇身或未来起点，不能证明精确执行时间或候选路线安全性。
- 迟到响应在模型中可用 `AIRespond` 后接 `AIDiscard` 表示。实际会话会直接丢弃迟到响应，随后可以准备新请求。
- 会话同时最多有一个请求。缓存选择等待起点时也不发新请求。安装路线后，可以为下一个起点准备选择。
- `test/sim/conformance.test.ts` 通过真实会话检查早到缓存、前缀终点应用、迟到丢弃，以及暂停清理请求和缓存。
- 图省略同一节点内的移动，只画菜单、游戏中、等待响应、等待执行起点、暂停和结束。

## 运行检查

检查需要 Java 17 或以上版本。脚本优先读取 `TLA_TOOLS_JAR`，然后查找 `spec/tla2tools.jar` 和 mise 安装的 jar。

```sh
npm run verify:tla
```

命令会对两个模型运行 TLC。任何规则检查失败时，命令以非零状态退出。

## 更新状态图

`SnakeFlow.mmd` 根据模型和 `SnakeFlowView.ts` 手工同步。本次没有运行 statechart 生成器。安装了 statechart 时，可以使用新的输出目录重新生成。

```sh
statechart spec/SnakeFlow.tla --view spec/SnakeFlowView.ts --out /tmp/snake-flow-chart
```

将生成的 `chart.mmd` 复制到 `spec/SnakeFlow.mmd`。`SnakeRules` 超过 500 个状态的绘图上限，生成器只输出报告。
