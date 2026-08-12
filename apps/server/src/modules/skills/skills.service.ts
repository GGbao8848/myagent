// 技能服务：列表/加载/上传/启停，SKILL.md 注入 systemPrompt
import { resolve, join, relative, basename } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, renameSync } from "node:fs";
import AdmZip from "adm-zip";
import { prisma } from "../../db/index.js";
import { loadConfig } from "../../config.js";
import { runPython, safeResolve } from "../../agent/tools.js";
import type { SkillDto } from "@br-agent/shared";

const config = loadConfig();
const skillsRoot = join(config.dataDir, "skills");

function skillDir(owner: string, id: string): string {
  return owner ? join(skillsRoot, owner, id) : join(skillsRoot, id);
}

function readSkillMd(dir: string): { name: string; description: string } | null {
  const mdPath = join(dir, "SKILL.md");
  if (!existsSync(mdPath)) return null;
  const raw = readFileSync(mdPath, "utf8");
  // 解析 frontmatter
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  let name = basename(dir);
  let description = "";
  if (m) {
    const fm = m[1];
    const nameM = fm.match(/^name:\s*(.+)$/m);
    const descM = fm.match(/^description:\s*(.+)$/m);
    if (nameM) name = nameM[1].trim();
    if (descM) description = descM[1].trim();
  } else {
    const firstLine = raw.split("\n")[0];
    if (firstLine.startsWith("#")) name = firstLine.slice(1).trim();
  }
  return { name, description };
}

export async function listSkills(owner: string): Promise<SkillDto[]> {
  // 公共 + 当前用户私有
  const skills = await prisma.skill.findMany({
    where: { OR: [{ owner: "" }, { owner }] },
    orderBy: { createdAt: "desc" },
  });
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    owner: s.owner,
    enabled: s.enabled,
    isCustom: s.isCustom,
    scripts: listSkillScripts(skillDir(s.owner, s.id)),
    createdAt: s.createdAt.toISOString(),
  }));
}

/** 列出技能 scripts/ 目录下的可执行 Python 脚本（供客户端注册工具；涉密技能同样只给脚本名） */
function listSkillScripts(dir: string): string[] {
  const scriptsDir = join(dir, "scripts");
  if (!existsSync(scriptsDir)) return [];
  try {
    return readdirSync(scriptsDir).filter((f) => f.endsWith(".py")).sort();
  } catch {
    return [];
  }
}

/** 下载技能压缩包（公开/自己的私有；供客户端同步到本地） */
export async function downloadSkillZip(owner: string, id: string): Promise<{ name: string; zip: string }> {
  const skill = await prisma.skill.findFirst({ where: { id, OR: [{ owner: "" }, { owner }] } });
  if (!skill) throw new Error("技能不存在或无权限");
  const dir = skillDir(skill.owner, id);
  if (!existsSync(dir)) throw new Error("技能文件不存在");
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  return { name: skill.name, zip: zip.toBuffer().toString("base64") };
}

/** 服务器执行技能脚本（web 端备用；客户端已改为本地执行） */
export async function executeSkill(
  owner: string,
  id: string,
  script: string,
  args: string[] = [],
  input = ""
): Promise<{ exitCode?: unknown; stdout?: string; stderr?: string; error?: string }> {
  const skill = await prisma.skill.findFirst({ where: { id, OR: [{ owner: "" }, { owner }] } });
  if (!skill) throw new Error("技能不存在或无权限");
  const dir = skillDir(skill.owner, id);
  const relDir = relative(config.dataDir, dir).replace(/\\/g, "/");
  // 脚本在 scripts/ 子目录下（listSkillScripts 返回的就是其中的文件名）
  const scriptPath = safeResolve(join(relDir, "scripts"), script);
  if (!existsSync(scriptPath)) return { error: `脚本不存在：${script}` };
  const raw = await runPython([scriptPath, ...args], dir, { timeout: 60, maxMemoryMb: 256 });
  try {
    return JSON.parse(raw) as { exitCode?: unknown; stdout?: string; stderr?: string };
  } catch {
    return { stdout: raw };
  }
}

export async function installSkill(owner: string, zipBuffer: Buffer, isPublic = false): Promise<SkillDto> {
  // 公共技能：owner 存 ""（所有用户可见），目录落 data/skills/<id>；私有落 data/skills/<owner>/<id>
  const skillOwner = isPublic ? "" : owner;
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  // 找到 SKILL.md（可在根或子目录）
  const skillEntry = entries.find((e) => e.entryName.endsWith("SKILL.md"));
  if (!skillEntry) {
    throw new Error("压缩包内未找到 SKILL.md");
  }
  // 技能 ID = SKILL.md 所在目录名；若在 zip 根目录（无父目录），
  // 取 zip 内首个顶层目录名（技能通常含 scripts/ 等子目录）
  const skillParts = skillEntry.entryName.split("/").filter(Boolean);
  let id = skillParts.slice(-2, -1)[0] ?? "";
  if (!id || id === "SKILL.md") {
    id = skillParts[0] !== "SKILL.md" ? skillParts[0] : "";
  }
  if (!id) {
    const topDir = entries
      .map((e) => e.entryName.split("/").filter(Boolean)[0])
      .find((p) => p && p !== "SKILL.md");
    id = topDir || "skill-" + Date.now();
  }

  const target = skillDir(skillOwner, id);
  // 路径穿越校验
  for (const entry of entries) {
    const full = resolve(target, entry.entryName);
    const rel = relative(target, full);
    if (rel.startsWith("..")) {
      throw new Error(`压缩包内存在非法路径：${entry.entryName}`);
    }
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  zip.extractAllTo(target, true);

  // 若 zip 内所有文件都在单一顶层目录下（如 calc_skill/...），
  // 去掉这层冗余目录，让技能根目录直接含 SKILL.md
  const entriesAtRoot = zip.getEntries().map((e) => e.entryName.split("/").filter(Boolean)[0]);
  const topDirs = new Set(entriesAtRoot);
  if (topDirs.size === 1) {
    const only = [...topDirs][0];
    const inner = join(target, only);
    if (existsSync(join(inner, "SKILL.md"))) {
      for (const child of readdirSync(inner)) {
        renameSync(join(inner, child), join(target, child));
      }
      rmSync(inner, { recursive: true, force: true });
    }
  }

  const meta = readSkillMd(target);
  const skill = await prisma.skill.upsert({
    where: { id },
    create: {
      id,
      name: meta?.name ?? id,
      description: meta?.description ?? "",
      category: "custom",
      owner: skillOwner,
      enabled: true,
      isCustom: true,
    },
    update: {
      name: meta?.name ?? id,
      description: meta?.description ?? "",
      isCustom: true,
    },
  });
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    owner: skill.owner,
    enabled: skill.enabled,
    isCustom: skill.isCustom,
    scripts: listSkillScripts(skillDir(skill.owner, skill.id)),
    createdAt: skill.createdAt.toISOString(),
  };
}

export async function setSkillEnabled(id: string, owner: string, enabled: boolean): Promise<void> {
  await prisma.skill.updateMany({
    where: { id, OR: [{ owner: "" }, { owner }] },
    data: { enabled },
  });
}

export async function deleteSkill(id: string, owner: string): Promise<void> {
  const skill = await prisma.skill.findFirst({ where: { id, owner } });
  if (!skill) throw new Error("技能不存在或无权限");
  await prisma.skill.delete({ where: { id } });
  rmSync(skillDir(owner, id), { recursive: true, force: true });
}

/** 异步版本：读取启用技能并拼接 systemPrompt */
export async function buildSkillPromptAsync(owner: string): Promise<{ prompt: string; skillDirs: string[] }> {
  const skills = await prisma.skill.findMany({
    where: { enabled: true, OR: [{ owner: "" }, { owner }] },
  });
  let prompt = "";
  const skillDirs: string[] = [];
  for (const s of skills) {
    const dir = skillDir(s.owner, s.id);
    const mdPath = join(dir, "SKILL.md");
    if (!existsSync(mdPath)) continue;
    const content = readFileSync(mdPath, "utf8");
    const relDir = relative(config.dataDir, dir).replace(/\\/g, "/");
    prompt += `\n\n## 技能：${s.name}\n${content}\n\n（技能路径：使用 run_script 工具时 cwd 填 ${relDir}，脚本路径相对 cwd。）`;
    skillDirs.push(relDir);
  }
  return { prompt, skillDirs };
}
