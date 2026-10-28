# File transfer

Move files between the computer you sit at (desktop) and the SSH host a workspace runs on, without
the agent and without adding anything to its context.

## Principles

- The destination follows the workspace. Sending defaults to the workspace directory, receiving to
  `<receive folder>/<workspace name>/`.
- The desktop always starts the transfer. The remote cannot reach back, so both directions run
  `ssh` from the desktop's own copy of the plugin, over the SSH destination it already uses.
- Nothing is configured to start. The receive folder defaults to `~/Downloads/Paseo`.
- A transfer is done only when the file is complete and its size matches.
- No agent tool in v1. A tool adds its description to every session's context, which is the cost this
  feature exists to avoid.

## Entry points

Paseo has no extension point for file context menus, so the plugin uses what exists:

- **Header icon**: an icon-only button in the workspace header, with no label. Its popover lists
  files recently changed in the workspace, so a file an agent just wrote is two clicks from the
  desktop. It belongs to the workspace, not an agent, so it also works before an agent exists. A
  composer pill was tried and dropped: Paseo pills always carry a text label, which is too heavy for
  something used occasionally.
- **Command Center (⌘K)**: "File transfer" opens the panel, with nothing on screen until asked for.
- **Files panel** (Explorer and workspace tab): the same list plus choosing desktop files to send, a
  search field that also takes a remote path to receive, the receive folder, and transfers in progress.

## User stories

1. I pick several desktop files, choose or accept a remote folder, press Send, and they arrive there.
2. I see progress per file, can cancel or retry one, and when it finishes see where it went (copy the remote path, or show the file in its folder).
3. The remote folder defaults to the workspace and remembers my last choice per workspace.
4. After an agent writes a file, I open the header icon and click it: one click starts the receive, and the row shows it running, then saved.
5. I type in the search field to filter the list, or a remote path (absolute, `~`, or relative to the workspace) and press Enter to receive that file. Enter takes the first row.
6. A finished receive offers "Show in folder"; a finished send offers "Copy path".
7. A file that already exists at the destination is never overwritten; the new one is saved as
   `name (1).ext`.
8. A cancelled or failed transfer leaves no partial file behind.

## Behaviour

| Topic | Decision |
| --- | --- |
| Transfer list | Newest three of this session on top, plus anything still running; a failed or cancelled one can be retried. Transfers that were already finished when the view opened are not listed (they carry no time), but their file rows still show a check. |
| Receive click | One click receives, no selection step: a receive never overwrites, so a stray click costs nothing. A file already running is not started twice. |
| Recent files | Regular files changed in the last 6 hours under the workspace directory, newest first, at most 30. `node_modules`, `.git` and similar are skipped; symlinks are not followed. |
| Name conflicts | Never overwrite. The destination is filled through a hard link (`ln`), which fails if the name exists, then the next `name (N)` is tried. |
| Partial files | Data goes to a hidden temporary file in the destination folder and is linked into place only after the stream ends cleanly. |
| Integrity | A receive compares the bytes written with the size the remote reported. |
| Concurrency | Up to three transfers at once; the rest wait. |
| Receive path outside the folder | Not possible: the receive folder is chosen by the user, the agent has no say. |

## Not in v1

Folders, drag and drop, resumable transfers, `rsync`, an agent tool, more than one SSH host picker,
a remote folder browser, and desktop notifications.
