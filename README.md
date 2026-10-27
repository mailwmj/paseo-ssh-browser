# SSH Browser for Paseo

Open web servers running on a remote SSH host in Paseo's built-in browser on your desktop, through an SSH tunnel. Pages render in your local browser, so hot reload, WebSockets, and DevTools work as they do locally.

Install it on two hosts in **Settings → Plugins**: the Paseo host on the computer you sit at, which starts the tunnels, and each remote SSH host, which adds **SSH Browser** to its workspaces' **+** menu.

```
git:mailwmj/paseo-ssh-browser
```

See [OVERVIEW.md](OVERVIEW.md) for requirements and what the plugin reads and runs.

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm test` includes an end-to-end test through the real `ssh` binary that runs when `ssh localhost` works without a prompt.
