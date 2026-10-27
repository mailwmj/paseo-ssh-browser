# SSH Browser for Paseo

Open web servers running on a remote SSH host in Paseo's built-in browser on your desktop, through an SSH tunnel. Pages render in your local browser, so hot reload, WebSockets, and DevTools work as they do locally.

Install it on two hosts in **Settings → Plugins**: the Paseo host on the computer you sit at, which starts the tunnels, and each remote SSH host, which adds **SSH Browser** to its workspaces' **+** menu.

```
git:mailwmj/paseo-ssh-browser
```

See [OVERVIEW.md](OVERVIEW.md) for requirements and what the plugin reads and runs.

## Agent previews (Paseo 0.14 beta)

Use Paseo **0.14.0-beta.1 or later on both the daemon and Desktop**, and install the same SSH Browser version on the desktop's own daemon and the remote daemon. Reload both copies after an update. An existing agent receives `open_remote_url` when its session next opens, before its next idle prompt.

The agent calls `open_remote_url({"url":"http://localhost:3000/dashboard?tab=home#details"})` after starting the remote development server. The desktop establishes an SSH forward and automatically opens and focuses a browser tab in that agent's remote workspace. No manual panel action is needed. The beta navigation API requires a panel, so an additional **SSH Browser** tab remains available beside the browser.

The tool returns `localUrl`, the actual `localPort`, `workspaceId`, `serverId`, and `status: "navigation_requested"`. The agent must then use `browser_list_tabs` to match `localUrl` and inspect that tab with `browser_snapshot` or `browser_wait`. Navigation being requested does not establish that the page loaded. Do not use `browser_new_tab` with the remote localhost URL.

HTTP and HTTPS loopback URLs (`localhost`, `127.0.0.1`, `[::1]`) are supported, including paths, queries, and fragments. HTTPS stays HTTPS and uses the browser's normal certificate checks. `localhost` on the remote host is forwarded to `127.0.0.1`; use `[::1]` for an IPv6-only service. URLs containing credentials and non-loopback destinations are rejected.

The tool selects the single connected Desktop with a matching SSH destination and a compatible local plugin bridge. No eligible desktop, multiple eligible desktops/windows, a mismatched destination, SSH failure, cancellation, and timeout return errors. With multiple eligible desktops, keep only the intended one connected to the remote host. The plugin does not infer which computer sent the prompt. Requests expire after 60 seconds; pending navigation is discarded after cancellation, disconnection, or plugin cleanup. A tunnel already started can remain available for other previews; request cleanup does not close shared tunnels.

Agent instructions for remote web development:

> After starting or updating a remote web app for preview, proactively call `open_remote_url` with the desired full URL. Printing a URL does not open it. Then find the returned local URL using `browser_list_tabs` and verify the page with the Paseo browser tools. Report tunnel/navigation errors; do not fall back to opening the same local port directly.

The instruction is also included in the tool description. Registration and instructions alone do not prove that a model will call it: verify a normal development prompt on the installed Desktop before treating the workflow as accepted. The plugin does not watch chat output or automatically open every printed URL.

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm test` includes an end-to-end test through the real `ssh` binary that runs when `ssh localhost` works without a prompt.
