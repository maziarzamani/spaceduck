import { CliError, type GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";

export async function configSecret(opts: GlobalOpts, args: string[]) {
  const [action, path] = args;

  if (!action || !path) {
    console.error("Usage:");
    console.error("  spaceduck config secret set <path>    Set a secret (reads value from stdin)");
    console.error("  spaceduck config secret unset <path>  Remove a secret");
    console.error("");
    console.error("Example:");
    console.error("  echo 'sk-abc123' | spaceduck config secret set /ai/secrets/geminiApiKey");
    console.error("  spaceduck config secret set /ai/secrets/bedrockApiKey  (prompts for input)");
    process.exit(1);
  }

  if (!path.startsWith("/")) {
    throw new CliError(`Path must start with /  (got: ${path})`);
  }

  if (action === "set") {
    const value = await readSecretValue();
    if (!value) {
      throw new CliError("No value provided. Pipe a value or type it at the prompt.");
    }

    await apiFetch<{ ok: boolean }>(opts, "/api/config/secrets", {
      method: "POST",
      body: JSON.stringify({ op: "set", path, value }),
    });

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, path }));
    } else {
      console.log(`✓ Secret ${path} set`);
    }
  } else if (action === "unset") {
    await apiFetch<{ ok: boolean }>(opts, "/api/config/secrets", {
      method: "POST",
      body: JSON.stringify({ op: "unset", path }),
    });

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, path }));
    } else {
      console.log(`✓ Secret ${path} removed`);
    }
  } else {
    throw new CliError(`Unknown secret action: ${action}. Use "set" or "unset".`);
  }
}

async function readSecretValue(): Promise<string> {
  const stdin = Bun.stdin;

  // If stdin is piped, read all of it
  if (!stdin.stream().locked) {
    const text = await new Response(stdin.stream()).text();
    return text.trim();
  }

  return "";
}
