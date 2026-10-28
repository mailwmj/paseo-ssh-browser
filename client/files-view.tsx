import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTranslation, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { recentFilesRpc, type RecentFile, type TransferJob } from "../shared/transfer";
import type { LocalApi } from "./bridge";
import { errorMessage, IconButton } from "./kit";
import { messages } from "./messages";
import { ageParts, baseName, formatBytes, parentName, progressOf, resolveRemotePath } from "./transfer-format";
import { useSshTarget } from "./use-target";
import { canPickFiles, pickFiles, pickFolder, readSendDirectory, revealInFolder, writeSendDirectory } from "./web";

interface FilesViewProps {
  theme: PluginTheme;
  compact: boolean;
  hostId: string;
  workspaceId: string;
}

// Send desktop files to the host a workspace runs on and receive files from it. Used by the Files
// panel and the header popover, so it renders plain content and leaves scrolling to its container.
export function FilesView(props: FilesViewProps) {
  const { t } = useTranslation(messages);
  const { api, target, pending } = useSshTarget(props.hostId);
  const workspace = useWorkspace(props.workspaceId, (item) => ({ directory: item.directory, name: item.name }));
  const styles = useMemo(() => createStyles(props.theme, props.compact), [props.theme, props.compact]);
  if (pending || !workspace) return null;
  if (!api || !target) {
    return <Text style={styles.muted}>{t(target ? "needLocal" : "notSsh")}</Text>;
  }
  return <Transfers {...props} api={api} target={target} directory={workspace.directory} name={workspace.name} styles={styles} />;
}

type Styles = ReturnType<typeof createStyles>;

// Files shown before "show more", so the transfers above and the receive folder below stay in view.
const VISIBLE_FILES = 6;
const VISIBLE_JOBS = 3;

type Row = { kind: "file"; file: RecentFile } | { kind: "path"; path: string };

function Transfers({ theme, hostId, workspaceId, api, target, directory, name, styles }: FilesViewProps & {
  api: LocalApi;
  target: string;
  directory: string;
  name: string;
  styles: Styles;
}) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const queryClient = useQueryClient();
  const recentRpc = useRpc(recentFilesRpc);
  const [picked, setPicked] = useState<string[]>([]);
  const [remoteDir, setRemoteDir] = useState(() => readSendDirectory(workspaceId) ?? directory);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const desktop = canPickFiles();
  const muted = theme.colors.foregroundMuted;

  const recent = useQuery({
    queryKey: ["recent-files", hostId, directory],
    queryFn: () => recentRpc({ directory }),
    refetchInterval: 5000,
  });
  const transfers = useQuery({
    queryKey: ["transfers"],
    queryFn: () => api.transfers(),
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 500 : 4000),
  });
  const folder = useQuery({ queryKey: ["receive-folder"], queryFn: () => api.receiveFolder() });

  const files = recent.data?.files ?? [];
  const allJobs = (transfers.data ?? []).filter((job) => job.target === target).reverse();
  // The newest few, and anything still running however old.
  // Transfers that finished before this view opened are history: their files still show it in the
  // list below, but they do not push the files down every time the popover opens.
  const history = useRef<ReadonlySet<string> | null>(null);
  if (history.current === null && transfers.data) history.current = new Set(transfers.data.filter((job) => !isActive(job)).map((job) => job.id));
  const jobs = allJobs.filter((job) => !history.current?.has(job.id)).filter((job, index) => index < VISIBLE_JOBS || isActive(job));
  // The latest receive of each file, so its row can say it is on its way or already saved.
  const received = new Map<string, TransferJob>();
  for (const job of [...allJobs].reverse()) if (job.direction === "receive") received.set(job.source, job);

  const text = query.trim();
  const needle = text.toLowerCase();
  const matches = needle ? files.filter((file) => relativePath(file, directory).toLowerCase().includes(needle)) : files;
  const typedPath = text ? resolveRemotePath(text, directory) : null;
  // A path that no listed file explains, or one that cannot be a workspace file at all.
  const rows: Row[] = [
    ...(typedPath && (matches.length === 0 || /^[/~]/.test(text)) ? [{ kind: "path" as const, path: typedPath }] : []),
    ...(needle || showAll ? matches : matches.slice(0, VISIBLE_FILES)).map((file) => ({ kind: "file" as const, file })),
  ];
  const hidden = needle || showAll ? 0 : files.length - VISIBLE_FILES;

  const ago = (file: RecentFile) => {
    const age = ageParts(file.ageMs);
    return age.unit === "now" ? t("ageNow") : t(age.unit === "minutes" ? "ageMinutes" : "ageHours", { count: age.count });
  };

  // Starting a transfer returns at once; progress arrives through the polled list.
  const start = (action: Promise<unknown>) =>
    action
      .then(() => queryClient.invalidateQueries({ queryKey: ["transfers"] }))
      .catch((error) => toast.error(errorMessage(error)));

  const send = (paths: string[], destination: string) => start(api.send({ target, paths, remoteDir: destination }));
  const receive = (remotePaths: string[]) => start(api.receive({ target, remotePaths, folder: name }));
  const sendPicked = () => {
    const destination = remoteDir.trim() || directory;
    writeSendDirectory(workspaceId, destination);
    setRemoteDir(destination);
    void send(picked, destination);
    setPicked([]);
  };
  const receiveRow = (row: Row) => {
    const path = row.kind === "file" ? row.file.path : row.path;
    if (received.get(path) && isActive(received.get(path)!)) return;
    void receive([path]);
    setQuery("");
  };
  const retry = (job: TransferJob) => void (job.direction === "send" ? send([job.source], job.destination) : receive([job.source]));
  const pick = () =>
    pickFiles(t("pickFilesTitle"))
      .then((files) => setPicked((current) => [...new Set([...current, ...files])]))
      .catch((error) => toast.error(errorMessage(error)));
  const chooseFolder = async () => {
    const chosen = await pickFolder(t("pickFolderTitle"), folder.data);
    if (!chosen) return;
    await api.setReceiveFolder(chosen);
    await queryClient.invalidateQueries({ queryKey: ["receive-folder"] });
  };

  return (
    <View style={styles.view}>
      <View style={styles.row}>
        <View style={[styles.bar, styles.grow]}>
          <Icon name="Search" size={16} color={muted} />
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => rows[0] && receiveRow(rows[0])} autoCapitalize="none" autoCorrect={false}
            placeholder={t("findFile")} accessibilityLabel={t("findFile")} placeholderTextColor={muted} style={styles.input} />
          {query ? <IconButton icon="X" label={t("clearSearch")} color={muted} onPress={() => setQuery("")} /> : null}
        </View>
        {desktop ? (
          <HoverPressable label={t("sendFiles")} style={[styles.row, styles.action]} hoverStyle={styles.hovered} onPress={() => void pick()}>
            <Icon name="Upload" size={16} color={theme.colors.foreground} />
            <Text style={styles.title}>{t("sendFiles")}</Text>
          </HoverPressable>
        ) : null}
      </View>

      {picked.length > 0 ? (
        <View style={[styles.tray, styles.stack]}>
          {picked.map((file) => (
            <View key={file} style={styles.row}>
              <Text style={[styles.title, styles.grow]} numberOfLines={1}>{baseName(file)}</Text>
              <IconButton icon="X" label={t("removePicked", { name: baseName(file) })} color={muted}
                onPress={() => setPicked(picked.filter((item) => item !== file))} />
            </View>
          ))}
          <View style={styles.bar}>
            <Icon name="Folder" size={16} color={muted} />
            <TextInput value={remoteDir} onChangeText={setRemoteDir} onSubmitEditing={sendPicked} autoCapitalize="none" autoCorrect={false}
              accessibilityLabel={t("remoteFolder")} placeholderTextColor={muted} style={styles.input} />
          </View>
          <View style={styles.row}>
            <HoverPressable label={t("cancel")} style={styles.action} hoverStyle={styles.hovered} onPress={() => setPicked([])}>
              <Text style={styles.title}>{t("cancel")}</Text>
            </HoverPressable>
            <Pressable accessibilityRole="button" style={[styles.primary, styles.grow]} onPress={sendPicked}>
              <Text style={styles.primaryText}>{t("sendCount", { count: picked.length })}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {jobs.length > 0 ? (
        <View style={[styles.tray, styles.stack]}>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} theme={theme} styles={styles} canReveal={desktop}
              onCancel={() => void api.cancelTransfer(job.id).then(() => queryClient.invalidateQueries({ queryKey: ["transfers"] }))
                .catch((error) => toast.error(errorMessage(error)))}
              onRetry={() => retry(job)}
              onReveal={() => void revealInFolder(job.finalPath ?? job.destination, job.destination).catch((error) => toast.error(errorMessage(error)))}
              onCopy={() => void copyText(job.finalPath ?? "").then(() => toast.show(t("pathCopied"), { variant: "success" })).catch((error) => toast.error(errorMessage(error)))} />
          ))}
        </View>
      ) : null}

      <View>
        {!needle && files.length > 0 ? (
          <View style={[styles.row, styles.listHead]}>
            <Text style={[styles.muted, styles.grow]}>{t("recentFiles")}</Text>
            {hidden > 0 ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowAll(true)}>
                <Text style={styles.muted}>{t("showMoreFiles", { count: hidden })}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {recent.isError ? <Text style={[styles.muted, styles.note]}>{t("recentFilesFailed")}</Text> : null}
        {recent.data && files.length === 0 && !needle ? <Text style={[styles.muted, styles.note]}>{t("noRecentFiles")}</Text> : null}
        {rows.map((row, index) => {
          const path = row.kind === "file" ? row.file.path : row.path;
          const job = received.get(path);
          return (
            <HoverPressable
              key={`${row.kind}:${path}`}
              label={row.kind === "file" ? t("receiveFile", { name: row.file.name }) : t("receivePath", { path: text })}
              disabled={!!job && isActive(job)}
              // Enter takes the first row while searching, so it carries the highlight.
              style={[styles.row, styles.file, needle && index === 0 && styles.hovered]}
              hoverStyle={styles.hovered}
              onPress={() => receiveRow(row)}
            >
              <View style={styles.grow}>
                {row.kind === "file" ? (
                  <>
                    <Text style={styles.title} numberOfLines={1}>{row.file.name}</Text>
                    <Text style={styles.muted} numberOfLines={1}>{[parentName(row.file.path, directory), formatBytes(row.file.size), ago(row.file)].filter(Boolean).join(" · ")}</Text>
                  </>
                ) : (
                  <Text style={styles.title} numberOfLines={1}>{t("receivePath", { path: text })}</Text>
                )}
              </View>
              {job && isActive(job) ? <ActivityIndicator size={16} color={muted} /> :
                job?.status === "done" ? <Icon name="Check" size={16} color={theme.colors.statusSuccess} /> :
                <Icon name="Download" size={16} color={muted} />}
            </HoverPressable>
          );
        })}
      </View>

      {folder.data && desktop ? (
        <HoverPressable label={t("changeReceiveFolder")} style={[styles.row, styles.file]} hoverStyle={styles.hovered}
          onPress={() => void chooseFolder().catch((error) => toast.error(errorMessage(error)))}>
          <Text style={[styles.muted, styles.grow]} numberOfLines={1}>{t("receiveFolder", { folder: folder.data })}</Text>
          <Icon name="FolderOpen" size={16} color={muted} />
        </HoverPressable>
      ) : folder.data ? (
        <Text style={styles.muted} numberOfLines={1}>{t("receiveFolder", { folder: folder.data })}</Text>
      ) : null}
    </View>
  );
}

function isActive(job: TransferJob): boolean {
  return job.status === "queued" || job.status === "running";
}

function relativePath(file: RecentFile, directory: string): string {
  return [parentName(file.path, directory), file.name].filter(Boolean).join("/");
}

// A pressable that takes a tone step under the pointer. Hover only exists with a mouse, so touch and
// keyboard rely on the visible focus ring and the pressed tone.
function HoverPressable({ label, style, hoverStyle, disabled, onPress, children }: {
  label: string;
  style: StyleProp<ViewStyle>;
  hoverStyle: ViewStyle;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [style, (hovered || pressed) && hoverStyle]}
    >
      {children}
    </Pressable>
  );
}

function JobRow({ job, theme, styles, canReveal, onCancel, onRetry, onReveal, onCopy }: {
  job: TransferJob;
  theme: PluginTheme;
  styles: Styles;
  canReveal: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation(messages);
  const muted = theme.colors.foregroundMuted;
  const sending = job.direction === "send";
  const size = formatBytes(job.total ?? job.bytes);
  return (
    <View style={[styles.row, styles.job]}>
      <Icon name={sending ? "Upload" : "Download"} size={16} color={job.status === "done" ? theme.colors.statusSuccess : muted} />
      <View style={styles.grow}>
        <Text style={styles.title} numberOfLines={1}>{job.name}</Text>
        {job.status === "running" ? (
          <>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progressOf(job) * 100)}%` }]} /></View>
            <Text style={styles.muted}>{job.total === null ? formatBytes(job.bytes) : `${formatBytes(job.bytes)} / ${formatBytes(job.total)}`}</Text>
          </>
        ) : null}
        {job.status === "queued" ? <Text style={styles.muted}>{t("waiting")}</Text> : null}
        {job.status === "done" ? <Text style={styles.muted} numberOfLines={1}>{t(sending ? "sent" : "received")} · {size}</Text> : null}
        {job.status === "cancelled" ? <Text style={styles.muted}>{t("cancelled")}</Text> : null}
        {job.status === "failed" ? <Text style={styles.error}>{job.error}</Text> : null}
      </View>
      {isActive(job) ? <IconButton icon="X" label={t("cancelTransfer", { name: job.name })} color={muted} onPress={onCancel} /> : null}
      {job.status === "failed" || job.status === "cancelled" ? (
        <IconButton icon="RotateCw" label={t("retry", { name: job.name })} color={muted} onPress={onRetry} />
      ) : null}
      {job.status === "done" && !sending && canReveal ? (
        <IconButton icon="FolderOpen" label={t("showInFolder", { name: job.name })} color={muted} onPress={onReveal} />
      ) : null}
      {job.status === "done" && sending ? (
        <IconButton icon="Copy" label={t("copyPath", { name: job.name })} color={muted} onPress={onCopy} />
      ) : null}
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    view: { gap: compact ? 12 : 16 },
    stack: { gap: 8 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    // Grouping is a tone step, not a border: rows inside sit on it without frames of their own.
    tray: { padding: 12, borderRadius: 10, backgroundColor: colors.surface1 },
    job: { paddingVertical: 2 },
    file: { paddingVertical: 6, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 8 },
    hovered: { backgroundColor: colors.surface2 },
    listHead: { paddingBottom: 4 },
    note: { paddingVertical: 8 },
    action: { height: 38, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center" as const, gap: 8, backgroundColor: colors.surface1 },
    title: { color: colors.foreground, fontSize: 14 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    error: { color: colors.statusDanger, fontSize: 13 },
    bar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
    },
    input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 9, outlineStyle: "solid" as const, outlineWidth: 0 },
    primary: { height: 38, justifyContent: "center" as const, borderRadius: 10, backgroundColor: colors.accent },
    primaryText: { color: colors.accentForeground, fontSize: 14, textAlign: "center" as const },
    track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const, marginVertical: 4 },
    fill: { height: 4, backgroundColor: colors.accent },
  };
}
