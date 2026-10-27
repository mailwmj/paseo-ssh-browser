import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PortScanner } from "../server/scan";
import { sshExec } from "../server/ssh";
import { chooseLocalPort, isLocalPortFree, TunnelManager } from "../server/tunnels";

const fakeSsh = fileURLToPath(new URL("./fake-ssh.mjs", import.meta.url));
const spawnFake = (env: Record<string, string> = {}) => (args: string[]) =>
  spawn(process.execPath, [fakeSsh, ...args], {
    stdio: ["pipe", "ignore", "pipe"],
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
