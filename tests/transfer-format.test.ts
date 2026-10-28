import assert from "node:assert/strict";
import { test } from "node:test";
import { ageParts, formatBytes, parentName, progressOf, resolveRemotePath, baseName } from "../client/transfer-format";

test("sizes read the way file managers show them", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(12 * 1024 * 1024), "12 MB");
  assert.equal(formatBytes(3.25 * 1024 ** 3), "3.3 GB");
});

test("ages round down to the unit a person reads", () => {
  assert.deepEqual(ageParts(20_000), { unit: "now", count: 0 });
  assert.deepEqual(ageParts(5 * 60_000 + 40_000), { unit: "minutes", count: 5 });
  assert.deepEqual(ageParts(3 * 3_600_000 + 100), { unit: "hours", count: 3 });
});

test("a typed remote path is absolute, home-relative, or relative to the workspace", () => {
  assert.equal(resolveRemotePath("/srv/out.zip", "/work/app"), "/srv/out.zip");
  assert.equal(resolveRemotePath("~/out.zip", "/work/app"), "~/out.zip");
  assert.equal(resolveRemotePath("dist/out.zip", "/work/app/"), "/work/app/dist/out.zip");
  assert.equal(resolveRemotePath("./out.zip", "/work/app"), "/work/app/out.zip");
  assert.equal(resolveRemotePath("   ", "/work/app"), null);
});

test("names and folders come from the path, not the platform", () => {
  assert.equal(baseName("/a/b/c.zip"), "c.zip");
  assert.equal(baseName("C:\\Users\\me\\c.zip"), "c.zip");
  assert.equal(parentName("/a/b/c.zip", "/a"), "b");
  assert.equal(parentName("/a/c.zip", "/a"), "");
});

test("progress is a fraction, empty when the size is unknown", () => {
  assert.equal(progressOf({ bytes: 50, total: 200 }), 0.25);
  assert.equal(progressOf({ bytes: 5, total: null }), 0);
  assert.equal(progressOf({ bytes: 0, total: 0 }), 1);
  assert.equal(progressOf({ bytes: 300, total: 200 }), 1);
});
