import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import type { Forward } from "../shared/ports";
import { lastLine, SSH_BASE_ARGS } from "./ssh";

const READY_TIMEOUT_MS = 20_000;
const READY_MARKER = "ssh-browser-forward-ready";

export type SpawnSsh = (args: string[]) => ChildProcess;

const spawnSsh: SpawnSsh = (args) =>
  spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

interface Tunnel {
  forward: Forward;
  child: ChildProcess;
  ready: Promise<void>;
}

// One `ssh -L` process per forwarded port. The remote command reads stdin until it closes, so if
// this subprocess dies without cleanup, the pipe closes and ssh exits instead of lingering.
export class TunnelManager {
  private readonly tunnels = new Map<string, Tunnel>();
  private readonly opening = new Map<string, Promise<Forward>>();
  private readonly disconnected = new Map<string, Forward>();
  private stopped = false;

  constructor(private readonly spawnProcess: SpawnSsh = spawnSsh) {}

  list(): Forward[] {
    return [...this.tunnels.values()].map((tunnel) => tunnel.forward);
  }

  listDisconnected(): Forward[] { return [...this.disconnected.values()]; }

  async open(target: string, remoteHost: string, remotePort: number): Promise<Forward> {
    if (this.stopped) throw new Error("SSH Browser stopped");
    const key = tunnelKey(target, remoteHost, remotePort);
    const opening = this.opening.get(key);
    if (opening) return opening;
    const promise = this.start(target, remoteHost, remotePort, key);
    this.opening.set(key, promise);
    try {
      return await promise;
    } finally {
      this.opening.delete(key);
    }
  }

  private async start(target: string, remoteHost: string, remotePort: number, key: string): Promise<Forward> {
    const existing = this.tunnels.get(key);
    if (existing) {
      await existing.ready;
      return existing.forward;
    }
    const localPort = await chooseLocalPort(remotePort);
    if (this.stopped) throw new Error("SSH Browser stopped");
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
      `127.0.0.1:${localPort}:${destination}:${remotePort}`,
      "--",
      target,
      `printf '${READY_MARKER}\\n'; cat >/dev/null`,
    ]);
    const forward: Forward = {
      target,
      remoteHost,
      remotePort,
      localPort,
      url: `http://localhost:${localPort}/`,
    };
    const tunnel: Tunnel = { forward, child, ready: waitUntilReady(child) };
    this.tunnels.set(key, tunnel);
    let established = false;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (!established) return;
      stderr = (stderr + chunk.toString()).slice(-4096);
      const lines = stderr.split(/\r?\n/);
      stderr = lines.pop() ?? "";
      const failure = lines.find((line) => /connect failed:/i.test(line));
      if (failure) forward.connectionError = failure.slice(0, 300);
    });
    child.on("close", () => {
      if (this.tunnels.get(key) === tunnel) {
        this.tunnels.delete(key);
        if (established && !this.stopped) this.disconnected.set(key, forward);
      }
    });
    try {
      await tunnel.ready;
      established = true;
      this.disconnected.delete(key);
    } catch (error) {
      if (this.tunnels.get(key) === tunnel) this.tunnels.delete(key);
      child.kill();
      throw new Error(`SSH forward could not be established: ${error instanceof Error ? error.message : String(error)}`);
    }
    return forward;
  }

  close(target: string, remotePort: number): void {
    for (const [key, forward] of this.disconnected) {
      if (forward.target === target && forward.remotePort === remotePort) this.disconnected.delete(key);
    }
    for (const [key, tunnel] of this.tunnels) {
      if (tunnel.forward.target !== target || tunnel.forward.remotePort !== remotePort) continue;
      this.tunnels.delete(key);
      tunnel.child.kill();
    }
  }

  closeAll(): void {
    this.stopped = true;
    for (const tunnel of this.tunnels.values()) tunnel.child.kill();
    this.tunnels.clear();
    this.disconnected.clear();
  }
}

function tunnelKey(target: string, remoteHost: string, remotePort: number): string {
  return `${target}|${remoteHost}|${remotePort}`;
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

function waitUntilReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    let settled = false;
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
    // ssh runs this remote command only after forwarding setup succeeds. A TCP probe alone
    // could connect to an unrelated process that won the local bind race.
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.split(/\r?\n/).includes(READY_MARKER)) finish();
    });
  });
}
