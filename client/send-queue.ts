import type { TransferJob } from "../shared/transfer";

export interface SendFile {
  path: string;
  job?: TransferJob;
}

export function isActive(job: TransferJob): boolean {
  return job.status === "queued" || job.status === "running";
}

// Explicitly choosing a finished file queues it again in the same position. Existing pending or
// running files stay where they are; new paths append, even when the picker returns a different order.
export function addSendFiles(queue: SendFile[], paths: string[]): SendFile[] {
  const next = [...queue];
  for (const path of paths) {
    const index = next.findIndex((file) => file.path === path);
    if (index === -1) next.push({ path });
    else if (next[index].job && !isActive(next[index].job!)) next[index] = { path };
  }
  return next;
}

export function attachSendJobs(queue: SendFile[], jobs: TransferJob[]): SendFile[] {
  const bySource = new Map(jobs.map((job) => [job.source, job]));
  return queue.map((file) => {
    const job = bySource.get(file.path);
    return job ? { ...file, job } : file;
  });
}

// Retain the last observed job when the daemon prunes its history. Reopening a surface also recovers
// active sends to this workspace's remembered destination without mixing in another workspace.
export function syncSendQueue(queue: SendFile[], jobs: TransferJob[], destination: string): SendFile[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  let changed = false;
  const next = queue.map((file) => {
    const job = file.job && byId.get(file.job.id);
    if (!job || job === file.job) return file;
    changed = true;
    return { ...file, job };
  });
  for (const job of jobs) {
    if (job.direction !== "send" || job.destination !== destination || !isActive(job)) continue;
    const index = next.findIndex((file) => file.path === job.source);
    if (index === -1) {
      changed = true;
      next.push({ path: job.source, job });
    } else if (!next[index].job) {
      // A list response can arrive before the send RPC returns, or after its response was lost.
      changed = true;
      next[index] = { ...next[index], job };
    }
  }
  return changed ? next : queue;
}
