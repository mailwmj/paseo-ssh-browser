import { sshTarget, type DetectedPort } from "../shared/ports";

// The workspace whose directory most specifically contains the process's working directory.
export function pickWorkspace(
  workspaces: readonly { id: string; directory: string }[],
  cwd: string | null,
): string | null {
  if (!cwd) return null;
  let best: { id: string; length: number } | null = null;
  for (const { id, directory } of workspaces) {
    const dir = directory.replace(/\/+$/, "");
    if (!dir || (cwd !== dir && !cwd.startsWith(`${dir}/`))) continue;
    if (!best || dir.length > best.length) best = { id, length: dir.length };
  }
  return best?.id ?? null;
}

// "node /home/me/app/node_modules/.bin/vite --port 5173" -> "vite --port 5173"
export function shortCommand(command: string | null): string | null {
  if (!command) return null;
  const words = command.trim().split(/\s+/).map((word) => (word.includes("/") ? basename(word) : word));
  if (words.length > 1 && RUNTIMES.has(words[0])) {
    words.shift();
    if (words[0] === "-m" && words.length > 1) words.shift();
  }
  const text = words.join(" ");
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3", "ruby", "java", "php"]);

function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

export function describePort(port: Pick<DetectedPort, "title" | "command">): string | null {
  return port.title ?? shortCommand(port.command);
}

export interface AppSshHost {
  serverId: string;
  target: string;
}

// Paseo Desktop's saved hosts, as stored under "@paseo:daemon-registry": an array of host profiles,
// each with a serverId and its connections. Only SSH connections are read; anything that does not
// look as expected is skipped.
export function sshHostsFromRegistry(raw: string | null): AppSshHost[] {
  let profiles: unknown;
  try {
    profiles = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(profiles)) return [];
  const hosts: AppSshHost[] = [];
  for (const profile of profiles) {
    if (!isRecord(profile) || typeof profile.serverId !== "string") continue;
    const connections = Array.isArray(profile.connections) ? profile.connections.filter(isRecord) : [];
    const sshConnections = connections.filter(
      (connection) => connection.type === "remoteSsh" && typeof connection.host === "string",
    );
    const ssh =
      sshConnections.find((connection) => connection.id === profile.preferredConnectionId) ??
      sshConnections[0];
    if (!ssh) continue;
    const host = (ssh.host as string).trim();
    const target = typeof ssh.sshPort === "number" ? `ssh://${host}:${ssh.sshPort}` : host;
    if (sshTarget.safeParse(target).success) hosts.push({ serverId: profile.serverId, target });
  }
  return hosts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The fields of a Paseo workspace descriptor this plugin reads.
export interface WorkspaceEntry {
  id: string;
  workspaceDirectory?: string;
  projectRootPath: string;
  scripts?: readonly { scriptName: string; type?: string; port: number | null; lifecycle: string }[];
}

export function workspaceDirectories(entries: readonly WorkspaceEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    directory: entry.workspaceDirectory ?? entry.projectRootPath,
  }));
}

// Running paseo.json services by port: the name the user gave the server and the workspace that runs it.
export function servicesByPort(
  entries: readonly WorkspaceEntry[],
): Map<number, { name: string; workspaceId: string }> {
  const services = new Map<number, { name: string; workspaceId: string }>();
  for (const entry of entries) {
    for (const script of entry.scripts ?? []) {
      if (script.type === "service" && script.lifecycle === "running" && script.port !== null) {
        services.set(script.port, { name: script.scriptName, workspaceId: entry.id });
      }
    }
  }
  return services;
}

export interface PortRow {
  port: number;
  host: string;
  cwd: string | null;
  label: string | null;
  workspaceId: string | null;
}

// Ports that belong to a workspace: a running paseo.json service, or a process working inside a
// workspace directory. Other listeners (system services, desktop tools) are left out. Without the
// host's workspace list nothing can be attributed, so every port is kept.
export function workspacePorts(
  ports: readonly DetectedPort[],
  entries: readonly WorkspaceEntry[] | undefined,
): PortRow[] {
  const services = servicesByPort(entries ?? []);
  const directories = workspaceDirectories(entries ?? []);
  return ports.flatMap((port) => {
    const service = services.get(port.port);
    const workspaceId = service?.workspaceId ?? pickWorkspace(directories, port.cwd);
    if (entries && !workspaceId) return [];
    const label = service?.name ?? describePort(port);
    return [{ port: port.port, host: port.host, cwd: port.cwd, label, workspaceId }];
  });
}
