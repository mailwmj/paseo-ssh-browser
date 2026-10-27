import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import type { Forward } from "../shared/ports";
import { lastLine, SSH_BASE_ARGS } from "./ssh";

const READY_TIMEOUT_MS = 20_000;

export type SpawnSsh = (args: string[]) => ChildProcess;

const spawnSsh: SpawnSsh = (args) =>
  spawn("ssh", args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });

interface Tunnel {
  forward: Forward;
  child: ChildProcess;
  ready: Promise<void>;
}

// One `ssh -L` process per forwarded port. The remote command reads stdin until it closes, so if
// this subprocess dies without cleanup, the pipe closes and ssh exits instead of lingering.
export class TunnelManager {
  private readonly tunnels = new Map<string, Tunnel>();

  constructor(private readonly spawnProcess: SpawnSsh = spawnSsh) {}

  list(): Forward[] {
    return [...this.tunnels.values()].map((tunnel) => tunnel.forward);
  }

  async open(target: string, remoteHost: string, remotePort: number): Promise<Forward> {
    const key = tunnelKey(target, remotePort);
    const existing = this.tunnels.get(key);
    if (existing && existing.forward.remoteHost === remoteHost) {
      await existing.ready;
      return existing.forward;
    }
    if (existing) this.close(target, remotePort);

    const localPort = await chooseLocalPort(remotePort);
    const destination = remoteHost.includes(":") ? `[${remoteHost}]` : remoteHost;
    const child = this.spawnProcess([
      ...SSH_BASE_ARGS,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `localhost:${localPort}:${destination}:${remotePort}`,
      "--",
      target,
      "cat >/dev/null",
    ]);
    const forward: Forward = {
      target,
      remoteHost,
      remotePort,
      localPort,
      url: `http://localhost:${localPort}/`,
    };
    const tunnel: Tunnel = { forward, child, ready: waitUntilReady(child, localPort) };
    this.tunnels.set(key, tunnel);
    child.on("close", () => {
      if (this.tunnels.get(key) === tunnel) this.tunnels.delete(key);
    });
    try {
      await tunnel.ready;
    } catch (error) {
      this.close(target, remotePort);
      throw error;
    }
    return forward;
  }

  close(target: string, remotePort: number): void {
    const key = tunnelKey(target, remotePort);
    const tunnel = this.tunnels.get(key);
    if (!tunnel) return;
    this.tunnels.delete(key);
    tunnel.child.kill();
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) tunnel.child.kill();
    this.tunnels.clear();
  }
}

function tunnelKey(target: string, remotePort: number): string {
  return `${target}|${remotePort}`;
}

// Keep the remote port number when it is free locally so URLs, cookies, and OAuth callbacks
// look the same as on the remote host. Privileged ports move up by 10000, as in Orca.
export async function chooseLocalPort(remotePort: number): Promise<number> {
  const preferred = remotePort < 1024 ? remotePort + 10000 : remotePort;
  if (await isLocalPortFree(preferred)) return preferred;
  return await freeLocalPort();
}

// The browser opens `localhost`, which may resolve to ::1 first, so a local server on either
// loopback address would shadow the forward. A machine without IPv6 loopback only needs IPv4.
export async function isLocalPortFree(port: number): Promise<boolean> {
  const [ipv4, ipv6] = await Promise.all([bindable("127.0.0.1", port), bindable("::1", port)]);
  return ipv4 === "free" && ipv6 !== "in-use";
}

function bindable(host: string, port: number): Promise<"free" | "in-use" | "unavailable"> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      resolve(error.code === "EADDRINUSE" || error.code === "EACCES" ? "in-use" : "unavailable"),
    );
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve("free"));
    });
  });
}

function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free local port"))));
    });
  });
}

function waitUntilReady(child: ChildProcess, localPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error(lastLine(stderr) ?? "SSH forward did not become ready")),
      READY_TIMEOUT_MS,
    );
    child.once("error", (error) => finish(error));
    child.once("close", (code) =>
      finish(new Error(lastLine(stderr) ?? `ssh exited with code ${code}`)),
    );
    const poll = setInterval(() => {
      const socket = net.connect({ host: "127.0.0.1", port: localPort });
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => socket.destroy());
    }, 150);
  });
}
