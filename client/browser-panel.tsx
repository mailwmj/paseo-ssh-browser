import type { PluginTheme } from "@getpaseo/plugin";
import {
  useTabState,
  useTranslation,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { parseAddress } from "./format";
import { errorMessage, IconButton } from "./kit";
import { messages } from "./messages";
import type { LocalApi } from "./bridge";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { useSshTarget } from "./use-target";
import { OtherPorts } from "./other-ports";
import { StopServiceConfirm } from "./stop-service-confirm";

type Styles = ReturnType<typeof createStyles>;

const tabSchema = z.object({ autoOpened: z.boolean() });

export function BrowserPanel(props: PluginWorkspacePanelProps) {
  const { theme, layout, host } = props;
  const { t } = useTranslation(messages);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const { api, target, pending } = useSshTarget(host.id);

  if (pending) {
    return <View style={styles.screen} />;
  }
  if (!target || !api) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>{t(target ? "needLocal" : "notSsh")}</Text>
      </View>
    );
  }
  return <Pages {...props} target={target} styles={styles} />;
}

function Pages({
  theme,
  host,
  navigation,
  workspaceId,
  tab,
  target,
  styles,
}: PluginWorkspacePanelProps & { target: string; styles: Styles }) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const api = useApi();
  const ports = useHostPorts({ api, target, serverId: host.id, navigation });
  const queryClient = useQueryClient();
  const recent = useQuery({ queryKey: ["recent-pages"], queryFn: () => (api as LocalApi).recent(), enabled: api !== null, refetchInterval: 10_000 });
  const recentPages = (recent.data ?? []).filter((page) => page.serverId === host.id && page.workspaceId === workspaceId);
  const rows = ports.rows.filter((row) => row.workspaceId === workspaceId);
  const otherRows = ports.otherRows.filter((row) => row.workspaceId === workspaceId);
  const [state, setState] = useTabState(tab, tabSchema, { autoOpened: false });
  const [stopping, setStopping] = useState<Row | null>(null);
  const [stoppingPort, setStoppingPort] = useState<number | null>(null);
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);

  const open = (row: Pick<Row, "port" | "host" | "cwd" | "workspaceId"> & { protocol?: "http" | "https" | null }, remoteUrl?: string) =>
    ports.open(row, { remoteUrl, workspaceId }).catch((error) => toast.error(errorMessage(error)));

  // The first time this tab finds exactly one page of its workspace, open it without being asked.
  const only = rows.length === 1 ? rows[0] : null;
  useEffect(() => {
    if (state.autoOpened || !ports.loaded || !only || only.forward || only.disconnected) return;
    setState({ autoOpened: true });
    void open(only);
  }, [state.autoOpened, ports.loaded, only?.port]);

  const submit = () => {
    const parsed = parseAddress(address);
    if (!parsed) {
      toast.error(t("invalidAddress"));
      return;
    }
    const known = ports.rows.find((row) => row.port === parsed.port);
    void open({ port: parsed.port, host: parsed.remoteHost === "::1" ? "::1" : known?.host ?? parsed.remoteHost, cwd: null, workspaceId }, parsed.url);
    setAddress("");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <Text style={styles.headingTitle}>{t("services")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("rescan")} onPress={ports.refresh} style={styles.refresh}>
          {ports.loading ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />}
          <Text style={styles.secondaryAction}>{t("rescan")}</Text>
        </Pressable>
      </View>
      <View style={[styles.bar, addressFocused && styles.barFocused]}>
        <Icon name="Globe" size={17} color={theme.colors.foregroundMuted} />
        <TextInput
          value={address}
          onChangeText={setAddress}
          onFocus={() => setAddressFocused(true)}
          onBlur={() => setAddressFocused(false)}
          onSubmitEditing={submit}
          placeholder="localhost:3000"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t("address")}
        />
        <Pressable accessibilityRole="button" onPress={submit} style={styles.openButton}>
          <Text style={styles.openButtonText}>{t("openAction")}</Text>
        </Pressable>
      </View>
      {ports.error ? <Text style={styles.error}>{t("scanFailed", { error: errorMessage(ports.error) })}</Text> : null}
      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{t("workspacePages")}</Text>
          {ports.loaded ? <Text style={styles.count}>{rows.length}</Text> : null}
        </View>
        {!ports.loaded ? <Text style={styles.muted}>{t("scanning")}</Text> : rows.length === 0 ? (
          <View style={styles.empty}><Text style={styles.muted}>{t("noWorkspacePages")}</Text></View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <View key={row.port} style={styles.serviceRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("openPage", { title: row.label ?? `localhost:${row.port}` })}
                  style={({ pressed }) => [styles.serviceMain, pressed && styles.rowPressed]}
                  onPress={() => void (row.disconnected ? ports.reconnect(row).catch((error) => toast.error(errorMessage(error))) : open(row))}
                >
                  <Icon name="Globe" size={18} color={theme.colors.foregroundMuted} />
                  <View style={styles.rowText}>
                    <Text style={styles.title} numberOfLines={1}>{row.label ?? `localhost:${row.port}`}</Text>
                    <Text style={row.forward ? styles.forwarded : styles.muted} numberOfLines={1}>
                      {row.forward ? t("mapping", { remote: row.port, local: row.forward.localPort }) : row.disconnected ? t("disconnected") : `${row.protocol ?? "http"}://localhost:${row.port}`}
                    </Text>
                    {row.agent ? <Text style={styles.muted} numberOfLines={1}>{t("agentOwner", { title: row.agent.title })}</Text> : null}
                    {row.agent?.stopped ? <Text style={styles.muted}>{t("agentStopped")}</Text> : null}
                    {row.forward?.connectionError ? <Text style={styles.error}>{t("remoteConnectionFailed")}</Text> : null}
                  </View>
                  {ports.opening === row.port ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Text style={styles.secondaryAction}>{row.disconnected ? t("reconnect") : t("openAction")}</Text>}
                </Pressable>
                <View style={styles.rowAction}>
                  {row.forward && ports.opening !== row.port ? <IconButton icon="Unplug" label={t("unplug", { port: row.port })} color={theme.colors.foregroundMuted} onPress={() => void ports.close(row.port).catch((error) => toast.error(errorMessage(error)))} /> : null}
                  {row.pid !== null && row.startedAt !== null ? <IconButton icon="Square" label={t("stopServicePort", { port: row.port })} color={theme.colors.statusDanger} disabled={stoppingPort !== null} onPress={() => setStopping(row)} /> : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
      {recentPages.length > 0 ? <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{t("recentPages")}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            void api?.updateRecent((pages) => pages.filter((page) => page.serverId !== host.id || page.workspaceId !== workspaceId))
              .then(() => queryClient.invalidateQueries({ queryKey: ["recent-pages"] })).catch((error) => toast.error(errorMessage(error)));
          }}><Text style={styles.secondaryAction}>{t("clearRecent")}</Text></Pressable>
        </View>
        <View style={styles.list}>
          {recentPages.map((page) => <Pressable key={page.url} accessibilityRole="button" style={({ pressed }) => [styles.recentRow, pressed && styles.rowPressed]} onPress={() => {
            const parsed = parseAddress(page.url);
            if (!parsed) return;
            const known = [...ports.rows, ...ports.otherRows].find((row) => row.port === parsed.port);
            void open({ port: parsed.port, host: parsed.remoteHost === "::1" ? "::1" : known?.host ?? parsed.remoteHost, cwd: null, workspaceId }, parsed.url);
          }}><Icon name="History" size={16} color={theme.colors.foregroundMuted} /><Text style={styles.recentText} numberOfLines={1}>{page.url}</Text><Icon name="ArrowUpRight" size={16} color={theme.colors.foregroundMuted} /></Pressable>)}
        </View>
      </View> : null}
      <OtherPorts rows={otherRows} theme={theme} onOpen={(row, protocol) => {
        void ports.open(row, { protocol, workspaceId }).catch((error) => toast.error(errorMessage(error)));
      }} onClose={(row) => { void ports.close(row.port).catch((error) => toast.error(errorMessage(error))); }}
      onReconnect={(row) => { void ports.reconnect(row).catch((error) => toast.error(errorMessage(error))); }}
      onStop={(row) => ports.stop(row).catch((error) => toast.error(errorMessage(error)))} />
      <StopServiceConfirm row={stopping} theme={theme} onOpenChange={(open) => { if (!open) setStopping(null); }}
        onConfirm={(row) => { setStopping(null); setStoppingPort(row.port); void ports.stop(row).catch((error) => toast.error(errorMessage(error))).finally(() => setStoppingPort(null)); }} />
    </ScrollView>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { paddingHorizontal: compact ? 16 : 28, paddingVertical: compact ? 18 : 28, gap: 24 },
    center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: 12 },
    heading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 12 },
    headingTitle: { color: colors.foreground, fontSize: 20, fontWeight: "600" as const },
    refresh: { flexDirection: "row" as const, alignItems: "center" as const, gap: 7, minHeight: 40 },
    bar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingLeft: 14, paddingRight: 5, minHeight: 50, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    barFocused: { borderColor: colors.foregroundMuted },
    input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 10, outlineStyle: "solid" as const, outlineWidth: 0 },
    openButton: { minHeight: 38, justifyContent: "center" as const, paddingHorizontal: 16, borderRadius: 6, backgroundColor: colors.foreground },
    openButtonText: { color: colors.surface0, fontSize: 13, fontWeight: "600" as const },
    section: { gap: 10 },
    sectionHeading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, minHeight: 28, gap: 12 },
    sectionTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    count: { color: colors.foregroundMuted, fontSize: 13 },
    list: { backgroundColor: colors.surface1, borderRadius: 8, overflow: "hidden" as const },
    serviceRow: { flexDirection: "row" as const, alignItems: "center" as const },
    serviceMain: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 14, paddingVertical: 14, minHeight: 72 },
    rowAction: { flexDirection: "row" as const, alignItems: "center" as const, paddingRight: 8 },
    rowPressed: { backgroundColor: colors.surface2 },
    rowText: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    forwarded: { color: colors.statusSuccess, fontSize: 12 },
    error: { color: colors.statusDanger, fontSize: 13 },
    secondaryAction: { color: colors.foregroundMuted, fontSize: 13 },
    empty: { backgroundColor: colors.surface1, borderRadius: 8, padding: 18 },
    recentRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minHeight: 48, paddingHorizontal: 14 },
    recentText: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13 },
  };
}
