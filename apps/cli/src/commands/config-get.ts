import type { GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";
import { decodePointer } from "@spaceduck/config";

interface ConfigResponse {
  config: Record<string, unknown>;
  rev: string;
  secrets: { path: string; isSet: boolean }[];
}

export async function configGet(opts: GlobalOpts, args: string[]) {
  const { data } = await apiFetch<ConfigResponse>(opts, "/api/config");
  const [path] = args;

  if (!path) {
    if (opts.json) {
      console.log(JSON.stringify(data.config, null, 2));
    } else {
      console.log(JSON.stringify(data.config, null, 2));
      console.log(`\nrev: ${data.rev}`);
    }
    return;
  }

  if (!path.startsWith("/")) {
    console.error(`Path must start with /  (got: ${path})`);
    process.exit(1);
  }

  const segments = decodePointer(path);
  let current: unknown = data.config;

  for (const seg of segments) {
    if (current == null || typeof current !== "object") {
      console.error(`Path ${path} does not exist in config`);
      process.exit(1);
    }
    current = (current as Record<string, unknown>)[seg];
  }

  if (current === undefined) {
    console.error(`Path ${path} does not exist in config`);
    process.exit(1);
  }

  if (opts.json || typeof current === "object") {
    console.log(JSON.stringify(current, null, 2));
  } else {
    console.log(String(current));
  }
}
