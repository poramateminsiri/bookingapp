# สแตกแบบไม่มี dependency (Node ล้วน + เว็บธรรมดา)

เลือกสร้างเว็บแอปด้วย Node.js built-in modules ล้วน (`node:http`, `node:fs`) รัน `.ts` ตรงด้วย type-stripping ของ Node 24 และหน้าเว็บเป็น HTML/CSS/JS ธรรมดา ไม่มี framework และไม่มี build step — เพื่อรักษาปรัชญา "ไม่มี dependency" ของเทมเพลตต้นทาง และให้ติดตั้ง/รันง่ายที่สุด (แค่ `node server.ts`)

## Considered Options

- **Next.js/React** — ฟีเจอร์ครบกว่า แต่เพิ่ม npm install, build step, และความซับซ้อนเกินจำเป็นสำหรับร้านคิวเดียว
- **Node ล้วน (เลือกอันนี้)** — ขอบเขตงานเล็ก ฟอร์มจองไม่กี่หน้า ไม่คุ้มที่จะแบก framework

## Consequences

- ไม่มี type-checking ตอน build (Node แค่ strip types) ต้องระวังเองหรือรัน `tsc --noEmit` แยก
- ถ้าฟีเจอร์โตมาก (หลายสาขา, ปฏิทินซับซ้อน) อาจต้องย้ายไป framework ภายหลัง
