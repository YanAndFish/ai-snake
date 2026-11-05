# 比较真实模型的得分和存活时间

运行 `npm run eval:live`，在无头 Chrome 中调用真实 Decisions API。脚本使用待测源码中的 session、transport、controller 和 parser。每局按真实 rAF 推进 60 Hz 游戏时钟。死亡后得分冻结，并等待相同的计分窗口结束。

从调用进程的 `OPENAI_API_KEY` 读取凭据，或明确指定 `.env.local`。

```sh
npm run eval:live -- --env-file .env.local --seeds 83 --duration-ms 30000 --output /tmp/live.json
```

真实请求只放行 `https://api.openai.com/v1/decisions`。Key 只放在 Node 和当前页面的内存中。脚本关闭 Vite 的 `.env` 自动加载，报告只记录游戏提示词、状态码和选择结果。脚本没有开启 trace、HAR 或请求头日志。

`--root` 指定另一份可运行的源码。`--matrix` 读取多个变体，并在每个种子上轮换运行顺序。

```json
[
  { "name": "baseline", "root": "/tmp/ai-snake-live-baseline" },
  { "name": "current-direction", "root": ".", "prompt": "full" }
]
```

```sh
npm run eval:live -- --env-file .env.local --matrix /tmp/variants.json --seeds 201,202,203,204,205 --duration-ms 90000 --concurrency 2 --output /tmp/live-matrix.json
```

`--scenarios` 读取逐局配置，支持 `name`、`root`、`seed`、`durationMs`、`difficulty`、`model`、`prompt`。需要固定成对运行时，为每局填写 `round`。同一轮全部结束后才开始下一轮，每轮数量最多为 `--concurrency`。

`full` 发送生产源码生成的请求，当前方向控制使用此选项。`compact-summary` 仅适用于单独检出的 `SNAKE/3 ROUTES` 实验源码。它从 `input` 和候选说明中删除蛇身坐标与逐步方向，保留未来起点、已知食物、`length`、`safe_extension`、`eatAt`、`progress` 和终点。每次请求保存实际 `payload`、`promptHash` 和 `payloadHash`。

报告中的字段用于区分不同结果。

- `realApiMode` 表示启用真实网络。`realModelMeasured` 表示至少有一个真实 HTTP 200 响应完成生产 parser 解析。
- `score` 是固定窗口结束时的分数。`survivedMs` 是存活时长，死亡时间由每 25 毫秒采样观测。
- `responseCount` 统计收到响应头的请求。`completedResponseCount` 统计收完响应体的请求。`parsedResponseCount` 统计完成生产 parser 解析的请求。
- `executionStats.apiMoves` 和 `apiEats` 统计应用 AI 操作时完成的移动和吃食，包括 KEEP。`coastMoves` 和 `coastEats` 统计没有新输入时的移动和吃食。
- 对于路线实验源码，`expiredResponses` 统计失效响应。当前方向输入从实际位置执行，`expectedStartMove` 和 `expiredOnArrival` 为 `null`。
- `records[].dispatchState` 和 `responseState` 分别保存请求发出和响应解析完成时的可见棋盘。两者省略 RNG。
- `records[].selectedAction` 保存模型实际选择的操作，KEEP 记为 `keep`。`selectedDirection` 保存对应的移动方向。
- `executions` 记录每次真实移动或碰撞。`actionInput` 为 `keep` 时表示执行 KEEP，为 `null` 时表示没有新操作。`directionInput` 保存操作对应的移动方向，`requestId` 将执行关联到模型响应。
- `maxActiveFetches` 独立统计原生 fetch 并发，覆盖响应体接收时间。`clockRatio` 比较实际 tick 与存活墙钟对应的 60 Hz tick。
- `errors` 区分 HTTP、网络、解析、死亡取消和窗口结束取消。旧源码没有来源统计时，`executionStats` 与 `decisionApplied` 为 `null`。
- `sourceBefore` 和 `sourceAfter` 按相对路径与内容计算每份源码 `src/**/*.ts` 的 SHA256，包含逐文件清单。`sourceStable` 表示运行前后内容相同。

当前方向控制的配对实验见 [提示词实验报告](ai-prompt-evaluation.md) 、[更多提示词与 KEEP 实验](ai-prompt-exploration.md) 和 [多结果与提前请求实验](ai-batch-evaluation.md)。

`passed` 只表示页面、时钟、单请求和清理检查通过。检查模型效果时同时查看错误、真实解析数和实际 API 动作，不能仅看 `passed`。

运行无网络自检时，脚本使用浏览器路由返回假响应。它优先返回 KEEP；待测版本没有 KEEP 时返回第一个选项。自检不会读取 Key，也不会调用 API。

```sh
npm run eval:live -- --self-check --seeds 83 --duration-ms 2000 --output /tmp/live-selfcheck.json
```

## 复现路线方案的固定配对

本节对应路线方案实验。B、C 必须使用与报告源码 hash 相同的独立检出目录，不能使用当前方向控制源码。下方示例中的 `process.cwd()` 需要替换为该目录。

[真实结果 JSON](ai-live-results.json) 保留正式场景的种子、轮次、顺序和源码 hash。标准难度有三方案各 5 局，疾速有 A、B 各 2 局，所有窗口均为 90 秒。它们没有包含初检或假响应样本。

A 基线以提交 `233b2219c9cea2c5635d455ad6635d80290bd593` 为起点，只应用 [速度补丁](ai-live-baseline.patch)。补丁涉及 `src/config.ts`、`src/sim/game.ts`、`src/app/session.ts`。AI 吃食物时保持速度，手动模式每 6 个食物减少 1 tick。这个基线包含该提交的 dayjs 日志显示。

在当前项目根目录运行以下命令。项目需要已经安装依赖。

```sh
baseline_dir=$(mktemp -d /tmp/ai-snake-live-baseline.XXXXXX)
git archive 233b2219c9cea2c5635d455ad6635d80290bd593 | tar -x -C "$baseline_dir"
git -C "$baseline_dir" apply --unidiff-zero "$PWD/docs/ai-live-baseline.patch"
ln -s "$PWD/node_modules" "$baseline_dir/node_modules"
```

A 的 `src/**/*.ts` 组合 SHA256 为 `647ea73729b4b78679f0e9573a2bff2a763e5b0a54c8538af66113eee8cee8bb`。本次 B、C 为 `e8e5e40a6387a4f87a487d0f9cfcb8883eb4f474346d8f717ed5ad973e5e7ba0`。脚本按排序后的相对路径、字节数和内容计算组合 hash，报告保存逐文件清单。

从结果文件生成两组场景配置，保留正式轮次与顺序。

```sh
node --input-type=module - "$baseline_dir" <<'JS'
import { readFile, writeFile } from "node:fs/promises";
const result = JSON.parse(await readFile("docs/ai-live-results.json", "utf8"));
for (const difficulty of ["normal", "fast"]) {
	const scenarios = result.reproduction[`${difficulty}Scenarios`].map(({ variant, ...scenario }) => ({
		...scenario,
		root: variant === "A" ? process.argv[2] : process.cwd(),
	}));
	await writeFile(`/tmp/ai-snake-live-${difficulty}-scenarios.json`, JSON.stringify(scenarios, null, 2));
}
JS
npm run eval:live -- --env-file .env.local --scenarios /tmp/ai-snake-live-normal-scenarios.json --concurrency 2 --output /tmp/ai-snake-live-normal.json
npm run eval:live -- --env-file .env.local --scenarios /tmp/ai-snake-live-fast-scenarios.json --concurrency 2 --output /tmp/ai-snake-live-fast.json
```

复现会产生真实 API 请求。运行后先检查 `sourceStable`、源码 hash、逐局错误、并发和时钟，再比较同种子的分数与存活时间。源码变化后的运行属于新的试验。真实网络和模型响应有波动，得分不要求逐字节相同。
