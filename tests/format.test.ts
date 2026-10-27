import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickWorkspace,
  servicesByPort,
  shortCommand,
  sshHostsFromRegistry,
  workspacePorts,
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

test("reuses the SSH hosts Paseo Desktop is configured with", () => {
  const registry = JSON.stringify([
    {
      serverId: "srv_local",
      label: "MacBook",
      connections: [{ id: "c1", type: "directSocket", path: "/tmp/paseo.sock" }],
      preferredConnectionId: "c1",
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
    { serverId: "srv_bad", connections: [{ id: "x", type: "remoteSsh", host: "-oProxyCommand=sh" }] },
  ]);
  assert.deepEqual(sshHostsFromRegistry(registry), [
    { serverId: "srv_devbox", target: "devbox" },
    { serverId: "srv_port", target: "ssh://me@build:2222" },
  ]);
});

test("an unreadable host list yields no hosts instead of failing", () => {
  assert.deepEqual(sshHostsFromRegistry(null), []);
  assert.deepEqual(sshHostsFromRegistry("not json"), []);
  assert.deepEqual(sshHostsFromRegistry('{"hosts": []}'), []);
  assert.deepEqual(sshHostsFromRegistry('[null, {"serverId": 1}, {"serverId": "s"}]'), []);
});

test("names a port after the running paseo.json service that owns it", () => {
  const services = servicesByPort([
    {
      id: "ws-main",
      projectRootPath: "/repo",
      scripts: [
        { scriptName: "web", type: "service", port: 3000, lifecycle: "running" },
        { scriptName: "api", type: "service", port: 4000, lifecycle: "stopped" },
        { scriptName: "lint", type: "script", port: null, lifecycle: "running" },
      ],
    },
    {
      id: "ws-feature",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo/.paseo/worktrees/feature",
      scripts: [{ scriptName: "web", type: "service", port: 3001, lifecycle: "running" }],
    },
    { id: "ws-empty", projectRootPath: "/other" },
  ]);
  assert.deepEqual(Object.fromEntries(services), {
    3000: { name: "web", workspaceId: "ws-main" },
    3001: { name: "web", workspaceId: "ws-feature" },
  });
});

test("lists only ports that belong to a workspace", () => {
  const port = (port: number, cwd: string | null, title: string | null = null, command: string | null = null) => ({
    port,
    host: "127.0.0.1",
    pid: cwd ? port : null,
    command,
    cwd,
    title,
  });
  // The listeners seen on a real host: system and desktop-tool web UIs next to two dev servers.
  const ports = [
    port(631, null, "Home - CUPS 2.4.16"),
    port(36891, "/home/me", null, "chrome --remote-debugging-port=0"),
    port(49374, "/home/me", "OpenCode"),
    port(56469, "/home/me/.hermes", "Hermes Agent - Dashboard"),
    port(59227, null),
    port(3000, "/home/me/app", "My app"),
    port(5173, "/home/me/app/.paseo/worktrees/feature/web", null, "node /x/node_modules/.bin/vite"),
  ];
  const entries = [
    { id: "app", projectRootPath: "/home/me/app", scripts: [] },
    {
      id: "feature",
      projectRootPath: "/home/me/app",
      workspaceDirectory: "/home/me/app/.paseo/worktrees/feature",
      scripts: [{ scriptName: "web", type: "service", port: 5173, lifecycle: "running" }],
    },
  ];
  assert.deepEqual(workspacePorts(ports, entries), [
    { port: 3000, host: "127.0.0.1", cwd: "/home/me/app", label: "My app", workspaceId: "app" },
    {
      port: 5173,
      host: "127.0.0.1",
      cwd: "/home/me/app/.paseo/worktrees/feature/web",
      label: "web",
      workspaceId: "feature",
    },
  ]);
  // Without the workspace list nothing can be attributed, so nothing is hidden.
  assert.equal(workspacePorts(ports, undefined).length, ports.length);
});
