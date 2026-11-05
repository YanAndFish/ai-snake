# 测试与检查

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

当前完整检查包含 178 个测试，`npm run check` 和 `npm run test:coverage` 均通过。路线方案的实验数据见 [AI 延迟评估](ai-latency.md)，这些结果不代表当前方向控制效果。真实网络运行步骤见 [比较真实模型的得分和存活时间](evaluate-live.md)。

## 测试文件

| 文件 | 证明 |
|---|---|
| `test/sim/game.test.ts` | 初始局面、移动节拍、难度曲线、吃食物、撞墙、撞身体、追尾、反向拒绝、双键反向、暂停、满盘胜利、终点稳定、确定性、输入校验 |
| `test/sim/tick.hot.test.ts` | 每个 tick 推进时钟，到移动边界才返回 due，非 playing 不推进 |
| `test/sim/invariants.test.ts` | 每条游戏不变式都能被点名；600 次动作 fuzz；64 个种子的自动运行；位掩码和名称一致 |
| `test/sim/conformance.test.ts` | TLA+ 的 Start、Pause、Resume、Turn、Advance、AIRequest、AIError 对应到真实 reducer 和会话；AI 请求期间游戏继续移动 |
| `test/sim/observation.test.ts` | 棋盘尺寸和关键坐标、合法方向、提示词里的移动分析和任务；确认不生成文本地图 |
| `test/sim/analysis.test.ts` | 每个合法转向的撞墙/撞身、尾格释放、吃食物、可达空间、房间宽窄和食物最短路 |
| `test/engine/loop.hot.test.ts` | 固定步数、追帧上限、暂停清空累加器、步进导致停住 |
| `test/engine/loop.test.ts` | Loop 包装、注入时钟、调度和取消、帧渲染 |
| `test/engine/rng.test.ts` | 种子序列稳定、`Rng.next/int/pick` |
| `test/engine/input.test.ts` | 摇杆四向转向、14px 判定距离、中心区域忽略小幅移动、对角线附近保持方向轴、明显转向时切换方向轴、浮动摇杆的半径跟随、偏移限制与圆弧换轴 |
| `test/engine/audio.test.ts` | 事件到音效映射、静音、背景音乐循环与停止、无 AudioContext 时不崩溃 |
| `test/ai/client.test.ts` | Decisions 请求体、choice 问题、默认模型、answer 解析、refusal、非法选择、HTTP 错误不泄露 Key、abort、默认 fetch 接收者 |
| `test/ai/response.test.ts` | 兼容 JSON、代码围栏、单 action、大小写、反向截断、未知 token、超长截断、垃圾输入、理由清洗 |
| `test/ai/controller.test.ts` | mock 走真实解析、错误日志、竞态只保留最新、abort、`waitForIdle` 超时、日志上限 |
| `test/ai/context.test.ts` | 延迟分位数、当前移动进度、入队转向、等待期间变速、冷启动场景、食物进度、循环检测和状态只读性 |
| `test/app/keyStore.test.ts` | Key 的存取、清除、不可序列化 |
| `test/app/session.test.ts` | 手动和 AI 启动、挂起请求时按当前方向移动、一个在飞请求、暂停、停止 AI、控制台计划、错误重试、AI 固定速度、best score、Key 隐藏和致命不变式 |
| `test/app/directionSession.test.ts` | 当前棋盘请求、下一步执行方向、危险方向执行、唯一安全方向也请求 AI、失败重试、暂停取消和移动来源计数 |
| `test/app/frame.hot.test.ts` | 只在阶段、分数、长度、AI 版本或致命状态变化时通知 UI |
| `test/app/testApi.test.ts` | 控制台接口的状态拷贝、detach、步进、输入校验、观察、mock AI、暂停和重开 |

覆盖率门槛写在 `vitest.config.ts`，只统计规则、AI、循环、RNG、会话和控制台接口。Three.js 场景和 DOM 在真实浏览器里检查。

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
| `setDifficulty(level)` | `chill`、`normal` 或 `fast`，手动模式按吃食物数量重算速度，AI 使用基础速度 |
| `pause()` / `resume()` | 暂停 / 继续 |
| `getState()` | 返回状态副本 |
| `getObservation()` | 返回当前棋盘的 `{prompt, legalMoves, choiceDescriptions, view}` |
| `getPrompt()` | 当前棋盘的 `SNAKE/2` 分析文本 |
| `getInvariantReport()` | `{ok, violations}` |
| `getEvents()` | 取走并清空事件 |
| `getAiLog()` | 取走 AI 日志副本 |
| `ai.setPlan(moves)` | 注入计划，只在 AI 模式 |
| `ai.useMock(answer)` | 替换传输层，保留真实解析和方向校验 |
| `ai.clearMock()` | 恢复真实传输 |
| `ai.getStatus()` | 状态、计划长度、模型、错误 |
| `ai.getExecutionStats()` | 本局请求结果、AI 方向输入、没有新输入时的移动和脚本移动计数 |
| `ai.waitForIdle(ms)` | 等待当前请求结束，超时只结束等待 |

手动模式每吃 6 个苹果，移动间隔减少 1 tick，直到当前难度的最短间隔。AI 模式吃苹果时保持当前速度。`start({ difficulty })` 使用所选难度的基础速度。`setDifficulty()` 在手动模式下按吃食物数量重算速度，在 AI 模式下使用基础速度。

`setSpeed()` 可以覆盖当前移动间隔。手动模式下一次吃苹果时按难度重算速度。AI 模式会保留设置的速度，直到切换难度或重新开局。

所有会改状态的控制台方法先 `detach`。这是为了避免测试和 `requestAnimationFrame` 同时写状态。

`getPrompt()` 和 `getObservation()` 与真实请求共用当前棋盘分析。`ai.waitForIdle()` 结束表示当前请求已结束，成功响应在下一次移动执行。用 `ai.getExecutionStats()` 检查实际执行来源。

## 浏览器检查

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
- 提示词包含棋盘尺寸、头/食物坐标、`MOVE ANALYSIS`、`DELAY`、`HIST`、`SCEN` 和 `TASK`，且不包含文本地图。
- 一个 60ms 的慢 mock 决策下，AI 请求还在飞时蛇已经移动两次，阶段仍是 `playing`。
- 页面没有 `#observation` 观察地图节点。
- 难度按钮组（顶栏和开局菜单）同步、无下拉框。
- 结束菜单有 AI 重开按钮。
- 撞墙后蛇头停在当前格，不出现回退。
- 点击手动开始后背景音乐进入运行状态。
- mock 响应经过真实的控制器和解析路径，内部记录保留理由和耗时，界面只显示方向和耗时。
- AI 面板用大号数字显示最近耗时并附 P50/P90，最新决策记录排在顶部。
- AI 控制台可以关闭并重开；桌面端关闭后舞台变宽，相机宽高比与画布一致。
- 连续蛇身的顶点坐标有效，替换同一蛇头位置的身体后立即显示新形状。
- 蛇头与身体使用同一俯视平面，四个方向都能辨认眼睛和舌头。
- 蛇身阴影覆盖整条身体，投影方向与食物一致。
- 输入假 Key 后，`localStorage`、`sessionStorage`、cookie、DOM 和状态视图都没有 Key。
- 不变式报告为空。

看到 `PASS` 即通过。脚本结束时会停止 AI，不保留测试 Key。

## 移动端检查

在浏览器设备工具栏依次检查 320x568、390x844、844x390 和 768x1024。

- 菜单卡片完整，内容超高时在遮罩内滚动，开始按钮可达。
- 手动游戏中，按下不拖动时摇杆隐藏。按住拖动超过 6px 后摇杆出现，松手后隐藏。
- 拖动过程中转向立即入队。方向由摇杆中心到手指的角度决定，中心 14px 内不产生方向，换轴保留 1.25 倍迟滞。手指超出 36px 半径后中心跟随手指，手柄始终位于手指处，沿圆弧滑动时方向平滑切换。
- 暂停、触摸取消、切到后台后摇杆隐藏。AI 模式和菜单中拖动画布时摇杆隐藏。
- 点击 HUD 按钮和输入框不会显示摇杆或触发转向。
- 视口宽度不超过 900px 时，画布缓冲区按设备像素比绘制，像素比上限为 2。用高密度手机屏幕检查蛇身边缘和草地颗粒。
- AI 控制台在竖屏从底部打开、横屏从右侧打开，关闭按钮可触达；关闭后画布占满视口。
- 旋转设备或拖动窗口后棋盘不被拉伸，控制台开合后相机宽高比仍与画布一致。

## 热路径检查

`npm run lint:hot` 扫描 5 个 `.hot.ts` 文件。它禁止对象和数组字面量、`new`、闭包、展开、模板字符串、正则、`for...of` 和常见分配型调用。`npm run build` 也会先跑它。细节见 [hot-path.md](hot-path.md)。

## Key 审计

`KeyStore` 使用真正的私有字段 `#value`，没有 `toJSON`，`JSON.stringify` 输出空对象。代码里没有把 Key 写进浏览器存储的路径。AI 日志只保存模型、方向、理由和错误。请求头里的 Key 不会被拼进错误消息。`test/app/session.test.ts` 和浏览器脚本都检查状态、日志、DOM 和存储里没有 Key。

## 失败路径

- Decisions API 返回 refusal、非法 choice 或非 choice 类型时，控制器显示错误。会话至少等待 60 tick，再在移动边界重试。
- 响应到达后从实际位置执行方向。等待期间蛇沿当前方向移动，可能在响应到达前碰撞。
- 请求挂起时没有自动超时。暂停或停止 AI 会取消请求。`ai.waitForIdle(ms)` 超时只结束调用方的等待。
- AI 返回多个方向时拒绝整份响应。AI 选择危险方向时按游戏规则碰撞结束。
- 浏览器直连 Decisions API 的非 2xx 响应可能被 CORS 隐藏成 `Failed to fetch`。这是没有后端时的边界。

## 重新生成 TLA+ 图表

```sh
statechart spec/SnakeFlow.tla --view spec/SnakeFlowView.ts --out /tmp/snake-flow-chart
```

把生成的 `chart.mmd` 覆盖到 `spec/SnakeFlow.mmd`。`SnakeRules` 超过 500 个状态的图表上限，所以只保留 TLC 报告。

## 运行无头浏览器检查

安装系统 Chrome 后运行以下命令。脚本自动启动独立端口的 Vite，并在结束时关闭自己创建的服务和浏览器。

```sh
npm run test:browser
npm run test:browser -- --output /tmp/ai-snake-browser.json
```

命令执行 `docs/console-acceptance.js`，成功时打印 `PASS`。断言失败、页面异常、资源加载失败或站外 HTTP 请求都会让命令以非零状态退出。脚本只使用测试占位文本启用 AI。

复用已有服务或指定 Chrome 可执行文件时，运行以下命令。

```sh
npm run test:browser -- --origin http://127.0.0.1:5173
npm run test:browser -- --executable /path/to/chrome
```

## 比较真实 API 的得分与存活

`npm run eval:live` 使用 Chrome 原生 fetch、真实 Decisions API 和生产解析器。每局按真实 rAF 推进。复现命令和字段解释见 [真实评估脚本](evaluate-live.md)，正式配对结果见 [AI 延迟评估](ai-latency.md)。

真实 API 与下面两类模拟使用独立结果文件。`--self-check` 只检查运行脚本，不计入真实模型比较。

## 用真实时钟模拟响应延迟

以下命令在独立浏览器 context 中并行运行四个六秒场景。注入的响应延迟分别为 0、250、600 和 1200 毫秒。

```sh
node scripts/evaluate-browser.mjs --output /tmp/ai-snake-evaluation.json
node scripts/evaluate-browser.mjs --origin http://127.0.0.1:5173 --scenarios /tmp/scenarios.json --concurrency 4 --output /tmp/ai-snake-evaluation.json
```

场景文件是 JSON 数组。例如以下两个场景使用相同种子和十秒得分窗口。

```json
[
  { "name": "固定延迟", "seed": 83, "delayMs": 600, "durationMs": 10000, "difficulty": "normal", "policy": "first" },
  { "name": "抖动延迟", "seed": 83, "delayMs": [250, 600, 1200], "durationMs": 10000, "difficulty": "normal", "policy": "first" }
]
```

`policy: "first"` 选择请求中的第一个候选项。路线候选下，`greedy` 按公开描述中的吃食步数和食物距离变化排序。单格候选下，`greedy` 按请求时的棋盘选择安全邻格，再比较食物距离。`straight` 优先选择当前方向。它们都是确定性的假响应，结果不代表真实模型效果。

实验使用生产传输层和解析器。游戏由真实 `requestAnimationFrame` 推进。站外 HTTP 请求会被阻止。每个场景在配置的窗口结束后读取得分，死亡后也会等待到窗口结束。

JSON 结果包含得分、吃食数、存活毫秒数、tick、移动数、请求和解析数量、请求最大并发、取消次数、页面错误和游戏约束报告。完整文件还包含采样和每次请求的实际延迟。死亡时间每 25 毫秒采样一次，`maxSampleGapMs` 给出本轮最大的采样间隔。

`passed` 表示运行、时钟和错误检查通过。完整链路检查还需确认 `parsedResponseCount > 0`，并在页面通过 `__snake.ai.getExecutionStats().apiMoves > 0` 确认 AI 方向输入已执行。得分窗口短于首个响应延迟时，零解析也可以是有效的延迟样本。

`clockRatio` 是存活期间实际 tick 与墙钟预期 60 Hz tick 的比值。比值超出 0.9 到 1.1、采样间隔超过 250 毫秒或窗口超时超过 5% 时，`clockHealthy` 为 false，命令以非零状态退出。此类结果需要降低并发后重跑，不能用慢时钟下的存活时间判断方案更好。

两个脚本都支持 `SNAKE_ORIGIN`、`CHROME_EXECUTABLE` 和 `SNAKE_OUTPUT`。比较方案时，对相同种子、难度和延迟序列做多次配对运行，同时比较固定窗口得分与死亡比例。

## 用虚拟时钟模拟完整会话

运行以下命令，在独立 worker 中并行执行真实 `GameSession`、`AiController`、`DecisionsTransport` 和解析器。所有网络响应由内存中的假 fetch 提供。

```sh
npm run eval:ai -- --output /tmp/ai-snake-main.json
npm run eval:ai -- --holdout --output /tmp/ai-snake-holdout.json
npm run eval:ai -- --root /path/to/baseline --output /tmp/ai-snake-baseline.json
npm run eval:ai -- --seeds 2 --ticks 600 --concurrency 4 --output /tmp/ai-snake-smoke.json
```

主矩阵使用种子 1 至 12、`normal` 和 `fast`，每局固定推进 3600 tick。响应延迟依次为 100、600、1200 毫秒，以及循环序列 `[100,300,1200,600]`。`--holdout` 使用种子 101 至 112，延迟改为 240、900、1800 毫秒，以及 `[100,100,300,100,1800,100,900,3600]`。

延迟按 60 Hz 向上取整到 tick。`performance.now()` 使用同一虚拟时钟，已完成响应的耗时会进入真实的延迟采样。脚本在每个 tick 排空 Promise 队列，尚未到达的响应不会阻止游戏推进。死亡后保留分数，计分窗口照常走完。

默认同时运行 `food` 和 `first` 选择器。`first` 选第一个候选。`food` 优先选择更早吃到已知食物的路线，其次比较候选公开描述中的食物距离变化。单格基线使用请求时的真实移动函数和曼哈顿距离。两者只用于比较调度机制，结果不代表真实模型效果。用 `--selectors food` 或 `--selectors first` 可以缩小范围。

JSON 包含 `metadata`、分组 `summary` 和每局 `raw`。每局记录得分、吃食数、阶段、存活 tick、移动数、请求数、响应数、最大并发、API 移动、本地移动、过期响应、错误和不变式报告。请求格式错误、并发超过 1、移动计数不符、解析错误或不变式失败都会让命令以非零状态退出。`--help` 列出全部选项。

`ok` 表示运行约束通过。验证响应确实影响移动时，还需检查 `completed > 0` 和 `apiMoves > 0`。完整主矩阵与独立矩阵的可移植汇总见 [ai-latency-results.json](ai-latency-results.json)。
