#!/usr/bin/env node

import fsExtra from "fs-extra";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { require as tsxRequire } from "tsx/cjs/api";
import { tsImport } from "tsx/esm/api";
import {
  assertValidNormalizedConfig,
  discoverConfigFile,
  normalizeConfig,
  normalizeLegacyConfig,
  parseConfigPath,
  resolveRuntimeConfig,
  type NormalizedConfig,
  type OverrideProxyConfig,
  type OverrideProxyConfigContext,
  type OverrideProxyConfigExport,
} from "./config.js";
import { startConfiguredServers } from "./server-runtime.js";

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
  legacy: {
    target: string;
    port: number;
    corsOrigins?: string | undefined;
  } | null;
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
  const runtimeConfig = resolveRuntimeConfig(
    argv,
    options.moduleUrl ?? import.meta.url,
  );
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
      },
    };
  }

  if (!(await fsExtra.pathExists(configFile))) {
    throw new ConfigLoaderError(`Config file not found: ${configFile}`);
  }

  const userConfig = await loadUserConfig(configFile, {
    cwd,
    configFile,
    env: process.env,
  });

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

async function loadUserConfig(
  configFile: string,
  context: OverrideProxyConfigContext,
): Promise<OverrideProxyConfig> {
  const mod = toModuleRecord(await importConfigModule(configFile));
  const config = mod["default"] ?? mod["config"];
  if (!isOverrideProxyConfigExport(config)) {
    throw new ConfigLoaderError(
      `Config file must export an override-proxy config object or factory: ${configFile}`,
    );
  }
  const resolvedConfig =
    typeof config === "function" ? await config(context) : config;
  if (!isOverrideProxyConfig(resolvedConfig)) {
    throw new ConfigLoaderError(
      `Config factory must return an override-proxy config object: ${configFile}`,
    );
  }
  return resolvedConfig;
}

function isOverrideProxyConfigExport(
  value: unknown,
): value is OverrideProxyConfigExport {
  return isOverrideProxyConfig(value) || typeof value === "function";
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

async function importConfigModule(configFile: string): Promise<unknown> {
  const configUrl = pathToFileURL(configFile).href;
  if (isEsmTypeScriptConfig(configFile)) {
    return tsImport(configUrl, import.meta.url);
  }
  if (isTypeScriptConfig(configFile)) {
    return tsxRequire(configFile, import.meta.url);
  }
  return import(configUrl);
}

function isEsmTypeScriptConfig(configFile: string): boolean {
  return configFile.endsWith(".mts");
}

function isTypeScriptConfig(configFile: string): boolean {
  return configFile.endsWith(".ts") || configFile.endsWith(".cts");
}

function classifyError(error: unknown): number {
  if (error instanceof ConfigLoaderError) return EXIT_CODES.loader;
  if (error instanceof Error && error.name === "ConfigValidationError") {
    return EXIT_CODES.validation;
  }
  return EXIT_CODES.runtime;
}

function isCliEntrypoint(argv: readonly string[]): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) return false;
  return import.meta.url === pathToFileURL(resolveEntrypoint(entrypoint)).href;
}

function resolveEntrypoint(entrypoint: string): string {
  try {
    return realpathSync(entrypoint);
  } catch {
    return entrypoint;
  }
}

if (isCliEntrypoint(process.argv)) {
  process.exitCode = await runCli();
}
