SSH Ports opens web servers running on a remote SSH host in Paseo's built-in browser on your desktop. The page loads in your local browser through an SSH tunnel, so it is as fast as a local dev server, and hot reload, WebSockets, and DevTools work normally.

## How it works

Install the plugin on the Paseo daemon of the computer you sit at, the one Paseo Desktop starts for you, not on the remote host. Open **SSH Ports** in the sidebar. Hosts Paseo Desktop is connected to over SSH appear automatically; if there are none, enter an SSH host there instead. The plugin connects with your own `ssh` client and keys, lists the remote host's listening ports that serve web pages, and opens one when you click it. Each port shows its `paseo.json` service name, or else the page title or the command that started it.

Clicking a port starts `ssh -L` and opens `http://localhost:<port>` in a browser tab of the remote workspace that runs the service, or else the one containing the server's working directory. The local port matches the remote one when it is free, so cookies and OAuth callbacks keep working. Long-press opens the system browser instead. Enter a port number to forward one the list does not show.

## Setup

- The host must accept non-interactive `ssh <host>` from this computer: keys or an agent, and a known host key. If Paseo already connects to the host over SSH, this is satisfied. The SSH host field accepts the same forms as `ssh`, including aliases from `~/.ssh/config` and `ssh://user@host:port`.
- The remote host must run Linux with `ss`. With `curl` installed there, non-web ports are filtered out and page titles are shown; without it, every listening port except common system services is listed.
- Opening pages inside Paseo needs Paseo Desktop. Other clients open the system browser.

## What it reads and runs

While the screen is open, it runs one SSH command every 10 seconds that reads the remote listening sockets, the owning process's command line and working directory, and the Paseo server ID in `~/.paseo/server-id`. Each new listening process gets one `GET /` from the remote host itself to check that it serves HTML; one that has not answered yet is checked again on the next refresh. Forwards bind to localhost only and stop when you unplug them or when the plugin stops. To find your SSH hosts it reads the host list Paseo Desktop keeps in its own app storage and uses only each host's ID and SSH address. That storage is not a plugin API; if a Paseo update changes it, the screen asks for the SSH host instead. Hosts entered by hand are saved in this daemon's plugin settings.
