/**
 * dsh-workspace-tree — node half (v3)。
 *
 * v3 设计（grill 收敛）：工作区 = 目录强绑定，树结构完全由文件系统推导，
 * 不再有自定义逻辑文件夹（旧 folders/assignments 模型废弃，避免
 * 「UI 隔离 ≠ cwd 隔离」的环境污染问题）。
 *
 * 路由：
 *  - GET  /debug   工作区注册表投影（诊断用）
 *  - POST /mkdir   真实创建子目录 { parent, name } → { path }
 *                  （浏览器半区新建文件夹走这里，绕开官方 browse 能力——
 *                  官方 directoryFlow hole 被替换后 browse 装配不可用）
 *
 * 零持久化。
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Cordis 插件名（patch 行 id）。 */
const name = "dsh-workspace-tree";
/** 依赖的服务。 */
const inject = ["webServer"];

/** Host 路由前缀（避开 /plugins/ 的 client bundle 保留空间）。 */
const PREFIX = "/api/dsh-workspace-tree";

/** DSH 配置根目录（仅用于 README 说明；v3 无持久化）。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** 调试：输出工作区注册表（path/title/id），用于诊断文件系统树。 */
async function handleDebug(ctx, req, res) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry || typeof registry.list !== "function") {
    return sendJson(res, 200, { ok: false, error: "workspaceRegistry 不可用" });
  }
  const records = registry.list();
  sendJson(res, 200, {
    ok: true,
    workspaces: records.map((r) => ({
      workspaceId: String(r.id),
      title: r.title,
      path: r.path,
      sessionCount: Array.isArray(r.sessionIds) ? r.sessionIds.length : 0
    }))
  });
}

/** 新建子目录：真实 fs.mkdir（不依赖官方 browse 能力）。 */
async function handleMkdir(req, res) {
  const raw = JSON.parse(await readBody(req));
  const parent = typeof raw.parent === "string" ? raw.parent.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!parent || !name) return sendJson(res, 200, { ok: false, error: "parent 与 name 必填" });
  if (/[\\/:*?"<>|]/.test(name)) return sendJson(res, 200, { ok: false, error: "文件夹名包含非法字符" });
  const target = join(parent, name);
  await mkdir(target);
  sendJson(res, 200, { ok: true, path: target });
}

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url || "/", "http://x");
      const rest = url.pathname.split("/").filter(Boolean).slice(2);
      const head = rest[0];
      try {
        if (head === "debug" && (req.method === "GET" || req.method === "HEAD")) return await handleDebug(ctx, req, res);
        if (head === "mkdir" && req.method === "POST") return await handleMkdir(req, res);
        sendJson(res, 404, { ok: false, error: "not found" });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String((error && error.message) || error) });
      }
    }
  }), "dsh-workspace-tree: routes");
}

export { apply, inject, name };
