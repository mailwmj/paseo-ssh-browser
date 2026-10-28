import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { recentFiles } from "../server/recent-files";

test("lists recent regular files newest first and leaves out noise", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ssh-browser-recent-"));
  try {
    const now = Date.now();
    const write = async (relative: string, ageMs: number, body = "x") => {
      const file = path.join(root, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await utimes(file, new Date(now - ageMs), new Date(now - ageMs));
    };
    await write("dist/app.zip", 60_000, "zipzip");
    await write("notes.md", 5_000);
    await write("old.log", 7 * 60 * 60 * 1000);
    await write("node_modules/pkg/index.js", 1_000);
    await write(".git/HEAD", 1_000);
    await write(".env", 1_000);
    await write("src/deep/a/b/c/d/e/f/too-deep.txt", 1_000);
    await symlink(path.join(root, "notes.md"), path.join(root, "link.md"));

    const { files } = await recentFiles(root, {}, now);
    assert.deepEqual(files.map((file) => [path.relative(root, file.path), file.size]), [
      ["notes.md", 1],
      ["dist/app.zip", 6],
      ["old.log", 1],
    ]);
    assert.equal(files[0].name, "notes.md");
    // Filesystem timestamp precision can differ slightly from the Date passed to utimes.
    assert.ok(Math.abs(files[0].ageMs - 5_000) < 1, `Expected an age near 5000ms, got ${files[0].ageMs}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unreadable or missing directory yields no files", async () => {
  assert.deepEqual(await recentFiles(path.join(os.tmpdir(), "ssh-browser-does-not-exist")), { files: [], total: 0, nextOffset: null });
});

test("loads newest files in pages of 20, including files older than six hours and beyond the first 30", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ssh-browser-recent-pages-"));
  try {
    const now = Date.now();
    for (let index = 0; index < 45; index++) {
      const file = path.join(root, `file-${index}.txt`);
      await writeFile(file, "x");
      const modified = new Date(now - (index + 1) * 60 * 60 * 1000);
      await utimes(file, modified, modified);
    }
    const first = await recentFiles(root, {}, now);
    const second = await recentFiles(root, { offset: first.nextOffset! }, now);
    const third = await recentFiles(root, { offset: second.nextOffset! }, now);
    assert.deepEqual([first.files.length, second.files.length, third.files.length], [20, 20, 5]);
    assert.deepEqual([first.nextOffset, second.nextOffset, third.nextOffset], [20, 40, null]);
    assert.deepEqual([first.total, second.total, third.total], [45, 45, 45]);
    assert.deepEqual([...first.files, ...second.files, ...third.files].map((file) => file.name),
      Array.from({ length: 45 }, (_, index) => `file-${index}.txt`));

    // Search covers the workspace, including files outside the loaded pages.
    const search = await recentFiles(root, { query: "FILE-44" }, now);
    assert.deepEqual(search.files.map((file) => file.name), ["file-44.txt"]);
    assert.equal(search.total, 1);
    assert.equal(search.nextOffset, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("equal modification times keep pagination order stable and search matches relative folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ssh-browser-recent-order-"));
  try {
    const now = Date.now();
    const modified = new Date(now - 1000);
    await mkdir(path.join(root, "Reports"));
    for (let index = 0; index < 25; index++) {
      const file = path.join(root, "Reports", `${String(index).padStart(2, "0")}.md`);
      await writeFile(file, "x");
      await utimes(file, modified, modified);
    }
    const first = await recentFiles(root, { query: "reports/" }, now);
    const second = await recentFiles(root, { query: "reports/", offset: first.nextOffset! }, now);
    assert.deepEqual([...first.files, ...second.files].map((file) => file.name),
      Array.from({ length: 25 }, (_, index) => `${String(index).padStart(2, "0")}.md`));
    assert.equal(second.nextOffset, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
