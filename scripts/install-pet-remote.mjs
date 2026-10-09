#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import {
  assertPetId,
  assertSha256,
  assertWebp,
  hashBuffer,
  MAX_PET_JSON_BYTES,
  MAX_SPRITESHEET_BYTES,
  prepareInstallRoot,
  replaceInstallDirectory,
} from "./install-utils.mjs";

const DEFAULT_RAW_BASE =
  "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main";
const MAX_MANIFEST_BYTES = 1_000_000;

function usage() {
  console.log(`Usage:
  npx @legeling/codex-pet                       Interactive menu (TTY only)
  npx --yes @legeling/codex-pet list            List available pets
  npx --yes @legeling/codex-pet search <words>  Search IDs and names
  npx --yes @legeling/codex-pet install <id>    Install a pet
  npx --yes @legeling/codex-pet download <id> --output <directory>
  npx --yes @legeling/codex-pet contribute      Request / submission guide

Global install: npm install -g @legeling/codex-pet
Both codex-pet and cpet are available as commands. Requires Node.js 20+.

Options:
  --codex-home <path>  Install into a custom Codex home directory
  --raw-base <url>     Use an explicit HTTPS repository ref
  --force              Replace an existing installation atomically
  --no-stats           Skip the anonymous install counter
  --list               List available pets
  --output <path>      Download into <path>/<id>/ without installing
  --lang <en|zh>       Menu language (defaults to terminal locale)
  --help               Show this help

Environment:
  CODEX_HOME                    Defaults to ~/.codex when unset
  AWESOME_CODEX_PET_RAW_BASE    Override the repository ref URL
  AWESOME_CODEX_PET_NO_STATS=1  Skip the anonymous install counter`);
}

function normalizeRawBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid raw base URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("The raw base URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "The raw base URL must not contain credentials, a query, or a fragment",
    );
  return value.replace(/\/+$/, "");
}

export function parseArgs(rawArgs) {
  let codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  let rawBase = normalizeRawBase(
    process.env.AWESOME_CODEX_PET_RAW_BASE || DEFAULT_RAW_BASE,
  );
  let petId = null;
  let force = false;
  let noStats = process.env.AWESOME_CODEX_PET_NO_STATS === "1";
  let list = false;
  let output;
  let lang = /^(zh)/i.test(
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "",
  )
    ? "zh"
    : "en";
  const positional = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--") {
      positional.push(...rawArgs.slice(index + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--no-stats") {
      noStats = true;
      continue;
    }
    if (["--codex-home", "--raw-base", "--output", "--lang"].includes(arg)) {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--codex-home") codexHome = value;
      else if (arg === "--raw-base") rawBase = normalizeRawBase(value);
      else if (arg === "--output") output = value;
      else lang = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    positional.push(arg);
  }

  if (!["en", "zh"].includes(lang)) throw new Error("--lang must be en or zh");
  if (list && positional.length)
    throw new Error("--list cannot be combined with a command or pet id");
  let command = list ? "list" : positional.shift() || "menu";
  if (command.includes("--")) {
    petId = command;
    command = "install";
  }
  if (["install", "download"].includes(command)) petId ||= positional.shift();
  const query =
    command === "search" ? positional.splice(0).join(" ").trim() : "";
  if (
    !["menu", "list", "search", "install", "download", "contribute"].includes(
      command,
    )
  )
    throw new Error(`Unknown command: ${command}`);
  if (positional.length)
    throw new Error(`Unexpected extra argument: ${positional[0]}`);
  if (command === "search" && !query)
    throw new Error("search requires a keyword");
  if (["install", "download"].includes(command)) {
    if (!petId) throw new Error(`${command} requires a pet id`);
    assertPetId(petId);
  }
  if (command === "download" && !output)
    throw new Error("download requires --output <directory>");
  if (output && command !== "download")
    throw new Error("--output is only supported by download");
  return {
    codexHome,
    force,
    help: false,
    command,
    query,
    output,
    lang,
    noStats,
    petId,
    rawBase,
  };
}

async function fetchBytes(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok)
      throw new Error(`Download failed (${response.status}): ${url}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel();
      throw new Error(
        `Downloaded file exceeds the ${maxBytes}-byte safety limit`,
      );
    }
    if (!response.body) throw new Error(`Download returned no body: ${url}`);
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(
            `Downloaded file exceeds the ${maxBytes}-byte safety limit`,
          );
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, totalBytes);
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readManifest(rawBase) {
  const bytes = await fetchBytes(
    `${rawBase}/install-manifest.json`,
    MAX_MANIFEST_BYTES,
  );
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid install manifest: ${error.message}`);
  }
  if (
    manifest?.schemaVersion !== 1 ||
    typeof manifest.pets !== "object" ||
    Array.isArray(manifest.pets) ||
    manifest.pets === null
  ) {
    throw new Error("Invalid install manifest schema");
  }
  return manifest;
}

function validateRecord(record, petId) {
  if (!record || typeof record !== "object") {
    throw new Error(`Pet not found in install manifest: ${petId}`);
  }
  return {
    petJsonSha256: assertSha256(record.petJsonSha256, `${petId} pet.json hash`),
    petJsonBytes: Number(record.petJsonBytes),
    spritesheetSha256: assertSha256(
      record.spritesheetSha256,
      `${petId} spritesheet hash`,
    ),
    spritesheetBytes: Number(record.spritesheetBytes),
    name: record.name || petId,
    spriteVersionNumber: record.spriteVersionNumber ?? 1,
  };
}

function validateSize(actual, expected, label) {
  if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) {
    throw new Error(`${label} size does not match the install manifest`);
  }
}

async function reportInstall(petId, noStats) {
  if (noStats) return;
  const statsApi =
    process.env.AWESOME_CODEX_PET_STATS_API || "https://api.codexpet.top";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(
      `${statsApi.replace(/\/$/, "")}/track/install?slug=${encodeURIComponent(petId)}`,
      {
        method: "POST",
        headers: { "X-Event-ID": randomUUID() },
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));
  } catch (error) {
    console.warn(
      "Installed successfully, but anonymous install statistics could not be reported.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function installPet(options, manifest) {
  const record = validateRecord(manifest.pets[options.petId], options.petId);

  const petJsonBytes = await fetchBytes(
    `${options.rawBase}/pets/${options.petId}/pet.json`,
    MAX_PET_JSON_BYTES,
  );
  const spritesheetBytes = await fetchBytes(
    `${options.rawBase}/pets/${options.petId}/spritesheet.webp`,
    MAX_SPRITESHEET_BYTES,
  );

  try {
    validateSize(petJsonBytes.length, record.petJsonBytes, "pet.json");
    validateSize(
      spritesheetBytes.length,
      record.spritesheetBytes,
      "spritesheet.webp",
    );
    if (hashBuffer(petJsonBytes) !== record.petJsonSha256) {
      throw new Error("pet.json failed SHA-256 verification");
    }
    if (hashBuffer(spritesheetBytes) !== record.spritesheetSha256) {
      throw new Error("spritesheet.webp failed SHA-256 verification");
    }
    assertWebp(spritesheetBytes);

    const pet = JSON.parse(petJsonBytes.toString("utf8"));
    if (pet?.id !== options.petId) {
      throw new Error("pet.json id does not match the requested pet id");
    }
    if (pet.spritesheetPath !== "spritesheet.webp") {
      throw new Error("pet.json spritesheetPath must be spritesheet.webp");
    }
  } catch (error) {
    throw new Error(`Invalid downloaded pet package: ${error.message}`);
  }

  const petsRoot =
    options.command === "download"
      ? options.output
      : join(options.codexHome, "pets");
  let stageDir;
  try {
    prepareInstallRoot(petsRoot);
    stageDir = mkdtempSync(join(petsRoot, `.${options.petId}.tmp-`));
    writeFileSync(join(stageDir, "pet.json"), petJsonBytes);
    writeFileSync(join(stageDir, "spritesheet.webp"), spritesheetBytes);
    const targetDir = replaceInstallDirectory({
      force: options.force,
      petId: options.petId,
      petsRoot,
      stageDir,
    });
    stageDir = null;
    console.log(
      `${options.command === "download" ? "Downloaded" : options.force ? "Updated" : "Installed"} ${options.petId} to ${targetDir}`,
    );
    if (options.command !== "download")
      await reportInstall(options.petId, options.noStats);
  } finally {
    if (stageDir) rmSync(stageDir, { force: true, recursive: true });
  }
}

// Strip terminal control characters from untrusted catalog labels.
const display = (value) => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function matchingPets(manifest, query = "") {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(manifest.pets)
    .filter(([id, record]) => {
      assertPetId(id);
      const haystack = [
        id,
        record.name,
        ...Object.values(record.localizedNames || {}),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

function petLabel([id, record], lang) {
  return `${id} - ${display(record.localizedNames?.[lang] || record.name || id)} (v${record.spriteVersionNumber ?? 1})`;
}

function contribute(lang) {
  console.log(
    lang === "zh"
      ? "请求社区制作：https://codexpet.top/zh/request\n制作或提交自己的宠物：https://codexpet.top/guide\n投稿仅包含 submission.json、pet.json、spritesheet.webp。请如实填写作者、来源和使用许可；先检查动画与透明边缘，再按照网站流程提交。此命令不会上传文件或创建 PR。"
      : "Request a pet: https://codexpet.top/request\nCreate or submit your pet: https://codexpet.top/guide\nSubmit only submission.json, pet.json and spritesheet.webp. Credit the author and sources, specify usage terms, and review animation and transparent edges before following the website submission workflow. This command does not upload files or create a PR.",
  );
}

async function interactive(options) {
  const zh = options.lang === "zh";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let manifest;
  try {
    console.log(
      zh
        ? "Codex Pet · 小宠物\n1. 浏览并安装\n2. 搜索并安装\n3. 下载到目录\n4. 贡献 / 请求制作\n0. 退出"
        : "Codex Pet\n1. Browse and install\n2. Search and install\n3. Download to a directory\n4. Contribute / request\n0. Exit",
    );
    const action = (
      await rl.question(zh ? "请选择 [0-4]：" : "Choose [0-4]: ")
    ).trim();
    if (!action || action === "0") return;
    if (action === "4") {
      contribute(options.lang);
      return;
    }
    if (!["1", "2", "3"].includes(action)) throw new Error("Invalid selection");
    const query =
      action === "1"
        ? ""
        : await rl.question(
            zh ? "搜索关键词（留空浏览全部）：" : "Search (empty for all): ",
          );
    manifest = await readManifest(options.rawBase);
    const pets = matchingPets(manifest, query);
    if (!pets.length) {
      console.log(zh ? "没有匹配的宠物。" : "No matching pets.");
      return;
    }
    let offset = 0;
    let selected;
    while (!selected) {
      const page = pets.slice(offset, offset + 20);
      console.log(
        page
          .map((pet, i) => `${i + 1}. ${petLabel(pet, options.lang)}`)
          .join("\n"),
      );
      const choice = (
        await rl.question(
          zh
            ? "选择编号，n 下一页，p 上一页，q 退出："
            : "Number, n next, p previous, q exit: ",
        )
      ).trim();
      if (choice === "q" || !choice) return;
      if (choice === "n") {
        offset = offset + 20 < pets.length ? offset + 20 : offset;
        continue;
      }
      if (choice === "p") {
        offset = Math.max(0, offset - 20);
        continue;
      }
      if (!/^[1-9][0-9]*$/.test(choice) || !page[Number(choice) - 1]) {
        console.log(zh ? "编号无效。" : "Invalid number.");
        continue;
      }
      selected = page[Number(choice) - 1];
    }
    const output =
      action === "3"
        ? (await rl.question(zh ? "下载目录：" : "Download directory: ")).trim()
        : undefined;
    if (action === "3" && !output) return;
    const petId = selected[0];
    console.log(`https://codexpet.top/pets/${petId}`);
    const confirm = await rl.question(
      zh ? "确认下载此宠物？[y/N]：" : "Download this pet? [y/N]: ",
    );
    if (confirm.trim().toLowerCase() !== "y") return;
    await installPet(
      {
        ...options,
        petId,
        output,
        command: action === "3" ? "download" : "install",
      },
      manifest,
    );
  } finally {
    rl.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    usage();
    return;
  }
  if (options.command === "menu") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      usage();
      return;
    }
    return interactive(options);
  }
  if (options.command === "contribute") {
    contribute(options.lang);
    return;
  }
  const manifest = await readManifest(options.rawBase);
  if (["list", "search"].includes(options.command)) {
    const pets = matchingPets(manifest, options.query);
    console.log(
      pets.length
        ? pets.map((pet) => petLabel(pet, options.lang)).join("\n")
        : "No matching pets.",
    );
    return;
  }
  await installPet(options, manifest);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
