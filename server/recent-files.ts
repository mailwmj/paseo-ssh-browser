import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RecentFile } from "../shared/transfer";

const WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_FILES = 30;
const MAX_DEPTH = 6;
const MAX_VISITED = 20_000;
const SKIPPED = new Set(["node_modules", "__pycache__", "venv"]);

// Regular files changed lately under a directory, newest first. Hidden entries, dependency folders
// and symlinks are left out, and the walk is bounded so a huge tree cannot stall the host.
export async function recentFiles(directory: string, now = Date.now()): Promise<RecentFile[]> {
  const found: RecentFile[] = [];
  let visited = 0;
  let level = [directory];
  for (let depth = 0; level.length > 0 && depth <= MAX_DEPTH && visited < MAX_VISITED; depth++) {
    const next: string[] = [];
    for (const folder of level) {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || ++visited > MAX_VISITED) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED.has(entry.name)) next.push(full);
        } else if (entry.isFile()) {
          const info = await stat(full).catch(() => null);
          if (info && now - info.mtimeMs <= WINDOW_MS) {
            found.push({ path: full, name: entry.name, size: info.size, ageMs: Math.max(0, now - info.mtimeMs) });
          }
        }
      }
    }
    level = next;
  }
  return found.sort((a, b) => a.ageMs - b.ageMs).slice(0, MAX_FILES);
}
