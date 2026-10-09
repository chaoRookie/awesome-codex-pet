import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, matchingPets, parseArgs } from "../install-pet-remote.mjs";
import { hashBuffer, replaceInstallDirectory } from "../install-utils.mjs";
import { npmInstallCommand } from "../install-command.mjs";

const id = "test-pet--author";
const pet = Buffer.from(
  JSON.stringify({ id, spritesheetPath: "spritesheet.webp" }),
);
const webp = Buffer.from("RIFFxxxxWEBPtest");
function fixture() {
  return {
    schemaVersion: 1,
    pets: {
      [id]: {
        name: "Test Pet",
        localizedNames: { zh: "测试宠物", en: "Test Pet" },
        petJsonSha256: hashBuffer(pet),
        petJsonBytes: pet.length,
        spritesheetSha256: hashBuffer(webp),
        spritesheetBytes: webp.length,
      },
    },
  };
}
function mockNetwork(t, manifest = fixture(), image = webp) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    if (url.endsWith("install-manifest.json"))
      return new Response(JSON.stringify(manifest));
    if (url.endsWith("pet.json")) return new Response(pet);
    if (url.endsWith("spritesheet.webp")) return new Response(image);
    throw new Error(`Unexpected network call: ${url}`);
  });
  t.mock.method(console, "log", () => {});
  return requests;
}
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "codex-pet-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("command parsing preserves legacy IDs and rejects incomplete or unsafe requests", () => {
  assert.equal(parseArgs([id]).command, "install");
  assert.equal(parseArgs(["--list"]).command, "list");
  assert.equal(parseArgs(["search", "test", "pet"]).query, "test pet");
  for (const args of [
    ["install"],
    ["install", "../bad"],
    ["list", id],
    ["search"],
    ["download", id],
    ["list", "--output", "x"],
    ["--lang", "xx"],
    ["unknown"],
  ])
    assert.throws(() => parseArgs(args));
});

test("search matches all words, IDs and localized names", () => {
  assert.equal(matchingPets(fixture(), "测试").length, 1);
  assert.equal(matchingPets(fixture(), "TEST author").length, 1);
  assert.equal(matchingPets(fixture(), "test missing").length, 0);
});

test("list and search fetch only one manifest and never assets", async (t) => {
  const requests = mockNetwork(t);
  await main(["search", "测试"]);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].endsWith("install-manifest.json"));
});

test("download writes only verified runtime files to the selected directory without stats", async (t) => {
  const output = temporary(t);
  const requests = mockNetwork(t);
  await main(["download", id, "--output", output]);
  assert.deepEqual(readdirSync(join(output, id)).sort(), [
    "pet.json",
    "spritesheet.webp",
  ]);
  assert.deepEqual(readFileSync(join(output, id, "spritesheet.webp")), webp);
  assert.equal(requests.length, 3);
  assert.deepEqual(readdirSync(output), [id]);
});

test("remote installation requires force and cleans failed staging", async (t) => {
  const root = temporary(t);
  mockNetwork(t);
  const args = ["install", id, "--codex-home", root, "--no-stats"];
  await main(args);
  await assert.rejects(main(args), /--force/);
  assert.deepEqual(readdirSync(join(root, "pets")), [id]);
  await main([...args, "--force"]);
  assert.deepEqual(readdirSync(join(root, "pets")), [id]);
});

test("hash failure preserves an existing pet and creates no temporary files", async (t) => {
  const root = temporary(t);
  const target = join(root, "pets", id);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "pet.json"), "previous");
  mockNetwork(t, fixture(), Buffer.from("RIFFxxxxWEBPfail"));
  await assert.rejects(
    main(["install", id, "--codex-home", root, "--force", "--no-stats"]),
    /SHA-256/,
  );
  assert.equal(readFileSync(join(target, "pet.json"), "utf8"), "previous");
  assert.deepEqual(readdirSync(join(root, "pets")), [id]);
});

test("failed activation restores the previous package and releases its lock", (t) => {
  const root = temporary(t);
  mkdirSync(join(root, id));
  writeFileSync(join(root, id, "pet.json"), "previous");
  assert.throws(() =>
    replaceInstallDirectory({
      petsRoot: root,
      petId: id,
      stageDir: join(root, "missing-stage"),
      force: true,
    }),
  );
  assert.equal(readFileSync(join(root, id, "pet.json"), "utf8"), "previous");
  assert.deepEqual(readdirSync(root), [id]);
});

test("network errors and oversized responses do not create an installation", async (t) => {
  const root = temporary(t);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("unavailable", { status: 503 }),
  );
  await assert.rejects(main(["install", id, "--codex-home", root]), /503/);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("{}", { headers: { "content-length": "1000001" } }),
  );
  await assert.rejects(
    main(["install", id, "--codex-home", root]),
    /safety limit/,
  );
  assert.equal(existsSync(join(root, "pets")), false);
});

test("contribution entry is offline and does not publish", async (t) => {
  const requests = mockNetwork(t);
  await main(["contribute", "--lang", "zh"]);
  assert.equal(requests.length, 0);
});

test("shared website command is cross-platform and validates interpolated values", () => {
  assert.equal(npmInstallCommand(id), `npx --yes @legeling/codex-pet install ${id}`);
  assert.match(
    npmInstallCommand(id, "v1.0.0"),
    /--raw-base https:\/\/.+\/v1.0.0$/,
  );
  assert.throws(() => npmInstallCommand("x;bad"));
  assert.throws(() => npmInstallCommand(id, "main;bad"));
});
