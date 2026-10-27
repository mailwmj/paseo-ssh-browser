import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  OPEN_PROTOCOL, authorizeOpenRpc, disconnectOpenRpc, finishOpenRpc, pollOpenRpc,
} from "../shared/remote-url";
import { AutomaticBrowser, findSshTarget } from "./automatic-browser";
import { getLocalApi } from "./bridge";
import { isDesktop, newClientId, readHostRegistry } from "./web";

export function startOpenClient(client: PluginClientContext, browser: AutomaticBrowser): () => void {
  if (!isDesktop()) return () => {};
  const clientId = newClientId();
  const lifetime = new AbortController();
  const running = new Map<string, AbortController>();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let registered = false;
  let localHost = false;

  const abortRequests = () => {
    for (const controller of running.values()) controller.abort();
  };
  const loop = async () => {
    try {
      const api = getLocalApi();
      if (!api) return;
      const { self } = await client.paseo.hosts.list();
      localHost = readHostRegistry().local.includes(self.serverId);
      if (lifetime.signal.aborted || localHost) return;
      const target = await findSshTarget(self.serverId, readHostRegistry(), api);
      if (lifetime.signal.aborted || !target) return;
      registered = true;
      // Long polls use the supported plugin RPC transport. No panel or output scanner is needed.
      while (!lifetime.signal.aborted && getLocalApi() === api) {
        const response = await client.rpc(pollOpenRpc, { clientId, protocol: OPEN_PROTOCOL });
        if (lifetime.signal.aborted || getLocalApi() !== api) break;
        for (const [id, controller] of running) {
          if (!response.activeRequestIds.includes(id)) controller.abort();
        }
        for (const request of response.requests) {
          if (request.serverId !== self.serverId) throw new Error("Remote page request belongs to another Paseo host");
          const controller = new AbortController();
          running.set(request.requestId, controller);
          void (async () => {
            try {
              const result = await browser.open({
                request, api, target, signal: controller.signal,
                authorize: async () => (await client.rpc(authorizeOpenRpc, { clientId, requestId: request.requestId })).active,
                openPanel: () => client.openPanel("browser", { workspaceId: request.workspaceId }),
              });
              if (!controller.signal.aborted) {
                await client.rpc(finishOpenRpc, { clientId, requestId: request.requestId, outcome: { ok: true, result } });
              }
            } catch (error) {
              if (!controller.signal.aborted) {
                await client.rpc(finishOpenRpc, { clientId, requestId: request.requestId, outcome: { ok: false, error: error instanceof Error ? error.message : String(error) } });
              }
            } finally {
              running.delete(request.requestId);
            }
          })().catch((error) => {
            controller.abort();
            console.warn("[ssh-browser] Could not return the remote page result", error);
          });
        }
      }
    } catch (error) {
      if (!lifetime.signal.aborted) console.warn("[ssh-browser] Desktop request connection failed", error);
    } finally {
      abortRequests();
      if (registered) {
        registered = false;
        void client.rpc(disconnectOpenRpc, { clientId }).catch((error) => console.warn("[ssh-browser] Could not release desktop registration", error));
      }
      // Reconnect after a host/local-plugin reload, or discover a newly saved SSH mapping.
      if (!lifetime.signal.aborted && !localHost) retry = setTimeout(() => void loop(), 2_000);
    }
  };
  void loop();
  return () => {
    lifetime.abort();
    clearTimeout(retry);
    abortRequests();
    if (registered) {
      registered = false;
      void client.rpc(disconnectOpenRpc, { clientId }).catch((error) => console.warn("[ssh-browser] Could not release desktop registration", error));
    }
  };
}
