import { normalizeLegacyConfig, resolveRuntimeConfig } from "./config.js";
import { startConfiguredServers } from "./server-runtime.js";

const { TARGET, PORT, CORS_ORIGINS, rulesDir, externalRulesDir } =
  resolveRuntimeConfig(process.argv, import.meta.url);

const normalizedConfig = normalizeLegacyConfig(
  { TARGET, PORT, CORS_ORIGINS, rulesDir, externalRulesDir },
  { cwd: process.cwd() },
);
const runtime = await startConfiguredServers(normalizedConfig, {
  ensureRulesDirs: [rulesDir],
  legacyEnv: {
    target: TARGET,
    port: PORT,
    corsOrigins: CORS_ORIGINS,
  },
});
const [firstServer] = runtime.servers;
if (!firstServer) {
  throw new Error("Expected at least one configured server");
}
const app = firstServer.app;
const overrides = runtime.overrides;

export { app, overrides, TARGET };
