import { Platform } from "react-native";
import { parseHostRegistry, type HostRegistry } from "./format";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
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

// Paseo Desktop's preload exposes native dialogs and the file manager. These are not plugin APIs, so
// anything missing is treated as unavailable and the matching control stays hidden.
interface DesktopBridge {
  dialog?: {
    open(options: { title?: string; defaultPath?: string; multiple?: boolean; directory?: boolean; createDirectory?: boolean }): Promise<string | string[] | null>;
  };
  editor?: {
    listTargets(input: { workspacePath?: string }): Promise<{ id: string; kind: string }[]>;
    openTarget(input: { editorId: string; workspacePath: string; filePath?: string }): Promise<void>;
  };
}

function desktop(): DesktopBridge | undefined {
  return (globalThis as unknown as { paseoDesktop?: DesktopBridge }).paseoDesktop;
}

export function canPickFiles(): boolean {
  return typeof desktop()?.dialog?.open === "function";
}

export async function pickFiles(title: string): Promise<string[]> {
  const picked = await desktop()?.dialog?.open({ title, multiple: true });
  return Array.isArray(picked) ? picked : picked ? [picked] : [];
}

export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const picked = await desktop()?.dialog?.open({ title, directory: true, createDirectory: true, defaultPath });
  return typeof picked === "string" ? picked : null;
}

// Shows the file in the system file manager, selected where the platform supports it.
export async function revealInFolder(filePath: string, directory: string): Promise<void> {
  const editor = desktop()?.editor;
  const manager = (await editor?.listTargets({ workspacePath: directory }))?.find((target) => target.kind === "file-manager");
  if (!editor || !manager) throw new Error("No file manager available");
  await editor.openTarget({ editorId: manager.id, workspacePath: directory, filePath });
}

const SEND_DIR_KEY = "ssh-browser:send-dir:";

export function readSendDirectory(workspaceId: string): string | null {
  try {
    return localStorage.getItem(SEND_DIR_KEY + workspaceId);
  } catch {
    return null;
  }
}

export function writeSendDirectory(workspaceId: string, directory: string): void {
  try {
    localStorage.setItem(SEND_DIR_KEY + workspaceId, directory);
  } catch {
    // Remembering the folder is a convenience.
  }
}
