# แอพนัดหมายรับบริการ

เว็บแอปให้ลูกค้านัดหมายเข้ารับบริการจากร้าน (เช่น ร้านตัดผม/นวด) — Node.js ล้วน **ไม่มี dependency** เก็บข้อมูลเป็นไฟล์ JSON ดัดแปลงจาก [booking-template](https://github.com/WARROOM-CEO/booking-template)

## แนวคิดหลัก

ลูกค้าหนึ่งคนจอง**ช่วงเวลา**เพื่อรับ**บริการ**หนึ่งอย่างจากร้าน — ทั้งร้านมี**คิวเดียว** (รับได้ทีละ 1 นัดต่อช่วงเวลา) นัดที่เวลาทับกันจึงชนกันเสมอ ดูคำศัพท์ทั้งหมดใน [`CONTEXT.md`](./CONTEXT.md) และเหตุผลการออกแบบใน [`docs/adr/`](./docs/adr/)

## วิธีรัน

ต้องใช้ **Node.js 24+** (รัน `.ts` ตรงด้วย type-stripping ไม่ต้อง build)

```bash
node server.ts        # หรือ npm start
```

แล้วเปิด:
- หน้าลูกค้า: <http://localhost:3000>
- หน้าจัดการร้าน: <http://localhost:3000/admin> (รหัสผ่านดีฟอลต์ `1234`)

ตั้งค่าผ่าน env: `PORT`, `ADMIN_PASSCODE`

## โครงสร้าง

```
lib/
  core.ts            ตรรกะหลัก + ตัวจัดเส้นทาง API (ไม่ผูก transport)
  store.ts           ชั้นเก็บข้อมูล: FileStore (dev) / KvStore (Upstash, prod)
server.ts            adapter รันในเครื่อง: http server + เสิร์ฟ static
api/[...path].ts     adapter Vercel: serverless function
public/              หน้าเว็บ (HTML/CSS/JS ธรรมดา ไม่มี build step)
data/
  services.json      รายการบริการ + ระยะเวลา + ราคา
  config.json        ชื่อร้าน เวลาทำการ รหัสผ่าน
  appointments.json  ข้อมูลนัด (ใช้ตอน dev เท่านั้น)
```

## Deploy บน Vercel

แอปนี้พร้อม deploy บน Vercel แต่ serverless เขียนไฟล์ไม่ได้ จึงต้องมีที่เก็บข้อมูลภายนอก
(Upstash Redis / Vercel KV) — ดูเหตุผลใน [`docs/adr/0003`](./docs/adr/0003-pluggable-storage-for-serverless-deploy.md)

1. **สร้างที่เก็บข้อมูล** — ใน Vercel Dashboard → Storage → สร้าง **Upstash for Redis** (KV)
   แล้ว connect เข้า project (Vercel จะใส่ env `KV_REST_API_URL`, `KV_REST_API_TOKEN` ให้อัตโนมัติ)
2. **Import project** จาก GitHub repo นี้ → Framework Preset เลือก **Other**
3. **ตั้ง Environment Variables** เพิ่ม:
   - `ADMIN_PASSCODE` = รหัสผ่านร้าน (อย่าใช้ค่า default `1234`)
4. **Deploy** — Vercel เสิร์ฟ `public/` เป็น static และ `api/*` เป็น serverless function

หรือผ่าน CLI:

```bash
npm i -g vercel
vercel login
vercel link
vercel env add ADMIN_PASSCODE     # ใส่รหัสผ่านร้าน
# เชื่อม Upstash KV ผ่าน dashboard (Storage) เพื่อให้ได้ KV_REST_API_* env
vercel --prod
```

> ถ้าไม่มี env `KV_REST_API_*` แอปจะ fallback ไปใช้ไฟล์ JSON (ใช้ได้เฉพาะตอนรันในเครื่อง)

## สถานะการพัฒนา

จัดการเป็น issues ราย vertical slice บน GitHub — ดู [`issues.md`](./issues.md)

- ✅ **เฟส 1** — แกนการจองของลูกค้า: ดูบริการ, ดูช่องเวลาว่าง, จองนัด + กฎคิวเดียว
- ✅ **เฟส 2** — จัดการร้าน: เข้าระบบด้วยรหัสผ่าน, ดูนัดรายวัน, ยกเลิกนัด (soft-delete)
- ⬜ เฟส 3 — ตั้งค่าผ่าน config + แสดงผลไทย พ.ศ.
- ⬜ เฟส 4 — ชุดทดสอบ
