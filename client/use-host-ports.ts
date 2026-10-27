import { getPaseoClient, openExternalUrl, useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Forward } from "../shared/ports";
import { buildLocalApi, RPCS, useLocalApi, type LocalApi } from "./bridge";
import { attributePorts, pickWorkspace, workspaceDirectories, type PortRow, type WorkspaceEntry } from "./format";
import { readHostRegistry } from "./web";

export interface Row extends PortRow {
  forward: Forward | undefined;
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
  const own = useMemo(
    () => buildLocalApi({ scan, forwards, open, close, targets, readSettings, writeSettings }),
    [scan, forwards, open, close, targets, readSettings, writeSettings],
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

  const rows = useMemo(() => {
    const own = (forwards.data?.forwards ?? []).filter((item) => item.target === target);
    const byPort = new Map<number, Row>();
    for (const row of attributePorts(scanned.data?.ports ?? [], workspaces.data ?? [])) {
      byPort.set(row.port, { ...row, forward: own.find((item) => item.remotePort === row.port) });
    }
    // Forwards opened by address stay listed even when the scan does not show them.
    for (const item of own) {
      if (!byPort.has(item.remotePort)) {
        byPort.set(item.remotePort, {
          port: item.remotePort,
          host: item.remoteHost,
          cwd: null,
          label: null,
          workspaceId: null,
          forward: item,
        });
      }
    }
    return [...byPort.values()].sort((a, b) => a.port - b.port);
  }, [scanned.data, forwards.data, workspaces.data, target]);

  const workspacesById = useMemo(
    () => new Map((workspaces.data ?? []).map((entry) => [entry.id, entry])),
    [workspaces.data],
  );

  async function open(
    row: Pick<Row, "port" | "host" | "cwd" | "workspaceId">,
    options: { path?: string; external?: boolean; workspaceId?: string } = {},
  ): Promise<void> {
    if (!api) return;
    setOpening(row.port);
    try {
      const forward = await api.open({ target, remoteHost: row.host, remotePort: row.port });
      await queryClient.invalidateQueries({ queryKey: ["forwards"] });
      const url = `http://localhost:${forward.localPort}${options.path ?? "/"}`;
      const openBrowser = navigation?.openBrowser;
      if (!options.external && openBrowser && online && serverId) {
        const directories = workspaceDirectories(workspaces.data ?? (await workspaces.refetch()).data ?? []);
        const workspaceId =
          options.workspaceId ?? row.workspaceId ?? pickWorkspace(directories, row.cwd) ?? directories[0]?.id;
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

  async function close(port: number): Promise<void> {
    if (!api) return;
    await api.close({ target, remotePort: port });
    await queryClient.invalidateQueries({ queryKey: ["forwards"] });
  }

  function refresh(): void {
    setRefreshing(true);
    void Promise.all([scanned.refetch(), forwards.refetch()]).finally(() => setRefreshing(false));
  }

  const forwardStatus: "ready" | "error" | "loading" = forwards.isSuccess
    ? "ready"
    : forwards.isError
      ? "error"
      : "loading";

  return {
    rows,
    workspacesById,
    loaded: scanned.isSuccess && (workspaces.isSuccess || !online),
    scanComplete: scanned.isSuccess,
    loading: api !== null && (scanned.isPending || refreshing),
    error: scanned.error,
    forwardStatus,
    forwardError: forwards.error,
    opening,
    open,
    close,
    refresh,
  };
}
