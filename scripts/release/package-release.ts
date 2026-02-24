#!/usr/bin/env bun

/**
 * Build release artifacts, generate manifest, checksums, and VERSION file.
 * Runnable locally: bun scripts/release/package-release.ts
 * Called by CI:      GIT_SHA=$GITHUB_SHA bun scripts/release/package-release.ts
 */

import { readFileSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "../..");
const RELEASE_DIR = join(ROOT, "dist/release");

interface ReleaseContract {
  repo: string;
  artifacts: {
    gateway: string;
    cli: string;
    checksums: string;
    manifest: string;
    version: string;
  };
  bun: { minVersion: string };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function sha256(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function run(cmd: string): void {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function gitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return "dev";
  }
}

async function main() {
  const contract = readJson<ReleaseContract>(join(ROOT, "scripts/release-contract.json"));
  const gatewayPkg = readJson<{ version: string }>(join(ROOT, "packages/gateway/package.json"));
  const cliPkg = readJson<{ version: string }>(join(ROOT, "apps/cli/package.json"));

  const gatewayVersion = gatewayPkg.version;
  const cliVersion = cliPkg.version;
  const commit = gitSha();

  console.log(`\nPackaging release`);
  console.log(`  gateway: ${gatewayVersion}`);
  console.log(`  cli:     ${cliVersion}`);
  console.log(`  commit:  ${commit}\n`);

  // Build
  console.log("Building gateway...");
  run("bun run build");

  console.log("\nBuilding CLI...");
  run("bun run build:cli");

  // Prepare output dir
  if (!existsSync(RELEASE_DIR)) mkdirSync(RELEASE_DIR, { recursive: true });

  // Copy artifacts with contract-defined names
  const gatewayDist = join(ROOT, "dist/index.js");
  const cliDist = join(ROOT, "dist/cli/index.js");
  const gatewayOut = join(RELEASE_DIR, contract.artifacts.gateway);
  const cliOut = join(RELEASE_DIR, contract.artifacts.cli);

  if (!existsSync(gatewayDist)) throw new Error(`Gateway build output not found: ${gatewayDist}`);
  if (!existsSync(cliDist)) throw new Error(`CLI build output not found: ${cliDist}`);

  copyFileSync(gatewayDist, gatewayOut);
  copyFileSync(cliDist, cliOut);
  console.log(`\nCopied artifacts to ${RELEASE_DIR}`);

  // Import API_VERSION from core
  const versionMod = await import(join(ROOT, "packages/core/src/version.ts"));
  const apiVersion: number = versionMod.API_VERSION;

  // manifest.json
  const manifest = {
    gatewayVersion,
    cliVersion,
    apiVersion,
    commit,
    artifacts: {
      gateway: contract.artifacts.gateway,
      cli: contract.artifacts.cli,
      checksums: contract.artifacts.checksums,
    },
    bun: contract.bun,
  };
  const manifestPath = join(RELEASE_DIR, contract.artifacts.manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // VERSION
  const versionPath = join(RELEASE_DIR, contract.artifacts.version);
  writeFileSync(versionPath, gatewayVersion + "\n");

  // checksums.txt
  const files = [
    contract.artifacts.gateway,
    contract.artifacts.cli,
    contract.artifacts.manifest,
    contract.artifacts.version,
  ];
  const checksumLines = files.map((f) => {
    const hash = sha256(join(RELEASE_DIR, f));
    return `${hash}  ${f}`;
  });
  writeFileSync(join(RELEASE_DIR, contract.artifacts.checksums), checksumLines.join("\n") + "\n");

  // Verify all expected files
  console.log("\nVerifying artifacts:");
  const allFiles = [...files, contract.artifacts.checksums];
  for (const f of allFiles) {
    const p = join(RELEASE_DIR, f);
    if (!existsSync(p)) throw new Error(`Missing artifact: ${p}`);
    console.log(`  ✓ ${f}`);
  }

  console.log("\nRelease packaged successfully.\n");
}

main().catch((err) => {
  console.error("\nRelease packaging failed:", err.message);
  process.exit(1);
});
