import type { PluginTheme } from "@getpaseo/plugin";
import { useHosts, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { sshTarget } from "../shared/ports";
import { workspaceLabel, type WorkspaceEntry } from "./format";
import { Avatar, errorMessage } from "./kit";
import { messages } from "./messages";
import type { LocalApi } from "./bridge";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { readHostRegistry } from "./web";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;
const TABLE_MIN_WIDTH = 900;

export function PortsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const hosts = useHosts();
  const { t } = useTranslation(messages);
  // Re-read the app's saved hosts whenever its host list or connection states change.
  const registry = useMemo(() => readHostRegistry(), [hosts]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addingHost, setAddingHost] = useState(false);
  const saved = useQuery({
    queryKey: ["targets"],
    queryFn: () => (api as LocalApi).targets(),
    enabled: api !== null,
  });
  const updateTargets = async (change: (targets: string[]) => string[]) => {
    try {
      await api?.updateTargets(change);
      await queryClient.invalidateQueries({ queryKey: ["targets"] });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };

  // SSH hosts Paseo is connected to need no setup. Hosts entered by hand cover the rest, such as
  // a host Paseo reaches through the relay; scanning one tells which Paseo host it is.
  const connected = registry.ssh.flatMap(({ serverId, target }) => {
    const host = hosts.find((item) => item.serverId === serverId && item.status === "online");
    return host ? [{ target, title: host.label, serverId, manual: false }] : [];
  });
  const manual = (saved.data?.targets ?? [])
    .filter(({ target, serverId }) => !connected.some((item) => item.target === target || item.serverId === serverId))
    .map(({ target, serverId }) => ({
      target,
      serverId,
      title: hosts.find((item) => item.serverId === serverId)?.label ?? target,
      manual: true,
    }));
  const sections = [...connected, ...manual];
  const noHosts = api !== null && saved.isSuccess && sections.length === 0;
  const showAddHost = api !== null && (addingHost || noHosts);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>{t("services")}</Text>
        {api && !showAddHost ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAddingHost(true)}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <Icon name="Plus" size={16} color={theme.colors.foreground} />
            <Text style={styles.headerButtonText}>{t("addHostButton")}</Text>
          </Pressable>
        ) : null}
      </View>

      {api === null ? <Text style={styles.notice}>{t("needLocal")}</Text> : null}
      {saved.error ? <Text style={styles.error}>{errorMessage(saved.error)}</Text> : null}
      {api && saved.isPending && sections.length === 0 ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        </View>
      ) : null}
      {noHosts ? (
        <View style={styles.emptyHosts}>
          <View style={styles.emptyIcon}>
            <Icon name="Server" size={20} color={theme.colors.foregroundMuted} />
          </View>
          <Text style={styles.emptyTitle}>{t("noHosts")}</Text>
          <Text style={styles.muted}>{t("noHostsHint")}</Text>
        </View>
      ) : null}
      {showAddHost ? (
        <AddHost
          styles={styles}
          theme={theme}
          canCancel={!noHosts}
          onCancel={() => setAddingHost(false)}
          onAdd={async (target) => {
            if (sections.some((item) => item.target === target)) {
              toast.error(t("hostExists"));
              return false;
            }
            const added = await updateTargets((items) => (items.includes(target) ? items : [...items, target]));
            if (added) setAddingHost(false);
            return added;
          }}
        />
      ) : null}
      {api &&
        sections.map(({ target, title, serverId, manual: removable }) => (
          <HostSection
            key={target}
            target={target}
            title={title}
            serverId={serverId}
            styles={styles}
            theme={theme}
            compact={layout.compact}
            navigation={navigation}
            onRemove={removable ? () => void updateTargets((items) => items.filter((item) => item !== target)) : undefined}
          />
        ))}
    </ScrollView>
  );
}

function HostSection({
  target,
  title,
  serverId,
  styles,
  theme,
  compact,
  navigation,
  onRemove,
}: {
  target: string;
  title: string;
  serverId: string | null;
  styles: Styles;
  theme: PluginTheme;
  compact: boolean;
  navigation: Navigation;
  onRemove?: () => void;
}) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const api = useApi();
  const ports = useHostPorts({ api, target, serverId, navigation });
  const [contentWidth, setContentWidth] = useState(0);

  // Pages of workspaces first; system services and other tools after them.
  const rows = [...ports.rows].sort(
    (a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null),
  );
  const useCards = compact || (contentWidth > 0 && contentWidth < TABLE_MIN_WIDTH);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.hostIcon}>
          <Icon name="Server" size={16} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={styles.host} numberOfLines={1}>
          {title}
        </Text>
        {ports.scanComplete && ports.forwardStatus === "ready" && (!compact || !onRemove) ? (
          <Text style={styles.hostCount}>{t("serviceCount", { count: rows.length })}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("rescan")}
          accessibilityState={{ disabled: ports.loading, busy: ports.loading }}
          disabled={ports.loading}
          onPress={ports.refresh}
          style={({ pressed }) => [styles.hostAction, pressed && styles.pressed]}
        >
          {ports.loading ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Icon name="RefreshCw" size={15} color={theme.colors.foregroundMuted} />
          )}
          <Text style={styles.hostActionText}>{t("rescan")}</Text>
        </Pressable>
        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("removeHost", { host: title })}
            onPress={onRemove}
            style={({ pressed }) => [styles.hostAction, pressed && styles.pressed]}
          >
            <Text style={styles.hostActionText}>{t("remove")}</Text>
          </Pressable>
        ) : null}
      </View>
      {ports.error ? <Text style={styles.error}>{errorMessage(ports.error)}</Text> : null}
      {ports.forwardError ? (
        <Text style={styles.error}>{t("forwardError", { error: errorMessage(ports.forwardError) })}</Text>
      ) : null}
      {(ports.loading || ports.forwardStatus === "loading") && rows.length === 0 && !ports.error ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          <Text style={styles.muted}>{t("scanning")}</Text>
        </View>
      ) : null}
      {ports.scanComplete && ports.forwardStatus === "ready" && rows.length === 0 ? (
        <View style={styles.emptyPages}>
          <Text style={styles.emptyTitle}>{t("noPages")}</Text>
          <Text style={styles.muted}>{t("noPagesHint")}</Text>
        </View>
      ) : null}
      <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
        {rows.length > 0 ? (
          <View style={useCards ? styles.stack : styles.table}>
            {!useCards ? (
              <View style={styles.tableHeader}>
                <View style={styles.tableColumns}>
                  <Text style={[styles.serviceColumn, styles.columnHeading]}>{t("serviceColumn")}</Text>
                  <Text style={[styles.portColumn, styles.columnHeading]}>{t("remotePortLabel")}</Text>
                  <Text style={[styles.localColumn, styles.columnHeading]}>{t("localAddressLabel")}</Text>
                  <Text style={[styles.workspaceColumn, styles.columnHeading]}>{t("workspaceField")}</Text>
                  <Text style={[styles.statusColumn, styles.columnHeading]}>{t("statusColumn")}</Text>
                </View>
                <View style={styles.tableActions}>
                  <Text style={styles.columnHeading}>{t("actionsColumn")}</Text>
                </View>
              </View>
            ) : null}
            {rows.map((row, index) => (
              <PortEntry
                key={row.port}
                row={row}
                workspace={row.workspaceId ? ports.workspacesById.get(row.workspaceId) : undefined}
                compact={useCards}
                last={index === rows.length - 1}
                opening={ports.opening === row.port}
                forwardStatus={ports.forwardStatus}
                styles={styles}
                theme={theme}
                onOpen={(external) =>
                  ports.open(row, { external }).catch((error) => toast.error(errorMessage(error)))
                }
                onClose={() => ports.close(row.port).catch((error) => toast.error(errorMessage(error)))}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PortEntry({
  row,
  workspace,
  compact,
  last,
  opening,
  forwardStatus,
  styles,
  theme,
  onOpen,
  onClose,
}: {
  row: Row;
  workspace: WorkspaceEntry | undefined;
  compact: boolean;
  last: boolean;
  opening: boolean;
  forwardStatus: "ready" | "error" | "loading";
  styles: Styles;
  theme: PluginTheme;
  onOpen: (external: boolean) => void;
  onClose: () => Promise<void>;
}) {
  const { t } = useTranslation(messages);
  const [closing, setClosing] = useState(false);
  const title = row.label ?? t("portTitle", { port: row.port });
  const forward = forwardStatus === "ready" ? row.forward : undefined;
  const address = forward ? `localhost:${forward.localPort}` : null;
  const workspaceName = workspace ? workspaceLabel(workspace) : null;
  const status = forwardStatus === "loading"
    ? t("checkingForward")
    : forwardStatus === "error"
      ? t("forwardUnavailable")
      : t(forward ? "forwarded" : "notForwarded");
  const busy = opening || closing;
  const close = async () => {
    setClosing(true);
    try {
      await onClose();
    } finally {
      setClosing(false);
    }
  };
  const serviceIcon = row.label || workspace ? (
    <Avatar text={workspace ? workspace.projectCustomName || workspace.projectDisplayName : title} theme={theme} />
  ) : (
    <View style={styles.serviceIcon}>
      <Icon name="Globe" size={17} color={theme.colors.accent} />
    </View>
  );
  const indicator = opening ? (
    <ActivityIndicator size="small" color={theme.colors.accent} />
  ) : (
    <Icon name="ArrowRight" size={16} color={theme.colors.foregroundMuted} />
  );
  const statusView = (
    <View style={styles.statusLine}>
      <View style={[styles.statusDot, forward && styles.statusDotForwarded]} />
      <Text style={forward ? styles.statusForwarded : styles.statusText} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
  const actions = (
    <View style={styles.cardActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("openExternal", { title })}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => onOpen(true)}
        style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
      >
        <Icon name="ExternalLink" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.cardActionText}>{t("browser")}</Text>
      </Pressable>
      {forward ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("unplug", { port: row.port })}
          accessibilityState={{ disabled: busy, busy: closing }}
          disabled={busy}
          onPress={() => void close()}
          style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
        >
          {closing ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Icon name="Unplug" size={14} color={theme.colors.foregroundMuted} />
          )}
          <Text style={styles.cardActionText}>{t("stopForwarding")}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={[compact ? styles.card : styles.tableRow, !compact && !last && styles.rowDivider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          t("openPage", { title }),
          `${t("remotePortLabel")} ${row.port}`,
          `${t("localAddressLabel")} ${forwardStatus === "ready" ? address ?? t("noValue") : status}`,
          `${t("workspaceField")} ${workspaceName ?? t("noValue")}`,
        ].join(", ")}
        accessibilityState={{ disabled: busy, busy: opening }}
        disabled={busy}
        style={({ pressed }) => [
          compact ? styles.cardMain : styles.tableRowMain,
          pressed && styles.cardPressed,
        ]}
        onPress={() => onOpen(false)}
        onLongPress={() => onOpen(true)}
      >
        {compact ? (
          <>
            <View style={styles.cardHeading}>
              {serviceIcon}
              <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
              {indicator}
            </View>
            <View style={styles.cardDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t("remotePortLabel")}</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{row.port}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t("localAddressLabel")}</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{address ?? "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t("workspaceField")}</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{workspaceName ?? "—"}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={[styles.serviceColumn, styles.cardHeading]}>
              {serviceIcon}
              <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
              {indicator}
            </View>
            <Text style={[styles.portColumn, styles.tableValue]} numberOfLines={1}>{row.port}</Text>
            <Text style={[styles.localColumn, styles.tableValue]} numberOfLines={1}>{address ?? "—"}</Text>
            <Text style={[styles.workspaceColumn, styles.tableValue]} numberOfLines={1}>{workspaceName ?? "—"}</Text>
            <View style={styles.statusColumn}>{statusView}</View>
          </>
        )}
      </Pressable>
      <View style={compact ? styles.cardFooter : styles.tableActions}>
        {compact ? statusView : null}
        {actions}
      </View>
    </View>
  );
}

function AddHost({
  styles,
  theme,
  canCancel,
  onCancel,
  onAdd,
}: {
  styles: Styles;
  theme: PluginTheme;
  canCancel: boolean;
  onCancel: () => void;
  onAdd: (target: string) => Promise<boolean>;
}) {
  const { t } = useTranslation(messages);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const parsed = sshTarget.safeParse(text);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    try {
      if (await onAdd(parsed.data)) {
        setText("");
        setInvalid(false);
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={[styles.addPanel, !canCancel && styles.emptyAddPanel]}>
      <View style={styles.addHeading}>
        <Text style={styles.addTitle}>{t("addHostTitle")}</Text>
        {canCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.hostActionText}>{t("cancel")}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.fieldLabel}>{t("hostAddress")}</Text>
      <View style={styles.addRow}>
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            setInvalid(false);
          }}
          onSubmitEditing={() => void submit()}
          placeholder={t("addHost")}
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t("hostAddress")}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || !text.trim(), busy: saving }}
          disabled={saving || !text.trim()}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.addButton,
            (saving || !text.trim()) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {saving ? <ActivityIndicator size="small" color={theme.colors.accentForeground} /> : null}
          <Text style={styles.addButtonText}>{t("add")}</Text>
        </Pressable>
      </View>
      {invalid ? <Text style={styles.error}>{t("invalidHost")}</Text> : null}
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: {
      width: "100%" as const,
      maxWidth: 1320,
      alignSelf: "center" as const,
      padding: compact ? 16 : 24,
      gap: 24,
    },
    pageHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 12,
    },
    pageTitle: { flex: 1, color: colors.foreground, fontSize: compact ? 20 : 22, fontWeight: "700" as const },
    headerButton: {
      minHeight: 40,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
    },
    headerButtonText: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    pressed: { opacity: 0.65 },
    disabled: { opacity: 0.5 },
    notice: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    section: { gap: 12 },
    sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: compact ? 6 : 10 },
    hostIcon: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface1,
    },
    host: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    hostCount: { color: colors.foregroundMuted, fontSize: 12 },
    hostAction: {
      minHeight: 40,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
      paddingHorizontal: compact ? 4 : 8,
    },
    hostActionText: { color: colors.foregroundMuted, fontSize: 13 },
    stack: { gap: 12 },
    table: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    tableHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableColumns: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    columnHeading: { color: colors.foregroundMuted, fontSize: 12 },
    serviceColumn: { flex: 2.3, minWidth: 0 },
    portColumn: { width: 75 },
    localColumn: { width: 110 },
    workspaceColumn: { flex: 1, minWidth: 0 },
    statusColumn: { width: 100 },
    tableRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 14 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    tableRowMain: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      minHeight: 60,
      paddingVertical: 8,
    },
    tableValue: { color: colors.foregroundMuted, fontSize: 12 },
    tableActions: {
      width: 184,
      marginLeft: 10,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "flex-end" as const,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    cardMain: {
      flexGrow: 1,
      gap: 12,
      padding: 14,
    },
    cardPressed: { backgroundColor: colors.surface2 },
    cardHeading: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    serviceIcon: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface2,
    },
    cardTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    cardDetails: { gap: 4 },
    detailRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    detailLabel: { width: 80, color: colors.foregroundMuted, fontSize: 12 },
    detailValue: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12 },
    cardFooter: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 14,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 8,
    },
    statusLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 18 },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.foregroundMuted },
    statusDotForwarded: { backgroundColor: colors.statusSuccess },
    statusText: { color: colors.foregroundMuted, fontSize: 12 },
    statusForwarded: { color: colors.statusSuccess, fontSize: 12 },
    cardActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    cardAction: { minHeight: 40, flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
    cardActionText: { color: colors.foregroundMuted, fontSize: 12 },
    loadingState: { minHeight: 48, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    emptyHosts: { alignItems: "center" as const, gap: 8, paddingTop: compact ? 20 : 32 },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface1,
    },
    emptyTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    emptyPages: {
      gap: 6,
      padding: 18,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    muted: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    addPanel: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    emptyAddPanel: { width: "100%" as const, maxWidth: 600, alignSelf: "center" as const },
    addHeading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
    addTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    cancelButton: { minHeight: 36, padding: 4, justifyContent: "center" as const },
    fieldLabel: { color: colors.foregroundMuted, fontSize: 12 },
    addRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: 8 },
    input: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface0,
    },
    addButton: {
      minHeight: 40,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 6,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.accent,
    },
    addButtonText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 19 },
  };
}
