import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const HZ = 60;
const MAIN_DELAYS = { fixed100: [100], fixed600: [600], fixed1200: [1200], jitter: [100, 300, 1200, 600] };
const HOLDOUT_DELAYS = { fixed240: [240], fixed900: [900], fixed1800: [1800], longtail: [100, 100, 300, 100, 1800, 100, 900, 3600] };
const TOKEN_DIRECTION = { U: "up", D: "down", L: "left", R: "right" };

/**
 * 每局在独立 worker 时钟中执行，延迟按请求顺序循环。
 * @typedef {object} Scenario
 * @property {number} index 输出中的固定顺序。
 * @property {number} seed 游戏随机种子。
 * @property {"normal" | "fast"} difficulty 游戏难度。
 * @property {string} delay 延迟序列的名称。
 * @property {number[]} delayMs 每次响应的等待毫秒数。
 * @property {"food" | "first"} selector 确定性的候选选择方式。
 * @property {number} ticks 固定计分窗口的 tick 数。
 */

/** 读取命令参数，拒绝拼写错误和无效数值。 */
function readOptions(argv) {
  const options = { root: process.cwd(), output: resolve("ai-evaluation.json"), concurrency: 4, seeds: 12, ticks: 3600, holdout: false, selectors: ["food", "first"] };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === "--help") return null;
    if (name === "--holdout") { options.holdout = true; continue; }
    if (!["--root", "--output", "--concurrency", "--seeds", "--ticks", "--selectors"].includes(name)) {
      throw new Error(`未知参数 ${name}。运行 --help 查看用法。`);
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
    const key = name.slice(2);
    if (key === "root" || key === "output") options[key] = resolve(value);
    else if (key === "selectors") {
      options.selectors = value.split(",");
      if (!options.selectors.length || new Set(options.selectors).size !== options.selectors.length || options.selectors.some((item) => !["food", "first"].includes(item))) {
        throw new Error("--selectors 只能指定 food、first 或 food,first。");
      }
    } else {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} 必须是正整数。`);
      options[key] = number;
    }
  }
  return options;
}

/** 输出命令说明。 */
function printHelp() {
  console.log(`用法：npm run eval:ai -- [选项]
  --root PATH        待测源码目录，默认当前目录
  --output PATH      JSON 结果路径，默认 ai-evaluation.json
  --concurrency N    并行 worker 数，默认 4
  --seeds N          连续种子数量，默认 12
  --ticks N          固定计分窗口，默认 3600 tick
  --holdout          使用 101 起始种子及独立延迟序列
  --selectors LIST   food、first 或 food,first，默认两者
  --help             显示帮助

默认主矩阵使用种子 1 至 12、normal 和 fast。
假响应经过真实 GameSession、AiController、DecisionsTransport 和解析器。
food 与 first 只比较延迟调度，结果不代表真实模型效果。
ok 只表示样本通过运行约束和统计检查，零响应样本也可通过。
decisionParsed 表示窗口内有响应完成解析，decisionApplied 表示有 API 动作完成执行。`);
}

/** 将矩阵展开为固定顺序的场景。 */
function buildScenarios(options) {
  const scenarios = [];
  const firstSeed = options.holdout ? 101 : 1;
  const delays = options.holdout ? HOLDOUT_DELAYS : MAIN_DELAYS;
  for (const difficulty of ["normal", "fast"]) {
    for (const [delay, delayMs] of Object.entries(delays)) {
      for (const selector of options.selectors) {
        for (let seed = firstSeed; seed < firstSeed + options.seeds; seed += 1) {
          scenarios.push({ index: scenarios.length, seed, difficulty, delay, delayMs, selector, ticks: options.ticks });
        }
      }
    }
  }
  return scenarios;
}

/** 汇总同难度、延迟和选择器的固定窗口得分与工作量。 */
function summarize(raw) {
  const groups = new Map();
  for (const row of raw) {
    const key = `${row.difficulty}/${row.delay}/${row.selector}`;
    if (!groups.has(key)) groups.set(key, { difficulty: row.difficulty, delay: row.delay, selector: row.selector, games: 0, score: 0, scoreMin: Infinity, scoreMax: 0, survived: 0, aliveTicks: 0, moveCount: 0, requests: 0, completed: 0, apiMoves: 0, localMoves: 0, expired: 0, errors: 0, constraintFailures: 0, maxConcurrency: 0 });
    const group = groups.get(key);
    group.games += 1;
    group.scoreMin = Math.min(group.scoreMin, row.score);
    group.scoreMax = Math.max(group.scoreMax, row.score);
    group.survived += Number(row.survived);
    group.maxConcurrency = Math.max(group.maxConcurrency, row.maxConcurrency);
    group.errors += row.errors.length;
    group.constraintFailures += Object.values(row.constraints).reduce((sum, count) => sum + count, 0);
    for (const field of ["score", "aliveTicks", "moveCount", "requests", "completed", "apiMoves", "localMoves", "expired"]) group[field] += row[field];
  }
  return [...groups.values()].map(({ score, aliveTicks, ...group }) => ({ ...group, meanScore: score / group.games, meanAliveTicks: aliveTicks / group.games, apiMoveRatio: group.moveCount ? group.apiMoves / group.moveCount : 0 }));
}

/** 在 worker 池中执行矩阵，每个 worker 同时只运行一局。 */
async function runMatrix(root, scenarios, concurrency) {
  const raw = new Array(scenarios.length);
  const workers = [];
  let nextIndex = 0;
  let completed = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, async () => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { root } });
      workers.push(worker);
      await new Promise((resolveReady, reject) => {
        worker.once("error", reject);
        worker.once("message", (message) => message.ready ? resolveReady() : reject(new Error(message.error ?? "worker 初始化失败。")));
        worker.once("exit", (code) => { if (code !== 0) reject(new Error(`worker 初始化时退出，状态码 ${code}。`)); });
      });
      while (nextIndex < scenarios.length) {
        const scenario = scenarios[nextIndex++];
        const row = await new Promise((resolveRow, reject) => {
          const onError = (error) => { cleanup(); reject(error); };
          const onExit = (code) => onError(new Error(`worker 执行中退出，状态码 ${code}。`));
          const onMessage = (message) => { cleanup(); message.error ? reject(new Error(message.error)) : resolveRow(message.row); };
          const cleanup = () => { worker.off("error", onError); worker.off("exit", onExit); worker.off("message", onMessage); };
          worker.once("error", onError);
          worker.once("exit", onExit);
          worker.once("message", onMessage);
          worker.postMessage(scenario);
        });
        raw[scenario.index] = row;
        completed += 1;
        if (completed % 24 === 0 || completed === scenarios.length) console.error(`已完成 ${completed}/${scenarios.length} 局。`);
      }
    }));
    return raw;
  } finally {
    await Promise.all(workers.map((worker) => {
      if (worker.threadId === -1) return;
      return new Promise((resolveClosed) => {
        worker.once("exit", resolveClosed);
        worker.postMessage({ close: true });
      });
    }));
  }
}

/** 读取候选的公开描述，单格基线则按请求时的真实棋盘评分。 */
function selectChoice(choices, selector, session, game) {
  if (selector === "first") return choices[0];
  const food = session.state.food;
  const distance = (state) => food ? Math.abs(state.snake[0].x - food.x) + Math.abs(state.snake[0].y - food.y) : 0;
  const ranked = choices.map((choice) => {
    const eat = /\b(?:eatAt|known_food_eat_step)=(-|none|\d+)(?=\s|;|$)/.exec(choice.description);
    const progress = /\b(?:progress|food_progress)=(-?\d+(?:\.\d+)?)(?=\s|;|$)/.exec(choice.description);
    if (eat && progress) return { choice, eatAt: ["-", "none"].includes(eat[1]) ? null : Number(eat[1]), progress: Number(progress[1]) };
    if (/\bmoves=|\blength=/.test(choice.description)) throw new Error("路线候选缺少 eatAt 或 progress，无法运行 food 选择器。");
    const direction = TOKEN_DIRECTION[choice.value];
    if (!direction) throw new Error("单格候选使用未知方向，无法运行 food 选择器。");
    const state = session.state;
    const next = game.advanceMove(game.enqueueDirection({ ...state, queue: [] }, direction)).state;
    const safe = next.phase === "playing";
    return { choice, eatAt: safe && food && distance(next) === 0 ? 1 : null, progress: safe ? distance(state) - distance(next) : -10000 };
  });
  ranked.sort((a, b) => Number(b.eatAt !== null) - Number(a.eatAt !== null) || (a.eatAt ?? 999) - (b.eatAt ?? 999) || b.progress - a.progress);
  return ranked[0].choice;
}

/** 用真实会话推进固定 tick，只有到达指定 tick 的响应才能进入解析器。 */
async function runScenario(runtime, scenario) {
  let wallTick = 0;
  let session;
  let requests = 0;
  let completed = 0;
  let aborted = 0;
  let maxConcurrency = 0;
  let fallbackApiMoves = 0;
  const choiceCounts = {};
  const pending = new Set();
  const errors = new Set();
  const constraints = { invalidRequests: 0, invariantFailures: 0, concurrencyViolations: 0, executionCountMismatches: 0, requestCountMismatches: 0, failedResponses: 0, startMismatches: 0 };
  const delaysTicks = scenario.delayMs.map((ms) => Math.ceil(ms * HZ / 1000));
  const realNow = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { configurable: true, value: () => wallTick * 1000 / HZ });
  const fakeFetch = async (_input, init) => {
    try {
      const body = JSON.parse(init.body);
      const question = body.questions?.[0];
      const choices = question?.choices;
      if (init.method !== "POST" || body.questions?.length !== 1 || question.type !== "choice" || question.name !== "next_move" || !Array.isArray(choices) || choices.length < 2 || choices.length > 4 || choices.some((choice) => !Object.hasOwn(TOKEN_DIRECTION, choice.value) || typeof choice.description !== "string") || new Set(choices.map((choice) => choice.value)).size !== choices.length) {
        constraints.invalidRequests += 1;
        throw new Error("Decisions 请求的候选格式无效。");
      }
      const choice = selectChoice(choices, scenario.selector, session, runtime.game);
      choiceCounts[choices.length] = (choiceCounts[choices.length] ?? 0) + 1;
      const dueTick = wallTick + delaysTicks[requests % delaysTicks.length];
      requests += 1;
      return new Promise((resolveResponse, reject) => {
        const entry = { dueTick, finish: null };
        const finish = (cancelled) => {
          if (!pending.delete(entry)) return;
          init.signal.removeEventListener("abort", onAbort);
          if (cancelled) {
            aborted += 1;
            const error = new Error("请求已取消。");
            error.name = "AbortError";
            reject(error);
          } else {
            completed += 1;
            resolveResponse({ ok: true, status: 200, json: async () => ({ answers: [{ type: "choice", name: question.name, choice: choice.value }] }) });
          }
        };
        const onAbort = () => finish(true);
        entry.finish = finish;
        pending.add(entry);
        maxConcurrency = Math.max(maxConcurrency, pending.size);
        if (pending.size > 1) constraints.concurrencyViolations += 1;
        init.signal.addEventListener("abort", onAbort, { once: true });
        if (init.signal.aborted) finish(true);
      });
    } catch (error) {
      errors.add(error.message);
      throw error;
    }
  };
  const controller = new runtime.AiController(new runtime.DecisionsTransport(fakeFetch));
  const keyStore = new runtime.KeyStore();
  keyStore.set("evaluation-placeholder");
  session = new runtime.GameSession({ controller, keyStore });
  try {
    session.start({ seed: scenario.seed, difficulty: scenario.difficulty, ai: true });
    for (wallTick = 1; wallTick <= scenario.ticks; wallTick += 1) {
      for (const entry of [...pending]) if (entry.dueTick <= wallTick) entry.finish(false);
      // 排空整个 Promise 队列，但不等待尚未到达的响应。
      await nextTurn();
      const previousMoves = session.state.moveCount;
      const hasApiPlan = controller.plan.length > 0;
      try { session.stepTick(); }
      catch (error) { errors.add(error.message); }
      if (hasApiPlan && session.state.moveCount > previousMoves) fallbackApiMoves += 1;
      if (runtime.checkInvariantsMask(session.state) !== 0) constraints.invariantFailures += 1;
      await nextTurn();
      const status = session.getAiStatus();
      if (status.error) errors.add(status.error);
    }
    const state = session.state;
    const stats = session.getAiExecutionStats?.() ?? null;
    constraints.failedResponses = stats?.failedResponses ?? 0;
    constraints.startMismatches = stats?.startMismatches ?? 0;
    const apiMoves = stats?.apiMoves ?? fallbackApiMoves;
    const localMoves = stats ? (stats.coastMoves ?? ((stats.bridgeMoves ?? 0) + (stats.forcedMoves ?? 0))) + stats.scriptMoves : state.moveCount - apiMoves;
    if (apiMoves + localMoves !== state.moveCount) constraints.executionCountMismatches += 1;
    if (stats && (stats.requests !== requests || stats.completed !== completed)) constraints.requestCountMismatches += 1;
    if (session.getFatal()) errors.add(session.getFatal());
    const invariantReport = session.getInvariantReport();
    const row = { ...scenario, score: state.score, eaten: state.eaten, phase: state.phase, survived: state.phase === "playing", aliveTicks: state.tick, moveCount: state.moveCount, reason: state.overReason, requests, completed, aborted, pendingAtEnd: pending.size, maxConcurrency, choiceCounts, apiMoves, localMoves, expired: stats?.expiredResponses ?? 0, executionStats: stats, errors: [...errors], constraints, invariantReport,
      /** 窗口内是否至少有一个响应完成解析。会话未提供执行统计时，使用已返回的假响应数。 */
      decisionParsed: (stats?.completed ?? completed) > 0,
      /** 窗口内是否至少执行过一个 API 动作。会话未提供执行统计时，使用计划存在时的实际移动数。 */
      decisionApplied: apiMoves > 0,
    };
    // 固定窗口结束后才取消在飞请求，清理耗时不进入延迟样本。
    wallTick = scenario.ticks;
    session.stopAi();
    for (const entry of [...pending]) entry.finish(true);
    await nextTurn();
    keyStore.clear();
    return row;
  } finally {
    for (const entry of [...pending]) entry.finish(true);
    keyStore.clear();
    if (realNow) Object.defineProperty(performance, "now", realNow);
    else delete performance.now;
  }
}

/** 每个 worker 加载待测源码一次，局与局之间创建新会话。 */
async function workerMain() {
  const { createServer } = await import("vite");
  const server = await createServer({ root: workerData.root, configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
  let modules;
  try {
    modules = await Promise.all([
      server.ssrLoadModule("/src/app/session.ts"), server.ssrLoadModule("/src/ai/controller.ts"), server.ssrLoadModule("/src/ai/client.ts"), server.ssrLoadModule("/src/app/keyStore.ts"), server.ssrLoadModule("/src/sim/game.ts"), server.ssrLoadModule("/src/sim/invariants.hot.ts"),
    ]);
  } catch (error) {
    await server.close();
    throw error;
  }
  const [{ GameSession }, { AiController }, { DecisionsTransport }, { KeyStore }, game, { checkInvariantsMask }] = modules;
  globalThis.fetch = () => { throw new Error("评估工具禁止真实网络请求。"); };
  const runtime = { GameSession, AiController, DecisionsTransport, KeyStore, game, checkInvariantsMask };
  parentPort.on("message", async (scenario) => {
    if (scenario.close) {
      await server.close();
      parentPort.close();
      return;
    }
    try { parentPort.postMessage({ row: await runScenario(runtime, scenario) }); }
    catch (error) { parentPort.postMessage({ error: error.message }); }
  });
  parentPort.postMessage({ ready: true });
}

/** 保存原始结果与汇总，任何约束或请求错误都会使命令失败。 */
async function main() {
  const options = readOptions(process.argv.slice(2));
  if (!options) { printHelp(); return; }
  const scenarios = buildScenarios(options);
  const raw = await runMatrix(options.root, scenarios, options.concurrency);
  const summary = summarize(raw);
  const ok = raw.every((row) => row.errors.length === 0 && row.invariantReport.ok && Object.values(row.constraints).every((count) => count === 0) && row.maxConcurrency <= 1);
  const report = {
    metadata: { root: options.root, ticks: options.ticks, virtualClockHz: HZ, seeds: options.seeds, firstSeed: options.holdout ? 101 : 1, holdout: options.holdout, concurrency: options.concurrency, samples: raw.length, selectors: options.selectors, delaySequencesMs: options.holdout ? HOLDOUT_DELAYS : MAIN_DELAYS, realRequests: 0, path: "GameSession → AiController → DecisionsTransport → fake fetch → parser → reducers", validationScope: "ok 只表示样本通过运行约束和统计检查。API 解析和执行分别查看每局的 decisionParsed、decisionApplied。零响应样本也可通过。", limitations: ["food 与 first 是确定性选择器，结果不代表真实模型效果。", "延迟按 60 Hz 向上取整，performance.now 使用同一虚拟时钟。", "每局按完整窗口计分，死亡后冻结分数并推进窗口。", "不包含浏览器渲染、真实网络、模型质量和失败重试测试。"] },
    ok, summary, raw,
  };
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: options.output, ok, validationScope: report.metadata.validationScope, samples: raw.length, summary }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (isMainThread) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
else workerMain().catch((error) => { parentPort.postMessage({ error: error.message }); parentPort.close(); process.exitCode = 1; });
