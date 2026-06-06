# Storage แบบเสียบเปลี่ยนได้ เพื่อ deploy บน serverless (Vercel)

เดิม ADR-0002 เลือกเก็บข้อมูลเป็นไฟล์ JSON บนดิสก์ แต่เมื่อต้อง deploy บน Vercel (serverless) ดิสก์เป็น read-only และ ephemeral เขียน `appointments.json` ไม่ได้ จึงแยกเป็น **ชั้น Store เสียบเปลี่ยนได้** (`lib/store.ts`):

- **FileStore** — ไฟล์ JSON เดิม สำหรับรันในเครื่อง (dev)
- **KvStore** — Upstash Redis ผ่าน REST API เลือกใช้อัตโนมัติเมื่อมี env `KV_REST_API_URL`/`KV_REST_API_TOKEN`

ตรรกะหลักย้ายไป `lib/core.ts` (ไม่ผูก transport) ใช้ร่วมกันทั้ง `server.ts` (local) และ `api/[...path].ts` (Vercel) — มีเพียง "นัดหมาย" ที่ต้องเขียน ส่วนบริการ/ตั้งค่าเป็นข้อมูลคงที่ฝังมากับ build

## Considered Options

- **Vercel Postgres/Neon (SQL)** — เกินจำเป็นสำหรับร้านคิวเดียว เพิ่ม schema/migration
- **Vercel Blob** — เก็บ JSON ก้อนเดียว แต่ read-modify-write ช้าและ race ง่ายกว่า
- **Upstash Redis ผ่าน REST (เลือกอันนี้)** — serverless-native, เรียกผ่าน `fetch` ในตัว **ไม่เพิ่ม npm dependency** (รักษาเจตนาของ ADR-0002 ไว้บางส่วน), get/set ก้อน JSON ตรงไปตรงมา

## Consequences

- ต้องมีบริการภายนอก (Upstash/Vercel KV) และตั้ง env ตอน deploy — ไม่ใช่ "ไม่มี dependency ภายนอก" แบบเดิมอีกต่อไป (จุดนี้แทนที่ ADR-0002 เฉพาะเรื่อง production storage; dev ยังใช้ไฟล์)
- **เขียนแบบ read-modify-write ทั้งก้อน** มีโอกาส race ถ้ามีคนจองพร้อมกันจริงๆ หลายคน — ยอมรับได้สำหรับร้านเล็กคิวเดียว ถ้าโตขึ้นค่อยใช้ Redis transaction/atomic
- เวลา "ปัจจุบัน" คำนวณเป็นโซน `Asia/Bangkok` ผ่าน `Intl` เพื่อให้ถูกต้องบนเซิร์ฟเวอร์ UTC ของ Vercel
