import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";

const ENDPOINT = "https://api.openai.com/v1/decisions";
let keyForRedaction = "";

/**
 * 每局的源码、模型和固定计分窗口。
 * @typedef {object} LiveScenario
 * @property {string} name 报告中的场景名称。
 * @property {string} root 待测源码的绝对目录。
 * @property {number} seed 游戏随机种子。
 * @property {number} durationMs 固定计分窗口，单位毫秒。
 * @property {"chill" | "normal" | "fast"} difficulty 游戏难度。
 * @property {string | null} model 模型名称；null 使用待测源码的默认值。
 * @property {"full" | "compact-summary"} prompt 本局请求使用的提示词变体。
 * @property {number | null} round 同轮场景同时开始，全部结束后运行下一轮；null 使用普通页面池。
 */

/** 读取命令参数，真实实验的页面总并发最多为 2。 */
function readOptions(args) {
  const options = { root: process.cwd(), seeds: [1, 17, 83, 101, 137], durationMs: 30000,
    concurrency: 1, difficulty: "normal", model: null, prompt: "full", matrix: null,
    scenarios: null, output: null, envFile: null, executablePath: process.env.CHROME_EXECUTABLE,
    selfCheck: false, help: false };
  const flags = new Map([["--root", "root"], ["--seeds", "seeds"], ["--duration-ms", "durationMs"],
    ["--concurrency", "concurrency"], ["--difficulty", "difficulty"], ["--model", "model"],
    ["--prompt", "prompt"], ["--matrix", "matrix"], ["--scenarios", "scenarios"],
    ["--output", "output"], ["--env-file", "envFile"], ["--executable", "executablePath"]]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") { options.help = true; continue; }
    if (flag === "--self-check") { options.selfCheck = true; continue; }
    const name = flags.get(flag);
    if (!name) throw new Error(`无法识别参数 ${flag}，运行 --help 查看用法。`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 需要一个值。`);
    if (name === "seeds") options.seeds = value.split(",").map(Number);
    else if (["durationMs", "concurrency"].includes(name)) options[name] = Number(value);
    else options[name] = value;
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 2) {
    throw new Error("--concurrency 只能为 1 或 2。");
  }
  if (!options.seeds.length || options.seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new Error("--seeds 需要逗号分隔的种子，每个种子为 0 到 4294967295 的整数。");
  }
  if (options.matrix && options.scenarios) throw new Error("--matrix 和 --scenarios 请选择一个。");
  return options;
}

/** 显示真实评估和无网络自检的用法。 */
function printHelp() {
  console.log(`用法：node scripts/evaluate-live.mjs [选项]

使用系统 Chrome、生产 session 和真实 60 Hz rAF。真实请求仅发往 ${ENDPOINT}。
API Key 从调用进程 OPENAI_API_KEY 读取，或用 --env-file 明确指定文件。

  --root 路径           待测源码目录，默认当前目录
  --seeds 列表          固定种子，默认 1,17,83,101,137
  --duration-ms 毫秒    每局固定计分窗口，默认 30000
  --difficulty 名称    chill、normal 或 fast，默认 normal
  --model 名称         覆盖模型，省略时使用源码默认值
  --prompt 名称        full 或 compact-summary，默认 full
  --matrix 路径        读取变体数组，每个对象支持 name、root、model、prompt
  --scenarios 路径     读取逐局场景数组，支持上述参数和 seed、durationMs、difficulty、round
  --concurrency 数量   同时运行的页面总数，默认 1，最多 2
  --env-file 路径      从指定文件的 OPENAI_API_KEY 读取凭据
  --output 路径        保存完整 JSON 报告
  --executable 路径    指定 Chrome 可执行文件
  --self-check         使用本地假响应检查脚本，不读取 Key、不调用 API
  --help               显示帮助

矩阵按种子轮换变体顺序。每局结束会取消在途请求。
逐局场景填写 round 时，同轮场景全部结束后才开始下一轮。
full 使用源码生成的完整请求。compact-summary 只压缩路线说明。
passed 仅表示页面、时钟和清理检查通过。模型效果请比较 score、survivedMs、executionStats。
原始请求 payload 包含游戏提示词。报告不记录 Authorization、Key、原始响应和浏览器日志。`);
}

/** 把输入配置整理成固定字段，逐局结果不会包含配置里的额外字段。 */
function normalizeScenario(value, defaults, name) {
  const scenario = { name: value.name ?? name, root: resolve(value.root ?? defaults.root),
    seed: value.seed ?? defaults.seeds[0], durationMs: value.durationMs ?? defaults.durationMs,
    difficulty: value.difficulty ?? defaults.difficulty, model: value.model ?? defaults.model,
    prompt: value.prompt ?? defaults.prompt, round: value.round ?? null };
  if (typeof scenario.name !== "string" || !scenario.name.trim()) throw new Error("场景需要非空 name。");
  if (!Number.isInteger(scenario.seed) || scenario.seed < 0 || scenario.seed > 0xffffffff) throw new Error("场景 seed 必须是 0 到 4294967295 的整数。");
  if (!Number.isFinite(scenario.durationMs) || scenario.durationMs < 1000) throw new Error("durationMs 至少为 1000 毫秒。");
  if (!["chill", "normal", "fast"].includes(scenario.difficulty)) throw new Error("difficulty 只能是 chill、normal 或 fast。");
  if (!["full", "compact-summary"].includes(scenario.prompt)) throw new Error("prompt 只能是 full 或 compact-summary。");
  if (scenario.model !== null && (typeof scenario.model !== "string" || !scenario.model.trim())) throw new Error("model 需要非空字符串。");
  if (scenario.round !== null && (!Number.isInteger(scenario.round) || scenario.round < 0)) throw new Error("round 必须是非负整数。");
  return scenario;
}

/** 展开变体矩阵，并在每个种子上轮换变体的先后顺序。 */
async function readScenarios(options) {
  const path = options.scenarios ?? options.matrix;
  const input = path ? JSON.parse(await readFile(path, "utf8")) : [{ name: "live", root: options.root }];
  if (!Array.isArray(input) || !input.length || input.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("场景或矩阵文件必须是非空 JSON 对象数组。");
  }
  if (options.scenarios) {
    const scenarios = input.map((item, index) => normalizeScenario(item, options, `game-${index + 1}`));
    if (scenarios.some((scenario) => scenario.round !== null)) {
      if (scenarios.some((scenario) => scenario.round === null)) throw new Error("使用 round 时，每个场景都必须填写 round。");
      const counts = new Map();
      for (const scenario of scenarios) counts.set(scenario.round, (counts.get(scenario.round) ?? 0) + 1);
      if ([...counts.values()].some((count) => count > options.concurrency)) throw new Error("每轮的场景数不能超过 --concurrency。");
    }
    return scenarios;
  }
  const scenarios = [];
  options.seeds.forEach((seed, seedIndex) => {
    for (let offset = 0; offset < input.length; offset += 1) {
      const index = (offset + seedIndex) % input.length;
      scenarios.push(normalizeScenario({ ...input[index], seed }, options, `variant-${index + 1}`));
    }
  });
  return scenarios;
}

/** 从调用进程或显式指定的文件读取 Key，返回值仅供当前进程和页面内存使用。 */
async function readKey(options) {
  if (options.selfCheck) return "self-check-placeholder";
  let key = process.env.OPENAI_API_KEY?.trim();
  if (!key && options.envFile) {
    let values;
    try { values = parseEnv(await readFile(resolve(options.envFile), "utf8")); }
    catch { throw new Error("无法读取 --env-file 指定的文件。请检查路径和文件格式。"); }
    key = values.OPENAI_API_KEY?.trim();
  }
  if (!key) throw new Error("缺少 OPENAI_API_KEY。请在调用进程中设置，或使用 --env-file 指定文件。");
  return key;
}

/** 按相对路径和文件内容计算 src 下所有 TypeScript 文件的稳定 hash。 */
async function snapshotSource(root) {
  const files = [];
  /** 只读取 src 内的普通目录和 .ts 文件，忽略符号链接。 */
  async function visit(relative) {
    const entries = await readdir(resolve(root, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  }
  await visit("src");
  files.sort();
  const combined = createHash("sha256");
  const manifest = [];
  for (const path of files) {
    const bytes = await readFile(resolve(root, path));
    combined.update(path).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
    manifest.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { root, sha256: combined.digest("hex"), files: manifest };
}

/** 为每份源码创建独立 Vite，关闭 .env 自动加载。 */
async function openRuntime(options, scenarios) {
  const servers = new Map();
  const caches = [];
  let browser;
  /** 关闭本次 Chrome、Vite 和临时缓存。 */
  async function close() {
    await browser?.close();
    await Promise.all([...servers.values()].map(({ server }) => server.close()));
    await Promise.all(caches.map((path) => rm(path, { recursive: true, force: true })));
  }
  try {
    for (const root of new Set(scenarios.map((scenario) => scenario.root))) {
      const cacheDir = await mkdtemp(join(tmpdir(), "ai-snake-live-vite-"));
      caches.push(cacheDir);
      const canonicalRoot = await realpath(root);
      const dependencyRoot = await realpath(resolve(root, "node_modules"));
      const canonicalCache = await realpath(cacheDir);
      const server = await createServer({ root: canonicalRoot, configFile: false, envFile: false, envDir: false,
        cacheDir, logLevel: "silent", server: { host: "127.0.0.1", port: 0, strictPort: true,
          open: false, fs: { allow: [canonicalRoot, dependencyRoot, canonicalCache] } } });
      servers.set(root, { server, origin: null });
      await server.listen();
      const address = server.httpServer.address();
      if (!address || typeof address === "string") throw new Error("Vite 没有返回可用端口。");
      servers.get(root).origin = `http://127.0.0.1:${address.port}`;
    }
    browser = await chromium.launch({ channel: options.executablePath ? undefined : "chrome",
      executablePath: options.executablePath, headless: true,
      args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
    return { browser, servers, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** 在真实浏览器时钟下运行一局，观察原生 fetch 和生产解析结果。 */
async function runBrowserGame({ scenario, apiKey, endpoint }) {
  const api = window.__snake;
  const session = window.__pixelSerpent.session;
  const controller = session.controller;
  if (!controller || typeof controller.request !== "function") throw new Error("待测源码没有可观察的 AI controller。");
  const realFetch = globalThis.fetch;
  const realRequest = controller.request;
  const realStepTick = session.stepTick;
  const records = [];
  const executions = [];
  let latestParsedRequestId = null;
  const samples = [];
  const parsed = new Map();
  let currentRecord = null;
  let activeFetches = 0;
  let maxActiveFetches = 0;
  let startedAtMs = 0;
  let diedAtMs = null;
  let maxSampleGapMs = 0;
  let previousSampleMs = 0;
  const now = () => performance.now() - startedAtMs;
  const safeError = (error) => ({ name: error?.name ?? "Error", message: String(error?.message ?? error).split(apiKey).join("[已隐藏 Key]") });

  /** 保存观察到的棋盘，省略 RNG 和凭据，供请求与执行时间对照。 */
  function observeBoard(state) {
    return { tick: state.tick, moveCount: state.moveCount, direction: state.direction,
      snake: state.snake.map((cell) => ({ ...cell })), food: state.food === null ? null : { ...state.food },
      moveEveryTicks: state.moveEveryTicks, moveAccumulator: state.moveAccumulator,
      score: state.score, phase: state.phase, overReason: state.overReason };
  }

  /** 记录实际移动及碰撞，观察过程只读取游戏输入和结果。 */
  session.stepTick = function () {
    const previousMove = this.state.moveCount;
    const previousPhase = this.state.phase;
    const directionInput = controller.plan[0] ?? null;
    const requestId = directionInput === null ? null : latestParsedRequestId;
    const actionInput = requestId === null ? null : parsed.get(requestId)?.selectedAction ?? directionInput;
    realStepTick.call(this);
    if (this.state.moveCount !== previousMove || (previousPhase === "playing" && this.state.phase === "over")) {
      executions.push({ elapsedMs: now(), requestId, actionInput, directionInput, state: observeBoard(this.state) });
    }
  };

  /** 压缩两处路线说明，保留已检查的路线长度和食物指标。 */
  function compactBody(body) {
    if (!body.input.startsWith("SNAKE/3 ROUTES\n")) throw new Error("compact-summary 只支持 SNAKE/3 ROUTES 提示词。");
    const compact = (text) => text.replace(/\bmoves=[^\s]+\s*/g, "");
    body.input = body.input.split("\n").filter((line) => !line.startsWith("Body=")).map(compact).join("\n");
    for (const question of body.questions) {
      question.instructions = compact(question.instructions);
      for (const choice of question.choices) choice.description = compact(choice.description);
    }
    return body;
  }

  // 仅观察控制器参数和解析结果。真实请求仍由生产 transport 发出。
  controller.request = function (args) {
    const state = api.getState();
    const record = { sequence: records.length + 1, requestId: args.requestId, model: args.model,
      dispatchMs: now(), dispatchTick: state.tick, dispatchMove: state.moveCount, dispatchState: observeBoard(state), payload: null,
      httpStatus: null, apiRequestId: null, headersLatencyMs: null, fetchLatencyMs: null,
      parsedLatencyMs: null, parsedAtMs: null, responseTick: null, responseMove: null,
      responseComplete: false, choice: null, selectedAction: null, selectedDirection: null, responseState: null,
      expectedStartMove: /^Start move=(\d+)/m.exec(args.prompt)?.[1] ?? null, expiredOnArrival: null,
      abortAtMs: null, abortReason: null, error: null, parsed: false };
    records.push(record);
    currentRecord = record;
    const promise = realRequest.call(this, args);
    currentRecord = null;
    promise.then((moves) => {
      record.parsed = true;
      latestParsedRequestId = args.requestId;
      record.responseState = observeBoard(api.getState());
      record.selectedDirection = moves[0] ?? null;
      const entry = controller.getLog().find((item) => item.requestId === args.requestId && item.error === null);
      record.selectedAction = entry?.action ?? record.selectedDirection;
      record.choice = { up: "U", down: "D", left: "L", right: "R", keep: "KEEP" }[record.selectedAction] ?? null;
      record.responseMove = api.getState().moveCount;
      record.expiredOnArrival = record.expectedStartMove === null ? null : record.responseMove > Number(record.expectedStartMove);
      record.parsedAtMs = now();
      record.parsedLatencyMs = now() - record.dispatchMs;
      parsed.set(args.requestId, record);
    }, (error) => {
      record.parsedAtMs = now();
      record.parsedLatencyMs = now() - record.dispatchMs;
      record.error = safeError(error);
    });
    return promise;
  };

  globalThis.fetch = async function (input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url !== endpoint) return realFetch.call(globalThis, input, init);
    const record = currentRecord;
    if (!record) throw new Error("无法关联 Decisions 请求与控制器请求。");
    const body = JSON.parse(init.body);
    record.payload = scenario.prompt === "compact-summary" ? compactBody(body) : body;
    const actualInit = scenario.prompt === "compact-summary" ? { ...init, body: JSON.stringify(record.payload) } : init;
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    let fetchSettled = false;
    /** 响应完成或取消时只扣减一次活动 fetch 数。 */
    function finishFetch(complete = false) {
      if (fetchSettled) return;
      fetchSettled = true;
      activeFetches -= 1;
      record.fetchLatencyMs = now() - record.dispatchMs;
      record.responseTick = api.getState().tick;
      record.responseComplete = complete;
      init.signal?.removeEventListener("abort", onAbort);
    }
    /** 记录游戏死亡或观察窗口结束导致的取消。 */
    function onAbort() {
      if (fetchSettled) return;
      record.abortAtMs = now();
      record.abortReason = api.getState().phase === "over" ? "death" : "cleanup";
    }
    init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await realFetch.call(globalThis, input, actualInit);
      record.httpStatus = response.status;
      record.apiRequestId = response.headers.get("x-request-id");
      record.headersLatencyMs = now() - record.dispatchMs;
      // clone 的读取独立于生产 parser。活动计数覆盖整个响应体的接收过程。
      response.clone().arrayBuffer().then(() => finishFetch(true), () => finishFetch(false));
      return response;
    } catch (error) {
      finishFetch();
      throw error;
    } finally {
      // AbortSignal 还会取消已收到响应头但尚未读完的响应体。
      if (fetchSettled) init.signal?.removeEventListener("abort", onAbort);
    }
  };

  api.ai.clearMock();
  session.setCredentials(apiKey);
  if (scenario.model !== null) session.setModel(scenario.model);
  startedAtMs = performance.now();
  const initialVisibility = document.visibilityState;
  try {
    api.start({ seed: scenario.seed, ai: true, difficulty: scenario.difficulty });
    api.attach();
    /** 记录死亡时间和固定窗口得分，游戏死亡后继续等待到窗口结束。 */
    function sample() {
      const elapsedMs = now();
      const state = api.getState();
      maxSampleGapMs = Math.max(maxSampleGapMs, elapsedMs - previousSampleMs);
      previousSampleMs = elapsedMs;
      if (state.phase === "over" && diedAtMs === null) diedAtMs = elapsedMs;
      samples.push({ elapsedMs, tick: state.tick, moves: state.moveCount, score: state.score, phase: state.phase });
    }
    sample();
    await new Promise((resolveWindow) => {
      const timer = setInterval(sample, 25);
      setTimeout(() => { clearInterval(timer); sample(); resolveWindow(); }, scenario.durationMs);
    });
    api.detach();
    const elapsedMs = now();
    const state = api.getState();
    const aliveElapsedMs = diedAtMs ?? elapsedMs;
    const activeAtEnd = activeFetches;
    const executionStats = typeof api.ai.getExecutionStats === "function" ? api.ai.getExecutionStats() : null;
    const invariantReport = api.getInvariantReport();
    session.stopAi();
    await api.ai.waitForIdle(5000);
    const cleanupStartedAt = performance.now();
    while (activeFetches > 0 && performance.now() - cleanupStartedAt < 5000) {
      await new Promise((resolveIdle) => setTimeout(resolveIdle, 10));
    }
    const clockRatio = state.tick / (aliveElapsedMs * 60 / 1000);
    return { elapsedMs, ticks: state.tick, moves: state.moveCount, score: state.score, eaten: state.eaten,
      phase: state.phase, overReason: state.overReason, survived: state.phase === "playing",
      survivedMs: Math.min(aliveElapsedMs, scenario.durationMs), diedAtMs,
      requests: records.length, responseCount: records.filter((record) => record.httpStatus !== null).length,
      completedResponseCount: records.filter((record) => record.responseComplete).length,
      parsedResponseCount: parsed.size, decisionParsed: parsed.size > 0,
      decisionApplied: executionStats === null ? null : executionStats.apiMoves > 0,
      executionStats, maxActiveFetches, activeAtEnd, activeAfterCleanup: activeFetches,
      clockRatio, clockDriftMs: aliveElapsedMs - state.tick * 1000 / 60, maxSampleGapMs,
      clockHealthy: clockRatio >= 0.9 && clockRatio <= 1.1 && maxSampleGapMs <= 250 && elapsedMs <= scenario.durationMs * 1.05,
      initialVisibility, finalVisibility: document.visibilityState, invariantReport, samples, records, executions };
  } finally {
    api.detach();
    session.stopAi();
    session.clearKey();
    controller.request = realRequest;
    session.stepTick = realStepTick;
    globalThis.fetch = realFetch;
  }
}

/** 创建隔离页面，仅放行当前站点和固定 Decisions 地址。 */
async function runScenario(runtime, scenario, key, selfCheck) {
  const origin = runtime.servers.get(scenario.root).origin;
  const context = await runtime.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const diagnostics = { pageErrors: [], blockedRequests: [], failedResources: [] };
  const page = await context.newPage();
  const networkRequests = [];
  const publicUrl = (value) => { const url = new URL(value); return `${url.origin}${url.pathname}`; };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url() === ENDPOINT && response.request().method() === "POST") {
      const item = { httpStatus: response.status(), apiRequestId: null };
      networkRequests.push(item);
      response.headerValue("x-request-id").then((value) => { item.apiRequestId = value; }).catch(() => {});
    } else if (response.status() >= 400) diagnostics.failedResources.push({ url: publicUrl(response.url()), status: response.status() });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.href !== ENDPOINT) {
      diagnostics.blockedRequests.push(publicUrl(url.href));
      return route.abort("blockedbyclient");
    }
    if (!selfCheck) return route.continue();
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,content-type",
      "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Expose-Headers": "x-request-id", "x-request-id": "self-check" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON();
    const choice = body.questions[0].choices.find((item) => item.value === "KEEP") ?? body.questions[0].choices[0];
    return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify({
      answers: [{ type: "choice", name: "next_move", choice: choice.value, confidence: 1 }],
    }) });
  });
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__snake));
    const result = await page.evaluate(runBrowserGame, { scenario, apiKey: key, endpoint: ENDPOINT });
    // CDP 可以读取未通过 CORS 暴露给页面的 x-request-id。响应保持请求顺序。
    let networkIndex = 0;
    for (const record of result.records) {
      if (record.httpStatus !== null) record.apiRequestId = networkRequests[networkIndex++]?.apiRequestId ?? record.apiRequestId;
      record.promptHash = createHash("sha256").update(record.payload?.input ?? "").digest("hex");
      record.payloadHash = createHash("sha256").update(JSON.stringify(record.payload)).digest("hex");
      record.errorKind = record.abortAtMs !== null ? `${record.abortReason}-abort`
        : record.httpStatus !== null && record.httpStatus >= 400 ? "http"
        : record.error ? (record.httpStatus === null ? "network" : "parse") : null;
    }
    const errors = { http: 0, network: 0, parse: 0, deathAbort: 0, cleanupAbort: 0 };
    const errorFields = { http: "http", network: "network", parse: "parse", "death-abort": "deathAbort", "cleanup-abort": "cleanupAbort" };
    for (const record of result.records) {
      if (record.errorKind) errors[errorFields[record.errorKind]] += 1;
    }
    const passed = Object.values(diagnostics).every((items) => items.length === 0) && result.invariantReport.ok &&
      result.requests > 0 && result.maxActiveFetches === 1 && result.activeAfterCleanup === 0 &&
      result.clockHealthy && result.initialVisibility === "visible" && result.finalVisibility === "visible";
    return { scenario, ...result, errors, diagnostics, passed };
  } catch (error) {
    return { scenario, error: error.message, diagnostics, passed: false };
  } finally {
    await context.close();
  }
}

/** 用一个页面池运行所有源码变体，总并发不超过命令指定值。 */
async function runMatrix(runtime, scenarios, options, key) {
  const results = new Array(scenarios.length);
  let next = 0;
  let completed = 0;
  /** 保存单局结果并输出不含请求内容的进度。 */
  async function run(index) {
    results[index] = await runScenario(runtime, scenarios[index], key, options.selfCheck);
    const row = results[index];
    completed += 1;
    console.log(JSON.stringify(redact({ completed, total: scenarios.length, name: row.scenario.name,
      seed: row.scenario.seed, round: row.scenario.round, score: row.score ?? null,
      survivedMs: row.survivedMs ?? null, passed: row.passed }, key)));
  }
  /** 每个 worker 完成并关闭一局页面后才取下一局。 */
  async function worker() {
    while (next < scenarios.length) {
      const index = next++;
      await run(index);
    }
  }
  if (scenarios[0].round !== null) {
    const rounds = [...new Set(scenarios.map((scenario) => scenario.round))].sort((a, b) => a - b);
    for (const round of rounds) {
      await Promise.all(scenarios.map((scenario, index) => scenario.round === round ? run(index) : null));
    }
  } else {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, scenarios.length) }, worker));
  }
  return results;
}

/** 输出前清除 Key，连异常消息和配置中的意外回显也一起处理。 */
function redact(value, key) {
  const json = JSON.stringify(value);
  const hidden = key ? json.split(key).join("[已隐藏 Key]") : json;
  return JSON.parse(hidden.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[已隐藏 Key]"));
}

/** 运行真实实验，保留逐局结果和实际发送的游戏提示词。 */
async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) return printHelp();
  const scenarios = await readScenarios(options);
  const key = await readKey(options);
  keyForRedaction = key;
  const roots = [...new Set(scenarios.map((scenario) => scenario.root))];
  const sourceBefore = await Promise.all(roots.map(snapshotSource));
  const loadBefore = loadavg();
  const runtime = await openRuntime(options, scenarios);
  try {
    const results = await runMatrix(runtime, scenarios, options, key);
    const sourceAfter = await Promise.all(roots.map(snapshotSource));
    const sourceStable = sourceBefore.every((source, index) => source.sha256 === sourceAfter[index].sha256);
    const report = redact({ createdAt: new Date().toISOString(), realApiMode: !options.selfCheck,
      realModelMeasured: !options.selfCheck && results.some((row) => row.records?.some((record) => record.httpStatus === 200 && record.parsed)),
      transportMode: "browser-native-fetch", selfCheck: options.selfCheck, endpoint: ENDPOINT,
      browserVersion: runtime.browser.version(), concurrency: options.concurrency, cpuCount: cpus().length,
      loadBefore, loadAfter: loadavg(), sourceBefore, sourceAfter, sourceStable,
      passed: sourceStable && results.every((row) => row.passed),
      validationScope: "passed 仅检查页面、时钟、单请求和清理。解析完成与实际执行分别查看 decisionParsed、decisionApplied。旧源码缺失来源统计时 executionStats 和 decisionApplied 为 null。",
      results }, key);
    if (options.output) {
      const target = resolve(options.output);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(`${report.passed ? "PASS" : "FAIL"} ${JSON.stringify({ realModelMeasured: report.realModelMeasured,
      games: results.length, passed: report.passed, output: options.output ? resolve(options.output) : null })}`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

await main().catch((error) => {
  console.error(`FAIL ${redact(error.message, keyForRedaction)}`);
  process.exitCode = 1;
});
