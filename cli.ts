#!/usr/bin/env node

import fsExtra from "fs-extra";
import { pathToFileURL } from "node:url";
import {
  assertValidNormalizedConfig,
  discoverConfigFile,
  normalizeConfig,
  normalizeLegacyConfig,
  parseConfigPath,
  resolveRuntimeConfig,
  type NormalizedConfig,
  type OverrideProxyConfig,
} from "./config.js";
import { startConfiguredServers } from "./server-runtime.js";
import { parseRulesDir } from "./utils.js";

export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  validation: 3,
  loader: 4,
  runtime: 5,
  port: 6,
} as const;

export type CliCommand = "serve" | "validate";

export interface CliInvocation {
  command: CliCommand;
  args: string[];
}

export interface LoadCliConfigOptions {
  cwd?: string;
  moduleUrl?: string;
}

export interface LoadedCliConfig {
  normalizedConfig: NormalizedConfig;
  legacy:
    | {
        target: string;
        port: number;
        corsOrigins?: string | undefined;
        rulesDir: string;
      }
    | null;
}

export function resolveCliInvocation(argv: string[]): CliInvocation {
  const [firstArg, ...restArgs] = argv;
  if (!firstArg || firstArg.startsWith("--")) {
    return { command: "serve", args: argv };
  }
  if (firstArg === "serve" || firstArg === "validate") {
    return { command: firstArg, args: restArgs };
  }
  throw new Error(`Unknown command: ${firstArg}`);
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let invocation: CliInvocation;
  try {
    invocation = resolveCliInvocation(argv);
  } catch (error) {
    console.error(String(error));
    return EXIT_CODES.usage;
  }

  try {
    if (invocation.command === "validate") {
      await loadCliConfig(invocation.args);
      console.log("Config valid");
      return EXIT_CODES.ok;
    }

    const loaded = await loadCliConfig(invocation.args);
    await startConfiguredServers(loaded.normalizedConfig, {
      ...(loaded.legacy
        ? {
            ensureRulesDirs: [loaded.legacy.rulesDir],
            legacyEnv: {
              target: loaded.legacy.target,
              port: loaded.legacy.port,
              corsOrigins: loaded.legacy.corsOrigins,
            },
          }
        : {}),
    });
    return EXIT_CODES.ok;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return classifyError(error);
  }
}

export async function loadCliConfig(
  argv: string[],
  options: LoadCliConfigOptions = {},
): Promise<LoadedCliConfig> {
  const cwd = options.cwd ?? process.cwd();
  const runtimeConfig = resolveRuntimeConfig(argv, options.moduleUrl ?? import.meta.url);
  const explicitConfig = parseConfigPath(argv, cwd);
  const configFile = explicitConfig ?? (await discoverConfigFile(cwd));

  if (!configFile) {
    const normalizedConfig = normalizeLegacyConfig(runtimeConfig, {
      cwd,
      configFile: null,
    });
    assertValidNormalizedConfig(normalizedConfig);
    return {
      normalizedConfig,
      legacy: {
        target: runtimeConfig.TARGET,
        port: runtimeConfig.PORT,
        corsOrigins: runtimeConfig.CORS_ORIGINS,
        rulesDir: runtimeConfig.rulesDir,
      },
    };
  }

  if (!(await fsExtra.pathExists(configFile))) {
    throw new ConfigLoaderError(`Config file not found: ${configFile}`);
  }

  const userConfig = await loadUserConfig(configFile);
  if (parseRulesDir(argv) && userConfig.servers.length > 1) {
    throw new Error("--rules-dir cannot target a multi-server config");
  }

  const normalizedConfig = normalizeConfig(userConfig, {
    cwd,
    configFile,
  });
  assertValidNormalizedConfig(normalizedConfig);

  return {
    normalizedConfig,
    legacy: null,
  };
}

class ConfigLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigLoaderError";
  }
}

async function loadUserConfig(configFile: string): Promise<OverrideProxyConfig> {
  const mod = toModuleRecord(await import(pathToFileURL(configFile).href));
  const config = mod["default"] ?? mod["config"];
  if (!isOverrideProxyConfig(config)) {
    throw new ConfigLoaderError(
      `Config file must export an override-proxy config object: ${configFile}`,
    );
  }
  return config;
}

function isOverrideProxyConfig(value: unknown): value is OverrideProxyConfig {
  return (
    isRecord(value) &&
    Array.isArray(value["servers"]) &&
    value["servers"].length > 0
  );
}

function toModuleRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function classifyError(error: unknown): number {
  if (error instanceof ConfigLoaderError) return EXIT_CODES.loader;
  if (error instanceof Error && error.name === "ConfigValidationError") {
    return EXIT_CODES.validation;
  }
  if (
    error instanceof Error &&
    error.message.includes("--rules-dir cannot target a multi-server config")
  ) {
    return EXIT_CODES.validation;
  }
  return EXIT_CODES.runtime;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runCli();
}
