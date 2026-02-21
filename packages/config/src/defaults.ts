import { SpaceduckConfigSchema } from "./schema";
import type { SpaceduckProductConfig } from "./types";

export function defaultConfig(): SpaceduckProductConfig {
  return SpaceduckConfigSchema.parse({});
}
