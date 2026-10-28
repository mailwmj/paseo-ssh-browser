import type { PluginButtonContentProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { FilesView } from "./files-view";

export function FilesPanel({ theme, layout, host, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 12 : 16 }}
    >
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} workspaceId={workspaceId} />
    </ScrollView>
  );
}

// Paseo scrolls and pads a popover itself.
export function FilesPopover({ theme, layout, host, workspaceId }: PluginButtonContentProps) {
  return (
    <View style={{ minWidth: layout.compact ? undefined : 340 }}>
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} workspaceId={workspaceId} />
    </View>
  );
}
