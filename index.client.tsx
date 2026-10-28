import { settingsRpc } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { visibilitySettings } from "./shared/visibility";
import { Settings } from "./client/settings";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AutomaticBrowser } from "./client/automatic-browser";
import { startOpenClient } from "./client/open-client";
import { buildLocalApi, publishLocalApi, RPCS } from "./client/bridge";
import { BrowserPanel } from "./client/browser-panel";
import { FilesPanel } from "./client/files-panel";
import { startFilesButtons } from "./client/files-button";
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
  const automaticBrowser = new AutomaticBrowser();
  client.addScreen({ id: "ports", title: messages.message("name"), Component: PortsScreen });
  client.addSidebarHeaderItem({ id: "ports", title: messages.message("name"), Component: (props) => <><ObserveVisibility /><PortsItem {...props} /></> });
  client.addWorkspacePanel({
    id: "browser",
    title: messages.message("name"),
    icon: "Globe",
    Component: BrowserPanel,
  });
  let removeFiles: (() => void) | undefined;
  let stopped = false;
  let observedSettings = false;
  const setFilesVisible = (visible: boolean) => {
    observedSettings = true;
    if (stopped || visible === !!removeFiles) return;
    if (!visible) {
      removeFiles?.();
      removeFiles = undefined;
      return;
    }
    const removePanel = client.addWorkspacePanel({
      id: "files", title: messages.message("files"), icon: "ArrowLeftRight",
      locations: ["workspace", "explorer"], Component: FilesPanel,
    });
    const removeCommand = client.addCommandCenterItem({
      id: "open-files", title: messages.message("files"), icon: "ArrowLeftRight",
      keywords: ["send", "receive", "upload", "download", "transfer", "file", "scp"],
      context: "workspace",
      onSelect({ openPanel }) { openPanel("files"); },
    });
    const removeButtons = startFilesButtons(client);
    removeFiles = () => { removePanel(); removeCommand(); removeButtons(); };
  };
  function ObserveVisibility() {
    const state = useSettings(visibilitySettings);
    const visible = state.status === "ready" ? state.values.fileTransfer : undefined;
    useEffect(() => { if (visible !== undefined) setFilesVisible(visible); }, [visible]);
    return null;
  }
  client.addSettingsScreen({
    id: "settings", title: messages.message("settingsTitle"), icon: "Globe",
    Component: (props) => <><ObserveVisibility /><Settings {...props} /></>,
  });
  void client.rpc(settingsRpc(visibilitySettings.id).read, {}).then((state) => {
    if (observedSettings || stopped) return;
    if (state.status === "ready") setFilesVisible(visibilitySettings.schema.parse(state.values).fileTransfer);
    else console.warn("[ssh-browser] Could not read visibility settings", state.error);
  }).catch((error: unknown) => console.warn("[ssh-browser] Could not read visibility settings", error));
  const stopOpenClient = startOpenClient(client, automaticBrowser);
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
  let unpublish = () => {};
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      if (stopped || !readHostRegistry().local.includes(self.serverId)) return;
      unpublish = publishLocalApi(
        buildLocalApi({
          scan: (input) => client.rpc(RPCS.scan, input),
          remotePluginStatus: (input) => client.rpc(RPCS.remotePluginStatus, input),
          stopService: (input) => client.rpc(RPCS.stopService, input),
          forwards: (input) => client.rpc(RPCS.forwards, input),
          open: (input) => client.rpc(RPCS.open, input),
          close: (input) => client.rpc(RPCS.close, input),
          targets: (input) => client.rpc(RPCS.targets, input),
          readSettings: (input) => client.rpc(RPCS.readSettings, input),
          writeSettings: (input) => client.rpc(RPCS.writeSettings, input),
          readRecent: (input) => client.rpc(RPCS.readRecent, input),
          writeRecent: (input) => client.rpc(RPCS.writeRecent, input),
          transfer: {
            send: (input) => client.rpc(RPCS.send, input),
            receive: (input) => client.rpc(RPCS.receive, input),
            list: (input) => client.rpc(RPCS.transfers, input),
            cancel: (input) => client.rpc(RPCS.cancelTransfer, input),
            folder: (input) => client.rpc(RPCS.receiveFolder, input),
            readFolder: (input) => client.rpc(RPCS.readReceiveFolder, input),
            writeFolder: (input) => client.rpc(RPCS.writeReceiveFolder, input),
          },
        }),
      );
    })
    .catch((error: unknown) => console.warn("[ssh-browser] Could not identify this host", error));

  return () => {
    stopped = true;
    removeFiles?.();
    stopOpenClient();
    unpublish();
  };
}
