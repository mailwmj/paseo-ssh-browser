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

export interface HostRegistry {
  // Hosts the app reaches over SSH, with the destination to hand to `ssh`.
  ssh: AppSshHost[];
  // Hosts on this computer: the desktop's own daemon, by socket, pipe, or a loopback address.
  local: string[];
}

// Paseo Desktop's saved hosts, as stored under "@paseo:daemon-registry": an array of host profiles,
// each with a serverId and its connections. Anything that does not look as expected is skipped.
export function parseHostRegistry(raw: string | null): HostRegistry {
  const registry: HostRegistry = { ssh: [], local: [] };
  let profiles: unknown;
  try {
    profiles = raw ? JSON.parse(raw) : [];
  } catch {
    return registry;
  }
  if (!Array.isArray(profiles)) return registry;
  for (const profile of profiles) {
    if (!isRecord(profile) || typeof profile.serverId !== "string") continue;
    const connections = Array.isArray(profile.connections) ? profile.connections.filter(isRecord) : [];
    if (connections.some(isLocalConnection)) registry.local.push(profile.serverId);
    const sshConnections = connections.filter(
      (connection) => connection.type === "remoteSsh" && typeof connection.host === "string",
    );
    const ssh =
      sshConnections.find((connection) => connection.id === profile.preferredConnectionId) ??
      sshConnections[0];
    if (!ssh) continue;
    const host = (ssh.host as string).trim();
    const target = typeof ssh.sshPort === "number" ? `ssh://${host}:${ssh.sshPort}` : host;
    if (sshTarget.safeParse(target).success) registry.ssh.push({ serverId: profile.serverId, target });
  }
  return registry;
}

function isLocalConnection(connection: Record<string, unknown>): boolean {
  if (connection.type === "directSocket" || connection.type === "directPipe") return true;
  if (connection.type !== "directTcp" || typeof connection.endpoint !== "string") return false;
  const host = connection.endpoint.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The fields of a Paseo workspace descriptor this plugin reads.
export interface WorkspaceEntry {
  id: string;
  name: string;
  title?: string | null;
  projectDisplayName: string;
  projectCustomName?: string | null;
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

// "project · workspace", or just the project when the workspace carries the project's name.
export function workspaceLabel(entry: WorkspaceEntry): string {
  const project = entry.projectCustomName || entry.projectDisplayName;
  const workspace = entry.title || entry.name;
  return !workspace || workspace === project ? project : `${project} · ${workspace}`;
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
  // What started it, shortened: "vite --port 5173".
  command: string | null;
  // The workspace that runs it: a running paseo.json service, else the workspace containing the
  // process's working directory. Null for system services and other tools.
  workspaceId: string | null;
}

export function attributePorts(
  ports: readonly DetectedPort[],
  entries: readonly WorkspaceEntry[],
): PortRow[] {
  const services = servicesByPort(entries);
  const directories = workspaceDirectories(entries);
  return ports.map((port) => {
    const service = services.get(port.port);
    return {
      port: port.port,
      host: port.host,
      cwd: port.cwd,
      label: service?.name ?? describePort(port),
      command: shortCommand(port.command),
      workspaceId: service?.workspaceId ?? pickWorkspace(directories, port.cwd),
    };
  });
}

// Group services by workspace identity, keeping unattributed services together at the end.
export function groupPortsByWorkspace<T extends { workspaceId: string | null }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  const unassigned: T[] = [];
  for (const row of rows) {
    if (row.workspaceId === null) {
      unassigned.push(row);
    } else {
      const items = groups.get(row.workspaceId) ?? [];
      items.push(row);
      groups.set(row.workspaceId, items);
    }
  }
  return [
    ...Array.from(groups, ([workspaceId, items]) => ({ workspaceId, rows: items })),
    ...(unassigned.length ? [{ workspaceId: null, rows: unassigned }] : []),
  ];
}

// What the address field accepts: "3000", "localhost:3000/path", or a full http://127.0.0.1 URL.
export function parseAddress(text: string): { port: number; path: string } | null {
  const match = text
    .trim()
    .match(/^(?:https?:\/\/)?(?:(?:localhost|127\.0\.0\.1|\[::1\])?:)?(\d{1,5})(\/.*)?$/i);
  if (!match) return null;
  const port = Number(match[1]);
  if (port < 1 || port > 65535) return null;
  return { port, path: match[2] ?? "/" };
}
