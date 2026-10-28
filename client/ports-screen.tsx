import type { PluginTheme } from "@getpaseo/plugin";
import { useHosts, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from "react-native";
import { sshTarget } from "../shared/ports";
import { groupPortsByWorkspace, workspaceLabel } from "./format";
import type { WorkspaceEntry } from "./format";
import { errorMessage } from "./kit";
import { messages } from "./messages";
import type { LocalApi } from "./bridge";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { cardHoverDuration, readHostRegistry } from "./web";
import { OtherPorts } from "./other-ports";
import { StopServiceConfirm } from "./stop-service-confirm";
import { InstallHint } from "./install-hint";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;
const CARD_GAP = 12;

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
      selected && api ? api.scan({ target: selected.target, refresh: true }).then((data) => queryClient.setQueryData(["scan", selected.target], data)) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["forwards"] }),
    ]).catch((error) => toast.error(errorMessage(error))).finally(() => setRefreshing(false));
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
  const remotePlugin = useQuery({
    queryKey: ["remote-plugin-status", selected?.target, selected?.serverId],
    queryFn: () => api!.remotePluginStatus({ target: selected!.target, serverId: selected!.serverId! }),
    enabled: api !== null && !!selected?.serverId && hosts.some((host) => host.serverId === selected.serverId && host.status === "online"),
    refetchInterval: 30_000,
    retry: false,
  });

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
        <Modal.Content contentContainerStyle={styles.dialogList}>
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

      {api === null ? <InstallHint theme={theme} side="local" /> : null}
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
        <>
          {remotePlugin.isSuccess && remotePlugin.data.status !== "running" ?
            <InstallHint theme={theme} side="remote" host={selected.title} unavailable={remotePlugin.data.status === "unavailable"} /> : null}
          <HostSection key={selected.target} target={selected.target} serverId={selected.serverId}
            styles={styles} theme={theme} compact={layout.compact} navigation={navigation} />
        </>
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
  const groups = groupPortsByWorkspace(ports.rows);

  return (
    <View style={styles.section}>
      {ports.error ? <Text style={styles.error}>{t("scanFailed", { error: errorMessage(ports.error) })}</Text> : null}
      {ports.forwardError ? <Text style={styles.error}>{t("forwardError", { error: errorMessage(ports.forwardError) })}</Text> : null}
      {(ports.loading || ports.forwardStatus === "loading") && ports.rows.length === 0 && !ports.error ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /><Text style={styles.muted}>{t("scanning")}</Text>
        </View>
      ) : null}
      {ports.scanComplete && ports.forwardStatus === "ready" && ports.rows.length === 0 ? (
        <View style={styles.emptyPages}><Text style={styles.emptyTitle}>{t("noPages")}</Text><Text style={styles.muted}>{t("noPagesHint")}</Text></View>
      ) : null}
      <View style={styles.groups}>
        {groups.map(({ workspaceId, rows }) => {
          const workspace = workspaceId ? ports.workspacesById.get(workspaceId) : undefined;
          const heading = workspace ? workspaceLabel(workspace) : groups.length === 1 ? t("services") : t("unassignedServices");
          return (
            <View key={workspaceId ?? "unassigned"} style={styles.group}>
              <View style={styles.groupHeading}>
                <Icon name="Folder" size={18} color={theme.colors.foregroundMuted} />
                <Text accessibilityRole="header" style={styles.groupTitle} numberOfLines={1}>{heading}</Text>
                <Text style={styles.groupCount}>{rows.length}</Text>
              </View>
              <View style={styles.cards}>
                {rows.map((row) => (
                  <View key={row.port} style={styles.cardSlot}>
                    <PortCard row={row} opening={ports.opening === row.port}
                      forwardStatus={ports.forwardStatus} styles={styles} theme={theme}
                      workspaces={ports.canOpenWorkspace ? [...ports.workspacesById.values()] : []}
                      onOpen={(options) => ports.open(row, options).catch((error) => toast.error(errorMessage(error)))}
                      onStop={() => ports.stop(row).catch((error) => toast.error(errorMessage(error)))}
                      onReconnect={() => ports.reconnect(row).catch((error) => toast.error(errorMessage(error)))}
                      onClose={() => ports.close(row.port).catch((error) => toast.error(errorMessage(error)))} />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
      <OtherPorts rows={ports.otherRows} theme={theme} compact={compact} onOpen={(row, protocol) => {
        void ports.open(row, { protocol }).catch((error) => toast.error(errorMessage(error)));
      }} onClose={(row) => { void ports.close(row.port).catch((error) => toast.error(errorMessage(error))); }}
      onReconnect={(row) => { void ports.reconnect(row).catch((error) => toast.error(errorMessage(error))); }}
      onStop={(row) => ports.stop(row).catch((error) => toast.error(errorMessage(error)))} />
    </View>
  );
}

function PortCard({ row, opening, forwardStatus, styles, theme, workspaces, onOpen, onClose, onReconnect, onStop }: {
  row: Row; opening: boolean; forwardStatus: "ready" | "error" | "loading"; styles: Styles; theme: PluginTheme;
  workspaces: WorkspaceEntry[];
  onOpen: (options?: { external?: boolean; workspaceId?: string }) => void; onClose: () => Promise<void>;
  onReconnect: () => void; onStop: () => Promise<void>;
}) {
  const { t } = useTranslation(messages);
  const [closing, setClosing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(false);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const hover = useRef(new Animated.Value(0)).current;
  const menuHover = useRef(new Animated.Value(0)).current;
  useEffect(() => () => { hover.stopAnimation(); menuHover.stopAnimation(); }, [hover, menuHover]);
  const animateHover = (animation: Animated.Value, value: number) => {
    const duration = cardHoverDuration();
    if (duration === null) return;
    Animated.timing(animation, { toValue: value, duration, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: false }).start();
  };
  const title = row.label ?? t("portTitle", { port: row.port });
  const forward = forwardStatus === "ready" ? row.forward : undefined;
  const status = forwardStatus === "loading" ? t("checkingForward") : forwardStatus === "error" ? t("forwardUnavailable") :
    forward?.connectionError ? t("remoteConnectionFailedShort") : forward ? t("forwardConnected") : row.disconnected ? t("disconnected") : t("notForwarded");
  const portLabel = row.label ? t("port", { port: row.port }) : null;
  const busy = opening || closing;
  const close = async () => {
    setActionsOpen(false);
    setClosing(true);
    try { await onClose(); } finally { setClosing(false); }
  };
  return (
    <View style={styles.card}
      onPointerEnter={(event) => { if (event.nativeEvent.pointerType === "mouse") animateHover(hover, 1); }}
      onPointerLeave={(event) => { if (event.nativeEvent.pointerType === "mouse") animateHover(hover, 0); }}>
      <Animated.View pointerEvents="none" style={[styles.cardHover, { opacity: hover }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("openPage", { title })}, ${portLabel ? `${portLabel}, ` : ""}${status}`}
        accessibilityState={{ disabled: busy, busy: opening }} disabled={busy} onPress={() => row.disconnected ? onReconnect() : onOpen()}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}>
        <View style={styles.cardHead}>
          <Icon name="Globe" size={19} color={theme.colors.foregroundMuted} />
          <View style={styles.cardNames}>
            <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.statusRow}>
            {busy ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> :
              <View style={[styles.statusDot, forward && !forward.connectionError && styles.statusDotOn, forward?.connectionError && styles.statusDotError]} />}
            <Text style={styles.statusText} numberOfLines={2}>{portLabel ? `${portLabel} · ` : ""}{status}</Text>
          </View>
          <View style={styles.openAction}>
            <Animated.View pointerEvents="none" style={[styles.actionHover, { opacity: hover.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }) }]} />
            <Text style={styles.openActionText}>{t(row.disconnected ? "reconnect" : "openAction")}</Text><Icon name="ArrowRight" size={14} color={theme.colors.foreground} />
          </View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("serviceActions", { title })}
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { setAgentDetailsOpen(false); setActionsOpen(true); }}
        onHoverIn={() => animateHover(menuHover, 1)} onHoverOut={() => animateHover(menuHover, 0)}
        style={({ pressed }) => [styles.cardMenu, pressed && styles.pressed]}>
        <Animated.View pointerEvents="none" style={[styles.actionHover, { opacity: menuHover.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }) }]} />
        <Icon name="Ellipsis" size={18} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Modal title={title} open={actionsOpen} onOpenChange={(open) => { setActionsOpen(open); if (!open) setAgentDetailsOpen(false); }}>
        <Modal.Content contentContainerStyle={styles.dialogList}>
          <View style={styles.serviceDetails}>
            <Text style={styles.cardPort}>{forward ? t("mapping", { remote: row.port, local: forward.localPort }) : t("port", { port: row.port })}{row.protocol === "https" ? " · HTTPS" : ""}</Text>
            {forward?.connectionError ? <Text style={[styles.cardPort, styles.dangerText]}>{t("remoteConnectionFailed")}</Text> : null}
          </View>
          {row.workspaceId ? <DialogRow styles={styles} onPress={() => { setActionsOpen(false); onOpen({ external: true }); }}>
            <Icon name="ExternalLink" size={17} color={theme.colors.foregroundMuted} />
            <Text style={styles.menuActionText}>{t("openExternal")}</Text>
          </DialogRow> : workspaces.length > 0 ? <DialogRow styles={styles} onPress={() => { setActionsOpen(false); setSelectingWorkspace(true); }}>
            <Icon name="Folder" size={17} color={theme.colors.foregroundMuted} />
            <Text style={styles.menuActionText}>{t("openInWorkspace")}</Text>
            <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
          </DialogRow> : null}
          {forward || row.disconnected ? (
            <DialogRow styles={styles} onPress={() => void close()}>
              <Icon name="Unplug" size={17} color={theme.colors.foregroundMuted} />
              <Text style={styles.menuActionText}>{t("unplug", { port: row.port })}</Text>
            </DialogRow>
          ) : null}
          {row.pid !== null && row.startedAt !== null ? (
            <DialogRow styles={styles} onPress={() => { setActionsOpen(false); setConfirmStop(true); }}>
              <Icon name="Power" size={17} color={theme.colors.statusDanger} />
              <Text style={[styles.menuActionText, styles.dangerText]}>{t("stopService")}</Text>
            </DialogRow>
          ) : null}
          {row.agent ? (
            <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: agentDetailsOpen }}
                onPress={() => setAgentDetailsOpen(!agentDetailsOpen)}
                style={({ pressed }) => [styles.menuAction, pressed && styles.menuActionHover]}>
                <Icon name={agentDetailsOpen ? "ChevronUp" : "ChevronDown"} size={17} color={theme.colors.foregroundMuted} />
                <Text style={styles.menuActionText}>{t("agentDetails")}</Text>
              </Pressable>
              {agentDetailsOpen ? <View style={styles.serviceDetails}>
                <Text style={styles.cardPort}>{t("agentOwner", { title: row.agent.title })}</Text>
                {row.agent.stopped ? <Text style={styles.cardPort}>{t("agentStopped")}</Text> : null}
              </View> : null}
            </>
          ) : null}
        </Modal.Content>
      </Modal>
      <StopServiceConfirm row={confirmStop ? row : null} theme={theme} onOpenChange={setConfirmStop}
        onConfirm={() => { setConfirmStop(false); setClosing(true); void onStop().finally(() => setClosing(false)); }} />
      <Modal title={t("selectWorkspace")} open={selectingWorkspace} onOpenChange={setSelectingWorkspace}>
        <Modal.Content contentContainerStyle={styles.dialogList}>
          {workspaces.map((workspace) => (
            <DialogRow key={workspace.id} styles={styles} onPress={() => { setSelectingWorkspace(false); onOpen({ workspaceId: workspace.id }); }}>
              <Icon name="Folder" size={17} color={theme.colors.foregroundMuted} />
              <Text style={styles.menuActionText}>{workspaceLabel(workspace)}</Text>
              <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
            </DialogRow>
          ))}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function DialogRow({ styles, onPress, children }: { styles: Styles; onPress: () => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.menuAction, (hovered || pressed) && styles.menuActionHover]}>
      {children}
    </Pressable>
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
    content: { width: "100%" as const, maxWidth: 1280, alignSelf: "center" as const, padding: compact ? 16 : 36, gap: 32 },
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
    hostRow: { flexDirection: "row" as const, alignItems: "center" as const, borderRadius: 6 },
    hostChoice: { flex: 1, minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 12 },
    hostChoiceText: { flex: 1, color: colors.foreground, fontSize: 14 },
    removeHost: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" as const },
    hostActionText: { color: colors.foregroundMuted, fontSize: 13 },
    section: { gap: 16 },
    groups: { gap: 34 },
    group: { minWidth: 0, gap: 13 },
    groupHeading: { minHeight: 20, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    groupTitle: { flexShrink: 1, minWidth: 0, color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    groupCount: { color: colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
    cards: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: CARD_GAP },
    cardSlot: { width: 320, maxWidth: "100%" as const },
    card: { height: 120, borderRadius: 8, backgroundColor: colors.surface1, overflow: "hidden" as const },
    cardHover: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surface2 },
    cardMain: { flex: 1, padding: 16, justifyContent: "space-between" as const, gap: 12 },
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
    statusDotError: { backgroundColor: colors.statusDanger },
    openAction: { minHeight: 34, flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.surface2 },
    actionHover: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0, borderRadius: 6, backgroundColor: colors.foreground },
    openActionText: { color: colors.foreground, fontSize: 13 },
    cardMenu: { position: "absolute" as const, right: 8, top: 8, width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const },
    dialogList: { paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
    serviceDetails: { paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
    menuAction: { minHeight: 46, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6 },
    menuActionHover: { backgroundColor: colors.surface2 },
    menuActionText: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, lineHeight: 20 },
    dangerText: { color: colors.statusDanger },
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
