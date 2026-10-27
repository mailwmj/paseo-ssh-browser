import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { PortsScreen } from "./client/ports-screen";

function PortsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Cable"
      active={currentScreen?.screenId === "ports"}
      onPress={() => openScreen({ screenId: "ports" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "ports", title: "SSH Ports", Component: PortsScreen });
  client.addSidebarHeaderItem({ id: "ports", title: "SSH Ports", Component: PortsItem });
  client.addCommandCenterItem({
    id: "open-ports",
    title: "Open SSH Ports",
    icon: "Cable",
    keywords: ["forward", "tunnel", "preview", "localhost"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "ports" });
    },
  });
  return () => {};
}
