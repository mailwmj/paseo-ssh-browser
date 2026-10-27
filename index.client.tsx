import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { buildLocalApi, publishLocalApi, RPCS } from "./client/bridge";
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
      unpublish = publishLocalApi(
        buildLocalApi({
          scan: (input) => client.rpc(RPCS.scan, input),
          forwards: (input) => client.rpc(RPCS.forwards, input),
          open: (input) => client.rpc(RPCS.open, input),
          close: (input) => client.rpc(RPCS.close, input),
          targets: (input) => client.rpc(RPCS.targets, input),
          readSettings: (input) => client.rpc(RPCS.readSettings, input),
          writeSettings: (input) => client.rpc(RPCS.writeSettings, input),
        }),
      );
    })
    .catch((error: unknown) => console.warn("[ssh-browser] Could not identify this host", error));

  return () => {
    stopped = true;
    unpublish();
  };
}
