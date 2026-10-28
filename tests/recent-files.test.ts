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

    const files = await recentFiles(root, now);
    assert.deepEqual(files.map((file) => [path.relative(root, file.path), file.size]), [
      ["notes.md", 1],
      ["dist/app.zip", 6],
    ]);
    assert.equal(files[0].name, "notes.md");
    assert.equal(files[0].ageMs, 5_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unreadable or missing directory yields no files", async () => {
  assert.deepEqual(await recentFiles(path.join(os.tmpdir(), "ssh-browser-does-not-exist")), []);
});
