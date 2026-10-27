import type { PluginTheme } from "@getpaseo/plugin";
import { useHosts, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { sshTarget } from "../shared/ports";
import { groupPortsByWorkspace, workspaceLabel } from "./format";
import type { WorkspaceEntry } from "./format";
import { errorMessage } from "./kit";
import { messages } from "./messages";
import type { LocalApi } from "./bridge";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { readHostRegistry } from "./web";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;
const GAP = 14;

export function PortsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const hosts = useHosts();
  const { t } = useTranslation(messages);
  const registry = useMemo(() => readHostRegistry(), [hosts]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addingHost, setAddingHost] = useState(false);
  const [selectingHost, setSelectingHost] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
  const refresh = () => {
    setRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scan"] }),
      queryClient.invalidateQueries({ queryKey: ["forwards"] }),
    ]).finally(() => setRefreshing(false));
  };

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
  const selected = sections.find((item) => item.target === selectedTarget) ?? sections[0];
  const noHosts = api !== null && saved.isSuccess && sections.length === 0;
  const showAddHost = api !== null && (addingHost || noHosts);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageHeader}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.pageTitle}>{t("services")}</Text>
          {selected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("selectHost")}
              onPress={() => setSelectingHost(true)}
              style={({ pressed }) => [styles.scope, pressed && styles.pressed]}
            >
              <Icon name="Server" size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.scopeText} numberOfLines={1}>{selected.title}</Text>
              <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.headerTools}>
          {api && sections.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("rescan")} onPress={refresh}
              disabled={refreshing} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}>
              {refreshing ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> :
                <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />}
              <Text style={styles.toolText}>{t("rescan")}</Text>
            </Pressable>
          ) : null}
          {api && !showAddHost ? (
            <Pressable accessibilityRole="button" onPress={() => setAddingHost(true)}
              style={({ pressed }) => [styles.tool, styles.toolFilled, pressed && styles.pressed]}>
              <Icon name="Plus" size={16} color={theme.colors.foreground} />
              <Text style={styles.toolText}>{t("addHostButton")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal title={t("selectHost")} open={selectingHost} onOpenChange={setSelectingHost}>
        <Modal.Content>
          {sections.map((item) => (
            <View key={item.target} style={styles.hostRow}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: item.target === selected?.target }}
                onPress={() => { setSelectedTarget(item.target); setSelectingHost(false); }}
                style={({ pressed }) => [styles.hostChoice, pressed && styles.pressed]}>
                <Icon name="Server" size={16} color={theme.colors.foregroundMuted} />
                <Text style={styles.hostChoiceText} numberOfLines={1}>{item.title}</Text>
                {item.target === selected?.target ? <Icon name="Check" size={16} color={theme.colors.accent} /> : null}
              </Pressable>
              {item.manual ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t("removeHost", { host: item.title })}
                  onPress={() => void updateTargets((items) => items.filter((target) => item.target !== target))}
                  style={({ pressed }) => [styles.removeHost, pressed && styles.pressed]}>
                  <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </Modal.Content>
      </Modal>

      {api === null ? <Text style={styles.notice}>{t("needLocal")}</Text> : null}
      {saved.error ? <Text style={styles.error}>{errorMessage(saved.error)}</Text> : null}
      {api && saved.isPending && sections.length === 0 ? (
        <View style={styles.loadingState}><ActivityIndicator size="small" color={theme.colors.foregroundMuted} /></View>
      ) : null}
      {noHosts ? (
        <View style={styles.emptyHosts}>
          <View style={styles.emptyIcon}><Icon name="Server" size={20} color={theme.colors.foregroundMuted} /></View>
          <Text style={styles.emptyTitle}>{t("noHosts")}</Text>
          <Text style={styles.muted}>{t("noHostsHint")}</Text>
        </View>
      ) : null}
      {showAddHost ? (
        <AddHost styles={styles} theme={theme} canCancel={!noHosts} onCancel={() => setAddingHost(false)}
          onAdd={async (target) => {
            if (sections.some((item) => item.target === target)) {
              toast.error(t("hostExists"));
              return false;
            }
            const added = await updateTargets((items) => (items.includes(target) ? items : [...items, target]));
            if (added) { setAddingHost(false); setSelectedTarget(target); }
            return added;
          }} />
      ) : null}
      {api && selected ? (
        <HostSection key={selected.target} target={selected.target} serverId={selected.serverId}
          styles={styles} theme={theme} compact={layout.compact} navigation={navigation} />
      ) : null}
    </ScrollView>
  );
}

function HostSection({ target, serverId, styles, theme, compact, navigation }: {
  target: string; serverId: string | null; styles: Styles; theme: PluginTheme; compact: boolean; navigation: Navigation;
}) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const api = useApi();
  const ports = useHostPorts({ api, target, serverId, navigation });
  const [contentWidth, setContentWidth] = useState(0);
  const groups = groupPortsByWorkspace(ports.rows);
  const columns = compact ? 1 : Math.max(1, Math.min(3, Math.floor((contentWidth + GAP) / (280 + GAP))));
  const columnWidth = contentWidth ? (contentWidth - GAP * (columns - 1)) / columns : undefined;

  return (
    <View style={styles.section}>
      {ports.error ? <Text style={styles.error}>{errorMessage(ports.error)}</Text> : null}
      {ports.forwardError ? <Text style={styles.error}>{t("forwardError", { error: errorMessage(ports.forwardError) })}</Text> : null}
      {(ports.loading || ports.forwardStatus === "loading") && ports.rows.length === 0 && !ports.error ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /><Text style={styles.muted}>{t("scanning")}</Text>
        </View>
      ) : null}
      {ports.scanComplete && ports.forwardStatus === "ready" && ports.rows.length === 0 ? (
        <View style={styles.emptyPages}><Text style={styles.emptyTitle}>{t("noPages")}</Text><Text style={styles.muted}>{t("noPagesHint")}</Text></View>
      ) : null}
      <View style={styles.groups} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
        {groups.map(({ workspaceId, rows }) => {
          const workspace = workspaceId ? ports.workspacesById.get(workspaceId) : undefined;
          const heading = workspace ? workspaceLabel(workspace) : groups.length === 1 ? t("services") : t("unassignedServices");
          return (
            <View key={workspaceId ?? "unassigned"} style={[styles.group, { width: columnWidth }, workspace && styles.workspaceGroup]}>
              <View style={styles.groupHeading}>
                <Icon name="Folder" size={19} color={workspace ? theme.colors.accent : theme.colors.foregroundMuted} />
                <Text accessibilityRole="header" style={styles.groupTitle} numberOfLines={1}>{heading}</Text>
                <Text style={styles.groupCount}>{rows.length}</Text>
              </View>
              <View style={styles.cards}>
                {rows.map((row) => (
                  <PortCard key={row.port} row={row} opening={ports.opening === row.port}
                    forwardStatus={ports.forwardStatus} styles={styles} theme={theme}
                    workspaces={ports.canOpenWorkspace ? [...ports.workspacesById.values()] : []}
                    onOpen={(options) => ports.open(row, options).catch((error) => toast.error(errorMessage(error)))}
                    onClose={() => ports.close(row.port).catch((error) => toast.error(errorMessage(error)))} />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function PortCard({ row, opening, forwardStatus, styles, theme, workspaces, onOpen, onClose }: {
  row: Row; opening: boolean; forwardStatus: "ready" | "error" | "loading"; styles: Styles; theme: PluginTheme;
  workspaces: WorkspaceEntry[];
  onOpen: (options?: { external?: boolean; workspaceId?: string }) => void; onClose: () => Promise<void>;
}) {
  const { t } = useTranslation(messages);
  const [closing, setClosing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const title = row.label ?? t("portTitle", { port: row.port });
  const forward = forwardStatus === "ready" ? row.forward : undefined;
  const status = forwardStatus === "loading" ? t("checkingForward") : forwardStatus === "error" ? t("forwardUnavailable") :
    forward ? t("forwardedTo", { port: forward.localPort }) : t("notForwarded");
  const busy = opening || closing;
  const close = async () => {
    setActionsOpen(false);
    setClosing(true);
    try { await onClose(); } finally { setClosing(false); }
  };
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("openPage", { title })}, ${status}`}
        accessibilityState={{ disabled: busy, busy: opening }} disabled={busy} onPress={() => onOpen()}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}>
        <View style={styles.cardHead}>
          <Icon name="Globe" size={19} color={theme.colors.foregroundMuted} />
          <View style={styles.cardNames}>
            <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.cardPort}>{t("port", { port: row.port })}</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.statusRow}>
            {busy ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> :
              <View style={[styles.statusDot, forward && styles.statusDotOn]} />}
            <Text style={styles.statusText} numberOfLines={1}>{status}</Text>
          </View>
          <View style={styles.openAction}><Text style={styles.openActionText}>{t("openAction")}</Text><Icon name="ArrowRight" size={14} color={theme.colors.foreground} /></View>
        </View>
      </Pressable>
      {row.workspaceId || workspaces.length > 0 || forward ? <Pressable accessibilityRole="button" accessibilityLabel={t("serviceActions", { title })}
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => setActionsOpen(true)}
        style={({ pressed }) => [styles.cardMenu, pressed && styles.pressed]}>
        <Icon name="Ellipsis" size={18} color={theme.colors.foregroundMuted} />
      </Pressable> : null}
      <Modal title={title} open={actionsOpen} onOpenChange={setActionsOpen}>
        <Modal.Content>
          {row.workspaceId ? <Pressable accessibilityRole="button" onPress={() => { setActionsOpen(false); onOpen({ external: true }); }} style={styles.menuAction}>
            <Icon name="ExternalLink" size={16} color={theme.colors.foregroundMuted} />
            <Text style={styles.menuActionText}>{t("openExternal", { title })}</Text>
          </Pressable> : workspaces.length > 0 ? <Pressable accessibilityRole="button" onPress={() => { setActionsOpen(false); setSelectingWorkspace(true); }} style={styles.menuAction}>
            <Icon name="Folder" size={16} color={theme.colors.foregroundMuted} />
            <Text style={styles.menuActionText}>{t("openInWorkspace")}</Text>
          </Pressable> : null}
          {forward ? (
            <Pressable accessibilityRole="button" onPress={() => void close()} style={styles.menuAction}>
              <Icon name="Unplug" size={16} color={theme.colors.foregroundMuted} />
              <Text style={styles.menuActionText}>{t("unplug", { port: row.port })}</Text>
            </Pressable>
          ) : null}
        </Modal.Content>
      </Modal>
      <Modal title={t("selectWorkspace")} open={selectingWorkspace} onOpenChange={setSelectingWorkspace}>
        <Modal.Content>
          <ScrollView style={styles.workspaceChoices}>
            {workspaces.map((workspace) => (
              <Pressable key={workspace.id} accessibilityRole="button" onPress={() => { setSelectingWorkspace(false); onOpen({ workspaceId: workspace.id }); }} style={styles.menuAction}>
                <Icon name="Folder" size={16} color={theme.colors.foregroundMuted} />
                <Text style={styles.menuActionText}>{workspaceLabel(workspace)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Modal.Content>
      </Modal>
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
    content: { width: "100%" as const, alignSelf: "center" as const, padding: compact ? 16 : 24, gap: 28 },
    pageHeader: { flexDirection: compact ? "column" as const : "row" as const, alignItems: compact ? "stretch" as const : "center" as const, gap: 12 },
    titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, flexShrink: 1 },
    pageTitle: { color: colors.foreground, fontSize: compact ? 20 : 24, fontWeight: "700" as const },
    scope: { flexShrink: 1, minWidth: 0, minHeight: 34, flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, borderRadius: 7, backgroundColor: colors.surface1 },
    scopeText: { flexShrink: 1, color: colors.foreground, fontSize: 13 },
    headerTools: { marginLeft: "auto" as const, flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    tool: { minHeight: 36, flexDirection: "row" as const, alignItems: "center" as const, gap: 7, paddingHorizontal: 10, borderRadius: 7 },
    toolFilled: { backgroundColor: colors.surface2 },
    toolText: { color: colors.foreground, fontSize: 13 },
    pressed: { opacity: 0.65 }, disabled: { opacity: 0.5 },
    notice: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    hostRow: { flexDirection: "row" as const, alignItems: "center" as const },
    hostChoice: { flex: 1, minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    hostChoiceText: { flex: 1, color: colors.foreground, fontSize: 14 },
    removeHost: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" as const },
    hostActionText: { color: colors.foregroundMuted, fontSize: 13 },
    section: { gap: 16 },
    groups: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "stretch" as const, gap: GAP },
    group: { minWidth: 0, padding: compact ? 14 : 18, gap: 20, borderWidth: 1, borderTopWidth: 2, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.surface0 },
    workspaceGroup: { borderTopColor: colors.accent },
    groupHeading: { minHeight: 26, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    groupTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    groupCount: { color: colors.foregroundMuted, fontSize: 13, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.surface1, fontVariant: ["tabular-nums" as const] },
    cards: { gap: 14 },
    card: { minHeight: 146, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, overflow: "hidden" as const },
    cardMain: { flex: 1, minHeight: 144, padding: 16, justifyContent: "space-between" as const, gap: 24 },
    cardPressed: { backgroundColor: colors.surface2 },
    cardHead: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12, paddingRight: 32 },
    cardNames: { flex: 1, minWidth: 0, gap: 4 },
    cardTitle: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
    cardPort: { color: colors.foregroundMuted, fontSize: 13 },
    cardFooter: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 8 },
    statusRow: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: 7 },
    statusText: { flexShrink: 1, color: colors.foregroundMuted, fontSize: 12 },
    statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.foregroundMuted },
    statusDotOn: { backgroundColor: colors.statusSuccess },
    openAction: { minHeight: 34, flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
    openActionText: { color: colors.foreground, fontSize: 13 },
    cardMenu: { position: "absolute" as const, right: 8, top: 8, width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const },
    menuAction: { minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    workspaceChoices: { maxHeight: 400 },
    menuActionText: { flex: 1, color: colors.foreground, fontSize: 14 },
    loadingState: { minHeight: 48, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    emptyHosts: { alignItems: "center" as const, gap: 8, paddingTop: compact ? 20 : 32 },
    emptyIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: colors.surface1 },
    emptyTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    emptyPages: { gap: 6, padding: 18, borderRadius: 12, backgroundColor: colors.surface1 },
    muted: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    addPanel: { gap: 10, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    emptyAddPanel: { width: "100%" as const, maxWidth: 600, alignSelf: "center" as const },
    addHeading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
    addTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    cancelButton: { minHeight: 36, padding: 4, justifyContent: "center" as const },
    fieldLabel: { color: colors.foregroundMuted, fontSize: 12 },
    addRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: 8 },
    input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    addButton: { minHeight: 40, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, paddingHorizontal: 16, borderRadius: 8, backgroundColor: colors.accent },
    addButtonText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 19 },
  };
}
