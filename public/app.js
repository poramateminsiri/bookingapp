// หน้าลูกค้า — เลือกบริการ → ดูช่องเวลาว่าง → จองนัด
"use strict";

const state = {
  services: [],
  selectedServiceId: null,
  selectedStart: null, // "HH:mm"
};

const $ = (id) => document.getElementById(id);

// แปลง YYYY-MM-DD เป็นข้อความวันที่ไทย (พ.ศ.)
function thaiDate(ymd) {
  try {
    const d = new Date(ymd + "T00:00");
    return d.toLocaleDateString("th-TH", { dateStyle: "full" });
  } catch {
    return ymd;
  }
}

function todayYMD() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function showMsg(text, kind) {
  const m = $("msg");
  m.textContent = text;
  m.className = "msg show " + kind;
}
function clearMsg() {
  $("msg").className = "msg";
}

async function loadConfig() {
  try {
    const c = await fetch("/api/config").then((r) => r.json());
    if (c.shopName) {
      $("shop-name").textContent = c.shopName;
      document.title = "จองนัด · " + c.shopName;
    }
  } catch { /* ใช้ค่าเริ่มต้นบนหน้า */ }
}

// ----- บริการ (#1) -----
async function loadServices() {
  const box = $("services");
  try {
    state.services = await fetch("/api/services").then((r) => r.json());
  } catch {
    box.innerHTML = '<p class="hint">โหลดบริการไม่สำเร็จ ลองรีเฟรชหน้า</p>';
    return;
  }
  if (!state.services.length) {
    box.innerHTML = '<p class="hint">ยังไม่มีบริการ</p>';
    return;
  }
  box.innerHTML = "";
  state.services.forEach((s) => {
    const label = document.createElement("label");
    label.className = "svc";
    label.innerHTML =
      `<input type="radio" name="service" value="${s.id}">` +
      `<span class="svc-name">${escapeHtml(s.name)}</span>` +
      `<span class="svc-dur">${s.durationMinutes} นาที</span>` +
      `<span class="svc-price">${s.price.toLocaleString("th-TH")} ฿</span>`;
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      state.selectedServiceId = s.id;
      document.querySelectorAll(".svc").forEach((el) => el.classList.remove("selected"));
      label.classList.add("selected");
      loadAvailability();
    });
    box.appendChild(label);
  });
}

// ----- ช่องเวลาว่าง (#2) -----
async function loadAvailability() {
  const slotsBox = $("slots");
  state.selectedStart = null;
  updateSubmit();
  const date = $("date").value;
  if (!state.selectedServiceId || !date) {
    slotsBox.innerHTML = '<p class="slot none">เลือกบริการและวันก่อน</p>';
    return;
  }
  slotsBox.innerHTML = '<p class="slot none">กำลังตรวจเวลาว่าง…</p>';
  let slots = [];
  try {
    const res = await fetch(
      `/api/availability?date=${encodeURIComponent(date)}&serviceId=${encodeURIComponent(state.selectedServiceId)}`,
    ).then((r) => r.json());
    slots = res.slots || [];
  } catch {
    slotsBox.innerHTML = '<p class="slot none">ตรวจเวลาว่างไม่สำเร็จ</p>';
    return;
  }
  if (!slots.length) {
    slotsBox.innerHTML = '<p class="slot none">ไม่มีเวลาว่างในวันนี้ ลองเลือกวันอื่น</p>';
    return;
  }
  slotsBox.innerHTML = "";
  slots.forEach((t) => {
    const b = document.createElement("div");
    b.className = "slot";
    b.textContent = t;
    b.addEventListener("click", () => {
      state.selectedStart = t;
      document.querySelectorAll(".slot").forEach((el) => el.classList.remove("selected"));
      b.classList.add("selected");
      updateSubmit();
    });
    slotsBox.appendChild(b);
  });
}

function updateSubmit() {
  const ready =
    state.selectedServiceId &&
    state.selectedStart &&
    $("date").value &&
    $("name").value.trim() &&
    $("phone").value.trim();
  $("submit-btn").disabled = !ready;
}

// ----- จองนัด (#3) -----
async function submitBooking(e) {
  e.preventDefault();
  clearMsg();
  const btn = $("submit-btn");
  const service = state.services.find((s) => s.id === state.selectedServiceId);
  const payload = {
    customerName: $("name").value.trim(),
    customerPhone: $("phone").value.trim(),
    serviceId: state.selectedServiceId,
    date: $("date").value,
    start: state.selectedStart,
    note: $("note").value.trim(),
  };

  btn.disabled = true;
  btn.textContent = "กำลังจอง…";
  let res, body;
  try {
    res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    body = await res.json();
  } catch {
    showMsg("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง", "err");
    btn.disabled = false;
    btn.textContent = "ยืนยันการจอง";
    return;
  }
  btn.textContent = "ยืนยันการจอง";

  if (res.ok) {
    showSuccess(service, payload);
    e.target.reset();
    state.selectedServiceId = null;
    state.selectedStart = null;
    document.querySelectorAll(".svc").forEach((el) => el.classList.remove("selected"));
    $("date").value = todayYMD();
    $("slots").innerHTML = '<p class="slot none">เลือกบริการและวันก่อน</p>';
    btn.disabled = true;
  } else {
    // 409 = ชนคิว, 400 = ข้อมูลไม่ถูกต้อง
    showMsg(body.error || "จองไม่สำเร็จ", "err");
    btn.disabled = false;
    if (res.status === 409) loadAvailability(); // รีเฟรชเวลาว่างให้เลือกใหม่
  }
}

function showSuccess(service, p) {
  const m = $("msg");
  m.className = "msg show ok";
  m.innerHTML =
    `<div class="success-box"><div class="big">✅</div>` +
    `จองสำเร็จ! <b>${escapeHtml(service ? service.name : "")}</b><br>` +
    `${thaiDate(p.date)} เวลา <b>${p.start} น.</b><br>` +
    `ในชื่อ ${escapeHtml(p.customerName)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// ----- เริ่มต้น -----
function init() {
  const dateEl = $("date");
  dateEl.value = todayYMD();
  dateEl.min = todayYMD();
  dateEl.addEventListener("change", loadAvailability);
  ["name", "phone"].forEach((id) => $(id).addEventListener("input", updateSubmit));
  $("booking-form").addEventListener("submit", submitBooking);
  loadConfig();
  loadServices();
}
init();
