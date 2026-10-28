SSH Browser opens web servers running on a remote SSH host in Paseo's built-in browser on your desktop. The page loads in your local browser through an SSH tunnel, so it is as fast as a local dev server, and hot reload, WebSockets, and DevTools work normally.

## How it works

Install the plugin on two Paseo hosts: the one on the computer you sit at, which Paseo Desktop starts for you, and each remote SSH host. The copy on your computer runs `ssh` with your own keys and starts the tunnels. The copy on a remote host adds **SSH Browser** to the **+** menu of that host's workspaces.

Agents also receive an `open_remote_url` tool. After starting a remote web server, the agent can call it to establish a tunnel silently, then use Paseo browser tools to open the returned local URL in a background tab and inspect the page. Use this flow with only one Desktop browser host connected to the remote daemon: Paseo selects the most recently connected browser host, which must be the desktop that created the tunnel.

- **In a workspace**, choose **+ → SSH Browser**. It lists the web servers of that workspace, a running `paseo.json` service or a process working inside the workspace directory, and opens the page in a browser tab of the workspace. When the workspace has exactly one, it opens on its own. The address field takes a port or a localhost address with a path. Expand **Other listening ports** to open a port that was not identified as a web page, using HTTP or HTTPS.
- **In the sidebar**, **SSH Browser** shows every web page on each SSH host as a card, pages of workspaces first. Select a card to open it, or use its browser action to open it in the system browser. Forwarded cards show their local address and an action to stop forwarding.

Cards show remote and local ports, and offer reconnect if an SSH forward exits unexpectedly. A connection failure reported by SSH is shown as the last failed connection; it does not establish whether the page subsequently loaded. When a listening process carries a recognized Paseo Agent ID, its Agent name and stopped state are shown. Each workspace keeps its five most recently opened remote addresses, including paths, queries and fragments, with a clear action.

Clicking a page starts `ssh -L` and opens `http://localhost:<port>`. The local port matches the remote one when it is free, so cookies and OAuth callbacks keep working. An unplug button stops a forward.

## File transfer

Move files between your computer and the SSH host a workspace runs on, without involving the agent, so nothing is added to its context.

- **Send:** open **File transfer** from the workspace header, **+** menu, Explorer or Command Center, switch to **Send to <host>**, check the host directory at the top, add files from your computer and select **Send**. The directory defaults to the workspace and is remembered per workspace. File rows stay in place as progress arrives and keep their completion state; adding files sends only the new ones.
- **Receive:** the **Download to this computer** tab lists files changed in the workspace during the last six hours, newest first. Click a file to receive it. Search filters the list; an explicit path starting with `/`, `~/`, `./` or `../` can be received with Enter. An unmatched plain search does not start a transfer.
- Received files go to `<receive folder>/<workspace name>/`. The receive folder defaults to `~/Downloads/Paseo` and can be changed in the panel.
- File rows offer progress, cancellation, retry and, once done, copying the host path or showing a downloaded file in your file manager.

A file is never overwritten: if the name exists, the new file is saved as `name (1).ext`. Data is written to a hidden temporary file and moved into place only when the whole file has arrived with the expected size, so a cancelled or interrupted transfer leaves nothing behind. Transfers run through your own `ssh` as `cat` over the existing connection, up to three at a time. Folders, drag and drop, and resuming are not supported. Choosing files and showing them in a folder need Paseo Desktop, which exposes those through its own app, not a plugin API.

## Setup

- Both Paseo Desktop and the daemons require **0.14.0-beta.1 or later**. Install the same SSH Browser version on both hosts, reload both copies, then let the agent session reopen before its next prompt.

- Hosts Paseo Desktop is connected to over SSH appear automatically. The host must accept non-interactive `ssh <host>` from your computer, which is already the case when Paseo connects to it over SSH.
- A host Paseo reaches another way, such as the relay, works when your computer can still `ssh` to it, for example over Tailscale or the local network. Add its SSH address once on the sidebar screen; the plugin recognizes which Paseo host it is and its workspaces' **+** menu works too. A host your computer cannot reach over SSH at all is not supported.
- The remote host must run Linux with `ss`. With `curl` installed there, non-web ports are filtered out and page titles are shown.
- Opening pages inside Paseo needs Paseo Desktop. Other clients open the system browser.

Agent previews accept HTTP/HTTPS URLs on `localhost`, `127.0.0.1`, and `[::1]`, preserving paths, query parameters, fragments, and protocol. HTTPS certificates must be trusted by the desktop browser. With no eligible Desktop or more than one, the tool returns an error rather than choosing a computer. Keep only the intended desktop/window connected to that remote host for agent previews.

The workspace address field also accepts HTTPS URLs. Manual and agent previews use `127.0.0.1` locally, so the certificate must be valid for that address as well as trusted by the desktop browser.

## What it reads and runs

While a surface is open, the copy on your computer runs one SSH command every 10 seconds that reads the remote listening sockets, the owning process's command line and working directory, its `PASEO_AGENT_ID` environment variable, and the Paseo server ID in `~/.paseo/server-id`. Each new listening process receives an HTTP `GET /` from the remote host; if it fails, HTTPS is also tried without verifying its certificate to identify the service. A listener that has not answered yet is checked again on the next refresh. Forwards bind to localhost only and stop when you unplug them or when the plugin stops. Recent addresses are stored in the local Paseo host's plugin settings and can contain sensitive query parameters; clear them from the workspace panel when no longer needed.

The desktop entry also waits for agent preview requests over plugin RPC, even with no panel open. For each request it verifies the SSH destination's Paseo ID and establishes or reuses a forward. An occupied local port is replaced with an available one. Agent preview URLs use the IPv4 loopback address bound by SSH, and the tool waits for SSH to confirm setup before navigating. Cancellation and timeout discard pending navigation without closing tunnels another preview may use.

To find your SSH hosts and the host on your computer, the plugin reads the host list Paseo Desktop keeps in its own app storage and uses only each host's ID and address. The copies of the plugin reach each other through a shared value in the app. Neither is a plugin API; if a Paseo update changes them, the workspace menu entry reports that it is unavailable and the sidebar screen asks for an SSH host.
