# SnakeFlow

运行 `npm run verify:tla` 后，TLC 生成 2,576 个状态，发现 899 个不同状态，队列剩余 0 个状态。完整状态图的搜索深度为 19。检查结果没有错误。

## 检查通过的规则

`TypeOK`、`HaltFreezesTicks`、`AIPendingOnlyInAI`、`NoReverse`、`LengthAtLeastThree`、`MenuAtZero`，以及死锁检查。

## 图和模型的范围

`SnakeFlow.mmd` 根据 `SnakeFlow.tla` 和 `SnakeFlowView.ts` 手工同步，省略同一节点内的移动。

`AIRespondAny` 枚举所有符合转向规则的方向。`AIApply` 表示下一次移动前应用方向。模型检查请求和输入的生命周期，完整棋盘的碰撞行为由真实会话测试覆盖。
