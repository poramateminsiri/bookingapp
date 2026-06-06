// หน้าจัดการร้าน — ใส่รหัสผ่าน → ดูนัดรายวัน → ยกเลิกนัด
"use strict";

const $ = (id) => document.getElementById(id);
let passcode = sessionStorage.getItem("admin-pass") || null;

function todayYMD() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hhmm(iso) {
  return String(iso).slice(11, 16); // "YYYY-MM-DDTHH:mm" -> "HH:mm"
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// เรียก API ฝั่งร้าน พร้อมแนบรหัสผ่าน
async function adminFetch(path, options = {}) {
  const opts = Object.assign({ headers: {} }, options);
  opts.headers = Object.assign({}, opts.headers, { "x-admin-pass": passcode });
  return fetch(path, opts);
}

async function loadShopName() {
  try {
    const c = await fetch("/api/config").then((r) => r.json());
    if (c.shopName) {
      $("shop-name").textContent = c.shopName + " — จัดการร้าน";
      document.title = "จัดการร้าน · " + c.shopName;
    }
  } catch { /* ใช้ค่าเริ่มต้น */ }
}

// ----- เข้าสู่ระบบ (#4) -----
async function tryLogin(e) {
  if (e) e.preventDefault();
  const input = $("passcode");
  passcode = input.value.trim();
  const res = await adminFetch(`/api/admin/appointments?date=${todayYMD()}`);
  if (res.status === 401) {
    $("gate-msg").className = "msg show err";
    $("gate-msg").textContent = "รหัสผ่านไม่ถูกต้อง";
    passcode = null;
    return;
  }
  if (!res.ok) {
    $("gate-msg").className = "msg show err";
    $("gate-msg").textContent = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    return;
  }
  sessionStorage.setItem("admin-pass", passcode);
  $("gate").hidden = true;
  $("panel").hidden = false;
  renderList(await res.json());
}

function logout(e) {
  if (e) e.preventDefault();
  passcode = null;
  sessionStorage.removeItem("admin-pass");
  $("panel").hidden = true;
  $("gate").hidden = false;
  $("passcode").value = "";
  $("gate-msg").className = "msg";
}

// ----- ดูนัดรายวัน (#4) -----
async function refresh() {
  const date = $("date").value || todayYMD();
  const list = $("list");
  list.innerHTML = '<p class="empty">กำลังโหลด…</p>';
  let res;
  try {
    res = await adminFetch(`/api/admin/appointments?date=${encodeURIComponent(date)}`);
  } catch {
    list.innerHTML = '<p class="empty">เชื่อมต่อไม่สำเร็จ</p>';
    return;
  }
  if (res.status === 401) { logout(); return; } // รหัสหมดอายุ
  if (!res.ok) {
    list.innerHTML = '<p class="empty">โหลดรายการไม่สำเร็จ</p>';
    return;
  }
  renderList(await res.json());
}

function renderList(appts) {
  const list = $("list");
  if (!appts.length) {
    list.innerHTML = '<p class="empty">ยังไม่มีนัดในวันนี้</p>';
    return;
  }
  list.innerHTML = "";
  appts.forEach((a) => {
    const cancelled = a.status === "cancelled";
    const row = document.createElement("div");
    row.className = "appt";

    const info = document.createElement("div");
    info.className = "info";
    const noteHtml = a.note ? `<div class="who">📝 ${escapeHtml(a.note)}</div>` : "";
    info.innerHTML =
      `<div class="time">${hhmm(a.start)}–${hhmm(a.end)} · ${escapeHtml(a.serviceName || a.serviceId)}</div>` +
      `<div class="who">${escapeHtml(a.customerName)} · ${escapeHtml(a.customerPhone)}</div>` +
      noteHtml;

    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:10px;flex:none;";
    const badge = document.createElement("span");
    badge.className = "badge " + (cancelled ? "cancelled" : "confirmed");
    badge.textContent = cancelled ? "ยกเลิก" : "ยืนยันแล้ว";
    right.appendChild(badge);

    if (!cancelled) {
      const btn = document.createElement("button");
      btn.className = "cancel";
      btn.type = "button";
      btn.textContent = "ยกเลิกนัด";
      btn.addEventListener("click", () => cancelAppt(a.id, a.customerName));
      right.appendChild(btn);
    }

    row.appendChild(info);
    row.appendChild(right);
    list.appendChild(row);
  });
}

// ----- ยกเลิกนัด (#5) -----
async function cancelAppt(id, name) {
  if (!confirm(`ยืนยันยกเลิกนัดของ ${name}?`)) return;
  let res;
  try {
    res = await adminFetch("/api/admin/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  } catch {
    alert("เชื่อมต่อไม่สำเร็จ");
    return;
  }
  if (res.status === 401) { logout(); return; }
  if (!res.ok) {
    alert("ยกเลิกไม่สำเร็จ");
    return;
  }
  refresh(); // โหลดใหม่ — นัดจะกลายเป็น badge แดง และเวลานั้นกลับมาว่าง
}

// ----- เริ่มต้น -----
function init() {
  $("date").value = todayYMD();
  loadShopName();
  $("gate").addEventListener("submit", tryLogin);
  $("logout").addEventListener("click", logout);
  $("refresh").addEventListener("click", refresh);
  $("date").addEventListener("change", refresh);
  // ถ้าเคยล็อกอินไว้ใน session ลองเข้าเลย
  if (passcode) {
    $("passcode").value = passcode;
    tryLogin();
  }
}
init();
