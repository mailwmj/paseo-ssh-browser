import { useTranslation, type PluginButtonContentProps, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { FilesView } from "./files-view";
import { IconButton } from "./kit";
import { messages } from "./messages";

export function FilesPanel({ theme, layout, host, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 12 : 16 }}
    >
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} hostLabel={host.label} workspaceId={workspaceId} />
    </ScrollView>
  );
}

// Paseo scrolls and pads a popover itself.
export function FilesPopover({ theme, layout, host, workspaceId, close }: PluginButtonContentProps) {
  const { t } = useTranslation(messages);
  return (
    <View style={{ width: layout.compact ? undefined : 408, maxWidth: "100%", gap: 6 }}>
      {!layout.compact ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{t("files")}</Text>
        <IconButton icon="X" label={t("closeFiles")} color={theme.colors.foregroundMuted} onPress={close} />
      </View> : null}
      <FilesView theme={theme} compact={layout.compact} hostId={host.id} hostLabel={host.label} workspaceId={workspaceId} />
    </View>
  );
}
