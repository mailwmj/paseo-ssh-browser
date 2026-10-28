import { Platform } from "react-native";
import { parseHostRegistry, type HostRegistry } from "./format";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null };
declare const matchMedia: (query: string) => { matches: boolean };

export function cardHoverDuration(): number | null {
  if (Platform.OS !== "web" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return null;
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 150;
}

export function isDesktop(): boolean {
  return Platform.OS === "web" && !!(globalThis as unknown as { paseoDesktop?: unknown }).paseoDesktop;
}

export function newClientId(): string {
  return globalThis.crypto.randomUUID();
}

// Paseo Desktop keeps its saved hosts in the app's web storage. This is not a plugin API, so when
// it changes or is missing, nothing is found and the screen asks for an SSH host instead.
export function readHostRegistry(): HostRegistry {
  if (Platform.OS !== "web") return { ssh: [], local: [] };
  try {
    return parseHostRegistry(localStorage.getItem("@paseo:daemon-registry"));
  } catch {
    return { ssh: [], local: [] };
  }
}
