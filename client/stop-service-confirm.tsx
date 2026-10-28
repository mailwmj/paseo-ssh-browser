import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { messages } from "./messages";
import type { Row } from "./use-host-ports";

export function StopServiceConfirm({ row, theme, onOpenChange, onConfirm }: {
  row: Row | null; theme: PluginTheme; onOpenChange: (open: boolean) => void; onConfirm: (row: Row) => void;
}) {
  const { t } = useTranslation(messages);
  const { colors } = theme;
  return (
    <Modal title={t("stopService")} open={row !== null} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: 24, gap: 24 }}>
        {row ? <Text style={{ color: colors.foregroundMuted, fontSize: 14, lineHeight: 21 }}>{t("stopServiceConfirm", { port: row.port, pid: row.pid ?? 0 })}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => onOpenChange(false)} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }, pressed && { opacity: 0.65 }]}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{t("cancel")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { if (row) onConfirm(row); }} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: 6, borderWidth: 1, borderColor: colors.statusDanger }, pressed && { opacity: 0.65 }]}>
            <Text style={{ color: colors.statusDanger, fontSize: 13, fontWeight: "600" }}>{t("stopService")}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
