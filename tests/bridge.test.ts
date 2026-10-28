import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLocalApi, getLocalApi, publishLocalApi, type LocalApi, type RpcCalls } from "../client/bridge";

const unused = async (): Promise<never> => {
  throw new Error("unused");
};

function calls(overrides: Partial<RpcCalls> = {}): RpcCalls {
  return {
    scan: unused,
    remotePluginStatus: unused,
    stopService: unused,
    forwards: unused,
    open: unused,
    close: unused,
    targets: unused,
    readSettings: unused,
    writeSettings: unused,
    readRecent: unused,
    writeRecent: unused,
    transfer: { send: unused, receive: unused, list: unused, cancel: unused, folder: unused, readFolder: unused, writeFolder: unused },
    ...overrides,
  };
}

test("the copy on this computer is reachable from every copy until it unloads", () => {
  const local = buildLocalApi(calls());
  const unpublish = publishLocalApi(local);
  assert.equal(getLocalApi(), local);
  unpublish();
  assert.equal(getLocalApi(), null);
});

test("a reload that publishes again is not undone by the old copy's cleanup", () => {
  const before = publishLocalApi(buildLocalApi(calls()));
  const reloaded = buildLocalApi(calls());
  const after = publishLocalApi(reloaded);
  before();
  assert.equal(getLocalApi(), reloaded);
  after();
});

test("a copy speaking another bridge version is ignored", () => {
  const unpublish = publishLocalApi({ ...buildLocalApi(calls()), version: 1 } as unknown as LocalApi);
  assert.equal(getLocalApi(), null);
  unpublish();
});

test("adding an SSH host keeps hosts another client saved in the meantime", async () => {
  // The first write loses a race with another client that added "build"; the retry re-reads.
  const stored = [
    { revision: "r1", targets: ["devbox"] },
    { revision: "r2", targets: ["devbox", "build"] },
  ];
  const written: string[][] = [];
  const api = buildLocalApi(
    calls({
      readSettings: async () => {
        const next = stored.shift()!;
        return { status: "ready", revision: next.revision, values: { targets: next.targets } };
      },
      writeSettings: async ({ revision, values }) => {
        written.push((values as { targets: string[] }).targets);
        return revision === "r1"
          ? { status: "conflict", error: "stale" }
          : { status: "saved", revision: "r3", values };
      },
    }),
  );
  await api.updateTargets((targets) => [...targets, "relayed-box"]);
  assert.deepEqual(written, [
    ["devbox", "relayed-box"],
    ["devbox", "build", "relayed-box"],
  ]);
});

test("an SSH host the settings reject is reported, not retried", async () => {
  let writes = 0;
  const api = buildLocalApi(
    calls({
      readSettings: async () => ({ status: "ready", revision: "r1", values: { targets: [] } }),
      writeSettings: async () => {
        writes++;
        return { status: "invalid", error: "Not a valid SSH destination" };
      },
    }),
  );
  await assert.rejects(api.updateTargets(() => ["-oops"]), /Not a valid SSH destination/);
  assert.equal(writes, 1);
});

test("the receive folder is saved against the revision it read, retried once on a conflict, and null restores the default", async () => {
  const revisions = ["r1", "r2"];
  const written: unknown[] = [];
  const api = buildLocalApi(
    calls({
      transfer: {
        ...calls().transfer,
        readFolder: async () => ({ status: "ready", revision: revisions.shift()!, values: { folder: null } }),
        writeFolder: async ({ revision, values }) => {
          written.push(values);
          return revision === "r1" ? { status: "conflict", error: "stale" } : { status: "saved", revision: "r3", values };
        },
      },
    }),
  );
  await api.setReceiveFolder(null);
  assert.deepEqual(written, [{ folder: null }, { folder: null }]);
});

test("a receive folder the settings reject is reported, not retried", async () => {
  let writes = 0;
  const api = buildLocalApi(
    calls({
      transfer: {
        ...calls().transfer,
        readFolder: async () => ({ status: "ready", revision: "r1", values: { folder: null } }),
        writeFolder: async () => {
          writes++;
          return { status: "invalid", error: "Not a valid path" };
        },
      },
    }),
  );
  await assert.rejects(api.setReceiveFolder("bad\0path"), /Not a valid path/);
  assert.equal(writes, 1);
});

test("transfer calls unwrap the job lists", async () => {
  const job = { id: "1", direction: "send", target: "box", name: "a.zip", source: "/a.zip", destination: "/srv", finalPath: null, bytes: 0, total: 1, status: "queued", error: null } as const;
  const api = buildLocalApi(
    calls({ transfer: { ...calls().transfer, send: async () => ({ jobs: [job] }), list: async () => ({ jobs: [job] }) } }),
  );
  assert.deepEqual(await api.send({ target: "box", paths: ["/a.zip"], remoteDir: "/srv" }), [job]);
  assert.deepEqual(await api.transfers(), [job]);
});
