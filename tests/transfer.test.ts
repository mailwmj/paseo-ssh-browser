import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { folderSegment, type TransferJob } from "../shared/transfer";
import { localFileName, placeWithoutOverwriting, remoteCommand, shellQuote, TransferManager } from "../server/transfer";

// End to end through the real ssh binary, against this machine. Needs passwordless `ssh localhost`.
const sshLocalhost =
  spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "localhost", "true"]).status === 0;

async function scratch(): Promise<{ local: string; remote: string; done: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ssh-browser-transfer-"));
  const local = path.join(root, "local");
  const remote = path.join(root, "remote");
  await mkdir(local);
  return { local, remote, done: () => rm(root, { recursive: true, force: true }) };
}

async function finished(manager: TransferManager, ids: string[]): Promise<TransferJob[]> {
  for (let i = 0; i < 600; i++) {
    const jobs = manager.list().filter((job) => ids.includes(job.id));
    if (jobs.every((job) => job.status !== "queued" && job.status !== "running")) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("transfer did not finish");
}

async function names(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

test("shell quoting survives single quotes and spaces", () => {
  assert.equal(shellQuote("it's here"), `'it'\\''s here'`);
  assert.match(remoteCommand("echo $1", "a b"), /^sh -c 'echo \$1' sh 'a b'$/);
});

test("file names from the remote host cannot escape the folder or break Windows", () => {
  assert.equal(localFileName("/srv/app/report.zip"), "report.zip");
  assert.equal(localFileName("/srv/app/..", "linux"), "file");
  assert.equal(localFileName("/srv/a:b?.txt", "win32"), "a_b_.txt");
  assert.equal(folderSegment("../evil"), ".._evil");
  assert.equal(folderSegment(".."), null);
  assert.equal(folderSegment(undefined), null);
});

test("placing a file never overwrites and numbers before the extension", async () => {
  const { local, done } = await scratch();
  try {
    await writeFile(path.join(local, "a.tar.gz"), "old");
    await writeFile(path.join(local, "tmp1"), "one");
    await writeFile(path.join(local, "tmp2"), "two");
    assert.equal(await placeWithoutOverwriting(path.join(local, "tmp1"), local, "a.tar.gz"), path.join(local, "a.tar (1).gz"));
    assert.equal(await placeWithoutOverwriting(path.join(local, "tmp2"), local, "a.tar.gz"), path.join(local, "a.tar (2).gz"));
    assert.equal(await readFile(path.join(local, "a.tar.gz"), "utf8"), "old");
    assert.deepEqual(await names(local), ["a.tar (1).gz", "a.tar (2).gz", "a.tar.gz"]);
  } finally {
    await done();
  }
});

test("real ssh: sends several files, keeps an existing file, and leaves no staging file", { skip: !sshLocalhost }, async () => {
  const { local, remote, done } = await scratch();
  const manager = new TransferManager(async () => local);
  try {
    await mkdir(remote);
    await writeFile(path.join(remote, "report.zip"), "already there");
    const big = Buffer.alloc(3 * 1024 * 1024, "z");
    await writeFile(path.join(local, "report.zip"), big);
    await writeFile(path.join(local, "notes it's.md"), "# notes");
    const jobs = await manager.send("localhost", [path.join(local, "report.zip"), path.join(local, "notes it's.md")], remote);
    const result = await finished(manager, jobs.map((job) => job.id));
    assert.deepEqual(result.map((job) => job.status), ["done", "done"]);
    assert.deepEqual(result.map((job) => job.bytes === job.total), [true, true]);
    assert.equal(result[0].finalPath, path.join(remote, "report (1).zip"));
    assert.equal(await readFile(path.join(remote, "report.zip"), "utf8"), "already there");
    assert.deepEqual(await readFile(path.join(remote, "report (1).zip")), big);
    assert.equal(await readFile(path.join(remote, "notes it's.md"), "utf8"), "# notes");
    assert.deepEqual(await names(remote), ["notes it's.md", "report (1).zip", "report.zip"]);
  } finally {
    manager.stop();
    await done();
  }
});

test("real ssh: a cancelled send leaves no partial file at the destination", { skip: !sshLocalhost }, async () => {
  const { local, remote, done } = await scratch();
  const manager = new TransferManager(async () => local);
  try {
    const source = path.join(local, "huge.bin");
    await writeFile(source, "");
    await truncate(source, 2 * 1024 * 1024 * 1024);
    const [job] = await manager.send("localhost", [source], remote);
    // Cancel only once the remote side is receiving, which is when a cut-off stream could be mistaken for a whole file.
    for (let i = 0; i < 400 && !(await names(remote).catch(() => [])).length; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await names(remote)).length, 1, "the remote started staging the file");
    manager.cancel(job.id);
    const [result] = await finished(manager, [job.id]);
    assert.equal(result.status, "cancelled");
    // The remote shell removes its staging file after ssh drops; give it a moment.
    for (let i = 0; i < 100 && (await names(remote)).length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(await names(remote), []);
  } finally {
    manager.stop();
    await done();
  }
});

test("real ssh: receives into a per-workspace folder, never overwrites, and verifies the size", { skip: !sshLocalhost }, async () => {
  const { local, remote, done } = await scratch();
  const manager = new TransferManager(async () => local);
  try {
    await mkdir(remote);
    const body = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
    await writeFile(path.join(remote, "dist it's.zip"), body);
    for (let round = 0; round < 2; round++) {
      const jobs = await manager.receive("localhost", [path.join(remote, "dist it's.zip")], "my-workspace");
      const [result] = await finished(manager, jobs.map((job) => job.id));
      assert.equal(result.status, "done", result.error ?? undefined);
      assert.equal(result.total, body.length);
      assert.equal(result.finalPath, path.join(local, "my-workspace", round === 0 ? "dist it's.zip" : "dist it's (1).zip"));
      assert.deepEqual(await readFile(result.finalPath!), body);
    }
    assert.deepEqual(await names(path.join(local, "my-workspace")), ["dist it's (1).zip", "dist it's.zip"]);
  } finally {
    manager.stop();
    await done();
  }
});

test("real ssh: a missing remote file fails with the reason and leaves nothing behind", { skip: !sshLocalhost }, async () => {
  const { local, remote, done } = await scratch();
  const manager = new TransferManager(async () => local);
  try {
    const jobs = await manager.receive("localhost", [path.join(remote, "missing.zip"), remote], "ws");
    const result = await finished(manager, jobs.map((job) => job.id));
    assert.deepEqual(result.map((job) => job.status), ["failed", "failed"]);
    assert.match(result[0].error!, /Not a file/);
    assert.deepEqual(await names(path.join(local, "ws")), []);
  } finally {
    manager.stop();
    await done();
  }
});

test("sending a folder or a missing file fails immediately without starting ssh", async () => {
  const { local, done } = await scratch();
  const manager = new TransferManager(async () => local, () => {
    throw new Error("ssh must not start");
  });
  try {
    const jobs = await manager.send("localhost", [local, path.join(local, "nope")], "/remote");
    assert.deepEqual(jobs.map((job) => job.status), ["failed", "failed"]);
    assert.match(jobs[0].error!, /Only files/);
  } finally {
    await done();
  }
});

test("ssh failure is reported with its message", async () => {
  const { local, done } = await scratch();
  const manager = new TransferManager(async () => local, () => {
    return spawn("sh", ["-c", "echo 'ssh: connect to host nowhere port 22: Connection refused' >&2; exit 255"]);
  });
  try {
    const [job] = await manager.receive("nowhere", ["/x/y.zip"], "ws");
    const [result] = await finished(manager, [job.id]);
    assert.equal(result.status, "failed");
    assert.match(result.error!, /Connection refused/);
  } finally {
    manager.stop();
    await done();
  }
});
