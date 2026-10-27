SSH Browser opens web servers running on a remote SSH host in Paseo's built-in browser on your desktop. The page loads in your local browser through an SSH tunnel, so it is as fast as a local dev server, and hot reload, WebSockets, and DevTools work normally.

## How it works

Install the plugin on two Paseo hosts: the one on the computer you sit at, which Paseo Desktop starts for you, and each remote SSH host. The copy on your computer runs `ssh` with your own keys and starts the tunnels. The copy on a remote host adds **SSH Browser** to the **+** menu of that host's workspaces.

- **In a workspace**, choose **+ → SSH Browser**. It lists the web servers of that workspace, a running `paseo.json` service or a process working inside the workspace directory, and opens the page in a browser tab of the workspace. When the workspace has exactly one, it opens on its own. The address field takes a port or a localhost address with a path.
- **In the sidebar**, **SSH Browser** shows every web page on each SSH host as a card, pages of workspaces first. Click a card to open it; long-press opens the system browser.

Clicking a page starts `ssh -L` and opens `http://localhost:<port>`. The local port matches the remote one when it is free, so cookies and OAuth callbacks keep working. An unplug button stops a forward.

## Setup

- Hosts Paseo Desktop is connected to over SSH appear automatically. The host must accept non-interactive `ssh <host>` from your computer, which is already the case when Paseo connects to it over SSH.
- A host Paseo reaches another way, such as the relay, works when your computer can still `ssh` to it, for example over Tailscale or the local network. Add its SSH address once on the sidebar screen; the plugin recognizes which Paseo host it is and its workspaces' **+** menu works too. A host your computer cannot reach over SSH at all is not supported.
- The remote host must run Linux with `ss`. With `curl` installed there, non-web ports are filtered out and page titles are shown.
- Opening pages inside Paseo needs Paseo Desktop. Other clients open the system browser.

## What it reads and runs

While a surface is open, the copy on your computer runs one SSH command every 10 seconds that reads the remote listening sockets, the owning process's command line and working directory, and the Paseo server ID in `~/.paseo/server-id`. Each new listening process gets one `GET /` from the remote host itself to check that it serves HTML; one that has not answered yet is checked again on the next refresh. Forwards bind to localhost only and stop when you unplug them or when the plugin stops.

To find your SSH hosts and the host on your computer, the plugin reads the host list Paseo Desktop keeps in its own app storage and uses only each host's ID and address. The copies of the plugin reach each other through a shared value in the app. Neither is a plugin API; if a Paseo update changes them, the workspace menu entry reports that it is unavailable and the sidebar screen asks for an SSH host.
