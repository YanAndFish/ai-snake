# 架构

## 目标

同一局游戏要同时支持键盘、控制台脚本和 OpenAI Decisions API。三者走同一条方向队列。固定种子加同一串操作要得到同一个状态。AI 请求不能停掉模拟，慢响应允许导致死亡。

## 状态

`GameState` 是唯一的游戏事实，位于 `src/sim/types.ts`。它包含阶段、控制方、tick、移动计数、蛇身、方向队列、食物、分数、种子和 RNG 状态。

阶段只有 `menu`、`playing`、`paused`、`over`。没有 AI 思考阶段。`control` 单独表示人类或 AI。AI 请求是否在飞行由控制器状态和 `aiPending` 模型变量表示，不进入 `GameState`，也不改变阶段。

方向是 `direction` 加最多两格的 `queue`。入队只和队尾比较，反向和重复会被忽略。移动只消费队首。

分数不单独维护。`score === 10 * eaten`，`snake.length === 3 + eaten`。运行时不变量和 TLA+ 都检查这两条。难度是 `GameState.difficulty`，取值 `chill`、`normal`、`fast`；速度曲线集中在 `src/config.ts` 的 `DIFFICULTIES`，移动、重开和吃苹果都从这一张表派生。

## 循环与热路径

`src/engine/loop.hot.ts` 把 `requestAnimationFrame` 当作泵。每次回调最多补 8 个 1/60 秒步长，暂停时清空累加器，正常时最多留一步。

每个 tick 的实际热路径是：

1. `advanceClockHot` 增加 tick 和移动累加器，不分配对象。
2. 未到移动边界时，`checkInvariantsMask` 用位掩码检查规则，不创建数组，然后返回。
3. 到达移动边界时，取 AI 计划或人类方向，调用冷路径 `advanceMove`。
4. `advanceMove` 创建新的蛇数组和事件。它以每秒约 5 到 15 次的频率运行，不是每 tick。
5. 帧循环调用 `renderFrameHot`。它只在版本变化时更新 DOM 或观察文本，场景更新在 `scene.hot.ts`。

`docs/hot-path.md` 说明 `.hot.ts` 约定和 lint 规则。热文件的分配被 `npm run lint:hot` 拒绝。

## AI 决策

`src/sim/observation.ts` 仍生成供面板显示的 ASCII 地图。`handleEvents` 在开始、移动、吃食物、撞墙和胜利事件后刷新地图，所以人工模式也会同步。`src/sim/analysis.ts` 对每个合法转向计算撞墙/撞身、尾格释放、可达空间、空间宽窄和到食物的最短路；提示词发送这些候选分析、当前方向和关键坐标，不再重复整张地图、图例、分数和难度。

`src/ai/client.ts` 默认使用 Decisions API：

```json
{
  "model": "gpt-6-luna",
  "input": "SNAKE/1 ...",
  "questions": [
    {
      "type": "choice",
      "name": "next_move",
      "choices": [
        { "value": "U", "description": "Move the head up one cell." }
      ]
    }
  ]
}
```

返回的 `answers[0]` 必须是 `choice`。`refusal`、非法选择和非 choice 类型都报错。Key 只放在 `Authorization` 头里。

会话维护最多一个在飞请求。`start` 发第一份请求后立刻返回，蛇继续按当前方向移动。响应到达后成为下一份计划。下一次移动消费计划，消费后立刻发下一份请求。请求慢时没有计划，蛇继续直行，可能撞死。这是设计要求。

`src/ai/controller.ts` 负责状态、日志、mock 和请求序号。旧响应不能覆盖新请求。`src/ai/response.ts` 仍负责解析和方向校验，供控制台计划与 mock 使用。

## 渲染

`src/render/scene.ts` 构建场景，`src/render/scene.hot.ts` 更新每帧可见状态。相机是正对棋盘的三分之四俯视，不旋转 45 度。方向键和屏幕方向一致。

低分辨率 WebGL 画布由 CSS 最近邻放大。相机是轴对齐的透视俯视，只有仰角，没有偏航。地面是明亮的苔绿像素草地；可玩区是均匀的割草草地，没有格线，外圈是一圈低矮的木栅栏，立柱和两道横杆。栅栏内沿严格位于可玩格之外：格子范围是 x 和 z 的 0 到 19，栅栏从 0 和 19 向外生长，所以蛇头不会先压进栅栏再死亡。

蛇头是 32x32 的四个方向像素贴片，有深绿斑块、大黑眼和白色高光、奶白下颌和分叉红舌。蛇身是相互重叠的 32x18 胶囊贴片，带奶白腹边、腹鳞线和深绿斑块；水平段按一格长度伸展，竖直段按镜头仰角投影缩短，相邻段在格心重叠，尾端有一枚圆形尾帽。蛇、苹果、粒子和装饰都有偏移的扁平阴影，木栅栏本身也提供三维边界。蛇在上一格和当前格之间按移动间隔插值；撞墙结束时会直接吸附到当前格，不会先回退；控制台瞬移蛇身时也会检测跨格跳变并直接吸附到新位置。

所有角色贴片使用无光照材质，保持像素颜色，不随阴影变暗。

HUD、菜单和 AI 面板是 DOM。文字保持清晰，场景保持像素颗粒。AI 面板的观察地图使用 `white-space: pre`，不会把棋盘折行。

## 音效与音乐

`src/engine/audio.ts` 用 Web Audio 合成所有声音，不加载音频文件。音效跟随游戏事件；背景音乐是 16 步循环，三角波旋律加正弦低音，第一次点击开始后启动。`M` 或顶栏按钮控制同一个静音状态，主音乐增益和音效同时受控。

## 验证

`spec/SnakeFlow.tla` 检查生命周期和 AI 请求。`Tick` 在 `aiPending` 为真时仍然启用，TLC 检查 64 个状态。`spec/SnakeRules.tla` 检查 3x3 棋盘规则，TLC 检查 38,707 个状态。

游戏状态的运行时 `checkInvariantsMask` 与 TLA+ 的游戏不变量同名。每个 tick 和每次状态变化后执行。AI 请求的 `AIPendingOnlyInAI` 由会话测试覆盖。`test/sim/conformance.test.ts` 和会话测试把 TLA+ 动作映射到真实实现。

## 取舍

- AI 请求不暂停，换取真实响应延迟下的玩法。响应慢会死，这是产品规则。
- Decisions API 一次只返回一个 `choice`，所以一次请求只产生一步。多步预测需要多个请求，不在当前范围。
- 热路径只覆盖我们自己的代码。Three.js 内部和 DOM 是边界。
- 19x19 棋盘和 3x3 TLA+ 模型是刻意的抽象。真实棋盘由 Vitest fuzz 覆盖。
- 难度只改变每个移动需要的 tick 数，不改变规则。速度曲线集中在 `src/config.ts`，运行时和测试共用。
- 不引入 React、服务器代理或本地 AI 保底策略。浏览器直连 Decisions API，Key 只存在内存。
