import type { PluginTheme } from "@getpaseo/plugin";
import {
  useHosts,
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
import { readHostRegistry } from "./web";
import { OtherPorts } from "./other-ports";

type Styles = ReturnType<typeof createStyles>;

const tabSchema = z.object({ autoOpened: z.boolean() });

export function BrowserPanel(props: PluginWorkspacePanelProps & { suppressAutoOpen?: () => boolean }) {
  const { theme, layout, host } = props;
  const { t } = useTranslation(messages);
  const hosts = useHosts();
  const registry = useMemo(() => readHostRegistry(), [hosts]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const api = useApi();
  // A host Paseo reaches over SSH carries its address; one reached another way, such as the relay,
  // needs the SSH host entered on the sidebar screen, matched here by its Paseo server.
  const saved = useQuery({
    queryKey: ["targets"],
    queryFn: () => (api as LocalApi).targets(),
    enabled: api !== null && !registry.ssh.some((item) => item.serverId === host.id),
  });
  const target =
    registry.ssh.find((item) => item.serverId === host.id)?.target ??
    saved.data?.targets.find((item) => item.serverId === host.id)?.target;

  if (api && !target && saved.isPending && saved.fetchStatus !== "idle") {
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
  suppressAutoOpen,
}: PluginWorkspacePanelProps & { target: string; styles: Styles; suppressAutoOpen?: () => boolean }) {
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
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);

  const open = (row: Pick<Row, "port" | "host" | "cwd" | "workspaceId"> & { protocol?: "http" | "https" | null }, remoteUrl?: string) =>
    ports.open(row, { remoteUrl, workspaceId }).catch((error) => toast.error(errorMessage(error)));

  // The first time this tab finds exactly one page of its workspace, open it without being asked.
  const only = rows.length === 1 ? rows[0] : null;
  useEffect(() => {
    if (suppressAutoOpen?.() || state.autoOpened || !ports.loaded || !only || only.forward || only.disconnected) return;
    setState({ autoOpened: true });
    void open(only);
  }, [suppressAutoOpen, state.autoOpened, ports.loaded, only?.port]);

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
    <View style={styles.screen}>
      <View style={[styles.bar, addressFocused && styles.barFocused]}>
        <Icon name="Globe" size={16} color={theme.colors.foregroundMuted} />
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
        {ports.loading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <IconButton icon="RefreshCw" label={t("rescan")} color={theme.colors.foregroundMuted} onPress={ports.refresh} />
        )}
      </View>
      {ports.error ? <Text style={styles.error}>{t("scanFailed", { error: errorMessage(ports.error) })}</Text> : null}
      {ports.loaded && rows.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Icon name="Globe" size={22} color={theme.colors.foregroundMuted} />
          </View>
          <Text style={styles.muted}>{t("noWorkspacePages")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <Pressable
              key={row.port}
              accessibilityRole="button"
              accessibilityLabel={row.label ?? `localhost:${row.port}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => void (row.disconnected ? ports.reconnect(row).catch((error) => toast.error(errorMessage(error))) : open(row))}
            >
              <Icon name="Globe" size={16} color={theme.colors.foregroundMuted} />
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>
                  {row.label ?? `localhost:${row.port}`}
                </Text>
                <Text style={row.forward ? styles.forwarded : styles.muted} numberOfLines={1}>
                  {row.forward ? t("mapping", { remote: row.port, local: row.forward.localPort }) : row.disconnected ? t("disconnected") : `${row.protocol ?? "http"}://localhost:${row.port}`}
                </Text>
                {row.agent ? <Text style={styles.muted} numberOfLines={1}>{t("agentOwner", { title: row.agent.title })}{row.agent.stopped ? ` · ${t("agentStopped")}` : ""}</Text> : null}
                {row.forward?.connectionError ? <Text style={styles.error}>{t("remoteConnectionFailed")}</Text> : null}
              </View>
              {ports.opening === row.port ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : row.disconnected ? <Text style={styles.title}>{t("reconnect")}</Text> : row.forward ? (
                <IconButton
                  icon="Unplug"
                  label={t("unplug", { port: row.port })}
                  color={theme.colors.foregroundMuted}
                  onPress={() => void ports.close(row.port).catch((error) => toast.error(errorMessage(error)))}
                />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
      {recentPages.length > 0 ? <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.title}>{t("recentPages")}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            void api?.updateRecent((pages) => pages.filter((page) => page.serverId !== host.id || page.workspaceId !== workspaceId))
              .then(() => queryClient.invalidateQueries({ queryKey: ["recent-pages"] })).catch((error) => toast.error(errorMessage(error)));
          }}><Text style={styles.muted}>{t("clearRecent")}</Text></Pressable>
        </View>
        {recentPages.map((page) => <Pressable key={page.url} accessibilityRole="button" style={styles.row} onPress={() => {
          const parsed = parseAddress(page.url);
          if (!parsed) return;
          const known = [...ports.rows, ...ports.otherRows].find((row) => row.port === parsed.port);
          void open({ port: parsed.port, host: parsed.remoteHost === "::1" ? "::1" : known?.host ?? parsed.remoteHost, cwd: null, workspaceId }, parsed.url);
        }}><Text style={styles.muted} numberOfLines={1}>{page.url}</Text></Pressable>)}
      </View> : null}
      <OtherPorts rows={otherRows} theme={theme} onOpen={(row, protocol) => {
        void ports.open(row, { protocol, workspaceId }).catch((error) => toast.error(errorMessage(error)));
      }} onClose={(row) => { void ports.close(row.port).catch((error) => toast.error(errorMessage(error))); }}
      onReconnect={(row) => { void ports.reconnect(row).catch((error) => toast.error(errorMessage(error))); }} />
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0, padding: compact ? 12 : 16, gap: 12 },
    center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: 12 },
    bar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    barFocused: { borderColor: colors.foregroundMuted, backgroundColor: colors.surface2 },
    input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 9, outlineStyle: "solid" as const, outlineWidth: 0 },
    list: { gap: 2 },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
    },
    rowPressed: { backgroundColor: colors.surface2 },
    rowText: { flex: 1, gap: 2 },
    title: { color: colors.foreground, fontSize: 14 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    forwarded: { color: colors.statusSuccess, fontSize: 12 },
    error: { color: colors.statusDanger, fontSize: 13 },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface1,
    },
  };
}
