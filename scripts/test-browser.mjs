import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

/**
 * 无头浏览器命令的选项。
 * @typedef {object} BrowserOptions
 * @property {string | undefined} origin 已启动的服务地址。省略时启动独立 Vite。
 * @property {string | undefined} executablePath Chrome 可执行文件。省略时使用系统 Chrome。
 * @property {string | undefined} output JSON 结果路径。省略时只打印结果。
 * @property {string | undefined} scenarios 延迟实验的场景 JSON 文件。
 * @property {number} concurrency 同时运行的实验场景数。
 * @property {boolean} help 是否显示命令帮助。
 */

/**
 * 脚本创建的浏览器和服务。
 * @typedef {object} BrowserRuntime
 * @property {import("playwright").Browser} browser 本次启动的 Chrome。
 * @property {string} origin 游戏服务的根地址。
 * @property {() => Promise<void>} close 关闭 Chrome，并清理脚本创建的 Vite 和缓存。
 */

/**
 * 页面运行时收集到的异常。
 * @typedef {object} PageDiagnostics
 * @property {string[]} pageErrors 页面中未捕获的 JavaScript 错误。
 * @property {string[]} externalRequests 已拦截的站外 HTTP 地址。
 * @property {{url: string, status: number}[]} failedResponses HTTP 状态码大于等于 400 的响应。
 * @property {{url: string, error: string}[]} requestFailures 浏览器报告的请求失败。
 */

/**
 * 一个独立页面及其检查记录。
 * @typedef {object} CheckedPage
 * @property {import("playwright").BrowserContext} context 负责隔离存储和网络路由的 context。
 * @property {import("playwright").Page} page 运行游戏的页面。
 * @property {PageDiagnostics} diagnostics 该页面的异常记录。
 */

/** 读取命令选项，并在启动浏览器前拒绝无效参数。 */
export function readBrowserOptions(args, evaluation = false) {
  /** @type {BrowserOptions} */
  const options = {
    origin: process.env.SNAKE_ORIGIN || undefined,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
    output: process.env.SNAKE_OUTPUT || undefined,
    scenarios: undefined,
    concurrency: 4,
    help: false,
  };
  const flags = new Map([
    ["--origin", "origin"],
    ["--executable", "executablePath"],
    ["--output", "output"],
  ]);
  if (evaluation) {
    flags.set("--scenarios", "scenarios");
    flags.set("--concurrency", "concurrency");
  }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const name = flags.get(flag);
    if (!name) throw new Error(`无法识别参数 ${flag}，运行 --help 查看用法。`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 需要一个值。`);
    options[name] = name === "concurrency" ? Number(value) : value;
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency 必须是大于 0 的整数。");
  }
  if (options.origin) {
    let url;
    try {
      url = new URL(options.origin);
    } catch {
      throw new Error("--origin 必须是完整的 HTTP 或 HTTPS 地址。");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new Error("--origin 只接受服务根地址，例如 http://127.0.0.1:5173。");
    }
    options.origin = url.origin;
  }
  return options;
}

/** 显示控制台检查或延迟实验的命令用法。 */
export function printBrowserHelp(evaluation = false) {
  console.log(`用法：node scripts/${evaluation ? "evaluate-browser" : "test-browser"}.mjs [选项]

默认启动独立端口的 Vite，使用系统 Chrome 无头运行。

  --origin 地址       复用已启动的服务
  --executable 路径   指定 Chrome 可执行文件
  --output 路径       保存完整 JSON 结果
  --help              显示帮助${evaluation ? "\n  --scenarios 路径    读取场景 JSON 数组\n  --concurrency 数量  同时运行的场景数，默认 4" : ""}

也可设置 SNAKE_ORIGIN、CHROME_EXECUTABLE 和 SNAKE_OUTPUT。`);
}

/**
 * 启动 Chrome，省略 origin 时同时启动独立端口的 Vite。调用者负责 close。
 * @param {BrowserOptions} options 命令选项。
 * @returns {Promise<BrowserRuntime>} 本次浏览器和服务。
 */
export async function openBrowser(options) {
  let server;
  let cacheDirectory;
  let origin = options.origin;
  try {
    if (!origin) {
      const root = fileURLToPath(new URL("../", import.meta.url));
      // 多个 Vite 服务共用优化缓存时，旧页面可能收到 504。
      cacheDirectory = await mkdtemp(join(tmpdir(), "ai-snake-vite-"));
      const allowedDirectories = await Promise.all([
        realpath(root), realpath(cacheDirectory), realpath(resolve(root, "node_modules")),
      ]);
      server = await createServer({
        root,
        configFile: resolve(root, "vite.config.ts"),
        cacheDir: cacheDirectory,
        logLevel: "warn",
        server: { host: "127.0.0.1", port: 0, strictPort: true, open: false,
          fs: { allow: allowedDirectories } },
      });
      await server.listen();
      const address = server.httpServer.address();
      if (!address || typeof address === "string") throw new Error("Vite 没有返回可用的端口。");
      origin = `http://127.0.0.1:${address.port}`;
    }
    const browser = await chromium.launch({
      channel: options.executablePath ? undefined : "chrome",
      executablePath: options.executablePath,
      headless: true,
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    return {
      browser,
      origin,
      /** 关闭本次 Chrome 和脚本自己启动的 Vite。 */
      async close() {
        try {
          await browser.close();
        } finally {
          try {
            await server?.close();
          } finally {
            if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    await server?.close();
    if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 创建独立页面，阻止站外 HTTP 请求，并收集页面和资源错误。
 * @returns {Promise<CheckedPage>} 页面、context 和异常记录。
 */
export async function openCheckedPage(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const diagnostics = { pageErrors: [], externalRequests: [], failedResponses: [], requestFailures: [] };
  /** 记录地址时省略查询参数和登录信息。 */
  const publicUrl = (value) => {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.failedResponses.push({ url: publicUrl(response.url()), status: response.status() });
    }
  });
  page.on("requestfailed", (request) => diagnostics.requestFailures.push({
    url: publicUrl(request.url()),
    error: request.failure()?.errorText ?? "请求失败",
  }));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
    } else {
      diagnostics.externalRequests.push(publicUrl(url.href));
      await route.abort("blockedbyclient");
    }
  });
  return { context, page, diagnostics };
}

/** 判断页面是否发生异常，站外请求即使被拦截也会使检查失败。 */
export function diagnosticsOk(diagnostics) {
  return Object.values(diagnostics).every((entries) => entries.length === 0);
}

/** 按需保存完整结果，输出目录不存在时自动创建。 */
export async function saveBrowserReport(path, report) {
  if (!path) return;
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}

/** 执行仓库的控制台检查，失败时打印原因并以非零状态退出。 */
async function main() {
  const options = readBrowserOptions(process.argv.slice(2));
  if (options.help) return printBrowserHelp();
  const runtime = await openBrowser(options);
  const report = { createdAt: new Date().toISOString(), origin: runtime.origin,
    browserVersion: runtime.browser.version(), passed: false };
  let checked;
  try {
    checked = await openCheckedPage(runtime.browser, runtime.origin);
    const { page, diagnostics } = checked;
    let printedPass = false;
    page.on("console", (message) => {
      if (message.type() === "log" && message.text().startsWith("PASS")) printedPass = true;
    });
    await page.goto(runtime.origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__snake));
    report.result = await page.evaluate(async () => {
      const response = await fetch("/docs/console-acceptance.js");
      if (!response.ok) throw new Error("无法读取 docs/console-acceptance.js。");
      await eval(await response.text());
      return {
        state: window.__snake.getState(),
        invariantReport: window.__snake.getInvariantReport(),
        scenePresent: Boolean(window.__pixelSerpent.scene),
        visibilityState: document.visibilityState,
      };
    });
    if (!printedPass) throw new Error("控制台检查没有输出 PASS。");
    if (!report.result.invariantReport.ok || !report.result.scenePresent) {
      throw new Error("游戏约束检查失败，或 Three.js 场景没有创建。");
    }
    if (!diagnosticsOk(diagnostics)) throw new Error("页面出现异常或请求失败，查看 JSON 中的 diagnostics。");
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    report.diagnostics = checked?.diagnostics;
    await checked?.context.close();
    await runtime.close();
    await saveBrowserReport(options.output, report);
  }
  console.log(`${report.passed ? "PASS" : "FAIL"} ${JSON.stringify(report)}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error) => {
    console.error(`FAIL 浏览器检查失败。${error.message}`);
    process.exitCode = 1;
  });
}
