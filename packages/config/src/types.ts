import type { z } from "zod";
import type { SpaceduckConfigSchema } from "./schema";

export type SpaceduckProductConfig = z.infer<typeof SpaceduckConfigSchema>;

export type ConfigPatchOp = {
  op: "replace" | "add";
  path: string;
  value: unknown;
};
