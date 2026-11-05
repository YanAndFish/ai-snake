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
  assert(observation.map.split("\n").length === api.getState().height + 2, "observation map row count is wrong");
  assert((observation.map.match(/H/g) || []).length === 1, "map needs one head");
  assert((observation.map.match(/\*/g) || []).length === 1, "map needs one food");
  const bodyCount = (observation.map.match(/s/g) || []).length;
  assert(bodyCount === api.getState().snake.length - 1, "map body count is wrong");
  assert(observation.prompt.includes("MOVE ANALYSIS"), "prompt lacks the move analysis");
  assert(observation.prompt.includes("TASK"), "prompt lacks the decision task");

  const rendered = window.__pixelSerpent.scene;
  const target = rendered.cameraTarget;
  assert(rendered.camera, "scene camera is missing");
  assert(Math.abs(rendered.cameraHome.x - target.x) < 0.001, "camera must not yaw");
  assert(rendered.cameraHome.y > target.y, "camera must look down");

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
  const beforeHead = api.getState().snake[0];
  api.stepMoves(1);
  assert(api.getState().snake[0].y === beforeHead.y - 1, "AI move was not applied");

  await document.fonts.ready;
  const observationNode = document.querySelector("#observation");
  const style = getComputedStyle(observationNode);
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `${style.fontSize} ${style.fontFamily}`;
  const cellWidth = measure.measureText("#".repeat(21)).width / 21;
  const cellHeight = parseFloat(style.lineHeight);
  assert(
    cellWidth / cellHeight > 0.8 && cellWidth / cellHeight < 1.25,
    `observation cells are not square: ${cellWidth.toFixed(2)}x${cellHeight.toFixed(2)}`,
  );

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
    observationLines: observation.map.split("\n").length,
    aiLog: api.getAiLog().length,
  });
})();
