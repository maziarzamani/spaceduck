import { resolve } from "path";
import tailwind from "bun-plugin-tailwind";

const ROOT = resolve(import.meta.dir, "../../..");
const WEB_APP = resolve(ROOT, "apps/web");
const OUT_DIR = resolve(import.meta.dir, "../dist");

console.log("Building frontend for desktop...");

const result = await Bun.build({
  entrypoints: [resolve(WEB_APP, "index.html")],
  outdir: OUT_DIR,
  minify: true,
  plugins: [tailwind],
});

if (!result.success) {
  console.error("Frontend build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Frontend built to ${OUT_DIR} (${result.outputs.length} files)`);
