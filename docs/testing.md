# 测试与验收

## 命令

```sh
npm test
npm run test:coverage
npm run lint:hot
npm run build
npm run verify:tla
npm run check
```

`npm run check` 依次运行热路径 lint、Vitest、构建和 TLC。

## 测试文件

| 文件 | 证明 |
|---|---|
| `test/sim/game.test.ts` | 初始局面、移动节拍、难度曲线、吃食物、撞墙、撞身体、追尾、反向拒绝、双键反向、暂停、满盘胜利、终点稳定、确定性、输入校验 |
| `test/sim/tick.hot.test.ts` | 每个 tick 推进时钟，到移动边界才返回 due，非 playing 不推进 |
| `test/sim/invariants.test.ts` | 每条游戏不变式都能被点名；600 次动作 fuzz；64 个种子的自动运行；位掩码和名称一致 |
| `test/sim/conformance.test.ts` | TLA+ 的 Start、Pause、Resume、Turn、Advance、AIRequest、AIError 对应到真实 reducer 和会话；AI 请求期间游戏继续移动 |
| `test/sim/observation.test.ts` | 地图边界、唯一的 `H` 和 `*`、身体数量、合法方向、提示词里的移动分析和任务 |
| `test/sim/analysis.test.ts` | 每个合法转向的撞墙/撞身、尾格释放、吃食物、可达空间、房间宽窄和食物最短路 |
| `test/engine/loop.hot.test.ts` | 固定步数、追帧上限、暂停清空累加器、步进导致停住 |
| `test/engine/loop.test.ts` | Loop 包装、注入时钟、调度和取消、帧渲染 |
| `test/engine/rng.test.ts` | 种子序列稳定、`Rng.next/int/pick` |
| `test/engine/audio.test.ts` | 事件到音效映射、静音、背景音乐循环与停止、无 AudioContext 时不崩溃 |
| `test/ai/client.test.ts` | Decisions 请求体、choice 问题、默认模型、answer 解析、refusal、非法选择、HTTP 错误不泄露 Key、abort、默认 fetch 接收者 |
| `test/ai/response.test.ts` | 兼容 JSON、代码围栏、单 action、大小写、反向截断、未知 token、超长截断、垃圾输入、理由清洗 |
| `test/ai/controller.test.ts` | mock 走真实解析、错误日志、竞态只保留最新、abort、`waitForIdle` 超时、日志上限 |
| `test/app/keyStore.test.ts` | Key 的存取、清除、不可序列化 |
| `test/app/session.test.ts` | 手动和 AI 启动、请求不暂停、慢请求死亡、一个在飞请求、暂停、停止 AI、控制台计划、错误重试、best score、不泄露 Key、致命不变式 |
| `test/app/frame.hot.test.ts` | 只在阶段、分数、长度、AI 版本或致命状态变化时通知 UI |
| `test/app/testApi.test.ts` | 控制台接口的状态拷贝、detach、步进、输入校验、观察、mock AI、暂停和重开 |

覆盖率门槛写在 `vitest.config.ts`，只统计规则、AI、循环、RNG、会话和控制台接口。Three.js 场景和 DOM 皮肤在真实浏览器里验收，不用 jsdom 假装 WebGL。

## 控制台接口

页面加载后 `window.__snake` 可用。

| 方法 | 说明 |
|---|---|
| `start({seed, ai})` | 新局，默认停掉实时时钟 |
| `restart(seed)` | 重开 |
| `attach()` / `detach()` | 回到实时时钟 / 停住模拟但保留渲染 |
| `stepTicks(n)` | 推进 n 个 1/60 秒 tick |
| `stepMoves(n)` | 推进 n 次蛇移动，最多 10000 次循环 |
| `setDirection(dir)` | 入队方向，反向会被忽略 |
| `setSnake(cells, dir)` | 替换蛇身，要求至少 3 格、在盘内、唯一、四邻连续 |
| `setFood(cell)` | 放置食物，不能放在蛇身上 |
| `setSpeed(ticks)` | 每多少 tick 移动一次，范围 1 到 60 |
| `setDifficulty(level)` | `chill`、`normal` 或 `fast`，按当前吃到数重算速度曲线 |
| `pause()` / `resume()` | 暂停 / 继续 |
| `getState()` | 返回状态副本 |
| `getObservation()` | 返回 `{map, prompt, legalMoves, view}` |
| `getPrompt()` | 当前观察文本 |
| `getInvariantReport()` | `{ok, violations}` |
| `getEvents()` | 取走并清空事件 |
| `getAiLog()` | 取走 AI 日志副本 |
| `ai.setPlan(moves)` | 注入计划，只在 AI 模式 |
| `ai.useMock(answer)` | 替换传输层，保留真实解析和方向校验 |
| `ai.clearMock()` | 恢复真实传输 |
| `ai.getStatus()` | 状态、计划长度、模型、错误 |
| `ai.waitForIdle(ms)` | 等待当前请求结束，不承诺游戏没移动 |

`start({ difficulty })` 和 `setDifficulty()` 都会改变速度曲线，但不改变规则。控制台仍然可以 `setSpeed()` 覆盖单次速度；下一次吃苹果时会按当前难度重新计算。

所有会改状态的控制台方法先 `detach`。这是为了避免测试和 `requestAnimationFrame` 同时写状态。

## 浏览器验收

1. 启动 `npm run dev -- --host 127.0.0.1`。
2. 在浏览器打开页面。
3. 在控制台运行：

```js
const source = await (await fetch('/docs/console-acceptance.js')).text();
await eval(source);
```

脚本会检查：

- 固定种子重复得到相同状态。
- tick、暂停冻结、吃食物、长度、分数、撞墙、撞身体、追尾、反向。
- 观察地图唯一的头、食物和正确身体数量，提示词包含 `MOVE ANALYSIS` 和 `TASK`。
- 一个 60ms 的慢 mock 决策下，AI 请求还在飞时蛇已经移动两次，阶段仍是 `playing`。
- 19x19 的观察地图、正方形字符格。
- 难度按钮组（顶栏和开局菜单）同步、无下拉框。
- 结束菜单有 AI 重开按钮。
- 撞墙后蛇头停在当前格，不出现回退。
- 人工移动一步后，右侧观察地图同步刷新。
- 点击手动开始后背景音乐进入运行状态。
- mock 响应经过真实的控制器和解析路径，日志里有理由。
- 输入假 Key 后，`localStorage`、`sessionStorage`、cookie、DOM 和状态视图都没有 Key。
- 不变式报告为空。

看到 `PASS` 即通过。脚本结束时会停止 AI，不保留测试 Key。

## 热路径检查

`npm run lint:hot` 扫描 5 个 `.hot.ts` 文件。它禁止对象和数组字面量、`new`、闭包、展开、模板字符串、正则、`for...of` 和常见分配型调用。`npm run build` 也会先跑它。细节见 [hot-path.md](hot-path.md)。

## Key 审计

`KeyStore` 使用真正的私有字段 `#value`，没有 `toJSON`，`JSON.stringify` 输出空对象。代码里没有把 Key 写进浏览器存储的路径。AI 日志只保存模型、方向、理由和观察文本。请求头里的 Key 不会被拼进错误消息。`test/app/session.test.ts` 和浏览器脚本都检查状态、日志、DOM 和存储里没有 Key。

## 失败路径

- Decisions API 返回 refusal、非法 choice 或非 choice 类型：控制器进入错误状态，游戏继续移动。
- 网络错误或超时：控制器进入错误状态，游戏继续移动，可以重试或手动接管。
- 请求很慢：没有计划可用，蛇继续按当前方向移动，可能撞死。这是设计。
- 浏览器直连 Decisions API 的非 2xx 响应可能被 CORS 隐藏成 `Failed to fetch`。这是没有后端时的边界。

## 重新生成 TLA+ 图表

```sh
statechart spec/SnakeFlow.tla --view spec/SnakeFlowView.ts --out /tmp/snake-flow-chart
```

把生成的 `chart.mmd` 覆盖到 `spec/SnakeFlow.mmd`。`SnakeRules` 超过 500 个状态的图表预算，所以只保留 TLC 报告。
