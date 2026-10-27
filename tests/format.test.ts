import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributePorts,
  groupPortsByWorkspace,
  parseAddress,
  parseHostRegistry,
  pickWorkspace,
  servicesByPort,
  shortCommand,
  workspaceLabel,
} from "../client/format";

const workspaces = [
  { id: "repo", directory: "/home/me/repo" },
  { id: "worktree", directory: "/home/me/repo/.paseo/worktrees/feature/" },
  { id: "other", directory: "/home/me/repository" },
];

test("opens the page in the most specific workspace containing the process", () => {
  assert.equal(pickWorkspace(workspaces, "/home/me/repo/.paseo/worktrees/feature/web"), "worktree");
  assert.equal(pickWorkspace(workspaces, "/home/me/repo"), "repo");
  assert.equal(pickWorkspace(workspaces, "/home/me/repository/app"), "other");
  assert.equal(pickWorkspace(workspaces, "/tmp"), null);
  assert.equal(pickWorkspace(workspaces, null), null);
});

test("shortens commands to what started the server", () => {
  assert.equal(shortCommand("node /home/me/app/node_modules/.bin/vite --port 5173"), "vite --port 5173");
  assert.equal(shortCommand("python3 -m http.server 8000"), "http.server 8000");
  assert.equal(shortCommand("/usr/bin/caddy run"), "caddy run");
  assert.equal(shortCommand(null), null);
});

test("reuses the SSH hosts Paseo Desktop is configured with and finds this computer's host", () => {
  const registry = JSON.stringify([
    {
      serverId: "srv_mac",
      label: "MacBook",
      connections: [{ id: "tcp", type: "directTcp", endpoint: "localhost:6767" }],
      preferredConnectionId: "tcp",
    },
    {
      serverId: "srv_socket",
      connections: [{ id: "s", type: "directSocket", path: "/tmp/paseo.sock" }],
    },
    {
      serverId: "srv_devbox",
      label: "devbox",
      password: "secret",
      connections: [
        { id: "relay", type: "relay", relayEndpoint: "relay.paseo.sh:443" },
        { id: "ssh", type: "remoteSsh", host: "devbox" },
      ],
      preferredConnectionId: "relay",
    },
    {
      serverId: "srv_port",
      connections: [
        { id: "a", type: "remoteSsh", host: "me@old", sshPort: 22 },
        { id: "b", type: "remoteSsh", host: "me@build", sshPort: 2222 },
      ],
      preferredConnectionId: "b",
    },
    { serverId: "srv_lan", connections: [{ id: "t", type: "directTcp", endpoint: "192.168.1.5:6767" }] },
    { serverId: "srv_bad", connections: [{ id: "x", type: "remoteSsh", host: "-oProxyCommand=sh" }] },
  ]);
  assert.deepEqual(parseHostRegistry(registry), {
    ssh: [
      { serverId: "srv_devbox", target: "devbox" },
      { serverId: "srv_port", target: "ssh://me@build:2222" },
    ],
    local: ["srv_mac", "srv_socket"],
  });
});

test("an unreadable host list yields no hosts instead of failing", () => {
  const empty = { ssh: [], local: [] };
  assert.deepEqual(parseHostRegistry(null), empty);
  assert.deepEqual(parseHostRegistry("not json"), empty);
  assert.deepEqual(parseHostRegistry('{"hosts": []}'), empty);
  assert.deepEqual(parseHostRegistry('[null, {"serverId": 1}, {"serverId": "s"}]'), empty);
});

type Script = { scriptName: string; type: string; port: number | null; lifecycle: string };
const entry = (id: string, directory: string, scripts: Script[] = []) => ({
  id,
  name: id,
  projectDisplayName: "app",
  projectRootPath: "/home/me/app",
  workspaceDirectory: directory,
  scripts,
});

test("names a port after the running paseo.json service that owns it", () => {
  const services = servicesByPort([
    entry("ws-main", "/repo", [
      { scriptName: "web", type: "service", port: 3000, lifecycle: "running" },
      { scriptName: "api", type: "service", port: 4000, lifecycle: "stopped" },
      { scriptName: "lint", type: "script", port: null, lifecycle: "running" },
    ]),
    entry("ws-feature", "/repo/.paseo/worktrees/feature", [
      { scriptName: "web", type: "service", port: 3001, lifecycle: "running" },
    ]),
  ]);
  assert.deepEqual(Object.fromEntries(services), {
    3000: { name: "web", workspaceId: "ws-main" },
    3001: { name: "web", workspaceId: "ws-feature" },
  });
});

test("attributes each port to the workspace that runs it, and keeps the rest", () => {
  const port = (port: number, cwd: string | null, title: string | null = null, command: string | null = null) => ({
    port,
    host: "127.0.0.1",
    pid: cwd ? port : null,
    command,
    cwd,
    title,
  });
  // The listeners seen on a real host: system and desktop-tool web UIs next to two dev servers.
  const rows = attributePorts(
    [
      port(631, null, "Home - CUPS 2.4.16"),
      port(49374, "/home/me", "OpenCode"),
      port(3000, "/home/me/app", "My app"),
      port(5173, "/home/me/app/.paseo/worktrees/feature/web", null, "node /x/node_modules/.bin/vite"),
    ],
    [
      entry("app", "/home/me/app"),
      entry("feature", "/home/me/app/.paseo/worktrees/feature", [
        { scriptName: "web", type: "service", port: 5173, lifecycle: "running" },
      ]),
    ],
  );
  assert.deepEqual(
    rows.map(({ port, label, workspaceId }) => ({ port, label, workspaceId })),
    [
      { port: 631, label: "Home - CUPS 2.4.16", workspaceId: null },
      { port: 49374, label: "OpenCode", workspaceId: null },
      { port: 3000, label: "My app", workspaceId: "app" },
      { port: 5173, label: "web", workspaceId: "feature" },
    ],
  );
  // A card names the process behind a port, shortened the way the label is.
  assert.deepEqual(
    rows.map(({ command }) => command),
    [null, null, null, "vite"],
  );
});

test("groups pages by workspace identity and places unassigned services last", () => {
  const rows = [
    { port: 631, workspaceId: null },
    { port: 3000, workspaceId: "main" },
    { port: 4000, workspaceId: "feature" },
    { port: 5173, workspaceId: "main" },
    { port: 8080, workspaceId: null },
  ];
  assert.deepEqual(groupPortsByWorkspace(rows), [
    { workspaceId: "main", rows: [rows[1], rows[3]] },
    { workspaceId: "feature", rows: [rows[2]] },
    { workspaceId: null, rows: [rows[0], rows[4]] },
  ]);
  assert.deepEqual(groupPortsByWorkspace([]), []);
  assert.deepEqual(groupPortsByWorkspace([rows[0]]), [{ workspaceId: null, rows: [rows[0]] }]);
});

test("labels a workspace by project, adding the workspace when it differs", () => {
  assert.equal(workspaceLabel({ ...entry("main", "/a"), name: "app" }), "app");
  assert.equal(workspaceLabel({ ...entry("w", "/b"), name: "feature", title: "Fix login" }), "app · Fix login");
  assert.equal(workspaceLabel({ ...entry("w", "/b"), projectCustomName: "Shop" }), "Shop · w");
});

test("reads a port, a localhost address, or a URL from the address field", () => {
  assert.deepEqual(parseAddress("3000"), { port: 3000, path: "/" });
  assert.deepEqual(parseAddress(" localhost:4192/agent?view=architecture "), {
    port: 4192,
    path: "/agent?view=architecture",
  });
  assert.deepEqual(parseAddress("http://127.0.0.1:8765/upload.html"), { port: 8765, path: "/upload.html" });
  assert.deepEqual(parseAddress("[::1]:5173"), { port: 5173, path: "/" });
  assert.equal(parseAddress("example.com:80"), null);
  assert.equal(parseAddress("70000"), null);
  assert.equal(parseAddress(""), null);
});
