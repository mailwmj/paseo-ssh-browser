import { folderSegment } from "../shared/transfer";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[unit]}`;
}

export function ageParts(ageMs: number): { unit: "now" | "minutes" | "hours"; count: number } {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return { unit: "now", count: 0 };
  return minutes < 60 ? { unit: "minutes", count: minutes } : { unit: "hours", count: Math.floor(minutes / 60) };
}

// What a person types for a file on the host: absolute, under the home folder, or inside the workspace.
export function resolveRemotePath(input: string, workspaceDirectory: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith("/") || value === "~" || value.startsWith("~/")) return value;
  return `${workspaceDirectory.replace(/\/+$/, "")}/${value.replace(/^\.\//, "")}`;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

// The folder a file sits in, relative to the workspace, or "" when it is directly inside it.
export function parentName(file: string, workspaceDirectory: string): string {
  const root = workspaceDirectory.replace(/\/+$/, "");
  const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  return relative.split("/").slice(0, -1).join("/");
}

export function progressOf(job: { bytes: number; total: number | null }): number {
  if (job.total === null) return 0;
  if (job.total === 0) return 1;
  return Math.min(1, job.bytes / job.total);
}

export function receiveDirectory(root: string, workspace: string): string {
  const segment = folderSegment(workspace);
  if (!segment) return root;
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[/\\]+$/, "")}${separator}${segment}`;
}
