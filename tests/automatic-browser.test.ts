import assert from "node:assert/strict";
import { test } from "node:test";
import { AutomaticBrowser, findSshTarget } from "../client/automatic-browser";
import { buildLocalApi, type RpcCalls } from "../client/bridge";
import type { OpenRequest } from "../shared/remote-url";

const request = (): OpenRequest => ({ requestId: "request", serverId: "remote", workspaceId: "workspace", agentId: "agent", remoteUrl: "https://[::1]:3000/dashboard?tab=home#details", expiresAt: Date.now() + 1000 });
const unused = async (): Promise<never> => { throw new Error("unused"); };
function api(overrides: Partial<RpcCalls> = {}) {
  return buildLocalApi({ scan: async () => ({ serverId: "remote", ports: [] }), forwards: unused,
    open: async (input) => ({ ...input, localPort: 44001, url: "http://localhost:44001/" }), close: unused,
    targets: async () => ({ targets: [] }), readSettings: unused, writeSettings: unused,
    readRecent: async () => ({ status: "ready", revision: "r", values: { pages: [] } }),
    writeRecent: async ({ values }) => ({ status: "saved", revision: "r2", values }), ...overrides });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

test("automatically mounts the panel and uses the returned tunnel endpoint in the original remote workspace", async () => {
  const browser = new AutomaticBrowser();
  const navigations: unknown[] = [];
  let panels = 0;
  const local = api({ open: async (input) => {
    assert.deepEqual(input, { target: "dev", remoteHost: "::1", remotePort: 3000 });
    return { ...input, localPort: 44001, url: "http://localhost:44001/" };
  } });
  const result = await browser.open({ request: request(), api: local, target: "dev", signal: new AbortController().signal,
    authorize: async () => true, openPanel: () => { panels++; browser.attach("workspace", (input) => navigations.push(input)); } });
  assert.equal(panels, 1);
  assert.equal(result.status, "navigation_requested");
  assert.deepEqual(navigations, [{ url: "https://127.0.0.1:44001/dashboard?tab=home#details", workspaceId: "workspace", serverId: "remote" }]);
});

test("a canceled slow tunnel does not open a panel or page, and does not close shared tunnels", async () => {
  const browser = new AutomaticBrowser();
  const signal = new AbortController();
  const tunnel = deferred<void>();
  const started = deferred<void>();
  let opens = 0;
  const opening = browser.open({ request: request(), api: api({ open: async (input) => {
    started.resolve(); await tunnel.promise;
    return { ...input, localPort: 44001, url: "http://localhost:44001/" };
  } }), target: "dev", signal: signal.signal, authorize: async () => true, openPanel: () => { opens++; } });
  const rejected = assert.rejects(opening, /canceled/);
  await started.promise;
  signal.abort(); tunnel.resolve();
  await rejected;
  assert.equal(opens, 0);
});

test("cancellation while the panel mounts prevents a late navigation", async () => {
  const browser = new AutomaticBrowser();
  const signal = new AbortController();
  const mounted = deferred<void>();
  let navigations = 0;
  const opening = browser.open({ request: request(), api: api(), target: "dev", signal: signal.signal, authorize: async () => true, openPanel: () => mounted.resolve() });
  const rejected = assert.rejects(opening, /canceled/);
  await mounted.promise;
  signal.abort();
  browser.attach("workspace", () => { navigations++; });
  await rejected;
  assert.equal(navigations, 0);
});

test("stale SSH mappings, SSH errors, and absent Desktop navigation never report success", async () => {
  for (const local of [api({ scan: async () => ({ serverId: "wrong", ports: [] }) }), api({ open: async () => { throw new Error("Permission denied"); } }), api()]) {
    const browser = new AutomaticBrowser();
    await assert.rejects(browser.open({ request: request(), api: local, target: "dev", signal: new AbortController().signal,
      authorize: async () => true, openPanel: () => { browser.attach("workspace", undefined); } }), /does not match|Permission denied|requires Paseo Desktop/);
  }
});

test("expired requests and authorization revoked during tunnel creation cannot navigate", async () => {
  const browser = new AutomaticBrowser();
  const expired = { ...request(), expiresAt: Date.now() - 1 };
  await assert.rejects(browser.open({ request: expired, api: api(), target: "dev", signal: new AbortController().signal, authorize: async () => true, openPanel: () => assert.fail("opened expired request") }), /expired/);
  let active = true;
  await assert.rejects(browser.open({ request: request(), api: api({ open: async (input) => {
    active = false;
    return { ...input, localPort: 44001, url: "http://localhost:44001/" };
  } }), target: "dev", signal: new AbortController().signal, authorize: async () => active, openPanel: () => assert.fail("opened canceled request") }), /no longer active/);
});

test("requires a unique SSH mapping, including manually saved targets", async () => {
  assert.equal(await findSshTarget("remote", { local: [], ssh: [{ serverId: "remote", target: "dev" }] }, api()), "dev");
  assert.equal(await findSshTarget("remote", { local: [], ssh: [] }, api()), null);
  const saved = api({ targets: async () => ({ targets: [{ target: "a", serverId: "remote" }, { target: "b", serverId: "remote" }] }) });
  await assert.rejects(findSshTarget("remote", { local: [], ssh: [] }, saved), /Multiple SSH destinations/);
});
