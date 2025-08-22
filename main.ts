/*
 * override-proxy: override-first mock + proxy server.
 * Flow: match first enabled override rule -> send response; else proxy to TARGET (default PokeAPI).
 */

import express from "express";
import dotenvx from "@dotenvx/dotenvx";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import chalk from "chalk";
import url from "node:url";
import { join, dirname } from "pathe";
import fg from "fast-glob";
import fsExtra from "fs-extra";
import { OverrideRule, isOverrideRule, OverrideRuleMeta } from "./utils.js";
import getPort from "get-port";

// ----------------------------------------------------------------------------
// Environment (dotenvx): load .env.local (private, overrides) then .env.default (committed defaults)
// ----------------------------------------------------------------------------
dotenvx.config({ path: [".env.local", ".env.default"], quiet: true });

// ----------------------------------------------------------------------------
// Resolved configuration
// ----------------------------------------------------------------------------
const TARGET = process.env["PROXY_TARGET"] || "https://pokeapi.co/api/v2/"; // fallback only if neither file provided
const PORT = Number(process.env["PORT"] || 4000);
const CORS_ORIGINS = process.env["CORS_ORIGINS"]; // comma-separated list; if unset -> allow all

// Load override rule modules
const __dirname = dirname(url.fileURLToPath(import.meta.url));
const rulesDir = join(__dirname, "rules");
// Ensure rules directory exists (allow empty project start)
await fsExtra.ensureDir(rulesDir);
const overrides: OverrideRule[] = [];
const metaMap = new WeakMap<OverrideRule, OverrideRuleMeta>();
// Glob pattern: ts/js (skip .d.ts & dotfiles)
const entries = await fg(["**/*.ts", "**/*.js"], {
  cwd: rulesDir,
  dot: false, // ignore dotfiles / dotfolders
  ignore: ["**/*.d.ts"],
});
for (const rel of entries) {
  const full = join(rulesDir, rel);
  try {
    const mod: any = await import(full);
    type Collected = { rule: OverrideRule; exportName?: string };
    const collected: Collected[] = [];

    // Legacy default (rule or array of rules)
    if (mod.default) {
      if (Array.isArray(mod.default)) {
        for (const item of mod.default)
          if (isOverrideRule(item)) collected.push({ rule: item });
      } else if (isOverrideRule(mod.default)) {
        collected.push({ rule: mod.default });
      }
    }
    // Legacy named 'rules'
    if (Array.isArray(mod.rules)) {
      for (const item of mod.rules)
        if (isOverrideRule(item)) collected.push({ rule: item });
    }
    // Named exports
    for (const [key, val] of Object.entries(mod)) {
      if (key === "default" || key === "rules") continue;
      if (isOverrideRule(val)) collected.push({ rule: val, exportName: key });
      else if (Array.isArray(val)) {
        for (const item of val)
          if (isOverrideRule(item))
            collected.push({ rule: item, exportName: key });
      }
    }
    // Finalize & store metadata
    for (const { rule: rOriginal, exportName } of collected) {
      let r = rOriginal;
      if (exportName && !r.name) {
        if (!Object.isExtensible(r) || Object.isFrozen(r))
          r = { ...r } as OverrideRule;
        r.name = exportName;
      }
      const id = `${rel}${exportName ? ":" + exportName : ""}`;
      metaMap.set(r, { file: rel, export: exportName, id });
      overrides.push(r);
    }
  } catch (e) {
    console.error("Failed loading rule module", rel, e);
  }
}

// ----------------------------------------------------------------------------
// Express app setup
// ----------------------------------------------------------------------------

const app = express();
// ----------------------------------------------------------------------------
// Introspection endpoint (non-sensitive snapshot)
// ----------------------------------------------------------------------------
app.get("/__env", (_req, res) => {
  const env = {
    PROXY_TARGET: TARGET,
    PORT,
    CORS_ORIGINS: CORS_ORIGINS || null,
  } as const;
  res.json({ env });
});
function fmtStatus(status?: number) {
  if (status == null) return "";
  if (status >= 500) return chalk.red(String(status));
  if (status >= 400) return chalk.yellow(String(status));
  if (status >= 300) return chalk.magenta(String(status));
  if (status >= 200) return chalk.green(String(status));
  return String(status);
}

function logRequestStart(id: number, method: string, url: string) {
  console.log(chalk.gray(`[${id}] -> ${method} ${url}`));
}
function logRequestMatch(id: number, match: string, meta?: OverrideRuleMeta) {
  const extra = meta?.file
    ? ` (${meta.file}${meta?.export ? ":" + meta.export : ""})`
    : "";
  console.log(chalk.cyan(`[${id}] match ${match}${extra}`));
}
function logRequestEnd(
  id: number,
  status: number,
  ms: number,
  via?: string,
  match?: string,
) {
  const viaStr = via ? chalk.blue(via) : "";
  const matchStr = match ? chalk.cyan(match) : "";
  console.log(
    `[${id}] <- ${fmtStatus(status)} ${ms}ms ${viaStr} ${matchStr}`.trim(),
  );
}
function logError(id: number, err: unknown, match?: string) {
  console.error(
    chalk.red(`[${id}] ERROR ${match ? match + " " : ""}${String(err)}`),
  );
}

// ----------------------------------------------------------------------------
// CORS: restrict if CORS_ORIGINS set, else allow all
let allowedOrigins: string[] | null = null;
if (CORS_ORIGINS) {
  allowedOrigins = CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

const corsOptions: cors.CorsOptions = {
  origin: allowedOrigins
    ? (origin, callback) => {
        // Non-browser or same-origin requests may have no origin header
        if (!origin) return callback(null, true);
        if (allowedOrigins!.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      }
    : true, // reflect request origin (allow all)
  credentials: true,
};

app.use(cors(corsOptions));

// Basic request logging
let reqSeq = 0;
app.use((req, res, next) => {
  const id = ++reqSeq;
  const start = Date.now();
  (res as any)._logId = id;
  logRequestStart(id, req.method, req.originalUrl);
  (res as any).on("finish", () => {
    logRequestEnd(
      id,
      res.statusCode,
      Date.now() - start,
      (res as any)._via,
      (res as any)._matched,
    );
  });
  (res as any).on("error", (err: any) => {
    logError(id, err, (res as any)._matched);
  });
  next();
});

// Override dispatch loop
app.use(async (req, res, next) => {
  for (const rule of overrides) {
    try {
      if (rule.test(req)) {
        (res as any)._via = "override";
        (res as any)._matched = rule.name;
        logRequestMatch(
          (res as any)._logId,
          rule.name || "override",
          metaMap.get(rule),
        );
        await rule.handler(req, res, next);
        return; // Stop at first match
      }
    } catch (err) {
      logError((res as any)._logId, err, rule.name);
      res.status(500).json({ error: "override_failed", detail: String(err) });
      return;
    }
  }
  next();
});

// Proxy fallback
app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    // http-proxy-middleware v3: events via on{}
    on: {
      proxyReq: (_proxyReq, req: any) => {
        (req.res as any)._via = "proxy";
      },
      proxyRes: (_proxyRes, _req: any) => {
        // finish listener handles final log
      },
      error: (err, _req: any, res: any) => {
        logError((res as any)._logId || ++reqSeq, err);
        if ("headersSent" in res && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: "proxy_error", detail: String(err) }));
      },
    },
  }),
);

// ----------------------------------------------------------------------------
// Startup & port selection
// ----------------------------------------------------------------------------

async function startServer() {
  const preferred = PORT;
  const candidates: number[] = [];
  for (let p = preferred; p < preferred + 10; p++) candidates.push(p);
  const port = await getPort({ port: candidates });
  if (port !== preferred) {
    console.log(`Port ${preferred} busy -> selected ${port}`);
  }
  app.listen(port, () => {
    console.log(`Server listening http://localhost:${port}`);
    console.log(`Target: ${TARGET}`);
    console.log(
      `Overrides:\n${overrides
        .map((r) => {
          const meta = metaMap.get(r);
          const src = meta
            ? `${meta.file}${meta.export ? ":" + meta.export : ""}`
            : "?";
          return `  - ${r.name || "<unnamed>"}${r.enabled === false ? " (off)" : ""} :: ${src}`;
        })
        .join("\n")}`,
    );
  });
}

startServer();

// Public exports
export { app, overrides, TARGET };
