/* ═══════════════════════════════════════════
   Paisa — Personal Money Dashboard
   Pure vanilla JS + IndexedDB
   ═══════════════════════════════════════════ */
"use strict";

const APP_VERSION = 1;

/* ── Default Config (no personal data — filled during first-run setup) ── */
const DEFAULT_CONFIG = {
  income: 0,
  bonusIncome: 0,
  bonusMonths: [],
  floor: 0,
  spendingBudget: 0,
  sipPPFAS: { amount: 0, cagr: 0.12, name: "SIP Fund 1" },
  sipNifty: { amount: 0, cagr: 0.12, name: "SIP Fund 2" },
  sipDay: 3,
  transferDay: 2,
  pots: [],
  motherAmount: 0,
  spare: 0,
  setupDone: false
};

/* ── IndexedDB ── */
const DB_NAME = "PaisaDB";
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("config")) d.createObjectStore("config");
      if (!d.objectStoreNames.contains("snapshots")) {
        const s = d.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
      }
      if (!d.objectStoreNames.contains("potTx")) {
        const s = d.createObjectStore("potTx", { keyPath: "id", autoIncrement: true });
        s.createIndex("potId", "potId");
        s.createIndex("date", "date");
      }
      if (!d.objectStoreNames.contains("months")) {
        d.createObjectStore("months", { keyPath: "key" }); // key = "2026-10"
      }
      if (!d.objectStoreNames.contains("milestones")) {
        d.createObjectStore("milestones", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

/* DB helpers */
function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function dbPut(store, val, key) {
  return new Promise((res, rej) => {
    const r = key !== undefined ? tx(store, "readwrite").put(val, key) : tx(store, "readwrite").put(val);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbGetAll(store, indexName, query) {
  return new Promise((res, rej) => {
    const s = tx(store);
    const target = indexName ? s.index(indexName) : s;
    const r = query ? target.getAll(query) : target.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, "readwrite").delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* ── State ── */
let config = { ...DEFAULT_CONFIG };
let currentPotId = null;
let pendingPotBalances = {}; // Collected during setup, applied in finishSetup

/* ── Formatting ── */
function fmt(n) {
  if (n == null || isNaN(n)) return "₹0";
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const s = abs.toString();
  let result = "";
  if (s.length <= 3) { result = s; }
  else {
    result = s.slice(-3);
    let rem = s.slice(0, -3);
    while (rem.length > 2) { result = rem.slice(-2) + "," + result; rem = rem.slice(0, -2); }
    if (rem.length > 0) result = rem + "," + result;
  }
  return (neg ? "-₹" : "₹") + result;
}

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function monthKey(d) {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(y, m - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function daysLeftInMonth() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.getDate() - now.getDate();
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ── Navigation ── */
const screens = ["home", "months", "trends", "more"];
let activeScreen = "home";

function showScreen(name) {
  if (name === "pot") {
    // Special: pot detail is not in nav
    screens.forEach(s => document.getElementById(`screen-${s}`).classList.add("hidden"));
    document.getElementById("screen-pot").classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    activeScreen = "pot";
    return;
  }
  screens.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
  });
  document.getElementById("screen-pot").classList.add("hidden");
  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.screen === name);
  });
  activeScreen = name;
  if (name === "home") renderHome();
  if (name === "months") renderMonths();
  if (name === "trends") renderTrends();
}

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

/* ── Modal ── */
function showModal(title, bodyHtml, actions) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${title}</div>
        <div id="modal-body">${bodyHtml}</div>
        <div class="btn-row" id="modal-actions" style="margin-top:16px"></div>
      </div>
    </div>`;
  const actionsEl = root.querySelector("#modal-actions");
  if (actions) {
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = a.danger ? "btn-danger btn-sm" : (a.primary ? "btn-primary btn-sm" : "btn-secondary btn-sm");
      btn.style.flex = "1";
      btn.textContent = a.label;
      btn.addEventListener("click", () => { closeModal(); if (a.fn) a.fn(); });
      actionsEl.appendChild(btn);
    });
  }
  root.classList.remove("hidden");
  root.querySelector("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
}

function closeModal() {
  const root = document.getElementById("modal-root");
  root.classList.add("hidden");
  root.innerHTML = "";
}

/* ═══ LOAD CONFIG ═══ */
async function loadConfig() {
  const saved = await dbGet("config", "main");
  if (saved) {
    config = { ...DEFAULT_CONFIG, ...saved };
    // Preserve saved pots as-is (don't merge with empty defaults)
    if (saved.pots) config.pots = saved.pots;
    if (saved.sipPPFAS) config.sipPPFAS = { ...DEFAULT_CONFIG.sipPPFAS, ...saved.sipPPFAS };
    if (saved.sipNifty) config.sipNifty = { ...DEFAULT_CONFIG.sipNifty, ...saved.sipNifty };
  }
}

async function saveConfig() {
  await dbPut("config", config, "main");
}

/* ═══ POT BALANCE CALCULATION ═══ */
async function getPotBalance(potId) {
  const txs = await dbGetAll("potTx", "potId", IDBKeyRange.only(potId));
  return txs.reduce((sum, t) => sum + (t.type === "in" ? t.amount : -t.amount), 0);
}

async function getAllPotBalances() {
  const result = {};
  for (const pot of config.pots) {
    result[pot.id] = await getPotBalance(pot.id);
  }
  return result;
}

/* ═══ SIP ESTIMATION ═══ */
function estimateSIPValue() {
  // Count months since setup date (when SIP tracking started)
  const start = config.setupDate ? new Date(config.setupDate) : new Date();
  start.setDate(1); // Normalize to 1st of that month
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));

  function futureValue(monthlyAmt, annualRate, nMonths) {
    if (nMonths <= 0) return 0;
    const r = annualRate / 12;
    return monthlyAmt * ((Math.pow(1 + r, nMonths) - 1) / r) * (1 + r);
  }

  const ppfas = futureValue(config.sipPPFAS.amount, config.sipPPFAS.cagr, months);
  const nifty = futureValue(config.sipNifty.amount, config.sipNifty.cagr, months);
  return { ppfas: Math.round(ppfas), nifty: Math.round(nifty), total: Math.round(ppfas + nifty) };
}

/* ═══ LATEST SNAPSHOT ═══ */
async function getLatestSnapshot() {
  const all = await dbGetAll("snapshots");
  if (all.length === 0) return null;
  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  return all[0];
}

/* ═════════════════════════════════════
   SCREEN 1: HOME
   ═══════════════════════════════════════ */
async function renderHome() {
  // Date
  document.getElementById("home-date").textContent =
    new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const snap = await getLatestSnapshot();
  const potBals = await getAllPotBalances();

  const hsbc = snap ? snap.hsbc : 0;
  const cc = snap ? snap.cc : 0;
  const extraMoney = snap ? (snap.extra || 0) : 0;

  // Calculate remaining commitments this month
  const today = new Date().getDate();
  let remaining = 0;
  if (today < config.transferDay) {
    // SBI transfer + mother not yet done
    const sbiTotal = config.pots.reduce((s, p) => s + p.monthly, 0);
    remaining += sbiTotal + config.motherAmount;
  }
  if (today < config.sipDay) {
    remaining += config.sipPPFAS.amount + config.sipNifty.amount;
  }

  const heroEl = document.getElementById("safe-to-spend");
  const hasSnapshot = snap && (snap.hsbc > 0 || snap.cc > 0);

  if (!hasSnapshot) {
    // No snapshot yet — show prompt, not garbage numbers
    heroEl.textContent = "—";
    heroEl.className = "hero-amount";
    document.getElementById("daily-budget").innerHTML = "Save a snapshot below to see your budget";
    document.getElementById("budget-bar").style.width = "0%";
    document.getElementById("budget-bar").className = "progress-fill green";
    document.getElementById("budget-used").textContent = "No data yet";
    document.getElementById("budget-total").textContent = "of " + fmt(config.spendingBudget);
  } else {
    const safeToSpend = hsbc - cc - config.floor - remaining + extraMoney;
    const spent = config.spendingBudget - safeToSpend;
    const pct = Math.min(100, Math.max(0, (spent / config.spendingBudget) * 100));

    heroEl.textContent = fmt(safeToSpend);
    heroEl.className = "hero-amount" + (safeToSpend < 5000 ? " danger" : safeToSpend < 15000 ? " warning" : "");

    const daysLeft = daysLeftInMonth();
    const dailyBudget = daysLeft > 0 ? Math.round(safeToSpend / daysLeft) : 0;
    document.getElementById("daily-budget").innerHTML =
      `~<strong>${fmt(dailyBudget)}</strong>/day for ${daysLeft} days`;

    document.getElementById("budget-bar").style.width = pct + "%";
    document.getElementById("budget-bar").className = "progress-fill " + (pct > 85 ? "red" : pct > 60 ? "yellow" : "green");
    document.getElementById("budget-used").textContent = fmt(Math.max(0, spent)) + " spent";
    document.getElementById("budget-total").textContent = "of " + fmt(config.spendingBudget);
  }

  // Pre-fill inputs with latest snapshot
  if (snap) {
    document.getElementById("inp-hsbc").value = snap.hsbc || "";
    document.getElementById("inp-cc").value = snap.cc || "";
  }

  // Pots
  const grid = document.getElementById("pot-grid");
  grid.innerHTML = "";
  for (const pot of config.pots) {
    const bal = potBals[pot.id] || 0;
    const pctPot = pot.target > 0 ? Math.min(100, (bal / pot.target) * 100) : 0;
    const card = document.createElement("div");
    card.className = "pot-card";
    card.innerHTML = `
      <div class="pot-name">${pot.icon} ${pot.name}</div>
      <div class="pot-balance">${fmt(bal)}</div>
      ${pot.target > 0 ? `
        <div class="pot-mini-bar"><div class="pot-mini-fill" style="width:${pctPot}%"></div></div>
        <div class="pot-target">Target: ${fmt(pot.target)}</div>
      ` : ""}`;
    card.addEventListener("click", () => openPotDetail(pot.id));
    grid.appendChild(card);
  }

  // Net worth
  const totalPots = Object.values(potBals).reduce((s, v) => s + v, 0);
  const sip = estimateSIPValue();
  const netWorth = totalPots + sip.total;
  document.getElementById("networth-amount").textContent = fmt(netWorth);
  document.getElementById("networth-breakdown").innerHTML = `
    <div class="networth-item">Pots<strong>${fmt(totalPots)}</strong></div>
    <div class="networth-item">SIP (est.)<strong>${fmt(sip.total)}</strong></div>`;
}

/* ── Snapshot Save ── */
document.getElementById("btn-snapshot").addEventListener("click", async () => {
  const hsbc = parseFloat(document.getElementById("inp-hsbc").value) || 0;
  const cc = parseFloat(document.getElementById("inp-cc").value) || 0;
  if (hsbc === 0 && cc === 0) { toast("Enter at least one value"); return; }

  const prev = await getLatestSnapshot();
  await dbPut("snapshots", {
    date: new Date().toISOString(),
    hsbc, cc,
    extra: prev ? (prev.extra || 0) : 0
  });
  toast("Snapshot saved ✓");
  renderHome();
});

/* ── Extra Money ── */
document.getElementById("btn-extra-money").addEventListener("click", () => {
  showModal("Add extra money", `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
      Bonus, refund, or unexpected income added to HSBC this month.
    </p>
    <div class="form-group">
      <label class="form-label">Amount</label>
      <input type="number" class="form-input" id="modal-extra-amt" placeholder="₹">
    </div>
    <div class="form-group">
      <label class="form-label">Note (optional)</label>
      <input type="text" class="form-input" id="modal-extra-note" placeholder="e.g. Quarterly bonus">
    </div>`, [
    { label: "Add", primary: true, fn: async () => {
      const amt = parseFloat(document.getElementById("modal-extra-amt").value) || 0;
      if (amt <= 0) return;
      const snap = await getLatestSnapshot();
      if (snap) {
        snap.extra = (snap.extra || 0) + amt;
        await dbPut("snapshots", snap);
      } else {
        await dbPut("snapshots", { date: new Date().toISOString(), hsbc: 0, cc: 0, extra: amt });
      }
      toast(`Added ${fmt(amt)} extra`);
      renderHome();
    }},
    { label: "Cancel" }
  ]);
});

/* ═══════════════════════════════════════
   SCREEN 2: POT DETAIL
   ═══════════════════════════════════════ */
async function openPotDetail(potId) {
  currentPotId = potId;
  const pot = config.pots.find(p => p.id === potId);
  if (!pot) return;

  showScreen("pot");

  const bal = await getPotBalance(potId);
  document.getElementById("pot-bal").textContent = fmt(bal);

  if (pot.target > 0) {
    const pct = Math.min(100, (bal / pot.target) * 100);
    document.getElementById("pot-target").textContent = `Target: ${fmt(pot.target)}`;
    document.getElementById("pot-bar").style.width = pct + "%";
    const remaining = pot.target - bal;
    if (remaining > 0 && pot.monthly > 0) {
      const monthsLeft = Math.ceil(remaining / pot.monthly);
      const eta = new Date();
      eta.setMonth(eta.getMonth() + monthsLeft);
      document.getElementById("pot-eta").textContent =
        `~${monthsLeft} months to go (${eta.toLocaleDateString("en-IN", { month: "short", year: "numeric" })})`;
    } else if (remaining <= 0) {
      document.getElementById("pot-eta").textContent = "🎉 Target reached!";
    } else {
      document.getElementById("pot-eta").textContent = "";
    }
  } else {
    document.getElementById("pot-target").textContent = "No target set";
    document.getElementById("pot-bar").style.width = "0%";
    document.getElementById("pot-eta").textContent = "";
  }

  // Transaction list
  const txs = await dbGetAll("potTx", "potId", IDBKeyRange.only(potId));
  txs.sort((a, b) => new Date(b.date) - new Date(a.date));
  const list = document.getElementById("pot-tx-list");
  list.innerHTML = "";

  if (txs.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:24px;font-size:.85rem">No transactions yet</div>';
    return;
  }

  txs.forEach(t => {
    const item = document.createElement("div");
    item.className = "tx-item";
    item.innerHTML = `
      <div class="tx-left">
        <div class="tx-note">${t.note || (t.type === "in" ? "Added" : "Withdrawn")}</div>
        <div class="tx-date">${fmtDate(t.date)}</div>
      </div>
      <div class="tx-amount ${t.type === "in" ? "credit" : "debit"}">
        ${t.type === "in" ? "+" : "−"}${fmt(t.amount)}
      </div>`;
    item.addEventListener("click", () => editPotTx(t));
    list.appendChild(item);
  });
}

/* Add/Take money from pot */
document.getElementById("btn-pot-add").addEventListener("click", () => potTxModal("in"));
document.getElementById("btn-pot-take").addEventListener("click", () => potTxModal("out"));

function potTxModal(type) {
  const label = type === "in" ? "Add money" : "Take out";
  showModal(label, `
    <div class="form-group">
      <label class="form-label">Amount</label>
      <input type="number" class="form-input" id="modal-pot-amt" placeholder="₹">
    </div>
    <div class="form-group">
      <label class="form-label">Note</label>
      <input type="text" class="form-input" id="modal-pot-note" placeholder="Optional note">
    </div>`, [
    { label: label, primary: true, fn: async () => {
      const amt = parseFloat(document.getElementById("modal-pot-amt").value) || 0;
      if (amt <= 0) return;
      const note = document.getElementById("modal-pot-note").value.trim();
      await dbPut("potTx", {
        potId: currentPotId, date: new Date().toISOString(),
        type, amount: amt, note
      });
      toast(`${type === "in" ? "Added" : "Removed"} ${fmt(amt)}`);
      await checkMilestone(currentPotId);
      openPotDetail(currentPotId);
    }},
    { label: "Cancel" }
  ]);
}

function editPotTx(t) {
  showModal("Edit transaction", `
    <div class="form-group">
      <label class="form-label">Amount</label>
      <input type="number" class="form-input" id="modal-edit-amt" value="${t.amount}">
    </div>
    <div class="form-group">
      <label class="form-label">Note</label>
      <input type="text" class="form-input" id="modal-edit-note" value="${t.note || ""}">
    </div>`, [
    { label: "Save", primary: true, fn: async () => {
      t.amount = parseFloat(document.getElementById("modal-edit-amt").value) || t.amount;
      t.note = document.getElementById("modal-edit-note").value.trim();
      await dbPut("potTx", t);
      toast("Updated ✓");
      openPotDetail(currentPotId);
    }},
    { label: "Delete", danger: true, fn: async () => {
      await dbDelete("potTx", t.id);
      toast("Deleted");
      openPotDetail(currentPotId);
    }},
    { label: "Cancel" }
  ]);
}

document.getElementById("pot-back").addEventListener("click", () => showScreen("home"));

/* ═══════════════════════════════════════
   SCREEN 3: MONTHS
   ═══════════════════════════════════════ */
async function renderMonths() {
  const all = await dbGetAll("months");
  all.sort((a, b) => b.key.localeCompare(a.key));
  const list = document.getElementById("months-list");
  list.innerHTML = "";

  if (all.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:32px;font-size:.85rem">No months recorded yet.<br>Tap "+ New month" when your salary arrives.</div>';
    return;
  }

  all.forEach(m => {
    const card = document.createElement("div");
    card.className = "month-card";
    const isBonus = m.salary > config.income;
    const totalAllocated = (m.allocations || []).reduce((s, a) => s + a.amount, 0);
    const leftover = m.salary - totalAllocated;

    card.innerHTML = `
      <div class="month-header">
        <div>
          <div class="month-name">${monthLabel(m.key)}${isBonus ? ' 🎁' : ''}</div>
          <div style="font-size:.72rem;color:var(--text-dim)">${m.status === "done" ? "✓ Closed" : "Open"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="month-salary">${fmt(m.salary)}</div>
          <div class="month-chevron">▼</div>
        </div>
      </div>
      <div class="month-body">
        ${(m.allocations || []).map(a => `
          <div class="month-row">
            <span class="month-row-label">${a.label}</span>
            <span class="month-row-value">${fmt(a.amount)}</span>
          </div>
        `).join("")}
        <div class="month-row" style="border-top:1px solid var(--glass-border);margin-top:4px;padding-top:8px">
          <span class="month-row-label" style="font-weight:600">Spending budget</span>
          <span class="month-row-value">${fmt(leftover)}</span>
        </div>
        ${m.endBalance != null ? `
          <div class="month-row">
            <span class="month-row-label">End balance</span>
            <span class="month-row-value">${fmt(m.endBalance)}</span>
          </div>` : ""}
        ${m.leftoverNote ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:4px">${m.leftoverNote}</div>` : ""}
        <div class="btn-row" style="margin-top:8px">
          <button class="btn-secondary btn-sm" style="flex:1" data-edit-month="${m.key}">Edit</button>
          ${m.status !== "done" ? `<button class="btn-primary btn-sm" style="flex:1" data-close-month="${m.key}">Close month</button>` : ""}
        </div>
      </div>`;

    card.querySelector(".month-header").addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    list.appendChild(card);
  });

  // Wire up edit/close buttons
  list.querySelectorAll("[data-edit-month]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editMonth(btn.dataset.editMonth);
    });
  });
  list.querySelectorAll("[data-close-month]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMonth(btn.dataset.closeMonth);
    });
  });
}

/* New Month */
document.getElementById("btn-new-month").addEventListener("click", () => {
  const key = monthKey();
  showModal("New month – enter salary", `
    <div class="form-group">
      <label class="form-label">Month</label>
      <input type="month" class="form-input" id="modal-month-key" value="${key}">
    </div>
    <div class="form-group">
      <label class="form-label">Take-home salary</label>
      <input type="number" class="form-input" id="modal-salary" value="${config.income}" placeholder="₹">
    </div>
    <div id="modal-bonus-hint" class="hidden" style="font-size:.82rem;color:var(--yellow);margin-bottom:12px">
      🎁 Bonus month detected! Extra ₹<span id="modal-bonus-extra"></span>
    </div>
    <div id="modal-split-preview"></div>
  `, [
    { label: "Confirm & save", primary: true, fn: () => saveNewMonth() },
    { label: "Cancel" }
  ]);

  const salaryInput = document.getElementById("modal-salary");
  salaryInput.addEventListener("input", previewSplit);
  document.getElementById("modal-month-key").addEventListener("input", previewSplit);
  previewSplit();
});

function previewSplit() {
  const salary = parseFloat(document.getElementById("modal-salary").value) || 0;
  const key = document.getElementById("modal-month-key").value;
  const month = parseInt(key.split("-")[1]);
  const isBonus = config.bonusMonths.includes(month);
  const extra = salary - config.income;

  const hint = document.getElementById("modal-bonus-hint");
  if (extra > 0) {
    hint.classList.remove("hidden");
    document.getElementById("modal-bonus-extra").textContent = fmt(extra).replace("₹", "");
  } else {
    hint.classList.add("hidden");
  }

  // Build allocation preview
  const allocs = [];
  config.pots.forEach(p => {
    allocs.push({ label: `${p.icon} ${p.name}`, amount: p.monthly });
  });
  allocs.push({ label: "👩 Mother", amount: config.motherAmount });
  allocs.push({ label: "📈 SIP", amount: config.sipPPFAS.amount + config.sipNifty.amount });
  allocs.push({ label: "🔒 Floor", amount: config.floor });
  allocs.push({ label: "🪙 Spare", amount: config.spare });

  if (extra > 0) {
    allocs.push({ label: "🎁 Bonus extra → Emergency", amount: extra });
  }

  const total = allocs.reduce((s, a) => s + a.amount, 0);
  const spending = salary - total;

  const preview = document.getElementById("modal-split-preview");
  preview.innerHTML = `
    <div class="section-label" style="margin-top:8px">Split plan</div>
    ${allocs.map(a => `<div class="month-row"><span class="month-row-label">${a.label}</span><span class="month-row-value">${fmt(a.amount)}</span></div>`).join("")}
    <div class="month-row" style="border-top:1px solid var(--glass-border);margin-top:4px;padding-top:8px">
      <span class="month-row-label" style="font-weight:700;color:var(--text)">💳 Spending budget</span>
      <span class="month-row-value" style="color:var(--green)">${fmt(spending)}</span>
    </div>`;
}

async function saveNewMonth() {
  const key = document.getElementById("modal-month-key").value;
  const salary = parseFloat(document.getElementById("modal-salary").value) || config.income;
  const extra = salary - config.income;

  const allocations = [];
  config.pots.forEach(p => {
    allocations.push({ label: `${p.icon} ${p.name}`, potId: p.id, amount: p.monthly });
  });
  allocations.push({ label: "👩 Mother", amount: config.motherAmount });
  allocations.push({ label: "📈 SIP", amount: config.sipPPFAS.amount + config.sipNifty.amount });
  allocations.push({ label: "🔒 Floor", amount: config.floor });
  allocations.push({ label: "🪙 Spare", amount: config.spare });

  if (extra > 0) {
    allocations.push({ label: "🎁 Bonus → Emergency", potId: "emergency", amount: extra });
  }

  // Credit pots with monthly amounts
  for (const alloc of allocations) {
    if (alloc.potId) {
      await dbPut("potTx", {
        potId: alloc.potId, date: new Date().toISOString(),
        type: "in", amount: alloc.amount,
        note: `${monthLabel(key)} salary`
      });
    }
  }

  await dbPut("months", { key, salary, allocations, status: "open", createdAt: new Date().toISOString() });
  toast("Month saved ✓");
  renderMonths();
}

function editMonth(key) {
  // Simple: re-open the salary modal pre-filled
  showModal("Edit month", `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Edit the salary and allocations will be recalculated.</p>
    <div class="form-group">
      <label class="form-label">Take-home salary</label>
      <input type="number" class="form-input" id="modal-edit-salary" placeholder="₹">
    </div>`, [
    { label: "Save", primary: true, fn: async () => {
      const month = await dbGet("months", key);
      if (!month) return;
      const newSalary = parseFloat(document.getElementById("modal-edit-salary").value);
      if (newSalary && newSalary !== month.salary) {
        month.salary = newSalary;
        await dbPut("months", month);
        toast("Updated ✓");
        renderMonths();
      }
    }},
    { label: "Cancel" }
  ]);
}

function closeMonth(key) {
  showModal("Close month", `
    <p style="font-size:.85rem;margin-bottom:12px">Enter your final HSBC balance to calculate leftover.</p>
    <div class="form-group">
      <label class="form-label">End HSBC balance</label>
      <input type="number" class="form-input" id="modal-end-balance" placeholder="₹">
    </div>
    <div class="form-group">
      <label class="form-label">Leftover goes to</label>
      <select class="form-input" id="modal-leftover-dest">
        <option value="next">Roll into next month</option>
        ${config.pots.map(p => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join("")}
        <option value="leave">Leave in HSBC</option>
      </select>
    </div>`, [
    { label: "Close month", primary: true, fn: async () => {
      const month = await dbGet("months", key);
      if (!month) return;
      const endBal = parseFloat(document.getElementById("modal-end-balance").value) || 0;
      const dest = document.getElementById("modal-leftover-dest").value;
      month.endBalance = endBal;
      month.status = "done";

      const leftover = endBal - config.floor;
      if (leftover > 0 && dest !== "next" && dest !== "leave") {
        await dbPut("potTx", {
          potId: dest, date: new Date().toISOString(),
          type: "in", amount: leftover,
          note: `${monthLabel(key)} leftover`
        });
        month.leftoverNote = `₹${leftover} sent to ${config.pots.find(p => p.id === dest)?.name || dest}`;
      } else if (dest === "next") {
        month.leftoverNote = `₹${leftover} rolled into next month`;
      }

      await dbPut("months", month);
      toast("Month closed ✓");
      renderMonths();
    }},
    { label: "Cancel" }
  ]);
}

/* ═══════════════════════════════════════
   SCREEN 4: TRENDS
   ═══════════════════════════════════════ */
async function renderTrends() {
  const potBals = await getAllPotBalances();
  const totalPots = Object.values(potBals).reduce((s, v) => s + v, 0);
  const sip = estimateSIPValue();
  const netWorth = totalPots + sip.total;
  const months = await dbGetAll("months");
  months.sort((a, b) => a.key.localeCompare(b.key));

  // Stats
  const statsEl = document.getElementById("trend-stats");
  const totalSaved = totalPots;
  const monthCount = months.length || 1;
  const avgSavings = Math.round(totalSaved / monthCount);
  const savingsRate = months.length > 0
    ? Math.round((months.reduce((s, m) => {
        const alloc = (m.allocations || []).filter(a => a.potId).reduce((ss, a) => ss + a.amount, 0);
        return s + alloc;
      }, 0) / months.reduce((s, m) => s + m.salary, 0)) * 100)
    : 0;

  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${fmt(netWorth)}</div><div class="stat-label">Net worth</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(sip.total)}</div><div class="stat-label">SIP portfolio</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(avgSavings)}</div><div class="stat-label">Avg monthly saved</div></div>
    <div class="stat-card"><div class="stat-value">${savingsRate}%</div><div class="stat-label">Savings rate</div></div>`;

  // Charts — simple canvas charts
  renderLineChart("chart-networth", months, potBals, sip);
  renderSpendingChart("chart-spending", months);
  renderPotChart("chart-pots", months);
  renderSIPCard(sip);
}

function renderLineChart(canvasId, months, potBals, sipNow) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  const h = 200;
  canvas.width = w * 2; canvas.height = h * 2;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, w, h);

  if (months.length < 2) {
    ctx.fillStyle = "#7b7bab";
    ctx.font = "13px -apple-system,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Need 2+ months of data", w / 2, h / 2);
    return;
  }

  // Simple: plot total pots accumulation per month
  const points = months.map(m => {
    const potAlloc = (m.allocations || []).filter(a => a.potId).reduce((s, a) => s + a.amount, 0);
    return potAlloc;
  });

  // Cumulative
  const cumulative = [];
  let running = 0;
  points.forEach(p => { running += p; cumulative.push(running); });

  drawLine(ctx, w, h, cumulative, "#7c6cf0", months.map(m => monthLabel(m.key).slice(0, 3)));
}

function renderSpendingChart(canvasId, months) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  const h = 200;
  canvas.width = w * 2; canvas.height = h * 2;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, w, h);

  const recent = months.slice(-6);
  if (recent.length < 1) {
    ctx.fillStyle = "#7b7bab"; ctx.font = "13px -apple-system,sans-serif";
    ctx.textAlign = "center"; ctx.fillText("No data yet", w / 2, h / 2);
    return;
  }

  const spending = recent.map(m => {
    const totalAlloc = (m.allocations || []).reduce((s, a) => s + a.amount, 0);
    return m.salary - totalAlloc;
  });

  drawBars(ctx, w, h, spending, "#34d399", recent.map(m => monthLabel(m.key).slice(0, 3)));
}

function renderPotChart(canvasId, months) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  const h = 200;
  canvas.width = w * 2; canvas.height = h * 2;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, w, h);

  if (months.length < 2) {
    ctx.fillStyle = "#7b7bab"; ctx.font = "13px -apple-system,sans-serif";
    ctx.textAlign = "center"; ctx.fillText("Need 2+ months of data", w / 2, h / 2);
    return;
  }

  // Accumulate pot contributions per month
  const colors = ["#7c6cf0", "#34d399", "#fbbf24", "#fb923c"];
  const potNames = config.pots.map(p => p.name);
  const data = config.pots.map((pot, i) => {
    let running = 0;
    return months.map(m => {
      const contrib = (m.allocations || []).filter(a => a.potId === pot.id).reduce((s, a) => s + a.amount, 0);
      running += contrib;
      return running;
    });
  });

  // Draw stacked
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map(d => Math.max(...d)), 1);
  const xStep = plotW / (months.length - 1);

  data.forEach((series, si) => {
    ctx.beginPath();
    ctx.strokeStyle = colors[si % colors.length];
    ctx.lineWidth = 2;
    series.forEach((v, i) => {
      const x = pad.left + i * xStep;
      const y = pad.top + plotH - (v / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // Labels
  ctx.fillStyle = "#4a4a6a"; ctx.font = "10px -apple-system,sans-serif";
  ctx.textAlign = "center";
  months.forEach((m, i) => {
    ctx.fillText(monthLabel(m.key).slice(0, 3), pad.left + i * xStep, h - 8);
  });
}

function renderSIPCard(sip) {
  const card = document.getElementById("sip-card");
  const sip1 = config.sipPPFAS;
  const sip2 = config.sipNifty;
  if (sip1.amount === 0 && sip2.amount === 0) {
    card.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:.85rem">No SIPs configured. Add them in Settings.</div>';
    return;
  }
  card.innerHTML = `
    <div style="padding:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        ${sip1.amount > 0 ? `<div><div style="font-size:.75rem;color:var(--text-muted)">${sip1.name}</div>
          <div style="font-size:1.1rem;font-weight:700">${fmt(sip.ppfas)}</div>
          <div style="font-size:.68rem;color:var(--text-dim)">${fmt(sip1.amount)}/mo · ~${Math.round(sip1.cagr * 100)}% CAGR</div></div>` : ''}
        ${sip2.amount > 0 ? `<div style="text-align:right"><div style="font-size:.75rem;color:var(--text-muted)">${sip2.name}</div>
          <div style="font-size:1.1rem;font-weight:700">${fmt(sip.nifty)}</div>
          <div style="font-size:.68rem;color:var(--text-dim)">${fmt(sip2.amount)}/mo · ~${Math.round(sip2.cagr * 100)}% CAGR</div></div>` : ''}
      </div>
      <div style="text-align:center;padding-top:8px;border-top:1px solid var(--glass-border)">
        <div style="font-size:.72rem;color:var(--accent2)">Total SIP portfolio (estimated)</div>
        <div style="font-size:1.5rem;font-weight:800">${fmt(sip.total)}</div>
      </div>
    </div>`;
}

/* ── Simple Chart Helpers ── */
function drawLine(ctx, w, h, data, color, labels) {
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data, 1);
  const xStep = data.length > 1 ? plotW / (data.length - 1) : plotW;

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  data.forEach((v, i) => {
    const x = pad.left + i * xStep;
    const y = pad.top + plotH - (v / maxVal) * plotH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill
  ctx.lineTo(pad.left + (data.length - 1) * xStep, pad.top + plotH);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = color.replace(")", ",0.1)").replace("rgb", "rgba");
  ctx.fill();

  // Labels
  ctx.fillStyle = "#4a4a6a";
  ctx.font = "10px -apple-system,sans-serif";
  ctx.textAlign = "center";
  if (labels) {
    labels.forEach((l, i) => ctx.fillText(l, pad.left + i * xStep, h - 8));
  }

  // Y axis
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxVal / 4) * (4 - i));
    ctx.fillText(fmt(val).replace("₹", ""), pad.left - 6, pad.top + (plotH / 4) * i + 4);
  }
}

function drawBars(ctx, w, h, data, color, labels) {
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data, 1);
  const barW = Math.min(40, (plotW / data.length) * 0.6);
  const gap = plotW / data.length;

  data.forEach((v, i) => {
    const barH = (v / maxVal) * plotH;
    const x = pad.left + i * gap + (gap - barW) / 2;
    const y = pad.top + plotH - barH;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 4);
    ctx.fill();
  });

  ctx.fillStyle = "#4a4a6a";
  ctx.font = "10px -apple-system,sans-serif";
  ctx.textAlign = "center";
  if (labels) {
    labels.forEach((l, i) => ctx.fillText(l, pad.left + i * gap + gap / 2, h - 8));
  }

  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxVal / 4) * (4 - i));
    ctx.fillText(fmt(val).replace("₹", ""), pad.left - 6, pad.top + (plotH / 4) * i + 4);
  }
}

/* ═══════════════════════════════════════
   SCREEN 5: MORE
   ═══════════════════════════════════════ */

/* Afford calculator */
document.getElementById("btn-afford").addEventListener("click", () => {
  showModal("Can I afford this?", `
    <input type="number" class="afford-input" id="afford-amount" placeholder="₹ amount">
    <div class="afford-result" id="afford-result"></div>`, [
    { label: "Check", primary: true, fn: checkAfford },
    { label: "Close" }
  ]);
});

async function checkAfford() {
  const amount = parseFloat(document.getElementById("afford-amount").value) || 0;
  if (amount <= 0) return;

  const snap = await getLatestSnapshot();
  const hsbc = snap ? snap.hsbc : 0;
  const cc = snap ? snap.cc : 0;
  const safeToSpend = hsbc - cc - config.floor;

  const resultEl = document.getElementById("afford-result");

  if (amount <= safeToSpend * 0.3) {
    resultEl.innerHTML = `
      <div class="afford-verdict" style="color:var(--green)">✅ Easily!</div>
      <div class="afford-detail">
        That's only ${Math.round(amount / safeToSpend * 100)}% of your safe-to-spend balance.
        You'll still have ${fmt(safeToSpend - amount)} left.
      </div>`;
  } else if (amount <= safeToSpend) {
    resultEl.innerHTML = `
      <div class="afford-verdict" style="color:var(--yellow)">⚠️ Yes, but it's a big chunk</div>
      <div class="afford-detail">
        That's ${Math.round(amount / safeToSpend * 100)}% of your safe-to-spend balance.
        You'll have ${fmt(safeToSpend - amount)} for the rest of the month.
        Daily budget drops to ~${fmt(Math.round((safeToSpend - amount) / daysLeftInMonth()))}/day.
      </div>`;
  } else {
    // Check pots
    const potBals = await getAllPotBalances();
    const bestPot = config.pots
      .filter(p => (potBals[p.id] || 0) >= amount && p.id !== "emergency")
      .sort((a, b) => (potBals[a.id] || 0) - (potBals[b.id] || 0))[0];

    if (bestPot) {
      const delay = bestPot.target > 0
        ? Math.ceil(amount / bestPot.monthly) + " months delay on target"
        : "no target impact";
      resultEl.innerHTML = `
        <div class="afford-verdict" style="color:var(--orange)">💡 You'd need to dip into a pot</div>
        <div class="afford-detail">
          Not enough in spending budget (${fmt(safeToSpend)} available).<br>
          Closest fit: <strong>${bestPot.icon} ${bestPot.name}</strong> (${fmt(potBals[bestPot.id])}).<br>
          Impact: ${delay}.
        </div>`;
    } else {
      resultEl.innerHTML = `
        <div class="afford-verdict" style="color:var(--red)">❌ Not right now</div>
        <div class="afford-detail">
          Spending budget: ${fmt(safeToSpend)}. No single pot covers this either.
          Consider saving up over ${Math.ceil(amount / config.spendingBudget)} months.
        </div>`;
    }
  }
}

/* Milestones */
document.getElementById("btn-milestones").addEventListener("click", async () => {
  const milestones = await dbGetAll("milestones");
  milestones.sort((a, b) => new Date(b.date) - new Date(a.date));

  const body = milestones.length > 0
    ? milestones.map(m => `<div class="month-row"><span class="month-row-label">${m.emoji} ${m.text}</span><span class="month-row-value" style="font-size:.7rem;color:var(--text-dim)">${fmtDate(m.date)}</span></div>`).join("")
    : '<div style="text-align:center;color:var(--text-dim);padding:16px">No milestones yet — they\'ll appear as your pots grow! 🌱</div>';

  showModal("🎉 Milestones", body, [{ label: "Close" }]);
});

/* Milestone checker */
async function checkMilestone(potId) {
  const pot = config.pots.find(p => p.id === potId);
  if (!pot) return;
  const bal = await getPotBalance(potId);
  const thresholds = [10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];

  for (const t of thresholds) {
    if (bal >= t && bal - (await getLastTxAmount(potId)) < t) {
      // Just crossed this threshold
      const existing = await dbGetAll("milestones");
      const dupe = existing.find(m => m.potId === potId && m.threshold === t);
      if (!dupe) {
        await dbPut("milestones", {
          potId, threshold: t, date: new Date().toISOString(),
          emoji: "🎉", text: `${pot.name} crossed ${fmt(t)}!`
        });
        showCelebration(`${pot.icon} ${pot.name}`, `Crossed ${fmt(t)}!`);
      }
      break;
    }
  }
}

async function getLastTxAmount(potId) {
  const txs = await dbGetAll("potTx", "potId", IDBKeyRange.only(potId));
  if (txs.length === 0) return 0;
  txs.sort((a, b) => new Date(b.date) - new Date(a.date));
  return txs[0].type === "in" ? txs[0].amount : -txs[0].amount;
}

function showCelebration(title, sub) {
  const el = document.createElement("div");
  el.className = "celebration";
  el.innerHTML = `
    <div class="celebration-emoji">🎉</div>
    <div class="celebration-text">${title}</div>
    <div class="celebration-sub">${sub}</div>
    <button class="btn-primary" style="max-width:200px;margin-top:20px" id="celebration-close">Awesome!</button>`;
  document.body.appendChild(el);
  el.querySelector("#celebration-close").addEventListener("click", () => el.remove());
  setTimeout(() => { if (el.parentElement) el.remove(); }, 5000);
}

/* Settings */
document.getElementById("btn-settings").addEventListener("click", () => {
  showModal("Settings", `
    <div class="form-group">
      <label class="form-label">Monthly income (₹)</label>
      <input type="number" class="form-input" id="set-income" value="${config.income}">
    </div>
    <div class="form-group">
      <label class="form-label">Bonus income (₹)</label>
      <input type="number" class="form-input" id="set-bonus" value="${config.bonusIncome}">
    </div>
    <div class="form-group">
      <label class="form-label">Spending budget (₹)</label>
      <input type="number" class="form-input" id="set-budget" value="${config.spendingBudget}">
    </div>
    <div class="form-group">
      <label class="form-label">Floor (₹)</label>
      <input type="number" class="form-input" id="set-floor" value="${config.floor}">
    </div>
    <div class="form-group">
      <label class="form-label">Mother amount (₹)</label>
      <input type="number" class="form-input" id="set-mother" value="${config.motherAmount}">
    </div>
    <div class="section-label">Pots</div>
    <div id="set-pots-list">
      ${config.pots.map((p, i) => `
        <div class="month-row">
          <span>${p.icon} ${p.name}</span>
          <span>₹${p.monthly}/mo ${p.target > 0 ? `→ ${fmt(p.target)}` : ""}</span>
        </div>
      `).join("")}
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--glass-border)">
      <div class="section-label">Danger zone</div>
      <button type="button" class="btn-secondary btn-sm" id="set-rerun-setup" style="width:100%;margin-bottom:8px">🔄 Re-run setup wizard</button>
      <button type="button" class="btn-danger btn-sm" id="set-reset-all" style="width:100%">🗑️ Reset all data & start fresh</button>
    </div>`, [
    { label: "Save", primary: true, fn: async () => {
      config.income = parseFloat(document.getElementById("set-income").value) || config.income;
      config.bonusIncome = parseFloat(document.getElementById("set-bonus").value) || config.bonusIncome;
      config.spendingBudget = parseFloat(document.getElementById("set-budget").value) || config.spendingBudget;
      config.floor = parseFloat(document.getElementById("set-floor").value) || config.floor;
      config.motherAmount = parseFloat(document.getElementById("set-mother").value) || config.motherAmount;
      await saveConfig();
      toast("Settings saved ✓");
      renderHome();
    }},
    { label: "Cancel" }
  ]);

  // Wire up danger zone buttons after modal renders
  setTimeout(() => {
    document.getElementById("set-rerun-setup")?.addEventListener("click", () => {
      closeModal();
      config.setupDone = false;
      saveConfig().then(() => showSetupWizard());
    });
    document.getElementById("set-reset-all")?.addEventListener("click", () => {
      if (confirm("This will delete ALL your data — pots, months, snapshots, everything. Are you sure?")) {
        closeModal();
        indexedDB.deleteDatabase(DB_NAME);
        location.reload();
      }
    });
  }, 50);
});

/* Export */
document.getElementById("btn-export").addEventListener("click", async () => {
  const data = {
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    config: await dbGet("config", "main"),
    snapshots: await dbGetAll("snapshots"),
    potTx: await dbGetAll("potTx"),
    months: await dbGetAll("months"),
    milestones: await dbGetAll("milestones")
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paisa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported ✓");
});

/* Import */
document.getElementById("btn-import").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.config) await dbPut("config", data.config, "main");
      if (data.snapshots) for (const s of data.snapshots) await dbPut("snapshots", s);
      if (data.potTx) for (const t of data.potTx) await dbPut("potTx", t);
      if (data.months) for (const m of data.months) await dbPut("months", m);
      if (data.milestones) for (const m of data.milestones) await dbPut("milestones", m);

      await loadConfig();
      toast("Imported ✓ — refreshing");
      renderHome();
    } catch (err) {
      toast("Import failed: " + err.message);
    }
  });
  input.click();
});

/* About */
document.getElementById("btn-about").addEventListener("click", () => {
  showModal("About Paisa", `
    <div style="text-align:center;padding:16px">
      <div style="font-size:3rem">💰</div>
      <div style="font-size:1.2rem;font-weight:700;margin:8px 0">Paisa v${APP_VERSION}</div>
      <div style="font-size:.82rem;color:var(--text-muted);line-height:1.6">
        Personal money dashboard.<br>
        Data stays on your device (IndexedDB).<br>
        No server, no tracking, no ads.
      </div>
    </div>`, [{ label: "Close" }]);
});

/* ═══════════════════════════════════════
   FIRST-RUN SETUP WIZARD
   ═══════════════════════════════════════ */
const SETUP_STEPS = [
  { id: "welcome", title: "Welcome to Paisa 💰", subtitle: "Your personal money dashboard.<br>All data stays on this device — never sent anywhere." },
  { id: "income", title: "Your income", subtitle: "Monthly take-home salary" },
  { id: "bonus", title: "Bonus months", subtitle: "Some months you get more — tell us which" },
  { id: "split", title: "Monthly split", subtitle: "How your salary is divided" },
  { id: "pots", title: "Savings pots", subtitle: "Set up your savings buckets" },
  { id: "balances", title: "Starting balances", subtitle: "Current pot balances (we'll seed these)" },
  { id: "sip", title: "SIP investments", subtitle: "Track mutual fund SIPs (optional)" },
  { id: "done", title: "You're all set! 🎉", subtitle: "Your dashboard is ready." }
];
let setupStep = 0;

function showSetupWizard() {
  // Hide all screens and nav
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.querySelector(".bottom-nav").classList.add("hidden");

  // Create setup overlay
  let overlay = document.getElementById("setup-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "setup-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:200;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 20px calc(24px + env(safe-area-inset-bottom,0))";
    document.body.appendChild(overlay);
  }
  setupStep = 0;
  renderSetupStep();
}

function renderSetupStep() {
  const overlay = document.getElementById("setup-overlay");
  const step = SETUP_STEPS[setupStep];
  const isFirst = setupStep === 0;
  const isLast = setupStep === SETUP_STEPS.length - 1;

  // Dots
  const dots = SETUP_STEPS.map((_, i) =>
    `<div style="width:8px;height:8px;border-radius:50%;background:${i === setupStep ? 'var(--accent)' : 'var(--surface2)'}"></div>`
  ).join("");

  let body = "";

  switch (step.id) {
    case "welcome":
      body = `
        <div style="text-align:center;padding-top:60px">
          <div style="font-size:4rem;margin-bottom:16px">💰</div>
          <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:8px">${step.title}</h2>
          <p style="color:var(--text-muted);line-height:1.6;font-size:.9rem">${step.subtitle}</p>
          <div style="margin-top:32px;font-size:.78rem;color:var(--text-dim)">
            🔒 Zero data leaves your device<br>
            📱 Works offline after first load<br>
            📤 Export anytime as JSON backup
          </div>
        </div>`;
      break;

    case "income":
      body = `
        <div class="form-group">
          <label class="form-label">Monthly take-home salary (₹)</label>
          <input type="number" class="form-input" id="setup-income" value="${config.income || ''}" placeholder="e.g. 95000">
        </div>
        <div class="form-group">
          <label class="form-label">Spending budget (₹) — what stays in your account for daily use</label>
          <input type="number" class="form-input" id="setup-budget" value="${config.spendingBudget || ''}" placeholder="e.g. 46000">
        </div>
        <div class="form-group">
          <label class="form-label">Floor (₹) — minimum you never touch</label>
          <input type="number" class="form-input" id="setup-floor" value="${config.floor || ''}" placeholder="e.g. 5000">
        </div>`;
      break;

    case "bonus":
      body = `
        <div class="form-group">
          <label class="form-label">Bonus take-home (₹) — leave 0 if no bonus months</label>
          <input type="number" class="form-input" id="setup-bonus-income" value="${config.bonusIncome || ''}" placeholder="e.g. 104000">
        </div>
        <div class="form-group">
          <label class="form-label">Which months? (tap to toggle)</label>
          <div id="setup-bonus-months" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
            ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => {
              const active = (config.bonusMonths || []).includes(i + 1);
              return `<button type="button" class="btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" data-month="${i+1}" style="width:calc(25% - 6px)">${m}</button>`;
            }).join("")}
          </div>
        </div>`;
      break;

    case "split":
      body = `
        <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
          Fixed transfers each month (separate from pots — set those next).
        </p>
        <div class="form-group">
          <label class="form-label">Transfer to family/parent (₹/month) — 0 if none</label>
          <input type="number" class="form-input" id="setup-mother" value="${config.motherAmount || ''}" placeholder="e.g. 3000">
        </div>
        <div class="form-group">
          <label class="form-label">Transfer day of month</label>
          <input type="number" class="form-input" id="setup-transfer-day" value="${config.transferDay || 2}" placeholder="e.g. 2" min="1" max="28">
        </div>
        <div class="form-group">
          <label class="form-label">Spare change (₹) — leftover rounding</label>
          <input type="number" class="form-input" id="setup-spare" value="${config.spare || ''}" placeholder="e.g. 21">
        </div>`;
      break;

    case "pots": {
      const pots = config.pots.length > 0 ? config.pots : [
        { id: "pot1", name: "", target: 0, monthly: 0, icon: "🛡️" }
      ];
      body = `
        <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
          Add your savings pots. Each gets a monthly auto-credit.
        </p>
        <div id="setup-pots-list">
          ${pots.map((p, i) => setupPotRow(p, i)).join("")}
        </div>
        <button type="button" class="btn-secondary btn-sm" id="setup-add-pot" style="margin-top:10px">+ Add pot</button>`;
      break;
    }

    case "balances": {
      const pots = config.pots.length > 0 ? config.pots : [];
      if (pots.length === 0) {
        body = `<p style="color:var(--text-dim);text-align:center;padding:24px">No pots set up — go back and add some, or skip this step.</p>`;
      } else {
        body = `
          <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
            Enter current balance for each pot. Leave 0 for new pots.
          </p>
          ${pots.map(p => `
            <div class="form-group">
              <label class="form-label">${p.icon} ${p.name}</label>
              <input type="number" class="form-input setup-pot-balance" data-pot-id="${p.id}" value="0" placeholder="₹ current balance">
            </div>
          `).join("")}`;
      }
      break;
    }

    case "sip":
      body = `
        <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
          Track SIP mutual funds to estimate net worth. Skip if you don't have SIPs.
        </p>
        <div class="form-group">
          <label class="form-label">SIP Fund 1 — Name</label>
          <input type="text" class="form-input" id="setup-sip1-name" value="${config.sipPPFAS.name || ''}" placeholder="e.g. PPFAS Flexi Cap">
        </div>
        <div style="display:flex;gap:10px">
          <div class="form-group" style="flex:1">
            <label class="form-label">Monthly (₹)</label>
            <input type="number" class="form-input" id="setup-sip1-amt" value="${config.sipPPFAS.amount || ''}" placeholder="e.g. 10000">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Expected CAGR (%)</label>
            <input type="number" class="form-input" id="setup-sip1-cagr" value="${config.sipPPFAS.cagr ? config.sipPPFAS.cagr * 100 : ''}" placeholder="e.g. 15" step="0.5">
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">SIP Fund 2 — Name</label>
          <input type="text" class="form-input" id="setup-sip2-name" value="${config.sipNifty.name || ''}" placeholder="e.g. UTI Nifty 50">
        </div>
        <div style="display:flex;gap:10px">
          <div class="form-group" style="flex:1">
            <label class="form-label">Monthly (₹)</label>
            <input type="number" class="form-input" id="setup-sip2-amt" value="${config.sipNifty.amount || ''}" placeholder="e.g. 15000">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Expected CAGR (%)</label>
            <input type="number" class="form-input" id="setup-sip2-cagr" value="${config.sipNifty.cagr ? config.sipNifty.cagr * 100 : ''}" placeholder="e.g. 12" step="0.5">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">SIP auto-debit day</label>
          <input type="number" class="form-input" id="setup-sip-day" value="${config.sipDay || 3}" min="1" max="28">
        </div>`;
      break;

    case "done":
      body = `
        <div style="text-align:center;padding-top:40px">
          <div style="font-size:4rem;margin-bottom:16px">🎉</div>
          <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">${step.title}</h2>
          <p style="color:var(--text-muted);line-height:1.6;font-size:.9rem">${step.subtitle}</p>
          <div style="margin-top:16px;font-size:.82rem;color:var(--text-dim)">
            All your data is stored locally in IndexedDB.<br>
            Nothing is in the source code. Nothing leaves your device.
          </div>
        </div>`;
      break;
  }

  const prevBtn = isFirst ? "" : `<button type="button" class="btn-secondary btn-sm" id="setup-prev" style="flex:1">Back</button>`;
  const nextLabel = isLast ? "Let's go!" : (isFirst ? "Get started" : "Next");

  overlay.innerHTML = `
    <div style="max-width:420px;margin:0 auto">
      <div style="display:flex;justify-content:center;gap:6px;margin-bottom:24px">${dots}</div>
      <div style="font-size:.72rem;color:var(--text-dim);text-align:center;margin-bottom:4px">Step ${setupStep + 1} of ${SETUP_STEPS.length}</div>
      ${!isFirst && !isLast ? `<h2 style="font-size:1.2rem;font-weight:700;margin-bottom:4px">${step.title}</h2><p style="font-size:.78rem;color:var(--text-muted);margin-bottom:16px">${step.subtitle}</p>` : ''}
      ${body}
      <div class="btn-row" style="margin-top:24px">
        ${prevBtn}
        <button type="button" class="btn-primary btn-sm" id="setup-next" style="flex:1">${nextLabel}</button>
      </div>
    </div>`;

  // Wire up events
  const nextBtn = overlay.querySelector("#setup-next");
  const backBtn = overlay.querySelector("#setup-prev");
  if (nextBtn) nextBtn.addEventListener("click", () => advanceSetup(1));
  if (backBtn) backBtn.addEventListener("click", () => advanceSetup(-1));

  // Bonus month toggles
  if (step.id === "bonus") {
    overlay.querySelectorAll("#setup-bonus-months button").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("btn-primary");
        btn.classList.toggle("btn-secondary");
      });
    });
  }

  // Add pot button
  if (step.id === "pots") {
    overlay.querySelector("#setup-add-pot")?.addEventListener("click", () => {
      const list = overlay.querySelector("#setup-pots-list");
      const idx = list.children.length;
      const id = "pot" + (idx + 1);
      const div = document.createElement("div");
      div.innerHTML = setupPotRow({ id, name: "", target: 0, monthly: 0, icon: "💰" }, idx);
      list.appendChild(div.firstElementChild);
    });
  }
}

function setupPotRow(pot, idx) {
  const icons = ["🛡️","🎯","👨‍👩‍👦","🏠","✈️","🎓","💰","🚗","💻","🎮"];
  return `
    <div class="glass-card setup-pot-row" data-idx="${idx}" style="margin-bottom:10px;padding:12px">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select class="form-input setup-pot-icon" style="width:60px;text-align:center;font-size:1.2rem">${icons.map(i => `<option ${i === pot.icon ? 'selected' : ''}>${i}</option>`).join("")}</select>
        <input type="text" class="form-input setup-pot-name" value="${pot.name}" placeholder="Pot name" style="flex:1">
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1"><label class="form-label">Monthly ₹</label><input type="number" class="form-input setup-pot-monthly" value="${pot.monthly || ''}" placeholder="0"></div>
        <div style="flex:1"><label class="form-label">Target ₹</label><input type="number" class="form-input setup-pot-target" value="${pot.target || ''}" placeholder="0 = no target"></div>
      </div>
    </div>`;
}

function collectSetupData(stepId) {
  const overlay = document.getElementById("setup-overlay");

  switch (stepId) {
    case "income":
      config.income = parseFloat(overlay.querySelector("#setup-income")?.value) || 0;
      config.spendingBudget = parseFloat(overlay.querySelector("#setup-budget")?.value) || 0;
      config.floor = parseFloat(overlay.querySelector("#setup-floor")?.value) || 0;
      break;

    case "bonus": {
      config.bonusIncome = parseFloat(overlay.querySelector("#setup-bonus-income")?.value) || 0;
      const selected = [];
      overlay.querySelectorAll("#setup-bonus-months button.btn-primary").forEach(b => {
        selected.push(parseInt(b.dataset.month));
      });
      config.bonusMonths = selected;
      break;
    }

    case "split":
      config.motherAmount = parseFloat(overlay.querySelector("#setup-mother")?.value) || 0;
      config.transferDay = parseInt(overlay.querySelector("#setup-transfer-day")?.value) || 2;
      config.spare = parseFloat(overlay.querySelector("#setup-spare")?.value) || 0;
      break;

    case "pots": {
      const pots = [];
      overlay.querySelectorAll(".setup-pot-row").forEach((row, i) => {
        const name = row.querySelector(".setup-pot-name")?.value.trim();
        if (!name) return;
        const icon = row.querySelector(".setup-pot-icon")?.value || "💰";
        const monthly = parseFloat(row.querySelector(".setup-pot-monthly")?.value) || 0;
        const target = parseFloat(row.querySelector(".setup-pot-target")?.value) || 0;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ("pot" + i);
        pots.push({ id, name, icon, monthly, target });
      });
      config.pots = pots;
      break;
    }

    case "balances": {
      pendingPotBalances = {};
      overlay.querySelectorAll(".setup-pot-balance").forEach(inp => {
        const potId = inp.dataset.potId;
        const amount = parseFloat(inp.value) || 0;
        if (potId && amount > 0) {
          pendingPotBalances[potId] = amount;
        }
      });
      break;
    }

    case "sip":
      config.sipPPFAS = {
        name: overlay.querySelector("#setup-sip1-name")?.value.trim() || "SIP Fund 1",
        amount: parseFloat(overlay.querySelector("#setup-sip1-amt")?.value) || 0,
        cagr: (parseFloat(overlay.querySelector("#setup-sip1-cagr")?.value) || 0) / 100
      };
      config.sipNifty = {
        name: overlay.querySelector("#setup-sip2-name")?.value.trim() || "SIP Fund 2",
        amount: parseFloat(overlay.querySelector("#setup-sip2-amt")?.value) || 0,
        cagr: (parseFloat(overlay.querySelector("#setup-sip2-cagr")?.value) || 0) / 100
      };
      config.sipDay = parseInt(overlay.querySelector("#setup-sip-day")?.value) || 3;
      break;
  }
}

async function advanceSetup(direction) {
  const currentStep = SETUP_STEPS[setupStep];

  // Collect data from current step before moving
  if (direction > 0) {
    collectSetupData(currentStep.id);
  }

  setupStep += direction;
  if (setupStep < 0) setupStep = 0;

  if (setupStep >= SETUP_STEPS.length) {
    // Finish setup
    await finishSetup();
    return;
  }

  renderSetupStep();
}

async function finishSetup() {
  config.setupDone = true;
  config.setupDate = new Date().toISOString();
  await saveConfig();

  // Seed starting balances from the collected pendingPotBalances
  for (const [potId, amount] of Object.entries(pendingPotBalances)) {
    if (amount > 0) {
      await dbPut("potTx", {
        potId, date: new Date().toISOString(),
        type: "in", amount, note: "Starting balance"
      });
    }
  }
  pendingPotBalances = {};

  // Remove overlay, show app
  const overlay = document.getElementById("setup-overlay");
  if (overlay) overlay.remove();
  document.querySelector(".bottom-nav").classList.remove("hidden");
  renderHome();
}

/* ═══ INIT ═══ */
async function init() {
  await openDB();
  await loadConfig();

  // First-run: show setup wizard if not configured yet
  if (!config.setupDone) {
    showSetupWizard();
    return;
  }

  renderHome();
}

// Register service worker with self-healing update
const APP_CACHE_VERSION = "paisa-v3";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    // Check for updates immediately, then every 60s
    reg.update();
    setInterval(() => reg.update(), 60000);

    // When a new SW is found waiting, force it to activate
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New version ready — tell it to take over
          newWorker.postMessage("SKIP_WAITING");
        }
      });
    });
  });

  // When the new SW takes control, reload to get fresh assets
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // On load, check if current SW is outdated
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) {
      // Ask the SW its version
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        if (e.data && e.data.type === "VERSION" && e.data.version !== APP_CACHE_VERSION) {
          // SW is old — unregister and force reload
          console.log(`[Paisa] SW version mismatch: ${e.data.version} vs ${APP_CACHE_VERSION}, forcing update`);
          reg.unregister().then(() => {
            caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("paisa-")).map(k => caches.delete(k))))
              .then(() => window.location.reload());
          });
        }
      };
      reg.active.postMessage("GET_VERSION", [ch.port2]);
    }
  });
}

init();
