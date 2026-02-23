#!/usr/bin/env bun

import { configGet } from "./commands/config-get";
import { configSet } from "./commands/config-set";
import { configSecret } from "./commands/config-secret";
import { configPaths } from "./commands/config-paths";
import { status } from "./commands/status";
import { setup } from "./commands/setup";

const USAGE = `
spaceduck — CLI for managing your Spaceduck gateway

Usage:
  spaceduck setup                           Interactive setup wizard
  spaceduck setup --mode local|cloud|advanced  Setup with a specific mode
  spaceduck setup --skip                    Skip setup for now
  spaceduck status                          Check gateway and provider health
  spaceduck config get [path]               Read config (optionally a specific path)
  spaceduck config set <path> <value>       Update a config value
  spaceduck config paths                    List all config paths and current values
  spaceduck config secret set <path>        Set a secret (reads from stdin or prompt)
  spaceduck config secret unset <path>      Remove a secret

Options:
  --gateway <url>    Gateway URL (default: SPACEDUCK_GATEWAY_URL or http://localhost:3000)
  --token <token>    Auth token (default: SPACEDUCK_TOKEN env var)
  --json             Output raw JSON
  --help, -h         Show this help

Examples:
  spaceduck setup
  spaceduck setup --mode cloud
  spaceduck status
  spaceduck config get /ai/provider
  spaceduck config set /ai/model us.amazon.nova-2-pro-v1:0
  spaceduck config secret set /ai/secrets/bedrockApiKey
`.trim();

interface GlobalOpts {
  gateway: string;
  token: string | null;
  json: boolean;
}

function parseGlobalOpts(args: string[]): { opts: GlobalOpts; rest: string[] } {
  let gateway = Bun.env.SPACEDUCK_GATEWAY_URL ?? "http://localhost:3000";
  let token = Bun.env.SPACEDUCK_TOKEN ?? null;
  let json = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--gateway" && i + 1 < args.length) {
      gateway = args[++i];
    } else if (arg === "--token" && i + 1 < args.length) {
      token = args[++i];
    } else if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }

  return { opts: { gateway, token, json }, rest };
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }

  const { opts, rest } = parseGlobalOpts(rawArgs);

  if (rest.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const [command, ...commandArgs] = rest;

  try {
    switch (command) {
      case "status":
        await status(opts);
        break;

      case "setup":
        await setup(opts, commandArgs);
        break;

      case "config": {
        const [sub, ...subArgs] = commandArgs;
        switch (sub) {
          case "get":
            await configGet(opts, subArgs);
            break;
          case "set":
            await configSet(opts, subArgs);
            break;
          case "paths":
            await configPaths(opts);
            break;
          case "secret":
            await configSecret(opts, subArgs);
            break;
          default:
            console.error(sub ? `Unknown config subcommand: ${sub}` : "Missing config subcommand");
            console.error("Run: spaceduck config --help");
            process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Run: spaceduck --help");
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export type { GlobalOpts };

main();
