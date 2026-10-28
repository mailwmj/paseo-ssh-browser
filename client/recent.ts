import type { LocalApi, RecentPage } from "./bridge";

export function rememberPage(api: LocalApi, page: RecentPage): Promise<void> {
  return api.updateRecent((pages) => [page, ...pages.filter((item) =>
    item.serverId !== page.serverId || item.workspaceId !== page.workspaceId || item.url !== page.url,
  )].filter((item, index, all) => all.filter((other) => other.serverId === item.serverId && other.workspaceId === item.workspaceId).indexOf(item) < 5));
}
