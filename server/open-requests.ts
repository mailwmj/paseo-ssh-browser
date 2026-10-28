import { randomUUID } from "node:crypto";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  OPEN_TIMEOUT_MS, POLL_MS, forwardedUrl,
  type OpenRequest, type OpenResult, type finishOpenRpc, type pollOpenRpc,
} from "../shared/remote-url";

interface Pending {
  request: OpenRequest;
  clientId: string;
  delivered: boolean;
  resolve(result: OpenResult): void;
  reject(error: Error): void;
}
interface Desktop {
  seenAt: number;
  wake?: () => void;
}

// One queue per remote plugin process. Only clients with a local bridge and SSH mapping poll it.
export class OpenRequests {
  private readonly desktops = new Map<string, Desktop>();
  private readonly pending = new Map<string, Pending>();
  private stopped = false;

  constructor(private readonly timeoutMs = OPEN_TIMEOUT_MS, private readonly pollMs = POLL_MS) {}

  async poll(clientId: string): Promise<RpcOutput<typeof pollOpenRpc>> {
    if (this.stopped) throw new Error("SSH Browser stopped");
    const desktop = this.desktops.get(clientId) ?? { seenAt: Date.now() };
    if (desktop.wake) throw new Error("This desktop already has a pending poll");
    desktop.seenAt = Date.now();
    this.desktops.set(clientId, desktop);
    this.pruneDesktops();
    if (this.desktops.size > 1) {
      for (const id of this.pending.keys()) this.reject(id, new Error("Multiple eligible desktops connected during the remote page request"));
    }
    const requests = () => [...this.pending.values()].filter((p) => p.clientId === clientId);
    if (!requests().some((p) => !p.delivered)) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollMs);
        desktop.wake = () => { clearTimeout(timer); resolve(); };
      });
    }
    desktop.wake = undefined;
    const active = requests();
    const fresh = active.filter((p) => !p.delivered);
    for (const pending of fresh) pending.delivered = true;
    return { requests: fresh.map((p) => p.request), activeRequestIds: active.map((p) => p.request.requestId) };
  }

  async open(
    input: Omit<OpenRequest, "requestId" | "expiresAt">,
    signal: AbortSignal,
  ): Promise<OpenResult> {
    if (signal.aborted) throw new Error("Remote page request canceled");
    if (this.stopped) throw new Error("SSH Browser stopped");
    this.pruneDesktops();
    const online = [...this.desktops];
    if (online.length === 0) {
      throw new Error("No eligible desktop is connected. Open Paseo Desktop, enable the same SSH Browser version on both hosts, and configure an SSH mapping for this remote host. To install on the missing host, run: paseo plugin add git:https://github.com/mailwmj/paseo-ssh-browser.git");
    }
    if (online.length !== 1) {
      throw new Error("Multiple eligible desktops are connected. Keep only the intended desktop connected to this remote host before opening a page.");
    }
    const [clientId] = online[0];
    const request = { ...input, requestId: randomUUID(), expiresAt: Date.now() + this.timeoutMs };
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => this.reject(request.requestId, new Error("Remote page request canceled"));
    try {
      return await new Promise<OpenResult>((resolve, reject) => {
        this.pending.set(request.requestId, { request, clientId, delivered: false, resolve, reject });
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => this.reject(request.requestId, new Error("Desktop did not open the remote page before the request timed out")), this.timeoutMs);
        this.desktops.get(clientId)?.wake?.();
      });
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener("abort", onAbort);
      this.pending.delete(request.requestId);
      this.desktops.get(clientId)?.wake?.();
    }
  }

  active(clientId: string, requestId: string): boolean {
    const pending = this.pending.get(requestId);
    return !!pending && pending.clientId === clientId && Date.now() < pending.request.expiresAt;
  }

  finish({ clientId, requestId, outcome }: RpcInput<typeof finishOpenRpc>): { accepted: boolean } {
    if (!this.active(clientId, requestId)) return { accepted: false };
    const pending = this.pending.get(requestId)!;
    if (!outcome.ok) pending.reject(new Error(outcome.error));
    else {
      const result = outcome.result;
      const request = pending.request;
      if (result.requestId !== requestId || result.serverId !== request.serverId ||
          result.workspaceId !== request.workspaceId || result.remoteUrl !== request.remoteUrl ||
          result.localUrl !== forwardedUrl(request.remoteUrl, result.localPort)) {
        throw new Error("Desktop returned a result for a different remote page");
      }
      pending.resolve(result);
    }
    // Make duplicate completions and authorization after completion fail immediately.
    this.pending.delete(requestId);
    return { accepted: true };
  }

  disconnect(clientId: string): void {
    this.desktops.get(clientId)?.wake?.();
    this.desktops.delete(clientId);
    for (const [id, pending] of this.pending) {
      if (pending.clientId === clientId) this.reject(id, new Error("The selected desktop disconnected"));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const id of this.pending.keys()) this.reject(id, new Error("SSH Browser stopped"));
    for (const id of this.desktops.keys()) this.disconnect(id);
  }

  private reject(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(error);
    this.desktops.get(pending.clientId)?.wake?.();
  }

  private pruneDesktops(): void {
    for (const [id, desktop] of this.desktops) {
      if (Date.now() - desktop.seenAt >= this.pollMs + 5_000) this.disconnect(id);
    }
  }
}
