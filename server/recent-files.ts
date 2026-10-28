import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { RECENT_FILES_PAGE_SIZE, type RecentFile } from "../shared/transfer";

const MAX_DEPTH = 6;
const MAX_VISITED = 20_000;
const SKIPPED = new Set(["node_modules", "__pycache__", "venv"]);

// Regular files under a directory, newest first. Hidden entries, dependency folders
// and symlinks are left out, and the walk is bounded so a huge tree cannot stall the host.
export async function recentFiles(directory: string, { offset = 0, query = "" }: { offset?: number; query?: string } = {}, now = Date.now()) {
  const found: RecentFile[] = [];
  const needle = query.trim().toLowerCase();
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
          if (needle && !path.relative(directory, full).toLowerCase().includes(needle)) continue;
          const info = await stat(full).catch(() => null);
          if (info) {
            found.push({ path: full, name: entry.name, size: info.size, ageMs: Math.max(0, now - info.mtimeMs) });
          }
        }
      }
    }
    level = next;
  }
  found.sort((a, b) => a.ageMs - b.ageMs || a.path.localeCompare(b.path));
  const end = offset + RECENT_FILES_PAGE_SIZE;
  return { files: found.slice(offset, end), total: found.length, nextOffset: end < found.length ? end : null };
}
