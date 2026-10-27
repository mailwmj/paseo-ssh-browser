import type { PluginTheme } from "@getpaseo/plugin";
import {
  useHosts,
  useSettings,
  useTranslation,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import { Loading, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { sshTarget, targetsSettings } from "../shared/ports";
import { workspaceLabel, type WorkspaceEntry } from "./format";
import { Avatar, errorMessage, IconButton } from "./kit";
import { messages } from "./messages";
import { useApi, useHostPorts, type Row } from "./use-host-ports";
import { readHostRegistry } from "./web";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;

export function PortsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const settings = useSettings(targetsSettings);
  const hosts = useHosts();
  const { t } = useTranslation(messages);
  // Re-read the app's saved hosts whenever its host list or connection states change.
  const registry = useMemo(() => readHostRegistry(), [hosts]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const api = useApi();

  if (settings.status === "loading") return <Loading />;
  if (settings.status !== "ready") {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>{settings.error}</Text>
      </View>
    );
  }
  const { targets } = settings.values;
  const save = (next: string[]) => settings.save({ targets: next }, settings.revision);

  // SSH hosts Paseo is connected to need no setup. Hosts entered by hand cover the rest.
  const connected = registry.ssh.flatMap(({ serverId, target }) => {
    const host = hosts.find((item) => item.serverId === serverId && item.status === "online");
    return host ? [{ target, title: host.label, serverId }] : [];
  });
  const manual = targets
    .filter((target) => !connected.some((item) => item.target === target))
    .map((target) => ({ target, title: target, serverId: null }));
  const sections = [...connected, ...manual];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {api === null ? <Text style={styles.muted}>{t("needLocal")}</Text> : null}
      {sections.map(({ target, title, serverId }) => (
        <HostSection
          key={target}
          target={target}
          title={title}
          serverId={serverId}
          styles={styles}
          theme={theme}
          navigation={navigation}
          onRemove={serverId ? undefined : () => save(targets.filter((item) => item !== target))}
        />
      ))}
      {registry.ssh.length === 0 || sections.length === 0 ? (
        <AddHost
          styles={styles}
          theme={theme}
          onAdd={(target) => (targets.includes(target) ? true : save([...targets, target]))}
        />
      ) : null}
    </ScrollView>
  );
}

function HostSection({
  target,
  title,
  serverId,
  styles,
  theme,
  navigation,
  onRemove,
}: {
  target: string;
  title: string;
  serverId: string | null;
  styles: Styles;
  theme: PluginTheme;
  navigation: Navigation;
  onRemove?: () => void;
}) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const api = useApi();
  const ports = useHostPorts({ api, target, serverId, navigation });

  // Pages of workspaces first; system services and other tools after them.
  const rows = [...ports.rows].sort(
    (a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null),
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.host} numberOfLines={1}>
          {title}
        </Text>
        {ports.loading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <IconButton
            icon="RefreshCw"
            label={t("rescan")}
            color={theme.colors.foregroundMuted}
            onPress={ports.refresh}
          />
        )}
        {onRemove ? (
          <IconButton icon="X" label={target} color={theme.colors.foregroundMuted} onPress={onRemove} />
        ) : null}
      </View>
      {ports.error ? <Text style={styles.error}>{errorMessage(ports.error)}</Text> : null}
      {ports.loaded && rows.length === 0 ? <Text style={styles.muted}>{t("noPages")}</Text> : null}
      <View style={styles.grid}>
        {rows.map((row) => (
          <PortCard
            key={row.port}
            row={row}
            workspace={row.workspaceId ? ports.workspacesById.get(row.workspaceId) : undefined}
            opening={ports.opening === row.port}
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
  );
}

function PortCard({
  row,
  workspace,
  opening,
  styles,
  theme,
  onOpen,
  onClose,
}: {
  row: Row;
  workspace: WorkspaceEntry | undefined;
  opening: boolean;
  styles: Styles;
  theme: PluginTheme;
  onOpen: (external: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(messages);
  const title = row.label ?? `localhost:${row.port}`;
  const address = `localhost:${row.forward?.localPort ?? row.port}`;
  const subtitle = workspace ? workspaceLabel(workspace) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} ${address}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onOpen(false)}
      onLongPress={() => onOpen(true)}
    >
      <View style={styles.cardHeader}>
        <Avatar
          text={workspace ? workspace.projectCustomName || workspace.projectDisplayName : title}
          theme={theme}
        />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        {opening ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
        {row.forward && !opening ? (
          <IconButton
            icon="Unplug"
            label={t("unplug", { port: row.port })}
            color={theme.colors.foregroundMuted}
            onPress={onClose}
          />
        ) : null}
      </View>
      {subtitle ? (
        <Text style={styles.muted} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      <Text style={row.forward ? styles.forwarded : styles.muted} numberOfLines={1}>
        {address}
      </Text>
    </Pressable>
  );
}

function AddHost({
  styles,
  theme,
  onAdd,
}: {
  styles: Styles;
  theme: PluginTheme;
  onAdd: (target: string) => Promise<boolean> | boolean;
}) {
  const { t } = useTranslation(messages);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = async () => {
    const parsed = sshTarget.safeParse(text);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    if (parsed.data && (await onAdd(parsed.data))) {
      setText("");
      setInvalid(false);
    }
  };
  return (
    <View style={styles.section}>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void submit()}
          placeholder={t("addHost")}
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t("addHost")}
        />
        {text.trim() ? (
          <IconButton icon="Plus" label={t("addHost")} color={theme.colors.accent} onPress={() => void submit()} />
        ) : null}
      </View>
      {invalid ? <Text style={styles.error}>{t("invalidHost")}</Text> : null}
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: 28 },
    section: { gap: 12 },
    sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    host: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
    card: {
      flexGrow: 1,
      flexBasis: compact ? ("100%" as const) : 280,
      maxWidth: compact ? ("100%" as const) : 420,
      gap: 6,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    cardPressed: { backgroundColor: colors.surface2 },
    cardHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minHeight: 28 },
    cardTitle: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "500" as const },
    muted: { color: colors.foregroundMuted, fontSize: 13 },
    forwarded: { color: colors.statusSuccess, fontSize: 13 },
    field: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    input: { flex: 1, color: colors.foreground, fontSize: 14, paddingVertical: 10 },
    error: { color: colors.statusDanger, fontSize: 13 },
  };
}
