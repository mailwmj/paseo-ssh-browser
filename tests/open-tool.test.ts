import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { OpenRequests } from "../server/open-requests";
import { openRemoteUrlTool } from "../server/open-tool";

function context(workspaceId: string | null): AgentToolContext {
  return {
    agent: { id: "agent", workspaceId, cwd: "/work", provider: "codex", parentAgentId: null, title: null },
    paseo: { hosts: { list: async () => ({ self: { serverId: "remote", label: "Remote" }, hosts: [] }) } } as unknown as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  };
}

test("the tool takes ownership from its context and reports the tunnel separately from opening a page", async () => {
  const broker = new OpenRequests();
  try {
    const tool = openRemoteUrlTool(broker);
    const poll = broker.poll("desktop");
    const output = tool.execute({ url: "http://localhost:3000/dashboard?tab=home#details", workspaceId: "model-guessed-workspace" }, context("actual-workspace"));
    const { requests: [request] } = await poll;
    assert.equal(request.workspaceId, "actual-workspace");
    assert.equal(request.serverId, "remote");
    const result = { requestId: request.requestId, workspaceId: request.workspaceId, serverId: request.serverId, remoteUrl: request.remoteUrl,
      localUrl: "http://127.0.0.1:45001/dashboard?tab=home#details", localPort: 45001, status: "tunnel_ready" as const };
    broker.finish({ clientId: "desktop", requestId: request.requestId, outcome: { ok: true, result } });
    const response = await output;
    assert.deepEqual(response.structuredContent, result);
    assert.match(response.text!, /browser_new_tab/);
    assert.match(response.text!, /browser_snapshot/);
  } finally { broker.stop(); }
});

test("the tool rejects workspace-less agents and invalid URLs before dispatch", async () => {
  const broker = new OpenRequests();
  try {
    const tool = openRemoteUrlTool(broker);
    await assert.rejects(async () => tool.execute({ url: "http://localhost:3000/" }, context(null)), /no workspace/);
    await assert.rejects(async () => tool.execute({ url: "ftp://localhost:3000/" }, context("workspace")), /Only HTTP and HTTPS/);
  } finally { broker.stop(); }
});
