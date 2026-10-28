import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// An SSH destination as `ssh` accepts it: an alias, user@host, or ssh://user@host:port.
// Rejecting a leading "-" keeps the value from being read as an ssh option.
export const sshTarget = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.@:/%[\]][A-Za-z0-9_.@:/%[\]-]*$/, "Not a valid SSH destination");

export const remotePort = z.number().int().min(1).max(65535);

// The address the remote service listens on, as the remote host reaches it: 127.0.0.1, ::1, or a specific IP.
export const remoteHost = z.string().regex(/^[0-9A-Fa-f.:]+$/, "Not an IP address");

export const targetsSettings = defineSettings({
  id: "targets",
  scope: "host",
  version: 1,
  schema: z.object({ targets: z.array(sshTarget).default([]) }),
});

export const recentSettings = defineSettings({
  id: "recent-pages", scope: "host", version: 1,
  schema: z.object({ pages: z.array(z.object({ serverId: z.string(), workspaceId: z.string(), url: z.string().max(4096) })).max(100).default([]) }),
});

export const detectedPort = z.object({
  port: remotePort,
  host: remoteHost,
  pid: z.number().int().nullable(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  title: z.string().nullable(),
  protocol: z.enum(["http", "https"]).nullable().default("http"),
  agentId: z.string().nullable().default(null),
});
export type DetectedPort = z.infer<typeof detectedPort>;

export const forward = z.object({
  target: sshTarget,
  remoteHost,
  remotePort,
  localPort: remotePort,
  url: z.string(),
  connectionError: z.string().optional(),
});
export type Forward = z.infer<typeof forward>;

export const scanRpc = defineRpc({
  name: "ports.scan",
  input: z.object({ target: sshTarget, refresh: z.boolean().optional() }),
  output: z.object({
    // The remote daemon's Paseo server ID, used to find its workspaces in the app.
    serverId: z.string().nullable(),
    ports: z.array(detectedPort),
    otherPorts: z.array(detectedPort).default([]),
  }),
});

export const forwardsRpc = defineRpc({
  name: "ports.forwards",
  input: z.object({}),
  output: z.object({ forwards: z.array(forward), disconnected: z.array(forward).default([]) }),
});

export const openRpc = defineRpc({
  name: "ports.open",
  input: z.object({ target: sshTarget, remoteHost, remotePort }),
  output: forward,
});

export const closeRpc = defineRpc({
  name: "ports.close",
  input: z.object({ target: sshTarget, remotePort }),
  output: z.object({}),
});

// SSH hosts entered by hand, with the Paseo server each one runs, learned from scanning it. This is
// how a host the app reaches some other way, such as the relay, is matched to its SSH address.
export const targetsRpc = defineRpc({
  name: "ports.targets",
  input: z.object({}),
  output: z.object({
    targets: z.array(z.object({ target: sshTarget, serverId: z.string().nullable() })),
  }),
});
