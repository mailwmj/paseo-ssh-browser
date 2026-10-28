import assert from "node:assert/strict";
import { test } from "node:test";
import { remotePluginStatus } from "../server/plugin-status";
import type { RemoteExec } from "../server/ssh";

const response = (serverId: string, plugins: unknown): RemoteExec => async () =>
  `${JSON.stringify({ serverId })}\n---PASEO-PLUGINS---\n${JSON.stringify(plugins)}`;

test("reports missing, running and unavailable plugins for the selected daemon", async () => {
  assert.equal((await remotePluginStatus(response("remote", []), "host", "remote")).status, "missing");
  assert.equal((await remotePluginStatus(response("remote", [{ id: "ssh-browser", status: "running" }]), "host", "remote")).status, "running");
  assert.equal((await remotePluginStatus(response("remote", [{ id: "custom-id", status: "running", installation: { identity: { remote: "https://github.com/mailwmj/paseo-ssh-browser.git", pluginPath: "." } } }]), "host", "remote")).status, "running");
  assert.equal((await remotePluginStatus(response("remote", [{ id: "ssh-browser", status: "disabled" }]), "host", "remote")).status, "unavailable");
});

test("does not diagnose a different daemon or a failed status check as missing", async () => {
  await assert.rejects(remotePluginStatus(response("other", []), "host", "remote"), /does not match/);
  await assert.rejects(remotePluginStatus(async () => { throw new Error("SSH failed"); }, "host", "remote"), /SSH failed/);
  await assert.rejects(remotePluginStatus(async () => "invalid", "host", "remote"), /Invalid remote plugin status/);
});
