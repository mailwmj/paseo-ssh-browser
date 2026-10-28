# SSH Browser for Paseo

Open web servers running on a remote SSH host in Paseo's built-in browser on your desktop, through an SSH tunnel. Pages render in your local browser, so hot reload, WebSockets, and DevTools work as they do locally.

Install it on two hosts in **Settings → Plugins**: the Paseo host on the computer you sit at, which starts the tunnels, and each remote SSH host, which adds **SSH Browser** to its workspaces' **+** menu.

```
git:mailwmj/paseo-ssh-browser
```

See [OVERVIEW.md](OVERVIEW.md) for requirements and what the plugin reads and runs.

## File transfer

Send files from your computer to the host a workspace runs on, and receive files the agent wrote, from the icon in the workspace header, **⌘K → File transfer**, or **+ → File transfer**. Nothing goes through the agent, so its context is untouched. See [docs/file-transfer.md](docs/file-transfer.md).

## Agent previews (Paseo 0.14 beta)

Use Paseo **0.14.0-beta.1 or later on both the daemon and Desktop**, and install the same SSH Browser version on the desktop's own daemon and the remote daemon. Reload both copies after an update. An existing agent receives `open_remote_url` when its session next opens, before its next idle prompt.

The agent calls `open_remote_url({"url":"http://localhost:3000/dashboard?tab=home#details"})` after starting the remote development server. The desktop silently establishes an SSH forward. The tool returns `localUrl`, the actual `localPort`, `workspaceId`, `serverId`, and `status: "tunnel_ready"`. The agent must call `browser_new_tab` with `localUrl`, then inspect the returned browser ID with `browser_snapshot` or `browser_wait`. The tab opens in the background; the tool itself does not open or verify the page.

Use this flow with only one Paseo Desktop browser host connected to the remote daemon. `browser_new_tab` selects the most recently connected browser host, which must be the desktop where the tunnel was created. Never pass the original remote localhost URL to it.

HTTP and HTTPS loopback URLs (`localhost`, `127.0.0.1`, `[::1]`) are supported, including paths, queries, and fragments. HTTPS stays HTTPS and uses the browser's normal certificate checks. `localhost` on the remote host is forwarded to `127.0.0.1`; use `[::1]` for an IPv6-only service. URLs containing credentials and non-loopback destinations are rejected.

The workspace panel's address field also accepts HTTP and HTTPS loopback URLs. Both manual and agent previews open the forwarded address at `127.0.0.1`, so an HTTPS certificate must be trusted by the desktop browser and valid for that address; a certificate valid only for `localhost` can show a certificate error.

The tool selects the single connected Desktop with a matching SSH destination and a compatible local plugin bridge. No eligible desktop, multiple eligible desktops/windows, a mismatched destination, SSH failure, cancellation, and timeout return errors. With multiple eligible desktops, keep only the intended one connected to the remote host. The plugin does not infer which computer sent the prompt. Requests expire after 60 seconds; pending navigation is discarded after cancellation, disconnection, or plugin cleanup. A tunnel already started can remain available for other previews; request cleanup does not close shared tunnels.

Agent instructions for remote web development:

> After starting or updating a remote web app for preview, proactively call `open_remote_url` with the desired full URL. Printing a URL does not open it. Then call `browser_new_tab` with the returned local URL and verify the page using its browser ID. Report tunnel or browser errors; do not fall back to opening the same local port directly.

The instruction is also included in the tool description. Registration and instructions alone do not prove that a model will call it: verify a normal development prompt on the installed Desktop before treating the workflow as accepted. The plugin does not watch chat output or automatically open every printed URL.

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm test` includes an end-to-end test through the real `ssh` binary that runs when `ssh localhost` works without a prompt.
