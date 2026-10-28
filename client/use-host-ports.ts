import { getPaseoClient, openExternalUrl, useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Forward } from "../shared/ports";
import { forwardedUrl } from "../shared/remote-url";
import { buildLocalApi, RPCS, useLocalApi, type LocalApi } from "./bridge";
import { attributePorts, type PortRow, type WorkspaceEntry } from "./format";
import { readHostRegistry } from "./web";
import { rememberPage } from "./recent";

export interface Row extends PortRow {
  forward: Forward | undefined;
  disconnected?: Forward;
  agent?: { title: string; stopped: boolean };
}

// The copy of this plugin on this computer's Paseo host. When the app's host list cannot be read,
// nothing identifies that copy, so the copy rendering the surface is assumed to be it.
export function useApi(): LocalApi | null {
  const local = useLocalApi();
  const scan = useRpc(RPCS.scan);
  const forwards = useRpc(RPCS.forwards);
  const open = useRpc(RPCS.open);
  const close = useRpc(RPCS.close);
  const targets = useRpc(RPCS.targets);
  const readSettings = useRpc(RPCS.readSettings);
  const writeSettings = useRpc(RPCS.writeSettings);
  const readRecent = useRpc(RPCS.readRecent);
  const writeRecent = useRpc(RPCS.writeRecent);
  const own = useMemo(
    () => buildLocalApi({ scan, forwards, open, close, targets, readSettings, writeSettings, readRecent, writeRecent }),
    [scan, forwards, open, close, targets, readSettings, writeSettings, readRecent, writeRecent],
  );
  return local ?? (readHostRegistry().local.length === 0 ? own : null);
}

export function useHostPorts({
  api,
  target,
  serverId: knownServerId,
  navigation,
}: {
  api: LocalApi | null;
  target: string;
  serverId: string | null;
  navigation: PluginSurfaceProps["navigation"];
}) {
  const hosts = useHosts();
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const scanned = useQuery({
    queryKey: ["scan", target],
    queryFn: () => (api as LocalApi).scan({ target }),
    enabled: api !== null,
    refetchInterval: 10_000,
    retry: false,
  });
  const forwards = useQuery({
    queryKey: ["forwards"],
    queryFn: () => (api as LocalApi).forwards(),
    enabled: api !== null,
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

  const agentIds = [...new Set([...(scanned.data?.ports ?? []), ...(scanned.data?.otherPorts ?? [])].flatMap((port) => port.agentId ? [port.agentId] : []))].sort();
  const agents = useQuery({
    queryKey: ["port-agents", serverId, agentIds.join(",")],
    enabled: online && agentIds.length > 0,
    refetchInterval: 10_000,
    queryFn: async () => {
      const results = await Promise.allSettled(agentIds.map((id) => getPaseoClient(serverId as string).agents.ref(id).refresh()));
      const known = new Map<string, { title: string; stopped: boolean }>();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const agent = result.value?.agent;
        if (agent && agent.id === agentIds[index]) known.set(agent.id, { title: agent.title || agent.id, stopped: Boolean(agent.archivedAt) || ["closed", "error", "archived"].includes(agent.status) });
      });
      return known;
    },
  });

  const rows = useMemo(() => {
    const own = (forwards.data?.forwards ?? []).filter((item) => item.target === target);
    const byPort = new Map<number, Row>();
    for (const row of attributePorts(scanned.data?.ports ?? [], workspaces.data ?? [])) {
      byPort.set(row.port, { ...row, agent: row.agentId ? agents.data?.get(row.agentId) : undefined, forward: own.find((item) => item.remotePort === row.port), disconnected: (forwards.data?.disconnected ?? []).find((item) => item.target === target && item.remotePort === row.port) });
    }
    for (const item of forwards.data?.disconnected ?? []) {
      if (item.target !== target || byPort.has(item.remotePort) || (scanned.data?.otherPorts ?? []).some((port) => port.port === item.remotePort)) continue;
      byPort.set(item.remotePort, { port: item.remotePort, host: item.remoteHost, cwd: null, label: null, command: null, protocol: null, agentId: null, workspaceId: null, forward: undefined, disconnected: item });
    }
    // Forwards opened by address stay listed even when the scan does not show them.
    for (const item of own) {
      if (!byPort.has(item.remotePort) && !(scanned.data?.otherPorts ?? []).some((port) => port.port === item.remotePort)) {
        byPort.set(item.remotePort, {
          port: item.remotePort,
          host: item.remoteHost,
          cwd: null,
          label: null,
          command: null,
          protocol: "http",
          agentId: null,
          workspaceId: null,
          forward: item,
        });
      }
    }
    return [...byPort.values()].sort((a, b) => a.port - b.port);
  }, [scanned.data, forwards.data, workspaces.data, agents.data, target]);

  const otherRows = useMemo(() => attributePorts(scanned.data?.otherPorts ?? [], workspaces.data ?? [])
    .filter((row) => !rows.some((item) => item.port === row.port))
    .map((row) => ({ ...row, agent: row.agentId ? agents.data?.get(row.agentId) : undefined, forward: (forwards.data?.forwards ?? []).find((item) => item.target === target && item.remotePort === row.port), disconnected: (forwards.data?.disconnected ?? []).find((item) => item.target === target && item.remotePort === row.port) })), [scanned.data, workspaces.data, rows, forwards.data, agents.data, target]);

  const workspacesById = useMemo(
    () => new Map((workspaces.data ?? []).map((entry) => [entry.id, entry])),
    [workspaces.data],
  );

  async function open(
    row: Pick<Row, "port" | "host" | "cwd" | "workspaceId"> & { protocol?: "http" | "https" | null },
    options: { remoteUrl?: string; protocol?: "http" | "https"; external?: boolean; workspaceId?: string } = {},
  ): Promise<void> {
    if (!api) return;
    setOpening(row.port);
    try {
      const forward = await api.open({ target, remoteHost: row.host, remotePort: row.port });
      await queryClient.invalidateQueries({ queryKey: ["forwards"] });
      const protocol = options.protocol ?? row.protocol ?? "http";
      const url = options.remoteUrl ? forwardedUrl(options.remoteUrl, forward.localPort) : `${protocol}://127.0.0.1:${forward.localPort}/`;
      const workspaceId = options.workspaceId ?? row.workspaceId;
      if (workspaceId && serverId) {
        const host = row.host.includes(":") ? `[${row.host}]` : row.host;
        const remoteUrl = options.remoteUrl ?? `${protocol}://${host === "[::1]" ? host : "localhost"}:${row.port}/`;
        void rememberPage(api, { serverId, workspaceId, url: remoteUrl }).then(() => queryClient.invalidateQueries({ queryKey: ["recent-pages"] })).catch((error) => console.warn("[ssh-browser] Could not save recent page", error));
      }
      const openBrowser = navigation?.openBrowser;
      if (!options.external && openBrowser && online && serverId) {
        if (workspaceId) {
          openBrowser({ url, workspaceId, serverId });
          return;
        }
      }
      await openExternalUrl(url);
    } finally {
      setOpening(null);
    }
  }

  async function reconnect(row: Row): Promise<void> {
    if (!api || !row.disconnected) return;
    setOpening(row.port);
    try {
      await api.open({ target, remoteHost: row.disconnected.remoteHost, remotePort: row.port });
      await queryClient.invalidateQueries({ queryKey: ["forwards"] });
    } finally { setOpening(null); }
  }

  async function close(port: number): Promise<void> {
    if (!api) return;
    await api.close({ target, remotePort: port });
    await queryClient.invalidateQueries({ queryKey: ["forwards"] });
  }

  function refresh(): void {
    setRefreshing(true);
    void Promise.all([
      (api as LocalApi).scan({ target, refresh: true }).then((data) => queryClient.setQueryData(["scan", target], data)),
      forwards.refetch(),
    ]).catch(() => scanned.refetch()).finally(() => setRefreshing(false));
  }

  const forwardStatus: "ready" | "error" | "loading" = forwards.isSuccess
    ? "ready"
    : forwards.isError
      ? "error"
      : "loading";

  return {
    rows,
    otherRows,
    workspacesById,
    canOpenWorkspace: Boolean(navigation?.openBrowser && online && serverId),
    loaded: scanned.isSuccess && (workspaces.isSuccess || !online),
    scanComplete: scanned.isSuccess,
    loading: api !== null && (scanned.isPending || refreshing),
    error: scanned.error,
    forwardStatus,
    forwardError: forwards.error,
    opening,
    open,
    reconnect,
    close,
    refresh,
  };
}
