import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { messages } from "./messages";
import { StopServiceConfirm } from "./stop-service-confirm";
import type { Row } from "./use-host-ports";

export function OtherPorts({ rows, theme, onOpen, onClose, onReconnect, onStop }: {
  rows: Row[]; theme: PluginTheme; onOpen: (row: Row, protocol: "http" | "https") => void;
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
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={16} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foreground, fontSize: 14 }}>{t("otherPorts", { count: rows.length })}</Text>
    </Pressable>
    {expanded ? <View style={{ gap: 4 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("otherPortsHint")}</Text>
      {rows.map((row) => <View key={row.port} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: 44 }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={{ color: colors.foreground, fontSize: 14 }}>{t("port", { port: row.port })}</Text>
          {row.command ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{row.command}</Text> : null}
          {row.agent ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("agentOwner", { title: row.agent.title })}</Text> : null}
          {row.agent?.stopped ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("agentStopped")}</Text> : null}
          {row.forward || row.disconnected ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{row.forward ? t("mapping", { remote: row.port, local: row.forward.localPort }) : t("disconnected")}</Text> : null}
          {row.forward?.connectionError ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{t("remoteConnectionFailed")}</Text> : null}
        </View>
        {(["http", "https"] as const).map((protocol) => <Pressable key={protocol} accessibilityRole="button"
          accessibilityLabel={t("openPortProtocol", { port: row.port, protocol: protocol.toUpperCase() })}
          onPress={() => onOpen(row, protocol)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10 }}>
          <Text style={{ color: colors.foreground, fontSize: 13 }}>{protocol.toUpperCase()}</Text>
        </Pressable>)}
        {row.disconnected ? <Pressable accessibilityRole="button" onPress={() => onReconnect(row)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10 }}><Text style={{ color: colors.foreground }}>{t("reconnect")}</Text></Pressable> : null}
        {row.forward || row.disconnected ? <Pressable accessibilityRole="button" accessibilityLabel={t("unplug", { port: row.port })}
          onPress={() => onClose(row)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10 }}>
          <Icon name="Unplug" size={16} color={colors.foregroundMuted} />
        </Pressable> : null}
        {row.pid !== null && row.startedAt !== null ? <Pressable accessibilityRole="button" accessibilityLabel={t("stopServicePort", { port: row.port })}
          disabled={stoppingPort !== null} accessibilityState={{ disabled: stoppingPort !== null }}
          onPress={() => setStopping(row)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, opacity: stoppingPort !== null ? 0.5 : 1 }}>
          <Icon name="Square" size={16} color={colors.statusDanger} />
        </Pressable> : null}
      </View>)}
    </View> : null}
    <StopServiceConfirm row={stopping} theme={theme} onOpenChange={(open) => { if (!open) setStopping(null); }}
      onConfirm={(row) => { setStopping(null); setStoppingPort(row.port); void onStop(row).finally(() => setStoppingPort(null)); }} />
  </View>;
}
