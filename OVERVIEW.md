SSH Browser lets you preview web apps running on an SSH host in Paseo Desktop and transfer files between the host and your computer. It creates local SSH forwards using your existing SSH configuration; transfers also use SSH and do not go through the agent.

## Setup

Paseo Desktop and both daemons need version 0.14.0-beta.1 or later. Use the same plugin version on your computer's Paseo host and on each remote host. The remote host must run Linux with `ss`; `curl` is used to identify web pages and their titles. Your computer must be able to run `ssh <host>` without an interactive prompt. Hosts connected through a relay can be added by SSH address in the sidebar.

## Preview and transfer

In a remote workspace, choose **+ → SSH Browser** to open a detected service or enter a port or localhost URL. The sidebar lists services across hosts and lets you open, reconnect or stop forwards. HTTPS certificates must be trusted and valid for `127.0.0.1`, the local preview address.

Agents can use `open_remote_url` to establish a tunnel, then use Paseo browser tools to open and inspect its returned local URL. Keep only one Desktop browser host connected to the remote daemon for this workflow. The tool does not open or verify the page itself.

Open **File transfer** from the workspace header, **+** menu, Explorer or Command Center. Hide these entries per host using **Settings → Plugins → SSH Browser**; ongoing transfers continue. Send files to a host folder or download recently changed files and explicit paths. Downloads default to `~/Downloads/Paseo/<workspace name>/`. Existing files are not overwritten; transfers can be cancelled or retried. Folder transfers and resuming are not supported. Local file selection and the built-in browser require Paseo Desktop.

## Data access and limits

While a plugin surface is open, the local plugin scans remote listening sockets and process information every 10 seconds. It sends HTTP requests to listeners and tries HTTPS without certificate verification when needed to identify services. SSH forwards bind to local loopback. Recent addresses are stored in local plugin settings and may contain sensitive query parameters; they can be cleared in the workspace panel.

The plugin reads Paseo Desktop's host list and uses app internals to connect the two plugin copies. These are not public plugin APIs and may change in a future Paseo release.
