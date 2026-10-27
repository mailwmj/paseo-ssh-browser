import {
  getPaseoClient,
  openExternalUrl,
  useHosts,
  useRpc,
  useSettings,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  closeRpc,
  forwardsRpc,
  openRpc,
  scanRpc,
  sshTarget,
  targetsSettings,
  type Forward,
} from "../shared/ports";
import {
  pickWorkspace,
  servicesByPort,
  workspaceDirectories,
  workspacePorts,
  type PortRow,
  type WorkspaceEntry,
} from "./format";
import { readAppSshHosts } from "./web";

type Navigation = PluginScreenProps["navigation"];
type Styles = ReturnType<typeof createStyles>;

export function PortsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const settings = useSettings(targetsSettings);
  const hosts = useHosts();
  // Re-read the app's saved hosts whenever its host list or connection states change.
  const appSshHosts = useMemo(() => readAppSshHosts(), [hosts]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);

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
  const connected = appSshHosts.flatMap(({ serverId, target }) => {
    const host = hosts.find((item) => item.serverId === serverId && item.status === "online");
    return host ? [{ target, title: host.label, serverId }] : [];
  });
  const manual = targets.filter((target) => !connected.some((item) => item.target === target));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {connected.map(({ target, title, serverId }) => (
        <TargetSection
          key={target}
          target={target}
          title={title}
          serverId={serverId}
          styles={styles}
          theme={theme}
          navigation={navigation}
        />
      ))}
      {manual.map((target) => (
        <TargetSection
          key={target}
          target={target}
          title={target}
          serverId={null}
          styles={styles}
          theme={theme}
          navigation={navigation}
          onRemove={() => save(targets.filter((item) => item !== target))}
        />
      ))}
      {appSshHosts.length === 0 || connected.length + manual.length === 0 ? (
        <AddTarget
          styles={styles}
          theme={theme}
          onAdd={(target) => (targets.includes(target) ? true : save([...targets, target]))}
        />
      ) : null}
    </ScrollView>
  );
}

interface Row extends PortRow {
  forward: Forward | undefined;
}

function TargetSection({
  target,
  title,
  serverId: knownServerId,
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
  const scan = useRpc(scanRpc);
  const listForwards = useRpc(forwardsRpc);
  const openForward = useRpc(openRpc);
  const closeForward = useRpc(closeRpc);
  const queryClient = useQueryClient();
  const hosts = useHosts();
  const toast = useToast();
  const [opening, setOpening] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const scanned = useQuery({
    queryKey: ["scan", target],
    queryFn: () => scan({ target }),
    refetchInterval: 10_000,
    retry: false,
  });
  const forwards = useQuery({
    queryKey: ["forwards"],
    queryFn: () => listForwards({}),
    refetchInterval: 5_000,
  });
  const serverId = knownServerId ?? scanned.data?.serverId ?? null;
  const online = hosts.some((item) => item.serverId === serverId && item.status === "online");
  const workspaces = useQuery({
    queryKey: ["workspaces", serverId],
    queryFn: async (): Promise<WorkspaceEntry[]> =>
      (await getPaseoClient(serverId as string).workspaces.list()).entries,
    enabled: online,
    refetchInterval: 10_000,
  });

  const rows = useMemo(() => {
    const own = (forwards.data?.forwards ?? []).filter((item) => item.target === target);
    const services = servicesByPort(workspaces.data ?? []);
    const byPort = new Map<number, Row>();
    for (const row of workspacePorts(scanned.data?.ports ?? [], workspaces.data)) {
      byPort.set(row.port, { ...row, forward: own.find((item) => item.remotePort === row.port) });
    }
    // Forwards opened by hand stay listed even when the scan does not see them as web pages.
    for (const item of own) {
      if (!byPort.has(item.remotePort)) {
        byPort.set(item.remotePort, {
          port: item.remotePort,
          host: item.remoteHost,
          cwd: null,
          label: services.get(item.remotePort)?.name ?? null,
          workspaceId: services.get(item.remotePort)?.workspaceId ?? null,
          forward: item,
        });
      }
    }
    return [...byPort.values()].sort((a, b) => a.port - b.port);
  }, [scanned.data, forwards.data, workspaces.data, target]);

  async function show(url: string, row: Pick<Row, "cwd" | "workspaceId">, external: boolean) {
    const openBrowser = navigation?.openBrowser;
    if (!external && openBrowser && online && serverId) {
      const directories = workspaceDirectories(workspaces.data ?? (await workspaces.refetch()).data ?? []);
      const workspaceId = row.workspaceId ?? pickWorkspace(directories, row.cwd) ?? directories[0]?.id;
      if (workspaceId) {
        openBrowser({ url, workspaceId, serverId });
        return;
      }
    }
    await openExternalUrl(url);
  }

  async function open(row: Pick<Row, "port" | "host" | "cwd" | "workspaceId">, external = false) {
    setOpening(row.port);
    try {
      const forward = await openForward({ target, remoteHost: row.host, remotePort: row.port });
      await queryClient.invalidateQueries({ queryKey: ["forwards"] });
      await show(forward.url, row, external);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOpening(null);
    }
  }

  async function close(port: number) {
    try {
      await closeForward({ target, remotePort: port });
      await queryClient.invalidateQueries({ queryKey: ["forwards"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.target} numberOfLines={1}>
          {title}
        </Text>
        {scanned.isPending || refreshing ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <IconButton
            icon="RefreshCw"
            label={`Rescan ${target}`}
            color={theme.colors.foregroundMuted}
            onPress={() => {
              setRefreshing(true);
              void scanned.refetch().finally(() => setRefreshing(false));
            }}
          />
        )}
        {onRemove ? (
          <IconButton
            icon="X"
            label={`Remove ${target}`}
            color={theme.colors.foregroundMuted}
            onPress={onRemove}
          />
        ) : null}
      </View>

      {scanned.error ? <Text style={styles.error}>{errorMessage(scanned.error)}</Text> : null}

      <View style={styles.card}>
        {rows.map((row, index) => (
          <View key={row.port} style={[styles.row, index > 0 && styles.rowDivider]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open port ${row.port}`}
              style={styles.rowMain}
              onPress={() => void open(row)}
              onLongPress={() => void open(row, true)}
              disabled={opening !== null}
            >
              <Text style={styles.port}>{row.port}</Text>
              <Text style={styles.label} numberOfLines={1}>
                {row.label ?? ""}
              </Text>
              {opening === row.port ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : row.forward ? (
                <Text style={styles.local}>localhost:{row.forward.localPort}</Text>
              ) : null}
            </Pressable>
            {row.forward ? (
              <IconButton
                icon="Unplug"
                label={`Stop forwarding port ${row.port}`}
                color={theme.colors.foregroundMuted}
                onPress={() => void close(row.port)}
              />
            ) : null}
          </View>
        ))}
        <ManualPort
          styles={styles}
          theme={theme}
          divider={rows.length > 0}
          onSubmit={(port) => void open({ port, host: "127.0.0.1", cwd: null, workspaceId: null })}
        />
      </View>
    </View>
  );
}

function ManualPort({
  styles,
  theme,
  divider,
  onSubmit,
}: {
  styles: Styles;
  theme: PluginTheme;
  divider: boolean;
  onSubmit: (port: number) => void;
}) {
  const [text, setText] = useState("");
  const port = Number(text);
  const valid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const submit = () => {
    if (!valid) return;
    onSubmit(port);
    setText("");
  };
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <TextInput
        value={text}
        onChangeText={(value) => setText(value.replace(/\D/g, ""))}
        onSubmitEditing={submit}
        placeholder="Port"
        placeholderTextColor={theme.colors.foregroundMuted}
        keyboardType="number-pad"
        style={styles.input}
        accessibilityLabel="Forward a port by number"
      />
      {valid ? (
        <IconButton icon="ArrowRight" label="Open port" color={theme.colors.accent} onPress={submit} />
      ) : null}
    </View>
  );
}

function AddTarget({
  styles,
  theme,
  onAdd,
}: {
  styles: Styles;
  theme: PluginTheme;
  onAdd: (target: string) => Promise<boolean> | boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const parsed = sshTarget.safeParse(text);
    if (!parsed.success || !parsed.data) {
      setError(parsed.success ? null : (parsed.error.issues[0]?.message ?? null));
      return;
    }
    if (await onAdd(parsed.data)) {
      setText("");
      setError(null);
    }
  };
  return (
    <View style={styles.section}>
      <View style={[styles.card, styles.row]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void submit()}
          placeholder="SSH host, e.g. user@devbox"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Add an SSH host"
        />
        {text.trim() ? (
          <IconButton icon="Plus" label="Add SSH host" color={theme.colors.accent} onPress={() => void submit()} />
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function IconButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={{ padding: 6 }}
    >
      <Icon name={icon} size={16} color={color} />
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: 24, maxWidth: 720, width: "100%" as const },
    section: { gap: 8 },
    sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    target: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 12,
      minHeight: 44,
      gap: 8,
    },
    rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    rowMain: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingVertical: 10,
    },
    port: {
      color: colors.foreground,
      fontSize: 14,
      fontVariant: ["tabular-nums" as const],
      minWidth: 48,
    },
    label: { flex: 1, color: colors.foregroundMuted, fontSize: 13 },
    local: { color: colors.statusSuccess, fontSize: 12 },
    input: { flex: 1, color: colors.foreground, fontSize: 14, paddingVertical: 10 },
    error: { color: colors.statusDanger, fontSize: 13 },
  };
}
