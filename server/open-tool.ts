import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { parseRemoteUrl } from "../shared/remote-url";
import type { OpenRequests } from "./open-requests";

export function openRemoteUrlTool(requests: OpenRequests) {
  return defineAgentTool({
    name: "open_remote_url",
    title: "Open remote page on the user's desktop",
    description: "After starting or updating a remote web app for preview, call this tool with its remote loopback URL, including path, query and fragment. It silently establishes an SSH tunnel on the eligible desktop and returns localUrl; it does not open a page. Immediately call browser_new_tab with the returned localUrl (never the remote URL), then use the returned browserId with browser_snapshot or browser_wait to verify the page. Use this only when one Paseo Desktop browser host is connected: browser_new_tab selects the most recently connected browser host, which must be the desktop that established the tunnel. Report errors; never fall back to opening the remote port directly.",
    input: z.object({ url: z.string().describe("Absolute HTTP/HTTPS URL on remote localhost, 127.0.0.1 or [::1], e.g. http://localhost:3000/dashboard?tab=home#details") }),
    async execute({ url }, { agent, paseo, signal }) {
      if (!agent.workspaceId) throw new Error("This agent has no workspace; a workspace is required to open a remote page");
      const remote = parseRemoteUrl(url);
      const { self } = await paseo.hosts.list();
      const result = await requests.open({
        serverId: self.serverId, workspaceId: agent.workspaceId, agentId: agent.id, remoteUrl: remote.url,
      }, signal);
      return {
        text: `${JSON.stringify(result)}\nTunnel ready; no page has been opened. Call browser_new_tab with localUrl, then browser_snapshot/browser_wait with its browserId to verify the page. The browser host must be the desktop that established the tunnel.`,
        structuredContent: result,
      };
    },
  });
}
