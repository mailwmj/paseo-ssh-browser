import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { AutomaticBrowser } from "../client/automatic-browser";
import { buildLocalApi } from "../client/bridge";
import { OpenRequests } from "../server/open-requests";
import { openRemoteUrlTool } from "../server/open-tool";
import { PortScanner } from "../server/scan";
import { sshExec } from "../server/ssh";
import { chooseLocalPort, isLocalPortFree, TunnelManager } from "../server/tunnels";

const fakeSsh = fileURLToPath(new URL("./fake-ssh.mjs", import.meta.url));
const spawnFake = (env: Record<string, string> = {}) => (args: string[]) =>
  spawn(process.execPath, [fakeSsh, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

function listen(server: net.Server, port = 0): Promise<number> {
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

test("keeps the remote port number when it is free locally", async () => {
  const blocker = net.createServer();
  const taken = await listen(blocker);
  try {
    assert.equal(await isLocalPortFree(taken), false);
    const chosen = await chooseLocalPort(taken);
    assert.notEqual(chosen, taken);
    assert.equal(await isLocalPortFree(chosen), true);
  } finally {
    blocker.close();
  }
  assert.equal(await chooseLocalPort(80), 10080);
});

test("resolves once ssh is accepting connections and reuses the forward", async () => {
  const tunnels = new TunnelManager(spawnFake());
  try {
    const forward = await tunnels.open("devbox", "127.0.0.1", 47_831);
    assert.equal(forward.url, `http://localhost:${forward.localPort}/`);
    assert.equal(await isLocalPortFree(forward.localPort), false);
    assert.deepEqual(await tunnels.open("devbox", "127.0.0.1", 47_831), forward);
    assert.deepEqual(tunnels.list(), [forward]);
  } finally {
    tunnels.closeAll();
  }
});

test("reports ssh's own error when the forward fails", async () => {
  const tunnels = new TunnelManager(spawnFake({ FAKE_SSH_FAIL: "Connection refused" }));
  await assert.rejects(tunnels.open("devbox", "127.0.0.1", 47_832), /Connection refused/);
  assert.deepEqual(tunnels.list(), []);
});

test("simultaneous opens of the same destination share one SSH process", async () => {
  let spawned = 0;
  const tunnels = new TunnelManager((args) => { spawned++; return spawnFake()(args); });
  try {
    const [first, second] = await Promise.all([
      tunnels.open("devbox", "127.0.0.1", 47_834),
      tunnels.open("devbox", "127.0.0.1", 47_834),
    ]);
    assert.deepEqual(first, second);
    assert.equal(spawned, 1);
  } finally { tunnels.closeAll(); }
});

test("a process winning the bind race cannot be mistaken for a ready SSH tunnel", async () => {
  let blocker: net.Server | undefined;
  const tunnels = new TunnelManager((args) => {
    const localPort = Number(args[args.indexOf("-L") + 1].split(":")[1]);
    blocker = net.createServer((socket) => socket.end("UNRELATED LOCAL SERVICE"));
    blocker.listen(localPort, "127.0.0.1");
    return spawnFake()(args);
  });
  try {
    await assert.rejects(tunnels.open("devbox", "127.0.0.1", 47_835), /EADDRINUSE|address already in use/);
    assert.deepEqual(tunnels.list(), []);
  } finally { tunnels.closeAll(); blocker?.close(); }
});

test("closing a forward stops ssh and frees the local port", async () => {
  const tunnels = new TunnelManager(spawnFake());
  const forward = await tunnels.open("devbox", "127.0.0.1", 47_833);
  tunnels.close("devbox", 47_833);
  assert.deepEqual(tunnels.list(), []);
  for (let i = 0; i < 40 && !(await isLocalPortFree(forward.localPort)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await isLocalPortFree(forward.localPort), true);
});

test("an unexpected SSH exit is visible until reconnected or dismissed", async () => {
  let child: ReturnType<ReturnType<typeof spawnFake>> | undefined;
  const tunnels = new TunnelManager((args) => (child = spawnFake()(args)));
  try {
    const forward = await tunnels.open("devbox", "127.0.0.1", 47836);
    const stopped = new Promise<void>((resolve) => child!.once("close", () => resolve()));
    child!.kill();
    await stopped;
    assert.deepEqual(tunnels.list(), []);
    assert.deepEqual(tunnels.listDisconnected(), [forward]);
    const reconnected = await tunnels.open("devbox", "127.0.0.1", 47836);
    assert.equal(reconnected.remotePort, forward.remotePort);
    assert.deepEqual(tunnels.listDisconnected(), []);
    tunnels.close("devbox", 47836);
    assert.deepEqual(tunnels.listDisconnected(), []);
  } finally { tunnels.closeAll(); }
});

test("reports an SSH connection failure to the remote service without marking the tunnel disconnected", async () => {
  let child: ReturnType<ReturnType<typeof spawnFake>> | undefined;
  const tunnels = new TunnelManager((args) => (child = spawnFake()(args)));
  try {
    await tunnels.open("devbox", "127.0.0.1", 47837);
    child!.stderr!.emit("data", "channel 2: open failed: connect failed: Connection refused\n");
    assert.match(tunnels.list()[0].connectionError!, /Connection refused/);
    assert.deepEqual(tunnels.listDisconnected(), []);
  } finally { tunnels.closeAll(); }
});

// End to end through the real ssh binary, against this machine. Needs passwordless `ssh localhost`.
const sshLocalhost =
  spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "localhost", "true"]).status === 0;

test("real ssh: detects a remote page and serves it, WebSocket upgrade included", { skip: !sshLocalhost }, async () => {
  const page = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>Remote page</title></head></html>");
  });
  page.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  const remotePort = await listen(page);
  const tunnels = new TunnelManager();
  try {
    const { serverId, ports } = await new PortScanner(sshExec).scan("localhost");
    assert.ok(serverId === null || serverId.length > 0);
    const found = ports.find((port) => port.port === remotePort);
    assert.equal(found?.title, "Remote page");

    const forward = await tunnels.open("localhost", found.host, remotePort);
    // The remote service itself occupies this port on our test computer.
    assert.notEqual(forward.localPort, remotePort);
    const body = await (await fetch(forward.url)).text();
    assert.match(body, /Remote page/);

    const upgraded = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(forward.localPort, "127.0.0.1", () =>
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"),
      );
      socket.once("data", (data) => {
        socket.destroy();
        resolve(data.toString());
      });
      socket.once("error", reject);
    });
    assert.match(upgraded, /101 Switching Protocols/);
  } finally {
    tunnels.closeAll();
    page.close();
  }
});

test("real ssh: tool request and desktop handler return the remote marker on an alternate port, then reuse it", { skip: !sshLocalhost }, async () => {
  const page = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<title>SSH Browser integration marker</title><p>REMOTE_UNIQUE_MARKER ${req.url}</p>`);
  });
  const remotePort = await listen(page);
  const tunnels = new TunnelManager();
  const broker = new OpenRequests();
  try {
    const scanner = new PortScanner(sshExec);
    const { serverId } = await scanner.scan("localhost");
    assert.ok(serverId);
    const unused = async (): Promise<never> => { throw new Error("unused"); };
    const local = buildLocalApi({ scan: ({ target }) => scanner.scan(target), open: ({ target, remoteHost, remotePort }) => tunnels.open(target, remoteHost, remotePort),
      remotePluginStatus: unused, stopService: unused, close: unused, forwards: unused, targets: unused, readSettings: unused, writeSettings: unused,
      readRecent: async () => ({ status: "ready", revision: "r", values: { pages: [] } }),
      writeRecent: async ({ values }) => ({ status: "saved", revision: "r2", values }),
      transfer: { send: unused, receive: unused, list: unused, cancel: unused, folder: unused, readFolder: unused, writeFolder: unused } });
    const browser = new AutomaticBrowser();
    const tool = openRemoteUrlTool(broker);
    const remoteUrl = `http://localhost:${remotePort}/dashboard?tab=home#details`;
    const context: AgentToolContext = {
      agent: { id: "test-agent", workspaceId: "actual-remote-workspace", parentAgentId: null, cwd: process.cwd(), provider: "codex", title: null },
      paseo: { hosts: { list: async () => ({ self: { serverId, label: "Remote" }, hosts: [] }) } } as unknown as AgentToolContext["paseo"],
      signal: new AbortController().signal,
    };
    let previousPort: number | undefined;
    for (let i = 0; i < 2; i++) {
      const poll = broker.poll("test-desktop");
      const output = tool.execute({ url: remoteUrl }, context);
      const { requests: [request] } = await poll;
      const result = await browser.open({ request, api: local, target: "localhost", signal: context.signal,
        authorize: async () => broker.active("test-desktop", request.requestId) });
      broker.finish({ clientId: "test-desktop", requestId: request.requestId, outcome: { ok: true, result } });
      assert.deepEqual((await output).structuredContent, result);
      assert.notEqual(result.localPort, remotePort);
      if (previousPort) assert.equal(result.localPort, previousPort);
      previousPort = result.localPort;
      assert.equal(new URL(result.localUrl).hash, "#details");
      assert.match(await (await fetch(result.localUrl)).text(), /REMOTE_UNIQUE_MARKER \/dashboard\?tab=home/);
    }
    assert.equal(tunnels.list().length, 1);
  } finally {
    broker.stop(); tunnels.closeAll(); page.close();
  }
});
