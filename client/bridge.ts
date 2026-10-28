import { settingsRpc, type RpcInput, type RpcOutput } from "@getpaseo/plugin";
import { useSyncExternalStore } from "react";
import {
  closeRpc,
  forwardsRpc,
  openRpc,
  scanRpc,
  stopServiceRpc,
  targetsRpc,
  targetsSettings,
  recentSettings,
  type Forward,
} from "../shared/ports";
import {
  cancelTransferRpc,
  receiveFolderRpc,
  receiveRpc,
  receiveSettings,
  sendRpc,
  transfersRpc,
  type TransferJob,
} from "../shared/transfer";

const BRIDGE_VERSION = 7;

// Tunnels have to start on the computer running the app, so every surface, whichever host's copy
// of the plugin renders it, calls the copy installed on this computer's own Paseo host. Paseo runs
// all client bundles in one JavaScript realm; the local copy publishes its RPCs here. This is not a
// plugin API, so the version guards against mismatched copies.
export interface LocalApi {
  version: typeof BRIDGE_VERSION;
  scan(input: RpcInput<typeof scanRpc>): Promise<RpcOutput<typeof scanRpc>>;
  stopService(input: RpcInput<typeof stopServiceRpc>): Promise<RpcOutput<typeof stopServiceRpc>>;
  forwards(): Promise<RpcOutput<typeof forwardsRpc>>;
  open(input: RpcInput<typeof openRpc>): Promise<Forward>;
  close(input: RpcInput<typeof closeRpc>): Promise<RpcOutput<typeof closeRpc>>;
  targets(): Promise<RpcOutput<typeof targetsRpc>>;
  updateTargets(change: (targets: string[]) => string[]): Promise<void>;
  recent(): Promise<RecentPage[]>;
  updateRecent(change: (pages: RecentPage[]) => RecentPage[]): Promise<void>;
  send(input: RpcInput<typeof sendRpc>): Promise<TransferJob[]>;
  receive(input: RpcInput<typeof receiveRpc>): Promise<TransferJob[]>;
  transfers(): Promise<TransferJob[]>;
  cancelTransfer(id: string): Promise<void>;
  receiveFolder(): Promise<string>;
  // null returns to the default folder.
  setReceiveFolder(folder: string | null): Promise<void>;
}

export type RecentPage = { serverId: string; workspaceId: string; url: string };

const targetSettings = settingsRpc(targetsSettings.id);
const recentRpc = settingsRpc(recentSettings.id);
const receiveFolderSetting = settingsRpc(receiveSettings.id);

export interface RpcCalls {
  scan: (input: RpcInput<typeof scanRpc>) => Promise<RpcOutput<typeof scanRpc>>;
  stopService: (input: RpcInput<typeof stopServiceRpc>) => Promise<RpcOutput<typeof stopServiceRpc>>;
  forwards: (input: RpcInput<typeof forwardsRpc>) => Promise<RpcOutput<typeof forwardsRpc>>;
  open: (input: RpcInput<typeof openRpc>) => Promise<Forward>;
  close: (input: RpcInput<typeof closeRpc>) => Promise<RpcOutput<typeof closeRpc>>;
  targets: (input: RpcInput<typeof targetsRpc>) => Promise<RpcOutput<typeof targetsRpc>>;
  readSettings: (input: RpcInput<typeof targetSettings.read>) => Promise<RpcOutput<typeof targetSettings.read>>;
  writeSettings: (input: RpcInput<typeof targetSettings.write>) => Promise<RpcOutput<typeof targetSettings.write>>;
  readRecent: (input: RpcInput<typeof recentRpc.read>) => Promise<RpcOutput<typeof recentRpc.read>>;
  writeRecent: (input: RpcInput<typeof recentRpc.write>) => Promise<RpcOutput<typeof recentRpc.write>>;
  transfer: {
    send: (input: RpcInput<typeof sendRpc>) => Promise<RpcOutput<typeof sendRpc>>;
    receive: (input: RpcInput<typeof receiveRpc>) => Promise<RpcOutput<typeof receiveRpc>>;
    list: (input: RpcInput<typeof transfersRpc>) => Promise<RpcOutput<typeof transfersRpc>>;
    cancel: (input: RpcInput<typeof cancelTransferRpc>) => Promise<RpcOutput<typeof cancelTransferRpc>>;
    folder: (input: RpcInput<typeof receiveFolderRpc>) => Promise<RpcOutput<typeof receiveFolderRpc>>;
    readFolder: (input: RpcInput<typeof receiveFolderSetting.read>) => Promise<RpcOutput<typeof receiveFolderSetting.read>>;
    writeFolder: (input: RpcInput<typeof receiveFolderSetting.write>) => Promise<RpcOutput<typeof receiveFolderSetting.write>>;
  };
}

export const RPCS = {
  scan: scanRpc,
  stopService: stopServiceRpc,
  forwards: forwardsRpc,
  open: openRpc,
  close: closeRpc,
  targets: targetsRpc,
  readSettings: targetSettings.read,
  writeSettings: targetSettings.write,
  readRecent: recentRpc.read,
  writeRecent: recentRpc.write,
  send: sendRpc,
  receive: receiveRpc,
  transfers: transfersRpc,
  cancelTransfer: cancelTransferRpc,
  receiveFolder: receiveFolderRpc,
  readReceiveFolder: receiveFolderSetting.read,
  writeReceiveFolder: receiveFolderSetting.write,
} as const;

export function buildLocalApi(calls: RpcCalls): LocalApi {
  return {
    version: BRIDGE_VERSION,
    scan: calls.scan,
    stopService: calls.stopService,
    forwards: () => calls.forwards({}),
    open: calls.open,
    close: calls.close,
    targets: () => calls.targets({}),
    async recent() {
      const current = await calls.readRecent({});
      if (current.status !== "ready") throw new Error(current.error);
      return recentSettings.schema.parse(current.values).pages;
    },
    async updateRecent(change) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await calls.readRecent({});
        if (current.status !== "ready") throw new Error(current.error);
        const pages = recentSettings.schema.parse(current.values).pages;
        const result = await calls.writeRecent({ revision: current.revision, values: { pages: change(pages).slice(0, 100) } });
        if (result.status === "saved") return;
        if (result.status === "invalid") throw new Error(result.error);
      }
      throw new Error("Recent pages changed while saving; try again");
    },
    async send(input) {
      return (await calls.transfer.send(input)).jobs;
    },
    async receive(input) {
      return (await calls.transfer.receive(input)).jobs;
    },
    async transfers() {
      return (await calls.transfer.list({})).jobs;
    },
    async cancelTransfer(id) {
      await calls.transfer.cancel({ id });
    },
    async receiveFolder() {
      return (await calls.transfer.folder({})).folder;
    },
    async setReceiveFolder(folder) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await calls.transfer.readFolder({});
        const result = await calls.transfer.writeFolder({ revision: current.revision, values: { folder } });
        if (result.status === "saved") return;
        if (result.status === "invalid") throw new Error(result.error);
      }
      throw new Error("The receive folder changed while saving; try again");
    },
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

