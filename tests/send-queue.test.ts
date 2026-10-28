import assert from "node:assert/strict";
import { test } from "node:test";
import { addSendFiles, attachSendJobs, syncSendQueue, type SendFile } from "../client/send-queue";
import type { TransferJob } from "../shared/transfer";

function job(id: string, source: string, status: TransferJob["status"] = "running", destination = "/work/app"): TransferJob {
  return { id, source, name: source.split("/").at(-1)!, destination, status, direction: "send", target: "devbox", bytes: 0, total: 128, finalPath: status === "done" ? `${destination}/${source.split("/").at(-1)}` : null, error: null };
}

test("picking more files appends new paths without reordering or duplicating existing rows", () => {
  const queue = addSendFiles([], ["/local/b.pdf", "/local/c.csv"]);
  const next = addSendFiles(queue, ["/local/a.png", "/local/c.csv", "/local/b.pdf", "/local/a.png"]);
  assert.deepEqual(next.map((file) => file.path), ["/local/b.pdf", "/local/c.csv", "/local/a.png"]);
});

test("submitting binds jobs to the original rows and keeps files added during the request", () => {
  const queue = addSendFiles([], ["/local/a.png", "/local/b.pdf", "/local/c.csv"]);
  const created = [job("b", "/local/b.pdf"), job("a", "/local/a.png")];
  const next = attachSendJobs(queue, created);
  assert.deepEqual(next.map((file) => file.path), queue.map((file) => file.path));
  assert.equal(next[0].job?.id, "a");
  assert.equal(next[1].job?.id, "b");
  assert.equal(next[2].job, undefined);
  assert.equal(queue[0].job, undefined);
});

test("completion updates the same rows and survives daemon history pruning", () => {
  const queue = attachSendJobs(addSendFiles([], ["/local/a.png", "/local/b.pdf"]), [job("a", "/local/a.png"), job("b", "/local/b.pdf")]);
  const completed = syncSendQueue(queue, [job("b", "/local/b.pdf", "done"), job("a", "/local/a.png", "done")], "/work/app");
  assert.deepEqual(completed.map((file) => [file.path, file.job?.status]), [["/local/a.png", "done"], ["/local/b.pdf", "done"]]);
  assert.equal(syncSendQueue(completed, [], "/work/app"), completed);
});

test("retry replaces a failed job in place, and picking a completed file explicitly queues it again", () => {
  const failed = job("failed", "/local/a.png", "failed");
  const completed = job("done", "/local/b.pdf", "done");
  const queue: SendFile[] = [{ path: failed.source, job: failed }, { path: completed.source, job: completed }];
  const retried = attachSendJobs(queue, [job("retried", failed.source)]);
  assert.equal(retried[0].job?.id, "retried");
  assert.equal(retried[1], queue[1]);
  const picked = addSendFiles(retried, [completed.source, failed.source]);
  assert.equal(picked[0].job?.id, "retried");
  assert.equal(picked[1].job, undefined);
  assert.deepEqual(picked.map((file) => file.path), queue.map((file) => file.path));
});

test("reopening recovers active sends to this workspace, retaining them when they complete", () => {
  const active = job("active", "/local/a.png");
  const jobs = [job("old", "/local/old.pdf", "done"), job("other", "/local/b.pdf", "running", "/work/other"), { ...job("receive", "/remote/c.csv"), direction: "receive" as const }, active];
  const restored = syncSendQueue([], jobs, "/work/app");
  assert.deepEqual(restored, [{ path: active.source, job: active }]);
  const finished = syncSendQueue(restored, [job("active", active.source, "done")], "/work/app");
  assert.equal(finished[0].job?.status, "done");
  assert.equal(finished.length, 1);
});

test("polling binds an already-started send when its RPC response has not reached the UI", () => {
  const queue = addSendFiles([], ["/local/a.png", "/local/b.pdf"]);
  const active = job("active", "/local/a.png");
  const next = syncSendQueue(queue, [active], "/work/app");
  assert.deepEqual(next.map((file) => file.path), queue.map((file) => file.path));
  assert.equal(next[0].job?.id, "active");
  assert.equal(next[1].job, undefined);
});
