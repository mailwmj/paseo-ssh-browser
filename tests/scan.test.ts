import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseScanOutput, PortScanner, SCAN_SCRIPT } from "../server/scan";
import { remoteHost } from "../shared/ports";
import type { RemoteExec } from "../server/ssh";

const line = (...fields: (string | number)[]) => ["P", ...fields].join("\t");

test("parses server id and listener lines", () => {
  const output = [
    "S\tsrv_abc",
    line(5173, "::1", 42, "/home/me/app", "node /home/me/app/node_modules/.bin/vite ", "html", "My &amp; App"),
    line(22, "127.0.0.1", "", "", "", "none", ""),
  ].join("\n");
  const { serverId, lines } = parseScanOutput(output);
  assert.equal(serverId, "srv_abc");
  assert.deepEqual(lines[0], {
    port: 5173,
    host: "::1",
    pid: 42,
    startedAt: null,
    cwd: "/home/me/app",
    command: "node /home/me/app/node_modules/.bin/vite",
    probe: "html",
    protocol: "http",
    agentId: null,
    title: "My & App",
  });
  assert.equal(lines[1].pid, null);
});

function fakeExec(outputs: string[]) {
  const calls: string[] = [];
  const exec: RemoteExec = async ({ command }) => {
    calls.push(command);
    return outputs.shift() ?? "";
  };
  return { exec, calls };
}

test("lists only web pages and listeners still starting up", async () => {
  const { exec } = fakeExec([
    [
      "S\tsrv_abc",
      line(3000, "127.0.0.1", 1, "/w", "next dev", "html", "Next"),
      line(5432, "127.0.0.1", 2, "/", "postgres", "none", ""),
      line(8080, "127.0.0.1", 3, "/w", "api", "other", ""),
      line(4000, "127.0.0.1", 4, "/w", "slow", "pending", ""),
      line(53, "127.0.0.54", "", "", "", "pending", ""),
      line(5000, "127.0.0.1", "", "", "", "pending", ""),
    ].join("\n"),
  ]);
  const result = await new PortScanner(exec).scan("devbox");
  assert.deepEqual(
    result.ports.map((port) => port.port),
    [3000, 4000],
  );
  assert.deepEqual(result.otherPorts.map((port) => port.port), [53, 5000, 5432, 8080]);
});

test("retains HTTPS for a detected page and on subsequent cached scans", async () => {
  const { exec } = fakeExec([
    line(3443, "127.0.0.1", 7, "/w", "web", "html", "Secure", "https"),
    line(3443, "127.0.0.1", 7, "/w", "web", "skip", "", "http"),
  ]);
  const scanner = new PortScanner(exec);
  assert.equal((await scanner.scan("devbox")).ports[0].protocol, "https");
  assert.equal((await scanner.scan("devbox")).ports[0].protocol, "https");
});

test("preserves the listening process's agent ID in scan results", async () => {
  const { exec } = fakeExec([line(3000, "127.0.0.1", 7, "/w", "web", "html", "App", "http", "agent_123")]);
  assert.equal((await new PortScanner(exec).scan("devbox")).ports[0].agentId, "agent_123");
});

test("the scan script detects an HTTPS page after HTTP fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "ssh-browser-scan-"));
  try {
    writeFileSync(join(dir, "ss"), "#!/bin/sh\nprintf 'LISTEN 0 128 127.0.0.1:3443 0.0.0.0:*\\n'\n", { mode: 0o755 });
    writeFileSync(join(dir, "curl"), `#!/bin/sh
case "$*" in
  *https://*) while [ "$1" != "-o" ]; do shift; done; printf '<title>Secure</title>' > "$2"; printf '200 text/html'; exit 0 ;;
  *) printf '000 '; exit 56 ;;
esac
`, { mode: 0o755 });
    const result = spawnSync("sh", ["-s", "--"], { input: SCAN_SCRIPT, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const page = parseScanOutput(result.stdout).lines[0];
    assert.equal(page.probe, "html");
    assert.equal(page.protocol, "https");
    assert.equal(page.title, "Secure");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the scan script reports a device-bound wildcard listener as loopback", () => {
  const dir = mkdtempSync(join(tmpdir(), "ssh-browser-scan-"));
  try {
    writeFileSync(join(dir, "ss"), "#!/bin/sh\nprintf 'LISTEN 0 128 *%%eth0:5353 0.0.0.0:*\\nLISTEN 0 128 0.0.0.0%%eth0:68 0.0.0.0:*\\nLISTEN 0 128 [::]%%eth0:5354 [::]:*\\n'\n", { mode: 0o755 });
    const result = spawnSync("sh", ["-s", "--"], { input: SCAN_SCRIPT, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseScanOutput(result.stdout).lines.map((entry) => entry.host), ["127.0.0.1", "127.0.0.1", "127.0.0.1"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the scan script normalizes interface-qualified IPv4 and IPv6 listeners", () => {
  const dir = mkdtempSync(join(tmpdir(), "ssh-browser-scan-"));
  try {
    writeFileSync(join(dir, "ss"), "#!/bin/sh\nprintf 'LISTEN 0 128 [fd7a:115c::1]%%tailscale0:4444 [::]:*\\nLISTEN 0 128 [fe80::1%%eth0]:5555 [::]:*\\nLISTEN 0 128 127.0.0.53%%lo:53 0.0.0.0:*\\n'\n", { mode: 0o755 });
    const result = spawnSync("sh", ["-s", "--"], { input: SCAN_SCRIPT, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const hosts = parseScanOutput(result.stdout).lines.map((entry) => entry.host);
    assert.deepEqual(hosts, ["fd7a:115c::1", "fe80::1", "127.0.0.53"]);
    assert.ok(hosts.every((host) => remoteHost.safeParse(host).success));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a manual refresh rechecks previously classified listeners", async () => {
  const { exec, calls } = fakeExec([
    line(3000, "127.0.0.1", 1, "/w", "app", "other", ""),
    line(3000, "127.0.0.1", 1, "/w", "app", "html", "Ready"),
  ]);
  const scanner = new PortScanner(exec);
  assert.equal((await scanner.scan("devbox")).otherPorts.length, 1);
  assert.equal((await scanner.scan("devbox", true)).ports[0].title, "Ready");
  assert.equal(calls[1], "sh -s --");
});

test("a port on both IPv4 and IPv6 appears once, reached over IPv4", async () => {
  const { exec } = fakeExec([
    [line(5173, "::1", 7, "/w", "vite", "html", "V"), line(5173, "127.0.0.1", 7, "/w", "vite", "html", "V")].join("\n"),
  ]);
  const { ports } = await new PortScanner(exec).scan("devbox");
  assert.equal(ports.length, 1);
  assert.equal(ports[0].host, "127.0.0.1");
});

test("probes each process once and forgets it after it stops listening", async () => {
  const { exec, calls } = fakeExec([
    line(3000, "127.0.0.1", 11, "/w", "next dev", "html", "Next"),
    line(3000, "127.0.0.1", 11, "/w", "next dev", "skip", ""),
    "",
    line(3000, "127.0.0.1", 12, "/w", "next dev", "html", "Next again"),
  ]);
  const scanner = new PortScanner(exec);
  await scanner.scan("devbox");
  const second = await scanner.scan("devbox");
  assert.equal(calls[1], "sh -s -- 3000:11");
  // A skipped probe keeps the earlier title rather than dropping the page.
  assert.equal(second.ports[0].title, "Next");
  await scanner.scan("devbox");
  const restarted = await scanner.scan("devbox");
  assert.equal(calls[3], "sh -s --");
  assert.equal(restarted.ports[0].title, "Next again");
});

test("a listener that timed out is probed again next time", async () => {
  const { exec, calls } = fakeExec([line(4000, "127.0.0.1", 5, "/w", "slow", "pending", ""), ""]);
  const scanner = new PortScanner(exec);
  await scanner.scan("devbox");
  await scanner.scan("devbox");
  assert.equal(calls[1], "sh -s --");
});

test("learns which Paseo server an SSH host runs, and retries an unreachable one after a minute", async () => {
  let now = 0;
  let reachable = false;
  let calls = 0;
  const exec: RemoteExec = async () => {
    calls++;
    if (!reachable) throw new Error("ssh: connect to host relayed-box port 22: Connection timed out");
    return "S\tsrv_relayed\n";
  };
  const scanner = new PortScanner(exec, () => now);
  assert.equal(await scanner.serverIdOf("relayed-box"), null);
  reachable = true;
  now = 30_000;
  assert.equal(await scanner.serverIdOf("relayed-box"), null);
  assert.equal(calls, 1);
  now = 61_000;
  assert.equal(await scanner.serverIdOf("relayed-box"), "srv_relayed");
  assert.equal(await scanner.serverIdOf("relayed-box"), "srv_relayed");
  assert.equal(calls, 2);
});
