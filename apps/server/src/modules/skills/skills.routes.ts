// 技能模块：路由
import type { FastifyInstance } from "fastify";
import { listSkills, installSkill, setSkillEnabled, deleteSkill } from "./skills.service.js";

export function registerSkillRoutes(app: FastifyInstance): void {
  // 技能列表
  app.get("/api/skills", async (request) => {
    const user = request.authUser!;
    return listSkills(user.username);
  });

  // 上传 zip（管理员可选公共/私有；普通用户固定私有）
  app.post<{ Body: { zip?: unknown; public?: boolean } }>("/api/skills/upload", async (request, reply) => {
    const user = request.authUser!;
    const data = request.body as { zip?: unknown; public?: boolean };
    // 前端以 base64 或 binary 上传。这里约定 body 为 { zip: <base64> }
    if (!data?.zip || typeof data.zip !== "string") {
      reply.code(400).send({ error: "请上传 zip 文件（body.zip 为 base64）" });
      return;
    }
    const isPublic = !!data.public;
    // 仅管理员可上传公共技能
    if (isPublic && !user.isAdmin) {
      reply.code(403).send({ error: "仅管理员可上传公共技能" });
      return;
    }
    try {
      const buffer = Buffer.from(data.zip, "base64");
      const skill = await installSkill(user.username, buffer, isPublic);
      return skill;
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  // 启停
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    "/api/skills/:id",
    async (request, reply) => {
      const user = request.authUser!;
      if (typeof request.body?.enabled !== "boolean") {
        reply.code(400).send({ error: "缺少 enabled" });
        return;
      }
      await setSkillEnabled(request.params.id, user.username, request.body.enabled);
      return { ok: true };
    }
  );

  // 删除私有技能
  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const user = request.authUser!;
    try {
      await deleteSkill(request.params.id, user.username);
      return { ok: true };
    } catch (e) {
      reply.code(404).send({ error: (e as Error).message });
    }
  });
}
