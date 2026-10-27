import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRequests } from "../server/open-requests";
import type { OpenRequest, OpenResult } from "../shared/remote-url";

const input = { serverId: "remote", workspaceId: "workspace", agentId: "agent", remoteUrl: "http://localhost:3000/dashboard?tab=home#details" };
function result(request: OpenRequest): OpenResult {
  return { ...request, localPort: 43001, localUrl: "http://127.0.0.1:43001/dashboard?tab=home#details", status: "navigation_requested" };
}

test("the tool waits for the chosen desktop's actual completion and rejects wrong owners/results", async () => {
  const broker = new OpenRequests();
  try {
    const poll = broker.poll("desktop");
    let completed = false;
    const opening = broker.open(input, new AbortController().signal).then((r) => { completed = true; return r; });
    const { requests: [request] } = await poll;
    assert.equal(request.workspaceId, input.workspaceId);
    assert.equal(completed, false);
    assert.equal(broker.active("other-desktop", request.requestId), false);
    assert.deepEqual(broker.finish({ clientId: "other-desktop", requestId: request.requestId, outcome: { ok: true, result: result(request) } }), { accepted: false });
    assert.throws(() => broker.finish({ clientId: "desktop", requestId: request.requestId, outcome: { ok: true, result: { ...result(request), workspaceId: "wrong" } } }), /different remote page/);
    assert.deepEqual(broker.finish({ clientId: "desktop", requestId: request.requestId, outcome: { ok: true, result: result(request) } }), { accepted: true });
    assert.deepEqual(await opening, result(request));
    assert.equal(broker.active("desktop", request.requestId), false);
  } finally { broker.stop(); }
});

test("no desktop and multiple desktops fail without dispatching any open", async () => {
  const broker = new OpenRequests(1000, 10);
  try {
    await assert.rejects(broker.open(input, new AbortController().signal), /No eligible desktop/);
    const first = broker.poll("a");
    const second = broker.poll("b");
    await assert.rejects(broker.open(input, new AbortController().signal), /Multiple eligible desktops/);
    assert.deepEqual((await first).requests, []);
    assert.deepEqual((await second).requests, []);
  } finally { broker.stop(); }
});

test("a second desktop joining an in-flight request invalidates its authorization", async () => {
  const broker = new OpenRequests(1000, 10);
  try {
    const first = broker.poll("a");
    const opening = broker.open(input, new AbortController().signal);
    const rejected = assert.rejects(opening, /Multiple eligible desktops/);
    const { requests: [request] } = await first;
    const second = broker.poll("b");
    await rejected;
    assert.equal(broker.active("a", request.requestId), false);
    await second;
  } finally { broker.stop(); }
});

for (const mode of ["cancel", "timeout", "disconnect", "stop", "ssh failure"] as const) {
  test(`${mode} rejects the tool and refuses late results`, async () => {
    const broker = new OpenRequests(mode === "timeout" ? 10 : 1000, 5);
    try {
      const signal = new AbortController();
      const poll = broker.poll("desktop");
      const opening = broker.open(input, signal.signal);
      const rejected = assert.rejects(opening, /canceled|timed out|disconnected|stopped|Permission denied/);
      const { requests: [request] } = await poll;
      if (mode === "cancel") signal.abort();
      if (mode === "disconnect") broker.disconnect("desktop");
      if (mode === "stop") broker.stop();
      if (mode === "ssh failure") broker.finish({ clientId: "desktop", requestId: request.requestId, outcome: { ok: false, error: "Permission denied (publickey)" } });
      await rejected;
      assert.equal(broker.active("desktop", request.requestId), false);
      assert.equal(broker.finish({ clientId: "desktop", requestId: request.requestId, outcome: { ok: true, result: result(request) } }).accepted, false);
    } finally { broker.stop(); }
  });
}

test("cancellation wakes the desktop poll so it can discard pending navigation", async () => {
  const broker = new OpenRequests();
  try {
    const signal = new AbortController();
    const poll = broker.poll("desktop");
    const opening = broker.open(input, signal.signal);
    const rejected = assert.rejects(opening, /canceled/);
    await poll;
    const nextPoll = broker.poll("desktop");
    signal.abort();
    assert.deepEqual((await nextPoll).activeRequestIds, []);
    await rejected;
  } finally { broker.stop(); }
});
