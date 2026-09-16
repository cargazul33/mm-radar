import * as esbuild from "esbuild";
import { mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });
await esbuild.build({
  entryPoints: ["src/local-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/local-entry.mjs",
  packages: "external",
  banner: { js: "" },
});
console.log("built dist/local-entry.mjs");
