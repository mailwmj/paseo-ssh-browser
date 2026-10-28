import { useHosts } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LocalApi } from "./bridge";
import { useApi } from "./use-host-ports";
import { readHostRegistry } from "./web";

// A host Paseo reaches over SSH carries its address; one reached another way, such as the relay,
// needs the SSH host entered on the sidebar screen, matched here by its Paseo server.
export function useSshTarget(serverId: string): { api: LocalApi | null; target: string | undefined; pending: boolean } {
  const hosts = useHosts();
  const registry = useMemo(() => readHostRegistry(), [hosts]);
  const api = useApi();
  const saved = useQuery({
    queryKey: ["targets"],
    queryFn: () => (api as LocalApi).targets(),
    enabled: api !== null && !registry.ssh.some((item) => item.serverId === serverId),
  });
  const target =
    registry.ssh.find((item) => item.serverId === serverId)?.target ??
    saved.data?.targets.find((item) => item.serverId === serverId)?.target;
  return { api, target, pending: api !== null && !target && saved.isPending && saved.fetchStatus !== "idle" };
}
