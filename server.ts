// เซิร์ฟเวอร์สำหรับรันในเครื่อง (dev) — ห่อ handler กลางจาก lib/core.ts + เสิร์ฟไฟล์หน้าเว็บ
// รัน: node server.ts   (ต้องใช้ Node 24+ เพราะรัน .ts ตรงด้วย type-stripping)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { handleApi } from "./lib/core.ts";
import { getStore } from "./lib/store.ts";

const PUBLIC_DIR = join(process.cwd(), "public");
const PORT = Number(process.env.PORT) || 3000;
const store = getStore();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(res: any, urlPath: string): Promise<void> {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel === "/admin") rel = "/admin.html";
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ไม่พบหน้าที่ต้องการ");
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(body);
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("รูปแบบข้อมูลไม่ถูกต้อง")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const method = req.method || "GET";

    if (url.pathname.startsWith("/api/")) {
      const body = method === "POST" ? await readBody(req) : {};
      const { status, body: payload } = await handleApi({
        method,
        pathname: url.pathname,
        query: url.searchParams,
        adminPass: req.headers["x-admin-pass"] as string | undefined,
        body,
        store,
      });
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(payload));
    }

    if (method === "GET") return await serveStatic(res, url.pathname);

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "ไม่พบเส้นทางที่ต้องการ" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: (err as Error).message || "เกิดข้อผิดพลาดในระบบ" }));
  }
});

server.listen(PORT, () => {
  console.log(`แอพนัดหมายเปิดที่ http://localhost:${PORT}`);
  console.log(`หน้าจัดการร้าน: http://localhost:${PORT}/admin`);
});
