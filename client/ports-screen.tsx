import type { PluginTheme } from "@getpaseo/plugin";
import { useHosts, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from "react-native";
import { sshTarget } from "../shared/ports";
import { workspaceLabel, type WorkspaceEntry } from "./format";
import { errorMessage, IconButton } from "./kit";
import { messages } from "./messages";
import type { LocalApi } from "./bridge";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { readHostRegistry } from "./web";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;
// Every card has the same size; only a column too narrow for two cards lets one take its width.
const CARD_WIDTH = 304;
const CARD_HEIGHT = 140;
const GAP = 16;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
  const removeHost = (target: string) => void updateTargets((items) => items.filter((item) => item !== target));
  // Most people have one SSH host: it becomes the screen's scope, beside the title.
  const single = sections.length === 1 ? sections[0] : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageHeader}>
        <Text accessibilityRole="header" style={styles.pageTitle}>{t("services")}</Text>
        {single ? (
          <View style={styles.scope}>
            <Icon name="Server" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.scopeText} numberOfLines={1}>{single.title}</Text>
            {single.manual ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("removeHost", { host: single.title })}
                hitSlop={8}
                onPress={() => removeHost(single.target)}
                style={({ pressed }) => [styles.scopeRemove, pressed && styles.pressed]}
              >
                <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={styles.headerTools}>
          {api && sections.length > 0 ? (
            refreshing ? (
              <View style={styles.headerSpinner}>
                <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
              </View>
            ) : (
              <IconButton icon="RefreshCw" label={t("rescan")} color={theme.colors.foregroundMuted} onPress={refresh} />
            )
          ) : null}
          {api && !showAddHost ? (
            <IconButton
              icon="Plus"
              label={t("addHostButton")}
              color={theme.colors.foregroundMuted}
              onPress={() => setAddingHost(true)}
            />
          ) : null}
        </View>
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
            showHeader={!single}
            styles={styles}
            theme={theme}
            touch={layout.compact}
            navigation={navigation}
            onRemove={removable ? () => removeHost(target) : undefined}
          />
        ))}
    </ScrollView>
  );
}

function HostSection({
  target,
  title,
  serverId,
  showHeader,
  styles,
  theme,
  touch,
  navigation,
  onRemove,
}: {
  target: string;
  title: string;
  serverId: string | null;
  showHeader: boolean;
  styles: Styles;
  theme: PluginTheme;
  touch: boolean;
  navigation: Navigation;
  onRemove?: () => void;
}) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const api = useApi();
  const ports = useHostPorts({ api, target, serverId, navigation });
  const [contentWidth, setContentWidth] = useState(0);

  // Pages of workspaces first; system services and other tools after them.
  const groups = [
    { key: "workspacePages" as const, rows: ports.rows.filter((row) => row.workspaceId !== null) },
    { key: "otherServices" as const, rows: ports.rows.filter((row) => row.workspaceId === null) },
  ];
  const cardWidth = contentWidth > 0 && contentWidth < CARD_WIDTH * 2 + GAP ? contentWidth : CARD_WIDTH;

  return (
    <View style={styles.section}>
      {showHeader ? (
        <View style={styles.sectionHeader}>
          <Icon name="Server" size={16} color={theme.colors.foregroundMuted} />
          <Text accessibilityRole="header" style={styles.host} numberOfLines={1}>
            {title}
          </Text>
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
      ) : null}
      {ports.error ? <Text style={styles.error}>{errorMessage(ports.error)}</Text> : null}
      {ports.forwardError ? (
        <Text style={styles.error}>{t("forwardError", { error: errorMessage(ports.forwardError) })}</Text>
      ) : null}
      {(ports.loading || ports.forwardStatus === "loading") && ports.rows.length === 0 && !ports.error ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          <Text style={styles.muted}>{t("scanning")}</Text>
        </View>
      ) : null}
      {ports.scanComplete && ports.forwardStatus === "ready" && ports.rows.length === 0 ? (
        <View style={styles.emptyPages}>
          <Text style={styles.emptyTitle}>{t("noPages")}</Text>
          <Text style={styles.muted}>{t("noPagesHint")}</Text>
        </View>
      ) : null}
      <View style={styles.groups} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
        {groups.map(({ key, rows }) =>
          rows.length > 0 ? (
            <View key={key} style={styles.group}>
              <View style={styles.groupHeading}>
                <Text accessibilityRole="header" style={styles.groupTitle}>{t(key)}</Text>
                <Text style={styles.groupCount}>{rows.length}</Text>
              </View>
              <View style={styles.grid}>
                {rows.map((row) => (
                  <PortCard
                    key={row.port}
                    row={row}
                    hostTitle={title}
                    workspace={row.workspaceId ? ports.workspacesById.get(row.workspaceId) : undefined}
                    width={cardWidth}
                    touch={touch}
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
            </View>
          ) : null,
        )}
      </View>
    </View>
  );
}

function PortCard({
  row,
  hostTitle,
  workspace,
  width,
  touch,
  opening,
  forwardStatus,
  styles,
  theme,
  onOpen,
  onClose,
}: {
  row: Row;
  hostTitle: string;
  workspace: WorkspaceEntry | undefined;
  width: number;
  touch: boolean;
  opening: boolean;
  forwardStatus: "ready" | "error" | "loading";
  styles: Styles;
  theme: PluginTheme;
  onOpen: (external: boolean) => void;
  onClose: () => Promise<void>;
}) {
  const { t } = useTranslation(messages);
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const title = row.label ?? t("portTitle", { port: row.port });
  const forward = forwardStatus === "ready" ? row.forward : undefined;
  // A workspace page names its workspace; anything else names the process behind it, unless that
  // already is its title.
  const subline = workspace ? workspaceLabel(workspace) : row.command !== row.label ? row.command : null;
  const status = forwardStatus === "loading"
    ? t("checkingForward")
    : forwardStatus === "error"
      ? t("forwardUnavailable")
      : forward
        ? t("forwardedTo", { port: forward.localPort })
        : t("notForwarded");
  const busy = opening || closing;
  const showActions = touch || hovered || focused || busy;

  // The link between the two ports fills in while a new tunnel is being set up.
  const link = useRef(new Animated.Value(forward ? 1 : 0)).current;
  const connecting = opening && !forward;
  useEffect(() => {
    if (connecting) {
      link.setValue(0);
      Animated.timing(link, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    } else {
      link.setValue(forward ? 1 : 0);
    }
  }, [connecting, forward, link]);
  const linked = Boolean(forward) || connecting;

  const close = async () => {
    setClosing(true);
    try {
      await onClose();
    } finally {
      setClosing(false);
    }
  };
  const actionFocus = { onFocus: () => setFocused(true), onBlur: () => setFocused(false) };

  return (
    <Pressable
      accessible={false}
      focusable={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.card, { width }, hovered && styles.cardHovered]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("openPage", { title })}, ${status}`}
        accessibilityState={{ disabled: busy, busy: opening }}
        disabled={busy}
        onPress={() => onOpen(false)}
        onLongPress={() => onOpen(true)}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
      >
        <View style={styles.cardHead}>
          <View style={styles.serviceIcon}>
            <Icon name="Globe" size={18} color={theme.colors.foregroundMuted} />
          </View>
          <View style={styles.cardNames}>
            <Text style={[styles.cardTitle, !row.workspaceId && styles.cardTitleOther]} numberOfLines={1}>
              {title}
            </Text>
            {subline ? (
              <Text style={workspace ? styles.cardSubline : styles.cardCommand} numberOfLines={1}>
                {subline}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.ports}>
          <View style={styles.portEnd}>
            <Text style={styles.portNumber}>{row.port}</Text>
            <Text style={styles.portCaption} numberOfLines={1}>{hostTitle}</Text>
          </View>
          <View style={styles.link}>
            <Animated.View
              style={[styles.linkFill, { width: link.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
            />
            <View style={[styles.linkEnd, styles.linkStart, linked && styles.linkEndOn]} />
            <View style={[styles.linkEnd, styles.linkStop, forward && styles.linkEndOn]} />
          </View>
          <View style={[styles.portEnd, styles.portEndLocal]}>
            <Text style={[styles.portNumber, forward ? styles.portNumberOn : styles.portNumberOff]}>
              {forward ? forward.localPort : "—"}
            </Text>
            <Text style={styles.portCaption}>localhost</Text>
          </View>
        </View>
      </Pressable>
      <View style={[styles.cardActions, !showActions && styles.hidden]}>
        {forward ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("unplug", { port: row.port })}
            accessibilityState={{ disabled: busy, busy: closing }}
            disabled={busy}
            onPress={() => void close()}
            {...actionFocus}
            style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
          >
            {closing ? (
              <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
            ) : (
              <Icon name="Unplug" size={14} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("openExternal", { title })}
          accessibilityState={{ disabled: busy, busy: opening }}
          disabled={busy}
          onPress={() => onOpen(true)}
          {...actionFocus}
          style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
        >
          {opening ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Icon name="ExternalLink" size={14} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
      </View>
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
    content: {
      width: "100%" as const,
      maxWidth: 1320,
      alignSelf: "center" as const,
      padding: compact ? 16 : 24,
      gap: 28,
    },
    pageHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    pageTitle: { color: colors.foreground, fontSize: compact ? 20 : 22, fontWeight: "700" as const },
    scope: {
      flexShrink: 1,
      minWidth: 0,
      height: 28,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 10,
      borderRadius: 14,
      backgroundColor: colors.surface1,
    },
    scopeText: { flexShrink: 1, color: colors.foregroundMuted, fontSize: 13 },
    scopeRemove: { marginLeft: 2, padding: 2 },
    headerTools: { marginLeft: "auto" as const, flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    headerSpinner: { width: 28, height: 28, alignItems: "center" as const, justifyContent: "center" as const },
    pressed: { opacity: 0.65 },
    disabled: { opacity: 0.5 },
    hidden: { opacity: 0 },
    notice: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    section: { gap: 16 },
    sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    host: { flexShrink: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    hostAction: { minHeight: 40, justifyContent: "center" as const, paddingHorizontal: 8 },
    hostActionText: { color: colors.foregroundMuted, fontSize: 13 },
    groups: { gap: 28 },
    group: { gap: 12 },
    groupHeading: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 8 },
    groupTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    groupCount: { color: colors.foregroundMuted, fontSize: 14, fontVariant: ["tabular-nums" as const] },
    grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: GAP },
    // Cards are one tone step above the page; an edge appears only under the pointer.
    card: {
      height: CARD_HEIGHT,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "transparent",
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    cardHovered: { borderColor: colors.border },
    cardMain: { flex: 1, padding: 15 },
    cardPressed: { backgroundColor: colors.surface2 },
    cardHead: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12, paddingRight: 56 },
    serviceIcon: { width: 20, height: 20, alignItems: "center" as const, justifyContent: "center" as const },
    cardNames: { flex: 1, minWidth: 0, gap: 2 },
    cardTitle: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
    cardTitleOther: { fontWeight: "500" as const },
    cardSubline: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
    cardCommand: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontFamily: MONO },
    cardActions: { position: "absolute" as const, top: 9, right: 9, flexDirection: "row" as const, gap: 2 },
    cardAction: {
      width: 28,
      height: 28,
      borderRadius: 7,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    // The tunnel: the host's port, the link, and this computer's port.
    ports: { marginTop: "auto" as const, flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 12 },
    portEnd: { flexShrink: 1, minWidth: 0 },
    portEndLocal: { alignItems: "flex-end" as const },
    portNumber: {
      color: colors.foreground,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "600" as const,
      fontVariant: ["tabular-nums" as const],
    },
    portNumberOn: { color: colors.statusSuccess },
    portNumberOff: { color: colors.foregroundMuted, fontWeight: "400" as const },
    portCaption: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
    link: { flex: 1, minWidth: 24, height: 2, marginBottom: 20, borderRadius: 1, backgroundColor: colors.surface2 },
    linkFill: { position: "absolute" as const, left: 0, top: 0, bottom: 0, borderRadius: 1, backgroundColor: colors.statusSuccess },
    linkEnd: {
      position: "absolute" as const,
      top: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface0,
    },
    linkStart: { left: -4 },
    linkStop: { right: -4 },
    linkEndOn: { borderColor: colors.statusSuccess, backgroundColor: colors.statusSuccess },
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
