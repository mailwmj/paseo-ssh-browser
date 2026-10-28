import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberPage } from "../client/recent";
import type { LocalApi, RecentPage } from "../client/bridge";

test("keeps five recent full URLs per workspace, newest first, without mixing workspaces", async () => {
  let pages: RecentPage[] = [{ serverId: "host", workspaceId: "other", url: "http://localhost:4000/" }];
  const api = { updateRecent: async (change: (pages: RecentPage[]) => RecentPage[]) => { pages = change(pages); } } as LocalApi;
  for (let i = 0; i < 6; i++) await rememberPage(api, { serverId: "host", workspaceId: "workspace", url: `https://localhost:3000/${i}?a=1#b` });
  await rememberPage(api, { serverId: "host", workspaceId: "workspace", url: "https://localhost:3000/2?a=1#b" });
  assert.equal(pages.filter((page) => page.workspaceId === "workspace").length, 5);
  assert.equal(pages[0].url, "https://localhost:3000/2?a=1#b");
  assert.ok(pages.some((page) => page.workspaceId === "other"));
  assert.ok(!pages.some((page) => page.url === "https://localhost:3000/0?a=1#b"));
});
