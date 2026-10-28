import { z } from "zod";
import type { RemoteExec } from "./ssh";

const statusSchema = z.object({ serverId: z.string() });
const pluginsSchema = z.array(z.object({
  id: z.string(),
  status: z.string(),
  name: z.string().optional(),
  installation: z.object({ identity: z.object({ remote: z.string().optional(), pluginPath: z.string().optional() }) }).optional(),
}));
const separator = "\n---PASEO-PLUGINS---\n";

export async function remotePluginStatus(exec: RemoteExec, target: string, serverId: string) {
  const output = await exec({
    target,
    command: "sh -s",
    stdin: "PATH=\"$HOME/.local/bin:$PATH\"\nexport PATH\npaseo daemon status --json || exit $?\nprintf '\\n---PASEO-PLUGINS---\\n'\npaseo plugin ls --json\n",
    timeoutMs: 20_000,
  });
  const parts = output.split(separator);
  if (parts.length !== 2) throw new Error("Invalid remote plugin status response");
  const daemon = statusSchema.parse(JSON.parse(parts[0]));
  if (daemon.serverId !== serverId) throw new Error("Remote Paseo daemon does not match the selected host");
  const plugins = pluginsSchema.parse(JSON.parse(parts[1]));
  const matching = plugins.filter((item) => item.id === "ssh-browser" || item.name === "SSH Browser" || (
    item.installation?.identity.remote?.replace(/\.git$/, "") === "https://github.com/mailwmj/paseo-ssh-browser" &&
    (item.installation.identity.pluginPath ?? ".") === "."
  ));
  return { status: matching.length === 0 ? "missing" as const : matching.some((item) => item.status === "running") ? "running" as const : "unavailable" as const };
}
