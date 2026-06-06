// เซิร์ฟเวอร์แอพนัดหมายรับบริการ — Node.js ล้วน ไม่มี dependency
// รัน: node server.ts   (ต้องใช้ Node 24+ เพราะรัน .ts ตรงด้วย type-stripping)

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = join(ROOT, "data");
const PUBLIC_DIR = join(ROOT, "public");
const APPTS_FILE = join(DATA_DIR, "appointments.json");
const SERVICES_FILE = join(DATA_DIR, "services.json");
const CONFIG_FILE = join(DATA_DIR, "config.json");

const PORT = Number(process.env.PORT) || 3000;

type Service = { id: string; name: string; durationMinutes: number; price: number };
type Config = { shopName: string; open: string; close: string; slotStepMinutes: number; adminPasscode: string };
type Status = "confirmed" | "cancelled";
type Appointment = {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  start: string; // "YYYY-MM-DDTHH:mm" (เวลาท้องถิ่น)
  end: string;   // "YYYY-MM-DDTHH:mm"
  status: Status;
  note: string;
  createdAt: string;
};

// ---------- ตัวช่วยอ่าน/เขียนไฟล์ ----------
async function readJSON(file: string): Promise<any> {
  return JSON.parse(await readFile(file, "utf8"));
}
async function readAppointments(): Promise<Appointment[]> {
  return readJSON(APPTS_FILE);
}
async function writeAppointments(list: Appointment[]): Promise<void> {
  await writeFile(APPTS_FILE, JSON.stringify(list, null, 2));
}
async function readServices(): Promise<Service[]> {
  return readJSON(SERVICES_FILE);
}
async function readConfig(): Promise<Config> {
  return readJSON(CONFIG_FILE);
}

// ---------- ตัวช่วยเวลา ----------
// รูปแบบ ISO ท้องถิ่นความกว้างคงที่ → เทียบ < > แบบ string ได้ตรงตามเวลาจริง
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function combine(date: string, time: string): string {
  return date + "T" + time;
}
// "YYYY-MM-DDTHH:mm" ของเวลาปัจจุบันท้องถิ่น
function nowLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// กฎหลัก: ทับซ้อนเมื่อ aStart < bEnd && aEnd > bStart (เทียบเฉพาะนัดที่ยืนยันแล้ว)
function conflicts(startIso: string, endIso: string, appts: Appointment[]): boolean {
  return appts.some(
    (a) => a.status === "confirmed" && startIso < a.end && endIso > a.start,
  );
}

function nextId(appts: Appointment[]): string {
  let max = 0;
  for (const a of appts) {
    const n = Number(a.id.replace(/^ap_/, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return "ap_" + String(max + 1).padStart(4, "0");
}

// ---------- ตอบกลับ ----------
function sendJSON(res: any, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

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
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("รูปแบบข้อมูลไม่ถูกต้อง"));
      }
    });
    req.on("error", reject);
  });
}

// ---------- ตรรกะของแต่ละเส้นทาง ----------
async function computeAvailability(date: string, serviceId: string): Promise<string[]> {
  const [services, config, appts] = await Promise.all([
    readServices(),
    readConfig(),
    readAppointments(),
  ]);
  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];

  const openMin = timeToMin(config.open);
  const closeMin = timeToMin(config.close);
  const step = config.slotStepMinutes;
  const now = nowLocalIso();
  const slots: string[] = [];

  for (let t = openMin; t + service.durationMinutes <= closeMin; t += step) {
    const startIso = combine(date, minToTime(t));
    const endIso = combine(date, minToTime(t + service.durationMinutes));
    if (startIso <= now) continue; // ข้ามเวลาที่ผ่านไปแล้ว
    if (!conflicts(startIso, endIso, appts)) slots.push(minToTime(t));
  }
  return slots;
}

async function createAppointment(body: any): Promise<{ status: number; payload: unknown }> {
  const customerName = String(body.customerName || "").trim();
  const customerPhone = String(body.customerPhone || "").trim();
  const serviceId = String(body.serviceId || "");
  const date = String(body.date || "");
  const start = String(body.start || ""); // "HH:mm"
  const note = String(body.note || "").trim();

  if (!customerName) return { status: 400, payload: { error: "กรุณากรอกชื่อ" } };
  if (!/^[0-9+\- ]{6,20}$/.test(customerPhone))
    return { status: 400, payload: { error: "เบอร์โทรไม่ถูกต้อง" } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { status: 400, payload: { error: "วันที่ไม่ถูกต้อง" } };
  if (!/^\d{2}:\d{2}$/.test(start))
    return { status: 400, payload: { error: "เวลาไม่ถูกต้อง" } };

  const [services, config, appts] = await Promise.all([
    readServices(),
    readConfig(),
    readAppointments(),
  ]);
  const service = services.find((s) => s.id === serviceId);
  if (!service) return { status: 400, payload: { error: "ไม่พบบริการที่เลือก" } };

  const startMin = timeToMin(start);
  const endMin = startMin + service.durationMinutes;
  if (startMin < timeToMin(config.open) || endMin > timeToMin(config.close))
    return { status: 400, payload: { error: "เวลาที่เลือกอยู่นอกเวลาทำการ" } };

  const startIso = combine(date, start);
  const endIso = combine(date, minToTime(endMin));
  if (startIso <= nowLocalIso())
    return { status: 400, payload: { error: "ไม่สามารถจองเวลาที่ผ่านไปแล้ว" } };
  if (conflicts(startIso, endIso, appts))
    return { status: 409, payload: { error: "ช่วงเวลานี้มีคนจองแล้ว กรุณาเลือกเวลาอื่น" } };

  const appt: Appointment = {
    id: nextId(appts),
    customerName,
    customerPhone,
    serviceId,
    start: startIso,
    end: endIso,
    status: "confirmed",
    note,
    createdAt: new Date().toISOString(),
  };
  appts.push(appt);
  await writeAppointments(appts);
  return { status: 201, payload: appt };
}

async function isAdmin(req: any): Promise<boolean> {
  const config = await readConfig();
  const pass = process.env.ADMIN_PASSCODE || config.adminPasscode;
  return req.headers["x-admin-pass"] === pass;
}

// ---------- เซิร์ฟเวอร์ ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || "GET";

    // ----- API -----
    if (path === "/api/config" && method === "GET") {
      const c = await readConfig();
      return sendJSON(res, 200, { shopName: c.shopName, open: c.open, close: c.close });
    }
    if (path === "/api/services" && method === "GET") {
      return sendJSON(res, 200, await readServices());
    }
    if (path === "/api/availability" && method === "GET") {
      const date = url.searchParams.get("date") || "";
      const serviceId = url.searchParams.get("serviceId") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return sendJSON(res, 400, { error: "วันที่ไม่ถูกต้อง" });
      return sendJSON(res, 200, { slots: await computeAvailability(date, serviceId) });
    }
    if (path === "/api/appointments" && method === "POST") {
      const body = await readBody(req);
      const { status, payload } = await createAppointment(body);
      return sendJSON(res, status, payload);
    }

    // ----- API ฝั่งร้าน (ต้องมีรหัสผ่าน) -----
    if (path === "/api/admin/appointments" && method === "GET") {
      if (!(await isAdmin(req))) return sendJSON(res, 401, { error: "รหัสผ่านไม่ถูกต้อง" });
      const appts = await readAppointments();
      const services = await readServices();
      const date = url.searchParams.get("date");
      const enriched = appts
        .filter((a) => !date || a.start.slice(0, 10) === date)
        .map((a) => ({ ...a, serviceName: services.find((s) => s.id === a.serviceId)?.name || a.serviceId }))
        .sort((a, b) => a.start.localeCompare(b.start));
      return sendJSON(res, 200, enriched);
    }
    if (path === "/api/admin/cancel" && method === "POST") {
      if (!(await isAdmin(req))) return sendJSON(res, 401, { error: "รหัสผ่านไม่ถูกต้อง" });
      const body = await readBody(req);
      const appts = await readAppointments();
      const appt = appts.find((a) => a.id === body.id);
      if (!appt) return sendJSON(res, 404, { error: "ไม่พบนัดหมาย" });
      appt.status = "cancelled";
      await writeAppointments(appts);
      return sendJSON(res, 200, appt);
    }

    // ----- ไฟล์หน้าเว็บ -----
    if (method === "GET") return await serveStatic(res, path);

    sendJSON(res, 404, { error: "ไม่พบเส้นทางที่ต้องการ" });
  } catch (err) {
    sendJSON(res, 500, { error: (err as Error).message || "เกิดข้อผิดพลาดในระบบ" });
  }
});

server.listen(PORT, () => {
  console.log(`แอพนัดหมายเปิดที่ http://localhost:${PORT}`);
  console.log(`หน้าจัดการร้าน: http://localhost:${PORT}/admin`);
});
