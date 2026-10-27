# SSH Ports for Paseo

Open web servers running on a remote SSH host in Paseo's built-in browser on your desktop, through an SSH tunnel. Pages render in your local browser, so hot reload, WebSockets, and DevTools work as they do locally.

Install it on the Paseo daemon of the computer you sit at, not on the remote host. In Paseo, open **Settings → Plugins** for your local host and install:

```
git:mailwmj/paseo-ssh-ports
```

Then open **SSH Ports** in the sidebar. See [OVERVIEW.md](OVERVIEW.md) for requirements and what the plugin reads and runs.

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm test` includes an end-to-end test through the real `ssh` binary that runs when `ssh localhost` works without a prompt.
