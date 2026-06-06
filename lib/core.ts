// ตรรกะหลักของแอพนัดหมาย — ไม่ผูกกับ transport (ใช้ได้ทั้ง http server และ serverless)
import servicesData from "../data/services.json" with { type: "json" };
import configData from "../data/config.json" with { type: "json" };
import type { Store } from "./store.ts";

export type Service = { id: string; name: string; durationMinutes: number; price: number };
export type Config = { shopName: string; open: string; close: string; slotStepMinutes: number; adminPasscode: string };
export type Status = "confirmed" | "cancelled";
export type Appointment = {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  start: string; // "YYYY-MM-DDTHH:mm" (เวลาท้องถิ่นไทย)
  end: string;
  status: Status;
  note: string;
  createdAt: string;
};

// บริการ/ตั้งค่า เป็นข้อมูลคงที่ ฝังมากับ build (อ่านอย่างเดียว ใช้ได้ทั้ง local และ serverless)
export const SERVICES = servicesData as Service[];
export const CONFIG = configData as Config;

export type ApiResult = { status: number; body: unknown };

// ---------- ตัวช่วยเวลา ----------
// รูปแบบ ISO ท้องถิ่นความกว้างคงที่ → เทียบ < > แบบ string ได้ตรงตามเวลาจริง
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
export function combine(date: string, time: string): string {
  return date + "T" + time;
}
// เวลาปัจจุบัน "ตามโซนไทย" ไม่ขึ้นกับ TZ ของเซิร์ฟเวอร์ (Vercel รันบน UTC)
export function nowLocalIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// กฎหลัก: ทับซ้อนเมื่อ aStart < bEnd && aEnd > bStart (เทียบเฉพาะนัดที่ยืนยันแล้ว)
export function conflicts(startIso: string, endIso: string, appts: Appointment[]): boolean {
  return appts.some((a) => a.status === "confirmed" && startIso < a.end && endIso > a.start);
}

function nextId(appts: Appointment[]): string {
  let max = 0;
  for (const a of appts) {
    const n = Number(a.id.replace(/^ap_/, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return "ap_" + String(max + 1).padStart(4, "0");
}

// ---------- การทำงานของแต่ละเส้นทาง (รับ store เข้ามา) ----------
export async function computeAvailability(store: Store, date: string, serviceId: string): Promise<string[]> {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return [];
  const appts = await store.readAppointments();
  const openMin = timeToMin(CONFIG.open);
  const closeMin = timeToMin(CONFIG.close);
  const now = nowLocalIso();
  const slots: string[] = [];
  for (let t = openMin; t + service.durationMinutes <= closeMin; t += CONFIG.slotStepMinutes) {
    const startIso = combine(date, minToTime(t));
    const endIso = combine(date, minToTime(t + service.durationMinutes));
    if (startIso <= now) continue; // ข้ามเวลาที่ผ่านไปแล้ว
    if (!conflicts(startIso, endIso, appts)) slots.push(minToTime(t));
  }
  return slots;
}

export async function createAppointment(store: Store, body: any): Promise<ApiResult> {
  const customerName = String(body?.customerName || "").trim();
  const customerPhone = String(body?.customerPhone || "").trim();
  const serviceId = String(body?.serviceId || "");
  const date = String(body?.date || "");
  const start = String(body?.start || ""); // "HH:mm"
  const note = String(body?.note || "").trim();

  if (!customerName) return { status: 400, body: { error: "กรุณากรอกชื่อ" } };
  if (!/^[0-9+\- ]{6,20}$/.test(customerPhone))
    return { status: 400, body: { error: "เบอร์โทรไม่ถูกต้อง" } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { status: 400, body: { error: "วันที่ไม่ถูกต้อง" } };
  if (!/^\d{2}:\d{2}$/.test(start))
    return { status: 400, body: { error: "เวลาไม่ถูกต้อง" } };

  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return { status: 400, body: { error: "ไม่พบบริการที่เลือก" } };

  const startMin = timeToMin(start);
  const endMin = startMin + service.durationMinutes;
  if (startMin < timeToMin(CONFIG.open) || endMin > timeToMin(CONFIG.close))
    return { status: 400, body: { error: "เวลาที่เลือกอยู่นอกเวลาทำการ" } };

  const startIso = combine(date, start);
  const endIso = combine(date, minToTime(endMin));
  if (startIso <= nowLocalIso())
    return { status: 400, body: { error: "ไม่สามารถจองเวลาที่ผ่านไปแล้ว" } };

  const appts = await store.readAppointments();
  if (conflicts(startIso, endIso, appts))
    return { status: 409, body: { error: "ช่วงเวลานี้มีคนจองแล้ว กรุณาเลือกเวลาอื่น" } };

  const appt: Appointment = {
    id: nextId(appts),
    customerName, customerPhone, serviceId,
    start: startIso, end: endIso,
    status: "confirmed", note,
    createdAt: new Date().toISOString(),
  };
  appts.push(appt);
  await store.writeAppointments(appts);
  return { status: 201, body: appt };
}

export async function listAppointments(store: Store, date: string | null): Promise<unknown[]> {
  const appts = await store.readAppointments();
  return appts
    .filter((a) => !date || a.start.slice(0, 10) === date)
    .map((a) => ({ ...a, serviceName: SERVICES.find((s) => s.id === a.serviceId)?.name || a.serviceId }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export async function cancelAppointment(store: Store, id: string): Promise<ApiResult> {
  const appts = await store.readAppointments();
  const appt = appts.find((a) => a.id === id);
  if (!appt) return { status: 404, body: { error: "ไม่พบนัดหมาย" } };
  appt.status = "cancelled";
  await store.writeAppointments(appts);
  return { status: 200, body: appt };
}

export function isAdmin(pass: string | undefined): boolean {
  const expected = process.env.ADMIN_PASSCODE || CONFIG.adminPasscode;
  return !!pass && pass === expected;
}

// ---------- ตัวจัดเส้นทาง API (ไม่ผูก transport) ----------
export async function handleApi(input: {
  method: string;
  pathname: string;
  query: URLSearchParams;
  adminPass: string | undefined;
  body: any;
  store: Store;
}): Promise<ApiResult> {
  const { method, pathname, query, adminPass, body, store } = input;

  if (pathname === "/api/config" && method === "GET")
    return { status: 200, body: { shopName: CONFIG.shopName, open: CONFIG.open, close: CONFIG.close } };

  if (pathname === "/api/services" && method === "GET")
    return { status: 200, body: SERVICES };

  if (pathname === "/api/availability" && method === "GET") {
    const date = query.get("date") || "";
    const serviceId = query.get("serviceId") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, body: { error: "วันที่ไม่ถูกต้อง" } };
    return { status: 200, body: { slots: await computeAvailability(store, date, serviceId) } };
  }

  if (pathname === "/api/appointments" && method === "POST")
    return createAppointment(store, body);

  if (pathname === "/api/admin/appointments" && method === "GET") {
    if (!isAdmin(adminPass)) return { status: 401, body: { error: "รหัสผ่านไม่ถูกต้อง" } };
    return { status: 200, body: await listAppointments(store, query.get("date")) };
  }

  if (pathname === "/api/admin/cancel" && method === "POST") {
    if (!isAdmin(adminPass)) return { status: 401, body: { error: "รหัสผ่านไม่ถูกต้อง" } };
    return cancelAppointment(store, String(body?.id || ""));
  }

  return { status: 404, body: { error: "ไม่พบเส้นทางที่ต้องการ" } };
}
