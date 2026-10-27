// Stands in for `ssh` in tests: binds the -L local port like real ssh, or fails like it.
import net from "node:net";

const args = process.argv.slice(2);
const spec = args[args.indexOf("-L") + 1];
const localPort = Number(spec.split(":")[1]);
if (process.env.FAKE_SSH_FAIL) {
  process.stderr.write(`ssh: connect to host ${args.at(-2)}: ${process.env.FAKE_SSH_FAIL}\n`);
  process.exit(255);
}
const server = net.createServer((socket) => socket.end());
setTimeout(() => server.listen(localPort, "127.0.0.1"), 300);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
