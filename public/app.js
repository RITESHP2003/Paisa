/* ═══════════════════════════════════════════
   Paisa — Personal Money Dashboard
   Pure vanilla JS + IndexedDB
   ═══════════════════════════════════════════ */
"use strict";

const APP_VERSION = 4;

/* ── Default Config (no personal data — filled during first-run setup) ── */
const DEFAULT_CONFIG = {
  income: 0,
  bonusIncome: 0,
  bonusMonths: [],
  floor: 0,
  spendingBudget: 0,
  sips: [], // [{id, name, amount, day}]
  sipDay: 3,
  transferDay: 2,
  pots: [],
  motherAmount: 0,
  spare: 0,
  setupDone: false
};

/* ── IndexedDB ── */
const DB_NAME = "PaisaDB";
const DB_VERSION = 2; // bumped for loans store
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
        d.createObjectStore("months", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("milestones")) {
        d.createObjectStore("milestones", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("loans")) {
        d.createObjectStore("loans", { keyPath: "id", autoIncrement: true });
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
    const s = tx(store, "readwrite");
    let r;
    if (key !== undefined) r = s.put(val, key);
    else if (val.id != null) r = s.put(val);
    else r = s.add(val);
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
let currentLoanId = null;
let pendingPotBalances = {};

/* ── Formatting ── */
function fmt(n) {
  if (n == null || isNaN(n)) return "₹0";
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const s = abs.toString();
  let result = "";
  if (s.length <= 3) result = s;
  else {
    result = s.slice(-3);
    let rem = s.slice(0, -3);
    while (rem.length > 2) { result = rem.slice(-2) + "," + result; rem = rem.slice(0, -2); }
    if (rem.length > 0) result = rem + "," + result;
  }
  return (neg ? "-₹" : "₹") + result;
}
function fmtDate(d) { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function monthKey(d) { const dt = d ? new Date(d) : new Date(); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`; }
function monthLabel(key) { const [y,m] = key.split("-"); return new Date(y, m-1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); }
function daysLeftInMonth() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth()+1, 0).getDate() - n.getDate(); }
function ordinal(n) { const s=["th","st","nd","rd"]; const v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
function toast(msg) { const el=document.getElementById("toast"); el.textContent=msg; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),2200); }

/* ── Navigation ── */
const screens = ["home", "months", "money", "more"];
let activeScreen = "home";

function showScreen(name) {
  if (name === "pot" || name === "loan") {
    screens.forEach(s => document.getElementById(`screen-${s}`).classList.add("hidden"));
    document.getElementById("screen-pot").classList.add("hidden");
    document.getElementById("screen-loan").classList.add("hidden");
    document.getElementById(`screen-${name}`).classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    activeScreen = name;
    return;
  }
  screens.forEach(s => document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name));
  document.getElementById("screen-pot").classList.add("hidden");
  document.getElementById("screen-loan").classList.add("hidden");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  activeScreen = name;
  if (name === "home") renderHome();
  if (name === "months") renderMonths();
  if (name === "money") renderMoney();
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
function closeModal() { const r=document.getElementById("modal-root"); r.classList.add("hidden"); r.innerHTML=""; }

/* ═══ CONFIG ═══ */
async function loadConfig() {
  const saved = await dbGet("config", "main");
  if (saved) {
    config = { ...DEFAULT_CONFIG, ...saved };
    if (saved.pots) config.pots = saved.pots;
    if (saved.sips) config.sips = saved.sips;
    // Migrate old sipPPFAS/sipNifty format to new sips array
    if (!saved.sips && (saved.sipPPFAS || saved.sipNifty)) {
      config.sips = [];
      if (saved.sipPPFAS && saved.sipPPFAS.amount > 0) {
        config.sips.push({ id: "sip-1", name: saved.sipPPFAS.name || "SIP Fund 1", amount: saved.sipPPFAS.amount });
      }
      if (saved.sipNifty && saved.sipNifty.amount > 0) {
        config.sips.push({ id: "sip-2", name: saved.sipNifty.name || "SIP Fund 2", amount: saved.sipNifty.amount });
      }
      // Save migration
      await saveConfig();
    }
  }
}
async function saveConfig() { await dbPut("config", config, "main"); }

/* ═══ HELPERS ═══ */
async function getPotBalance(potId) {
  const txs = await dbGetAll("potTx", "potId", IDBKeyRange.only(potId));
  return txs.reduce((sum, t) => sum + (t.type === "in" ? t.amount : -t.amount), 0);
}
async function getAllPotBalances() {
  const result = {};
  for (const pot of config.pots) result[pot.id] = await getPotBalance(pot.id);
  return result;
}
function getSIPSummary() {
  const start = config.setupDate ? new Date(config.setupDate) : new Date();
  start.setDate(1);
  const now = new Date();
  const months = Math.max(0, (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth()));
  const sips = config.sips || [];
  let totalMonthly = 0;
  let totalInvested = 0;
  const funds = sips.map(s => {
    const invested = s.amount * months;
    totalMonthly += s.amount;
    totalInvested += invested;
    return { ...s, invested, months };
  });
  return { funds, totalMonthly, totalInvested, months };
}
async function getLatestSnapshot() {
  const all = await dbGetAll("snapshots");
  if (!all.length) return null;
  all.sort((a,b) => new Date(b.date)-new Date(a.date));
  return all[0];
}

/* ═══════════════════════════════════════
   SCREEN 1: HOME (lean — glance-and-go)
   ═══════════════════════════════════════ */
async function renderHome() {
  document.getElementById("home-date").textContent = new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"});
  const snap = await getLatestSnapshot();
  const hsbc = snap ? snap.hsbc : 0;
  const cc = snap ? snap.cc : 0;
  const extraMoney = snap ? (snap.extra || 0) : 0;

  const today = new Date().getDate();
  let remaining = 0;
  if (today < config.transferDay) {
    remaining += config.pots.reduce((s,p)=>s+p.monthly,0) + config.motherAmount;
  }
  if (today < config.sipDay) remaining += (config.sips||[]).reduce((s,f)=>s+f.amount,0);

  const heroEl = document.getElementById("safe-to-spend");
  const hasSnapshot = snap && (snap.hsbc > 0 || snap.cc > 0);

  if (!hasSnapshot) {
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
    const pct = Math.min(100, Math.max(0, (spent/config.spendingBudget)*100));
    heroEl.textContent = fmt(safeToSpend);
    heroEl.className = "hero-amount" + (safeToSpend < 5000 ? " danger" : safeToSpend < 15000 ? " warning" : "");
    const daysLeft = daysLeftInMonth();
    const dailyBudget = daysLeft > 0 ? Math.round(safeToSpend/daysLeft) : 0;
    let dailyHtml = `~<strong>${fmt(dailyBudget)}</strong>/day for ${daysLeft} days`;
    document.getElementById("daily-budget").innerHTML = dailyHtml;
    document.getElementById("budget-bar").style.width = pct+"%";
    document.getElementById("budget-bar").className = "progress-fill "+(pct>85?"red":pct>60?"yellow":"green");
    document.getElementById("budget-used").textContent = fmt(Math.max(0,spent))+" spent";
    document.getElementById("budget-total").textContent = "of "+fmt(config.spendingBudget);
  }

  if (snap) {
    document.getElementById("inp-hsbc").value = snap.hsbc || "";
    document.getElementById("inp-cc").value = snap.cc || "";
  }

  // Extra money log
  renderExtraMoneyLog(snap);

  // New month prompt
  await checkNewMonthPrompt(snap);

  // Loan reminders
  await renderLoanReminders();
}

/* ── Extra Money Log ── */
function renderExtraMoneyLog(snap) {
  const section = document.getElementById("extra-money-section");
  const list = document.getElementById("extra-money-list");
  const totalEl = document.getElementById("extra-total");

  if (!snap || !snap.extraLog || snap.extraLog.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  totalEl.textContent = fmt(snap.extra || 0);
  list.innerHTML = "";

  snap.extraLog.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "extra-item";
    item.innerHTML = `
      <div>
        <div style="font-size:.85rem">${entry.note || "Extra money"}</div>
        <div style="font-size:.68rem;color:var(--text-dim)">${fmtDate(entry.date)}</div>
      </div>
      <div style="font-size:.95rem;font-weight:700;color:var(--green)">+${fmt(entry.amount)}</div>`;
    item.addEventListener("click", () => editExtraMoney(snap, idx));
    list.appendChild(item);
  });
}

function editExtraMoney(snap, idx) {
  const entry = snap.extraLog[idx];
  showModal("Edit extra money", `
    <div class="form-group">
      <label class="form-label">Amount</label>
      <input type="number" class="form-input" id="modal-edit-extra-amt" value="${entry.amount}">
    </div>
    <div class="form-group">
      <label class="form-label">Note</label>
      <input type="text" class="form-input" id="modal-edit-extra-note" value="${entry.note || ""}">
    </div>`, [
    { label: "Save", primary: true, fn: async () => {
      const newAmt = parseFloat(document.getElementById("modal-edit-extra-amt").value) || 0;
      const oldAmt = entry.amount;
      entry.amount = newAmt;
      entry.note = document.getElementById("modal-edit-extra-note").value.trim();
      snap.extra = (snap.extra || 0) - oldAmt + newAmt;
      await dbPut("snapshots", snap);
      toast("Updated ✓");
      renderHome();
    }},
    { label: "Delete", danger: true, fn: async () => {
      snap.extra = (snap.extra || 0) - entry.amount;
      snap.extraLog.splice(idx, 1);
      await dbPut("snapshots", snap);
      toast("Deleted");
      renderHome();
    }},
    { label: "Cancel" }
  ]);
}

/* ── New Month Prompt ── */
async function checkNewMonthPrompt(snap) {
  let promptEl = document.getElementById("new-month-prompt");
  const key = monthKey();
  const existing = await dbGet("months", key);
  if (existing) { if (promptEl) promptEl.remove(); return; }

  // Don't prompt for the month the app was set up in — that's already handled by initial setup
  const setupKey = config.setupDate ? monthKey(config.setupDate) : null;
  if (setupKey && key === setupKey) { if (promptEl) promptEl.remove(); return; }

  if (!promptEl) {
    promptEl = document.createElement("div");
    promptEl.id = "new-month-prompt";
    promptEl.className = "glass-card";
    promptEl.style.cssText = "margin-top:12px;border:1px solid var(--accent);background:rgba(124,108,240,0.08)";
    const anchor = document.getElementById("extra-money-section");
    anchor.parentNode.insertBefore(promptEl, anchor.nextSibling);
  }

  const month = parseInt(key.split("-")[1]);
  const isBonus = (config.bonusMonths||[]).includes(month);
  const expectedSalary = isBonus ? config.bonusIncome : config.income;
  const lastBal = snap ? snap.hsbc : 0;
  const lastCC = snap ? snap.cc : 0;
  const leftoverEstimate = lastBal - lastCC - config.floor;
  const sbiTotal = config.pots.reduce((s,p)=>s+p.monthly,0);

  promptEl.innerHTML = `
    <div style="font-size:.82rem;font-weight:700;color:var(--accent);margin-bottom:6px">
      📋 ${monthLabel(key)} — Ready to set up
    </div>
    <div style="font-size:.78rem;color:var(--text-muted);line-height:1.5;margin-bottom:8px">
      ${isBonus ? '🎁 <strong>Bonus month!</strong> Expected: '+fmt(expectedSalary) : 'Expected salary: '+fmt(expectedSalary)}
      ${lastBal > 0 ? `<br>Last HSBC balance: ${fmt(lastBal)} ${lastCC > 0 ? `(CC: ${fmt(lastCC)})` : ''}` : ''}
      ${leftoverEstimate > config.floor && lastBal > 0 ? `<br>Estimated leftover: ${fmt(leftoverEstimate)}` : ''}
      <br><br><strong>Transfers needed:</strong><br>
      → ${fmt(sbiTotal)} to SBI (pots) on the ${ordinal(config.transferDay)}<br>
      → ${fmt(config.motherAmount)} to family on the ${ordinal(config.transferDay)}<br>
      → ${fmt((config.sips||[]).reduce((s,f)=>s+f.amount,0))} SIP auto-debit on the ${ordinal(config.sipDay)}
    </div>
    <button class="btn-primary btn-sm" id="btn-setup-month" style="width:100%">Set up ${monthLabel(key).split(" ")[0]}</button>`;
  promptEl.querySelector("#btn-setup-month").addEventListener("click", () => {
    showScreen("months");
    document.getElementById("btn-new-month").click();
  });
}

/* ── Snapshot Save ── */
document.getElementById("btn-snapshot").addEventListener("click", async () => {
  const hsbc = parseFloat(document.getElementById("inp-hsbc").value) || 0;
  const cc = parseFloat(document.getElementById("inp-cc").value) || 0;
  if (hsbc === 0 && cc === 0) { toast("Enter at least one value"); return; }
  const prev = await getLatestSnapshot();
  await dbPut("snapshots", {
    date: new Date().toISOString(), hsbc, cc,
    extra: prev ? (prev.extra||0) : 0,
    extraLog: prev ? (prev.extraLog||[]) : []
  });
  toast("Snapshot saved ✓");
  renderHome();
});

/* ── Extra Money ── */
document.getElementById("btn-extra-money").addEventListener("click", () => {
  showModal("Add extra money", `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Bonus, refund, or unexpected income added to HSBC.</p>
    <div class="form-group">
      <label class="form-label">Amount</label>
      <input type="number" class="form-input" id="modal-extra-amt" placeholder="₹">
    </div>
    <div class="form-group">
      <label class="form-label">Note (optional)</label>
      <input type="text" class="form-input" id="modal-extra-note" placeholder="What was it for?">
    </div>`, [
    { label: "Add", primary: true, fn: async () => {
      const amt = parseFloat(document.getElementById("modal-extra-amt").value)||0;
      if (amt <= 0) { toast("Enter an amount"); return; }
      const note = document.getElementById("modal-extra-note").value.trim();
      const snap = await getLatestSnapshot();
      if (!snap) { toast("Save a snapshot with your HSBC balance first"); return; }
      snap.extra = (snap.extra||0) + amt;
      if (!snap.extraLog) snap.extraLog = [];
      snap.extraLog.push({ amount: amt, note, date: new Date().toISOString() });
      await dbPut("snapshots", snap);
      toast(`Added ${fmt(amt)} extra ✓`);
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
  document.getElementById("pot-back").innerHTML = `← <span>${pot.icon} ${pot.name}</span>`;
  const bal = await getPotBalance(potId);
  document.getElementById("pot-bal").textContent = fmt(bal);
  if (pot.target > 0) {
    const pct = Math.min(100, (bal/pot.target)*100);
    document.getElementById("pot-target").textContent = `Target: ${fmt(pot.target)}`;
    document.getElementById("pot-bar").style.width = pct+"%";
    const remaining = pot.target - bal;
    if (remaining > 0 && pot.monthly > 0) {
      const ml = Math.ceil(remaining/pot.monthly);
      const eta = new Date(); eta.setMonth(eta.getMonth()+ml);
      document.getElementById("pot-eta").textContent = `~${ml} months to go (${eta.toLocaleDateString("en-IN",{month:"short",year:"numeric"})})`;
    } else if (remaining <= 0) { document.getElementById("pot-eta").textContent = "🎉 Target reached!"; }
    else { document.getElementById("pot-eta").textContent = ""; }
  } else {
    document.getElementById("pot-target").textContent = "No target set";
    document.getElementById("pot-bar").style.width = "0%";
    document.getElementById("pot-eta").textContent = "";
  }
  const txs = await dbGetAll("potTx", "potId", IDBKeyRange.only(potId));
  txs.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const list = document.getElementById("pot-tx-list");
  list.innerHTML = "";
  if (!txs.length) { list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:24px;font-size:.85rem">No transactions yet</div>'; return; }
  txs.forEach(t => {
    const item = document.createElement("div");
    item.className = "tx-item";
    item.innerHTML = `
      <div class="tx-left"><div class="tx-note">${t.note||(t.type==="in"?"Added":"Withdrawn")}</div><div class="tx-date">${fmtDate(t.date)}</div></div>
      <div class="tx-amount ${t.type==="in"?"credit":"debit"}">${t.type==="in"?"+":"−"}${fmt(t.amount)}</div>`;
    item.addEventListener("click", ()=>editPotTx(t));
    list.appendChild(item);
  });
}
document.getElementById("btn-pot-add").addEventListener("click", ()=>potTxModal("in"));
document.getElementById("btn-pot-take").addEventListener("click", ()=>potTxModal("out"));

function potTxModal(type) {
  const label = type === "in" ? "Add money" : "Take out";
  const currentPot = config.pots.find(p=>p.id===currentPotId);
  const otherPots = config.pots.filter(p=>p.id!==currentPotId);
  const transferHtml = type === "in" ? `
    <div class="form-group"><label class="form-label">Source</label>
      <select class="form-input" id="modal-pot-source">
        <option value="">None (external deposit)</option>
        ${otherPots.map(p=>`<option value="${p.id}">${p.icon} ${p.name}</option>`).join("")}
      </select></div>` : `
    <div class="form-group"><label class="form-label">Send to</label>
      <select class="form-input" id="modal-pot-dest">
        <option value="">None (withdrawal)</option>
        ${otherPots.map(p=>`<option value="${p.id}">${p.icon} ${p.name}</option>`).join("")}
      </select></div>`;
  showModal(label, `
    <div class="form-group"><label class="form-label">Amount</label><input type="number" class="form-input" id="modal-pot-amt" placeholder="₹"></div>
    ${transferHtml}
    <div class="form-group"><label class="form-label">Note</label><input type="text" class="form-input" id="modal-pot-note" placeholder="Optional note"></div>`, [
    { label, primary: true, fn: async () => {
      const amt = parseFloat(document.getElementById("modal-pot-amt").value)||0;
      if (amt<=0) { toast("Enter an amount"); return; }
      const note = document.getElementById("modal-pot-note").value.trim();
      if (type==="in") {
        await dbPut("potTx", { potId:currentPotId, date:new Date().toISOString(), type:"in", amount:amt, note:note||"Added" });
        const srcId = document.getElementById("modal-pot-source")?.value;
        if (srcId) await dbPut("potTx", { potId:srcId, date:new Date().toISOString(), type:"out", amount:amt, note:`Transfer to ${currentPot?.name||"pot"}` });
      } else {
        await dbPut("potTx", { potId:currentPotId, date:new Date().toISOString(), type:"out", amount:amt, note:note||"Withdrawn" });
        const destId = document.getElementById("modal-pot-dest")?.value;
        if (destId) await dbPut("potTx", { potId:destId, date:new Date().toISOString(), type:"in", amount:amt, note:`Transfer from ${currentPot?.name||"pot"}` });
      }
      toast(`${type==="in"?"Added":"Removed"} ${fmt(amt)} ✓`);
      await checkMilestone(currentPotId);
      openPotDetail(currentPotId);
    }},
    { label: "Cancel" }
  ]);
}
function editPotTx(t) {
  showModal("Edit transaction", `
    <div class="form-group"><label class="form-label">Amount</label><input type="number" class="form-input" id="modal-edit-amt" value="${t.amount}"></div>
    <div class="form-group"><label class="form-label">Note</label><input type="text" class="form-input" id="modal-edit-note" value="${t.note||""}"></div>`, [
    { label:"Save", primary:true, fn:async()=>{
      t.amount=parseFloat(document.getElementById("modal-edit-amt").value)||t.amount;
      t.note=document.getElementById("modal-edit-note").value.trim();
      await dbPut("potTx",t); toast("Updated ✓"); openPotDetail(currentPotId);
    }},
    { label:"Delete", danger:true, fn:async()=>{ await dbDelete("potTx",t.id); toast("Deleted"); openPotDetail(currentPotId); }},
    { label:"Cancel" }
  ]);
}
document.getElementById("pot-back").addEventListener("click", ()=>showScreen("money"));

/* ═══════════════════════════════════════
   SCREEN 3: MONTHS
   ═══════════════════════════════════════ */
async function renderMonths() {
  const all = await dbGetAll("months");
  all.sort((a,b)=>b.key.localeCompare(a.key));
  const list = document.getElementById("months-list");
  list.innerHTML = "";
  if (!all.length) { list.innerHTML='<div style="text-align:center;color:var(--text-dim);padding:32px;font-size:.85rem">No months recorded yet.<br>Tap "+ New month" when your salary arrives.</div>'; return; }
  all.forEach(m => {
    const card = document.createElement("div");
    card.className = "month-card";
    const totalAllocated = (m.allocations||[]).reduce((s,a)=>s+a.amount,0);
    const leftover = m.salary - totalAllocated;
    card.innerHTML = `
      <div class="month-header">
        <div><div class="month-name">${monthLabel(m.key)}${m.salary>config.income?' 🎁':''}</div>
          <div style="font-size:.72rem;color:var(--text-dim)">${m.status==="done"?"✓ Closed":"Open"}</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="month-salary">${fmt(m.salary)}</div><div class="month-chevron">▼</div></div>
      </div>
      <div class="month-body">
        ${(m.allocations||[]).map(a=>`<div class="month-row"><span class="month-row-label">${a.label}</span><span class="month-row-value">${fmt(a.amount)}</span></div>`).join("")}
        <div class="month-row" style="border-top:1px solid var(--glass-border);margin-top:4px;padding-top:8px">
          <span class="month-row-label" style="font-weight:600">Spending budget</span><span class="month-row-value">${fmt(leftover)}</span></div>
        ${m.endBalance!=null?`<div class="month-row"><span class="month-row-label">End balance</span><span class="month-row-value">${fmt(m.endBalance)}</span></div>`:""}
        ${m.leftoverNote?`<div style="font-size:.75rem;color:var(--text-dim);margin-top:4px">${m.leftoverNote}</div>`:""}
        <div class="btn-row" style="margin-top:8px">
          <button class="btn-secondary btn-sm" style="flex:1" data-edit-month="${m.key}">Edit</button>
          ${m.status!=="done"?`<button class="btn-primary btn-sm" style="flex:1" data-close-month="${m.key}">Close month</button>`:""}
        </div>
      </div>`;
    card.querySelector(".month-header").addEventListener("click", ()=>card.classList.toggle("expanded"));
    list.appendChild(card);
  });
  list.querySelectorAll("[data-edit-month]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();editMonth(btn.dataset.editMonth)}));
  list.querySelectorAll("[data-close-month]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();closeMonth(btn.dataset.closeMonth)}));
}

/* New Month */
document.getElementById("btn-new-month").addEventListener("click", () => {
  const key = monthKey();
  showModal("New month – enter salary", `
    <div class="form-group"><label class="form-label">Month</label><input type="month" class="form-input" id="modal-month-key" value="${key}"></div>
    <div class="form-group"><label class="form-label">Take-home salary</label><input type="number" class="form-input" id="modal-salary" value="${config.income}" placeholder="₹"></div>
    <div id="modal-bonus-hint" class="hidden" style="font-size:.82rem;color:var(--yellow);margin-bottom:12px">🎁 Bonus month detected! Extra ₹<span id="modal-bonus-extra"></span></div>
    <div id="modal-split-preview"></div>`, [
    { label:"Confirm & save", primary:true, fn:()=>saveNewMonth() },
    { label:"Cancel" }
  ]);
  document.getElementById("modal-salary").addEventListener("input", previewSplit);
  document.getElementById("modal-month-key").addEventListener("input", previewSplit);
  previewSplit();
});

function previewSplit() {
  const salary = parseFloat(document.getElementById("modal-salary").value)||0;
  const key = document.getElementById("modal-month-key").value;
  const month = parseInt(key.split("-")[1]);
  const isBonus = config.bonusMonths.includes(month);
  const extra = salary - config.income;
  const hint = document.getElementById("modal-bonus-hint");
  if (extra>0) { hint.classList.remove("hidden"); document.getElementById("modal-bonus-extra").textContent=fmt(extra).replace("₹",""); }
  else hint.classList.add("hidden");

  const allocs = [];
  config.pots.forEach(p => allocs.push({id:`split-${p.id}`,label:`${p.icon} ${p.name}`,amount:p.monthly,potId:p.id}));
  allocs.push({id:"split-mother",label:"👩 Family transfer",amount:config.motherAmount});
  allocs.push({id:"split-sip",label:"📈 SIP",amount:(config.sips||[]).reduce((s,f)=>s+f.amount,0)});
  if (extra>0) allocs.push({id:"split-bonus",label:"🎁 Bonus extra",amount:extra,potId:"emergency"});

  const preview = document.getElementById("modal-split-preview");
  preview.innerHTML = `
    <div class="section-label" style="margin-top:8px">Split plan <span style="font-size:.65rem;font-weight:400;text-transform:none;letter-spacing:0">(edit any amount)</span></div>
    ${allocs.map(a=>`<div class="month-row" style="align-items:center"><span class="month-row-label">${a.label}</span>
      <input type="number" class="form-input" id="${a.id}" value="${a.amount}" style="width:100px;text-align:right;padding:6px 8px;font-size:.85rem"></div>`).join("")}
    <div class="month-row" style="border-top:1px solid var(--glass-border);margin-top:8px;padding-top:8px">
      <span class="month-row-label" style="font-weight:700;color:var(--text)">💳 Spending budget</span>
      <span class="month-row-value" style="color:var(--green)" id="split-spending">${fmt(0)}</span></div>`;
  const updateSpending = ()=>{
    let total=0; preview.querySelectorAll('input[type="number"]').forEach(inp=>{total+=parseFloat(inp.value)||0});
    const el=document.getElementById("split-spending");
    if(el){el.textContent=fmt(salary-total);el.style.color=salary-total<0?"var(--red)":"var(--green)"}
  };
  updateSpending();
  preview.querySelectorAll('input[type="number"]').forEach(inp=>inp.addEventListener("input",updateSpending));
}

async function saveNewMonth() {
  const key = document.getElementById("modal-month-key").value;
  const salary = parseFloat(document.getElementById("modal-salary").value)||config.income;
  const allocations = []; let totalAllocated = 0;
  config.pots.forEach(p => {
    const amt = parseFloat(document.getElementById(`split-${p.id}`)?.value)||0;
    allocations.push({label:`${p.icon} ${p.name}`,potId:p.id,amount:amt});
    totalAllocated += amt;
  });
  const motherAmt = parseFloat(document.getElementById("split-mother")?.value)||0;
  allocations.push({label:"👩 Family transfer",amount:motherAmt}); totalAllocated+=motherAmt;
  const sipAmt = parseFloat(document.getElementById("split-sip")?.value)||0;
  allocations.push({label:"📈 SIP",amount:sipAmt}); totalAllocated+=sipAmt;
  const bonusEl = document.getElementById("split-bonus");
  if (bonusEl) { const b=parseFloat(bonusEl.value)||0; allocations.push({label:"🎁 Bonus extra",potId:"emergency",amount:b}); totalAllocated+=b; }

  for (const alloc of allocations) {
    if (alloc.potId && alloc.amount > 0) {
      await dbPut("potTx", { potId:alloc.potId, date:new Date().toISOString(), type:"in", amount:alloc.amount, note:`${monthLabel(key)} salary` });
    }
  }
  await dbPut("months", {key,salary,allocations,spending:salary-totalAllocated,status:"open",createdAt:new Date().toISOString()});
  toast("Month saved ✓"); renderMonths();
}

function editMonth(key) {
  showModal("Edit month", `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Edit the salary for this month.</p>
    <div class="form-group"><label class="form-label">Take-home salary</label><input type="number" class="form-input" id="modal-edit-salary" placeholder="₹"></div>`, [
    { label:"Save", primary:true, fn:async()=>{
      const month=await dbGet("months",key); if(!month) return;
      const ns=parseFloat(document.getElementById("modal-edit-salary").value);
      if(ns&&ns!==month.salary){month.salary=ns;await dbPut("months",month);toast("Updated ✓");renderMonths();}
    }},{ label:"Cancel" }
  ]);
}

function closeMonth(key) {
  showModal("Close month", `
    <p style="font-size:.85rem;margin-bottom:12px">Enter your final HSBC balance to calculate leftover.</p>
    <div class="form-group"><label class="form-label">End HSBC balance</label><input type="number" class="form-input" id="modal-end-balance" placeholder="₹"></div>
    <div class="form-group"><label class="form-label">Leftover goes to</label>
      <select class="form-input" id="modal-leftover-dest">
        <option value="next">Roll into next month</option>
        ${config.pots.map(p=>`<option value="${p.id}">${p.icon} ${p.name}</option>`).join("")}
        <option value="leave">Leave in HSBC</option>
      </select></div>`, [
    { label:"Close month", primary:true, fn:async()=>{
      const month=await dbGet("months",key); if(!month) return;
      const endBal=parseFloat(document.getElementById("modal-end-balance").value)||0;
      const dest=document.getElementById("modal-leftover-dest").value;
      month.endBalance=endBal; month.status="done";
      const leftover=endBal-config.floor;
      if(leftover>0&&dest!=="next"&&dest!=="leave"){
        await dbPut("potTx",{potId:dest,date:new Date().toISOString(),type:"in",amount:leftover,note:`${monthLabel(key)} leftover`});
        month.leftoverNote=`₹${leftover} sent to ${config.pots.find(p=>p.id===dest)?.name||dest}`;
      } else if(dest==="next") month.leftoverNote=`₹${leftover} rolled into next month`;
      await dbPut("months",month); toast("Month closed ✓"); renderMonths();
    }},{ label:"Cancel" }
  ]);
}

/* ═══════════════════════════════════════
   SCREEN 3: MONEY (pots + loans + SIP + trends)
   ═══════════════════════════════════════ */
async function renderMoney() {
  const potBals = await getAllPotBalances();
  const totalPots = Object.values(potBals).reduce((s,v)=>s+v,0);
  const sipInfo = getSIPSummary();
  const netWorth = totalPots + sipInfo.totalInvested;
  const months = await dbGetAll("months");
  months.sort((a,b)=>a.key.localeCompare(b.key));

  // Net worth
  document.getElementById("networth-amount").textContent = fmt(netWorth);
  document.getElementById("networth-breakdown").innerHTML = `
    <div class="networth-item">Pots<strong>${fmt(totalPots)}</strong></div>
    <div class="networth-item">SIP invested<strong>${fmt(sipInfo.totalInvested)}</strong></div>`;

  // Pots grid
  const grid = document.getElementById("pot-grid");
  grid.innerHTML = "";
  for (const pot of config.pots) {
    const bal = potBals[pot.id]||0;
    const pctPot = pot.target > 0 ? Math.min(100,(bal/pot.target)*100) : 0;
    const card = document.createElement("div");
    card.className = "pot-card";
    card.innerHTML = `
      <div class="pot-name">${pot.icon} ${pot.name}</div>
      <div class="pot-balance">${fmt(bal)}</div>
      ${pot.target>0?`<div class="pot-mini-bar"><div class="pot-mini-fill" style="width:${pctPot}%"></div></div><div class="pot-target">Target: ${fmt(pot.target)}</div>`:""}`;
    card.addEventListener("click", ()=>openPotDetail(pot.id));
    grid.appendChild(card);
  }

  // Loans
  await renderLoans();

  // SIP card
  renderSIPCard(sipInfo);

  // Stats
  const statsEl = document.getElementById("trend-stats");
  const monthCount = months.length||1;
  const avgSavings = Math.round(totalPots/monthCount);
  const savingsRate = months.length > 0
    ? Math.round((months.reduce((s,m)=>{return s+(m.allocations||[]).filter(a=>a.potId).reduce((ss,a)=>ss+a.amount,0)},0)/months.reduce((s,m)=>s+m.salary,0))*100) : 0;
  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${fmt(netWorth)}</div><div class="stat-label">Net worth</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(sipInfo.totalInvested)}</div><div class="stat-label">SIP invested</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(avgSavings)}</div><div class="stat-label">Avg monthly saved</div></div>
    <div class="stat-card"><div class="stat-value">${savingsRate}%</div><div class="stat-label">Savings rate</div></div>`;

  // Charts
  renderLineChart("chart-networth", months, potBals);
  renderSpendingChart("chart-spending", months);
}

function renderSIPCard(sipInfo) {
  const card = document.getElementById("sip-card");
  const sips = config.sips || [];

  if (!sips.length) {
    card.innerHTML = `<div style="padding:16px;text-align:center">
      <div style="color:var(--text-dim);font-size:.85rem;margin-bottom:10px">No SIPs added yet</div>
      <button class="btn-secondary btn-sm" id="sip-add-empty" style="width:100%">+ Add SIP fund</button>
    </div>`;
    setTimeout(() => {
      document.getElementById("sip-add-empty")?.addEventListener("click", () => showSIPModal());
    }, 50);
    return;
  }

  let html = '<div style="padding:12px">';
  sips.forEach((s, idx) => {
    const invested = s.amount * sipInfo.months;
    html += `
      <div class="sip-fund-row" data-sip-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;${idx>0?'border-top:1px solid var(--glass-border)':''}cursor:pointer">
        <div>
          <div style="font-size:.85rem;font-weight:600">📈 ${s.name}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${fmt(s.amount)}/month · Auto-debit ${ordinal(config.sipDay)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1rem;font-weight:700">${fmt(invested)}</div>
          <div style="font-size:.65rem;color:var(--text-dim)">${sipInfo.months} month${sipInfo.months!==1?'s':''} invested</div>
        </div>
      </div>`;
  });

  html += `<div style="text-align:center;padding-top:10px;border-top:1px solid var(--glass-border);margin-top:4px">
    <div style="font-size:.72rem;color:var(--accent2)">Total SIP invested</div>
    <div style="font-size:1.3rem;font-weight:800">${fmt(sipInfo.totalInvested)}</div>
    <div style="font-size:.68rem;color:var(--text-dim);margin-top:2px">${fmt(sipInfo.totalMonthly)}/month total</div>
  </div>`;

  html += `<button class="btn-secondary btn-sm" id="sip-add-btn" style="width:100%;margin-top:10px">+ Add SIP fund</button>`;
  html += '</div>';
  card.innerHTML = html;

  // Wire tap-to-edit
  setTimeout(() => {
    card.querySelectorAll(".sip-fund-row").forEach(row => {
      row.addEventListener("click", () => {
        const idx = parseInt(row.dataset.sipIdx);
        showSIPEditModal(idx);
      });
    });
    document.getElementById("sip-add-btn")?.addEventListener("click", () => showSIPModal());
  }, 50);
}

function showSIPModal(existingIdx) {
  const isEdit = existingIdx != null;
  const sip = isEdit ? config.sips[existingIdx] : { name: "", amount: 0 };
  const title = isEdit ? "Edit SIP fund" : "Add SIP fund";

  showModal(title, `
    <div class="form-group"><label class="form-label">Fund name</label>
      <input type="text" class="form-input" id="modal-sip-name" value="${sip.name}" placeholder="Fund name"></div>
    <div class="form-group"><label class="form-label">Monthly amount (₹)</label>
      <input type="number" class="form-input" id="modal-sip-amt" value="${sip.amount||''}" placeholder="₹ per month"></div>`, [
    { label: isEdit ? "Save" : "Add", primary: true, fn: async () => {
      const name = document.getElementById("modal-sip-name").value.trim();
      const amount = parseFloat(document.getElementById("modal-sip-amt").value) || 0;
      if (!name) { toast("Enter a fund name"); return; }
      if (amount <= 0) { toast("Enter an amount"); return; }
      if (isEdit) {
        config.sips[existingIdx] = { ...config.sips[existingIdx], name, amount };
      } else {
        config.sips.push({ id: "sip-" + Date.now(), name, amount });
      }
      await saveConfig(); toast(isEdit ? "Updated ✓" : "Added ✓"); renderMoney();
    }},
    ...(isEdit ? [{ label: "Delete", danger: true, fn: async () => {
      config.sips.splice(existingIdx, 1);
      await saveConfig(); toast("Deleted"); renderMoney();
    }}] : []),
    { label: "Cancel" }
  ]);
}

function showSIPEditModal(idx) { showSIPModal(idx); }

/* ═══════════════════════════════════════
   LOANS FEATURE
   ═══════════════════════════════════════ */
document.getElementById("btn-new-loan").addEventListener("click", ()=>showNewLoanModal());

function showNewLoanModal() {
  const potsHtml = config.pots.map(p=>`<option value="${p.id}">${p.icon} ${p.name}</option>`).join("");
  const currentMonth = monthKey();
  showModal("Take a loan from a pot", `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">
      Borrow from a pot and repay in installments. The amount is deducted now and added back as you repay.
    </p>
    <div class="form-group"><label class="form-label">From pot</label>
      <select class="form-input" id="loan-pot">${potsHtml}</select></div>
    <div class="form-group"><label class="form-label">Amount (₹)</label>
      <input type="number" class="form-input" id="loan-amount" placeholder="₹"></div>
    <div class="form-group"><label class="form-label">Repay over how many months?</label>
      <input type="number" class="form-input" id="loan-months" value="2" min="1" max="24"></div>
    <div class="form-group"><label class="form-label">Start repaying from</label>
      <input type="month" class="form-input" id="loan-start" value="${currentMonth}"></div>
    <div class="form-group"><label class="form-label">Note (optional)</label>
      <input type="text" class="form-input" id="loan-note" placeholder="What's it for?"></div>
    <div id="loan-preview" style="margin-top:12px"></div>`, [
    { label:"Take loan", primary:true, fn:()=>createLoan() },
    { label:"Cancel" }
  ]);

  // Live preview
  const updatePreview = () => {
    const amt = parseFloat(document.getElementById("loan-amount").value)||0;
    const months = parseInt(document.getElementById("loan-months").value)||1;
    const emi = Math.ceil(amt/months);
    const startKey = document.getElementById("loan-start").value;
    const preview = document.getElementById("loan-preview");
    if (amt <= 0) { preview.innerHTML = ""; return; }
    let html = `<div style="font-size:.78rem;color:var(--text-muted);line-height:1.6">
      <strong>Repayment plan:</strong> ${fmt(emi)}/month for ${months} months`;
    let mk = startKey;
    for (let i=0; i<months; i++) {
      const thisAmt = i === months-1 ? amt - emi*(months-1) : emi;
      html += `<br>→ ${monthLabel(mk)}: ${fmt(thisAmt)}`;
      const [y,m] = mk.split("-").map(Number);
      mk = `${y+Math.floor(m/12)}-${String((m%12)+1).padStart(2,"0")}`;
    }
    html += "</div>";
    preview.innerHTML = html;
  };
  setTimeout(()=>{
    document.getElementById("loan-amount")?.addEventListener("input", updatePreview);
    document.getElementById("loan-months")?.addEventListener("input", updatePreview);
    document.getElementById("loan-start")?.addEventListener("input", updatePreview);
  }, 50);
}

async function createLoan() {
  const potId = document.getElementById("loan-pot").value;
  const amount = parseFloat(document.getElementById("loan-amount").value)||0;
  const numMonths = parseInt(document.getElementById("loan-months").value)||1;
  const startKey = document.getElementById("loan-start").value;
  const note = document.getElementById("loan-note").value.trim();
  if (amount<=0) { toast("Enter an amount"); return; }

  const pot = config.pots.find(p=>p.id===potId);
  const emi = Math.ceil(amount/numMonths);

  // Build installment schedule
  const installments = [];
  let mk = startKey;
  for (let i=0; i<numMonths; i++) {
    const thisAmt = i===numMonths-1 ? amount - emi*(numMonths-1) : emi;
    installments.push({ monthKey: mk, amount: thisAmt, paid: false, paidDate: null });
    const [y,m] = mk.split("-").map(Number);
    mk = `${y+Math.floor(m/12)}-${String((m%12)+1).padStart(2,"0")}`;
  }

  // Deduct from pot
  await dbPut("potTx", {
    potId, date: new Date().toISOString(), type: "out", amount,
    note: `Loan: ${note || "self-loan"}`
  });

  // Save loan
  await dbPut("loans", {
    potId, amount, note: note || "Self-loan",
    numMonths, startKey, installments,
    createdAt: new Date().toISOString(),
    status: "active" // active | paid
  });

  toast(`Loan of ${fmt(amount)} created ✓`);
  renderMoney();
}

async function renderLoans() {
  const loans = await dbGetAll("loans");
  loans.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const list = document.getElementById("loans-list");
  list.innerHTML = "";
  if (!loans.length) { list.innerHTML='<div style="text-align:center;color:var(--text-dim);padding:16px;font-size:.82rem">No loans yet</div>'; return; }
  loans.forEach(loan => {
    const pot = config.pots.find(p=>p.id===loan.potId);
    const paid = loan.installments.filter(i=>i.paid).reduce((s,i)=>s+i.amount,0);
    const remaining = loan.amount - paid;
    const allPaid = loan.status === "paid" || remaining <= 0;
    const card = document.createElement("div");
    card.className = "loan-card" + (allPaid?" paid":"");
    card.innerHTML = `
      <div class="loan-title">${loan.note} ${allPaid?'✅':''}</div>
      <div class="loan-meta">From ${pot?pot.icon+" "+pot.name:"pot"} · ${loan.numMonths} months</div>
      <div class="loan-amount">${allPaid ? "Fully repaid" : `${fmt(remaining)} remaining of ${fmt(loan.amount)}`}</div>
      <div class="progress-bar" style="margin:6px 0 0"><div class="progress-fill green" style="width:${Math.round(paid/loan.amount*100)}%"></div></div>`;
    card.addEventListener("click", ()=>openLoanDetail(loan.id));
    list.appendChild(card);
  });
}

async function openLoanDetail(loanId) {
  currentLoanId = loanId;
  const loan = await dbGet("loans", loanId);
  if (!loan) return;
  showScreen("loan");
  const pot = config.pots.find(p=>p.id===loan.potId);
  document.getElementById("loan-detail-title").textContent = `${loan.note}`;
  const paid = loan.installments.filter(i=>i.paid).reduce((s,i)=>s+i.amount,0);
  const remaining = loan.amount - paid;
  document.getElementById("loan-detail-remaining").textContent = fmt(remaining) + " remaining";
  document.getElementById("loan-detail-info").textContent = `${fmt(loan.amount)} from ${pot?pot.icon+" "+pot.name:"pot"} · ${loan.numMonths} month${loan.numMonths>1?"s":""}`;
  const pct = Math.min(100, Math.round(paid/loan.amount*100));
  document.getElementById("loan-bar").style.width = pct+"%";
  document.getElementById("loan-eta").textContent = remaining<=0 ? "🎉 Fully repaid!" : `${fmt(paid)} repaid (${pct}%)`;

  const list = document.getElementById("loan-installments-list");
  list.innerHTML = "";
  const currentMK = monthKey();

  loan.installments.forEach((inst, idx) => {
    const isOverdue = !inst.paid && inst.monthKey < currentMK;
    const isDue = !inst.paid && inst.monthKey === currentMK;
    const statusClass = inst.paid ? "paid" : (isOverdue ? "overdue" : "pending");
    const statusIcon = inst.paid ? "✅" : (isOverdue ? "⚠️" : "⏳");

    const row = document.createElement("div");
    row.className = "installment-row";
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div class="installment-status ${statusClass}">${statusIcon}</div>
        <div>
          <div style="font-size:.85rem;font-weight:600">${monthLabel(inst.monthKey)}</div>
          <div style="font-size:.7rem;color:var(--text-dim)">
            ${inst.paid ? `Paid on ${fmtDate(inst.paidDate)}` : (isOverdue ? "Overdue!" : (isDue ? "Due by the 5th" : "Upcoming"))}
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:.95rem;font-weight:700;color:${inst.paid?'var(--green)':'var(--text)'}">${fmt(inst.amount)}</span>
        ${!inst.paid ? `<button class="btn-primary btn-sm" data-pay-idx="${idx}" style="padding:4px 10px;font-size:.7rem;min-height:auto">Pay</button>` : ''}
      </div>`;
    list.appendChild(row);
  });

  // Wire pay buttons
  list.querySelectorAll("[data-pay-idx]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.payIdx);
      const inst = loan.installments[idx];
      if (confirm(`Mark ${fmt(inst.amount)} for ${monthLabel(inst.monthKey)} as paid?\n\nThis adds ${fmt(inst.amount)} back to ${pot?pot.name:"the pot"}.`)) {
        inst.paid = true;
        inst.paidDate = new Date().toISOString();
        // Add money back to pot
        await dbPut("potTx", {
          potId: loan.potId, date: new Date().toISOString(), type: "in",
          amount: inst.amount, note: `Loan repayment: ${loan.note}`
        });
        // Check if all paid
        if (loan.installments.every(i=>i.paid)) loan.status = "paid";
        await dbPut("loans", loan);
        toast(`Repaid ${fmt(inst.amount)} ✓`);
        openLoanDetail(loanId);
      }
    });
  });
}
document.getElementById("loan-back").addEventListener("click", ()=>showScreen("money"));

/* ── Loan Reminders on Home ── */
async function renderLoanReminders() {
  const container = document.getElementById("loan-reminders");
  container.innerHTML = "";
  const loans = await dbGetAll("loans");
  const currentMK = monthKey();
  const today = new Date().getDate();

  for (const loan of loans) {
    if (loan.status === "paid") continue;
    for (const inst of loan.installments) {
      if (inst.paid) continue;
      const isOverdue = inst.monthKey < currentMK;
      const isDue = inst.monthKey === currentMK;
      if (!isOverdue && !isDue) continue;

      const pot = config.pots.find(p=>p.id===loan.potId);
      const el = document.createElement("div");
      el.className = "loan-reminder";
      el.innerHTML = `
        <div class="reminder-title">${isOverdue?"⚠️ Overdue":"⏰ Due this month"}: ${loan.note}</div>
        <div class="reminder-detail">
          ${fmt(inst.amount)} → ${pot?pot.icon+" "+pot.name:"pot"}
          ${isDue && today <= 5 ? ` · <strong>Pay by the 5th</strong>` : ''}
          ${isOverdue ? ` · Was due in ${monthLabel(inst.monthKey)}` : ''}
        </div>
        <button class="btn-primary btn-sm" style="margin-top:8px;width:100%" data-reminder-loan="${loan.id}" data-reminder-month="${inst.monthKey}">Mark as paid</button>`;
      container.appendChild(el);

      el.querySelector("button").addEventListener("click", async () => {
        inst.paid = true;
        inst.paidDate = new Date().toISOString();
        await dbPut("potTx", {
          potId: loan.potId, date: new Date().toISOString(), type: "in",
          amount: inst.amount, note: `Loan repayment: ${loan.note}`
        });
        if (loan.installments.every(i=>i.paid)) loan.status = "paid";
        await dbPut("loans", loan);
        toast(`Repaid ${fmt(inst.amount)} ✓`);
        renderHome();
      });
      break; // Only show first unpaid installment per loan
    }
  }
}

/* ═══ CHARTS ═══ */
function renderLineChart(canvasId, months, potBals) {
  const canvas = document.getElementById(canvasId); if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth; const h = 200;
  canvas.width=w*2; canvas.height=h*2; canvas.style.width=w+"px"; canvas.style.height=h+"px";
  ctx.scale(2,2); ctx.clearRect(0,0,w,h);
  if (months.length<2) { ctx.fillStyle="#7b7bab"; ctx.font="13px -apple-system,sans-serif"; ctx.textAlign="center"; ctx.fillText("Need 2+ months of data",w/2,h/2); return; }
  const points = months.map(m=>(m.allocations||[]).filter(a=>a.potId).reduce((s,a)=>s+a.amount,0));
  const cumulative = []; let running=0;
  points.forEach(p=>{running+=p;cumulative.push(running)});
  drawLine(ctx,w,h,cumulative,"#7c6cf0",months.map(m=>monthLabel(m.key).slice(0,3)));
}
function renderSpendingChart(canvasId, months) {
  const canvas = document.getElementById(canvasId); if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth; const h = 200;
  canvas.width=w*2; canvas.height=h*2; canvas.style.width=w+"px"; canvas.style.height=h+"px";
  ctx.scale(2,2); ctx.clearRect(0,0,w,h);
  const recent = months.slice(-6);
  if (recent.length<1) { ctx.fillStyle="#7b7bab"; ctx.font="13px -apple-system,sans-serif"; ctx.textAlign="center"; ctx.fillText("No data yet",w/2,h/2); return; }
  const spending = recent.map(m=>m.salary-(m.allocations||[]).reduce((s,a)=>s+a.amount,0));
  drawBars(ctx,w,h,spending,"#34d399",recent.map(m=>monthLabel(m.key).slice(0,3)));
}

function drawLine(ctx,w,h,data,color,labels) {
  const pad={top:10,right:10,bottom:30,left:50};
  const plotW=w-pad.left-pad.right, plotH=h-pad.top-pad.bottom;
  const maxVal=Math.max(...data,1);
  const xStep=data.length>1?plotW/(data.length-1):plotW;
  ctx.strokeStyle="rgba(255,255,255,0.05)"; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.top+(plotH/4)*i;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke()}
  ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;
  data.forEach((v,i)=>{const x=pad.left+i*xStep;const y=pad.top+plotH-(v/maxVal)*plotH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke();
  ctx.lineTo(pad.left+(data.length-1)*xStep,pad.top+plotH);ctx.lineTo(pad.left,pad.top+plotH);ctx.closePath();
  ctx.fillStyle=color.replace(")",",0.1)").replace("rgb","rgba");ctx.fill();
  ctx.fillStyle="#4a4a6a";ctx.font="10px -apple-system,sans-serif";ctx.textAlign="center";
  if(labels)labels.forEach((l,i)=>ctx.fillText(l,pad.left+i*xStep,h-8));
  ctx.textAlign="right";for(let i=0;i<=4;i++){ctx.fillText(fmt(Math.round((maxVal/4)*(4-i))).replace("₹",""),pad.left-6,pad.top+(plotH/4)*i+4)}
}
function drawBars(ctx,w,h,data,color,labels) {
  const pad={top:10,right:10,bottom:30,left:50};
  const plotW=w-pad.left-pad.right, plotH=h-pad.top-pad.bottom;
  const maxVal=Math.max(...data,1);
  const barW=Math.min(40,(plotW/data.length)*0.6);const gap=plotW/data.length;
  data.forEach((v,i)=>{const barH=(v/maxVal)*plotH;const x=pad.left+i*gap+(gap-barW)/2;const y=pad.top+plotH-barH;
    ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,barW,barH,4);ctx.fill()});
  ctx.fillStyle="#4a4a6a";ctx.font="10px -apple-system,sans-serif";ctx.textAlign="center";
  if(labels)labels.forEach((l,i)=>ctx.fillText(l,pad.left+i*gap+gap/2,h-8));
  ctx.textAlign="right";for(let i=0;i<=4;i++){ctx.fillText(fmt(Math.round((maxVal/4)*(4-i))).replace("₹",""),pad.left-6,pad.top+(plotH/4)*i+4)}
}

/* ═══ MORE SCREEN ═══ */
document.getElementById("btn-afford").addEventListener("click", ()=>{
  showModal("Can I afford this?", `
    <input type="number" class="afford-input" id="afford-amount" placeholder="₹ amount">
    <div class="afford-result" id="afford-result"></div>`, [
    {label:"Check",primary:true,fn:checkAfford},{label:"Close"}
  ]);
});
async function checkAfford() {
  const amount=parseFloat(document.getElementById("afford-amount").value)||0;
  if(amount<=0) return;
  const snap=await getLatestSnapshot();
  const safeToSpend=(snap?snap.hsbc:0)-(snap?snap.cc:0)-config.floor;
  const resultEl=document.getElementById("afford-result");
  if(amount<=safeToSpend*0.3) resultEl.innerHTML=`<div class="afford-verdict" style="color:var(--green)">✅ Easily!</div><div class="afford-detail">That's only ${Math.round(amount/safeToSpend*100)}% of your safe-to-spend. You'll still have ${fmt(safeToSpend-amount)} left.</div>`;
  else if(amount<=safeToSpend) resultEl.innerHTML=`<div class="afford-verdict" style="color:var(--yellow)">⚠️ Yes, but it's a big chunk</div><div class="afford-detail">That's ${Math.round(amount/safeToSpend*100)}% of safe-to-spend. Daily budget drops to ~${fmt(Math.round((safeToSpend-amount)/daysLeftInMonth()))}/day.</div>`;
  else {
    const potBals=await getAllPotBalances();
    const bestPot=config.pots.filter(p=>(potBals[p.id]||0)>=amount&&p.id!=="emergency").sort((a,b)=>(potBals[a.id]||0)-(potBals[b.id]||0))[0];
    if(bestPot){const delay=bestPot.target>0?Math.ceil(amount/bestPot.monthly)+" months delay on target":"no target impact";
      resultEl.innerHTML=`<div class="afford-verdict" style="color:var(--orange)">💡 You'd need to dip into a pot</div><div class="afford-detail">Not enough in spending budget (${fmt(safeToSpend)}).<br>Closest fit: <strong>${bestPot.icon} ${bestPot.name}</strong> (${fmt(potBals[bestPot.id])}).<br>Impact: ${delay}.</div>`;}
    else resultEl.innerHTML=`<div class="afford-verdict" style="color:var(--red)">❌ Not right now</div><div class="afford-detail">Spending budget: ${fmt(safeToSpend)}. No single pot covers this either. Consider saving up over ${Math.ceil(amount/config.spendingBudget)} months.</div>`;
  }
}

/* Milestones */
document.getElementById("btn-milestones").addEventListener("click", async()=>{
  const milestones=await dbGetAll("milestones");
  milestones.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const body=milestones.length>0
    ?milestones.map(m=>`<div class="month-row"><span class="month-row-label">${m.emoji} ${m.text}</span><span class="month-row-value" style="font-size:.7rem;color:var(--text-dim)">${fmtDate(m.date)}</span></div>`).join("")
    :'<div style="text-align:center;color:var(--text-dim);padding:16px">No milestones yet — they\'ll appear as your pots grow! 🌱</div>';
  showModal("🎉 Milestones",body,[{label:"Close"}]);
});

async function checkMilestone(potId) {
  const pot=config.pots.find(p=>p.id===potId); if(!pot) return;
  const bal=await getPotBalance(potId);
  const thresholds=[10000,25000,50000,75000,100000,150000,200000,250000,500000,1000000];
  for(const t of thresholds){
    if(bal>=t && bal-(await getLastTxAmount(potId))<t){
      const existing=await dbGetAll("milestones");
      if(!existing.find(m=>m.potId===potId&&m.threshold===t)){
        await dbPut("milestones",{potId,threshold:t,date:new Date().toISOString(),emoji:"🎉",text:`${pot.name} crossed ${fmt(t)}!`});
        showCelebration(`${pot.icon} ${pot.name}`,`Crossed ${fmt(t)}!`);
      }
      break;
    }
  }
}
async function getLastTxAmount(potId){const txs=await dbGetAll("potTx","potId",IDBKeyRange.only(potId));if(!txs.length)return 0;txs.sort((a,b)=>new Date(b.date)-new Date(a.date));return txs[0].type==="in"?txs[0].amount:-txs[0].amount}
function showCelebration(title,sub){
  const el=document.createElement("div");el.className="celebration";
  el.innerHTML=`<div class="celebration-emoji">🎉</div><div class="celebration-text">${title}</div><div class="celebration-sub">${sub}</div><button class="btn-primary" style="max-width:200px;margin-top:20px" id="celebration-close">Awesome!</button>`;
  document.body.appendChild(el);el.querySelector("#celebration-close").addEventListener("click",()=>el.remove());
  setTimeout(()=>{if(el.parentElement)el.remove()},5000);
}

/* Settings */
document.getElementById("btn-settings").addEventListener("click", ()=>{
  showModal("Settings", `
    <div class="form-group"><label class="form-label">Monthly income (₹)</label><input type="number" class="form-input" id="set-income" value="${config.income}"></div>
    <div class="form-group"><label class="form-label">Bonus income (₹)</label><input type="number" class="form-input" id="set-bonus" value="${config.bonusIncome}"></div>
    <div class="form-group"><label class="form-label">Spending budget (₹)</label><input type="number" class="form-input" id="set-budget" value="${config.spendingBudget}"></div>
    <div class="form-group"><label class="form-label">Floor (₹)</label><input type="number" class="form-input" id="set-floor" value="${config.floor}"></div>
    <div class="form-group"><label class="form-label">Family transfer (₹/month)</label><input type="number" class="form-input" id="set-mother" value="${config.motherAmount}"></div>
    <div class="section-label">Pots <span style="font-size:.65rem;font-weight:400;text-transform:none;letter-spacing:0">(changes apply to future months only)</span></div>
    <div id="set-pots-list">
      ${config.pots.map((p,i)=>`
        <div class="glass-card set-pot-row" data-pot-id="${p.id}" style="margin-bottom:8px;padding:10px">
          <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
            <select class="form-input set-pot-icon" style="width:50px;text-align:center;font-size:1.1rem;padding:4px">
              ${["🛡️","🎯","👨‍👩‍👦","🏠","✈️","🎓","💰","🚗","💻","🎮"].map(ic=>`<option ${ic===p.icon?'selected':''}>${ic}</option>`).join("")}
            </select>
            <input type="text" class="form-input set-pot-name" value="${p.name}" style="flex:1">
            <button type="button" class="btn-danger btn-sm set-pot-delete" style="padding:4px 8px;font-size:.7rem">✕</button>
          </div>
          <div style="display:flex;gap:8px">
            <div style="flex:1"><label class="form-label" style="font-size:.65rem">Monthly ₹</label><input type="number" class="form-input set-pot-monthly" value="${p.monthly}"></div>
            <div style="flex:1"><label class="form-label" style="font-size:.65rem">Target ₹</label><input type="number" class="form-input set-pot-target" value="${p.target||0}"></div>
          </div>
        </div>`).join("")}
    </div>
    <button type="button" class="btn-secondary btn-sm" id="set-add-pot" style="width:100%;margin-top:4px">+ Add new pot</button>
    <div class="section-label" style="margin-top:16px">Bonus months</div>
    <div id="set-bonus-months" style="display:flex;flex-wrap:wrap;gap:6px">
      ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>{
        const active=(config.bonusMonths||[]).includes(i+1);
        return `<button type="button" class="btn-sm ${active?'btn-primary':'btn-secondary'}" data-month="${i+1}" style="width:calc(25% - 5px);font-size:.72rem">${m}</button>`;}).join("")}
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--glass-border)">
      <div class="section-label">Danger zone</div>
      <button type="button" class="btn-secondary btn-sm" id="set-rerun-setup" style="width:100%;margin-bottom:8px">🔄 Re-run setup wizard</button>
      <button type="button" class="btn-danger btn-sm" id="set-reset-all" style="width:100%">🗑️ Reset all data & start fresh</button>
    </div>`, [
    { label:"Save", primary:true, fn:async()=>{
      config.income=parseFloat(document.getElementById("set-income").value)||config.income;
      config.bonusIncome=parseFloat(document.getElementById("set-bonus").value)||config.bonusIncome;
      config.spendingBudget=parseFloat(document.getElementById("set-budget").value)||config.spendingBudget;
      config.floor=parseFloat(document.getElementById("set-floor").value)||config.floor;
      config.motherAmount=parseFloat(document.getElementById("set-mother").value)||config.motherAmount;
      const updatedPots=[];
      document.querySelectorAll(".set-pot-row").forEach(row=>{
        const id=row.dataset.potId;const name=row.querySelector(".set-pot-name")?.value.trim();if(!name)return;
        const icon=row.querySelector(".set-pot-icon")?.value||"💰";
        const monthly=parseFloat(row.querySelector(".set-pot-monthly")?.value)||0;
        const target=parseFloat(row.querySelector(".set-pot-target")?.value)||0;
        updatedPots.push({id,name,icon,monthly,target});
      });
      config.pots=updatedPots;
      const selectedMonths=[];
      document.querySelectorAll("#set-bonus-months button.btn-primary").forEach(b=>selectedMonths.push(parseInt(b.dataset.month)));
      config.bonusMonths=selectedMonths;
      await saveConfig();toast("Settings saved ✓");
      if(activeScreen==="home")renderHome(); if(activeScreen==="money")renderMoney();
    }},{ label:"Cancel" }
  ]);
  setTimeout(()=>{
    document.querySelectorAll("#set-bonus-months button").forEach(btn=>btn.addEventListener("click",()=>{btn.classList.toggle("btn-primary");btn.classList.toggle("btn-secondary")}));
    document.querySelectorAll(".set-pot-delete").forEach(btn=>btn.addEventListener("click",()=>{
      if(document.querySelectorAll(".set-pot-row").length<=1){toast("Need at least one pot");return}btn.closest(".set-pot-row").remove();
    }));
    document.getElementById("set-add-pot")?.addEventListener("click",()=>{
      const list=document.getElementById("set-pots-list");const newId="pot-"+Date.now();const div=document.createElement("div");
      div.className="glass-card set-pot-row";div.dataset.potId=newId;div.style.cssText="margin-bottom:8px;padding:10px";
      div.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
        <select class="form-input set-pot-icon" style="width:50px;text-align:center;font-size:1.1rem;padding:4px">${["🛡️","🎯","👨‍👩‍👦","🏠","✈️","🎓","💰","🚗","💻","🎮"].map(ic=>`<option>${ic}</option>`).join("")}</select>
        <input type="text" class="form-input set-pot-name" placeholder="Pot name" style="flex:1">
        <button type="button" class="btn-danger btn-sm set-pot-delete" style="padding:4px 8px;font-size:.7rem">✕</button></div>
        <div style="display:flex;gap:8px"><div style="flex:1"><label class="form-label" style="font-size:.65rem">Monthly ₹</label><input type="number" class="form-input set-pot-monthly" value="0"></div>
        <div style="flex:1"><label class="form-label" style="font-size:.65rem">Target ₹</label><input type="number" class="form-input set-pot-target" value="0"></div></div>`;
      list.appendChild(div);div.querySelector(".set-pot-delete").addEventListener("click",()=>{if(document.querySelectorAll(".set-pot-row").length<=1){toast("Need at least one pot");return}div.remove()});
    });
    document.getElementById("set-rerun-setup")?.addEventListener("click",()=>{closeModal();config.setupDone=false;saveConfig().then(()=>showSetupWizard())});
    document.getElementById("set-reset-all")?.addEventListener("click",()=>{
      const answer=prompt("Type RESET to confirm deleting ALL data:");
      if(answer&&answer.trim().toUpperCase()==="RESET"){closeModal();indexedDB.deleteDatabase(DB_NAME);location.reload();}
      else toast("Reset cancelled");
    });
  },50);
});

/* Export */
document.getElementById("btn-export").addEventListener("click", async()=>{
  const data={version:APP_VERSION,exportedAt:new Date().toISOString(),
    config:await dbGet("config","main"),snapshots:await dbGetAll("snapshots"),
    potTx:await dbGetAll("potTx"),months:await dbGetAll("months"),
    milestones:await dbGetAll("milestones"),loans:await dbGetAll("loans")};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download=`paisa-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(url);toast("Exported ✓");
});

/* Import */
document.getElementById("btn-import").addEventListener("click", ()=>{
  const input=document.createElement("input");input.type="file";input.accept=".json";
  input.addEventListener("change",async(e)=>{
    const file=e.target.files[0];if(!file) return;
    try{const text=await file.text();const data=JSON.parse(text);
      if(data.config) await dbPut("config",data.config,"main");
      if(data.snapshots) for(const s of data.snapshots) await dbPut("snapshots",s);
      if(data.potTx) for(const t of data.potTx) await dbPut("potTx",t);
      if(data.months) for(const m of data.months) await dbPut("months",m);
      if(data.milestones) for(const m of data.milestones) await dbPut("milestones",m);
      if(data.loans) for(const l of data.loans) await dbPut("loans",l);
      await loadConfig();toast("Imported ✓ — refreshing");renderHome();
    }catch(err){toast("Import failed: "+err.message)}
  });input.click();
});

/* About */
document.getElementById("btn-about").addEventListener("click", ()=>{
  showModal("About Paisa",`<div style="text-align:center;padding:16px">
    <div style="font-size:3rem">💰</div>
    <div style="font-size:1.2rem;font-weight:700;margin:8px 0">Paisa v${APP_VERSION}</div>
    <div style="font-size:.82rem;color:var(--text-muted);line-height:1.6">Personal money dashboard.<br>Data stays on your device (IndexedDB).<br>No server, no tracking, no ads.</div>
  </div>`,[{label:"Close"}]);
});

/* ═══ SETUP WIZARD ═══ */
const SETUP_STEPS=[
  {id:"welcome",title:"Welcome to Paisa 💰",subtitle:"Your personal money dashboard.<br>All data stays on this device — never sent anywhere."},
  {id:"income",title:"Your income",subtitle:"Monthly take-home salary"},
  {id:"bonus",title:"Bonus months",subtitle:"Some months you get more — tell us which"},
  {id:"split",title:"Monthly split",subtitle:"How your salary is divided"},
  {id:"pots",title:"Savings pots",subtitle:"Set up your savings buckets"},
  {id:"balances",title:"Starting balances",subtitle:"Current pot balances (we'll seed these)"},
  {id:"sip",title:"SIP investments",subtitle:"Track mutual fund SIPs (optional)"},
  {id:"done",title:"You're all set! 🎉",subtitle:"Your dashboard is ready."}
];
let setupStep=0;

function showSetupWizard(){
  document.querySelectorAll(".screen").forEach(s=>s.classList.add("hidden"));
  document.querySelector(".bottom-nav").classList.add("hidden");
  let overlay=document.getElementById("setup-overlay");
  if(!overlay){overlay=document.createElement("div");overlay.id="setup-overlay";
    overlay.style.cssText="position:fixed;inset:0;z-index:200;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 20px calc(24px + env(safe-area-inset-bottom,0))";
    document.body.appendChild(overlay);}
  setupStep=0;renderSetupStep();
}

function renderSetupStep(){
  const overlay=document.getElementById("setup-overlay");
  const step=SETUP_STEPS[setupStep];
  const isFirst=setupStep===0,isLast=setupStep===SETUP_STEPS.length-1;
  const dots=SETUP_STEPS.map((_,i)=>`<div style="width:8px;height:8px;border-radius:50%;background:${i===setupStep?'var(--accent)':'var(--surface2)'}"></div>`).join("");
  let body="";
  switch(step.id){
    case"welcome":body=`<div style="text-align:center;padding-top:60px"><div style="font-size:4rem;margin-bottom:16px">💰</div><h2 style="font-size:1.5rem;font-weight:800;margin-bottom:8px">${step.title}</h2><p style="color:var(--text-muted);line-height:1.6;font-size:.9rem">${step.subtitle}</p><div style="margin-top:32px;font-size:.78rem;color:var(--text-dim)">🔒 Zero data leaves your device<br>📱 Works offline after first load<br>📤 Export anytime as JSON backup</div></div>`;break;
    case"income":body=`<div class="form-group"><label class="form-label">Monthly take-home salary (₹)</label><input type="number" class="form-input" id="setup-income" value="${config.income||''}" placeholder="₹ monthly salary"></div><div class="form-group"><label class="form-label">Spending budget (₹) — what stays in your account for daily use</label><input type="number" class="form-input" id="setup-budget" value="${config.spendingBudget||''}" placeholder="₹ spending budget"></div><div class="form-group"><label class="form-label">Floor (₹) — minimum you never touch</label><input type="number" class="form-input" id="setup-floor" value="${config.floor||''}" placeholder="₹ floor amount"></div>`;break;
    case"bonus":body=`<div class="form-group"><label class="form-label">Bonus take-home (₹) — leave 0 if no bonus months</label><input type="number" class="form-input" id="setup-bonus-income" value="${config.bonusIncome||''}" placeholder="₹ bonus salary"></div><div class="form-group"><label class="form-label">Which months? (tap to toggle)</label><div id="setup-bonus-months" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>{const active=(config.bonusMonths||[]).includes(i+1);return`<button type="button" class="btn-sm ${active?'btn-primary':'btn-secondary'}" data-month="${i+1}" style="width:calc(25% - 6px)">${m}</button>`}).join("")}</div></div>`;break;
    case"split":body=`<p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Fixed transfers each month (separate from pots — set those next).</p><div class="form-group"><label class="form-label">Transfer to family/parent (₹/month) — 0 if none</label><input type="number" class="form-input" id="setup-mother" value="${config.motherAmount||''}" placeholder="₹ amount"></div><div class="form-group"><label class="form-label">Transfer day of month</label><input type="number" class="form-input" id="setup-transfer-day" value="${config.transferDay||2}" placeholder="e.g. 2" min="1" max="28"></div>`;break;
    case"pots":{
      const pots=config.pots.length>0?config.pots:[{id:"pot1",name:"",target:0,monthly:0,icon:"🛡️"}];
      body=`<p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Add your savings pots. Each gets a monthly auto-credit.</p><div id="setup-pots-list">${pots.map((p,i)=>setupPotRow(p,i)).join("")}</div><button type="button" class="btn-secondary btn-sm" id="setup-add-pot" style="margin-top:10px">+ Add pot</button>`;break;}
    case"balances":{
      const pots=config.pots.length>0?config.pots:[];
      if(!pots.length) body=`<p style="color:var(--text-dim);text-align:center;padding:24px">No pots set up — go back and add some.</p>`;
      else body=`<p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Enter current balance for each pot. Leave 0 for new pots.</p>${pots.map(p=>`<div class="form-group"><label class="form-label">${p.icon} ${p.name}</label><input type="number" class="form-input setup-pot-balance" data-pot-id="${p.id}" value="0" placeholder="₹ current balance"></div>`).join("")}`;break;}
    case"sip":{
      const sips = config.sips && config.sips.length > 0 ? config.sips : [{id:"sip-1",name:"",amount:0}];
      body=`<p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Track your SIP mutual funds. Add as many as you have, or skip if none.</p>
        <div id="setup-sips-list">
          ${sips.map((s,i)=>`<div class="glass-card setup-sip-row" data-idx="${i}" style="margin-bottom:10px;padding:12px">
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input type="text" class="form-input setup-sip-name" value="${s.name}" placeholder="Fund name" style="flex:1">
            </div>
            <div class="form-group"><label class="form-label">Monthly (₹)</label>
              <input type="number" class="form-input setup-sip-amt" value="${s.amount||''}" placeholder="₹ per month"></div>
          </div>`).join("")}
        </div>
        <button type="button" class="btn-secondary btn-sm" id="setup-add-sip" style="margin-top:10px">+ Add another SIP</button>
        <div class="form-group" style="margin-top:12px"><label class="form-label">SIP auto-debit day</label>
          <input type="number" class="form-input" id="setup-sip-day" value="${config.sipDay||3}" min="1" max="28"></div>`;break;}
    case"done":body=`<div style="text-align:center;padding-top:40px"><div style="font-size:4rem;margin-bottom:16px">🎉</div><h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">${step.title}</h2><p style="color:var(--text-muted);line-height:1.6;font-size:.9rem">${step.subtitle}</p><div style="margin-top:16px;font-size:.82rem;color:var(--text-dim)">All your data is stored locally in IndexedDB.<br>Nothing is in the source code. Nothing leaves your device.</div></div>`;break;
  }
  const prevBtn=isFirst?"":`<button type="button" class="btn-secondary btn-sm" id="setup-prev" style="flex:1">Back</button>`;
  const nextLabel=isLast?"Let's go!":(isFirst?"Get started":"Next");
  overlay.innerHTML=`<div style="max-width:420px;margin:0 auto"><div style="display:flex;justify-content:center;gap:6px;margin-bottom:24px">${dots}</div><div style="font-size:.72rem;color:var(--text-dim);text-align:center;margin-bottom:4px">Step ${setupStep+1} of ${SETUP_STEPS.length}</div>${!isFirst&&!isLast?`<h2 style="font-size:1.2rem;font-weight:700;margin-bottom:4px">${step.title}</h2><p style="font-size:.78rem;color:var(--text-muted);margin-bottom:16px">${step.subtitle}</p>`:''}${body}<div class="btn-row" style="margin-top:24px">${prevBtn}<button type="button" class="btn-primary btn-sm" id="setup-next" style="flex:1">${nextLabel}</button></div></div>`;
  overlay.querySelector("#setup-next")?.addEventListener("click",()=>advanceSetup(1));
  overlay.querySelector("#setup-prev")?.addEventListener("click",()=>advanceSetup(-1));
  if(step.id==="bonus") overlay.querySelectorAll("#setup-bonus-months button").forEach(btn=>btn.addEventListener("click",()=>{btn.classList.toggle("btn-primary");btn.classList.toggle("btn-secondary")}));
  if(step.id==="pots") overlay.querySelector("#setup-add-pot")?.addEventListener("click",()=>{const list=overlay.querySelector("#setup-pots-list");const idx=list.children.length;const div=document.createElement("div");div.innerHTML=setupPotRow({id:"pot"+(idx+1),name:"",target:0,monthly:0,icon:"💰"},idx);list.appendChild(div.firstElementChild)});
  if(step.id==="sip") overlay.querySelector("#setup-add-sip")?.addEventListener("click",()=>{const list=overlay.querySelector("#setup-sips-list");const idx=list.children.length;const div=document.createElement("div");div.className="glass-card setup-sip-row";div.dataset.idx=idx;div.style.cssText="margin-bottom:10px;padding:12px";div.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:8px"><input type="text" class="form-input setup-sip-name" placeholder="Fund name" style="flex:1"></div><div class="form-group"><label class="form-label">Monthly (₹)</label><input type="number" class="form-input setup-sip-amt" placeholder="₹ per month"></div>`;list.appendChild(div)});
}
function setupPotRow(pot,idx){
  const icons=["🛡️","🎯","👨‍👩‍👦","🏠","✈️","🎓","💰","🚗","💻","🎮"];
  return`<div class="glass-card setup-pot-row" data-idx="${idx}" style="margin-bottom:10px;padding:12px"><div style="display:flex;gap:8px;margin-bottom:8px"><select class="form-input setup-pot-icon" style="width:60px;text-align:center;font-size:1.2rem">${icons.map(i=>`<option ${i===pot.icon?'selected':''}>${i}</option>`).join("")}</select><input type="text" class="form-input setup-pot-name" value="${pot.name}" placeholder="Pot name" style="flex:1"></div><div style="display:flex;gap:8px"><div style="flex:1"><label class="form-label">Monthly ₹</label><input type="number" class="form-input setup-pot-monthly" value="${pot.monthly||''}" placeholder="0"></div><div style="flex:1"><label class="form-label">Target ₹</label><input type="number" class="form-input setup-pot-target" value="${pot.target||''}" placeholder="0 = no target"></div></div></div>`;
}
function collectSetupData(stepId){
  const overlay=document.getElementById("setup-overlay");
  switch(stepId){
    case"income":config.income=parseFloat(overlay.querySelector("#setup-income")?.value)||0;config.spendingBudget=parseFloat(overlay.querySelector("#setup-budget")?.value)||0;config.floor=parseFloat(overlay.querySelector("#setup-floor")?.value)||0;break;
    case"bonus":{config.bonusIncome=parseFloat(overlay.querySelector("#setup-bonus-income")?.value)||0;const sel=[];overlay.querySelectorAll("#setup-bonus-months button.btn-primary").forEach(b=>sel.push(parseInt(b.dataset.month)));config.bonusMonths=sel;break;}
    case"split":config.motherAmount=parseFloat(overlay.querySelector("#setup-mother")?.value)||0;config.transferDay=parseInt(overlay.querySelector("#setup-transfer-day")?.value)||2;break;
    case"pots":{const pots=[];overlay.querySelectorAll(".setup-pot-row").forEach((row,i)=>{const name=row.querySelector(".setup-pot-name")?.value.trim();if(!name)return;const icon=row.querySelector(".setup-pot-icon")?.value||"💰";const monthly=parseFloat(row.querySelector(".setup-pot-monthly")?.value)||0;const target=parseFloat(row.querySelector(".setup-pot-target")?.value)||0;const id=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||("pot"+i);pots.push({id,name,icon,monthly,target})});config.pots=pots;break;}
    case"balances":{pendingPotBalances={};overlay.querySelectorAll(".setup-pot-balance").forEach(inp=>{const potId=inp.dataset.potId;const amount=parseFloat(inp.value)||0;if(potId&&amount>0)pendingPotBalances[potId]=amount});break;}
    case"sip":{const sips=[];overlay.querySelectorAll(".setup-sip-row").forEach((row,i)=>{const name=row.querySelector(".setup-sip-name")?.value.trim();if(!name)return;const amount=parseFloat(row.querySelector(".setup-sip-amt")?.value)||0;if(amount<=0)return;const id="sip-"+(i+1);sips.push({id,name,amount})});config.sips=sips;config.sipDay=parseInt(overlay.querySelector("#setup-sip-day")?.value)||3;break;}
  }
}
async function advanceSetup(dir){
  if(dir>0)collectSetupData(SETUP_STEPS[setupStep].id);
  setupStep+=dir;if(setupStep<0)setupStep=0;
  if(setupStep>=SETUP_STEPS.length){await finishSetup();return}
  renderSetupStep();
}
async function finishSetup(){
  config.setupDone=true;config.setupDate=new Date().toISOString();await saveConfig();
  for(const[potId,amount]of Object.entries(pendingPotBalances)){
    if(amount>0)await dbPut("potTx",{potId,date:new Date().toISOString(),type:"in",amount,note:"Starting balance"});
  }
  pendingPotBalances={};
  const overlay=document.getElementById("setup-overlay");if(overlay)overlay.remove();
  document.querySelector(".bottom-nav").classList.remove("hidden");renderHome();
}

/* ═══ INIT ═══ */
async function init(){
  await openDB();await loadConfig();
  if(!config.setupDone){showSetupWizard();return}
  renderHome();
}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js");
init();
