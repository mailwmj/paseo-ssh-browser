import type { RpcInput } from "@getpaseo/plugin";
import type { stopServiceRpc } from "../shared/ports";
import type { RemoteExec } from "./ssh";

// Check both process identity and listener immediately before signalling. Never escalate to SIGKILL.
export const STOP_SCRIPT = String.raw`
port=$1 pid=$2 expected=$3
stat=$(cat "/proc/$pid/stat" 2>/dev/null) || { echo "Process no longer exists; rescan and try again" >&2; exit 1; }
stat=${"$"}{stat##*) }
started=$(printf '%s\n' "$stat" | awk '{print $20}')
[ "$started" = "$expected" ] || { echo "Process has changed; rescan and try again" >&2; exit 1; }
listeners=$(ss -ltnpH) || { echo "Could not inspect listening ports" >&2; exit 1; }
printf '%s\n' "$listeners" | awk -v port="$port" -v pid="$pid" '$4 ~ (":" port "$") && $0 ~ ("pid=" pid "[,)]") { found=1 } END { exit !found }' || { echo "Process is no longer listening on this port; rescan and try again" >&2; exit 1; }
kill -TERM "$pid" || { echo "Could not stop the process" >&2; exit 1; }
`;

export async function stopService(exec: RemoteExec, input: RpcInput<typeof stopServiceRpc>): Promise<{}> {
  await exec({ target: input.target, command: `sh -s -- ${input.port} ${input.pid} ${input.startedAt}`, stdin: STOP_SCRIPT, timeoutMs: 20_000 });
  return {};
}
