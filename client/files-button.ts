import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { FilesPopover } from "./files-panel";
import { messages } from "./messages";
import { readHostRegistry } from "./web";

// An icon in the header of every workspace on a host Paseo reaches over SSH. Hosts reached another
// way have no address to copy over, so they get the panel only.
export function startFilesButtons(client: PluginClientContext): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let stream: { release(): Promise<void> } | null = null;

  const register = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: "files",
        workspaceId,
        button: {
          title: messages.message("files"),
          icon: "ArrowLeftRight",
          behavior: { kind: "popover", Content: FilesPopover },
        },
      }),
    );
  };
  const removeAll = () => {
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };

  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      if (lifetime.signal.aborted || !readHostRegistry().ssh.some((item) => item.serverId === self.serverId)) return;
      return client.paseo.workspaces.list({ subscribe: {} }).then(({ subscription }) => {
        // The list call takes no abort signal, so a stream that arrives after cleanup is released here.
        if (lifetime.signal.aborted) return void subscription.release();
        stream = subscription;
        subscription.subscribe({
          snapshot: ({ entries }) => {
            removeAll();
            for (const workspace of entries) register(workspace.id);
          },
          update: (message) => {
            if (message.type !== "workspace_update") return;
            const update = message.payload;
            if (update.kind === "upsert") return register(update.workspace.id);
            buttons.get(update.id)?.remove();
            buttons.delete(update.id);
          },
        });
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[ssh-browser] Could not add the file transfer button", error);
    });

  return () => {
    lifetime.abort();
    void stream?.release();
    removeAll();
  };
}
