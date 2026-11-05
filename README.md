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
| `Space` | 暂停或继续 |
| `R` | 重开 |
| `M` | 开启或关闭音乐与音效 |

规则是经典贪吃蛇。19x19 棋盘，撞墙或撞到身体结束。吃到苹果加 10 分并增长一格。速度随吃到的苹果数量提升。顶栏和开局菜单的「难度」按钮组提供悠闲、标准、疾速三档，分别调整起始速度与最快速度；开局前就可以选。背景音乐由 Web Audio 程序化合成，不依赖外部音频文件。

## 视觉

场地保持正方向，只有透视俯视的仰角，没有 45 度旋转。地面是明亮的苔绿像素草地；可玩区是两行一条的割草带和很淡的格子线，外圈是低矮的石土边框，不再是高对比的棋盘格。边框内沿完全位于可玩格之外。

蛇头是独立的 32x32 大眼像素角色，蛇身由相互重叠的胶囊贴片连成一条连续身体，竖直段按镜头仰角投影缩短。蛇、苹果和粒子都有偏移的扁平阴影，场地有土台侧壁和整块环境阴影，所以角色仍是二维贴片，但落在三维场地里。观察面板使用像素等宽字体和正方形字符格，21 列的 ASCII 地图不会横向或纵向变形。

## 让 Decisions API 玩

1. 在右侧 AI 控制台输入 OpenAI API Key。
2. 模型固定为 `gpt-6-luna`，对应 Decisions API。
3. 点「开始 AI」或菜单里的「让 AI 来玩」。

请求遵循 [OpenAI Decisions 指南](https://developers.openai.com/api/docs/guides/decisions)，使用 `POST https://api.openai.com/v1/decisions`。`input` 里是每个合法转向的移动分析（撞墙/撞身、可达空间、空间是否充足、到食物的最短路）和当前方向。正文是 `model`、`input` 和一个 `choice` 问题：

```json
{
  "model": "gpt-6-luna",
  "input": "SNAKE/1 ... 候选分析 ...",
  "questions": [
    {
      "type": "choice",
      "name": "next_move",
      "instructions": "Choose the next legal move ...",
      "choices": [
        { "value": "U", "description": "Move the head up one cell." }
      ]
    }
  ]
}
```

响应里的 `answers[0].choice` 被映射成一步。`refusal`、非法选择和非 choice 类型都会报错。

关键行为：

- 游戏不会暂停等待响应。请求在飞行时，蛇继续按当前方向移动。响应慢，蛇可能撞死，这是设计。
- 最多一个请求在飞。响应到达后成为下一份计划，下一次移动消费它，消费后立刻发下一份请求。
- 顶栏保持在「游戏中」。右侧状态可以显示「请求中」，但模拟不停。
- Key 只保存在当前页面的私有字段里。不写入 `localStorage`、`sessionStorage`、IndexedDB、cookie、URL 或日志。输入框在启动 AI 后清空，刷新页面需要重新输入。
- 浏览器直接请求 Decisions API。CORS 预检已通过。非 2xx 错误可能被浏览器显示成网络失败，游戏继续移动并显示错误，可以重试或手动接管。

## 控制台测试接口

页面始终暴露 `window.__snake`。所有会改状态的调用先停掉实时时钟，避免和 `requestAnimationFrame` 竞争。

```js
__snake.help()
__snake.start({ seed: 42 })
__snake.stepMoves(3)
__snake.getState()
__snake.getObservation().map
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
```

`attach()` 回到实时运行，`detach()` 停住模拟但保留渲染。完整命令和验收脚本见 [docs/testing.md](docs/testing.md)。

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
```

当前结果：

- Vitest 17 个测试文件，117 个测试。
- 覆盖率 91.69% statements，95.9% lines，92.79% functions，83.76% branches。
- Vite 生产构建通过。
- 热路径 lint 通过 5 个文件。
- TLA+ 两套规格通过 TLC。生命周期 64 个状态，规则 38,707 个状态。
- 真实浏览器控制台脚本 `docs/console-acceptance.js` 输出 `PASS`，覆盖难度按钮组、结束菜单 AI 重开、背景音乐和正方形观察地图。

游戏状态的不变式在每一 tick 和每次状态改变后执行，生产构建也一样，名称与 TLA+ 对应。AI 请求的 `aiPending` 由会话测试和 TLA+ 覆盖。违规时游戏冻结并显示错误。

## 结构

```text
src/
  engine/    固定 60Hz 循环、输入、音频、种子 RNG
  sim/       GameState、规则、不变式、ASCII 观察编码
  ai/        Decisions 传输、响应解析、计划控制器
  app/       会话状态机、内存 Key、控制台 API、帧热路径
  render/    Three.js 明亮平面像素场景、程序化纹理、纸片阴影
  ui/        DOM HUD、菜单、AI 面板
test/        与 src 同层级的 Vitest 测试
spec/        TLA+ 生命周期和规则模型
docs/        架构、测试、热路径、浏览器验收
```

引擎调度思路参考 tibo.dog 引擎研究：固定步长累加器、确定性 RNG、事件扇出、暂停时保留渲染、插值和对象池。玩法、场景和素材为本项目原创，不使用原游戏资产。

## 已知边界

- AI 成功路径需要你自己的 OpenAI Key。没有 Key 时可以用 mock 验证完整链路。
- Decisions API 一次只返回一个选择，所以 AI 每走一步请求一次。响应慢时蛇会继续直行并可能死亡。
- 浏览器直连 OpenAI 的非 2xx 错误可能被 CORS 隐藏成 `Failed to fetch`。游戏不会静默接管。
- 19x19 棋盘是这一版的全部玩法范围。没有关卡、障碍、皮肤或排行榜服务。
- 结束菜单提供「手动再来一局」和「AI 再来一局」。AI 重开复用内存里的 Key；没有 Key 时需要在右侧输入。
- 背景音乐是程序化循环，不是完整配乐；音量和静音由同一个按钮控制。
- 本项目不隶属于 OpenAI 或 tibo.dog。
