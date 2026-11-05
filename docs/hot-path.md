# 热路径约定

每帧或每个 tick 都会执行的模块使用 `.hot.ts` 后缀。它不是装饰，而是给静态检查器的边界标记。

当前热文件：

| 文件 | 每帧或每 tick 做什么 |
|---|---|
| `src/engine/loop.hot.ts` | 累加时间、执行固定步长、限制追帧 |
| `src/sim/tick.hot.ts` | 增加 tick 和移动累加器，返回是否到达移动边界 |
| `src/sim/invariants.hot.ts` | 用位掩码检查规则，不创建违规数组 |
| `src/app/frame.hot.ts` | 只在分数、长度、阶段、AI 版本或致命状态变化时通知 UI |
| `src/render/scene.hot.ts` | 更新平面贴片、纸片阴影、苹果、粒子和镜头，不创建临时 Three 对象 |

## Lint 规则

```sh
npm run lint:hot
```

`scripts/lint-hot.mjs` 扫描每个 `.hot.ts` 文件，禁止以下写法。lint 使用 `typescript5` 别名，因为 TypeScript 7 的根包不再暴露编译器 API。

- 对象字面量、数组字面量、`new`
- 箭头函数和函数表达式闭包
- 展开运算符、模板字符串、正则字面量、`for...of`
- `map`、`filter`、`slice`、`concat`、`push`、`sort`、`shift` 等分配型调用
- `Object.keys`、`JSON.parse`、`JSON.stringify`、`structuredClone`

`npm run build` 和 `npm run check` 都会先跑这条规则。规则只覆盖我们自己的热文件。Three.js 的 `renderer.render` 和浏览器 DOM 是边界，内部临时对象不在检查范围内。

## 冷热边界

- **每个 tick** 只做时钟推进和规则位掩码检查。两者都不分配对象。
- **移动边界** 才运行 `advanceMove`，它创建新的蛇数组和事件。游戏速度约 5 到 15 格每秒，所以这是每秒个位数到十几个小对象，不是每 tick。
- **每个 frame** 只读当前状态、检查版本号，并调用 scene 的固定字段更新。
- **状态变化** 才更新 DOM、生成决策文本、请求决策。难度选择只改一个速度字段。`getState()` 的状态拷贝和决策上下文不在每帧路径上。
- **AI 请求** 不在模拟循环里等待。请求在飞行时，tick 照常推进。响应到达后作为下一份计划，等下一次移动边界消费；消费后再发下一份请求，最多一个请求在飞行。

## 为什么快照不在热路径

`viewState` 会复制蛇、队列、食物和最后一步。控制台和 UI 需要副本，但每帧调用会持续产生垃圾。渲染直接读 `session.state`，UI 只在版本变化时读取。`getState()` 仍然返回副本，因为调用方需要一个不会继续变化的快照。

## 验证

- `npm run lint:hot` 证明热文件没有新增分配写法。
- `test/engine/loop.hot.test.ts`、`test/sim/tick.hot.test.ts`、`test/sim/invariants.test.ts` 和 `test/app/frame.hot.test.ts` 覆盖行为。
- 浏览器验收脚本证明真实页面没有控制台错误，并且 AI 请求在飞行时游戏继续移动。
