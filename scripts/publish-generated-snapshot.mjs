import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const snapshots = {
  listings: {
    files: [
      "README.md",
      "docs/zh-CN/README.md",
      "docs/ko/README.md",
      "docs/ja/README.md",
      "docs/es/README.md",
      "pets.json",
      "install-manifest.json",
    ],
    generate: "readmes",
    validate: ["npm", ["run", "lint"]],
    message: "chore: update generated previews and readmes",
  },
  requests: {
    files: ["requests.json"],
    generate: "requests",
    validate: ["pnpm", ["exec", "prettier", "--check", "requests.json"]],
    message: "chore: sync pet request catalog",
  },
};

// This runs only in disposable main-branch Actions checkouts. Never rebase an
// old generated snapshot: regenerate from the latest source on every attempt.
export function publishSnapshot({
  mode,
  cwd = process.cwd(),
  run,
  attempts = 3,
}) {
  const snapshot = snapshots[mode];
  if (!snapshot) throw new Error(`Unknown snapshot: ${mode}`);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }
  run ??= (command, args, { allowFailure = false } = {}) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0 && !allowFailure) {
      throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
    }
    return { status: result.status, stdout: result.stdout || "" };
  };
  const git = (...args) => run("git", args).stdout.trim();
  const fetchMain = () => {
    git("fetch", "origin", "refs/heads/main:refs/remotes/origin/main");
    return git("rev-parse", "refs/remotes/origin/main");
  };

  git("config", "user.name", "github-actions[bot]");
  git(
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  );
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const base = fetchMain();
    git("reset", "--hard", base);
    // The lockfile may also have moved since checkout or the previous attempt.
    run("pnpm", ["install", "--frozen-lockfile"]);
    run("npm", ["run", snapshot.generate]);
    run(...snapshot.validate);
    git("add", "--", ...snapshot.files);
    const changedFiles = git("diff", "--cached", "--name-only")
      .split("\n")
      .filter(Boolean);
    if (changedFiles.some((file) => !snapshot.files.includes(file))) {
      throw new Error(
        "Refusing to publish files outside the snapshot allowlist",
      );
    }
    // Even a no-op must be checked against the current remote, otherwise a new
    // pet arriving during generation could be silently left out.
    if (fetchMain() !== base) {
      console.log(`main advanced on attempt ${attempt}; regenerating`);
      continue;
    }
    if (changedFiles.length === 0) {
      return { changed: false, catalogChanged: false, commit: base };
    }
    git("commit", "-m", snapshot.message);
    const commit = git("rev-parse", "HEAD");
    const push = run("git", ["push", "origin", "HEAD:refs/heads/main"], {
      allowFailure: true,
    });
    if (push.status === 0) {
      return {
        changed: true,
        catalogChanged: changedFiles.includes("pets.json"),
        commit,
      };
    }
    // A non-fast-forward is recoverable. Permission/network/server errors with
    // an unchanged remote are real failures, not successful skipped updates.
    const remote = fetchMain();
    // A dropped connection can report failure after the server accepted us.
    if (
      run("git", ["merge-base", "--is-ancestor", commit, remote], {
        allowFailure: true,
      }).status === 0
    ) {
      return {
        changed: true,
        catalogChanged: changedFiles.includes("pets.json"),
        commit,
      };
    }
    if (remote === base)
      throw new Error("Snapshot push failed without main advancing");
    console.log(
      `main advanced during push on attempt ${attempt}; regenerating`,
    );
  }
  throw new Error(
    `main kept advancing; snapshot publication exhausted ${attempts} attempts`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  const allowedEvents =
    mode === "listings"
      ? ["push", "workflow_dispatch"]
      : ["issues", "issue_comment", "schedule", "workflow_dispatch"];
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !allowedEvents.includes(process.env.GITHUB_EVENT_NAME)
  ) {
    throw new Error(
      "Snapshot publication requires a disposable main-branch Actions checkout",
    );
  }
  const result = publishSnapshot({ mode });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\ncatalog-changed=${result.catalogChanged}\ngenerated-commit=${result.changed}\nvalidated-sha=${result.commit}\n`,
    );
  }
}
