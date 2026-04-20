#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { mkdir, writeFile as writeFile2, readdir, rm, readFile as readFile2, stat } from "fs/promises";
import { join as join3, dirname as dirname2, relative } from "path";
import { createInterface } from "readline";
import {
  searchSkillRepos,
  listSkillsInRepo,
  downloadSkillFiles,
  generateAgentsMd,
  parseSkillMd
} from "@skify/core";

// src/config.ts
import Conf from "conf";
import { homedir } from "os";
import { join } from "path";
var config = new Conf({
  projectName: "skify",
  defaults: {
    defaultTarget: "project"
  }
});
function getConfig() {
  return {
    registry: config.get("registry"),
    token: config.get("token"),
    githubToken: config.get("githubToken"),
    defaultTarget: config.get("defaultTarget")
  };
}
function setConfig(key, value) {
  config.set(key, value);
}
function getTargetDir(target, skillName, global = false) {
  const home = homedir();
  if (global) {
    const dirs2 = {
      cursor: join(home, ".cursor", "skills", skillName),
      claude: join(home, ".claude", "skills", skillName),
      project: join(home, ".agent", "skills", skillName)
    };
    return dirs2[target];
  }
  const dirs = {
    cursor: join(process.cwd(), ".cursor", "skills", skillName),
    claude: join(process.cwd(), ".claude", "skills", skillName),
    project: join(process.cwd(), ".agent", "skills", skillName)
  };
  return dirs[target];
}

// src/lockfile.ts
import { readFile, writeFile } from "fs/promises";
import { join as join2, dirname } from "path";
var LOCK_FILE = "skify.lock.json";
async function getLockFilePath(target, global) {
  const skillsDir = dirname(getTargetDir(target, "dummy", global));
  return join2(dirname(skillsDir), LOCK_FILE);
}
async function readLockFile(lockPath) {
  try {
    const content = await readFile(lockPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { version: 1, skills: {} };
  }
}
async function writeLockFile(lockPath, lock) {
  await writeFile(lockPath, JSON.stringify(lock, null, 2));
}
async function recordInstall(target, global, skillName, source, version, commit) {
  const lockPath = await getLockFilePath(target, global);
  const lock = await readLockFile(lockPath);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = lock.skills[skillName];
  lock.skills[skillName] = {
    name: skillName,
    source,
    version,
    commit,
    installedAt: existing?.installedAt || now,
    updatedAt: now
  };
  await writeLockFile(lockPath, lock);
}
async function removeFromLock(target, global, skillName) {
  const lockPath = await getLockFilePath(target, global);
  const lock = await readLockFile(lockPath);
  delete lock.skills[skillName];
  await writeLockFile(lockPath, lock);
}
async function getAllInstalled(target, global) {
  const lockPath = await getLockFilePath(target, global);
  const lock = await readLockFile(lockPath);
  return lock.skills;
}

// src/index.ts
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".txt", ".json", ".yaml", ".yml", ".ts", ".js", ".py", ".sh", ".toml", ".xml", ".html", ".css"]);
async function collectFiles(dir, baseDir) {
  const files = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join3(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, baseDir);
      Object.assign(files, nested);
    } else {
      const ext = "." + entry.name.split(".").pop().toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) {
        const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
        files[relPath] = await readFile2(fullPath, "utf-8");
      }
    }
  }
  return files;
}
async function confirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
async function fetchRegistry(path, options = {}) {
  const config2 = getConfig();
  if (!config2.registry) return null;
  const headers = { "Content-Type": "application/json" };
  if (options.token || config2.token) {
    headers.Authorization = `Bearer ${options.token || config2.token}`;
  }
  const res = await fetch(`${config2.registry}${path}`, { headers });
  if (!res.ok) return null;
  return res.json();
}
function getRegistryAuthOrExit(overrideToken) {
  const config2 = getConfig();
  const token = overrideToken || config2.token;
  if (!config2.registry) {
    console.log(pc.yellow("No registry configured. Use: skify config set registry <url>"));
    process.exit(1);
  }
  if (!token) {
    console.log(pc.yellow("No token configured. Use: skify config set token <token>"));
    process.exit(1);
  }
  return { registry: config2.registry, token };
}
var program = new Command();
program.name("skify").description("Agent Skills Kit - install & manage AI agent skills").version("0.1.0");
program.command("browse").description("Browse skills from private registry").option("-q, --query <query>", "Search query").action(async (options) => {
  const config2 = getConfig();
  if (!config2.registry) {
    console.log(pc.yellow("No registry configured. Use: skify config set registry <url>"));
    return;
  }
  const spinner = ora("Fetching from registry...").start();
  try {
    const query = options.query ? `?q=${encodeURIComponent(options.query)}` : "";
    const data = await fetchRegistry(`/api/skills${query}`);
    spinner.stop();
    if (!data?.skills?.length) {
      console.log(pc.yellow("No skills found in registry."));
      return;
    }
    console.log(pc.bold(`
Skills in registry:
`));
    for (const skill of data.skills) {
      const stars = skill.stars ? pc.dim(`\u2B50 ${skill.stars}`) : "";
      const installs = skill.installs ? pc.dim(`\u{1F4E6} ${skill.installs}`) : "";
      console.log(`  ${pc.green(skill.name)} ${stars} ${installs}`);
      if (skill.description) {
        console.log(`    ${pc.dim(skill.description)}`);
      }
    }
  } catch (err) {
    spinner.fail("Failed to fetch registry");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("search <query>").description("Search for skills on GitHub").option("-t, --token <token>", "GitHub token for API access").action(async (query, options) => {
  const spinner = ora("Searching skills...").start();
  try {
    const config2 = getConfig();
    const skills = await searchSkillRepos(query, options.token || config2.githubToken);
    spinner.stop();
    if (skills.length === 0) {
      console.log(pc.yellow("No skills found."));
      return;
    }
    console.log(pc.bold(`
Found ${skills.length} skill repositories:
`));
    for (const skill of skills) {
      console.log(`  ${pc.cyan(skill.repo)} ${pc.dim(`\u2B50 ${skill.stars}`)}`);
      if (skill.description) {
        console.log(`    ${pc.dim(skill.description)}`);
      }
    }
    console.log(pc.dim(`
Use ${pc.cyan("skify list <repo>")} to see skills in a repo`));
  } catch (err) {
    spinner.fail("Search failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("list [repo]").description("List skills in a GitHub repo, or list installed skills").option("-t, --token <token>", "GitHub token").option("-p, --path <path>", "Skills directory path", "skills").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-g, --global", "Use global skills").action(async (repo, options) => {
  const target = options.agent;
  if (!repo) {
    const installed = await getAllInstalled(target, options.global);
    const names = Object.keys(installed);
    if (names.length === 0) {
      console.log(pc.yellow("No skills installed."));
      return;
    }
    console.log(pc.bold(`
Installed skills:
`));
    for (const name of names) {
      const info = installed[name];
      const version = info.version ? pc.dim(`v${info.version}`) : "";
      const source = pc.dim(`\u2190 ${info.source}`);
      console.log(`  ${pc.green(name)} ${version} ${source}`);
    }
    return;
  }
  const spinner = ora("Fetching skills...").start();
  try {
    const config2 = getConfig();
    const skills = await listSkillsInRepo(repo, options.token || config2.githubToken, options.path);
    spinner.stop();
    if (skills.length === 0) {
      console.log(pc.yellow("No skills found in this repo."));
      return;
    }
    console.log(pc.bold(`
Skills in ${pc.cyan(repo)}:
`));
    for (const skill of skills) {
      console.log(`  - ${pc.green(skill)}`);
    }
    console.log(pc.dim(`
Use ${pc.cyan(`skify add ${repo}/<skill>`)} to install`));
  } catch (err) {
    spinner.fail("Failed to list skills");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
async function installFromRegistry(owner, repo, skillName, target, global) {
  const config2 = getConfig();
  if (!config2.registry) return false;
  try {
    const headers = {};
    if (config2.token) {
      headers.Authorization = `Bearer ${config2.token}`;
    }
    const res = await fetch(`${config2.registry}/api/download/${owner}/${repo}/${skillName}`, { headers });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.files || Object.keys(data.files).length === 0) return false;
    const targetDir = getTargetDir(target, skillName, global);
    await mkdir(targetDir, { recursive: true });
    for (const [path, content] of Object.entries(data.files)) {
      const fullPath = join3(targetDir, path);
      await mkdir(dirname2(fullPath), { recursive: true });
      await writeFile2(fullPath, content);
    }
    await recordInstall(target, global, skillName, `registry:${owner}/${repo}/${skillName}`);
    const installRes = await fetch(`${config2.registry}/api/skills/${owner}/${repo}/${skillName}/install`, {
      method: "POST",
      headers
    });
    return true;
  } catch {
    return false;
  }
}
async function installFromGitHub(repo, skillName, skillsPath, target, global, token) {
  const files = await downloadSkillFiles(repo, skillName, skillsPath, token);
  const targetDir = getTargetDir(target, skillName, global);
  await mkdir(targetDir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join3(targetDir, path);
    await mkdir(dirname2(fullPath), { recursive: true });
    await writeFile2(fullPath, content);
  }
  const skillMdPath = join3(targetDir, "SKILL.md");
  try {
    const content = await readFile2(skillMdPath, "utf-8");
    const meta = parseSkillMd(content);
    await recordInstall(target, global, skillName, `${repo}/${skillsPath}/${skillName}`, meta.version);
  } catch {
    await recordInstall(target, global, skillName, `${repo}/${skillsPath}/${skillName}`);
  }
}
program.command("add <source>").description("Install a skill (tries registry first, then GitHub)").option("-g, --global", "Install globally").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-t, --token <token>", "GitHub token").option("-p, --path <path>", "Skills directory path in repo", "skills").option("--github", "Force install from GitHub").action(async (source, options) => {
  const spinner = ora("Installing skill...").start();
  try {
    const config2 = getConfig();
    const githubToken = options.token || config2.githubToken;
    const target = options.agent;
    const parts = source.split("/");
    let owner;
    let repo;
    let skillName;
    if (parts.length === 3) {
      owner = parts[0];
      repo = parts[1];
      skillName = parts[2];
    } else if (parts.length === 2) {
      owner = parts[0];
      repo = parts[1];
      skillName = void 0;
    } else if (parts.length === 1) {
      skillName = parts[0];
      owner = "";
      repo = "";
    } else {
      throw new Error("Invalid source format. Use skill-name, owner/repo, or owner/repo/skill");
    }
    if (skillName && !options.github && config2.registry) {
      spinner.text = "Checking registry...";
      if (owner && repo) {
        const installed = await installFromRegistry(owner, repo, skillName, target, options.global);
        if (installed) {
          const targetDir = getTargetDir(target, skillName, options.global);
          spinner.succeed(`Installed ${pc.green(skillName)} from registry to ${pc.dim(targetDir)}`);
          return;
        }
      } else {
        const data = await fetchRegistry(`/api/skills?q=${encodeURIComponent(skillName)}`);
        if (data?.skills?.length > 0) {
          const skill = data.skills.find((s) => s.name === skillName) || data.skills[0];
          const installed = await installFromRegistry(skill.owner, skill.repo, skill.name, target, options.global);
          if (installed) {
            const targetDir = getTargetDir(target, skill.name, options.global);
            spinner.succeed(`Installed ${pc.green(skill.name)} from registry to ${pc.dim(targetDir)}`);
            return;
          }
        }
      }
      spinner.text = "Not in registry, trying GitHub...";
    }
    if (!owner || !repo) {
      throw new Error("Skill not found in registry. Use owner/repo/skill format for GitHub.");
    }
    const fullRepo = `${owner}/${repo}`;
    if (skillName) {
      await installFromGitHub(fullRepo, skillName, options.path, target, options.global, githubToken);
      const targetDir = getTargetDir(target, skillName, options.global);
      spinner.succeed(`Installed ${pc.green(skillName)} from GitHub to ${pc.dim(targetDir)}`);
    } else {
      const skills = await listSkillsInRepo(fullRepo, githubToken, options.path);
      if (skills.length === 0) {
        const files = await downloadSkillFiles(fullRepo, void 0, "", githubToken);
        const repoName = fullRepo.split("/").pop();
        const targetDir = getTargetDir(target, repoName, options.global);
        await mkdir(targetDir, { recursive: true });
        for (const [path, content] of Object.entries(files)) {
          const fullPath = join3(targetDir, path);
          await mkdir(dirname2(fullPath), { recursive: true });
          await writeFile2(fullPath, content);
        }
        await recordInstall(target, options.global, repoName, fullRepo);
        spinner.succeed(`Installed ${pc.green(repoName)} from GitHub to ${pc.dim(targetDir)}`);
      } else {
        spinner.text = `Installing ${skills.length} skills from GitHub...`;
        for (const skill of skills) {
          await installFromGitHub(fullRepo, skill, options.path, target, options.global, githubToken);
          console.log(`  ${pc.green("\u2713")} ${skill}`);
        }
        spinner.succeed(`Installed ${skills.length} skills from GitHub`);
      }
    }
  } catch (err) {
    spinner.fail("Installation failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("update [name]").description("Update installed skills (all or specific)").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-g, --global", "Use global skills").option("-t, --token <token>", "GitHub token").action(async (name, options) => {
  const spinner = ora("Updating skills...").start();
  try {
    const config2 = getConfig();
    const githubToken = options.token || config2.githubToken;
    const target = options.agent;
    const installed = await getAllInstalled(target, options.global);
    const toUpdate = name ? [name] : Object.keys(installed);
    if (toUpdate.length === 0) {
      spinner.warn("No skills to update");
      return;
    }
    let updated = 0;
    for (const skillName of toUpdate) {
      const info = installed[skillName];
      if (!info) {
        console.log(`  ${pc.yellow("\u26A0")} ${skillName} not found in lockfile`);
        continue;
      }
      spinner.text = `Updating ${skillName}...`;
      if (info.source.startsWith("registry:")) {
        const parts = info.source.replace("registry:", "").split("/");
        if (parts.length >= 3) {
          await installFromRegistry(parts[0], parts[1], parts[2], target, options.global);
          console.log(`  ${pc.green("\u2713")} ${skillName}`);
          updated++;
          continue;
        }
      }
      const sourceParts = info.source.split("/");
      if (sourceParts.length < 3) {
        console.log(`  ${pc.yellow("\u26A0")} ${skillName} has invalid source: ${info.source}`);
        continue;
      }
      const repo = `${sourceParts[0]}/${sourceParts[1]}`;
      const skillsPath = sourceParts.slice(2, -1).join("/") || "skills";
      await installFromGitHub(repo, skillName, skillsPath, target, options.global, githubToken);
      console.log(`  ${pc.green("\u2713")} ${skillName}`);
      updated++;
    }
    spinner.succeed(`Updated ${updated} skill(s)`);
  } catch (err) {
    spinner.fail("Update failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("read <name>").description("Read and output a skill (for agent consumption)").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-g, --global", "Read from global installation").action(async (name, options) => {
  try {
    const target = options.agent;
    const targetDir = getTargetDir(target, name, options.global);
    const skillMdPath = join3(targetDir, "SKILL.md");
    const content = await readFile2(skillMdPath, "utf-8");
    const skill = parseSkillMd(content);
    console.log(`
${"=".repeat(60)}`);
    console.log(`SKILL: ${skill.name}`);
    console.log(`BASE_DIR: ${targetDir}`);
    console.log("=".repeat(60));
    console.log(skill.body);
    console.log("=".repeat(60) + "\n");
  } catch {
    console.error(pc.red(`Skill "${name}" not found`));
    process.exit(1);
  }
});
program.command("remove <name>").description("Remove an installed skill").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-g, --global", "Remove from global installation").action(async (name, options) => {
  const spinner = ora(`Removing ${name}...`).start();
  try {
    const target = options.agent;
    const targetDir = getTargetDir(target, name, options.global);
    await rm(targetDir, { recursive: true, force: true });
    await removeFromLock(target, options.global, name);
    spinner.succeed(`Removed ${pc.green(name)}`);
  } catch (err) {
    spinner.fail("Removal failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("sync").description("Generate AGENTS.md from installed skills").option("-o, --output <path>", "Output file path", "AGENTS.md").option("--agent <name>", "Target agent (cursor/claude/project)", "project").option("-g, --global", "Use global skills").action(async (options) => {
  const spinner = ora("Syncing skills...").start();
  try {
    const target = options.agent;
    const skillsDir = dirname2(getTargetDir(target, "dummy", options.global));
    let entries = [];
    try {
      entries = await readdir(skillsDir);
    } catch {
      spinner.fail("No skills directory found");
      return;
    }
    const skills = [];
    for (const entry of entries) {
      const skillMdPath = join3(skillsDir, entry, "SKILL.md");
      try {
        await stat(skillMdPath);
        const content = await readFile2(skillMdPath, "utf-8");
        skills.push(parseSkillMd(content));
      } catch {
        continue;
      }
    }
    if (skills.length === 0) {
      spinner.warn("No skills found to sync");
      return;
    }
    const agentsMd = generateAgentsMd(skills);
    await writeFile2(options.output, agentsMd);
    spinner.succeed(`Synced ${skills.length} skills to ${pc.cyan(options.output)}`);
  } catch (err) {
    spinner.fail("Sync failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("publish <path>", { hidden: true }).description("Publish a local skill to private registry").action(async (source) => {
  const config2 = getConfig();
  if (!config2.registry) {
    console.log(pc.yellow("No registry configured. Use: skify config set registry <url>"));
    process.exit(1);
  }
  if (!config2.token) {
    console.log(pc.yellow("No token configured. Use: skify config set token <token>"));
    process.exit(1);
  }
  const skillDir = source.endsWith("SKILL.md") ? dirname2(source) : source;
  const skillMdPath = join3(skillDir, "SKILL.md");
  const content = await readFile2(skillMdPath, "utf-8");
  const pathParts = skillDir.replace(/\\/g, "/").split("/");
  const skillName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
  const meta = parseSkillMd(content);
  const displayName = meta.name || skillName;
  const files = await collectFiles(skillDir, skillDir);
  const fileCount = Object.keys(files).length;
  const confirmed = await confirm(`Publish "${displayName}" (${fileCount} file${fileCount !== 1 ? "s" : ""}) to registry?`);
  if (!confirmed) {
    console.log(pc.yellow("Cancelled."));
    process.exit(0);
  }
  const spinner = ora("Publishing skill...").start();
  try {
    spinner.text = "Publishing to registry...";
    const res = await fetch(`${config2.registry}/api/admin/skills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config2.token}`
      },
      body: JSON.stringify({
        owner: "local",
        repo: "skills",
        name: displayName,
        description: meta.description,
        tags: meta.tags,
        content,
        files
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Registry error: ${err}`);
    }
    spinner.succeed(`Published ${pc.green(displayName)} to registry`);
  } catch (err) {
    spinner.fail("Publish failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("unpublish <name>", { hidden: true }).description("Remove a skill from private registry").option("-o, --owner <owner>", "Owner name", "local").option("-r, --repo <repo>", "Repo name", "skills").action(async (name, options) => {
  const config2 = getConfig();
  if (!config2.registry || !config2.token) {
    console.log(pc.yellow("Registry and token required"));
    process.exit(1);
  }
  const confirmed = await confirm(`Remove "${name}" from registry?`);
  if (!confirmed) {
    console.log(pc.yellow("Cancelled."));
    process.exit(0);
  }
  const spinner = ora("Removing from registry...").start();
  try {
    const res = await fetch(`${config2.registry}/api/admin/skills/${options.owner}/${options.repo}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config2.token}` }
    });
    if (!res.ok) throw new Error("Failed to remove");
    spinner.succeed(`Removed ${pc.green(name)} from registry`);
  } catch (err) {
    spinner.fail("Removal failed");
    console.error(pc.red(String(err)));
    process.exit(1);
  }
});
program.command("token <action> [value]").description("Manage registry API tokens (list/create/revoke)").option("-n, --name <name>", "Token name for create").option("-p, --permissions <permissions>", "Comma-separated permissions (read,publish,admin)", "read").option("-t, --token <token>", "Admin token override").action(async (action, value, options) => {
  const { registry, token } = getRegistryAuthOrExit(options.token);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
  if (action === "list") {
    const spinner = ora("Fetching tokens...").start();
    try {
      const res = await fetch(`${registry}/api/admin/tokens`, { headers });
      if (!res.ok) {
        throw new Error(`${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      spinner.stop();
      if (!data.tokens?.length) {
        console.log(pc.yellow("No tokens found."));
        return;
      }
      console.log(pc.bold("\nRegistry tokens:\n"));
      for (const t of data.tokens) {
        console.log(`  ${pc.green(t.name)} ${pc.dim(t.id)}`);
        console.log(`    permissions: ${pc.cyan(t.permissions.join(","))}`);
        if (t.createdAt) console.log(`    created: ${pc.dim(t.createdAt)}`);
      }
      return;
    } catch (err) {
      spinner.fail("Failed to fetch tokens");
      console.error(pc.red(String(err)));
      process.exit(1);
    }
  }
  if (action === "create") {
    const name = options.name || value;
    if (!name) {
      console.log(pc.yellow("Usage: skify token create <name> --permissions read,publish"));
      process.exit(1);
    }
    const permissions = String(options.permissions || "read").split(",").map((p) => p.trim()).filter(Boolean);
    const spinner = ora("Creating token...").start();
    try {
      const res = await fetch(`${registry}/api/admin/tokens`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, permissions })
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      spinner.succeed(`Created token ${pc.green(data.token.name)} (${pc.dim(data.token.id)})`);
      console.log(pc.bold("\nToken value (shown once):"));
      console.log(pc.cyan(data.token.value));
      return;
    } catch (err) {
      spinner.fail("Failed to create token");
      console.error(pc.red(String(err)));
      process.exit(1);
    }
  }
  if (action === "revoke") {
    const tokenId = value;
    if (!tokenId) {
      console.log(pc.yellow("Usage: skify token revoke <token-id>"));
      process.exit(1);
    }
    const spinner = ora("Revoking token...").start();
    try {
      const res = await fetch(`${registry}/api/admin/tokens/${tokenId}/revoke`, {
        method: "POST",
        headers
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${await res.text()}`);
      }
      spinner.succeed(`Revoked token ${pc.green(tokenId)}`);
      return;
    } catch (err) {
      spinner.fail("Failed to revoke token");
      console.error(pc.red(String(err)));
      process.exit(1);
    }
  }
  console.log(pc.yellow("Usage: skify token list | create <name> --permissions read,publish | revoke <token-id>"));
  process.exit(1);
});
program.command("config <action> [key] [value]").description("Manage configuration (get/set registry, token, githubToken, defaultTarget)").action(async (action, key, value) => {
  if (action === "get") {
    const config2 = getConfig();
    if (key) {
      console.log(config2[key] || "");
    } else {
      console.log(JSON.stringify(config2, null, 2));
    }
  } else if (action === "set" && key && value) {
    setConfig(key, value);
    console.log(pc.green(`Set ${key} = ${value}`));
  } else {
    console.log(pc.yellow("Usage: skify config get [key] | set <key> <value>"));
  }
});
program.parse();
