// ชั้นเก็บข้อมูลแบบเสียบเปลี่ยนได้ — เฉพาะ "นัดหมาย" ที่ต้องเขียน
// FileStore: ไฟล์ JSON (dev/local) · KvStore: Upstash Redis ผ่าน REST (Vercel/serverless)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Appointment } from "./core.ts";

export interface Store {
  readAppointments(): Promise<Appointment[]>;
  writeAppointments(list: Appointment[]): Promise<void>;
}

// ---------- ไฟล์ JSON (dev) ----------
const APPTS_FILE = join(process.cwd(), "data", "appointments.json");

export class FileStore implements Store {
  async readAppointments(): Promise<Appointment[]> {
    try {
      return JSON.parse(await readFile(APPTS_FILE, "utf8"));
    } catch {
      return []; // ไฟล์ยังไม่มี/ว่าง
    }
  }
  async writeAppointments(list: Appointment[]): Promise<void> {
    await writeFile(APPTS_FILE, JSON.stringify(list, null, 2));
  }
}

// ---------- Upstash Redis ผ่าน REST (ไม่มี dependency ใช้ fetch ในตัว) ----------
// รองรับชื่อ env ทั้งของ Vercel KV และ Upstash โดยตรง
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_KEY = "appointments";

export class KvStore implements Store {
  async run(command: string[]): Promise<any> {
    const res = await fetch(KV_URL as string, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`KV error ${res.status}`);
    const data = await res.json();
    return data.result;
  }
  async readAppointments(): Promise<Appointment[]> {
    const raw = await this.run(["GET", KV_KEY]);
    return raw ? JSON.parse(raw) : [];
  }
  async writeAppointments(list: Appointment[]): Promise<void> {
    await this.run(["SET", KV_KEY, JSON.stringify(list)]);
  }
}

// เลือก backend อัตโนมัติ: มี env KV → ใช้ Redis, ไม่งั้นใช้ไฟล์
export function getStore(): Store {
  return KV_URL && KV_TOKEN ? new KvStore() : new FileStore();
}
