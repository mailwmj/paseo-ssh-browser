import type { DetectedPort } from "../shared/ports";
import type { RemoteExec } from "./ssh";

// Runs on the remote Linux host under `sh -s -- <port:pid>...`. The arguments name listeners
// already probed, so a dev server sees one request per process instead of one per refresh.
//
// Output lines, tab separated:
//   S <paseo server id>
//   P <port> <host> <pid> <cwd> <command> <probe> <title>
// where probe is html | other | none | pending (timed out) | skip (already known) | nocurl.
// String.raw keeps the shell escapes; ${D} inserts a literal "$" before shell braces.
const D = "$";
export const SCAN_SCRIPT = String.raw`
known=" $* "
sid=$(cat "${D}{PASEO_HOME:-$HOME/.paseo}/server-id" 2>/dev/null)
printf 'S\t%s\n' "$sid"
command -v ss >/dev/null 2>&1 || { echo "ss is not installed on the remote host" >&2; exit 3; }
curl_ok=0
command -v curl >/dev/null 2>&1 && curl_ok=1
dir=$(mktemp -d 2>/dev/null) || exit 4
trap 'rm -rf "$dir"' EXIT
ss -ltnpH > "$dir/ss" 2>/dev/null
i=0
while read -r _state _recvq _sendq local _peer rest; do
  i=$((i + 1))
  port=${D}{local##*:}
  addr=${D}{local%:*}
  addr=${D}{addr%%\%*}
  case "$addr" in
    '*'|'*%'*|0.0.0.0|0.0.0.0%*|'[::]'|'[::]%'*|'[::ffff:0.0.0.0]') host=127.0.0.1 ;;
    '['*) host=${D}{addr#[}; host=${D}{host%]} ;;
    *) host=$addr ;;
  esac
  pid=$(printf '%s' "$rest" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p')
  cwd=
  cmd=
  agent=
  if [ -n "$pid" ]; then
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    cmd=$(tr '\000\t\n' '   ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-300)
    agent=$(tr '\000' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^PASEO_AGENT_ID=\([A-Za-z0-9_-]*\)$/\1/p' | head -n 1)
  fi
  case "$host" in *:*) urlhost="[$host]" ;; *) urlhost=$host ;; esac
  (
    probe=nocurl
    title=
    protocol=http
    case "$known" in
      *" $port:$pid "*) probe=skip ;;
      *)
        if [ "$curl_ok" = 1 ]; then
          out=$(curl -s -m 2 -o "$dir/$i.body" -w '%{http_code} %{content_type}' "http://$urlhost:$port/" 2>/dev/null)
          rc=$?
          status=${D}{out%% *}
          http_rc=$rc
          if [ "$status" = 000 ]; then
            out=$(curl -ks -m 2 -o "$dir/$i.body" -w '%{http_code} %{content_type}' "https://$urlhost:$port/" 2>/dev/null)
            rc=$?
            status=${D}{out%% *}
            protocol=https
          fi
          ctype=${D}{out#* }
          if [ "$status" = 000 ] || [ -z "$status" ]; then
            if [ "$rc" = 28 ] || [ "$http_rc" = 28 ]; then probe=pending; else probe=none; fi
          else
            case "$ctype" in
              *html*)
                probe=html
                title=$(head -c 65536 "$dir/$i.body" 2>/dev/null | tr '\r\n\t' '   ' | sed -n 's/.*<[Tt][Ii][Tt][Ll][Ee][^>]*>\([^<]*\)<\/[Tt][Ii][Tt][Ll][Ee]>.*/\1/p' | cut -c1-160)
                ;;
              *) probe=other ;;
            esac
          fi
        fi
        ;;
    esac
    printf 'P\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$port" "$host" "$pid" "$cwd" "$cmd" "$probe" "$title" "$protocol" "$agent" > "$dir/$i.out"
  ) &
done < "$dir/ss"
wait
cat "$dir"/*.out 2>/dev/null
exit 0
`;

type Probe = "html" | "other" | "none" | "pending" | "skip" | "nocurl";

export interface ScanLine {
  port: number;
  host: string;
  pid: number | null;
  cwd: string | null;
  command: string | null;
  probe: Probe;
  title: string | null;
  protocol: "http" | "https";
  agentId: string | null;
}

export function parseScanOutput(text: string): { serverId: string | null; lines: ScanLine[] } {
  let serverId: string | null = null;
  const lines: ScanLine[] = [];
  for (const raw of text.split("\n")) {
    const fields = raw.replace(/\r$/, "").split("\t");
    if (fields[0] === "S") {
      serverId = fields[1]?.trim() || null;
    } else if (fields[0] === "P" && fields.length >= 8) {
      const port = Number(fields[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      const pid = Number(fields[3]);
      lines.push({
        port,
        host: fields[2],
        pid: fields[3] && Number.isInteger(pid) ? pid : null,
        cwd: fields[4] || null,
        command: fields[5]?.trim() || null,
        probe: fields[6] as Probe,
        title: decodeEntities(fields[7]?.trim() ?? "") || null,
        protocol: fields[8] === "https" ? "https" : "http",
        agentId: fields[9] || null,
      });
    }
  }
  return { serverId, lines };
}

// Well-known services that are never web pages, for listeners the probe cannot classify.
const NON_WEB_PORTS = new Set([22, 25, 53, 111, 631, 3306, 5432, 6379, 11211, 27017]);

export interface ProbeResult {
  probe: Probe;
  title: string | null;
  protocol: "http" | "https";
}

const UNREACHABLE_RETRY_MS = 60_000;

export class PortScanner {
  // Settled probe results by target, port, and pid. A restarted process gets a new pid and is probed again.
  private readonly probes = new Map<string, ProbeResult>();
  // The Paseo server each target runs, from its last scan; null while unreachable.
  private readonly serverIds = new Map<string, { serverId: string | null; at: number }>();

  constructor(
    private readonly exec: RemoteExec,
    private readonly now: () => number = Date.now,
  ) {}

  async serverIdOf(target: string): Promise<string | null> {
    const known = this.serverIds.get(target);
    if (known && (known.serverId !== null || this.now() - known.at < UNREACHABLE_RETRY_MS)) {
      return known.serverId;
    }
    try {
      return (await this.scan(target)).serverId;
    } catch {
      this.serverIds.set(target, { serverId: null, at: this.now() });
      return null;
    }
  }

  async scan(target: string, refresh = false): Promise<{ serverId: string | null; ports: DetectedPort[]; otherPorts: DetectedPort[] }> {
    if (refresh) {
      for (const key of this.probes.keys()) if (key.startsWith(`${target}|`)) this.probes.delete(key);
    }
    const known = [...this.probes.keys()]
      .filter((key) => key.startsWith(`${target}|`))
      .map((key) => key.slice(target.length + 1));
    const output = await this.exec({
      target,
      command: ["sh", "-s", "--", ...known].join(" "),
      stdin: SCAN_SCRIPT,
      timeoutMs: 20_000,
    });
    const { serverId, lines } = parseScanOutput(output);
    this.serverIds.set(target, { serverId, at: this.now() });

    const seen = new Set<string>();
    const ports = new Map<number, DetectedPort>();
    const otherPorts = new Map<number, DetectedPort>();
    for (const line of lines) {
      const key = `${line.port}:${line.pid ?? ""}`;
      seen.add(key);
      let result: ProbeResult = { probe: line.probe, title: line.title, protocol: line.protocol };
      if (line.probe === "skip") {
        result = this.probes.get(`${target}|${key}`) ?? { probe: "pending", title: null, protocol: "http" };
      } else if (line.probe === "html" || line.probe === "other" || line.probe === "none") {
        this.probes.set(`${target}|${key}`, result);
      }
      const collection = isWeb(result.probe, line.port, line.pid) ? ports : otherPorts;
      const existing = collection.get(line.port);
      // A port bound on both IPv4 and IPv6 appears twice; either address reaches it, IPv4 is simpler.
      if (existing && existing.host.includes(".")) continue;
      collection.set(line.port, {
        port: line.port,
        host: line.host,
        pid: line.pid,
        command: line.command,
        cwd: line.cwd,
        title: result.title,
        protocol: result.probe === "html" || result.probe === "other" ? result.protocol : null,
        agentId: line.agentId,
      });
    }
    for (const key of this.probes.keys()) {
      if (key.startsWith(`${target}|`) && !seen.has(key.slice(target.length + 1))) {
        this.probes.delete(key);
      }
    }
    for (const port of ports.keys()) otherPorts.delete(port);
    return { serverId, ports: [...ports.values()].sort((a, b) => a.port - b.port), otherPorts: [...otherPorts.values()].sort((a, b) => a.port - b.port) };
  }
}

// A listener that accepts but does not answer in time is usually a dev server still compiling.
// DNS and other system services do the same, so only the user's own processes count.
function isWeb(probe: Probe, port: number, pid: number | null): boolean {
  if (probe === "html") return true;
  if (probe === "pending") return pid !== null && !NON_WEB_PORTS.has(port);
  if (probe === "nocurl") return !NON_WEB_PORTS.has(port);
  return false;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}
