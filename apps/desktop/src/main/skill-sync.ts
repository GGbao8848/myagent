// 技能本地化：从服务器同步公开 skill 到客户端本地 skills 目录，并提供本地 Python 执行
import { app } from "electron";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { apiClient } from "./api.js";
import type { SkillDto } from "@br-agent/shared";

export interface LocalSkill {
  id: string;
  name: string;
  description: string;
  scripts: string[];
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
      result.push({ id: s.id, name: s.name, description: s.description, scripts: s.scripts ?? [] });
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
  const scriptPath = join(localSkillsRoot(), skillId, "scripts", script);
  return new Promise<string>((resolve) => {
    // PYTHONUTF8=1 强制 Python 用 UTF-8 输出，避免 Windows 默认 GBK 导致 agent 读成乱码
    const proc = spawn(pythonCmd(), [scriptPath, ...args], {
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
