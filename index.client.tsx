import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { closeRpc, forwardsRpc, openRpc, scanRpc } from "./shared/ports";
import { publishLocalApi } from "./client/bridge";
import { BrowserPanel } from "./client/browser-panel";
import { messages } from "./client/messages";
import { PortsScreen } from "./client/ports-screen";
import { readHostRegistry } from "./client/web";

function PortsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Globe"
      active={currentScreen?.screenId === "ports"}
      onPress={() => openScreen({ screenId: "ports" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "ports", title: messages.message("name"), Component: PortsScreen });
  client.addSidebarHeaderItem({ id: "ports", title: messages.message("name"), Component: PortsItem });
  client.addWorkspacePanel({
    id: "browser",
    title: messages.message("name"),
    icon: "Globe",
    Component: BrowserPanel,
  });
  client.addCommandCenterItem({
    id: "open-ports",
    title: messages.message("open"),
    icon: "Globe",
    keywords: ["ssh", "forward", "tunnel", "preview", "localhost", "browser"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "ports" });
    },
  });

  // The copy installed on this computer's own Paseo host starts the tunnels for every copy.
  let stopped = false;
  let unpublish = () => {};
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      if (stopped || !readHostRegistry().local.includes(self.serverId)) return;
      unpublish = publishLocalApi({
        version: 1,
        scan: (input) => client.rpc(scanRpc, input),
        forwards: () => client.rpc(forwardsRpc, {}),
        open: (input) => client.rpc(openRpc, input),
        close: (input) => client.rpc(closeRpc, input),
      });
    })
    .catch((error: unknown) => console.warn("[ssh-browser] Could not identify this host", error));

  return () => {
    stopped = true;
    unpublish();
  };
}
