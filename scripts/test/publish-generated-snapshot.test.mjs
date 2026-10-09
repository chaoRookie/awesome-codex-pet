import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { publishSnapshot } from "../publish-generated-snapshot.mjs";

function command(cwd, name, args, { allowFailure = false } = {}) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${name} ${args.join(" ")}: ${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout || "" };
}

function fixture(t, initial = "old") {
  const root = mkdtempSync(join(tmpdir(), "snapshot-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const writer = join(root, "writer");
  const worker = join(root, "worker");
  const git = (cwd, ...args) => command(cwd, "git", args).stdout.trim();
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, writer);
  git(writer, "config", "user.name", "Test author");
  git(writer, "config", "user.email", "test@example.invalid");
  writeFileSync(join(writer, "source.txt"), "old");
  writeFileSync(join(writer, "pets.json"), initial);
  writeFileSync(join(writer, "requests.json"), initial);
  git(writer, "add", ".");
  git(writer, "commit", "-m", "initial");
  git(writer, "push", "origin", "main");
  git(root, "clone", remote, worker);
  let generations = 0;
  let installs = 0;
  let validations = 0;
  const advance = (value) => {
    git(writer, "pull", "--ff-only", "origin", "main");
    writeFileSync(join(writer, "source.txt"), value);
    writeFileSync(join(writer, "unrelated.txt"), value);
    git(writer, "add", ".");
    git(writer, "commit", "-m", `advance ${value}`);
    git(writer, "push", "origin", "main");
  };
  const hooks = {};
  const run = (name, args, options) => {
    if (name === "pnpm" && args[0] === "install") {
      installs += 1;
      hooks.install?.();
      return { status: 0, stdout: "" };
    }
    if (name === "npm" && ["readmes", "requests"].includes(args[1])) {
      generations += 1;
      hooks.generate?.(generations);
      const file = args[1] === "readmes" ? "pets.json" : "requests.json";
      writeFileSync(
        join(worker, file),
        readFileSync(join(worker, "source.txt")),
      );
      return { status: 0, stdout: "" };
    }
    if (name === "npm" || name === "pnpm") {
      validations += 1;
      hooks.validate?.();
      return { status: 0, stdout: "" };
    }
    // Only files relevant to these minimal fixtures exist. Production adds all
    // seven tracked listing outputs; retain the real git index/push behavior.
    if (name === "git" && args[0] === "add") {
      args = ["add", "--", "pets.json", "requests.json"];
    }
    if (name === "git" && args[0] === "push" && hooks.push) {
      const result = hooks.push(args, options);
      if (result) return result;
    }
    return command(worker, name, args, options);
  };
  return {
    worker,
    remote,
    writer,
    git,
    hooks,
    run,
    advance,
    counts: () => ({ generations, installs, validations }),
    publish: (options = {}) =>
      publishSnapshot({ mode: "listings", cwd: worker, run, ...options }),
    remoteFile: (path) => git(remote, "show", `main:${path}`),
  };
}

test("no changes succeeds with the exact checked remote SHA", (t) => {
  const f = fixture(t);
  const result = f.publish();
  assert.deepEqual(result, {
    changed: false,
    catalogChanged: false,
    commit: f.git(f.remote, "rev-parse", "main"),
  });
  assert.deepEqual(f.counts(), { generations: 1, installs: 1, validations: 1 });
});

test("publishes regenerated allowlisted files without changing source", (t) => {
  const f = fixture(t, "stale");
  const result = f.publish();
  assert.equal(result.changed, true);
  assert.equal(result.catalogChanged, true);
  assert.equal(result.commit, f.git(f.remote, "rev-parse", "main"));
  assert.equal(f.remoteFile("pets.json"), "old");
});

test("main advancing before generation is read fresh", (t) => {
  const f = fixture(t);
  f.advance("new");
  assert.equal(f.publish().changed, true);
  assert.equal(f.remoteFile("pets.json"), "new");
  assert.equal(f.remoteFile("unrelated.txt"), "new");
});

test("a no-op computed while main advances regenerates instead of skipping", (t) => {
  const f = fixture(t);
  f.hooks.generate = (n) => {
    if (n === 1) f.advance("new");
  };
  assert.equal(f.publish().changed, true);
  assert.equal(f.remoteFile("pets.json"), "new");
  assert.equal(f.counts().generations, 2);
});

test("rejected concurrent push discards old output and regenerates", (t) => {
  const f = fixture(t, "stale");
  let pushes = 0;
  f.hooks.push = () => {
    if (++pushes === 1) f.advance("new");
  };
  assert.equal(f.publish().changed, true);
  assert.equal(f.remoteFile("pets.json"), "new");
  assert.equal(f.remoteFile("unrelated.txt"), "new");
  assert.equal(f.counts().generations, 2);
  assert.equal(f.counts().installs, 2);
});

test("accepted push with lost response retains changed=true for downstream dispatch", (t) => {
  const f = fixture(t, "stale");
  f.hooks.push = (args, options) => {
    command(f.worker, "git", args, options);
    return { status: 1, stdout: "" };
  };
  assert.equal(f.publish({ mode: "requests" }).changed, true);
  assert.equal(f.remoteFile("requests.json"), "old");
  assert.equal(f.counts().generations, 1);
});

test("request regeneration preserves concurrently updated catalog data", (t) => {
  const f = fixture(t, "stale");
  f.hooks.generate = (n) => {
    if (n === 1) f.advance("new");
  };
  const result = f.publish({ mode: "requests" });
  assert.equal(result.changed, true);
  assert.equal(result.catalogChanged, false);
  assert.equal(f.remoteFile("requests.json"), "new");
  assert.equal(f.remoteFile("pets.json"), "stale");
});

test("lost push response followed by a descendant still reports publication", (t) => {
  const f = fixture(t, "stale");
  let published;
  f.hooks.push = (args, options) => {
    command(f.worker, "git", args, options);
    published = f.git(f.remote, "rev-parse", "main");
    f.advance("new");
    return { status: 1, stdout: "" };
  };
  const result = f.publish();
  assert.equal(result.changed, true);
  assert.equal(result.commit, published);
  assert.notEqual(result.commit, f.git(f.remote, "rev-parse", "main"));
  assert.equal(f.counts().generations, 1);
});

test("retry exhaustion fails explicitly without publishing stale outputs", (t) => {
  const f = fixture(t);
  f.hooks.generate = (n) => f.advance(`new-${n}`);
  assert.throws(() => f.publish(), /exhausted 3 attempts/);
  assert.equal(f.counts().generations, 3);
  assert.equal(f.remoteFile("pets.json"), "old");
  assert.equal(f.remoteFile("source.txt"), "new-3");
});

for (const stage of ["install", "generate", "validate"]) {
  test(`${stage} failure stops without committing`, (t) => {
    const f = fixture(t, "stale");
    const before = f.git(f.remote, "rev-parse", "main");
    f.hooks[stage] = () => {
      throw new Error(`${stage} failed`);
    };
    assert.throws(() => f.publish(), new RegExp(`${stage} failed`));
    assert.equal(f.git(f.remote, "rev-parse", "main"), before);
  });
}

test("non-race push failure is not silently successful", (t) => {
  const f = fixture(t, "stale");
  f.hooks.push = () => ({ status: 1, stdout: "" });
  assert.throws(() => f.publish(), /push failed without main advancing/);
  assert.equal(f.remoteFile("pets.json"), "stale");
});

test("command-line publication refuses local and PR contexts before touching Git", () => {
  const script = new URL("../publish-generated-snapshot.mjs", import.meta.url);
  for (const env of [
    {},
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "pull_request",
    },
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/feature",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
  ]) {
    const result = spawnSync(process.execPath, [script.pathname, "listings"], {
      env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /requires a disposable main-branch Actions checkout/,
    );
  }
});
