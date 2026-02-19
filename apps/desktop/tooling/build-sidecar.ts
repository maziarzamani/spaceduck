import { execSync } from "child_process";
import { existsSync, renameSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "../../..");
const GATEWAY_ENTRY = join(ROOT, "packages/gateway/src/index.ts");
const BINARIES_DIR = join(import.meta.dir, "../src-tauri/binaries");
const SIDECAR_NAME = "spaceduck-server";

const isWindows = process.platform === "win32";
const ext = isWindows ? ".exe" : "";

function getTargetTriple(): string {
  const raw = execSync("rustc --print host-tuple", { encoding: "utf-8" }).trim();
  if (!raw) throw new Error("Failed to detect Rust target triple");
  return raw;
}

function buildSidecar() {
  const triple = getTargetTriple();
  console.log(`Building sidecar for ${triple}...`);

  mkdirSync(BINARIES_DIR, { recursive: true });

  const outfile = join(BINARIES_DIR, `${SIDECAR_NAME}${ext}`);
  const targetFile = join(BINARIES_DIR, `${SIDECAR_NAME}-${triple}${ext}`);

  const cmd = [
    "bun",
    "build",
    "--compile",
    "--target=bun",
    "--minify",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--external=playwright-core",
    "--external=electron",
    "--external=chromium-bidi",
    `--outfile=${outfile}`,
    GATEWAY_ENTRY,
  ].join(" ");

  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });

  if (!existsSync(outfile)) {
    throw new Error(`Build produced no output at ${outfile}`);
  }

  renameSync(outfile, targetFile);
  console.log(`Sidecar ready: ${targetFile}`);
}

buildSidecar();
