import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { parseRemoteUrl } from "../shared/remote-url";
import type { OpenRequests } from "./open-requests";

export function openRemoteUrlTool(requests: OpenRequests) {
  return defineAgentTool({
    name: "open_remote_url",
    title: "Open remote page on the user's desktop",
    description: "After starting or updating a remote web app for the user to preview, proactively call this tool with its loopback URL, including the desired path, query and fragment. Call it before using browser tools on a remote localhost page. Printing a URL in chat does not open it. SSH Browser establishes a tunnel on the uniquely eligible Paseo Desktop and creates and focuses a browser tab in this agent's remote workspace. Do not call browser_new_tab with the remote URL. After success, call browser_list_tabs, match the returned localUrl in this workspace, and use that browserId with browser_snapshot or browser_wait to verify the actual page loaded. Success reports navigation requested, not page loaded. If the tool fails, report the error; do not open the same local port directly, which could belong to an unrelated local service.",
    input: z.object({ url: z.string().describe("Absolute HTTP/HTTPS URL on remote localhost, 127.0.0.1 or [::1], e.g. http://localhost:3000/dashboard?tab=home#details") }),
    async execute({ url }, { agent, paseo, signal }) {
      if (!agent.workspaceId) throw new Error("This agent has no workspace; a workspace is required to open a remote page");
      const remote = parseRemoteUrl(url);
      const { self } = await paseo.hosts.list();
      const result = await requests.open({
        serverId: self.serverId, workspaceId: agent.workspaceId, agentId: agent.id, remoteUrl: remote.url,
      }, signal);
      return {
        text: `${JSON.stringify(result)}\nNavigation requested in the remote workspace. Use browser_list_tabs to find localUrl, then browser_snapshot/browser_wait to verify the page.`,
        structuredContent: result,
      };
    },
  });
}
