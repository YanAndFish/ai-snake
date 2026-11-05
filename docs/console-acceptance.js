/* Run in the browser console on the game page. It prints PASS or throws. */
(async () => {
  const api = window.__snake;
  if (!api) throw new Error("window.__snake is missing");
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const same = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message);

  api.ai.clearMock();
  api.start({ seed: 12345 });
  const first = api.getState();
  api.start({ seed: 12345 });
  same(first, api.getState(), "fixed seed produced a different state");

  api.start({ seed: 2024 });
  const start = api.getState();
  assert(start.phase === "playing", "start did not enter playing");
  assert(start.snake.length === 3, "start length is not 3");
  api.stepTicks(1);
  assert(api.getState().tick === start.tick + 1, "tick did not advance");
  api.pause();
  const paused = api.getState();
  api.stepTicks(120);
  assert(api.getState().tick === paused.tick, "pause advanced the tick");
  assert(api.getState().phase === "paused", "pause did not hold phase");
  api.resume();

  api.start({ seed: 77 });
  const head0 = api.getState().snake[0];
  api.setSnake([head0, { x: head0.x - 1, y: head0.y }, { x: head0.x - 2, y: head0.y }], "right");
  api.setFood({ x: head0.x + 1, y: head0.y });
  api.stepMoves(1);
  assert(api.getState().score === 10, "food did not add 10 points");
  assert(api.getState().snake.length === 4, "food did not grow the snake");
  assert(api.getState().food !== null, "food did not respawn");

  api.start({ seed: 78 });
  api.setSnake(
    [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ],
    "down",
  );
  api.stepMoves(1);
  assert(api.getState().phase === "playing", "moving into the tail should be legal");

  api.start({ seed: 79 });
  api.setSnake(
    [
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
    ],
    "left",
  );
  api.stepMoves(1);
  assert(api.getState().phase === "over", "wall crash did not end the run");
  assert(api.getState().overReason === "wall", "wall crash reason is wrong");

  api.start({ seed: 86 });
  api.setSnake(
    [
      { x: 17, y: 9 },
      { x: 16, y: 9 },
      { x: 15, y: 9 },
    ],
    "right",
  );
  api.setFood({ x: 0, y: 0 });
  const wallScene = window.__pixelSerpent.scene;
  wallScene.render(api.getState(), 1, 0, 0);
  api.stepMoves(1);
  wallScene.render(api.getState(), 1, 0, 0);
  api.stepMoves(1);
  wallScene.render(api.getState(), 1, 0, 0);
  assert(api.getState().phase === "over" && api.getState().overReason === "wall", "wall hit did not end the run");
  const wallHeadX = wallScene.headMesh.position.x;
  assert(
    Math.abs(wallHeadX - (api.getState().snake[0].x + 0.5)) < 0.01,
    `head recoiled after the wall hit: ${wallHeadX}`,
  );

  api.start({ seed: 80 });
  api.setSnake(
    [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ],
    "right",
  );
  api.stepMoves(1);
  assert(api.getState().phase === "over", "self crash did not end the run");
  assert(api.getState().overReason === "self", "self crash reason is wrong");

  api.start({ seed: 81 });
  api.setDirection("left");
  api.stepMoves(1);
  assert(api.getState().direction === "right", "reverse direction was accepted");

  assert(!document.querySelector("#difficulty"), "the old difficulty select still exists");
  const fastButtons = Array.from(document.querySelectorAll('[data-difficulty="fast"]'));
  assert(fastButtons.length >= 2, "difficulty button groups are missing");
  fastButtons[0].click();
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert(api.getState().difficulty === "fast", "difficulty button did not update the run");
  assert(
    fastButtons.every((button) => button.getAttribute("aria-pressed") === "true"),
    "difficulty button groups did not sync",
  );
  api.setDifficulty("normal");

  api.start({ seed: 84 });
  assert(api.getState().difficulty === "normal", "default difficulty is not normal");
  assert(api.setDifficulty("fast").moveEveryTicks === 8, "fast difficulty did not speed up");
  assert(api.setDifficulty("chill").moveEveryTicks === 13, "chill difficulty did not slow down");
  api.setDifficulty("normal");

  api.ai.useMock({ moves: ["up"], reason: "restart mock" });
  api.start({ seed: 85 });
  api.setSnake([{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], "left");
  api.stepMoves(1);
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert(api.getState().phase === "over", "wall crash did not reach the over overlay");
  document.querySelector("#restart-over-ai").click();
  await api.ai.waitForIdle(2000);
  assert(api.getState().phase === "playing", "AI restart did not start a run");
  assert(api.getState().control === "ai", "AI restart did not take AI control");
  api.ai.clearMock();

  api.start({ seed: 82 });
  const observation = api.getObservation();
  assert(observation.prompt.includes("board 19x19"), "prompt lacks board size");
  assert(observation.prompt.includes("head ("), "prompt lacks head coordinates");
  assert(observation.prompt.includes("food ("), "prompt lacks food coordinates");
  assert(!observation.prompt.includes("MAP"), "prompt still contains a text map");
  assert(!document.querySelector("#observation"), "observation map is still in the DOM");
  assert(observation.prompt.includes("MOVE ANALYSIS"), "prompt lacks the move analysis");
  assert(observation.prompt.includes("DELAY"), "prompt lacks latency context");
  assert(observation.prompt.includes("HIST"), "prompt lacks history context");
  assert(observation.prompt.includes("SCEN"), "prompt lacks execution scenarios");
  assert(observation.prompt.includes("TASK"), "prompt lacks the decision task");

  api.start({ seed: 87 });
  api.stepMoves(1);
  assert(api.getState().phase === "playing", "manual step did not keep the run alive");

  const rendered = window.__pixelSerpent.scene;
  const target = rendered.cameraTarget;
  assert(rendered.camera, "scene camera is missing");
  assert(Math.abs(rendered.cameraHome.x - target.x) < 0.001, "camera must not yaw");
  assert(rendered.cameraHome.y > target.y, "camera must look down");

  // 同一蛇头位置替换身体时，渲染应立即显示新的弯道。
  api.setSnake([{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }], "right");
  rendered.render(api.getState(), 0, 0, 0);
  api.setSnake([{ x: 9, y: 9 }, { x: 9, y: 10 }, { x: 8, y: 10 }], "up");
  rendered.render(api.getState(), 0, 0, 0);
  assert(rendered.snakePoints[2] === 9.5 && rendered.snakePoints[3] === 10.5, "替换身体后，弯道没有立即更新");
  const bodyPositions = rendered.bodyMesh.geometry.getAttribute("position");
  assert(rendered.bodyMesh.geometry.drawRange.count > 0, "蛇身网格没有可绘制的三角形");
  assert(Array.from(bodyPositions.array).every(Number.isFinite), "蛇身顶点包含无效坐标");
  for (let i = 1; i < bodyPositions.array.length; i += 3) {
    if (i >= (api.getState().snake.length - 1) * 6 * 6 + 6) break;
    assert(Math.abs(bodyPositions.array[i] - 0.09) < 0.0001, "蛇身应使用同一高度的平面像素贴图");
  }
  assert(rendered.headMesh.isMesh, "蛇头应使用与蛇身一致的俯视平面");
  assert(Math.abs(rendered.headMesh.position.y - 0.092) < 0.0001, "蛇头与身体不在同一俯视平面");
  const shadowPositions = rendered.bodyShadow.geometry.getAttribute("position");
  assert(rendered.bodyShadow.geometry.drawRange.count === rendered.bodyMesh.geometry.drawRange.count, "蛇身阴影没有覆盖整条身体");
  const bodyX = (bodyPositions.getX(0) + bodyPositions.getX(1)) / 2;
  const bodyZ = (bodyPositions.getZ(0) + bodyPositions.getZ(1)) / 2;
  const shadowX = (shadowPositions.getX(0) + shadowPositions.getX(1)) / 2;
  const shadowZ = (shadowPositions.getZ(0) + shadowPositions.getZ(1)) / 2;
  assert(Math.abs(shadowX - bodyX - 0.08) < 0.0001, "蛇身阴影的横向偏移不正确");
  assert(Math.abs(shadowZ - bodyZ - 0.13) < 0.0001, "蛇身阴影的纵向偏移不正确");

  api.ai.useMock(() => new Promise((resolve) => {
    window.setTimeout(() => resolve({ moves: ["up"], reason: "slow mock" }), 60);
  }));
  api.start({ seed: 83, ai: true });
  assert(api.getState().phase === "playing", "AI start paused the run");
  api.stepMoves(2);
  assert(api.getState().moveCount === 2, "the snake did not move while the request was pending");
  assert(api.getState().phase === "playing", "the AI request halted the run");
  await api.ai.waitForIdle(2000);
  assert(api.ai.getStatus().state === "ready", "mock decision did not become ready");
  assert(api.ai.getStatus().latencyMs >= 50, "慢请求的耗时没有计入状态");
  const beforeHead = api.getState().snake[0];
  api.stepMoves(1);
  assert(api.getState().snake[0].y === beforeHead.y - 1, "AI move was not applied");
  await api.ai.waitForIdle(2000);
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  const decisionLog = api.getAiLog();
  const newest = decisionLog[decisionLog.length - 1];
  assert(newest.latencyMs >= 50, "决策记录缺少请求耗时");
  assert(document.querySelector("#ai-latency").textContent.includes("P90"), "AI 面板没有显示延迟统计");
  assert(document.querySelector("#ai-log").textContent.startsWith(`#${newest.requestId} ·`), "最新决策记录没有排在顶部");

  await document.fonts.ready;
  assert(document.querySelector("#restart-over-ai"), "AI restart button is missing");
  const manualButton = document.querySelector("#start-manual");
  assert(manualButton, "manual start button is missing");
  manualButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert(window.__pixelSerpent.audio.isMusicRunning, "background music did not start");
  api.ai.clearMock();
  const keyInput = document.querySelector("#api-key");
  assert(keyInput, "key input is missing");
  keyInput.value = "sk-browser-acceptance-secret";
  api.ai.useMock({ moves: ["up"], reason: "key probe" });
  const aiButton = document.querySelector("#start-ai");
  assert(aiButton, "AI start button is missing");
  aiButton.click();
  await api.ai.waitForIdle(2000);
  assert(keyInput.value === "", "key input did not clear after starting AI");
  const storage =
    JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
  const visible =
    document.body.innerText + JSON.stringify(api.getState()) + JSON.stringify(api.getAiLog());
  assert(!storage.includes("sk-browser-acceptance-secret"), "API key leaked into storage");
  assert(!visible.includes("sk-browser-acceptance-secret"), "API key leaked into the DOM or state");

  document.querySelector("#stop-ai")?.click();
  api.ai.clearMock();
  api.attach();
  const report = api.getInvariantReport();
  assert(report.ok, `invariants failed: ${report.violations.join(", ")}`);
  console.log("PASS", {
    tick: api.getState().tick,
    score: api.getState().score,
    aiLog: api.getAiLog().length,
  });
})();
