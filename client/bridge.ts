import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { useSyncExternalStore } from "react";
import type { closeRpc, Forward, forwardsRpc, openRpc, scanRpc } from "../shared/ports";

// Tunnels have to start on the computer running the app, so every surface, whichever host's copy
// of the plugin renders it, calls the copy installed on this computer's own Paseo host. Paseo runs
// all client bundles in one JavaScript realm; the local copy publishes its RPCs here. This is not a
// plugin API, so the version guards against mismatched copies.
export interface LocalApi {
  version: 1;
  scan(input: RpcInput<typeof scanRpc>): Promise<RpcOutput<typeof scanRpc>>;
  forwards(): Promise<RpcOutput<typeof forwardsRpc>>;
  open(input: RpcInput<typeof openRpc>): Promise<Forward>;
  close(input: RpcInput<typeof closeRpc>): Promise<RpcOutput<typeof closeRpc>>;
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
  return api?.version === 1 ? api : null;
}

export function useLocalApi(): LocalApi | null {
  return useSyncExternalStore(subscribe, getLocalApi, getLocalApi);
}

