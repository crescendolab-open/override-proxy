#!/usr/bin/env node

/**
 * Dev wrapper: starts nodemon with dynamic --watch for --rules-dir.
 *
 * Usage: node scripts/dev.mjs [--rules-dir=/path/to/rules]
 *
 * When --rules-dir=<path> is provided, this script adds `--watch <path>` to
 * the nodemon invocation so external rule files trigger a hot reload.
 * All arguments are forwarded to the underlying `tsx main.ts` command.
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Collect all args (npm/pnpm strips the leading `--`)
const args = process.argv.slice(2);

// Extract --rules-dir=<path> if present
const rulesDirArg = args.find((a) => a.startsWith("--rules-dir="));
const externalRulesDir = rulesDirArg
  ? resolve(rulesDirArg.split("=").slice(1).join("="))
  : null;

// If no external rules dir, just run plain nodemon (uses nodemon.json as-is)
if (!externalRulesDir && args.length === 0) {
  try {
    execFileSync(
      join(projectRoot, "node_modules", ".bin", "nodemon"),
      [],
      { stdio: "inherit", cwd: projectRoot },
    );
  } catch {
    process.exit(0);
  }
  process.exit(0);
}

// Read nodemon.json to get the base watch list
const nodemonConfig = JSON.parse(
  readFileSync(join(projectRoot, "nodemon.json"), "utf-8"),
);
const baseWatch = nodemonConfig.watch ?? [];
const ext = nodemonConfig.ext ?? "ts,js,json";
const baseExec = nodemonConfig.exec ?? "tsx main.ts";

// Build nodemon CLI args that replicate nodemon.json + add external watch
const nodemonArgs = [];

// Watch paths: base from nodemon.json + external rules dir
for (const w of baseWatch) {
  nodemonArgs.push("--watch", w);
}
if (externalRulesDir) {
  nodemonArgs.push("--watch", externalRulesDir);
}

// Extensions
nodemonArgs.push("--ext", ext);

// Exec: base command + forwarded args
const execCmd =
  args.length > 0 ? `${baseExec} ${args.join(" ")}` : baseExec;
nodemonArgs.push("--exec", execCmd);

try {
  execFileSync(
    join(projectRoot, "node_modules", ".bin", "nodemon"),
    nodemonArgs,
    { stdio: "inherit", cwd: projectRoot },
  );
} catch {
  // nodemon was killed (Ctrl+C) — exit cleanly
  process.exit(0);
}
