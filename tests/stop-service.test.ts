import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import { STOP_SCRIPT } from "../server/stop-service";

test("stops only the process that still owns the selected port", async () => {
  const child = spawn(process.execPath, ["-e", "require('net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port) })"], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const [data] = await once(child.stdout, "data");
    const port = Number(data.toString().trim());
    const pid = child.pid as number;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "").split(" ");
    const startedAt = stat[19];
    const run = (selectedPort: number, started: string) => spawnSync("sh", ["-s", "--", String(selectedPort), String(pid), started], { input: STOP_SCRIPT, encoding: "utf8" });
    assert.notEqual(run(port, "0").status, 0);
    assert.notEqual(run(port === 65535 ? port - 1 : port + 1, startedAt).status, 0);
    assert.equal(child.exitCode, null);
    const stopped = once(child, "exit");
    const result = run(port, startedAt);
    assert.equal(result.status, 0, result.stderr);
    const [, signal] = await stopped;
    assert.equal(signal, "SIGTERM");
  } finally {
    child.kill();
  }
});
