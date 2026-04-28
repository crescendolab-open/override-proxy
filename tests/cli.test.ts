import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import {
  EXIT_CODES,
  loadCliConfig,
  resolveCliInvocation,
  runCli,
} from "../cli.js";

assert.deepEqual(resolveCliInvocation([]), { command: "serve", args: [] });
assert.deepEqual(resolveCliInvocation(["--config", "x.mjs"]), {
  command: "serve",
  args: ["--config", "x.mjs"],
});
assert.deepEqual(resolveCliInvocation(["serve", "--config", "x.mjs"]), {
  command: "serve",
  args: ["--config", "x.mjs"],
});
assert.deepEqual(resolveCliInvocation(["validate"]), {
  command: "validate",
  args: [],
});

const packageJson: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

assert.equal(readPath(packageJson, ["bin", "override-proxy"]), "./dist/cli.js");
assert.equal(readPath(packageJson, ["main"]), "./dist/index.js");
assert.equal(readPath(packageJson, ["types"]), "./dist/index.d.ts");
assert.equal(
  readPath(packageJson, ["scripts", "build"]),
  "tsc -p tsconfig.build.json",
);
assert.ok(readPath(packageJson, ["exports", "."]));
assert.ok(readPath(packageJson, ["exports", "./main"]));
assert.ok(readPath(packageJson, ["exports", "./cli"]));

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-cli-"));

try {
  const defaultConfig = join(tempDir, "override-proxy.config.mjs");
  const explicitConfig = join(tempDir, "explicit.config.mjs");
  const invalidConfig = join(tempDir, "invalid.config.mjs");
  const multiServerConfig = join(tempDir, "multi.config.mjs");
  const externalRulesDir = join(tempDir, "external-rules");

  await writeFile(
    defaultConfig,
    `
export default {
  servers: [{ routes: [{ path: "/", target: "http://default.example" }] }],
};
`,
  );
  await writeFile(
    explicitConfig,
    `
export default {
  servers: [{ routes: [{ path: "/", target: "http://explicit.example" }] }],
};
`,
  );
  await writeFile(
    invalidConfig,
    `
export default {
  servers: [{ name: "", routes: [{ path: "/" }] }],
};
`,
  );
  await writeFile(
    multiServerConfig,
    `
export default {
  servers: [
    { routes: [{ path: "/", target: "http://one.example" }] },
    { routes: [{ path: "/", target: "http://two.example" }] },
  ],
};
`,
  );

  const discovered = await loadCliConfig([], { cwd: tempDir });
  assert.equal(discovered.legacy, null);
  assert.equal(
    discovered.normalizedConfig.servers[0]!.routes[0]!.target,
    "http://default.example",
  );

  const explicit = await loadCliConfig(["--config", explicitConfig], {
    cwd: tempDir,
  });
  assert.equal(
    explicit.normalizedConfig.servers[0]!.routes[0]!.target,
    "http://explicit.example",
  );

  const legacyDir = await mkdtemp(join(tmpdir(), "override-proxy-legacy-"));
  try {
    const inlineLegacy = await loadCliConfig(
      [`--rules-dir=${externalRulesDir}`],
      {
        cwd: legacyDir,
      },
    );
    assert.ok(inlineLegacy.legacy);
    assert.equal(
      inlineLegacy.normalizedConfig.servers[0]!.routes[0]!.rulesDirs[0],
      externalRulesDir,
    );

    const spacedLegacy = await loadCliConfig(
      ["--rules-dir", externalRulesDir],
      {
        cwd: legacyDir,
      },
    );
    assert.ok(spacedLegacy.legacy);
    assert.equal(
      spacedLegacy.normalizedConfig.servers[0]!.routes[0]!.rulesDirs[0],
      externalRulesDir,
    );
  } finally {
    await rm(legacyDir, { recursive: true, force: true });
  }

  await assert.rejects(
    () =>
      loadCliConfig(
        ["--config", multiServerConfig, `--rules-dir=${externalRulesDir}`],
        {
          cwd: tempDir,
        },
      ),
    /multi-server config/,
  );

  assert.equal(await runCli(["unknown"]), EXIT_CODES.usage);
  assert.equal(
    await runCli(["validate", "--config", join(tempDir, "missing.mjs")]),
    EXIT_CODES.loader,
  );
  assert.equal(
    await runCli(["validate", "--config", invalidConfig]),
    EXIT_CODES.validation,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
