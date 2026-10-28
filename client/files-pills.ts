import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { FilesPopover } from "./files-panel";
import { messages } from "./messages";
import { readHostRegistry } from "./web";

// A "Files" pill in every agent's composer on a host Paseo reaches over SSH. Hosts reached another
// way have no address to copy over, so they get the panel only.
export function startFilesPills(client: PluginClientContext): () => void {
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const lifetime = new AbortController();

  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    // Agents update constantly while they run; replacing the pill would close a popover being used.
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    existing?.pill.remove();
    pills.set(agent.id, {
      workspaceId: agent.workspaceId,
      pill: client.addComposerPill({
        id: "files",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: messages.message("files"),
          icon: "ArrowLeftRight",
          label: messages.message("filesPill"),
          behavior: { kind: "popover", Content: FilesPopover },
        },
      }),
    });
  };
  const removeAll = () => {
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
  };

  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      if (lifetime.signal.aborted || !readHostRegistry().ssh.some((item) => item.serverId === self.serverId)) return;
      return client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            removeAll();
            for (const { agent } of entries) register(agent);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "upsert") return register(update.agent);
            pills.get(update.agentId)?.pill.remove();
            pills.delete(update.agentId);
          },
        });
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[ssh-browser] Could not add the Files pill", error);
    });

  return () => {
    lifetime.abort();
    removeAll();
  };
}
