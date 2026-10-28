import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTranslation, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type TextInput as NativeTextInput, type ViewStyle } from "react-native";
import { recentFilesRpc, type RecentFile, type TransferJob } from "../shared/transfer";
import type { LocalApi } from "./bridge";
import { errorMessage, IconButton } from "./kit";
import { messages } from "./messages";
import { addSendFiles, attachSendJobs, isActive, syncSendQueue, type SendFile } from "./send-queue";
import { ageParts, baseName, formatBytes, parentName, progressOf, receiveDirectory, resolveRemotePath } from "./transfer-format";
import { useSshTarget } from "./use-target";
import { canPickFiles, pickFiles, pickFolder, readSendDirectory, revealInFolder, writeSendDirectory } from "./web";

interface FilesViewProps {
  theme: PluginTheme;
  compact: boolean;
  hostId: string;
  hostLabel: string;
  workspaceId: string;
  popover?: boolean;
}

type Styles = ReturnType<typeof createStyles>;
type Row = { kind: "file"; file: RecentFile } | { kind: "path"; path: string };
const VISIBLE_FILES = 6;
const VISIBLE_JOBS = 3;

// The panel and popover share the same native UI; the host owns the surrounding surface.
export function FilesView(props: FilesViewProps) {
  const { t } = useTranslation(messages);
  const { api, target, pending } = useSshTarget(props.hostId);
  const workspace = useWorkspace(props.workspaceId, (item) => ({ directory: item.directory, name: item.name }));
  const styles = useMemo(() => createStyles(props.theme, props.compact), [props.theme, props.compact]);
  if (pending || !workspace) return <ActivityIndicator color={props.theme.colors.foregroundMuted} />;
  if (!api || !target) return <Text style={styles.muted}>{t(target ? "needLocal" : "notSsh")}</Text>;
  return <Transfers key={`${props.hostId}:${props.workspaceId}`} {...props} api={api} target={target} directory={workspace.directory} name={workspace.name} styles={styles} />;
}

function Transfers({ theme, hostId, hostLabel, workspaceId, popover, api, target, directory, name, styles }: FilesViewProps & {
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
  const [direction, setDirection] = useState<"receive" | "send">("receive");
  const [queue, setQueue] = useState<SendFile[]>([]);
  const [remoteDir, setRemoteDir] = useState(() => readSendDirectory(workspaceId) ?? directory);
  const [remoteDraft, setRemoteDraft] = useState(remoteDir);
  const [editing, setEditing] = useState(false);
  const remoteInput = useRef<NativeTextInput>(null);
  const sendLock = useRef(false);
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const receiveLock = useRef(new Set<string>());
  const [receiving, setReceiving] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [hiddenReceives, setHiddenReceives] = useState<ReadonlySet<string>>(new Set());
  const initialHistory = useRef<ReadonlySet<string> | null>(null);
  const ownReceives = useRef(new Set<string>());
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
    refetchInterval: (state) => state.state.data?.some(isActive) ? 500 : 4000,
  });
  const folder = useQuery({ queryKey: ["receive-folder"], queryFn: () => api.receiveFolder() });
  const files = recent.data?.files ?? [];
  const allJobs = (transfers.data ?? []).filter((job) => job.target === target);
  const byId = new Map(allJobs.map((job) => [job.id, job]));
  const sendFiles = queue.map((file) => ({ ...file, job: file.job ? byId.get(file.job.id) ?? file.job : undefined }));
  const pendingFiles = sendFiles.filter((file) => !file.job && !starting.has(file.path));
  const sending = starting.size > 0 || sendFiles.some((file) => file.job && isActive(file.job));
  const allSent = sendFiles.length > 0 && sendFiles.every((file) => file.job?.status === "done");

  useEffect(() => {
    setQueue((current) => syncSendQueue(current, allJobs, remoteDir));
  }, [transfers.data, target, remoteDir]);
  useEffect(() => {
    if (editing) remoteInput.current?.focus();
  }, [editing]);

  if (initialHistory.current === null && transfers.data) {
    initialHistory.current = new Set(transfers.data.filter((job) => !isActive(job)).map((job) => job.id));
  }
  const receiveJobs = [...allJobs].reverse().filter((job) => job.direction === "receive" && !hiddenReceives.has(job.id)
    && (!initialHistory.current?.has(job.id) || ownReceives.current.has(job.id)))
    .filter((job, index) => index < VISIBLE_JOBS || isActive(job));
  const received = new Map<string, TransferJob>();
  for (const job of allJobs) if (job.direction === "receive") received.set(job.source, job);

  const text = query.trim();
  const needle = text.toLowerCase();
  const matches = needle ? files.filter((file) => relativePath(file, directory).toLowerCase().includes(needle)) : files;
  // A plain unmatched search stays a search. Explicit paths can also point outside the recent list.
  const typedPath = /^(\/|~(?:\/|$)|\.\.?\/)/.test(text) ? resolveRemotePath(text, directory) : null;
  const rows: Row[] = [
    ...(typedPath && !matches.some((file) => file.path === typedPath) ? [{ kind: "path" as const, path: typedPath }] : []),
    ...(needle || showAll ? matches : matches.slice(0, VISIBLE_FILES)).map((file) => ({ kind: "file" as const, file })),
  ];
  const savedDirectory = folder.data ? receiveDirectory(folder.data, name) : null;

  const rememberJobs = (created: TransferJob[]) => {
    queryClient.setQueryData<TransferJob[]>(["transfers"], (current = []) => {
      const fresh = new Map(created.map((job) => [job.id, job]));
      return [...current.filter((job) => !fresh.has(job.id)), ...created];
    });
    void queryClient.invalidateQueries({ queryKey: ["transfers"] });
  };
  const submitSend = async (paths: string[], destination: string) => {
    if (sendLock.current || paths.length === 0) return;
    sendLock.current = true;
    setStarting(new Set(paths));
    try {
      const created = await api.send({ target, paths, remoteDir: destination });
      setQueue((current) => attachSendJobs(current, created));
      rememberJobs(created);
    } catch (error) {
      // Keep the pending files (or failed job on retry) so the user can try again.
      toast.error(errorMessage(error));
    } finally {
      sendLock.current = false;
      setStarting(new Set());
    }
  };
  const saveRemote = (): string | null => {
    const destination = (editing ? remoteDraft : remoteDir).trim();
    if (!destination) {
      toast.error(t("invalidRemoteFolder"));
      remoteInput.current?.focus();
      return null;
    }
    setRemoteDir(destination);
    setRemoteDraft(destination);
    setEditing(false);
    writeSendDirectory(workspaceId, destination);
    return destination;
  };
  const sendPicked = () => {
    const destination = saveRemote();
    if (destination) void submitSend(pendingFiles.map((file) => file.path), destination);
  };
  const receive = async (path: string) => {
    if (receiveLock.current.has(path) || (received.get(path) && isActive(received.get(path)!))) return;
    receiveLock.current.add(path);
    setReceiving(new Set(receiveLock.current));
    try {
      const created = await api.receive({ target, remotePaths: [path], folder: name });
      created.forEach((job) => ownReceives.current.add(job.id));
      rememberJobs(created);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      receiveLock.current.delete(path);
      setReceiving(new Set(receiveLock.current));
    }
  };
  const cancel = (job: TransferJob) => void api.cancelTransfer(job.id)
    .then(() => queryClient.invalidateQueries({ queryKey: ["transfers"] }))
    .catch((error) => toast.error(errorMessage(error)));
  const retry = (job: TransferJob) => job.direction === "send" ? void submitSend([job.source], job.destination) : void receive(job.source);
  const copy = (job: TransferJob) => void copyText(job.finalPath!)
    .then(() => toast.show(t("pathCopied"), { variant: "success" }))
    .catch((error) => toast.error(errorMessage(error)));
  const reveal = (job: TransferJob) => void revealInFolder(job.finalPath!, job.destination).catch((error) => toast.error(errorMessage(error)));
  const pick = () => void pickFiles(t("pickFilesTitle"))
    .then((paths) => setQueue((current) => addSendFiles(syncSendQueue(current, allJobs, remoteDir), paths)))
    .catch((error) => toast.error(errorMessage(error)));
  const chooseFolder = async () => {
    const chosen = await pickFolder(t("pickFolderTitle"), folder.data);
    if (!chosen) return;
    await api.setReceiveFolder(chosen);
    await queryClient.invalidateQueries({ queryKey: ["receive-folder"] });
  };
  const ago = (file: RecentFile) => {
    const age = ageParts(file.ageMs);
    return age.unit === "now" ? t("ageNow") : t(age.unit === "minutes" ? "ageMinutes" : "ageHours", { count: age.count });
  };
  const transferLine = (file: SendFile, isSend: boolean) => (
    <TransferLine key={isSend ? file.path : file.job!.id} path={file.path} job={file.job} theme={theme} styles={styles}
      starting={isSend ? starting.has(file.path) : receiving.has(file.path)} retryDisabled={starting.size > 0}
      onRemove={isSend ? () => setQueue((current) => current.filter((item) => item.path !== file.path)) : undefined}
      onCancel={() => file.job && cancel(file.job)} onRetry={() => file.job && retry(file.job)}
      onCopy={file.job?.direction === "send" && file.job.finalPath ? () => copy(file.job!) : undefined}
      onReveal={desktop && file.job?.direction === "receive" && file.job.finalPath ? () => reveal(file.job!) : undefined} />
  );

  return (
    <View style={[styles.view, !popover && styles.panelView]}>
      <View accessibilityRole="tablist" style={[styles.row, styles.tabs]}>
        {(["receive", "send"] as const).map((tab) => (
          <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: direction === tab }} aria-selected={direction === tab}
            onPress={() => setDirection(tab)} style={[styles.tab, direction === tab && styles.selectedTab]}>
            <Text style={[styles.tabText, direction === tab && styles.selectedTabText]} numberOfLines={1}>
              {tab === "receive" ? t("downloadToComputer") : t("sendToHost", { host: hostLabel })}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={popover ? styles.popoverContent : styles.panelContent} nestedScrollEnabled>
      {transfers.isError ? (
        <View style={styles.row}>
          <Text style={[styles.muted, styles.grow]}>{t("transfersFailed")}</Text>
          <HoverPressable label={t("retryLoad")} style={styles.textAction} hoverStyle={styles.hovered} onPress={() => void transfers.refetch()}><Text style={styles.muted}>{t("retryLoad")}</Text></HoverPressable>
        </View>
      ) : null}

      {direction === "send" ? desktop ? (
        <View>
          <View style={[styles.bar, editing && styles.focusedBar]}>
            <Icon name="Folder" size={15} color={muted} />
            {editing ? (
              <TextInput ref={remoteInput} value={remoteDraft} onChangeText={setRemoteDraft} onSubmitEditing={() => saveRemote()}
                onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") { setRemoteDraft(remoteDir); setEditing(false); } }}
                autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("remoteFolder")} style={styles.input} />
            ) : <Text style={[styles.path, styles.grow]} numberOfLines={1} ellipsizeMode="middle" selectable>{remoteDir}</Text>}
            <HoverPressable label={t(editing ? "done" : "edit")} style={styles.textAction} hoverStyle={styles.hovered} disabled={starting.size > 0}
              onPress={() => { if (editing) saveRemote(); else { setRemoteDraft(remoteDir); setEditing(true); } }}>
              <Text style={styles.small}>{t(editing ? "done" : "edit")}</Text>
            </HoverPressable>
          </View>
          <ScrollView style={styles.sendQueue} contentContainerStyle={styles.queueContent} horizontal={false} nestedScrollEnabled showsHorizontalScrollIndicator={false}>
            {sendFiles.length > 0 ? sendFiles.map((file) => transferLine(file, true)) : <Text style={styles.emptyQueue}>{t("noPickedFiles")}</Text>}
          </ScrollView>
          <View style={[styles.row, styles.sendActions]}>
            <HoverPressable label={t("addFiles")} style={[styles.row, styles.secondary]} hoverStyle={styles.hovered} onPress={pick}>
              <Icon name="Plus" size={14} color={muted} /><Text style={styles.actionText}>{t("addFiles")}</Text>
            </HoverPressable>
            <View style={styles.grow} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: pendingFiles.length === 0 || starting.size > 0 }}
              disabled={pendingFiles.length === 0 || starting.size > 0} onPress={sendPicked}
              style={[styles.primary, (pendingFiles.length === 0 || starting.size > 0) && styles.disabledPrimary]}>
              <Text style={[styles.primaryText, (pendingFiles.length === 0 || starting.size > 0) && styles.disabledPrimaryText]}>
                {pendingFiles.length > 0 ? t("sendCount", { count: pendingFiles.length }) : sending ? t("sending") : allSent ? t("sent") : t("send")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : <Text style={[styles.muted, styles.note]}>{t("sendUnavailable", { host: hostLabel })}</Text> : (
        <View>
          {receiveJobs.length > 0 ? (
            <View style={styles.receiveTransfers}>
              <View style={[styles.row, styles.listHead]}>
                <Text style={[styles.small, styles.grow]}>{t("transfers")}</Text>
                {receiveJobs.some((job) => !isActive(job)) ? <HoverPressable label={t("clearCompleted")} style={styles.textAction} hoverStyle={styles.hovered}
                  onPress={() => setHiddenReceives((current) => new Set([...current, ...allJobs.filter((job) => job.direction === "receive" && !isActive(job)).map((job) => job.id)]))}>
                  <Text style={styles.small}>{t("clearCompleted")}</Text>
                </HoverPressable> : null}
              </View>
              {receiveJobs.map((job) => transferLine({ path: job.source, job }, false))}
            </View>
          ) : null}
          <View style={[styles.bar, searchFocused && styles.focusedBar]}>
            <Icon name="Search" size={16} color={muted} />
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => { if (rows[0]) void receive(rows[0].kind === "file" ? rows[0].file.path : rows[0].path); }}
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              autoCapitalize="none" autoCorrect={false} placeholder={t("findHostFile", { host: hostLabel })}
              accessibilityLabel={t("findHostFile", { host: hostLabel })} placeholderTextColor={muted} style={styles.input} />
            {query ? <IconButton icon="X" label={t("clearSearch")} color={muted} onPress={() => setQuery("")} /> : null}
          </View>
          <View style={[styles.row, styles.listHead, styles.recentHead]}>
            <Text style={[styles.small, styles.grow]}>{t(needle ? "searchResults" : "recentFiles")}</Text>
            <Text style={styles.small}>{needle ? t("fileCount", { count: rows.length }) : t("recentPeriod")}</Text>
          </View>
          {recent.isPending ? <ActivityIndicator color={muted} style={styles.note} /> : null}
          {recent.isError ? <Text style={[styles.muted, styles.note]}>{t("recentFilesFailed")}</Text> : null}
          {recent.data && files.length === 0 && !needle ? <Text style={[styles.muted, styles.note]}>{t("noRecentFiles")}</Text> : null}
          {needle && rows.length === 0 && !recent.isPending ? <Text style={[styles.muted, styles.note]}>{t("noMatchingFiles")}</Text> : null}
          {rows.map((row, index) => {
            const path = row.kind === "file" ? row.file.path : row.path;
            const job = received.get(path);
            const active = receiving.has(path) || !!job && isActive(job);
            return (
              <HoverPressable key={`${row.kind}:${path}`} label={t("receiveFile", { name: row.kind === "file" ? row.file.name : path })}
                disabled={active} style={[styles.row, styles.file, needle && index === 0 && styles.hovered]} hoverStyle={styles.hovered} onPress={() => void receive(path)}>
                <Icon name="FileText" size={16} color={muted} />
                <View style={styles.grow}>
                  <Text style={styles.title} numberOfLines={1}>{row.kind === "file" ? row.file.name : path}</Text>
                  {row.kind === "file" ? <Text style={styles.muted} numberOfLines={1}>{[parentName(row.file.path, directory), formatBytes(row.file.size), ago(row.file)].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                <View style={styles.iconSlot}>{active ? <ActivityIndicator size={14} color={muted} /> : <Icon name={job?.status === "done" ? "Check" : "Download"} size={16} color={job?.status === "done" ? theme.colors.statusSuccess : muted} />}</View>
              </HoverPressable>
            );
          })}
          {!needle && files.length > VISIBLE_FILES ? (
            <HoverPressable label={showAll ? t("collapseFiles") : t("showMoreFiles", { count: files.length - VISIBLE_FILES })}
              style={[styles.row, styles.showMore]} hoverStyle={styles.hovered} onPress={() => setShowAll(!showAll)}>
              <Text style={styles.small}>{showAll ? t("collapseFiles") : t("showMoreFiles", { count: files.length - VISIBLE_FILES })}</Text>
              <Icon name={showAll ? "ChevronUp" : "ChevronDown"} size={13} color={muted} />
            </HoverPressable>
          ) : null}
          {savedDirectory ? (
            <View style={[styles.row, styles.receiveFolder]}>
              <Icon name="Laptop" size={13} color={muted} />
              <Text style={[styles.small, styles.grow]} numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={t("receivedLocation", { folder: savedDirectory })} selectable>{savedDirectory}</Text>
              {desktop ? <HoverPressable label={t("changeReceiveFolder")} style={styles.textAction} hoverStyle={styles.hovered}
                onPress={() => void chooseFolder().catch((error) => toast.error(errorMessage(error)))}><Text style={styles.small}>{t("edit")}</Text></HoverPressable> : null}
            </View>
          ) : null}
        </View>
      )}
      </ScrollView>
    </View>
  );
}

function relativePath(file: RecentFile, directory: string): string {
  return [parentName(file.path, directory), file.name].filter(Boolean).join("/");
}

function HoverPressable({ label, style, hoverStyle, disabled, onPress, children }: {
  label: string;
  style: StyleProp<ViewStyle>;
  hoverStyle: ViewStyle;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPress={onPress}
    style={({ pressed }) => [style, (hovered || pressed) && hoverStyle]}>{children}</Pressable>;
}

function TransferLine({ path, job, theme, styles, starting, retryDisabled, onRemove, onCancel, onRetry, onCopy, onReveal }: {
  path: string;
  job?: TransferJob;
  theme: PluginTheme;
  styles: Styles;
  starting: boolean;
  retryDisabled: boolean;
  onRemove?: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onCopy?: () => void;
  onReveal?: () => void;
}) {
  const { t } = useTranslation(messages);
  const muted = theme.colors.foregroundMuted;
  const name = baseName(path);
  const active = !!job && isActive(job);
  const done = job?.status === "done";
  const status = starting || job?.status === "queued" ? t("waiting") : job?.status === "running"
    ? job.total === null ? formatBytes(job.bytes) : `${Math.round(progressOf(job) * 100)}%`
    : job?.status === "cancelled" ? t("cancelled") : job?.status === "failed" ? t("transferFailed")
    : job?.total !== null && job?.total !== undefined ? formatBytes(job.total) : "";
  return <View>
    <View style={[styles.row, styles.transferRow]} accessibilityLabel={`${name}${done ? ` · ${t(job.direction === "send" ? "sent" : "received")}` : ""}`}>
      <View style={styles.fileIcon}>{starting ? <ActivityIndicator size={14} color={muted} /> : <Icon name={done ? "Check" : "FileText"} size={15} color={done ? theme.colors.statusSuccess : muted} />}</View>
      <Text style={[styles.queueTitle, styles.grow]} numberOfLines={1}>{name}</Text>
      <Text style={styles.small}>{status}</Text>
      <View style={styles.iconSlot}>
        {starting ? null : active ? <IconButton icon="X" label={t("cancelTransfer", { name })} color={muted} onPress={onCancel} /> :
          job?.status === "failed" || job?.status === "cancelled" ? <Pressable disabled={retryDisabled} accessibilityRole="button" accessibilityLabel={t("retry", { name })} accessibilityState={{ disabled: retryDisabled }} style={styles.retryButton} onPress={onRetry}><Icon name="RotateCw" size={14} color={muted} /></Pressable> :
            done && onCopy ? <IconButton icon="Copy" label={t("copyPath", { name })} color={muted} onPress={onCopy} /> :
              done && onReveal ? <IconButton icon="FolderOpen" label={t("showInFolder", { name })} color={muted} onPress={onReveal} /> :
                !job && onRemove ? <IconButton icon="X" label={t("removePicked", { name })} color={muted} onPress={onRemove} /> : null}
      </View>
      {job?.status === "running" && job.total !== null && !starting ? <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={name} accessibilityValue={{ min: 0, max: 100, now: Math.round(progressOf(job) * 100) }} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressOf(job) * 100)}><View style={[styles.fill, { width: `${Math.round(progressOf(job) * 100)}%` }]} /></View> : null}
    </View>
    {job?.status === "failed" && !starting ? <Text style={styles.error}>{job.error}</Text> : null}
  </View>;
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    view: { gap: 14 },
    panelView: { flex: 1, minHeight: 0 },
    panelContent: { flex: 1, minHeight: 0 },
    popoverContent: { maxHeight: 320, flexGrow: 0 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 9 },
    grow: { flex: 1, minWidth: 0 },
    tabs: { gap: 24, borderBottomWidth: 1, borderBottomColor: colors.border },
    tab: { minWidth: 0, flexShrink: 1, minHeight: compact ? 42 : 40, paddingBottom: 8, justifyContent: "center" as const, borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
    selectedTab: { borderBottomColor: colors.foreground },
    tabText: { color: colors.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
    selectedTabText: { color: colors.foreground },
    bar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 9, paddingHorizontal: 10, minHeight: compact ? 40 : 36, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
    focusedBar: { borderColor: colors.foregroundMuted },
    input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, paddingVertical: 8, outlineWidth: 0, outlineStyle: "solid" as const },
    path: { color: colors.foreground, fontSize: 12, paddingVertical: 8 },
    textAction: { minHeight: 28, paddingHorizontal: 4, borderRadius: 4, justifyContent: "center" as const },
    sendQueue: { minHeight: 86, maxHeight: 228, marginTop: 12, flexGrow: 0 },
    queueContent: { paddingVertical: 3 },
    emptyQueue: { minHeight: 80, paddingVertical: 29, textAlign: "center" as const, color: colors.foregroundMuted, fontSize: 12 },
    sendActions: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 0, paddingTop: 12, paddingBottom: 0, minHeight: compact ? 51 : 47 },
    secondary: { gap: 6, height: compact ? 38 : 34, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
    actionText: { color: colors.foreground, fontSize: 12 },
    primary: { minHeight: compact ? 38 : 34, minWidth: 92, paddingHorizontal: 12, borderRadius: 6, justifyContent: "center" as const, backgroundColor: colors.foreground },
    primaryText: { color: colors.surface0, fontSize: 12, fontWeight: "600" as const, textAlign: "center" as const },
    disabledPrimary: { backgroundColor: colors.surface2 },
    disabledPrimaryText: { color: colors.foregroundMuted, fontWeight: "400" as const },
    title: { color: colors.foreground, fontSize: 14, lineHeight: 19 },
    muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
    small: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 18, flexShrink: 0 },
    note: { paddingVertical: 12 },
    hovered: { backgroundColor: colors.surface2 },
    recentHead: { marginTop: 14, marginBottom: 5 },
    listHead: { minHeight: 22 },
    file: { minHeight: 52, paddingVertical: 7, paddingHorizontal: 7, marginHorizontal: -7, borderRadius: 6, gap: 10 },
    showMore: { justifyContent: "center" as const, minHeight: compact ? 40 : 34, marginTop: 2, marginBottom: 4, borderRadius: 6, gap: 5 },
    receiveFolder: { minHeight: 38, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, gap: 8 },
    receiveTransfers: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8, marginBottom: 14 },
    transferRow: { height: 36, position: "relative" as const, gap: 9 },
    queueTitle: { color: colors.foreground, fontSize: 13, lineHeight: 20 },
    iconSlot: { width: 24, height: 28, alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0 },
    fileIcon: { width: 16, height: 28, alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0 },
    retryButton: { padding: 6 },
    error: { color: colors.statusDanger, fontSize: 11, lineHeight: 16, marginLeft: 25, paddingBottom: 4 },
    track: { position: "absolute" as const, height: 2, left: 25, right: 33, bottom: 0, borderRadius: 1, backgroundColor: colors.surface2, overflow: "hidden" as const },
    fill: { height: 2, backgroundColor: colors.foregroundMuted },
  };
}
