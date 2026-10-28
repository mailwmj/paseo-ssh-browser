import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { messages } from "./messages";
import { StopServiceConfirm } from "./stop-service-confirm";
import type { Row } from "./use-host-ports";

export function OtherPorts({ rows, theme, compact, onOpen, onClose, onReconnect, onStop }: {
  rows: Row[]; theme: PluginTheme; compact: boolean; onOpen: (row: Row, protocol: "http" | "https") => void;
  onClose: (row: Row) => void;
  onReconnect: (row: Row) => void;
  onStop: (row: Row) => Promise<void>;
}) {
  const { t } = useTranslation(messages);
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState<Row | null>(null);
  const [stoppingPort, setStoppingPort] = useState<number | null>(null);
  if (!rows.length) return null;
  const { colors } = theme;
  return <View style={{ backgroundColor: colors.surface1, borderRadius: 8, overflow: "hidden" }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 16, opacity: pressed ? 0.65 : 1 })}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={16} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{t("otherPorts", { count: rows.length })}</Text>
    </Pressable>
    {expanded ? <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingBottom: 12 }}>{t("otherPortsHint")}</Text>
      {rows.map((row) => <View key={row.port} style={{
        flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center",
        gap: compact ? 8 : 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border,
      }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{t("port", { port: row.port })}</Text>
          {row.command ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{row.command}</Text> : null}
          {row.agent ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{t("agentOwner", { title: row.agent.title })}</Text> : null}
          {row.agent?.stopped ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{t("agentStopped")}</Text> : null}
          {row.forward || row.disconnected ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{row.forward ? t("mapping", { remote: row.port, local: row.forward.localPort }) : t("disconnected")}</Text> : null}
          {row.forward?.connectionError ? <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17 }}>{t("remoteConnectionFailed")}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {(["http", "https"] as const).map((protocol) => <Pressable key={protocol} accessibilityRole="button"
            accessibilityLabel={t("openPortProtocol", { port: row.port, protocol: protocol.toUpperCase() })}
            onPress={() => onOpen(row, protocol)} style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 6, backgroundColor: pressed ? colors.surface0 : colors.surface2 })}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "500" }}>{protocol.toUpperCase()}</Text>
          </Pressable>)}
          {row.disconnected ? <Pressable accessibilityRole="button" onPress={() => onReconnect(row)} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 10 }}><Text style={{ color: colors.foreground, fontSize: 12 }}>{t("reconnect")}</Text></Pressable> : null}
          {row.forward || row.disconnected ? <Pressable accessibilityRole="button" accessibilityLabel={t("unplug", { port: row.port })}
            onPress={() => onClose(row)} style={{ width: 36, minHeight: 36, alignItems: "center", justifyContent: "center" }}>
            <Icon name="Unplug" size={16} color={colors.foregroundMuted} />
          </Pressable> : null}
          {row.pid !== null && row.startedAt !== null ? <Pressable accessibilityRole="button" accessibilityLabel={t("stopServicePort", { port: row.port })}
            disabled={stoppingPort !== null} accessibilityState={{ disabled: stoppingPort !== null }}
            onPress={() => setStopping(row)} style={{ width: 36, minHeight: 36, alignItems: "center", justifyContent: "center", opacity: stoppingPort !== null ? 0.5 : 1 }}>
            <Icon name="Square" size={16} color={colors.statusDanger} />
          </Pressable> : null}
        </View>
      </View>)}
    </View> : null}
    <StopServiceConfirm row={stopping} theme={theme} onOpenChange={(open) => { if (!open) setStopping(null); }}
      onConfirm={(row) => { setStopping(null); setStoppingPort(row.port); void onStop(row).finally(() => setStoppingPort(null)); }} />
  </View>;
}
