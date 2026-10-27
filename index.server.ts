import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PortScanner } from "./server/scan";
import { sshExec } from "./server/ssh";
import { TunnelManager } from "./server/tunnels";
import { OpenRequests } from "./server/open-requests";
import { openRemoteUrlTool } from "./server/open-tool";
import { authorizeOpenRpc, disconnectOpenRpc, finishOpenRpc, pollOpenRpc } from "./shared/remote-url";
import { closeRpc, forwardsRpc, openRpc, scanRpc, targetsRpc, targetsSettings } from "./shared/ports";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(targetsSettings);
  const scanner = new PortScanner(sshExec);
  const tunnels = new TunnelManager();
  const requests = new OpenRequests();
  const openRemoteUrl = openRemoteUrlTool(requests);

  server.before("agent.session_open", ({ request }) => ({
    ...request,
    tools: [...request.tools, openRemoteUrl],
  }));
  server.handle(pollOpenRpc, ({ clientId }) => requests.poll(clientId));
  server.handle(authorizeOpenRpc, ({ clientId, requestId }) => ({ active: requests.active(clientId, requestId) }));
  server.handle(finishOpenRpc, (input) => requests.finish(input));
  server.handle(disconnectOpenRpc, ({ clientId }) => {
    requests.disconnect(clientId);
    return {};
  });

  server.handle(scanRpc, ({ target }) => scanner.scan(target));
  server.handle(targetsRpc, async () => {
    const state = await settings.read();
    const targets = state.status === "ready" ? state.values.targets : [];
    return {
      targets: await Promise.all(
        targets.map(async (target) => ({ target, serverId: await scanner.serverIdOf(target) })),
      ),
    };
  });
  server.handle(forwardsRpc, () => ({ forwards: tunnels.list() }));
  server.handle(openRpc, ({ target, remoteHost, remotePort }) =>
    tunnels.open(target, remoteHost, remotePort),
  );
  server.handle(closeRpc, ({ target, remotePort }) => {
    tunnels.close(target, remotePort);
    return {};
  });

  return () => {
    requests.stop();
    tunnels.closeAll();
  };
}
