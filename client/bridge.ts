import { settingsRpc, type RpcInput, type RpcOutput } from "@getpaseo/plugin";
import { useSyncExternalStore } from "react";
import {
  closeRpc,
  forwardsRpc,
  openRpc,
  scanRpc,
  targetsRpc,
  targetsSettings,
  type Forward,
} from "../shared/ports";

const BRIDGE_VERSION = 3;

// Tunnels have to start on the computer running the app, so every surface, whichever host's copy
// of the plugin renders it, calls the copy installed on this computer's own Paseo host. Paseo runs
// all client bundles in one JavaScript realm; the local copy publishes its RPCs here. This is not a
// plugin API, so the version guards against mismatched copies.
export interface LocalApi {
  version: typeof BRIDGE_VERSION;
  scan(input: RpcInput<typeof scanRpc>): Promise<RpcOutput<typeof scanRpc>>;
  forwards(): Promise<RpcOutput<typeof forwardsRpc>>;
  open(input: RpcInput<typeof openRpc>): Promise<Forward>;
  close(input: RpcInput<typeof closeRpc>): Promise<RpcOutput<typeof closeRpc>>;
  targets(): Promise<RpcOutput<typeof targetsRpc>>;
  updateTargets(change: (targets: string[]) => string[]): Promise<void>;
}

const targetSettings = settingsRpc(targetsSettings.id);

export interface RpcCalls {
  scan: (input: RpcInput<typeof scanRpc>) => Promise<RpcOutput<typeof scanRpc>>;
  forwards: (input: RpcInput<typeof forwardsRpc>) => Promise<RpcOutput<typeof forwardsRpc>>;
  open: (input: RpcInput<typeof openRpc>) => Promise<Forward>;
  close: (input: RpcInput<typeof closeRpc>) => Promise<RpcOutput<typeof closeRpc>>;
  targets: (input: RpcInput<typeof targetsRpc>) => Promise<RpcOutput<typeof targetsRpc>>;
  readSettings: (input: RpcInput<typeof targetSettings.read>) => Promise<RpcOutput<typeof targetSettings.read>>;
  writeSettings: (input: RpcInput<typeof targetSettings.write>) => Promise<RpcOutput<typeof targetSettings.write>>;
}

export const RPCS = {
  scan: scanRpc,
  forwards: forwardsRpc,
  open: openRpc,
  close: closeRpc,
  targets: targetsRpc,
  readSettings: targetSettings.read,
  writeSettings: targetSettings.write,
} as const;

export function buildLocalApi(calls: RpcCalls): LocalApi {
  return {
    version: BRIDGE_VERSION,
    scan: calls.scan,
    forwards: () => calls.forwards({}),
    open: calls.open,
    close: calls.close,
    targets: () => calls.targets({}),
    // Read, change, and write against the read revision; another client's save in between is retried once.
    async updateTargets(change) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await calls.readSettings({});
        const parsed = current.status === "ready" ? targetsSettings.schema.safeParse(current.values) : null;
        const targets = parsed?.success ? parsed.data.targets : [];
        const result = await calls.writeSettings({
          revision: current.revision,
          values: { targets: change(targets) },
        });
        if (result.status === "saved") return;
        if (result.status === "invalid") throw new Error(result.error);
      }
      throw new Error("SSH hosts changed while saving; try again");
    },
  };
}

interface Slot {
  api: LocalApi | null;
  listeners: Set<() => void>;
}

const KEY = Symbol.for("paseo.ssh-browser.local-api");

function slot(): Slot {
  const holder = globalThis as unknown as Record<symbol, Slot | undefined>;
  return (holder[KEY] ??= { api: null, listeners: new Set() });
}

function notify(): void {
  for (const listener of slot().listeners) listener();
}

export function publishLocalApi(api: LocalApi): () => void {
  slot().api = api;
  notify();
  return () => {
    if (slot().api !== api) return;
    slot().api = null;
    notify();
  };
}

function subscribe(listener: () => void): () => void {
  slot().listeners.add(listener);
  return () => slot().listeners.delete(listener);
}

export function getLocalApi(): LocalApi | null {
  const api = slot().api;
  return api?.version === BRIDGE_VERSION ? api : null;
}

export function useLocalApi(): LocalApi | null {
  return useSyncExternalStore(subscribe, getLocalApi, getLocalApi);
}

