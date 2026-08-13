// 技能本地化：从服务器同步公开 skill 到客户端本地 skills 目录，并提供本地 Python 执行
import { app } from "electron";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { apiClient } from "./api.js";
import type { SkillDto } from "@br-agent/shared";

export interface LocalSkill {
  id: string;
  name: string;
  description: string;
  scripts: string[];
  skilMd: string; // SKILL.md 内容（注入 systemPrompt 引导 agent 正确使用技能）
}

function localSkillsRoot(): string {
  return join(app.getPath("userData"), "skills");
}

/** 把服务器可见 skill 下载解压到本地 skills 目录，返回本地技能清单 */
export async function syncSkillsToLocal(): Promise<LocalSkill[]> {
  const skills = await apiClient.get<SkillDto[]>("/api/skills");
  const root = localSkillsRoot();
  mkdirSync(root, { recursive: true });
  const result: LocalSkill[] = [];
  for (const s of skills) {
    if (!s.enabled) continue;
    try {
      const dl = await apiClient.get<{ zip: string }>(`/api/skills/${s.id}/download`);
      const target = join(root, s.id);
      mkdirSync(target, { recursive: true });
      const zip = new AdmZip(Buffer.from(dl.zip, "base64"));
      zip.extractAllTo(target, true);
      const mdPath = join(target, "SKILL.md");
      const skilMd = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : "";
      result.push({ id: s.id, name: s.name, description: s.description, scripts: s.scripts ?? [], skilMd });
    } catch {
      // 单个技能同步失败跳过，不影响其他
    }
  }
  return result;
}

/** 打包的 Python 解释器（随安装包分发，避免依赖用户机器环境）；不存在则回退系统 python */
function pythonCmd(): string {
  const bundled = join(process.resourcesPath, "python", "python.exe");
  return existsSync(bundled) ? bundled : "python";
}

/** 本地执行 skill 脚本（用打包/系统 Python；脚本在本地 skills 目录） */
export function runLocalSkillScript(skillId: string, script: string, args: string[]): Promise<string> {
  const scriptsDir = join(localSkillsRoot(), skillId, "scripts");
  const scriptPath = join(scriptsDir, script);
  return new Promise<string>((resolve) => {
    // embed Python 的 ._pth 不自动加脚本目录 → 用 wrapper 注入 sys.path（脚本间 from config import 等）
    // 系统 Python 则直接跑（其 sys.path[0] 自动为脚本目录）
    const bundled = join(process.resourcesPath, "python", "python.exe");
    const useBundled = existsSync(bundled);
    const python = useBundled ? bundled : "python";
    const pyArgs = useBundled
      ? [join(process.resourcesPath, "python", "run_skill.py"), scriptsDir, scriptPath, ...args]
      : [scriptPath, ...args];
    // PYTHONUTF8 强制 UTF-8 输出（防 GBK 乱码）；cwd 设为脚本目录（相对文件读取正确）
    const proc = spawn(python, pyArgs, {
      cwd: scriptsDir,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve(JSON.stringify({ exitCode: code, stdout, stderr })));
    proc.on("error", (e) => resolve(JSON.stringify({ error: `本地执行失败（需本机安装 Python）：${e.message}` })));
  });
}

export function localSkillsExist(): boolean {
  return existsSync(localSkillsRoot());
}
