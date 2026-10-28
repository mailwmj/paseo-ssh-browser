import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
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
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const selected = rows.find((row) => row.port === selectedPort);
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
        <Pressable accessibilityRole="button" accessibilityLabel={t("serviceActions", { title: t("port", { port: row.port }) })}
          onPress={() => setSelectedPort(row.port)} style={({ pressed }) => ({ alignSelf: compact ? "flex-end" : "auto", minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 6, backgroundColor: pressed ? colors.surface0 : colors.surface2 })}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "500" }}>{t("actions")}</Text>
        </Pressable>
      </View>)}
    </View> : null}
    <Modal title={selected ? t("port", { port: selected.port }) : ""} open={selected !== undefined} onOpenChange={(open) => { if (!open) { setHint(null); setSelectedPort(null); } }}>
      <Modal.Content contentContainerStyle={{ padding: 12, gap: 2 }}>
        {selected ? <>
          {[
            ...(["http", "https"] as const).map((protocol) => ({
              key: protocol, label: t("tryProtocol", { protocol: protocol.toUpperCase() }),
              hint: t(protocol === "http" ? "httpHint" : "httpsHint"), action: () => onOpen(selected, protocol),
            })),
            ...(selected.disconnected ? [{ key: "reconnect", label: t("reconnect"), hint: t("reconnectHint"), action: () => onReconnect(selected) }] : []),
            ...(selected.forward || selected.disconnected ? [{ key: "close", label: t("unplug", { port: selected.port }), hint: t("unplugHint"), action: () => onClose(selected) }] : []),
            ...(selected.pid !== null && selected.startedAt !== null ? [{ key: "stop", label: t("stopService"), hint: t("stopServiceHint"), action: () => setStopping(selected) }] : []),
          ].map((action) => <Pressable key={action.key} accessibilityRole="button" accessibilityHint={action.hint}
            disabled={action.key === "stop" && stoppingPort !== null}
            onHoverIn={() => setHint(action.hint)} onHoverOut={() => setHint(null)}
            onFocus={() => setHint(action.hint)} onBlur={() => setHint(null)}
            onPress={() => { setHint(null); setSelectedPort(null); action.action(); }}
            style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 6, backgroundColor: pressed ? colors.surface2 : "transparent", opacity: action.key === "stop" && stoppingPort !== null ? 0.5 : 1 })}>
            <Text style={{ color: action.key === "stop" ? colors.statusDanger : colors.foreground, fontSize: 14 }}>{action.label}</Text>
          </Pressable>)}
          <View style={{ minHeight: 42, paddingHorizontal: 12, paddingTop: 6 }}>
            {hint ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
          </View>
        </> : null}
      </Modal.Content>
    </Modal>
    <StopServiceConfirm row={stopping} theme={theme} onOpenChange={(open) => { if (!open) setStopping(null); }}
      onConfirm={(row) => { setStopping(null); setStoppingPort(row.port); void onStop(row).finally(() => setStoppingPort(null)); }} />
  </View>;
}
