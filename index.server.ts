import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PortScanner } from "./server/scan";
import { sshExec } from "./server/ssh";
import { TunnelManager } from "./server/tunnels";
import { closeRpc, forwardsRpc, openRpc, scanRpc, targetsSettings } from "./shared/ports";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(targetsSettings);
  const scanner = new PortScanner(sshExec);
  const tunnels = new TunnelManager();

  server.handle(scanRpc, ({ target }) => scanner.scan(target));
  server.handle(forwardsRpc, () => ({ forwards: tunnels.list() }));
  server.handle(openRpc, ({ target, remoteHost, remotePort }) =>
    tunnels.open(target, remoteHost, remotePort),
  );
  server.handle(closeRpc, ({ target, remotePort }) => {
    tunnels.close(target, remotePort);
    return {};
  });

  return () => tunnels.closeAll();
}
