import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { recentFiles } from "./server/recent-files";
import { PortScanner } from "./server/scan";
import { stopService } from "./server/stop-service";
import { sshExec } from "./server/ssh";
import { TransferManager } from "./server/transfer";
import { TunnelManager } from "./server/tunnels";
import { OpenRequests } from "./server/open-requests";
import { openRemoteUrlTool } from "./server/open-tool";
import { authorizeOpenRpc, disconnectOpenRpc, finishOpenRpc, pollOpenRpc } from "./shared/remote-url";
import { closeRpc, forwardsRpc, openRpc, scanRpc, stopServiceRpc, targetsRpc, targetsSettings, recentSettings } from "./shared/ports";
import {
  cancelTransferRpc, receiveFolderRpc, receiveRpc, receiveSettings, recentFilesRpc, sendRpc, transfersRpc,
} from "./shared/transfer";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(targetsSettings);
  server.registerSettings(recentSettings);
  const receive = server.registerSettings(receiveSettings);
  const scanner = new PortScanner(sshExec);
  const tunnels = new TunnelManager();
  const requests = new OpenRequests();
  const receiveFolder = async () => {
    const state = await receive.read();
    return (state.status === "ready" && state.values.folder) || path.join(os.homedir(), "Downloads", "Paseo");
  };
  const transfers = new TransferManager(receiveFolder);
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

  server.handle(stopServiceRpc, (input) => stopService(sshExec, input));
  server.handle(scanRpc, ({ target, refresh }) => scanner.scan(target, refresh));
  server.handle(targetsRpc, async () => {
    const state = await settings.read();
    const targets = state.status === "ready" ? state.values.targets : [];
    return {
      targets: await Promise.all(
        targets.map(async (target) => ({ target, serverId: await scanner.serverIdOf(target) })),
      ),
    };
  });
  server.handle(forwardsRpc, () => ({ forwards: tunnels.list(), disconnected: tunnels.listDisconnected() }));
  server.handle(openRpc, ({ target, remoteHost, remotePort }) =>
    tunnels.open(target, remoteHost, remotePort),
  );
  server.handle(closeRpc, ({ target, remotePort }) => {
    tunnels.close(target, remotePort);
    return {};
  });

  server.handle(sendRpc, async ({ target, paths, remoteDir }) => ({ jobs: await transfers.send(target, paths, remoteDir) }));
  server.handle(receiveRpc, async ({ target, remotePaths, folder }) => ({
    jobs: await transfers.receive(target, remotePaths, folder),
  }));
  server.handle(transfersRpc, () => ({ jobs: transfers.list() }));
  server.handle(cancelTransferRpc, ({ id }) => {
    transfers.cancel(id);
    return {};
  });
  server.handle(receiveFolderRpc, async () => ({ folder: await receiveFolder() }));
  server.handle(recentFilesRpc, async ({ directory }) => ({ files: await recentFiles(directory) }));

  return () => {
    transfers.stop();
    requests.stop();
    tunnels.closeAll();
  };
}
