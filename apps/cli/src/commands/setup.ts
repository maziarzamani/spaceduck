import type { GlobalOpts } from "../index";
import { CliError } from "../index";
import { apiFetch } from "../lib/api";
import { ensureCompatible } from "../lib/compat";
import {
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  LOCAL_PRESET_URLS,
  CLOUD_DEFAULT_MODELS,
  SECRET_LABELS,
  buildLocalPatch,
  buildCloudPatch,
  buildAdvancedPatch,
  buildOnboardingCompletePatch,
  buildOnboardingSkipPatch,
  ONBOARDING_VERSION,
  type SetupMode,
} from "@spaceduck/config";

interface SetupFlags {
  mode?: string;
  skip?: boolean;
}

export function parseSetupFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode" && i + 1 < args.length) {
      flags.mode = args[++i];
    } else if (arg === "--skip") {
      flags.skip = true;
    }
  }
  return flags;
}

export async function setup(opts: GlobalOpts, args: string[]) {
  const flags = parseSetupFlags(args);

  await ensureCompatible(opts);

  if (flags.skip) {
    await applyPatches(opts, buildOnboardingSkipPatch());
    if (opts.json) {
      console.log(JSON.stringify({ status: "skipped" }));
    } else {
      console.log("Setup skipped. You can run `spaceduck setup` anytime.");
    }
    return;
  }

  const mode = flags.mode as SetupMode | undefined;
  if (mode && !["local", "cloud", "advanced"].includes(mode)) {
    throw new CliError(`Invalid mode: ${mode}. Use: local, cloud, advanced`);
  }

  const selectedMode = mode ?? await promptMode();

  switch (selectedMode) {
    case "local":
      await setupLocal(opts);
      break;
    case "cloud":
      await setupCloud(opts);
      break;
    case "advanced":
      await setupAdvanced(opts);
      break;
  }
}

async function promptMode(): Promise<SetupMode> {
  console.log("\nHow would you like your AI to run?\n");
  console.log("  1. Local     — Private. Runs on your computer.");
  console.log("  2. Cloud     — Best quality. Uses an API key.");
  console.log("  3. Advanced  — Full control over models, memory, and providers.");
  console.log("");

  const answer = await prompt("Choose [1/2/3]: ");
  switch (answer?.trim()) {
    case "1": case "local": return "local";
    case "2": case "cloud": return "cloud";
    case "3": case "advanced": return "advanced";
    default:
      throw new CliError("Invalid choice. Run `spaceduck setup` to try again.");
  }
}

async function setupLocal(opts: GlobalOpts) {
  console.log("\n── Local Setup ──\n");

  console.log("Available runtimes:");
  LOCAL_PROVIDERS.forEach((p, i) => {
    const tag = p.recommended ? " (recommended)" : "";
    const hint = p.hint ? ` — ${p.hint}` : "";
    console.log(`  ${i + 1}. ${p.label}${hint}${tag}`);
  });
  console.log("");

  const choice = await prompt("Choose runtime [1]: ");
  const idx = Math.max(0, parseInt(choice?.trim() || "1", 10) - 1);
  const provider = LOCAL_PROVIDERS[Math.min(idx, LOCAL_PROVIDERS.length - 1)];

  const preset = LOCAL_PRESET_URLS[provider.id] ?? "";
  const urlAnswer = await prompt(`Server URL [${preset}]: `);
  const baseUrl = urlAnswer?.trim() || preset;

  console.log(`\n  Provider: ${provider.label}`);
  console.log(`  URL:      ${baseUrl}\n`);

  const ops = [
    ...buildLocalPatch(provider.id, baseUrl),
    ...buildOnboardingCompletePatch("local", ONBOARDING_VERSION),
  ];
  await applyPatches(opts, ops);

  if (opts.json) {
    console.log(JSON.stringify({ status: "complete", mode: "local", provider: provider.id, baseUrl }));
  } else {
    console.log("Setup complete. Start chatting!");
  }
}

async function setupCloud(opts: GlobalOpts) {
  console.log("\n── Cloud Setup ──\n");

  console.log("Available providers:");
  CLOUD_PROVIDERS.forEach((p, i) => {
    const tag = p.recommended ? " (recommended)" : "";
    console.log(`  ${i + 1}. ${p.label}${tag}`);
  });
  console.log("");

  const choice = await prompt("Choose provider [1]: ");
  const idx = Math.max(0, parseInt(choice?.trim() || "1", 10) - 1);
  const provider = CLOUD_PROVIDERS[Math.min(idx, CLOUD_PROVIDERS.length - 1)];

  const secretInfo = SECRET_LABELS[provider.id];
  if (secretInfo) {
    const key = await prompt(`${secretInfo.label}: `);
    if (key?.trim()) {
      await apiFetch(opts, "/api/config/secrets", {
        method: "POST",
        body: JSON.stringify({ op: "set", path: secretInfo.path, value: key.trim() }),
      });
      console.log("  Key saved.");
    }
  }

  const defaultModel = CLOUD_DEFAULT_MODELS[provider.id] ?? "";
  const modelAnswer = await prompt(`Model [${defaultModel}]: `);
  const model = modelAnswer?.trim() || defaultModel;

  let region: string | undefined;
  if (provider.id === "bedrock") {
    const regionAnswer = await prompt("AWS Region [us-east-1]: ");
    region = regionAnswer?.trim() || "us-east-1";
  }

  const ops = [
    ...buildCloudPatch(provider.id, model, region),
    ...buildOnboardingCompletePatch("cloud", ONBOARDING_VERSION),
  ];
  await applyPatches(opts, ops);

  if (opts.json) {
    console.log(JSON.stringify({ status: "complete", mode: "cloud", provider: provider.id, model }));
  } else {
    console.log("\nSetup complete. Start chatting!");
  }
}

async function setupAdvanced(opts: GlobalOpts) {
  console.log("\n── Advanced Setup ──\n");

  const allProviders = [
    ...CLOUD_PROVIDERS.map((p) => ({ id: p.id, label: p.label })),
    ...LOCAL_PROVIDERS.filter((p) => p.id !== "custom").map((p) => ({ id: p.id, label: p.label })),
  ];

  console.log("Available providers:");
  allProviders.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.label}`);
  });
  console.log("");

  const choice = await prompt("Choose provider [1]: ");
  const idx = Math.max(0, parseInt(choice?.trim() || "1", 10) - 1);
  const provider = allProviders[Math.min(idx, allProviders.length - 1)];

  const isLocal = LOCAL_PROVIDERS.some((p) => p.id === provider.id);

  const secretInfo = SECRET_LABELS[provider.id];
  if (secretInfo && !isLocal) {
    const key = await prompt(`${secretInfo.label}: `);
    if (key?.trim()) {
      await apiFetch(opts, "/api/config/secrets", {
        method: "POST",
        body: JSON.stringify({ op: "set", path: secretInfo.path, value: key.trim() }),
      });
    }
  }

  let baseUrl = "";
  if (isLocal) {
    const preset = LOCAL_PRESET_URLS[provider.id] ?? "";
    const urlAnswer = await prompt(`Server URL [${preset}]: `);
    baseUrl = urlAnswer?.trim() || preset;
  }

  const defaultModel = isLocal ? "" : (CLOUD_DEFAULT_MODELS[provider.id] ?? "");
  const modelAnswer = await prompt(`Model [${defaultModel || "enter model"}]: `);
  const model = modelAnswer?.trim() || defaultModel;

  let region = "";
  if (provider.id === "bedrock") {
    const regionAnswer = await prompt("AWS Region [us-east-1]: ");
    region = regionAnswer?.trim() || "us-east-1";
  }

  const embAnswer = await prompt("Configure embeddings? [y/N]: ");
  let embeddingProvider = "";
  let embeddingModel = "";
  let embeddingBaseUrl = "";
  if (embAnswer?.trim().toLowerCase() === "y") {
    const embProviderAnswer = await prompt("Embedding provider (gemini/lmstudio/llamacpp/bedrock): ");
    embeddingProvider = embProviderAnswer?.trim() || "";
    const embModelAnswer = await prompt("Embedding model: ");
    embeddingModel = embModelAnswer?.trim() || "";
    if (embeddingProvider === "lmstudio" || embeddingProvider === "llamacpp") {
      const embUrlAnswer = await prompt(`Embedding server URL [${LOCAL_PRESET_URLS[embeddingProvider] ?? ""}]: `);
      embeddingBaseUrl = embUrlAnswer?.trim() || LOCAL_PRESET_URLS[embeddingProvider] || "";
    }
  }

  const ops = [
    ...buildAdvancedPatch({ provider: provider.id, model, baseUrl, region, embeddingProvider, embeddingModel, embeddingBaseUrl }),
    ...buildOnboardingCompletePatch("advanced", ONBOARDING_VERSION),
  ];
  await applyPatches(opts, ops);

  if (opts.json) {
    console.log(JSON.stringify({ status: "complete", mode: "advanced", provider: provider.id, model }));
  } else {
    console.log("\nSetup complete. Start chatting!");
  }
}

async function applyPatches(
  opts: GlobalOpts,
  ops: { op: string; path: string; value: unknown }[],
) {
  const { data: config, headers } = await apiFetch<{ rev: string }>(opts, "/api/config");
  const rev = config.rev ?? headers.get("etag") ?? "";

  await apiFetch(opts, "/api/config", {
    method: "PATCH",
    headers: { "if-match": rev },
    body: JSON.stringify(ops),
  });
}

async function prompt(message: string): Promise<string | null> {
  process.stdout.write(message);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  if (!value) return null;
  return new TextDecoder().decode(value).replace(/\n$/, "");
}
