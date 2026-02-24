import { CliError, type GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";
import { ensureCompatible } from "../lib/compat";

interface ConfigResponse {
  config: Record<string, unknown>;
  rev: string;
}

interface PatchResponse {
  config: Record<string, unknown>;
  rev: string;
  needsRestart?: { fields: string[] };
}

export async function configSet(opts: GlobalOpts, args: string[]) {
  if (args.length < 2) {
    console.error("Usage: spaceduck config set <path> <value>");
    console.error("Example: spaceduck config set /ai/model us.amazon.nova-2-pro-v1:0");
    process.exit(1);
  }

  await ensureCompatible(opts);

  const [path, rawValue] = args;

  if (!path.startsWith("/")) {
    throw new CliError(`Path must start with /  (got: ${path})`);
  }

  let value: unknown = rawValue;
  if (rawValue === "true") value = true;
  else if (rawValue === "false") value = false;
  else if (rawValue === "null") value = null;
  else if (/^-?\d+(\.\d+)?$/.test(rawValue) && !isNaN(Number(rawValue))) {
    value = Number(rawValue);
  }

  // Fetch current rev for If-Match
  const { data: current } = await apiFetch<ConfigResponse>(opts, "/api/config");

  const { data } = await apiFetch<PatchResponse>(opts, "/api/config", {
    method: "PATCH",
    headers: { "if-match": current.rev },
    body: JSON.stringify([{ op: "replace", path, value }]),
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, rev: data.rev, needsRestart: data.needsRestart ?? null }));
  } else {
    console.log(`✓ Set ${path} = ${JSON.stringify(value)}`);
    if (data.needsRestart?.fields.length) {
      console.log(`  ⚠ Restart required for: ${data.needsRestart.fields.join(", ")}`);
    }
  }
}
