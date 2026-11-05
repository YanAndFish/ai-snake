# PIXEL SERPENT

明亮 2.5D 像素贪吃蛇。固定 60Hz 模拟，Three.js 低分辨率平面贴片场景，Decisions API 返回类型化选择并控制蛇。

![标题页](screenshots/title.png)

![游戏画面](screenshots/gameplay.png)

![AI 决策](screenshots/ai-thinking.png)

## 运行

```sh
npm install
npm run dev
```

打开终端给出的地址，默认是 `http://127.0.0.1:5173/`。

生产构建：

```sh
npm run build
npm run preview
```

## 操作

| 输入 | 动作 |
|---|---|
| `WASD` 或方向键 | 转向 |
| 按住场景并拖动 | 显示临时摇杆并转向，松手收起 |
| `Space` | 暂停或继续 |
| `R` | 重开 |
| `M` | 开启或关闭音乐与音效 |
| 关闭按钮或右侧边缘标签 | 收起或重新打开 AI 控制台 |

规则是经典贪吃蛇。19x19 棋盘，撞墙或撞到身体结束。吃到苹果加 10 分并增长一格。手动模式每吃 6 个苹果，移动间隔减少 1 tick，直到达到当前难度的最快速度。AI 模式吃苹果时保持当前速度。顶栏和开局菜单的「难度」按钮组提供悠闲、标准、疾速三档，分别调整起始速度与最快速度。开局前就可以选。背景音乐由 Web Audio 程序化合成，不依赖外部音频文件。

## 视觉

场地保持正方向，只有透视俯视的仰角，没有 45 度旋转。地面是明亮的苔绿像素草地；可玩区是均匀的割草草地，没有格线，外圈是一圈低矮的木栅栏，立柱和两道横杆把边界清楚地标出来。栅栏内沿完全位于可玩格之外。

蛇头是独立的 32x32 像素角色，有额头、两侧的小黑眼和白色高光、奶白下颌、短红舌。蛇身由相互重叠的胶囊贴片连成一条连续身体，带亮绿顶面、中绿侧面、深绿下侧和窄奶白腹边；水平贴图是 25x18，竖直贴图是 18x20，旋转后像素不被拉伸。相邻段端部不画黑边，深绿大斑纹跨段延续；转弯处用软边接头填充，避免方形缺口。没有独立尾帽，身体在尾格自然收束。蛇、苹果和粒子都有偏移的扁平阴影，木栅栏也参与三维落点，所以角色仍是二维贴片，但落在三维场地里。AI 决策文本使用紧凑坐标和路线描述。

## 让 Decisions API 玩

1. 打开 AI 控制台，输入 OpenAI API Key。
2. 模型固定为 `gpt-6-luna`，对应 Decisions API。
3. 点「开始 AI」或菜单里的「让 AI 来玩」。

浏览器通过 `POST https://api.openai.com/v1/decisions` 请求路线选择，接口说明见 [OpenAI Decisions 指南](https://developers.openai.com/api/docs/guides/decisions)。`input` 使用 `SNAKE/3 ROUTES`，描述已确定前缀执行完毕后的棋盘和候选路线。请求结构如下，棋盘和路线内容用省略号简写。

```json
{
  "model": "gpt-6-luna",
  "input": "SNAKE/3 ROUTES\n... 未来起点棋盘与候选路线 ...",
  "questions": [
    {
      "type": "choice",
      "name": "next_move",
      "instructions": "Choose one listed route from its future start board ...",
      "choices": [
        { "value": "U", "description": "Route up: moves=up,... length=8 safe_extension=16 eatAt=4 progress=3 ..." },
        { "value": "D", "description": "Route down: moves=down,... length=8 safe_extension=16 eatAt=- progress=1 ..." }
      ]
    }
  ]
}
```

`U`、`D`、`L`、`R` 是以该方向开头的路线 ID。`answers[0].choice` 选中整条路线，每次移动执行其中一个动作。`refusal`、非法选择和非 choice 类型都会报错。

关键行为：

- 游戏按固定 60 Hz 推进。执行当前已确定路线时，会话从路线终点提前请求下一条路线，最多一个请求在飞。
- 最近 8 次成功响应的 P90 不超过一次移动时间时，候选长度为 1 步。超过时使用 `ceil(P90 / 一次移动时间) + 2`，限制为 8 至 32 步。没有样本时使用 16 步。每个候选至少模拟 16 步。
- 早到的响应暂存到指定起点。会话到达起点后核对完整棋盘再执行，晚到响应会被丢弃。
- 冷启动或响应迟到时，本地避险路线优先直行，在即将碰撞时转向。只有一个安全候选时直接在本地执行。各来源的移动和吃食数量可通过 `__snake.ai.getExecutionStats()` 查看。
- 顶栏保持在「游戏中」。AI 面板状态可以显示「请求中」，但模拟不停。
- Key 只保存在当前页面的私有字段里。不写入 `localStorage`、`sessionStorage`、IndexedDB、cookie、URL 或日志。输入框在启动 AI 后清空，刷新页面需要重新输入。
- 网络或解析失败时显示错误，会话至少等待 60 tick，再在移动边界重试。等待期间执行本地避险。

控制台的 `getPrompt()` 和 `getObservation()` 返回当前棋盘的 `SNAKE/2` 分析，便于检查延迟、历史和单步结果。实际网络请求使用面向未来起点的 `SNAKE/3 ROUTES`。两者用途不同。

本次 5 个标准难度种子的真实 API 试验中，完整路线方案的 90 秒得分中位数为 210，单步基线为 40。满窗口存活分别为 5/5 和 4/5。完整与精简提示词未分胜负，因此使用完整版本。方法、逐局结果和限制见 [AI 延迟评估](docs/ai-latency.md)。

## 控制台测试接口

页面始终暴露 `window.__snake`。所有会改状态的调用先停掉实时时钟，避免和 `requestAnimationFrame` 竞争。

```js
__snake.help()
__snake.start({ seed: 42 })
__snake.stepMoves(3)
__snake.getState()
__snake.getObservation().prompt
__snake.setDifficulty("fast")
__snake.getInvariantReport()
```

注入一个计划：

```js
__snake.ai.useMock({ moves: ["up", "right"], reason: "test" })
__snake.start({ seed: 42, ai: true })
__snake.stepMoves(2) // 请求在飞时蛇继续移动
await __snake.ai.waitForIdle(2000)
__snake.stepMoves(1)
__snake.getAiLog()
__snake.ai.getExecutionStats()
```

`attach()` 回到实时运行，`detach()` 停住模拟但保留渲染。完整命令和浏览器检查脚本见 [docs/testing.md](docs/testing.md)。

## 热路径

每帧和每个 tick 执行的代码使用 `.hot.ts`：

```text
src/engine/loop.hot.ts
src/sim/tick.hot.ts
src/sim/invariants.hot.ts
src/app/frame.hot.ts
src/render/scene.hot.ts
```

`npm run lint:hot` 禁止这些文件出现对象字面量、数组字面量、`new`、闭包、展开、模板字符串、`for...of` 和常见分配型调用。构建和检查都会执行它。

每个 tick 只推进时钟并跑位掩码不变量检查。真正的移动 reducer 在移动边界运行，每秒约 5 到 15 次。UI 只在版本变化时更新，不在每帧复制状态或生成观察文本。细节和边界见 [docs/hot-path.md](docs/hot-path.md)。

## 验证

```sh
npm test
npm run test:coverage
npm run lint:hot
npm run build
npm run verify:tla
npm run check
npm run test:browser
```

当前结果：

- `npm run check` 通过，包含 172 个测试、热路径 lint、TypeScript 检查、Vite 构建和两套 TLC 模型检查。`npm run test:coverage` 通过覆盖率门槛。
- TLC 检查生命周期 73 个状态，规则 38,707 个状态。
- 无头 Chrome 控制台检查通过。8 个真实时钟延迟场景均存活并通过运行检查。
- 真实 API 的标准难度试验完成 5 个种子的三方案配对。完整路线方案每局得分均高于单步基线，配对中位增分为 160。它是本地生成路线、模型选择与等待避险共同作用的结果。方法和逐局数据见 [AI 延迟评估](docs/ai-latency.md)。
- 使用虚拟时钟、注入延迟和固定选择器的模拟矩阵共 384 局全部存活。这部分只检查调度与执行，汇总见 [模拟结果](docs/ai-latency-results.json)。

游戏状态的不变式在每一 tick 和每次状态改变后执行，生产构建也一样，名称与 TLA+ 对应。AI 请求的 `aiPending` 由会话测试和 TLA+ 覆盖。违规时游戏冻结并显示错误。

## 结构

```text
src/
  engine/    固定 60Hz 循环、输入、音频、种子 RNG
  sim/       GameState、规则、不变式、决策坐标与移动分析
  ai/        Decisions 传输、动态上下文、提示词、响应解析、计划控制器
  app/       会话状态机、内存 Key、控制台 API、帧热路径
  render/    Three.js 明亮平面像素场景、程序化纹理、纸片阴影
  ui/        DOM HUD、菜单、AI 面板
test/        与 src 同层级的 Vitest 测试
spec/        TLA+ 生命周期和规则模型
docs/        架构、测试、热路径、AI 延迟评估
```

引擎调度思路参考 tibo.dog 引擎研究：固定步长累加器、确定性 RNG、事件扇出、暂停时保留渲染、插值和对象池。玩法、场景和素材为本项目原创，不使用原游戏资产。

## 已知边界

- AI 成功路径需要你自己的 OpenAI Key。没有 Key 时可以用 mock 验证完整链路。
- 候选只检查有限步数，本地避险也可能陷入死路。通过实验的种子和延迟序列不能代表所有棋盘。
- 路线只追逐请求时已知的食物。前缀执行期间生成的新食物参与规则模拟，但不会成为该次请求的追逐目标。
- 挂起请求没有自动超时。需要取消时，可暂停游戏或停止 AI。
- 浏览器直连 OpenAI 的非 2xx 错误可能被 CORS 隐藏成 `Failed to fetch`。
- 19x19 棋盘是这一版的全部玩法范围。没有关卡、障碍、皮肤或排行榜服务。
- 结束菜单提供「手动再来一局」和「AI 再来一局」。AI 重开复用内存里的 Key；没有 Key 时需要在右侧输入。
- 背景音乐是程序化循环，不是完整配乐；音量和静音由同一个按钮控制。
- 本项目不隶属于 OpenAI 或 tibo.dog。
