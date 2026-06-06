// Vercel serverless function — รับทุกเส้นทาง /api/* แล้วส่งต่อ handler กลาง
// ไฟล์หน้าเว็บ (public/) Vercel เสิร์ฟเป็น static เอง
import { handleApi } from "../lib/core.ts";
import { getStore } from "../lib/store.ts";

export default async function handler(req: any, res: any) {
  try {
    const url = new URL(req.url, "http://localhost");
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : req.body
          ? JSON.parse(req.body)
          : {};

    const { status, body: payload } = await handleApi({
      method: req.method || "GET",
      pathname: url.pathname,
      query: url.searchParams,
      adminPass: req.headers["x-admin-pass"],
      body,
      store: getStore(),
    });

    res.status(status).json(payload);
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || "เกิดข้อผิดพลาดในระบบ" });
  }
}
