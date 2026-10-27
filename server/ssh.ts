import { spawn } from "node:child_process";

// Never prompt: the plugin has no terminal. Keys come from the agent or unencrypted key files,
// the same way Paseo's own SSH host connection works.
export const SSH_BASE_ARGS = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

export type RemoteExec = (input: {
  target: string;
  command: string;
  stdin: string;
  timeoutMs: number;
}) => Promise<string>;

export const sshExec: RemoteExec = ({ target, command, stdin, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn("ssh", [...SSH_BASE_ARGS, "--", target, command], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ssh ${target} timed out`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(lastLine(stderr) ?? `ssh ${target} exited with code ${code}`));
    });
    child.stdin.end(stdin);
  });

export function lastLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}
