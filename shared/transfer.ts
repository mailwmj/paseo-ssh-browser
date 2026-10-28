import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { sshTarget } from "./ports";

const path = z.string().min(1).max(4096).refine((value) => !value.includes("\0"), "Not a valid path");

export const receiveSettings = defineSettings({
  id: "receive-folder",
  scope: "host",
  version: 1,
  schema: z.object({ folder: path.nullable().default(null) }),
});

export const transferJob = z.object({
  id: z.string(),
  direction: z.enum(["send", "receive"]),
  target: sshTarget,
  name: z.string(),
  // The file on the side that sends it, and the folder on the side that receives it.
  source: z.string(),
  destination: z.string(),
  // Where the file ended up, once done. A name conflict can change the name.
  finalPath: z.string().nullable(),
  bytes: z.number(),
  total: z.number().nullable(),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  error: z.string().nullable(),
});
export type TransferJob = z.infer<typeof transferJob>;

const jobs = z.object({ jobs: z.array(transferJob) });

export const sendRpc = defineRpc({
  name: "transfer.send",
  input: z.object({ target: sshTarget, paths: z.array(path).min(1).max(200), remoteDir: path }),
  output: jobs,
});

export const receiveRpc = defineRpc({
  name: "transfer.receive",
  input: z.object({
    target: sshTarget,
    remotePaths: z.array(path).min(1).max(200),
    // A folder name under the receive folder, normally the workspace name.
    folder: z.string().max(256).optional(),
  }),
  output: jobs,
});

export const transfersRpc = defineRpc({ name: "transfer.list", input: z.object({}), output: jobs });

export const cancelTransferRpc = defineRpc({
  name: "transfer.cancel",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

// The folder received files go to, with the default resolved for this computer.
export const receiveFolderRpc = defineRpc({
  name: "transfer.folder",
  input: z.object({}),
  output: z.object({ folder: z.string() }),
});

export const recentFile = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  ageMs: z.number(),
});
export type RecentFile = z.infer<typeof recentFile>;

// Files changed lately under a directory on the host this copy runs on, for a workspace there.
export const recentFilesRpc = defineRpc({
  name: "transfer.recent",
  input: z.object({ directory: path }),
  output: z.object({ files: z.array(recentFile) }),
});
