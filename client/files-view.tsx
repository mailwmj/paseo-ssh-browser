import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTranslation, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { recentFilesRpc, type TransferJob } from "../shared/transfer";
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
// panel and the composer pill, so it renders plain content and leaves scrolling to its container.
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [path, setPath] = useState("");
  const desktop = canPickFiles();

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
  const jobs = (transfers.data ?? []).filter((job) => job.target === target).reverse().slice(0, 8);

  // Starting a transfer returns at once; progress arrives through the polled list.
  const start = (action: Promise<unknown>) =>
    action
      .then(() => queryClient.invalidateQueries({ queryKey: ["transfers"] }))
      .catch((error) => toast.error(errorMessage(error)));

  const sendPicked = () => {
    const destination = remoteDir.trim() || directory;
    writeSendDirectory(workspaceId, destination);
    setRemoteDir(destination);
    void start(api.send({ target, paths: picked, remoteDir: destination }));
    setPicked([]);
  };
  const receive = (remotePaths: string[]) => start(api.receive({ target, remotePaths, folder: name }));
  const receiveSelected = () => {
    void receive(files.filter((file) => selected.has(file.path)).map((file) => file.path));
    setSelected(new Set());
  };
  const receiveTyped = () => {
    const resolved = resolveRemotePath(path, directory);
    if (!resolved) return;
    void receive([resolved]);
    setPath("");
  };
  const chooseFolder = async () => {
    const chosen = await pickFolder(t("pickFolderTitle"), folder.data);
    if (!chosen) return;
    await api.setReceiveFolder(chosen);
    await queryClient.invalidateQueries({ queryKey: ["receive-folder"] });
  };

  return (
    <View style={styles.view}>
      {desktop ? (
        picked.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
            onPress={() => void pickFiles(t("pickFilesTitle")).then(setPicked).catch((error) => toast.error(errorMessage(error)))}
          >
            <Icon name="Upload" size={16} color={theme.colors.foregroundMuted} />
            <Text style={styles.title}>{t("sendFiles")}</Text>
          </Pressable>
        ) : (
          <View style={[styles.card, styles.stack]}>
            {picked.map((file) => (
              <View key={file} style={styles.row}>
                <Icon name="File" size={16} color={theme.colors.foregroundMuted} />
                <Text style={[styles.title, styles.grow]} numberOfLines={1}>{baseName(file)}</Text>
                <IconButton icon="X" label={t("removePicked", { name: baseName(file) })} color={theme.colors.foregroundMuted}
                  onPress={() => setPicked(picked.filter((item) => item !== file))} />
              </View>
            ))}
            <View style={styles.bar}>
              <Icon name="Folder" size={16} color={theme.colors.foregroundMuted} />
              <TextInput value={remoteDir} onChangeText={setRemoteDir} onSubmitEditing={sendPicked} autoCapitalize="none" autoCorrect={false}
                accessibilityLabel={t("remoteFolder")} placeholderTextColor={theme.colors.foregroundMuted} style={styles.input} />
            </View>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={sendPicked}>
              <Text style={styles.primaryText}>{t("send")}</Text>
            </Pressable>
          </View>
        )
      ) : null}

      <View style={styles.stack}>
        <Text style={styles.heading}>{t("recentFiles")}</Text>
        {recent.data && files.length === 0 ? <Text style={styles.muted}>{t("noRecentFiles")}</Text> : null}
        {files.map((file) => {
          const isSelected = selected.has(file.path);
          const age = ageParts(file.ageMs);
          const where = parentName(file.path, directory);
          return (
            <Pressable
              key={file.path}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={t("selectFile", { name: file.name })}
              style={({ pressed }) => [styles.card, styles.row, isSelected && styles.selected, pressed && styles.pressed]}
              onPress={() => {
                const next = new Set(selected);
                if (!next.delete(file.path)) next.add(file.path);
                setSelected(next);
              }}
            >
              <Icon name={isSelected ? "Check" : "File"} size={16} color={isSelected ? theme.colors.accent : theme.colors.foregroundMuted} />
              <View style={styles.grow}>
                <Text style={styles.title} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {[where, formatBytes(file.size), t(age.unit === "now" ? "ageNow" : age.unit === "minutes" ? "ageMinutes" : "ageHours", { count: age.count })]
                    .filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {selected.size > 0 ? (
          <Pressable accessibilityRole="button" style={styles.primary} onPress={receiveSelected}>
            <Text style={styles.primaryText}>{t("receiveSelected", { count: selected.size })}</Text>
          </Pressable>
        ) : null}
        <View style={styles.bar}>
          <Icon name="Download" size={16} color={theme.colors.foregroundMuted} />
          <TextInput value={path} onChangeText={setPath} onSubmitEditing={receiveTyped} autoCapitalize="none" autoCorrect={false}
            placeholder="dist/app.zip" accessibilityLabel={t("remotePath")} placeholderTextColor={theme.colors.foregroundMuted} style={styles.input} />
        </View>
      </View>

      {jobs.map((job) => (
        <JobCard key={job.id} job={job} theme={theme} styles={styles} canReveal={desktop}
          onCancel={() => void api.cancelTransfer(job.id).then(() => queryClient.invalidateQueries({ queryKey: ["transfers"] }))
            .catch((error) => toast.error(errorMessage(error)))}
          onReveal={() => void revealInFolder(job.finalPath ?? job.destination, job.destination).catch((error) => toast.error(errorMessage(error)))}
          onCopy={() => void copyText(job.finalPath ?? "").then(() => toast.show(t("pathCopied"), { variant: "success" })).catch((error) => toast.error(errorMessage(error)))} />
      ))}

      {folder.data ? (
        <View style={styles.row}>
          <Text style={[styles.muted, styles.grow]} numberOfLines={1}>{t("receiveFolder", { folder: folder.data })}</Text>
          {desktop ? (
            <IconButton icon="FolderOpen" label={t("changeReceiveFolder")} color={theme.colors.foregroundMuted}
              onPress={() => void chooseFolder().catch((error) => toast.error(errorMessage(error)))} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function isActive(job: TransferJob): boolean {
  return job.status === "queued" || job.status === "running";
}

function JobCard({ job, theme, styles, canReveal, onCancel, onReveal, onCopy }: {
  job: TransferJob;
  theme: PluginTheme;
  styles: Styles;
  canReveal: boolean;
  onCancel: () => void;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation(messages);
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={[styles.card, styles.row]}>
      <Icon name={job.direction === "send" ? "Upload" : "Download"} size={16} color={job.status === "done" ? theme.colors.statusSuccess : muted} />
      <View style={styles.grow}>
        <Text style={styles.title} numberOfLines={1}>{job.name}</Text>
        {job.status === "running" ? (
          <>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progressOf(job) * 100)}%` }]} /></View>
            <Text style={styles.muted}>{job.total === null ? formatBytes(job.bytes) : `${formatBytes(job.bytes)} / ${formatBytes(job.total)}`}</Text>
          </>
        ) : null}
        {job.status === "queued" ? <Text style={styles.muted}>{t("waiting")}</Text> : null}
        {job.status === "done" ? <Text style={styles.muted} numberOfLines={1}>{job.finalPath}</Text> : null}
        {job.status === "cancelled" ? <Text style={styles.muted}>{t("cancelled")}</Text> : null}
        {job.status === "failed" ? <Text style={styles.error}>{job.error}</Text> : null}
      </View>
      {isActive(job) ? <IconButton icon="X" label={t("cancelTransfer", { name: job.name })} color={muted} onPress={onCancel} /> : null}
      {job.status === "done" && job.direction === "receive" && canReveal ? (
        <IconButton icon="FolderOpen" label={t("showInFolder", { name: job.name })} color={muted} onPress={onReveal} />
      ) : null}
      {job.status === "done" && job.direction === "send" ? (
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
    card: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    selected: { borderColor: colors.accent },
    pressed: { backgroundColor: colors.surface2 },
    heading: { color: colors.foregroundMuted, fontSize: 12 },
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
    primary: { padding: 10, borderRadius: 10, backgroundColor: colors.accent },
    primaryText: { color: colors.accentForeground, fontSize: 14, textAlign: "center" as const },
    track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const, marginVertical: 4 },
    fill: { height: 4, backgroundColor: colors.accent },
  };
}
