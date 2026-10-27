import assert from "node:assert/strict";
import { test } from "node:test";
import { getLocalApi, publishLocalApi, type LocalApi } from "../client/bridge";

const api = (): LocalApi => ({
  version: 1,
  scan: async () => ({ serverId: null, ports: [] }),
  forwards: async () => ({ forwards: [] }),
  open: async () => {
    throw new Error("unused");
  },
  close: async () => ({}),
});

test("the copy on this computer is reachable from every copy until it unloads", () => {
  const local = api();
  const unpublish = publishLocalApi(local);
  assert.equal(getLocalApi(), local);
  unpublish();
  assert.equal(getLocalApi(), null);
});

test("a reload that publishes again is not undone by the old copy's cleanup", () => {
  const before = publishLocalApi(api());
  const reloaded = api();
  const after = publishLocalApi(reloaded);
  before();
  assert.equal(getLocalApi(), reloaded);
  after();
});

test("a copy speaking another bridge version is ignored", () => {
  const unpublish = publishLocalApi({ ...api(), version: 2 } as unknown as LocalApi);
  assert.equal(getLocalApi(), null);
  unpublish();
});
