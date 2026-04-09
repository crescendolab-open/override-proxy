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
const nodemonBin = join(projectRoot, "node_modules", ".bin",
  process.platform === "win32" ? "nodemon.cmd" : "nodemon");

// Collect all args (npm/pnpm strips the leading `--`)
const args = process.argv.slice(2);

// Extract --rules-dir=<path> if present
const rulesDirArg = args.find((a) => a.startsWith("--rules-dir="));
const rulesPath = rulesDirArg?.split("=").slice(1).join("=");
const externalRulesDir = rulesPath ? resolve(rulesPath) : null;

// Build nodemon CLI args — only override what we need to change.
// Everything else (ext, env, ignore, delay, …) comes from nodemon.json.
const nodemonArgs = [];
const needsOverride = externalRulesDir || args.length > 0;

if (needsOverride) {
  const config = JSON.parse(
    readFileSync(join(projectRoot, "nodemon.json"), "utf-8"),
  );

  // CLI --watch replaces (not supplements) nodemon.json watch,
  // so when adding external dir we must include the base paths too.
  if (externalRulesDir) {
    for (const w of config.watch ?? []) {
      nodemonArgs.push("--watch", w);
    }
    nodemonArgs.push("--watch", externalRulesDir);
  }

  // Forward args to the exec command (override --exec to append them).
  if (args.length > 0) {
    const exec = config.exec ?? "tsx main.ts";
    const quote = (a) => (a.includes(" ") ? `"${a}"` : a);
    nodemonArgs.push("--exec", `${exec} ${args.map(quote).join(" ")}`);
  }
}

try {
  execFileSync(nodemonBin, nodemonArgs, {
    stdio: "inherit",
    cwd: projectRoot,
  });
} catch (err) {
  // execFileSync throws on non-zero exit. If nodemon was killed by a signal
  // (Ctrl+C), exit cleanly; otherwise surface the error.
  if (err?.status != null && err.status !== 0) {
    process.exit(err.status);
  }
  // Signal-based termination (e.g. SIGINT) — err.status is null
  process.exit(0);
}
