import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const OPEN_PROTOCOL = 2;
export const POLL_MS = 15_000;
export const OPEN_TIMEOUT_MS = 60_000;

// Only URLs for a web service on the agent's machine belong in an SSH forward.
export function parseRemoteUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected an absolute HTTP or HTTPS loopback URL, for example http://localhost:3000/");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("The URL must use localhost, 127.0.0.1, or [::1] on the remote host");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials are not supported");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (port < 1) throw new Error("The URL port must be between 1 and 65535");
  return {
    url: url.href,
    remoteHost: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
    remotePort: port,
  };
}

export function forwardedUrl(remoteUrl: string, localPort: number): string {
  const url = new URL(parseRemoteUrl(remoteUrl).url);
  // Use the address actually owned by ssh, so an IPv6 localhost listener cannot shadow it.
  url.hostname = "127.0.0.1";
  url.port = String(localPort);
  return url.href;
}

const identity = { clientId: z.string().min(1) };
const requestIdentity = { ...identity, requestId: z.string().min(1) };
export const openRequest = z.object({
  requestId: z.string(),
  serverId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  remoteUrl: z.string(),
  expiresAt: z.number(),
});
export type OpenRequest = z.infer<typeof openRequest>;

export const openResult = z.object({
  requestId: z.string(),
  serverId: z.string(),
  workspaceId: z.string(),
  remoteUrl: z.string(),
  localUrl: z.string(),
  localPort: z.number().int().min(1).max(65535),
  // The agent must open and verify the returned URL with browser tools.
  status: z.literal("tunnel_ready"),
});
export type OpenResult = z.infer<typeof openResult>;

export const pollOpenRpc = defineRpc({
  name: "browser.poll",
  input: z.object({ ...identity, protocol: z.literal(OPEN_PROTOCOL) }),
  output: z.object({ requests: z.array(openRequest), activeRequestIds: z.array(z.string()) }),
});
export const authorizeOpenRpc = defineRpc({
  name: "browser.authorize",
  input: z.object(requestIdentity),
  output: z.object({ active: z.boolean() }),
});
export const finishOpenRpc = defineRpc({
  name: "browser.finish",
  input: z.object({
    ...requestIdentity,
    outcome: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), result: openResult }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  }),
  output: z.object({ accepted: z.boolean() }),
});
export const disconnectOpenRpc = defineRpc({
  name: "browser.disconnect",
  input: z.object(identity),
  output: z.object({}),
});
