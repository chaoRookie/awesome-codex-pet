import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("published package is lightweight and both installed CLI aliases work", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-pet-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = execFileSync(
    "npm",
    ["pack", "--pack-destination", root, "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [pack] = JSON.parse(output);
  assert.equal(pack.name, "@legeling/codex-pet");
  assert.ok(pack, "npm pack did not return package metadata");
  assert.ok(
    pack.files.some((file) => file.path === "scripts/install-pet-remote.mjs"),
  );
  assert.ok(
    pack.files.some((file) => file.path === "scripts/install-utils.mjs"),
  );
  assert.ok(
    pack.files.every(
      (file) =>
        !file.path.startsWith("pets/") && !file.path.startsWith("assets/"),
    ),
    "npm package must not include the pet catalog or generated assets",
  );
  assert.ok(
    pack.unpackedSize < 500_000,
    `npm package is too large: ${pack.unpackedSize} bytes unpacked`,
  );
  execFileSync(
    "npm",
    [
      "install",
      "--global",
      "--prefix",
      join(root, "prefix"),
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      join(root, pack.filename),
    ],
    { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const alias of ["codex-pet", "cpet"]) {
    const entry = join(root, "prefix", "bin", alias);
    const help = execFileSync(process.execPath, [entry, "--help"], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.match(help, /codex-pet search/);
    const contribution = execFileSync(process.execPath, [entry, "contribute"], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.match(contribution, /https:\/\/codexpet.top\/guide/);
  }
  t.diagnostic(
    `npm tarball: ${pack.size} bytes; unpacked: ${pack.unpackedSize} bytes; ${pack.files.length} files`,
  );
});
