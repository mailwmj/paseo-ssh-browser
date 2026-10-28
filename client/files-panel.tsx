import { useTranslation, type PluginButtonContentProps, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Text, useWindowDimensions, View } from "react-native";
import { FilesView } from "./files-view";
import { IconButton } from "./kit";
import { messages } from "./messages";

export function FilesPanel({ theme, layout, host, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: layout.compact ? 12 : 16 }}>
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} hostLabel={host.label} workspaceId={workspaceId} />
    </View>
  );
}

// Keep the body stable and leave room for the host's padding within its 440px popover.
export function FilesPopover({ theme, layout, host, workspaceId, close }: PluginButtonContentProps) {
  const { t } = useTranslation(messages);
  const { height } = useWindowDimensions();
  return (
    <View style={{ width: layout.compact ? undefined : 408, height: layout.compact ? undefined : Math.min(400, Math.max(0, height - 100)), maxWidth: "100%", gap: 6 }}>
      {!layout.compact ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{t("files")}</Text>
        <IconButton icon="X" label={t("closeFiles")} color={theme.colors.foregroundMuted} onPress={close} />
      </View> : null}
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} hostLabel={host.label} workspaceId={workspaceId} popover={layout.compact} />
    </View>
  );
}
