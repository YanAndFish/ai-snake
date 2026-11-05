# SnakeFlow

运行 `npm run verify:tla` 后，TLC 生成 214 个状态，发现 73 个不同状态，队列剩余 0 个状态。完整状态图的搜索深度为 10。检查结果没有错误。

## 检查通过的规则

`TypeOK`、`HaltFreezesTicks`、`AIPendingOnlyInAI`、`NoReverse`、`LengthAtLeastThree`、`MenuAtZero`，以及死锁检查。

## 图和模型的范围

`SnakeFlow.mmd` 根据 `SnakeFlow.tla` 和 `SnakeFlowView.ts` 手工同步。本次未运行 statechart 生成器。图省略同一节点内的移动。

`AIRespondR` 只枚举 R 方向，用于检查请求、缓存、应用和丢弃的生命周期。`AIApply` 表示到达匹配的执行起点。模型没有保存精确起点或完整路线，不能证明实际执行时间或路线安全性。这些行为需要通过真实会话和移动规则测试。
