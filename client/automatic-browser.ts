import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { forwardedUrl, parseRemoteUrl, type OpenRequest, type OpenResult } from "../shared/remote-url";
import type { LocalApi } from "./bridge";
import type { HostRegistry } from "./format";

type OpenBrowser = NonNullable<NonNullable<PluginSurfaceProps["navigation"]>["openBrowser"]>;
interface NavigationJob {
  run(openBrowser: OpenBrowser | undefined): void;
}

// Navigation belongs to the selected remote plugin's panel, in this desktop's JS realm.
// Keeping requests in this entry's closure prevents another host/copy from consuming them.
export class AutomaticBrowser {
  private readonly navigators = new Map<string, OpenBrowser | undefined>();
  private readonly jobs = new Map<string, Set<NavigationJob>>();
  private readonly requestedWorkspaces = new Set<string>();

  hasRequested(workspaceId: string): boolean {
    return this.requestedWorkspaces.has(workspaceId);
  }

  attach(workspaceId: string, openBrowser: OpenBrowser | undefined): () => void {
    this.navigators.set(workspaceId, openBrowser);
    for (const job of this.jobs.get(workspaceId) ?? []) job.run(openBrowser);
    return () => this.navigators.delete(workspaceId);
  }

  async open({
    request, api, target, signal, authorize, openPanel,
  }: {
    request: OpenRequest;
    api: LocalApi;
    target: string;
    signal: AbortSignal;
    authorize(): Promise<boolean>;
    openPanel(): void;
  }): Promise<OpenResult> {
    const check = () => {
      if (signal.aborted) throw new Error("Remote page request canceled");
      if (Date.now() >= request.expiresAt) throw new Error("Remote page request expired");
    };
    const requireActive = async () => {
      check();
      if (!(await authorize())) throw new Error("Remote page request is no longer active");
      check();
    };
    const remote = parseRemoteUrl(request.remoteUrl);
    await requireActive();
    // Saved app storage may contain a stale mapping. Verify the SSH destination's actual server.
    const { serverId } = await api.scan({ target });
    check();
    if (serverId !== request.serverId) throw new Error("The SSH destination does not match this remote Paseo host");
    await requireActive();
    const forward = await api.open({ target, remoteHost: remote.remoteHost, remotePort: remote.remotePort });
    await requireActive();
    const localUrl = forwardedUrl(request.remoteUrl, forward.localPort);
    this.requestedWorkspaces.add(request.workspaceId);

    await new Promise<void>((resolve, reject) => {
      let running = false;
      const jobs = this.jobs.get(request.workspaceId) ?? new Set<NavigationJob>();
      this.jobs.set(request.workspaceId, jobs);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        jobs.delete(job);
        if (jobs.size === 0) this.jobs.delete(request.workspaceId);
      };
      const fail = (error: unknown) => { cleanup(); reject(error); };
      const onAbort = () => fail(new Error("Remote page request canceled"));
      const timer = setTimeout(() => fail(new Error("Workspace browser panel did not become available before the request expired")), Math.max(0, request.expiresAt - Date.now()));
      const job: NavigationJob = {
        run: (openBrowser) => {
          if (running) return;
          running = true;
          void (async () => {
            if (!openBrowser) throw new Error("Opening a workspace browser requires Paseo Desktop");
            await requireActive();
            openBrowser({ url: localUrl, workspaceId: request.workspaceId, serverId: request.serverId });
            cleanup();
            resolve();
          })().catch(fail);
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      jobs.add(job);
      try {
        check();
        openPanel();
        if (this.navigators.has(request.workspaceId)) job.run(this.navigators.get(request.workspaceId));
      } catch (error) { fail(error); }
    });
    return {
      requestId: request.requestId, serverId: request.serverId, workspaceId: request.workspaceId,
      remoteUrl: request.remoteUrl, localUrl, localPort: forward.localPort, status: "navigation_requested",
    };
  }
}

export async function findSshTarget(serverId: string, registry: HostRegistry, api: LocalApi): Promise<string | null> {
  const direct = registry.ssh.filter((item) => item.serverId === serverId);
  const matches = direct.length ? direct : (await api.targets()).targets.filter((item) => item.serverId === serverId);
  const targets = [...new Set(matches.map((item) => item.target))];
  if (targets.length > 1) throw new Error("Multiple SSH destinations match this Paseo host");
  return targets[0] ?? null;
}
