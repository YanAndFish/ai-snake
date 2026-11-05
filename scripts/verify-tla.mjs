import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findJar() {
  const explicit = process.env.TLA_TOOLS_JAR;
  if (explicit) return explicit;
  const local = path.join(root, "spec", "tla2tools.jar");
  if (fs.existsSync(local)) return local;
  const installs = path.join(os.homedir(), ".local", "share", "mise", "installs", "http-tla2tools");
  if (fs.existsSync(installs)) {
    for (const version of fs.readdirSync(installs).sort().reverse()) {
      const candidate = path.join(installs, version, "tla2tools.jar");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const jar = findJar();
if (!jar) {
  console.error("Cannot find tla2tools.jar. Set TLA_TOOLS_JAR or place the jar at spec/tla2tools.jar.");
  process.exit(2);
}

const java = spawnSync("java", ["-version"], { stdio: "ignore" });
if (java.error || java.status !== 0) {
  console.error("Java 17 or later is required on PATH.");
  process.exit(2);
}

const models = [
  ["spec/SnakeFlow.tla", "spec/SnakeFlow.cfg"],
  ["spec/SnakeRules.tla", "spec/SnakeRules.cfg"],
];

console.log(`TLA+ tools: ${jar}`);
for (const [spec, cfg] of models) {
  console.log(`\nChecking ${spec}`);
  const result = spawnSync(
    "java",
    ["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-config", cfg, spec],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(2);
  }
  if (result.status !== 0) {
    console.error(`TLC failed for ${spec} with exit code ${result.status}`);
    process.exit(1);
  }
}
console.log("\nTLA+ check passed.");
