import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { access, link, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { folderSegment, type TransferJob } from "../shared/transfer";
import { lastLine, SSH_BASE_ARGS } from "./ssh";

export type SpawnSsh = (args: string[]) => ChildProcess;

const spawnSsh: SpawnSsh = (args) =>
  spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

const MAX_CONCURRENT = 3;
const MAX_JOBS = 100;
const HEADER_LIMIT = 64 * 1024;

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The remote side of a send. Data is staged in a hidden file next to the destination and linked into
// place only after the stream ends with the expected size, so a failed, cancelled or cut-off send
// leaves nothing behind and an existing file is never replaced: `ln` fails when the name is taken, then the next `name (N)` is tried.
// A dropped connection reaches the shell as a signal (HUP, or PIPE once stderr is gone), which skips
// the EXIT trap unless it is trapped too.
// The script avoids single quotes so the whole thing can be passed as one quoted argument.
const SEND_SCRIPT = `
set -e
d=$1; n=$2; s=$3
case $d in "~") d=$HOME;; "~/"*) d=$HOME/\${d#"~/"};; esac
mkdir -p -- "$d"
t=$(mktemp "$d/.paseo-part.XXXXXX")
cleanup() { rm -f -- "$t"; }
quit() { exit 1; }
trap cleanup EXIT
trap quit HUP INT TERM PIPE
cat > "$t"
got=$(wc -c < "$t" | tr -d " ")
if [ "$got" != "$s" ]; then echo "Incomplete: received $got of $s bytes" >&2; exit 1; fi
chmod 644 -- "$t"
b=\${n%.*}
if [ -z "$b" ]; then b=$n; e=; else e=\${n#"$b"}; fi
f=$n; i=0
while :; do
  if [ -e "$d/$f" ] || [ -L "$d/$f" ]; then
    i=$((i+1))
    if [ "$i" -gt 999 ]; then echo "Too many files named $n" >&2; exit 1; fi
    f="$b ($i)$e"
    continue
  fi
  if ln -- "$t" "$d/$f" 2>/dev/null; then break; fi
  if [ -e "$d/$f" ] || [ -L "$d/$f" ]; then continue; fi
  mv -- "$t" "$d/$f"
  break
done
printf "paseo-final:%s\\n" "$d/$f"
`;

// The remote side of a receive: the size first, so progress and integrity can be judged, then the bytes.
const RECEIVE_SCRIPT = `
f=$1
case $f in "~") f=$HOME;; "~/"*) f=$HOME/\${f#"~/"};; esac
if [ ! -f "$f" ]; then echo "Not a file: $1" >&2; exit 2; fi
if [ ! -r "$f" ]; then echo "Cannot read: $1" >&2; exit 2; fi
printf "paseo-size:%s\\n" "$(wc -c < "$f" | tr -d " ")"
exec cat -- "$f"
`;

export function remoteCommand(script: string, ...args: string[]): string {
  return ["sh", "-c", shellQuote(script), "sh", ...args.map(shellQuote)].join(" ");
}

// Hard links are atomic and fail if the name is taken. Some file systems (exFAT, network shares)
// have none, so fall back to a rename once the name is known to be free.
export async function placeWithoutOverwriting(temporary: string, directory: string, name: string): Promise<string> {
  const { name: base, ext } = path.parse(name);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(directory, i === 0 ? name : `${base} (${i})${ext}`);
    try {
      await link(temporary, candidate);
      await unlink(temporary);
      return candidate;
    } catch (error) {
      if (await exists(candidate)) continue;
      if (isLinkUnsupported(error)) {
        await rename(temporary, candidate);
        return candidate;
      }
      throw error;
    }
  }
  throw new Error(`Too many files named ${name}`);
}

function isLinkUnsupported(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "ENOTSUP" || code === "EXDEV" || code === "ENOSYS" || code === "EMLINK";
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}

// A name from the remote host becomes a file name here: no separators, and no characters Windows rejects.
export function localFileName(remotePath: string, platform: NodeJS.Platform = process.platform): string {
  let name = path.posix.basename(remotePath.replace(/\\/g, "/"));
  if (platform === "win32") name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");
  return name && name !== "." && name !== ".." ? name : "file";
}

interface Entry {
  job: TransferJob;
  child: ChildProcess | null;
  cancelled: boolean;
  run: () => Promise<void>;
}

export class TransferManager {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Entry[] = [];
  private running = 0;
  private stopped = false;

  constructor(
    private readonly receiveRoot: () => Promise<string>,
    private readonly spawnProcess: SpawnSsh = spawnSsh,
  ) {}

  list(): TransferJob[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.job }));
  }

  async send(target: string, paths: string[], remoteDir: string): Promise<TransferJob[]> {
    const jobs: TransferJob[] = [];
    for (const source of paths) {
      const entry = this.add({
        direction: "send", target, name: path.basename(source), source, destination: remoteDir, total: null,
      });
      jobs.push(entry.job);
      try {
        const info = await stat(source);
        if (!info.isFile()) throw new Error("Only files can be sent");
        entry.job.total = info.size;
        entry.run = () => this.runSend(entry);
        this.queue.push(entry);
      } catch (error) {
        this.fail(entry, error);
      }
    }
    this.pump();
    return jobs.map((job) => ({ ...job }));
  }

  async receive(target: string, remotePaths: string[], folder?: string): Promise<TransferJob[]> {
    const directory = path.join(await this.receiveRoot(), folderSegment(folder) ?? "");
    const jobs = remotePaths.map((source) => {
      const entry = this.add({
        direction: "receive", target, name: localFileName(source), source, destination: directory, total: null,
      });
      entry.run = () => this.runReceive(entry);
      this.queue.push(entry);
      return { ...entry.job };
    });
    this.pump();
    return jobs;
  }

  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || (entry.job.status !== "queued" && entry.job.status !== "running")) return;
    entry.cancelled = true;
    if (entry.job.status === "queued") {
      this.queue.splice(this.queue.indexOf(entry), 1);
      entry.job.status = "cancelled";
    } else {
      entry.child?.kill();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const id of [...this.entries.keys()]) this.cancel(id);
  }

  private add(fields: Pick<TransferJob, "direction" | "target" | "name" | "source" | "destination" | "total">): Entry {
    const entry: Entry = {
      job: { id: randomUUID(), ...fields, finalPath: null, bytes: 0, status: "queued", error: null },
      child: null,
      cancelled: false,
      run: async () => {},
    };
    this.entries.set(entry.job.id, entry);
    for (const [id, other] of this.entries) {
      if (this.entries.size <= MAX_JOBS) break;
      if (other.job.status !== "queued" && other.job.status !== "running") this.entries.delete(id);
    }
    return entry;
  }

  private fail(entry: Entry, error: unknown): void {
    entry.job.status = entry.cancelled ? "cancelled" : "failed";
    entry.job.error = entry.cancelled ? null : error instanceof Error ? error.message : String(error);
  }

  private pump(): void {
    while (!this.stopped && this.running < MAX_CONCURRENT) {
      const entry = this.queue.shift();
      if (!entry) return;
      this.running++;
      entry.job.status = "running";
      entry.run()
        .catch((error: unknown) => this.fail(entry, error))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private open(entry: Entry, script: string, ...args: string[]): ChildProcess {
    const child = this.spawnProcess([...SSH_BASE_ARGS, "--", entry.job.target, remoteCommand(script, ...args)]);
    entry.child = child;
    // The remote closing the pipe early is reported through the exit code, not as an unhandled error.
    child.stdin?.on("error", () => {});
    return child;
  }

  private async runSend(entry: Entry): Promise<void> {
    const { job } = entry;
    const child = this.open(entry, SEND_SCRIPT, job.destination, job.name, String(job.total));
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const input = createReadStream(job.source);
    input.on("data", (chunk) => (job.bytes += chunk.length));
    const readFailed = new Promise<never>((_, reject) => input.on("error", (error) => {
      child.kill();
      reject(error);
    }));
    input.pipe(child.stdin!);
    const exit = exitCode(child);
    const code = await Promise.race([exit, readFailed]);
    input.destroy();
    if (entry.cancelled) return this.fail(entry, null);
    const final = /^paseo-final:(.+)$/m.exec(stdout)?.[1];
    if (code !== 0 || !final) throw new Error(lastLine(stderr) ?? `ssh ${job.target} exited with code ${code}`);
    job.finalPath = final;
    job.status = "done";
  }

  private async runReceive(entry: Entry): Promise<void> {
    const { job } = entry;
    await mkdir(job.destination, { recursive: true });
    const temporary = path.join(job.destination, `.paseo-part-${job.id}`);
    const out = createWriteStream(temporary);
    let child: ChildProcess | null = null;
    try {
      child = this.open(entry, RECEIVE_SCRIPT, job.source);
      let stderr = "";
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      const failed = new Promise<never>((_, reject) => out.on("error", (error) => {
        child?.kill();
        reject(error);
      }));
      pipeBody(child, out, job);
      const code = await Promise.race([exitCode(child), failed]);
      await closeStream(out);
      if (entry.cancelled) return this.fail(entry, null);
      if (code !== 0) throw new Error(lastLine(stderr) ?? `ssh ${job.target} exited with code ${code}`);
      if (job.total === null) throw new Error("The host did not report the file size");
      if (job.bytes !== job.total) throw new Error(`Received ${job.bytes} of ${job.total} bytes; the file may have changed while copying`);
      job.finalPath = await placeWithoutOverwriting(temporary, job.destination, job.name);
      job.status = "done";
    } finally {
      // Windows cannot delete a file that is still open.
      await new Promise<void>((resolve) => {
        if (out.closed) return resolve();
        out.once("close", () => resolve());
        out.destroy();
      });
      await unlink(temporary).catch(() => {});
    }
  }
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || stream.writableFinished) return resolve();
    stream.end(resolve);
  });
}

// Reads `paseo-size:N\n`, discarding anything the remote login shell printed before it, then writes
// the rest to the file. Writes are paced so a slow disk cannot buffer the whole file in memory.
function pipeBody(child: ChildProcess, out: WriteStream, job: TransferJob): void {
  let header = Buffer.alloc(0);
  let inBody = false;
  const stdout = child.stdout!;
  const write = (chunk: Buffer) => {
    job.bytes += chunk.length;
    if (!out.write(chunk)) {
      stdout.pause();
      out.once("drain", () => stdout.resume());
    }
  };
  stdout.on("data", (chunk: Buffer) => {
    if (inBody) return write(chunk);
    header = Buffer.concat([header, chunk]);
    const match = /(?:^|\n)paseo-size:(\d+)\n/.exec(header.toString("latin1"));
    if (!match) {
      if (header.length > HEADER_LIMIT) child.kill();
      return;
    }
    inBody = true;
    job.total = Number(match[1]);
    const rest = header.subarray(match.index + match[0].length);
    header = Buffer.alloc(0);
    if (rest.length) write(rest);
  });
}
