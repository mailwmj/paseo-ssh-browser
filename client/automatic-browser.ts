import { forwardedUrl, parseRemoteUrl, type OpenRequest, type OpenResult } from "../shared/remote-url";
import type { LocalApi } from "./bridge";
import type { HostRegistry } from "./format";
import { rememberPage } from "./recent";

// The desktop prepares the tunnel without navigating or changing the active workspace.
export class AutomaticBrowser {
  async open({
    request, api, target, signal, authorize,
  }: {
    request: OpenRequest;
    api: LocalApi;
    target: string;
    signal: AbortSignal;
    authorize(): Promise<boolean>;
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
    void rememberPage(api, { serverId: request.serverId, workspaceId: request.workspaceId, url: remote.url })
      .catch((error) => console.warn("[ssh-browser] Could not save recent page", error));
    return {
      requestId: request.requestId, serverId: request.serverId, workspaceId: request.workspaceId,
      remoteUrl: request.remoteUrl, localUrl, localPort: forward.localPort, status: "tunnel_ready",
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
