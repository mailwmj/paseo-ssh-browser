import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const visibilitySettings = defineSettings({
  id: "visibility",
  scope: "host",
  version: 1,
  schema: z.object({ fileTransfer: z.boolean().default(true) }),
});
