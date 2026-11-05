import { readFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import {
  diagnosticsOk,
  openBrowser,
  openCheckedPage,
  printBrowserHelp,
  readBrowserOptions,
  saveBrowserReport,
} from "./test-browser.mjs";

/**
 * 一个场景使用独立的浏览器 context，并按墙钟等待相同的观察时长。
 * @typedef {object} Scenario
 * @property {string} name 结果中的场景名，同一组中必须唯一。
 * @property {number} seed 游戏随机种子。
 * @property {number | number[]} delayMs 每次假响应的等待毫秒数。数组按请求顺序循环。
 * @property {number} durationMs 固定得分窗口，单位毫秒。
 * @property {"chill" | "normal" | "fast"} difficulty 游戏难度。
 * @property {"first" | "greedy" | "straight"} policy 假响应的选择方式。first 直接选第一个候选项。
 */

/** 从 JSON 读取场景，省略路径时使用四个固定延迟的六秒场景。 */
async function readScenarios(path) {
  const input = path
    ? JSON.parse(await readFile(path, "utf8"))
    : [0, 250, 600, 1200].map((delayMs) => ({
      name: `first-${delayMs}`, seed: 83, delayMs, durationMs: 6000, difficulty: "normal", policy: "first",
    }));
  if (!Array.isArray(input) || input.length === 0) throw new Error("场景文件必须是非空 JSON 数组。");
  const names = new Set();
  return input.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`第 ${index + 1} 个场景必须是对象。`);
    }
    const scenario = { difficulty: "normal", policy: "first", ...value };
    if (typeof scenario.name !== "string" || !scenario.name.trim() || names.has(scenario.name)) {
      throw new Error(`第 ${index + 1} 个场景需要一个唯一的 name。`);
    }
    names.add(scenario.name);
    if (!Number.isInteger(scenario.seed) || scenario.seed < 0 || scenario.seed > 0xffffffff) {
      throw new Error(`场景 ${scenario.name} 的 seed 必须是 0 到 4294967295 的整数。`);
    }
    if (!Number.isFinite(scenario.durationMs) || scenario.durationMs < 1000) {
      throw new Error(`场景 ${scenario.name} 的 durationMs 必须至少为 1000 毫秒。`);
    }
    const delays = Array.isArray(scenario.delayMs) ? scenario.delayMs : [scenario.delayMs];
    if (!delays.length || delays.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new Error(`场景 ${scenario.name} 的 delayMs 必须是非负毫秒数或非空毫秒数组。`);
    }
    if (!["chill", "normal", "fast"].includes(scenario.difficulty)) {
      throw new Error(`场景 ${scenario.name} 的 difficulty 只能是 chill、normal 或 fast。`);
    }
    if (!["first", "greedy", "straight"].includes(scenario.policy)) {
      throw new Error(`场景 ${scenario.name} 的 policy 只能是 first、greedy 或 straight。`);
    }
    return scenario;
  });
}

/** 在真实 rAF 和传输层上运行场景，站外 HTTP 请求由页面路由拦截。 */
async function runScenario(runtime, scenario) {
  const checked = await openCheckedPage(runtime.browser, runtime.origin);
  const { page, diagnostics } = checked;
  try {
    await page.goto(runtime.origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__snake));
    const result = await page.evaluate(async (scenario) => {
      const { OPENAI_ENDPOINT } = await import("/src/config.ts");
      const api = window.__snake;
      const session = window.__pixelSerpent.session;
      const realFetch = globalThis.fetch;
      const records = [];
      const samples = [];
      const aiErrors = new Map();
      const parsedResponses = new Set();
      let active = 0;
      let maxConcurrency = 0;
      let responseCount = 0;
      let abortCount = 0;
      let diedAtMs = null;
      let maxSampleGapMs = 0;
      let lastSampleAtMs = 0;
      const tokens = { up: "U", down: "D", left: "L", right: "R" };
      const directions = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

      /** greedy 按路线描述比较已知食物，单格候选则按请求时的棋盘比较。 */
      function choose(body, state) {
        const choices = body.questions?.[0]?.choices;
        if (!Array.isArray(choices) || !choices.length) throw new Error("Decisions 请求没有候选项。");
        if (scenario.policy === "first") return choices[0].value;
        if (scenario.policy === "straight") {
          return choices.find((choice) => choice.value === tokens[state.direction])?.value ?? choices[0].value;
        }
        const routeRanks = choices.map((choice) => {
          const eat = /\b(?:eatAt|known_food_eat_step)=(-|none|\d+)(?=\s|;|$)/.exec(choice.description ?? "");
          const progress = /\b(?:progress|food_progress)=(-?\d+(?:\.\d+)?)(?=\s|;|$)/.exec(choice.description ?? "");
          return eat && progress ? { value: choice.value, eatAt: ["-", "none"].includes(eat[1]) ? null : Number(eat[1]), progress: Number(progress[1]) } : null;
        });
        if (routeRanks.some((rank) => rank !== null)) {
          if (routeRanks.some((rank) => rank === null)) throw new Error("路线候选缺少已知食物的移动步数或距离变化。");
          routeRanks.sort((a, b) => Number(b.eatAt !== null) - Number(a.eatAt !== null) || (a.eatAt ?? 999) - (b.eatAt ?? 999) || b.progress - a.progress);
          return routeRanks[0].value;
        }
        if (choices.some((choice) => /\bmoves=|\blength=/.test(choice.description ?? ""))) {
          throw new Error("路线候选缺少已知食物的移动步数或距离变化。");
        }
        const head = state.snake[0];
        const ranked = choices.map((choice, index) => {
          const delta = directions[choice.value];
          if (!delta) throw new Error("greedy 只支持单格方向，请将 policy 改成 first。");
          const [dx, dy] = delta;
          const next = { x: head.x + dx, y: head.y + dy };
          const eating = state.food?.x === next.x && state.food?.y === next.y;
          const body = state.snake.slice(0, eating ? undefined : -1);
          const unsafe = next.x < 0 || next.y < 0 || next.x >= state.width || next.y >= state.height ||
            body.some((cell) => cell.x === next.x && cell.y === next.y);
          const distance = state.food ? Math.abs(next.x - state.food.x) + Math.abs(next.y - state.food.y) : 0;
          return {
            value: choice.value,
            rank: (unsafe ? 10000 : 0) + distance * 10 +
              (choice.value === tokens[state.direction] ? 0 : 1) + index / 100,
          };
        });
        ranked.sort((a, b) => a.rank - b.rank);
        return ranked[0].value;
      }

      // 替换 fetch 后，真实传输层负责序列化请求和解析 Decisions 响应。
      globalThis.fetch = (input, init) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url !== OPENAI_ENDPOINT) return realFetch.call(globalThis, input, init);
        const body = JSON.parse(init.body);
        const state = api.getState();
        const record = {
          sequence: records.length + 1,
          dispatchTick: state.tick,
          dispatchMove: state.moveCount,
          choice: choose(body, state),
          dispatchMs: performance.now(),
          responseTick: null,
          responseMs: null,
          aborted: false,
          delayMs: Array.isArray(scenario.delayMs)
            ? scenario.delayMs[records.length % scenario.delayMs.length] : scenario.delayMs,
        };
        records.push(record);
        active += 1;
        maxConcurrency = Math.max(maxConcurrency, active);
        return new Promise((resolve, reject) => {
          let settled = false;
          /** 响应和取消共用结束操作，每次请求只扣减一次并发计数。 */
          function finish(aborted) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            init.signal?.removeEventListener("abort", onAbort);
            active -= 1;
            record.responseMs = performance.now();
            record.responseTick = api.getState().tick;
            record.aborted = aborted;
            if (aborted) {
              abortCount += 1;
              reject(new DOMException("测试请求已取消", "AbortError"));
            } else {
              responseCount += 1;
              resolve(new Response(JSON.stringify({
                answers: [{ type: "choice", name: "next_move", choice: record.choice, confidence: 1 }],
              }), { status: 200, headers: { "Content-Type": "application/json" } }));
            }
          }
          /** 将会话的取消信号转换成假 fetch 的 AbortError。 */
          function onAbort() { finish(true); }
          const timer = setTimeout(() => finish(false), record.delayMs);
          init.signal?.addEventListener("abort", onAbort, { once: true });
          if (init.signal?.aborted) onAbort();
        });
      };
      api.ai.clearMock();
      session.setCredentials("headless-test-placeholder");
      const startedAtMs = performance.now();
      try {
        api.start({ seed: scenario.seed, ai: true, difficulty: scenario.difficulty });
        api.attach();
        const initialVisibility = document.visibilityState;
        /** 采样死亡时间、游戏时钟和解析结果，死亡后等待到固定窗口结束。 */
        function sample() {
          const elapsedMs = performance.now() - startedAtMs;
          maxSampleGapMs = Math.max(maxSampleGapMs, elapsedMs - lastSampleAtMs);
          lastSampleAtMs = elapsedMs;
          const state = api.getState();
          if (state.phase === "over" && diedAtMs === null) diedAtMs = elapsedMs;
          samples.push({ elapsedMs, tick: state.tick, moves: state.moveCount,
            eaten: state.eaten, score: state.score, phase: state.phase });
          for (const entry of api.getAiLog()) {
            if (entry.error) aiErrors.set(entry.requestId, entry.error);
            else parsedResponses.add(entry.requestId);
          }
        }
        sample();
        await new Promise((resolve) => {
          const sampler = setInterval(sample, 25);
          setTimeout(() => {
            clearInterval(sampler);
            sample();
            resolve();
          }, scenario.durationMs);
        });
        api.detach();
        const elapsedMs = performance.now() - startedAtMs;
        const state = api.getState();
        const aliveElapsedMs = diedAtMs ?? elapsedMs;
        const clockRatio = state.tick / (aliveElapsedMs * 60 / 1000);
        const activeAtEnd = active;
        const abortsBeforeCleanup = abortCount;
        const aiLog = api.getAiLog();
        session.stopAi();
        return {
          scenario,
          elapsedMs,
          ticks: state.tick,
          moves: state.moveCount,
          score: state.score,
          eaten: state.eaten,
          phase: state.phase,
          overReason: state.overReason,
          survivedMs: Math.min(aliveElapsedMs, scenario.durationMs),
          frozenAfterDeathMs: diedAtMs === null ? 0 : elapsedMs - diedAtMs,
          requests: records.length,
          responseCount,
          parsedResponseCount: parsedResponses.size,
          /** 观察窗口内是否至少有一个响应完成真实解析。 */
          decisionParsed: parsedResponses.size > 0,
          abortCount,
          cleanupAbortCount: abortCount - abortsBeforeCleanup,
          maxConcurrency,
          activeAtEnd,
          activeAfterCleanup: active,
          clockRatio,
          clockDriftMs: aliveElapsedMs - state.tick * 1000 / 60,
          maxSampleGapMs,
          clockHealthy: clockRatio >= 0.9 && clockRatio <= 1.1 && maxSampleGapMs <= 250 &&
            elapsedMs <= scenario.durationMs * 1.05,
          initialVisibility,
          finalVisibility: document.visibilityState,
          invariantReport: api.getInvariantReport(),
          aiErrors: Array.from(aiErrors.values()),
          aiLog,
          samples,
          records: records.map((record) => ({
            ...record,
            dispatchMs: record.dispatchMs - startedAtMs,
            responseMs: record.responseMs === null ? null : record.responseMs - startedAtMs,
            observedLatencyMs: record.responseMs === null ? null : record.responseMs - record.dispatchMs,
          })),
        };
      } finally {
        api.detach();
        session.stopAi();
        session.clearKey();
        globalThis.fetch = realFetch;
      }
    }, scenario);
    const passed = diagnosticsOk(diagnostics) && result.invariantReport.ok &&
      result.requests > 0 && result.parsedResponseCount === result.responseCount && result.aiErrors.length === 0 &&
      result.maxConcurrency === 1 && result.activeAfterCleanup === 0 && result.clockHealthy &&
      result.initialVisibility === "visible" && result.finalVisibility === "visible";
    return { ...result, diagnostics, passed };
  } catch (error) {
    return { scenario, error: error.message, diagnostics, passed: false };
  } finally {
    await checked.context.close();
  }
}

/** 限制同时打开的页面数量，各场景使用独立存储和真实浏览器时钟。 */
async function runParallel(runtime, scenarios, concurrency) {
  const results = new Array(scenarios.length);
  let next = 0;
  /** 取下一个场景，同一 worker 完成后释放浏览器 context。 */
  async function worker() {
    while (next < scenarios.length) {
      const index = next++;
      results[index] = await runScenario(runtime, scenarios[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return results;
}

/** 运行并行延迟实验，保存完整记录，并打印固定窗口的得分和存活摘要。 */
async function main() {
  const options = readBrowserOptions(process.argv.slice(2), true);
  if (options.help) {
    printBrowserHelp(true);
    console.log("\npassed 和 PASS 只表示样本通过运行约束、页面和时钟检查，零响应样本也可通过。\ndecisionParsed 表示观察窗口内有响应完成解析。此工具不统计 API 动作的执行次数。");
    return;
  }
  const scenarios = await readScenarios(options.scenarios);
  const loadBefore = loadavg();
  const runtime = await openBrowser(options);
  try {
    const results = await runParallel(runtime, scenarios, options.concurrency);
    const report = {
      createdAt: new Date().toISOString(),
      origin: runtime.origin,
      browserVersion: runtime.browser.version(),
      realModelMeasured: false,
      validationScope: "passed 和 PASS 只表示样本通过运行约束、页面和时钟检查。响应解析查看每局的 decisionParsed。零响应样本也可通过。此工具不统计 API 动作的执行次数。",
      greedyChoiceModes: ["按公开路线描述比较已知食物", "按请求时棋盘比较单格方向"],
      cpuCount: cpus().length,
      loadBefore,
      loadAfter: loadavg(),
      concurrency: options.concurrency,
      passed: results.every((result) => result.passed),
      results,
    };
    await saveBrowserReport(options.output, report);
    const summary = { ...report, results: results.map(({ samples, records, aiLog, ...result }) => result) };
    console.log(`${report.passed ? "PASS" : "FAIL"} ${JSON.stringify(summary, null, 2)}`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

await main().catch((error) => {
  console.error(`FAIL 延迟实验失败。${error.message}`);
  process.exitCode = 1;
});
