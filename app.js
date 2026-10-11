/* Budget. Vanilla JS; data cached in localStorage and saved (encrypted) to the signed-in account via the Worker. */
'use strict';

/* ---------- helpers ---------- */
const KEY = 'budgetApp.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
function num(v) {
  if (v === '' || v == null) return null;
  let s = String(v).trim(); let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }   // trailing minus e.g. "12.00-"
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = s => s ? parseISO(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtShort = s => s ? parseISO(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
function weekStartOf(s, ws) { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7)); return iso(d); }
function addMonths(d, n) { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
function addPeriods(s, n, freq) {
  const d = parseISO(s);
  if (freq === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (freq === 'biweekly') d.setDate(d.getDate() + 14 * n);
  else if (freq === 'semimonthly') d.setDate(d.getDate() + Math.round(n * 365.25 / 24));
  else if (freq === 'monthly') addMonths(d, n);
  else if (freq === 'quarterly') addMonths(d, 3 * n);
  else if (freq === 'yearly') addMonths(d, 12 * n);
  return iso(d);
}
const FREQS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const PER_WEEK = { weekly: 1, biweekly: 1 / 2, semimonthly: 24 / 52, monthly: 12 / 52, quarterly: 4 / 52, yearly: 1 / 52 };
const weekly = (amt, freq) => (amt || 0) * (PER_WEEK[freq] ?? 0);
const opts = (pairs, sel) => pairs.map(([v, t]) => `<option value="${h(v)}"${String(v) === String(sel) ? ' selected' : ''}>${h(t)}</option>`).join('');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600); }
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- state ---------- */
function defaults() {
  const cat = (name, period, extra = {}) => ({ id: uid(), name, budget: null, period, ...extra });
  const cats = [cat('Hotels/Lodging', 'week'), cat('Gas', 'week'), cat('Food', 'week'), cat('Bills', 'month'),
    cat('Payment plans', 'month'), cat('Savings', 'month'), cat('Fun/Gaming', 'week'),
    cat('Other', 'week'), cat('Transfers', 'week'), cat('Income', 'week', { income: true })];
  const id = n => cats.find(c => c.name === n).id;
  const kw = {
    'Hotels/Lodging': ['hotel', 'motel', ' inn', 'marriott', 'hilton', 'hampton', 'holiday inn', 'courtyard', 'suites', 'airbnb', 'extended stay', 'red roof', 'best western'],
    Gas: ['sheetz', 'wawa', 'shell', 'exxon', 'sunoco', 'speedway', 'valero', '7-eleven', 'royal farms', 'citgo', 'chevron', 'bp '],
    Food: ['mcdonald', 'wendy', 'chick-fil', 'taco bell', 'subway', 'burger', 'pizza', 'starbucks', 'dunkin', 'restaurant', 'grill', 'food lion', 'giant', 'safeway', 'harris teeter', 'aldi', 'kroger', 'lidl', 'doordash', 'uber eats'],
    'Payment plans': ['klarna', 'affirm', 'afterpay'],
    Bills: ['verizon', 'at&t', 't-mobile', 'dominion', 'insurance', 'geico', 'progressive', 'state farm', 'xfinity', 'comcast', 'netflix', 'spotify', 'mortgage'],
    'Fun/Gaming': ['steam', 'playstation', 'xbox', 'nintendo', 'gamestop', 'twitch', 'epic games', 'discord'],
    Income: ['payroll', 'direct dep']
  };
  const rules = Object.entries(kw).flatMap(([c, ks]) => ks.map(k => ({ id: uid(), keyword: k.trim(), categoryId: id(c) })));
  const alloc = (name, type, catName) => ({ id: uid(), name, type, value: null, categoryId: catName ? id(catName) : '' });
  return {
    version: 1,
    settings: { weekStart: 1, theme: 'auto', includeDebts: true, countdownDate: '', countdownName: '', paycheckKeyword: '',
      autoWork: { on: false, days: [1, 2, 3, 4, 5], cats: [id('Hotels/Lodging')] } },
    categories: cats,
    allocations: [alloc('Hotels/Lodging', 'fixed', 'Hotels/Lodging'), alloc('Gas', 'fixed', 'Gas'),
      alloc('Food', 'fixed', 'Food'),
      alloc('Savings', 'percent', 'Savings'), alloc('Fun/Gaming', 'fixed', 'Fun/Gaming')],
    bills: [],
    paychecks: [],
    transactions: [],
    debts: [],
    rules,
    csvMappings: {},
    goals: [], work: { days: {} }, checkins: [], subStatus: {},
    sync: blankSync()
  };
}
const blankSync = () => ({ url: '', passcode: '', session: '', label: '', key: '', cursor: '', connected: false, institution: null, lastSync: null, accounts: [] });
const normalize = s => { const d = defaults(); return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) }, sync: { ...blankSync(), ...(s.sync || {}) } }; };
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { console.error(e); }
  return defaults();
}
function migrate() {   // upgrade older saved data / backups in place
  if (!S.settings.migrated21) {   // v2.1: one-time add of a Transfers category (excluded from safe-to-spend)
    if (!S.categories.some(c => /transfer/i.test(c.name))) S.categories.splice(Math.max(0, S.categories.findIndex(c => c.income)), 0, { id: uid(), name: 'Transfers', budget: null, period: 'week' });
    S.settings.migrated21 = true;
  }
  if (typeof S.settings.paycheckKeyword !== 'string') S.settings.paycheckKeyword = '';
  // v2.2: goals, work days, check-ins, subscription marks
  if (!Array.isArray(S.goals)) S.goals = [];
  S.goals.forEach(g => { if (!Array.isArray(g.contributions)) g.contributions = []; if (g.inSafe === undefined) g.inSafe = true; });
  if (!S.settings.migrated23) {   // v2.3: goals count only explicit money; drop anything else, keep his logged contributions
    const seen = new Set();
    S.goals.forEach(g => {
      g.contributions = g.contributions.filter(c => c && +c.amount > 0 && /^\d{4}-\d\d-\d\d$/.test(c.date || '') && !(c.txnId && seen.has(c.txnId)))
        .map(c => { if (c.txnId) seen.add(c.txnId); return { id: c.id || uid(), date: c.date, amount: r2(+c.amount), ...(c.txnId ? { txnId: c.txnId } : {}), ...(c.note ? { note: String(c.note) } : {}) }; });
      for (const k of ['saved', 'progress', 'current', 'auto', 'autoCount', 'linkedCats', 'categoryId']) delete g[k];
      if (!g.startDate) g.startDate = g.contributions.map(c => c.date).sort()[0] || today();
      // a single typed contribution equal to the target usually means the goal amount was entered as money saved: ask him
      if (g.target > 0 && sum(g.contributions, c => c.amount) + (+g.startAmount > 0 ? +g.startAmount : 0) >= g.target && g.contributions.some(c => !c.txnId && Math.abs(c.amount - g.target) < 0.005)) g.review = true;
    });
    S.settings.migrated23 = true;
  }
  S.goals.forEach(g => { if (!(g.target > 0)) g.target = null; if (!(g.startAmount > 0)) g.startAmount = 0; if (!g.startDate) g.startDate = today(); if (typeof g.name !== 'string') g.name = ''; });
  if (!S.work || typeof S.work.days !== 'object') S.work = { days: {} };
  if (!Array.isArray(S.checkins)) S.checkins = [];
  if (!S.subStatus || typeof S.subStatus !== 'object') S.subStatus = {};
  if (!S.settings.autoWork) S.settings.autoWork = { on: false, days: [1, 2, 3, 4, 5], cats: S.categories.filter(c => /lodg|hotel/i.test(c.name)).map(c => c.id) };
}
let S = load(); migrate();
function save(local) {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert('Could not save — device storage may be full. Export a backup now.'); }
  if (!local && S.sync.session && cloud.user) { cloud.dirty++; saveCloud(); clearTimeout(pushTimer); pushTimer = setTimeout(cloudPush, 2000); }
}
/* ---------- account + cloud copy (one encrypted document per user on the Worker; last write wins by revision) ---------- */
const CLOUD = 'budgetApp.cloud', COPY = 'budgetApp.localCopy', DEVICE = ['session', 'label', 'passcode', 'key', 'url'];
let cloud = { user: '', rev: 0, dirty: 0, ...JSON.parse(localStorage.getItem(CLOUD) || '{}') }, pushTimer, pushing = false;
const saveCloud = () => localStorage.setItem(CLOUD, JSON.stringify(cloud));
const docOut = () => { const d = JSON.parse(JSON.stringify(S)); DEVICE.forEach(k => d.sync[k] = ''); return d; };
const hasData = x => ['transactions', 'paychecks', 'bills', 'debts', 'goals', 'checkins'].some(k => x?.[k]?.length);
function adopt(data, rev) {   // replace local data with the account's copy, keeping this device's login fields
  const dev = Object.fromEntries(DEVICE.map(k => [k, S.sync[k]]));
  S = normalize(data); Object.assign(S.sync, dev); migrate(); cloud.rev = rev; cloud.dirty = 0; saveCloud(); save(true);
}
function keepLocalCopy() { localStorage.setItem(COPY, JSON.stringify({ at: new Date().toISOString(), data: docOut() })); }
async function cloudApi(method, body) {
  const r = await fetch(SYNC_URL_DEFAULT + '/data', { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.sync.session }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const d = await r.json().catch(() => ({}));
  if (d.code === 'SESSION_EXPIRED') { S.sync.session = ''; save(true); render(); }
  if (!r.ok && r.status !== 409) throw Object.assign(new Error(d.error || 'Could not save to your account'), { code: d.code });
  return d;
}
function serverWins(d) {   // server is newer than our unsynced edits: keep server, stash ours as a restorable copy
  keepLocalCopy(); adopt(d.data, d.rev); render();
  toast('Newer data came from another device. Your copy from this device is saved under More → Account.');
}
async function cloudPush() {
  if (pushing || !cloud.dirty || !S.sync.session || !cloud.user || !navigator.onLine) return;
  pushing = true; const n = cloud.dirty;
  try {
    const d = await cloudApi('PUT', { rev: cloud.rev, data: docOut() });
    if (d.code === 'REV_CONFLICT') serverWins(d);
    else { cloud.rev = d.rev; cloud.dirty = Math.max(0, cloud.dirty - n); cloud.saved = new Date().toISOString(); delete cloud.err; saveCloud(); }
  } catch (e) { console.warn('cloud push', e.message); cloud.err = e.message; saveCloud(); }
  finally { pushing = false; if (cloud.dirty && navigator.onLine) { clearTimeout(pushTimer); pushTimer = setTimeout(cloudPush, 2000); } }
}
async function cloudSync() {   // on open / foreground / back online: pull, then push our edits
  if (!S.sync.session || !cloud.user || !navigator.onLine) return;
  try {
    await linkLegacyBank();
    const d = await cloudApi('GET');
    if (d.rev > cloud.rev) { if (cloud.dirty) serverWins(d); else { adopt(d.data, d.rev); render(); } }
    else if (d.rev < cloud.rev) { cloud.rev = d.rev; cloud.dirty = cloud.dirty || 1; saveCloud(); }
    await cloudPush();
  } catch (e) { console.warn('cloud sync', e.message); }
}
async function linkLegacyBank() {   // one time: move this device's passcode bank connection onto the signed-in account (same Plaid Item)
  const y = S.sync; if (!y.passcode || !y.key) return;
  const r = await fetch(SYNC_URL_DEFAULT + '/link-legacy', { method: 'POST', body: '{}',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + y.session, 'X-App-Passcode': y.passcode, 'X-Sync-Key': y.key } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (d.code === 'BAD_PASSCODE') Object.assign(y, { passcode: '', key: '', url: '' }); save(true); return; }
  if (d.linked) Object.assign(y, { connected: true, institution: d.institution || y.institution });
  Object.assign(y, { passcode: '', key: '', url: '' }); save(true);
  if (d.linked) toast('Your bank connection is now linked to your account.');
}
async function afterLogin(d) {
  Object.assign(S.sync, { session: d.session, label: d.label || '' }); save(true);
  try { await linkLegacyBank(); } catch {}
  if (cloud.user === d.user) { render(); return cloudSync(); }
  const srv = await cloudApi('GET');
  cloud = { user: d.user, rev: srv.rev, dirty: 0 };
  if (!srv.data) cloud.dirty = 1;                              // empty account: upload this device's data (migration)
  else if (!hasData(S)) adopt(srv.data, srv.rev);              // empty device: take the account's data
  else if (confirm(`Your account already has budget data (saved ${new Date(srv.updated).toLocaleString()}).\n\nOK = use your account's data (this device's data is kept as a copy you can restore).\nCancel = replace your account's data with this device's data.`)) { keepLocalCopy(); adopt(srv.data, srv.rev); }
  else cloud.dirty = 1;
  saveCloud(); save(true); render(); await cloudPush();
}
const catById = id => S.categories.find(c => c.id === id);
const catName = id => catById(id)?.name || 'Uncategorized';
const catOpts = (sel, withBlank) => (withBlank ? `<option value="">${h(withBlank)}</option>` : '') + opts(S.categories.map(c => [c.id, c.name]), sel);

/* ---------- calculations ---------- */
function debtStatus(d) {
  const paid = sum(d.payments, p => p.amount);
  // Bank-synced balances are already current: only payments logged after the last sync reduce them.
  const sincePaid = d.bank ? sum(d.payments.filter(p => p.date > (d.balanceAsOf || '')), p => p.amount) : paid;
  const remaining = d.balance == null ? null : Math.max(0, r2(d.balance - sincePaid));
  let projected = null, periods = null, neverPaysOff = false;
  if (remaining === 0) projected = d.payments.length ? d.payments.map(p => p.date).sort().at(-1) : today();
  else if (remaining && d.payment > 0) {
    const perYear = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1 }[d.frequency] || 12;
    const r = d.apr > 0 ? d.apr / 100 / perYear : 0;
    if (r && d.payment <= remaining * r) { neverPaysOff = true; return { paid, remaining, projected: null, periods: null, behind: false, neverPaysOff }; }
    periods = r ? Math.ceil(-Math.log(1 - r * remaining / d.payment) / Math.log(1 + r) - 1e-9) : Math.ceil(remaining / d.payment - 1e-9);
    const last = d.payments.map(p => p.date).sort().at(-1);
    projected = addPeriods(last || today(), last ? periods : periods - 1, d.frequency);
  }
  const behind = projected && d.endDate && remaining > 0 && projected > d.endDate;
  return { paid, remaining, projected, periods, behind, neverPaysOff };
}
function debtActive(d) { const st = debtStatus(d); return d.payment > 0 && (st.remaining == null || st.remaining > 0); }
function computePlan(pay) {
  pay = pay || 0;
  const billLines = S.bills.map(b => ({ name: b.name || 'Bill', note: `${money(b.amount)} ${FREQS[b.frequency]?.toLowerCase() || ''}`, amt: r2(weekly(b.amount, b.frequency)) }));
  if (S.settings.includeDebts) S.debts.filter(debtActive).forEach(d =>
    billLines.push({ name: d.name, note: `${money(d.payment)} ${FREQS[d.frequency]?.toLowerCase()} (debt)`, amt: r2(weekly(d.payment, d.frequency)) }));
  const billTotal = r2(sum(billLines, l => l.amt));
  let left = pay - billTotal;
  const allocLines = S.allocations.map(a => {
    const amt = a.value == null ? 0 : r2(a.type === 'percent' ? pay * a.value / 100 : a.value);
    return { ...a, amt };
  });
  left -= sum(allocLines, a => a.amt);
  return { pay, billLines, billTotal, allocLines, left: r2(left) };
}
function periodRange(period, ref = today()) {
  if (period === 'month') { const d = parseISO(ref); const s = iso(new Date(d.getFullYear(), d.getMonth(), 1)); return [s, iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
  const s = weekStartOf(ref, S.settings.weekStart); return [s, addDays(s, 6)];
}
function spent(catId, period, ref) {
  const [a, b] = periodRange(period, ref);
  return r2(sum(S.transactions.filter(t => t.type !== 'income' && t.categoryId === catId && t.date >= a && t.date <= b), t => t.amount));
}
function budgetRows() {
  return S.categories.filter(c => !c.income && c.budget > 0).map(c => {
    const s = spent(c.id, c.period), pct = s / c.budget * 100;
    return { c, s, pct, over: s > c.budget };
  });
}
function budgetHTML(rows) {
  if (!rows.length) return `<p class="muted small">No budgets set yet. Add weekly or monthly budgets under <b>More → Categories &amp; budgets</b>.</p>`;
  return rows.map(({ c, s, pct, over }) => `<div class="budget">
    <div class="head"><span>${h(c.name)} <span class="tag">${c.period === 'month' ? 'this month' : 'this week'}</span></span>
    <span class="amt ${over ? 'bad' : ''}">${money(s)} / ${money(c.budget)}</span></div>
    <div class="bar ${over ? 'over' : pct >= 85 ? 'warn' : ''}"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
    ${over ? `<div class="small bad">⚠ Over by ${money(s - c.budget)}</div>` : ''}</div>`).join('');
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Categories whose money is already covered by set-asides/savings or isn't spending at all.
const nonSpending = c => !!c && (c.income || /bill|payment plan|debt|loan|transfer|saving|mortgage/i.test(c.name));
const isSavingsAlloc = a => /saving/i.test(a.name) || /saving/i.test(catName(a.categoryId) || '');
function safeToSpend(ref = today()) {
  const [ws, we] = periodRange('week', ref);
  const inWeek = S.paychecks.filter(p => p.date >= ws && p.date <= we);
  let pc = inWeek.find(p => !p.auto) || inWeek[0], basis = 'this week';
  if (!pc) { pc = [...S.paychecks].sort((a, b) => b.date.localeCompare(a.date))[0]; basis = 'planned'; }
  if (!pc) return null;
  const plan = computePlan(pc.amount);
  const goals = r2(sum(S.goals.filter(g => g.inSafe), g => goalStatus(g).weekly));
  const savings = r2(sum(plan.allocLines.filter(isSavingsAlloc), a => a.amt));
  const spentTx = S.transactions.filter(t => t.type !== 'income' && t.source !== 'debt' && t.date >= ws && t.date <= we && !nonSpending(catById(t.categoryId)));
  const spent = r2(sum(spentTx, t => t.amount));
  return { ws, we, pay: pc.amount, basis, auto: !!pc.auto, setAside: plan.billTotal, savings, goals, spent, safe: r2(pc.amount - plan.billTotal - savings - goals - spent) };
}
/* Create this week's paycheck from an incoming deposit that matches the Paycheck keyword (never duplicates a week). */
function autoPaychecks(txns) {
  // keep existing auto paychecks in step with their deposit (pending → posted amount, or removed)
  S.paychecks = S.paychecks.filter(p => { if (!p.auto || !p.txnId) return true; const t = S.transactions.find(x => x.id === p.txnId);
    if (!t) return false; p.amount = t.amount; p.date = t.date; return true; });
  const kw = (S.settings.paycheckKeyword || '').trim().toLowerCase(); if (!kw) return [];
  const made = [];
  for (const t of txns) {
    if (!t || t.type !== 'income' || !`${t.importDesc || ''} ${t.note || ''}`.toLowerCase().includes(kw)) continue;
    const ws = weekStartOf(t.date, S.settings.weekStart), we = addDays(ws, 6);
    if (S.paychecks.some(p => p.date >= ws && p.date <= we)) continue;
    const p = { id: uid(), date: t.date, amount: t.amount, auto: true, txnId: t.id }; S.paychecks.push(p); made.push(p);
  }
  return made;
}
const payToast = made => made.length ? ` · Paycheck added: ${made.map(p => money(p.amount)).join(', ')}` : '';

/* ---------- goals ---------- */
// Only money explicitly logged counts: the optional starting amount + contributions he adds (typed, or a transaction he links).
// Allocations, transfers and synced transactions never count on their own.
function goalStatus(g, on = today()) {
  const contributed = r2(sum((g.contributions || []).filter(c => c.amount > 0), c => +c.amount));
  const start = g.startAmount > 0 ? r2(+g.startAmount) : 0;
  const saved = r2(start + contributed);
  const target = g.target > 0 ? r2(+g.target) : null;
  const done = !!target && saved >= target;   // reached only when saved >= target > 0
  const left = target ? Math.max(0, r2(target - saved)) : null;
  const days = g.date ? dayDiff(g.date, on) : null;
  const past = days != null && days < 0 && !done;
  const weeks = days == null || days < 0 ? null : Math.max(1, Math.ceil((days + 1) / 7));
  const weekly = target && !done && weeks ? r2(left / weeks) : 0;
  let expected = null, behind = 0;   // where he should be by now: straight line from (start date, starting amount) to (target date, target)
  if (target && g.date && !done) {
    const s0 = g.startDate && g.startDate < g.date ? g.startDate : on, total = dayDiff(g.date, s0), el = dayDiff(on, s0);
    const f = total <= 0 ? 1 : Math.min(1, Math.max(0, el / total));
    expected = r2(Math.min(target, start + (target - start) * f)); behind = Math.max(0, r2(expected - saved));
  }
  return { saved, start, contributed, target, left, days, weeks, weekly, past, done, expected, behind, onTrack: expected != null && behind < 0.01,
    pct: target ? Math.min(100, saved / target * 100) : 0, noTarget: !target };
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function goalLines(gs) {   // [main line, class, track line, track class]
  if (gs.noTarget) return ['Set a target amount to track this goal.', 'muted', '', ''];
  if (gs.done) return ['Reached! 🎉', 'good', '', ''];
  if (gs.past) return [`Past date · ${money(gs.left)} left`, 'bad', '', ''];
  const main = `${money(gs.left)} left` + (gs.weeks ? ` · ${plural(gs.weeks, 'week')} left · <b>${money(gs.weekly)}/week</b> needed` : ' · add a target date to see the weekly amount');
  if (gs.expected == null) return [main, 'muted', '', ''];
  return [main, 'muted', gs.behind > 0 ? `Behind by ${money(gs.behind)} (should have ${money(gs.expected)} by now)` : 'On track ✓', gs.behind > 0 ? 'warn' : 'good'];
}
/* ---------- work weeks ---------- */
const catIdsBy = re => S.categories.filter(c => re.test(c.name)).map(c => c.id);
function isWorkDay(d) {
  if (S.work.days[d]) return 'tag';
  const a = S.settings.autoWork;
  if (a?.on && a.days.includes(parseISO(d).getDay()) && S.transactions.some(t => t.date === d && t.type !== 'income' && a.cats.includes(t.categoryId))) return 'auto';
  return null;
}
function workWeeks() {
  const L = catIdsBy(/lodg|hotel/i), G = catIdsBy(/gas|fuel/i), F = catIdsBy(/food|grocer|dining/i);
  const days = new Set([...Object.keys(S.work.days).filter(d => S.work.days[d]), ...S.transactions.map(t => t.date)]);
  const weeks = new Map();
  for (const d of days) {
    if (!isWorkDay(d)) continue;
    const ws = weekStartOf(d, S.settings.weekStart);
    const w = weeks.get(ws) || { ws, days: 0, lodging: 0, gas: 0, food: 0 }; w.days++;
    for (const t of S.transactions) if (t.date === d && t.type !== 'income') {
      if (L.includes(t.categoryId)) w.lodging += t.amount; else if (G.includes(t.categoryId)) w.gas += t.amount; else if (F.includes(t.categoryId)) w.food += t.amount;
    }
    weeks.set(ws, w);
  }
  const list = [...weeks.values()].map(w => ({ ...w, lodging: r2(w.lodging), gas: r2(w.gas), food: r2(w.food), total: r2(w.lodging + w.gas + w.food) }))
    .sort((a, b) => b.ws.localeCompare(a.ws));
  return { list, avg: list.length ? r2(sum(list, w => w.total) / list.length) : 0 };
}
/* ---------- weekly check-in ---------- */
function weekSummary(ws) {
  const we = addDays(ws, 6), inW = t => t.date >= ws && t.date <= we;
  let income = r2(sum(S.transactions.filter(t => t.type === 'income' && inW(t)), t => t.amount));
  if (!income) income = r2(sum(S.paychecks.filter(inW), p => p.amount));
  const exp = S.transactions.filter(t => t.type !== 'income' && t.source !== 'debt' && inW(t));
  const cats = S.categories.filter(c => !nonSpending(c)).map(c => {
    const spent = r2(sum(exp.filter(t => t.categoryId === c.id), t => t.amount));
    const budget = c.budget > 0 ? r2(c.period === 'month' ? c.budget * 12 / 52 : c.budget) : null;
    return { name: c.name, spent, budget, diff: budget == null ? null : r2(budget - spent) };
  }).filter(x => x.spent > 0 || x.budget);
  const spent = r2(sum(exp.filter(t => !nonSpending(catById(t.categoryId))), t => t.amount));
  const budget = r2(sum(cats.filter(c => c.budget), c => c.budget));
  const debtPaid = r2(sum(S.debts.flatMap(d => d.payments || []).filter(inW), p => p.amount));
  const saved = r2(sum(S.goals.flatMap(g => g.contributions || []).filter(inW), c => c.amount));
  return { ws, we, income, spent, budget, cats, debtPaid, saved };
}
function dueCheckin() {
  const prev = addDays(periodRange('week')[0], -7), end = addDays(prev, 6);
  if (S.checkins.some(c => c.ws === prev)) return null;
  if (!S.transactions.some(t => t.date <= end) && !S.paychecks.some(p => p.date <= end)) return null;   // nothing to report yet
  return weekSummary(prev);
}
function checkinHTML(c, full) {
  return `<table><tbody>
    <tr><td>Income</td><td class="num good">${money(c.income)}</td></tr>
    <tr><td>Spent${c.budget ? ` <span class="muted small">of ${money(c.budget)} budget</span>` : ''}</td><td class="num ${c.budget && c.spent > c.budget ? 'bad' : ''}">${money(c.spent)}</td></tr>
    ${c.debtPaid ? `<tr><td>Debt paid</td><td class="num">${money(c.debtPaid)}</td></tr>` : ''}
    ${c.saved ? `<tr><td>Saved toward goals</td><td class="num">${money(c.saved)}</td></tr>` : ''}
    ${(full ? (c.cats || []) : (c.cats || []).filter(x => x.budget)).map(x => `<tr><td class="small">${h(x.name)}</td><td class="num small ${x.diff != null && x.diff < 0 ? 'bad' : ''}">${money(x.spent)}${x.diff != null ? ` · ${x.diff < 0 ? 'over ' + money(-x.diff) : 'under ' + money(x.diff)}` : ''}</td></tr>`).join('')}
  </tbody></table>`;
}
/* ---------- subscriptions ---------- */
const merchKey = s => String(s || '').toLowerCase().replace(/[#*]/g, ' ').replace(/\b[\d-]+\b/g, ' ').replace(/[^a-z& ]/g, ' ')
  .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
function detectSubs() {
  const groups = new Map();
  for (const t of S.transactions) {
    if (t.type === 'income' || t.source === 'debt') continue;
    const c = catById(t.categoryId); if (c && (c.income || /transfer|saving/i.test(c.name))) continue;
    const k = merchKey(t.importDesc || t.note); if (k.length < 3) continue;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  }
  const out = [];
  for (const [k, arr] of groups) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = arr.slice(1).map((t, i) => dayDiff(t.date, arr[i].date)).filter(g => g > 0); if (!gaps.length) continue;
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const cadence = med >= 5 && med <= 9 ? 'weekly' : med >= 12 && med <= 17 ? 'biweekly' : med >= 26 && med <= 35 ? 'monthly' : med >= 350 && med <= 380 ? 'yearly' : null;
    if (!cadence || gaps.some(g => Math.abs(g - med) > Math.max(3, med * 0.4))) continue;
    const amts = arr.map(t => t.amount), avg = sum(amts) / amts.length;
    if (Math.max(...amts) - Math.min(...amts) > Math.max(1, avg * 0.15)) continue;   // amount must be steady
    const last = arr.at(-1);
    out.push({ key: 'tx:' + k, name: last.note || k, cadence, amount: last.amount, monthly: r2(avg * PER_MONTH[cadence]), last: last.date, count: arr.length, source: 'detected', mk: k });
  }
  for (const b of S.bills) {
    if (!(b.amount > 0)) continue;
    const bk = merchKey(b.name).split(' ')[0];
    const hit = bk && bk.length >= 3 ? S.transactions.filter(t => t.type !== 'income' && merchKey(t.importDesc || t.note).includes(bk)).sort((a, z) => z.date.localeCompare(a.date))[0] : null;
    for (let i = out.length - 1; i >= 0; i--) if (bk && bk.length >= 3 && out[i].source === 'detected' && out[i].mk?.includes(bk)) out.splice(i, 1);   // listed bill wins over detected copy
    out.push({ key: 'bill:' + b.id, name: b.name || 'Bill', cadence: b.frequency, amount: b.amount, monthly: r2(b.amount * (PER_MONTH[b.frequency] || 1)), last: hit?.date || null, source: 'bill' });
  }
  return out.map(x => ({ ...x, yearly: r2(x.monthly * 12), status: S.subStatus[x.key] || null })).sort((a, b) => b.monthly - a.monthly);
}

/* ---------- views ---------- */
let tab = 'home';
const ui = { editTxn: null, txnMonth: today().slice(0, 7), txnCat: '', planPay: null, planDate: null, imp: null, logDebt: null };

/* Render one section; if it throws, show a small note instead of blanking the whole tab. */
function safe(label, fn) {
  try { if (window.__failSection === label) throw new Error('simulated failure'); return fn(); }
  catch (e) {
    console.error(`[${label}] failed to render:`, e);
    return `<div class="card alert warn section-error" data-section="${h(label)}"><b>${h(label)}</b> couldn't be shown (${h(e.message || 'error')}). The rest of the app still works; export a backup and report this.</div>`;
  }
}
/* Matrix theme: faint falling-characters canvas behind the cards. ~24 fps, paused when hidden, one still frame with reduced motion. */
const rain = { on: false };
function matrixRain(on) {
  if (on === rain.on) return; rain.on = on;
  if (!on) { cancelAnimationFrame(rain.raf); rain.c?.remove(); rain.c = null; return; }
  const c = rain.c = document.createElement('canvas'), x = c.getContext('2d'), FS = 16, CH = '0123456789$¥アイウエオカキクケコサシスセソタチツテト';
  c.id = 'rain'; c.setAttribute('aria-hidden', 'true'); document.body.prepend(c);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'); let W, H, drops, last = 0;
  const step = () => { x.fillStyle = 'rgba(0,0,0,.09)'; x.fillRect(0, 0, W, H); x.font = FS + 'px monospace';
    drops.forEach((d, i) => { x.fillStyle = Math.random() < 0.06 ? '#d6ffe0' : '#00ff41'; x.fillText(CH[(Math.random() * CH.length) | 0], i * FS, d * FS);
      drops[i] = d * FS > H && Math.random() > 0.97 ? -Math.random() * 10 : d + 1; }); };
  const loop = t => { rain.raf = requestAnimationFrame(loop); if (t - last >= 42 && !document.hidden) { last = t; step(); } };
  const start = () => { if (rain.c !== c) return; cancelAnimationFrame(rain.raf); const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
    c.width = W * r; c.height = H * r; x.setTransform(r, 0, 0, r, 0, 0); x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    drops = Array.from({ length: Math.ceil(W / FS) }, () => -Math.random() * H / FS);
    if (reduce.matches) for (let k = 0; k < 120; k++) step(); else rain.raf = requestAnimationFrame(loop); };
  if (!rain.wired) { rain.wired = true; addEventListener('resize', () => rain.c && rain.start()); reduce.addEventListener?.('change', () => rain.c && rain.start()); }
  rain.start = start; start();
}
function render() {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.documentElement.dataset.theme = S.settings.theme === 'auto' ? '' : S.settings.theme;
  if (S.settings.theme === 'auto') delete document.documentElement.dataset.theme;
  matrixRain(S.settings.theme === 'matrix');
  if ((S.settings.theme === 'charcoal') !== !!$('#bgfx')) {   // Charcoal: slow drifting glow behind the cards (CSS only)
    if ($('#bgfx')) $('#bgfx').remove(); else document.body.insertAdjacentHTML('afterbegin', '<div id="bgfx" aria-hidden="true"></div>'); }
  document.body.classList.toggle('gated', !S.sync.session);
  if (!S.sync.session) { $('#view').innerHTML = gateHTML(); $('#title').textContent = 'Budget'; return mountGoogle(); }
  const views = { home: viewHome, plan: viewPlan, spend: viewSpend, debts: viewDebts, more: viewMore };
  $('#view').innerHTML = safe({ home: 'Home', plan: 'Paycheck', spend: 'Spending', debts: 'Debts', more: 'More' }[tab], views[tab]);
  $('#title').textContent = { home: 'Dolla Overview', plan: 'Paycheck plan', spend: 'Spending', debts: 'Debts', more: 'More' }[tab];
}

function gateHTML() {
  const c = ui.pwMode !== 'signin';
  return `<div class="card" id="gate">
    <img class="logo" src="icons/icon-192.png" alt="" width="84" height="84">
    <h1 class="brand">Dolla</h1>
    <p class="tagline">Budgeting for people paid weekly.</p>
    <h2>${c ? 'Create your account' : 'Welcome back'}</h2>
    <p class="small muted">Saved to your account, so it's on any phone or computer.</p>
    <form id="pwForm">
      <label for="pwEmail">Email</label><input id="pwEmail" type="email" autocomplete="email" inputmode="email" required>
      <label for="pwPass">Password${c ? ' (at least 8 characters)' : ''}</label><input id="pwPass" type="password" minlength="8" autocomplete="${c ? 'new-password' : 'current-password'}" required>
      ${c ? `<label for="pwInvite">Invite code</label><input id="pwInvite" placeholder="BUDGET-XXXX-XXXX" value="${h(ui.invite || '')}" autocapitalize="characters" autocomplete="off" spellcheck="false" required>` : ''}
      <button class="primary" type="submit">${c ? 'Create account' : 'Sign in'}</button></form>
    <p class="small"><a href="#" data-act="pwToggle">${c ? 'Already have an account? Sign in' : 'New here? Create an account'}</a></p>
    <div class="or">or</div>
    <div id="gsiBtn" style="min-height:44px;display:flex;justify-content:center;margin-bottom:var(--s3)"></div>
    <details class="small" id="inviteBox" style="text-align:left"><summary>Have an invite code?</summary>
      <label for="syInvite">Invite code</label><input id="syInvite" placeholder="BUDGET-XXXX-XXXX" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <div class="row" style="margin-top:.6rem"><button data-act="syncInvite">Continue</button></div></details></div>`;
}
function accountHTML() {
  const c = JSON.parse(localStorage.getItem(COPY) || 'null');
  return `<div class="card" id="account"><h3>Account</h3>
    <p class="small">Signed in${S.sync.label ? ' as <b>' + h(S.sync.label) + '</b>' : ''}. ${cloud.dirty ? 'Changes waiting to save to your account.' : 'Saved to your account.'}</p>
    ${cloud.dirty && cloud.err ? `<p class="small bad">Last save error: ${h(cloud.err)}</p>` : ''}
    ${c ? `<p class="small">A copy of this device's data from ${h(new Date(c.at).toLocaleString())} was kept.</p>
      <div class="row"><button data-act="restoreCopy">Restore that copy</button><button data-act="dropCopy">Delete copy</button></div>` : ''}
    <div class="row" style="margin-top:.5rem"><button class="danger" data-act="signOut">Sign out</button></div></div>`;
}
function viewHome() {
  const wd = S.settings.countdownDate, wn = S.settings.countdownName || 'Countdown';
  const days = wd ? Math.round((parseISO(wd) - parseISO(today())) / 864e5) : null;
  const st = safeToSpend();
  const rows = budgetRows(); const overs = rows.filter(r => r.over);
  const [ws, we] = periodRange('week');
  const debtLeft = sum(S.debts, d => debtStatus(d).remaining);
  const y = S.sync;
  return `
  <div class="card hero" id="safeCard">
    <div class="muted small">Safe to spend this week</div>
    ${st ? `<div class="huge ${st.safe < 0 ? 'bad' : 'good'}" id="safeNum">${money(st.safe)}</div>
      <div class="small muted">resets ${DAYS[S.settings.weekStart]} · ${fmtShort(ws)} – ${fmtShort(we)}</div>
      <details class="small" style="border:0;margin-top:.3rem"><summary style="font-weight:400;min-height:0">How this is figured</summary>
        <table><tbody>
        <tr><td>Paycheck <span class="tag">${st.basis === 'planned' ? 'planned' : st.auto ? 'deposit' : 'this week'}</span></td><td class="num">${money(st.pay)}</td></tr>
        <tr><td>Bills &amp; debt set-asides</td><td class="num">−${money(st.setAside)}</td></tr>
        <tr><td>Savings</td><td class="num">−${money(st.savings)}</td></tr>
        ${st.goals ? `<tr><td>Savings goals</td><td class="num">−${money(st.goals)}</td></tr>` : ''}
        <tr><td>Spent so far</td><td class="num">−${money(st.spent)}</td></tr></tbody></table></details>`
      : `<div class="huge muted" id="safeNum">—</div><p class="small muted">Enter your paycheck on the <b>Paycheck</b> tab to see this.</p>`}
    <div class="row" style="margin-top:.6rem"><button class="primary" data-act="goto" data-tab="spend">+ Add spending</button>
      ${syncOn() && y.connected ? `<button data-act="syncNow" id="homeSync">⟳ Sync now</button>` : ''}</div>
    ${y.url && y.connected && y.lastSync ? `<div class="small muted" style="margin-top:.3rem">Bank synced ${new Date(y.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>` : ''}
  </div>
  ${safe('Weekly check-in', () => { const c = dueCheckin(); return c ? `<div class="card" id="checkinCard"><div class="row"><h2 style="margin:0">Last week · ${fmtShort(c.ws)} – ${fmtShort(c.we)}</h2>
    <button class="mini" data-act="dismissCheckin" data-ws="${c.ws}" style="flex:0 0 auto">Got it</button></div>${checkinHTML(c)}</div>` : ''; })}
  ${y.loginRequired ? consentCardHTML() : ''}
  ${overs.map(o => `<div class="alert">⚠ <b>${h(o.c.name)}</b> is over budget by ${money(o.s - o.c.budget)} ${o.c.period === 'month' ? 'this month' : 'this week'}.</div>`).join('')}
  ${days != null && days >= 0 ? `<div class="card compact"><b>${h(wn)}</b> · ${fmtDate(wd)} — ${days === 0 ? 'today! 🎉' : `${days} day${days === 1 ? '' : 's'} to go`}</div>` : ''}
  ${rows.length ? `<div class="card compact"><h2>Budgets</h2>${budgetHTML(rows)}</div>` : ''}
  ${safe('Goals', () => S.goals.length ? `<div class="card compact" id="homeGoals"><h2>Goals</h2>${S.goals.map(g => { const gs = goalStatus(g), [m, mc, t, tc] = goalLines(gs); return `<div class="budget" data-goal="${g.id}">
    <div class="head"><span>${h(g.name || 'Untitled goal')}${g.date ? ` <span class="tag">${gs.past ? 'past date' : fmtShort(g.date)}</span>` : ''}</span><span class="amt">${money(gs.saved)}${gs.target ? ' / ' + money(gs.target) : ''}</span></div>
    ${gs.target ? `<div class="bar${gs.past ? ' over' : gs.behind > 0 ? ' warn' : ''}"><i style="width:${gs.pct.toFixed(1)}%"></i></div>` : ''}
    <div class="small ${mc}">${gs.noTarget ? 'Set a target in More → Savings goals' : gs.done || gs.past ? m : gs.weekly ? `${money(gs.weekly)}/week needed` : m}${t ? ` · <span class="${tc}">${gs.behind > 0 ? `behind by ${money(gs.behind)}` : 'on track'}</span>` : ''}</div></div>`; }).join('')}</div>` : '')}
  ${S.debts.length ? `<div class="card compact"><h2>Debts <span class="muted small">· ${money(debtLeft)} left</span></h2><ul class="list">${S.debts.map(d => { const ds = debtStatus(d); return `<li><div class="grow"><div class="t">${h(d.name)}${d.bank ? ' <span class="tag">bank</span>' : ''}</div>
      <div class="small muted">${d.bank && d.dueDate ? `Due ${fmtShort(d.dueDate)}${d.payment ? ' · min ' + money(d.payment) : ''}` : ds.projected ? 'Payoff ~' + fmtDate(ds.projected) : 'Enter balance & payment'}${ds.behind ? ' <span class="tag bad">past end date</span>' : ''}</div></div>
      <span class="amt">${money(ds.remaining)}</span></li>`; }).join('')}</ul></div>` : ''}`;
}

function viewPlan() {
  const latest = [...S.paychecks].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (ui.planPay == null && latest) { ui.planPay = latest.amount; ui.planDate = latest.date; }
  const pay = ui.planPay, date = ui.planDate || today();
  return `
  <div class="card"><h2>Paycheck</h2>
    <div class="grid2"><div><label for="payAmt">Amount (take-home)</label>
      <input id="payAmt" inputmode="decimal" placeholder="0.00" value="${pay ?? ''}" data-live="plan"></div>
      <div><label for="payDate">Pay date</label><input id="payDate" type="date" value="${h(date)}"></div></div>
    <div class="row" style="margin-top:.6rem"><button class="primary" data-act="savePay">Save paycheck</button></div>
    <label for="sPayKw">Paycheck keyword (optional)</label>
    <input id="sPayKw" data-set="paycheckKeyword" placeholder="e.g. payroll" value="${h(S.settings.paycheckKeyword || '')}" autocomplete="off">
    <p class="small muted">When an imported or bank-synced deposit's description contains this, that week's paycheck is filled in automatically (unless you already entered one).</p>
  </div>
  <div class="card" id="planOut">${planHTML(pay)}</div>
  <div class="card"><h2>Allocations</h2>
    <p class="small muted">Fixed $ per paycheck, or % of the paycheck. Bills and allocations come out first; whatever is left is your free spending money.</p>
    <details ${S.allocations.some(x => x.value != null) ? '' : 'open'}><summary>Edit ${S.allocations.length} allocations</summary>
    ${S.allocations.map(a => `<div class="editor-row" data-id="${a.id}">
      <div class="full"><label>Name</label><input data-edit="alloc" data-f="name" value="${h(a.name)}"></div>
      <div><label>Type</label><select data-edit="alloc" data-f="type">${opts([['fixed', 'Fixed $'], ['percent', '% of pay']], a.type)}</select></div>
      <div><label>${a.type === 'percent' ? 'Percent' : 'Amount'}</label><input data-edit="alloc" data-f="value" inputmode="decimal" placeholder="${a.type === 'percent' ? '%' : '0.00'}" value="${a.value ?? ''}"></div>
      <div><label>Category (for tracking)</label><select data-edit="alloc" data-f="categoryId">${catOpts(a.categoryId, 'None')}</select></div>
      <div style="align-self:end"><button class="mini danger" data-act="delAlloc">Remove</button></div></div>`).join('')}
    <button data-act="addAlloc" style="margin-top:.6rem">+ Add allocation</button></details></div>
  <div class="card"><h2>Bills (prorated weekly)</h2>
    <p class="small muted">Enter each bill at its real amount and frequency; the plan sets aside the weekly share (monthly × 12 ÷ 52).</p>
    ${S.bills.map(b => `<div class="editor-row" data-id="${b.id}">
      <div class="full"><label>Bill</label><input data-edit="bill" data-f="name" value="${h(b.name)}" placeholder="e.g. Phone"></div>
      <div><label>Amount</label><input data-edit="bill" data-f="amount" inputmode="decimal" placeholder="0.00" value="${b.amount ?? ''}"></div>
      <div><label>How often</label><select data-edit="bill" data-f="frequency">${opts(Object.entries(FREQS), b.frequency)}</select></div>
      <div><label>Due day (optional)</label><input data-edit="bill" data-f="dueDay" inputmode="numeric" placeholder="1–31" value="${h(b.dueDay ?? '')}"></div>
      <div style="align-self:end"><button class="mini danger" data-act="delBill">Remove</button></div></div>`).join('') || '<p class="muted small">No bills yet.</p>'}
    <button data-act="addBill" style="margin-top:.6rem">+ Add bill</button>
    <label class="row" style="margin-top:.8rem;color:var(--text)"><input type="checkbox" data-act="toggleDebts" ${S.settings.includeDebts ? 'checked' : ''} style="flex:0">
      <span>Also set aside debt payments (from the Debts tab)</span></label></div>
  <div class="card"><h2>Paycheck history</h2>
    ${S.paychecks.length ? `<ul class="list">${[...S.paychecks].sort((a, b) => b.date.localeCompare(a.date)).map(p => `<li data-id="${p.id}">
      <div class="grow">${fmtDate(p.date)}${p.auto ? ' <span class="tag">auto</span>' : ''}</div><span class="amt">${money(p.amount)}</span>
      <button class="mini" data-act="loadPay">View</button><button class="mini danger" data-act="delPay">✕</button></li>`).join('')}</ul>` : '<p class="muted small">None saved yet.</p>'}</div>`;
}
function planHTML(pay) {
  const p = computePlan(pay);
  const [ws, we] = periodRange('week', ui.planDate || today());
  return `<h2>Plan for this paycheck</h2>
  <table><tbody>
    <tr><td><b>Paycheck</b></td><td class="num"><b>${money(p.pay)}</b></td></tr>
    <tr><td>Bills &amp; debts set-aside<div class="small muted">${p.billLines.map(l => `${h(l.name)}: ${money(l.amt)}/wk <span>(${h(l.note)})</span>`).join('<br>') || 'none entered'}</div></td>
      <td class="num">−${money(p.billTotal)}</td></tr>
    ${p.allocLines.map(a => { const s = a.categoryId ? sum(S.transactions.filter(t => t.type !== 'income' && t.categoryId === a.categoryId && t.date >= ws && t.date <= we), t => t.amount) : null;
      return `<tr><td>${h(a.name)} <span class="tag">${a.type === 'percent' ? (a.value ?? 0) + '%' : 'fixed'}</span>
      ${s != null && a.amt > 0 ? `<div class="small ${s > a.amt ? 'bad' : 'muted'}">spent this week ${money(s)}${s > a.amt ? ' — over!' : ''}</div>` : ''}</td>
      <td class="num">−${money(a.amt)}</td></tr>`; }).join('')}
    <tr><td><b>Left over (free to spend)</b></td><td class="num"><b class="${p.left < 0 ? 'bad' : 'good'}">${money(p.left)}</b></td></tr>
  </tbody></table>
  ${p.left < 0 ? '<div class="alert">This plan spends more than the paycheck. Trim an allocation.</div>' : ''}`;
}

function viewSpend() {
  const e = ui.editTxn ? S.transactions.find(t => t.id === ui.editTxn) : null;
  const months = [...new Set([today().slice(0, 7), ...S.transactions.map(t => t.date.slice(0, 7))])].sort().reverse();
  const list = S.transactions.filter(t => t.date.startsWith(ui.txnMonth) && (!ui.txnCat || t.categoryId === ui.txnCat))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const out = sum(list.filter(t => t.type !== 'income'), t => t.amount), inc = sum(list.filter(t => t.type === 'income'), t => t.amount);
  const type = e?.type || ui.newType || 'expense';
  return `
  <div class="card" id="txnForm"><h2>${e ? 'Edit transaction' : 'Quick add'}</h2>
    <div class="seg" role="group"><button data-act="setType" data-type="expense" class="${type === 'expense' ? 'on' : ''}">Spent</button>
      <button data-act="setType" data-type="income" class="${type === 'income' ? 'on' : ''}">Received</button></div>
    <div class="grid2"><div><label for="tAmt">Amount</label><input id="tAmt" inputmode="decimal" placeholder="0.00" value="${e?.amount ?? ''}"></div>
      <div><label for="tDate">Date</label><input id="tDate" type="date" value="${h(e?.date || today())}"></div></div>
    <label for="tCat">Category</label><select id="tCat">${catOpts(e?.categoryId || ui.lastCat || S.categories[0]?.id)}</select>
    <label for="tNote">Note</label><input id="tNote" value="${h(e?.note || '')}" placeholder="e.g. Gas station" autocomplete="off">
    <div class="row" style="margin-top:.7rem"><button class="primary" data-act="saveTxn">${e ? 'Save changes' : 'Add'}</button>
      ${e ? '<button data-act="cancelEdit">Cancel</button>' : ''}</div></div>
  <div class="card"><h2>Budgets</h2>${budgetHTML(budgetRows())}</div>
  <div class="card"><h2>Transactions</h2>
    <div class="grid2"><select id="fMonth" aria-label="Month">${opts(months.map(m => [m, parseISO(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]), ui.txnMonth)}</select>
      <select id="fCat" aria-label="Category">${catOpts(ui.txnCat, 'All categories')}</select></div>
    <p class="small muted">Out: <b>${money(out)}</b> · In: <b>${money(inc)}</b> · ${list.length} item${list.length === 1 ? '' : 's'}</p>
    <ul class="list" id="txnList">${list.map(t => `<li data-id="${t.id}"><div class="grow"><div class="t">${h(t.note || catName(t.categoryId))}</div>
      <div class="small muted">${fmtShort(t.date)} · ${h(catName(t.categoryId))}${t.source === 'import' ? ' · imported' : t.source === 'bank' ? ' · bank' : ''}${t.pending ? ' <span class="tag">pending</span>' : ''}</div></div>
      <span class="amt ${t.type === 'income' ? 'good' : ''}">${t.type === 'income' ? '+' : ''}${money(t.amount)}</span>
      <button class="mini" data-act="editTxn" aria-label="Edit">✎</button><button class="mini danger" data-act="delTxn" aria-label="Delete">✕</button></li>`).join('') || '<li class="muted small">Nothing here yet.</li>'}</ul></div>`;
}

function consentCardHTML() {
  const y = S.sync;
  if (!(y.url && y.connected)) return '';
  if (y.loginRequired) return `<div class="card alert warn"><b>Your bank needs you to log in again.</b><br><span class="small">This reuses your existing connection.</span>
    <div class="row" style="margin-top:.5rem"><button class="primary" data-act="syncRelogin">Fix bank login</button></div></div>`;
  if (y.needsCardConsent) return `<div class="card" id="consentCard"><b>Show your credit card automatically?</b>
    <p class="small muted">Lets the app read your card's balance, minimum payment, due date and APR from ${h(y.institution || 'your bank')}. Uses your existing bank connection; no new connection is added.</p>
    <button class="primary" data-act="syncConsent">Allow card details</button></div>`;
  return '';
}
function viewDebts() {
  return consentCardHTML() + S.debts.map(d => {
    const st = debtStatus(d), b = d.bank;
    const pct = b ? (d.limit > 0 ? Math.min(100, (d.balance || 0) / d.limit * 100) : 0) : d.balance > 0 ? Math.min(100, st.paid / d.balance * 100) : 0;
    return `<div class="card" data-id="${d.id}">
      <div class="row"><h2 style="margin:0">${h(d.name)}${b ? ' <span class="tag">from bank</span>' : ''}</h2><div class="amt" style="text-align:right">${money(st.remaining)}<div class="small muted">${b ? 'balance' : 'remaining'}</div></div></div>
      <div class="bar ${b && pct > 80 ? 'warn' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
      ${b ? `<p class="small muted" style="margin:.3rem 0 0">${[d.limit ? `Limit ${money(d.limit)} · ${pct.toFixed(0)}% used` : '', d.apr != null ? `APR ${d.apr}%` : '',
        d.payment ? `Min ${money(d.payment)}` : '', d.dueDate ? `<b>Due ${fmtDate(d.dueDate)}</b>` : '', d.balanceAsOf ? `updated ${fmtShort(d.balanceAsOf)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      <p class="small">${st.remaining === 0 ? '<b class="good">Paid off! 🎉</b>' : st.neverPaysOff ? '<span class="bad">At this payment the interest outgrows it; it never pays off.</span>' : st.projected ? `Projected payoff: <b>${fmtDate(st.projected)}</b> (${st.periods} more payment${st.periods === 1 ? '' : 's'}${d.apr > 0 ? ', incl. interest' : ''})` : `<span class="muted">${b ? 'Minimum payment not available yet.' : 'Enter balance and payment amount to project payoff.'}</span>`}
      ${d.endDate ? `<br>Plan end date: ${fmtDate(d.endDate)} ${st.behind ? '<span class="tag bad">projection runs past end date</span>' : ''}` : ''}</p>
      <div class="row"><button class="primary" data-act="logPay">Log payment</button></div>
      ${ui.logDebt === d.id ? `<div style="margin-top:.6rem"><div class="grid2"><div><label>Amount</label><input id="dpAmt" inputmode="decimal" value="${d.payment ?? ''}"></div>
        <div><label>Date</label><input id="dpDate" type="date" value="${today()}"></div></div>
        <label class="row" style="color:var(--text)"><input type="checkbox" id="dpTxn" ${b ? '' : 'checked'} style="flex:0"><span>Also record as spending in <b>${h(catName(d.categoryId))}</b></span></label>
        <div class="row"><button class="primary" data-act="savePayment">Save payment</button><button data-act="cancelLog">Cancel</button></div></div>` : ''}
      <details><summary>Edit details</summary><div class="editor-row" data-id="${d.id}">
        <div class="full"><label>Name</label><input data-edit="debt" data-f="name" value="${h(d.name)}"></div>
        ${b ? `<div class="full small muted">Balance, minimum payment, due date and APR update from your bank on every sync.</div>
        ${b.source !== 'liabilities' ? `<div><label>Payment amount</label><input data-edit="debt" data-f="payment" inputmode="decimal" placeholder="0.00" value="${d.payment ?? ''}"></div>` : ''}` : `
        <div><label>Starting balance</label><input data-edit="debt" data-f="balance" inputmode="decimal" placeholder="0.00" value="${d.balance ?? ''}"></div>
        <div><label>Payment amount</label><input data-edit="debt" data-f="payment" inputmode="decimal" placeholder="0.00" value="${d.payment ?? ''}"></div>
        <div><label>Frequency</label><select data-edit="debt" data-f="frequency">${opts(Object.entries(FREQS), d.frequency)}</select></div>
        <div><label>End date (optional)</label><input type="date" data-edit="debt" data-f="endDate" value="${h(d.endDate || '')}"></div>
        <div><label>APR % (optional)</label><input data-edit="debt" data-f="apr" inputmode="decimal" placeholder="0" value="${d.apr ?? ''}"></div>`}
        <div><label>Spending category</label><select data-edit="debt" data-f="categoryId">${catOpts(d.categoryId, 'None')}</select></div>
        <div style="align-self:end"><button class="mini danger" data-act="delDebt">Delete debt</button></div></div></details>
      <details><summary>Payments (${d.payments.length}) · paid ${money(st.paid)}</summary>
        <ul class="list">${[...d.payments].sort((a, b) => b.date.localeCompare(a.date)).map(p => `<li data-pid="${p.id}"><div class="grow">${fmtDate(p.date)}</div>
          <span class="amt">${money(p.amount)}</span><button class="mini danger" data-act="delPayment">✕</button></li>`).join('') || '<li class="muted small">No payments logged.</li>'}</ul></details>
    </div>`;
  }).join('') + `<button class="primary" data-act="addDebt">+ Add debt</button>`;
}

function goalsHTML() {
  const txOpts = S.transactions.filter(t => { const c = catById(t.categoryId); return c && /transfer|saving/i.test(c.name) && t.date >= addDays(today(), -60)
    && !S.goals.some(g => g.contributions.some(x => x.txnId === t.id)); }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
  return `<div class="card" id="goalsCard"><h2>Savings goals</h2>
    <p class="small muted">Only money you log counts toward a goal: a starting amount, money you add here, or a transfer you pick. Nothing is counted automatically.</p>
    ${S.goals.map(g => { const gs = goalStatus(g), [m, mc, t, tc] = goalLines(gs), editing = ui.goalEdit === g.id;
      const hist = [...g.contributions].sort((a, b) => b.date.localeCompare(a.date));
      return `<div class="editor-row goal" data-id="${g.id}">
      <div class="full row"><b style="flex:1">${h(g.name || 'Untitled goal')}</b>${g.date ? `<span class="tag ${gs.past ? 'bad' : ''}">${gs.past ? 'past date · ' : 'by '}${fmtShort(g.date)}</span>` : ''}</div>
      <div class="full goal-amt"><span class="amt" style="font-size:1.25rem">${money(gs.saved)}</span>${gs.target ? ` <span class="muted">of ${money(gs.target)} · ${Math.floor(gs.pct)}%</span>` : ' <span class="muted">saved</span>'}</div>
      ${gs.target ? `<div class="full bar${gs.past ? ' over' : gs.behind > 0 ? ' warn' : ''}"><i style="width:${gs.pct.toFixed(1)}%"></i></div>` : ''}
      <div class="full small ${mc} goal-status">${m}</div>
      ${t ? `<div class="full small ${tc} goal-track">${t}</div>` : ''}
      ${g.review ? `<div class="full alert warn small goal-review">You logged ${money(g.target)} as saved, the same as the target. If you meant that as the goal amount (not money already saved), remove it.
        <div class="row" style="margin-top:.3rem"><button class="mini primary" data-act="reviewRemove">Remove it</button><button class="mini" data-act="reviewKeep">It's real money saved</button></div></div>` : ''}
      <div class="full row"><button class="mini primary" data-act="logContrib">+ Add money saved</button>${gs.noTarget ? '<button class="mini" data-act="editGoal" data-focus="target">Set a target</button>' : ''}<button class="mini" data-act="editGoal">${editing ? 'Close edit' : 'Edit'}</button></div>
      ${ui.goalLog === g.id ? `<div class="full goal-log"><div class="grid2"><div><label>Amount saved</label><input id="gcAmt" inputmode="decimal" placeholder="0.00"></div>
        <div><label>Date</label><input id="gcDate" type="date" value="${today()}"></div></div>
        <label>Note (optional)</label><input id="gcNote" placeholder="e.g. moved to savings">
        <label>…or link a transfer you already recorded (optional)</label><select id="gcTxn"><option value="">— none —</option>${txOpts.map(t => `<option value="${t.id}">${fmtShort(t.date)} · ${h(t.note || catName(t.categoryId))} · ${money(t.amount)}</option>`).join('')}</select>
        <div class="row" style="margin-top:.4rem"><button class="primary" data-act="saveContrib">Save</button><button data-act="cancelContrib">Cancel</button></div></div>` : ''}
      ${editing ? `<div class="full goal-edit"><div class="grid2"><div class="full" style="grid-column:1/-1"><label>Name</label><input data-edit="goal" data-f="name" value="${h(g.name)}" placeholder="e.g. Vacation"></div>
        <div><label>Target amount</label><input data-edit="goal" data-f="target" inputmode="decimal" placeholder="e.g. 3000" value="${g.target ?? ''}"></div>
        <div><label>Target date</label><input type="date" data-edit="goal" data-f="date" value="${h(g.date || '')}"></div>
        <div><label>Starting amount already saved</label><input data-edit="goal" data-f="startAmount" inputmode="decimal" placeholder="0.00" value="${g.startAmount || ''}"></div>
        <div><label>Started saving on</label><input type="date" data-edit="goal" data-f="startDate" value="${h(g.startDate || '')}"></div></div>
        <label class="row" style="color:var(--text)"><input type="checkbox" data-edit="goal" data-f="inSafe" ${g.inSafe ? 'checked' : ''} style="flex:0"><span>Set aside the weekly amount in Safe to spend</span></label>
        <div class="row" style="margin-top:.4rem"><button class="primary" data-act="editGoal">Done</button><button class="danger" data-act="delGoal">Delete goal</button></div></div>` : ''}
      <details class="full goal-hist" ${ui.goalHist === g.id ? 'open' : ''}><summary class="small">History · ${plural(g.contributions.length, 'contribution')}</summary>
        <ul class="list">${hist.map(c => `<li data-cid="${c.id}"><div class="grow small">${fmtDate(c.date)}${c.txnId ? ' <span class="tag">transfer</span>' : ''}${c.note ? ` · ${h(c.note)}` : ''}</div>
          <span class="amt">${money(c.amount)}</span><button class="mini danger" data-act="delContrib" aria-label="Remove">✕</button></li>`).join('')}
          ${gs.start ? `<li><div class="grow small muted">Starting amount${g.startDate ? ' · ' + fmtDate(g.startDate) : ''}</div><span class="amt">${money(gs.start)}</span></li>` : ''}
          ${!hist.length && !gs.start ? '<li class="small muted">Nothing logged yet.</li>' : ''}</ul></details></div>`; }).join('') || '<p class="muted small">No goals yet.</p>'}
    <button data-act="addGoal" style="margin-top:.6rem">+ Add goal</button></div>`;
}
function workHTML() {
  const ww = workWeeks(), a = S.settings.autoWork, ws0 = periodRange('week')[0];
  const order = Array.from({ length: 7 }, (_, i) => (S.settings.weekStart + i) % 7);
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(ws0, -7 * i));
  return `<div class="card" id="workCard"><details data-keep="workOpen" ${ui.workOpen ? 'open' : ''}><summary><span style="font-size:1.05rem">Work weeks</span>
    <span class="muted small">· ${ww.list.length ? `avg ${money(ww.avg)}/work week` : 'tag work-trip days'}</span></summary>
    <p class="small muted">Tap days you were on a work trip (or a whole week). Lodging, gas and food on those days are totaled per week.</p>
    ${weeks.map(ws => { const all = order.every((_, i) => S.work.days[addDays(ws, i)]); return `<div class="wk"><div class="row small"><span>${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}</span>
      <button class="mini" data-act="toggleWorkWeek" data-ws="${ws}" style="flex:0 0 auto">${all ? 'Clear week' : 'Whole week'}</button></div>
      <div class="chips">${order.map((dw, i) => { const d = addDays(ws, i), t = isWorkDay(d); return `<button class="chip ${t ? 'on ' + t : ''}" data-act="toggleWorkDay" data-date="${d}" title="${fmtDate(d)}">${DAYS[dw][0]}</button>`; }).join('')}</div></div>`; }).join('')}
    ${ww.list.length ? `<div class="scroll"><table id="workTable"><thead><tr><th>Week of</th><th class="num">Lodging</th><th class="num">Gas</th><th class="num">Food</th><th class="num">Total</th></tr></thead><tbody>
      ${ww.list.slice(0, 12).map(w => `<tr><td>${fmtShort(w.ws)} <span class="muted small">${w.days}d</span></td><td class="num">${money(w.lodging)}</td><td class="num">${money(w.gas)}</td><td class="num">${money(w.food)}</td><td class="num"><b>${money(w.total)}</b></td></tr>`).join('')}
      </tbody></table></div><p class="small">Average per work week: <b id="workAvg">${money(ww.avg)}</b> (${ww.list.length} week${ww.list.length === 1 ? '' : 's'})</p>` : ''}
    <details><summary class="small">Auto-tag work days</summary>
      <label class="row" style="color:var(--text)"><input type="checkbox" data-aw="on" ${a.on ? 'checked' : ''} style="flex:0"><span>Auto-tag a day when it has spending in these categories on these weekdays</span></label>
      <div class="chips">${DAYS.map((d, i) => `<label class="chip ${a.days.includes(i) ? 'on' : ''}"><input type="checkbox" data-aw="day" data-v="${i}" ${a.days.includes(i) ? 'checked' : ''} hidden>${d.slice(0, 3)}</label>`).join('')}</div>
      <div class="chips">${S.categories.filter(c => !c.income).map(c => `<label class="chip ${a.cats.includes(c.id) ? 'on' : ''}"><input type="checkbox" data-aw="cat" data-v="${c.id}" ${a.cats.includes(c.id) ? 'checked' : ''} hidden>${h(c.name)}</label>`).join('')}</div>
    </details></details></div>`;
}
function subsHTML() {
  const subs = detectSubs(), keep = subs.filter(x => x.status !== 'cancel');
  const cancel = subs.filter(x => x.status === 'cancel');
  return `<div class="card" id="subsCard"><details data-keep="subsOpen" ${ui.subsOpen ? 'open' : ''}><summary><span style="font-size:1.05rem">Subscriptions &amp; recurring</span>
    <span class="muted small">· ${money(sum(subs, x => x.monthly))}/mo</span></summary>
    <p class="small muted">Found from repeating charges (same merchant, steady amount, weekly/monthly/yearly) plus your listed bills. Marking one doesn't cancel anything; it's just a to-do list for you to cancel it yourself.</p>
    <p class="small">Total <b>${money(sum(subs, x => x.monthly))}/mo</b> (${money(sum(subs, x => x.yearly))}/yr)${cancel.length ? ` · Planning to cancel <b class="good" id="cancelSave">${money(sum(cancel, x => x.yearly))}/yr</b>` : ''}</p>
    <ul class="list" id="subsList">${subs.map(x => `<li data-key="${h(x.key)}"><div class="grow"><div class="t">${h(x.name)} <span class="tag">${x.source === 'bill' ? 'bill' : FREQS[x.cadence]?.toLowerCase()}</span>${x.status === 'cancel' ? ' <span class="tag bad">cancel</span>' : x.status === 'keep' ? ' <span class="tag">keep</span>' : ''}</div>
      <div class="small muted">${money(x.monthly)}/mo · ${money(x.yearly)}/yr${x.last ? ' · last ' + fmtShort(x.last) : ''}</div></div>
      <button class="mini" data-act="setSub" data-v="keep">Keep</button><button class="mini danger" data-act="setSub" data-v="cancel">Cancel</button></li>`).join('') || '<li class="muted small">Nothing recurring found yet. Needs at least 2 charges.</li>'}</ul>
    </details></div>`;
}
function checkinsHTML() {
  if (!S.checkins.length) return '';
  return `<div class="card" id="checkinHist"><details><summary><span style="font-size:1.05rem">Weekly check-ins</span> <span class="muted small">· ${S.checkins.length}</span></summary>
    ${S.checkins.map(c => `<details class="small"><summary style="font-weight:400">${fmtShort(c.ws)} – ${fmtShort(c.we)} · spent ${money(c.spent)}${c.budget ? ' of ' + money(c.budget) : ''}</summary>${checkinHTML(c, true)}</details>`).join('')}
    </details></div>`;
}
function viewMore() {
  return [['Account', accountHTML], ['Savings goals', goalsHTML], ['Work weeks', workHTML], ['Subscriptions', subsHTML], ['Weekly check-ins', checkinsHTML],
    ['Categories & settings', moreCoreHTML], ['Advanced', advancedHTML]].map(([l, f]) => safe(l, f)).join('');
}
function moreCoreHTML() {
  return `
  <div class="card"><h2>Categories &amp; budgets</h2>
    <p class="small muted">Leave budget blank for no limit. Weekly budgets reset on your week-start day.</p>
    <details ${ui.catsOpen ? 'open' : ''} data-keep="catsOpen"><summary>Edit ${S.categories.length} categories</summary>
    ${S.categories.map(c => `<div class="editor-row" data-id="${c.id}">
      <div class="full"><label>Name</label><input data-edit="cat" data-f="name" value="${h(c.name)}"></div>
      <div><label>Budget</label><input data-edit="cat" data-f="budget" inputmode="decimal" placeholder="none" value="${c.budget ?? ''}" ${c.income ? 'disabled' : ''}></div>
      <div><label>Per</label><select data-edit="cat" data-f="period" ${c.income ? 'disabled' : ''}>${opts([['week', 'Week'], ['month', 'Month']], c.period)}</select></div>
      <div class="full row"><label class="row" style="color:var(--text);flex:2"><input type="checkbox" data-edit="cat" data-f="income" ${c.income ? 'checked' : ''} style="flex:0"><span>Income category</span></label>
      <button class="mini danger" data-act="delCat" style="flex:0 0 auto">Delete</button></div></div>`).join('')}
    <button data-act="addCat" style="margin-top:.6rem">+ Add category</button></details></div>
  <div class="card"><h2>Settings</h2>
    <div class="grid2"><div><label for="sWeek">Week starts on</label><select id="sWeek" data-set="weekStart">${opts(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [i, d]), S.settings.weekStart)}</select></div>
      <div><label for="sTheme">Theme</label><select id="sTheme" data-set="theme">${opts([['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark'], ['charcoal', 'Charcoal'], ['matrix', 'Matrix']], S.settings.theme)}</select></div></div>
    <div class="grid2"><div><label for="sCdName">Countdown event name (optional)</label><input id="sCdName" data-set="countdownName" placeholder="e.g. Vacation" value="${h(S.settings.countdownName || '')}"></div>
      <div><label for="sCdDate">Countdown date (optional)</label><input id="sCdDate" type="date" data-set="countdownDate" value="${h(S.settings.countdownDate || '')}"></div></div>
    <p class="small muted">v2.1 · ${S.transactions.length} transactions stored on this device.</p></div>`;
}
function advancedHTML() {
  return `
  <div class="card"><details id="advanced" data-keep="advOpen" ${ui.advOpen || ui.imp ? 'open' : ''}><summary><span style="font-size:1.05rem">Advanced</span>
    <span class="muted small">· CSV import, rules, backup, bank sync</span></summary>
  <section class="adv"><h3>Import bank CSV</h3>
    <p class="small muted">Download transactions from your bank's online banking as CSV, then pick the file. The file is read on this device; the imported transactions are saved to your account.</p>
    <input type="file" id="csvFile" accept=".csv,text/csv,text/plain">
    <div id="impArea">${safe('CSV import', importHTML)}</div></section>
  <section class="adv"><h3>Auto-categorize rules</h3>
    <p class="small muted">If a bank description contains the keyword (not case sensitive), it gets that category. First match wins, top to bottom.</p>
    <div class="grid2"><input id="rKw" placeholder="keyword e.g. sheetz"><select id="rCat">${catOpts('')}</select></div>
    <button data-act="addRule" style="margin-top:.5rem">+ Add rule</button>
    <details><summary>${S.rules.length} rules</summary><ul class="list">${S.rules.map(r => `<li data-id="${r.id}"><div class="grow"><b>${h(r.keyword)}</b> → ${h(catName(r.categoryId))}</div>
      <button class="mini danger" data-act="delRule">✕</button></li>`).join('')}</ul></details></section>
  <section class="adv"><h3>Backup &amp; restore</h3>
    <p class="small muted">Your budget is saved to your account (encrypted) and cached on this device. You can also export a backup file any time.</p>
    <div class="row"><button class="primary" data-act="export">Export backup (JSON)</button></div>
    <label for="restoreFile">Restore from backup file</label><input type="file" id="restoreFile" accept=".json,application/json">
    <details><summary class="bad">Danger zone</summary><button class="danger" data-act="reset">Erase all data &amp; start over</button></details></section>
${safe('Bank sync', syncCardHTML)}
  </details></div>`;
}

/* ---------- CSV ---------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}
function parseDate(s, fmt) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let [, a, b, y] = m; if (y.length === 2) y = '20' + y;
    const [mo, d] = fmt === 'DMY' ? [b, a] : [a, b];
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${pad(+mo)}-${pad(+d)}`;
  }
  const t = Date.parse(s); return isNaN(t) ? null : iso(new Date(t));
}
function autoCat(desc) {
  const d = ' ' + String(desc).toLowerCase();
  for (const r of S.rules) {
    const k = r.keyword.toLowerCase(); if (!k) continue;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])' + esc).test(d) && catById(r.categoryId)) return r.categoryId;
  }
  return null;
}
const normDesc = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const dupKey = (date, amount, type, desc) => `${date}|${r2(amount).toFixed(2)}|${type}|${normDesc(desc)}`;
function guessMapping(header) {
  const find = re => header.findIndex(x => re.test(x));
  const debit = find(/debit|withdraw|money out/i), credit = find(/credit|deposit|money in/i);
  const amount = find(/^amount$|amount|amt/i);
  return {
    date: Math.max(0, find(/date/i)), desc: Math.max(0, find(/desc|memo|payee|name|detail/i)),
    mode: amount >= 0 || debit < 0 ? 'single' : 'split', amount: Math.max(0, amount), debit: Math.max(0, debit), credit: Math.max(0, credit),
    sign: 'negExpense', dateFmt: 'MDY', hasHeader: true
  };
}
function importHTML() {
  const im = ui.imp; if (!im) return '';
  const n = Math.max(...im.rows.map(r => r.length));
  const cols = Array.from({ length: n }, (_, i) => [i, `${i + 1}: ${im.m.hasHeader ? (im.rows[0][i] || '(blank)') : (im.rows[0][i] || '').slice(0, 24)}`]);
  const m = im.m;
  const sel = (f, label) => `<div><label>${label}</label><select data-map="${f}">${opts(cols, m[f])}</select></div>`;
  let html = `<p class="small"><b>${h(im.name)}</b> · ${im.rows.length} rows</p>
    <label class="row" style="color:var(--text)"><input type="checkbox" data-map="hasHeader" ${m.hasHeader ? 'checked' : ''} style="flex:0"><span>First row is column names</span></label>
    <div class="grid2">${sel('date', 'Date column')}${sel('desc', 'Description column')}
    <div><label>Amounts are in</label><select data-map="mode">${opts([['single', 'One amount column'], ['split', 'Separate debit / credit']], m.mode)}</select></div>
    <div><label>Date format</label><select data-map="dateFmt">${opts([['MDY', 'MM/DD/YYYY'], ['DMY', 'DD/MM/YYYY']], m.dateFmt)}</select></div>
    ${m.mode === 'single' ? sel('amount', 'Amount column') + `<div><label>Spending shows as</label><select data-map="sign">${opts([['negExpense', 'Negative (−)'], ['posExpense', 'Positive (+)']], m.sign)}</select></div>`
      : sel('debit', 'Debit (money out)') + sel('credit', 'Credit (money in)')}</div>
    <button class="primary" data-act="preview" style="margin-top:.7rem">Preview</button>`;
  if (im.preview) {
    const p = im.preview, sel2 = p.filter(x => x.on).length;
    html += `<h3>Preview</h3><p class="small muted">${p.length} transactions · ${p.filter(x => x.dup).length} duplicates (unchecked) · ${p.filter(x => !x.ok).length} unreadable rows skipped</p>
    <div class="scroll"><table id="impTable"><thead><tr><th></th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>
    ${p.filter(x => x.ok).map((x, i) => `<tr class="${x.dup ? 'dup' : ''}" data-i="${x.i}"><td><input type="checkbox" data-imp="on" ${x.on ? 'checked' : ''}></td>
      <td>${fmtShort(x.date)}</td><td>${h(x.desc)}${x.dup ? ' <span class="tag">duplicate</span>' : ''}</td>
      <td class="num ${x.type === 'income' ? 'good' : ''}">${x.type === 'income' ? '+' : ''}${money(x.amount)}</td>
      <td><select data-imp="cat">${catOpts(x.categoryId, '— pick —')}</select></td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:.7rem"><button class="primary" data-act="doImport" ${sel2 ? '' : 'disabled'}>Import ${sel2} selected</button>
      <button data-act="cancelImport">Cancel</button></div>`;
  }
  return html;
}
function buildPreview() {
  const im = ui.imp, m = im.m;
  const existing = new Set(S.transactions.map(t => dupKey(t.date, t.amount, t.type, t.importDesc ?? t.note)));
  const body = m.hasHeader ? im.rows.slice(1) : im.rows;
  im.preview = body.map((r, i) => {
    const date = parseDate(r[m.date], m.dateFmt), desc = r[m.desc] || '';
    let amt, type;
    if (m.mode === 'single') {
      const v = num(r[m.amount]); if (v == null || v === 0) return { i, ok: false };
      const out = m.sign === 'negExpense' ? v < 0 : v > 0;
      amt = Math.abs(v); type = out ? 'expense' : 'income';
    } else {
      const d = num(r[m.debit]), c = num(r[m.credit]);
      if (d) { amt = Math.abs(d); type = 'expense'; } else if (c) { amt = Math.abs(c); type = 'income'; } else return { i, ok: false };
    }
    if (!date) return { i, ok: false };
    let categoryId = autoCat(desc);
    if (!categoryId && type === 'income') categoryId = S.categories.find(c => c.income)?.id || null;
    const dup = existing.has(dupKey(date, amt, type, desc)) || S.transactions.some(t => t.plaidId && t.type === type && Math.abs(t.amount - amt) < 0.005 && Math.abs(dayDiff(t.date, date)) <= 3);
    return { i, ok: true, date, desc, amount: r2(amt), type, categoryId, dup, on: !dup };
  });
}
async function onCsvFile(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) { toast('That file looks empty.'); return; }
  const sig = rows[0].join('|').toLowerCase();
  const m = S.csvMappings[sig] ? { ...S.csvMappings[sig] } : guessMapping(rows[0]);
  ui.imp = { name: file.name, rows, sig, m, preview: null };
  if (S.csvMappings[sig]) buildPreview();
  $('#impArea').innerHTML = importHTML();
}
function doImport() {
  const im = ui.imp; const now = Date.now(); let n = 0;
  const fresh = [];
  im.preview.filter(x => x.ok && x.on).forEach(x => {
    const t = { id: uid(), date: x.date, amount: x.amount, type: x.type, categoryId: x.categoryId || S.categories.find(c => c.name === 'Other')?.id || '',
      note: x.desc, importDesc: x.desc, source: 'import', created: now + n++ };
    S.transactions.push(t); fresh.push(t);
  });
  S.csvMappings[im.sig] = { ...im.m };
  const made = autoPaychecks(fresh);
  save(); ui.imp = null; toast(`Imported ${n} transaction${n === 1 ? '' : 's'}${payToast(made)}`);
  render(); const f = $('#csvFile'); if (f) f.value = '';
}

const actions_sync = {};
/* ---------- bank sync (optional; only active when a Worker URL is set) ---------- */
const PLAID_JS = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
// Friends sign in with Google (or an invite code); no server URL or passcode. The old passcode setup still works under "Advanced".
const SYNC_URL_DEFAULT = 'https://budget-plaid-worker.bgwinn24.workers.dev';
const GOOGLE_CLIENT_ID = '849416882424-q9nn6ct6e348gvuh95cp3puulpol8tsi.apps.googleusercontent.com';   // public OAuth Web client ID
const GSI_JS = 'https://accounts.google.com/gsi/client';
const syncOn = () => !!S.sync.session;
const syncUrl = () => (S.sync.session ? '' : S.sync.url) || SYNC_URL_DEFAULT;
function syncCardHTML() {
  const y = S.sync, on = syncOn();
  return `<section class="adv" id="syncCard"><h3>Bank sync <span class="tag">optional</span></h3>
    <p class="small muted">Your bank login goes only to Plaid; this phone never stores bank credentials or access tokens.</p>
    ${on ? `<p><b>${y.connected ? `Connected${y.institution ? ' to ' + h(y.institution) : ''}` : 'Not connected'}</b></p><p class="small">${y.lastSync ? 'Last sync: ' + new Date(y.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never synced'}
      ${y.accounts?.length ? '<br>Accounts: ' + y.accounts.map(a => h(`${a.name || 'Account'}${a.mask ? ' ••' + a.mask : ''}`)).join(', ') : ''}</p>
      <div class="row">${y.connected ? `<button class="primary" data-act="syncNow">Sync now</button>${y.needsCardConsent ? '<button data-act="syncConsent">Allow card details</button>' : ''}${y.loginRequired ? '<button data-act="syncRelogin">Fix bank login</button>' : ''}<button class="danger" data-act="syncDisconnect">Disconnect</button>`
        : `<button class="primary" data-act="syncConnect">Connect your bank</button>`}</div>
      <p class="small muted" id="syncMsg"></p>` : ''}
    </section>`;
}
function loadScript(src) {
  return new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(sc); });
}
async function mountGoogle() {
  const el = $('#gsiBtn'); if (!el) return;
  if (GOOGLE_CLIENT_ID.startsWith('REPLACE')) { el.innerHTML = '<p class="small muted">Google sign-in is not set up yet.</p>'; return; }
  try {
    if (!window.google?.accounts?.id) await loadScript(GSI_JS);
    if (!mountGoogle.done) { google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential }); mountGoogle.done = true; }
    if (el.isConnected) google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: Math.min(el.clientWidth || 320, 400) });
  } catch { el.innerHTML = '<p class="small muted">Could not load Google sign-in. Are you online?</p>'; }
}
async function onGoogleCredential(resp) { await backendLogin('google-login', { credential: resp.credential }); }
document.addEventListener('submit', e => { if (e.target.id !== 'pwForm') return; e.preventDefault();
  const email = $('#pwEmail').value.trim(), password = $('#pwPass').value;
  if (ui.pwMode !== 'signin' && password.length < 8) return toast('Use at least 8 characters for your password.');
  if (ui.pwMode === 'signin') return backendLogin('login', { email, password });
  const invite = $('#pwInvite').value.trim(); if (!invite) return toast('Invite code required');
  backendLogin('register', { email, password, invite });
});
async function inviteLogin(code) { await backendLogin('invite-login', { code }); }
async function backendLogin(path, payload) {
  try {
    const r = await fetch(SYNC_URL_DEFAULT + '/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(() => { throw new Error('Could not reach the sync server. Are you online?'); });
    const d = await r.json().catch(() => ({}));
    if (d.code === 'INVITE_REQUIRED' && path === 'google-login') {   // new Google user: ask for the invite code, then retry
      const code = prompt(`${d.error}\n\nEnter your invite code to create your account:`, '');
      return code ? backendLogin(path, { ...payload, invite: code.trim() }) : undefined;
    }
    if (d.code === 'USE_FOR_SIGNUP') { ui.pwMode = 'create'; ui.invite = payload.code; render(); return toast(d.error); }
    if (!r.ok) throw new Error(d.error || 'Sign-in failed');
    await afterLogin(d); toast('Signed in');
  } catch (e) { toast(e.message); }
}
async function syncApi(path, body = {}) {
  const y = S.sync;
  if (!y.session && !y.key) { const b = crypto.getRandomValues(new Uint8Array(32)); y.key = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); save(); }
  let res;
  try {
    res = await fetch(syncUrl().replace(/\/+$/, '') + '/' + path, { method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(y.session ? { Authorization: 'Bearer ' + y.session } : { 'X-App-Passcode': y.passcode, 'X-Sync-Key': y.key }) } });
  } catch { throw Object.assign(new Error('Could not reach the sync server. Are you online?'), { code: 'NETWORK' }); }
  const data = await res.json().catch(() => ({}));
  if (data.code === 'SESSION_EXPIRED') { S.sync.session = ''; save(true); render(); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Sync server error ${res.status}`), { code: data.code, status: res.status });
  return data;
}
function loadPlaid() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = PLAID_JS;
    sc.onload = () => window.Plaid ? ok(window.Plaid) : bad(new Error('Plaid failed to load')); sc.onerror = () => bad(new Error('Could not load Plaid. Check your connection.'));
    document.head.appendChild(sc); });
}
function syncMsg(t) { const m = $('#syncMsg'); if (m) m.textContent = t; }
async function openLink(token, receivedRedirectUri, mode = 'new') {
  const Plaid = await loadPlaid();
  const handler = Plaid.create({ token, ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: async (publicToken, meta) => {
      sessionStorage.removeItem('plaidLinkToken'); sessionStorage.removeItem('plaidLinkMode');
      if (mode === 'update') {   // existing Item re-authorized / extra consent granted: nothing to exchange
        Object.assign(S.sync, { needsCardConsent: false, loginRequired: false }); save(); render(); await syncNow(); return;
      }
      try {
        const r = await syncApi('exchange', { public_token: publicToken, institution: meta?.institution?.name || null });
        Object.assign(S.sync, { connected: true, institution: r.institution, cursor: '' }); save(); render();
        await syncNow();
      } catch (e) { toast(e.message); }
    },
    onExit: err => { sessionStorage.removeItem('plaidLinkToken'); sessionStorage.removeItem('plaidLinkMode'); if (err) toast(err.display_message || err.error_message || 'Bank connection cancelled'); } });
  handler.open();
}
async function openUpdate(addLiabilities) {   // Link update mode on the existing Item (no new connection)
  try {
    const { link_token } = await syncApi('update-link-token', { add_liabilities: !!addLiabilities });
    sessionStorage.setItem('plaidLinkToken', link_token); sessionStorage.setItem('plaidLinkMode', 'update');
    await openLink(link_token, null, 'update');
  } catch (e) { toast(e.message); }
}
let syncing = false, loadingTries = 0;
async function syncNow(quiet) {
  if (syncing || !syncOn() || !S.sync.connected) return; syncing = true; syncMsg('Syncing…');
  const tot = { added: 0, matched: 0, updated: 0, removed: 0 }; const made = []; let loading = false;
  try {
    for (let i = 0; i < 20; i++) {
      const r = await syncApi('sync', { cursor: S.sync.cursor || '' });
      const c = applySync(r); for (const k in tot) tot[k] += c[k]; made.push(...c.paychecks);
      if (r.accounts?.length) S.sync.accounts = r.accounts;
      S.sync.cursor = r.next_cursor; save();            // cursor saved only after the batch is applied
      loading = ['NOT_READY', 'INITIAL_UPDATE_COMPLETE'].includes(r.update_status);   // Plaid still pulling history
      if (!r.has_more) break;
    }
    let cards = 0;
    try { cards = applyCards(await syncApi('liabilities')); }
    catch (e) { if (e.code === 'NOT_CONNECTED' || e.code === 'ITEM_LOGIN_REQUIRED') throw e; console.warn('card details unavailable', e.message); }
    S.sync.lastSync = new Date().toISOString(); S.sync.loginRequired = false; save(); render();
    if (loading && !tot.added) {   // first minutes after connecting: history not ready yet; check again automatically
      syncMsg('Your bank is still sending your transactions. This can take a few minutes; we will check again automatically.');
      if (!quiet) toast('Your bank is still sending your transactions (can take a few minutes). We will check again automatically.');
      if (loadingTries++ < 10) setTimeout(() => syncNow(true), 60000);
      return;
    }
    loadingTries = 0;
    if (!quiet || tot.added || made.length || cards) toast(`Bank sync: ${tot.added} new, ${tot.matched} matched, ${tot.updated} updated, ${tot.removed} removed${cards ? ` · ${cards} card${cards === 1 ? '' : 's'} added to Debts` : ''}${payToast(made)}`);
  } catch (e) {
    if (e.code === 'NOT_CONNECTED') { S.sync.connected = false; save(); render(); }
    if (e.code === 'ITEM_LOGIN_REQUIRED') { S.sync.loginRequired = true; save(); render(); }
    if (!quiet) toast(e.code === 'ITEM_LOGIN_REQUIRED' ? 'Your bank needs you to log in again. Tap "Fix bank login".' : e.message);
    syncMsg(e.message);
  } finally { syncing = false; }
}
/* Upsert one Debt per bank credit card. Manual debts are never touched; a card is never duplicated. Returns # of new cards. */
function applyCards(r) {
  let added = 0; const y = S.sync;
  const tcat = S.categories.find(c => /transfer/i.test(c.name))?.id || '';
  for (const c of r.cards || []) {
    if (!c?.account_id || (y.ignoredCards || []).includes(c.account_id)) continue;
    let d = S.debts.find(x => x.bank?.account_id === c.account_id)
      || S.debts.find(x => !x.bank && x.formerBank && x.formerBank.mask === c.mask && c.mask);   // relink after a reconnect
    if (!d) {
      d = { id: uid(), name: `${c.name || 'Credit card'}${c.mask ? ' ••' + c.mask : ''}`, balance: null, payment: null, frequency: 'monthly',
        endDate: '', categoryId: tcat, payments: [] };
      S.debts.push(d); added++;
    }
    d.bank = { account_id: c.account_id, mask: c.mask, source: r.source }; delete d.formerBank;
    if (c.balance_current != null) { d.balance = Math.max(0, r2(c.balance_current)); d.balanceAsOf = today(); }
    if (c.limit != null) d.limit = c.limit;
    if (r.source === 'liabilities') {
      d.payment = c.minimum_payment; d.frequency = 'monthly';
      d.apr = c.apr; d.dueDate = c.next_due_date; d.lastStatement = c.last_statement_balance; d.overdue = c.is_overdue;
    }
  }
  y.needsCardConsent = !!r.needs_consent;
  return added;
}
/* Merge a /sync response into S.transactions. Returns counts. Pure apart from mutating S. */
function applySync(r) {
  const n = { added: 0, matched: 0, updated: 0, removed: 0, touched: [] };
  const transferCat = S.categories.find(c => /transfer/i.test(c.name))?.id;
  const incomeCat = S.categories.find(c => c.income)?.id, otherCat = S.categories.find(c => c.name === 'Other')?.id || '';
  for (const b of [...(r.added || []), ...(r.modified || [])]) {
    if (!b || !b.transaction_id || !b.date || !b.amount) continue;
    const type = b.amount > 0 ? 'expense' : 'income', amount = r2(Math.abs(b.amount)), desc = b.name || b.merchant_name || '';
    // 1) same Plaid id, or the posted version of a pending one we already have
    let t = S.transactions.find(x => x.plaidId === b.transaction_id)
      || (b.pending_transaction_id && S.transactions.find(x => x.plaidId === b.pending_transaction_id));
    if (t) { Object.assign(t, { plaidId: b.transaction_id, date: b.date, amount, type, pending: !!b.pending }); if (t.source === 'bank') t.importDesc = desc; n.updated++; n.touched.push(t); continue; }
    // 2) soft match against manual / CSV / debt entries: same direction, same amount, within 3 days (closest wins)
    const cand = S.transactions.filter(x => !x.plaidId && x.type === type && Math.abs(x.amount - amount) < 0.005 && Math.abs(dayDiff(x.date, b.date)) <= 3)
      .sort((x, y) => Math.abs(dayDiff(x.date, b.date)) - Math.abs(dayDiff(y.date, b.date)))[0];
    if (cand) { cand.plaidId = b.transaction_id; cand.pending = !!b.pending; n.matched++; n.touched.push(cand); continue; }
    // 3) new
    const nt = { id: uid(), date: b.date, amount, type, pending: !!b.pending,
      categoryId: autoCat(`${desc} ${b.merchant_name || ''}`) || (/^(TRANSFER|LOAN_PAYMENTS)/.test(b.category || '') && transferCat) || (type === 'income' ? incomeCat : otherCat) || '',
      note: b.merchant_name || desc, importDesc: desc, source: 'bank', plaidId: b.transaction_id, created: Date.now() + n.added };
    S.transactions.push(nt); n.touched.push(nt); n.added++;
  }
  for (const x of r.removed || []) {
    const t = S.transactions.find(y => y.plaidId === x.transaction_id); if (!t) continue;
    if (t.source === 'bank') S.transactions = S.transactions.filter(y => y !== t);
    else { delete t.plaidId; delete t.pending; }   // never delete something you entered yourself
    n.removed++;
  }
  n.paychecks = autoPaychecks(n.touched);
  return n;
}
Object.assign(actions_sync, {
  syncConnect: async () => {
    try { syncMsg('Opening Plaid…'); const { link_token } = await syncApi('link-token');
      sessionStorage.setItem('plaidLinkToken', link_token); sessionStorage.setItem('plaidLinkMode', 'new'); await openLink(link_token); syncMsg(''); }
    catch (e) { toast(e.message); syncMsg(e.message); }
  },
  syncNow: () => syncNow(false),
  syncInvite: () => { const c = $('#syInvite').value.trim(); if (!c) return toast('Enter your invite code.'); inviteLogin(c); },
  pwToggle: () => { ui.pwMode = ui.pwMode === 'signin' ? 'create' : 'signin'; render(); },
  signOut: async () => {
    if (!confirm('Sign out? Your budget is removed from this device but stays saved in your account.')) return;
    if (cloud.dirty) { await cloudPush(); if (cloud.dirty && !confirm("Some changes haven't reached your account (offline?) and will be lost. Sign out anyway?")) return; }
    window.google?.accounts?.id?.disableAutoSelect();
    [KEY, CLOUD, COPY].forEach(k => localStorage.removeItem(k)); location.reload();
  },
  restoreCopy: () => { const c = JSON.parse(localStorage.getItem(COPY) || 'null'); if (!c || !confirm('Replace your current budget with the kept copy? (It will be saved to your account.)')) return;
    adopt(c.data, cloud.rev); localStorage.removeItem(COPY); save(); render(); toast('Copy restored'); },
  dropCopy: () => { if (confirm('Delete the kept copy?')) { localStorage.removeItem(COPY); render(); } },
  syncConsent: () => openUpdate(true),
  syncRelogin: () => openUpdate(false),
  syncDisconnect: async () => {
    if (!confirm('Disconnect your bank? Transactions already synced stay in the app.')) return;
    try { await syncApi('remove'); } catch (e) { if (e.code !== 'NOT_CONNECTED' && !confirm(`${e.message}\n\nForget the connection on this phone anyway?`)) return; }
    S.transactions.forEach(t => { delete t.plaidId; delete t.pending; });   // a reconnect gets new ids; soft-match will relink
    S.debts.forEach(d => { if (d.bank) { d.formerBank = { mask: d.bank.mask }; delete d.bank; } });   // cards become manual; relinked by last-4 on reconnect
    Object.assign(S.sync, { connected: false, institution: null, cursor: '', accounts: [], needsCardConsent: false, loginRequired: false, ignoredCards: [] }); save(); render(); toast('Bank disconnected');
  }
});

/* ---------- events ---------- */
const find = (arr, el) => arr.find(x => x.id === el.closest('[data-id]')?.dataset.id);
const actions = {
  goto: el => { tab = el.dataset.tab; render(); scrollTo(0, 0); },
  savePay: () => {
    const amount = num($('#payAmt').value), date = $('#payDate').value || today();
    if (!(amount > 0)) return toast('Enter the paycheck amount first.');
    const ws = weekStartOf(date, S.settings.weekStart), we = addDays(ws, 6);
    S.paychecks = S.paychecks.filter(p => !(p.auto && p.date >= ws && p.date <= we));   // manual entry wins
    const ex = S.paychecks.find(p => p.date === date);
    if (ex) { ex.amount = amount; delete ex.auto; delete ex.txnId; } else S.paychecks.push({ id: uid(), date, amount });
    ui.planPay = amount; ui.planDate = date; save(); render(); toast('Paycheck saved');
  },
  loadPay: el => { const p = find(S.paychecks, el); ui.planPay = p.amount; ui.planDate = p.date; render(); scrollTo(0, 0); },
  delPay: el => { const p = find(S.paychecks, el); if (confirm(`Delete paycheck from ${fmtDate(p.date)}?`)) { S.paychecks = S.paychecks.filter(x => x !== p); save(); render(); } },
  addAlloc: () => { S.allocations.push({ id: uid(), name: 'New allocation', type: 'fixed', value: null, categoryId: '' }); save(); render(); },
  delAlloc: el => { const a = find(S.allocations, el); if (confirm(`Remove "${a.name}"?`)) { S.allocations = S.allocations.filter(x => x !== a); save(); render(); } },
  addBill: () => { S.bills.push({ id: uid(), name: '', amount: null, frequency: 'monthly', dueDay: '' }); save(); render(); },
  delBill: el => { const b = find(S.bills, el); if (confirm(`Remove "${b.name || 'bill'}"?`)) { S.bills = S.bills.filter(x => x !== b); save(); render(); } },
  toggleDebts: el => { S.settings.includeDebts = el.checked; save(); render(); },
  setType: el => { ui.newType = el.dataset.type; const e = ui.editTxn && S.transactions.find(t => t.id === ui.editTxn); if (e) e.type = el.dataset.type;
    $$('[data-act=setType]').forEach(b => b.classList.toggle('on', b === el)); },
  saveTxn: () => {
    const amount = num($('#tAmt').value);
    if (!(amount > 0)) { toast('Enter an amount.'); $('#tAmt').focus(); return; }
    const t = { date: $('#tDate').value || today(), amount: r2(amount), categoryId: $('#tCat').value, note: $('#tNote').value.trim(),
      type: $('.seg .on')?.dataset.type || 'expense' };
    if (ui.editTxn) Object.assign(S.transactions.find(x => x.id === ui.editTxn), t);
    else S.transactions.push({ id: uid(), source: 'manual', created: Date.now(), ...t });
    ui.lastCat = t.categoryId; ui.txnMonth = t.date.slice(0, 7); ui.editTxn = null; ui.newType = null;
    save(); render(); toast('Saved');
    const over = budgetRows().find(r => r.c.id === t.categoryId && r.over);
    if (over && t.type !== 'income') toast(`⚠ ${over.c.name} is over budget by ${money(over.s - over.c.budget)}`);
  },
  editTxn: el => { ui.editTxn = el.closest('[data-id]').dataset.id; render(); scrollTo(0, 0); },
  cancelEdit: () => { ui.editTxn = null; render(); },
  delTxn: el => { const t = find(S.transactions, el); if (confirm(`Delete ${money(t.amount)} ${t.note || ''}?`)) { S.transactions = S.transactions.filter(x => x !== t); autoPaychecks([]); save(); render(); } },
  addDebt: () => { S.debts.push({ id: uid(), name: 'New debt', balance: null, payment: null, frequency: 'monthly', endDate: '', categoryId: '', payments: [] }); save(); render(); },
  delDebt: el => { const d = find(S.debts, el); if (confirm(`Delete "${d.name}" and its payment history?${d.bank ? ' It will not be re-added by bank sync.' : ''}`)) {
    if (d.bank) S.sync.ignoredCards = [...(S.sync.ignoredCards || []), d.bank.account_id];
    S.debts = S.debts.filter(x => x !== d); save(); render(); } },
  logPay: el => { ui.logDebt = el.closest('[data-id]').dataset.id; render(); },
  cancelLog: () => { ui.logDebt = null; render(); },
  savePayment: el => {
    const d = find(S.debts, el), amount = num($('#dpAmt').value), date = $('#dpDate').value || today();
    if (!(amount > 0)) return toast('Enter the payment amount.');
    const p = { id: uid(), date, amount: r2(amount) };
    if ($('#dpTxn').checked) { const tid = uid(); p.txnId = tid;
      S.transactions.push({ id: tid, date, amount: p.amount, type: 'expense', categoryId: d.categoryId || '', note: d.name + ' payment', source: 'debt', created: Date.now() }); }
    d.payments.push(p); ui.logDebt = null; save(); render(); toast('Payment logged');
  },
  delPayment: el => {
    const d = find(S.debts, el), pid = el.closest('[data-pid]').dataset.pid, p = d.payments.find(x => x.id === pid);
    if (!confirm(`Delete ${money(p.amount)} payment?`)) return;
    d.payments = d.payments.filter(x => x !== p);
    if (p.txnId && confirm('Also delete the matching spending entry?')) S.transactions = S.transactions.filter(t => t.id !== p.txnId);
    save(); render();
  },
  addCat: () => { S.categories.push({ id: uid(), name: 'New category', budget: null, period: 'week' }); save(); render(); },
  delCat: el => {
    const c = find(S.categories, el), used = S.transactions.filter(t => t.categoryId === c.id).length;
    if (!confirm(`Delete "${c.name}"?${used ? ` ${used} transactions will become Uncategorized.` : ''}`)) return;
    S.categories = S.categories.filter(x => x !== c); S.rules = S.rules.filter(r => r.categoryId !== c.id); save(); render();
  },
  addRule: () => { const k = $('#rKw').value.trim(); if (!k) return toast('Type a keyword.');
    S.rules.unshift({ id: uid(), keyword: k.toLowerCase(), categoryId: $('#rCat').value }); save(); render(); toast('Rule added'); },
  delRule: el => { S.rules = S.rules.filter(r => r.id !== el.closest('[data-id]').dataset.id); save(); render(); },
  preview: () => { buildPreview(); $('#impArea').innerHTML = importHTML(); },
  doImport, cancelImport: () => { ui.imp = null; $('#impArea').innerHTML = ''; $('#csvFile').value = ''; },
  export: () => download(`budget-backup-${today()}.json`, JSON.stringify({ app: 'budget-app', exported: new Date().toISOString(), data: { ...S, sync: { ...S.sync, passcode: '', session: '' } } }, null, 2), 'application/json'),
  ...actions_sync,
  addGoal: () => { const g = { id: uid(), name: 'New goal', target: null, date: '', startAmount: 0, startDate: today(), inSafe: true, contributions: [] };
    S.goals.push(g); ui.goalEdit = g.id; save(); render(); $(`.goal[data-id="${g.id}"] [data-f=name]`)?.select(); },
  editGoal: el => { const id = el.closest('[data-id]').dataset.id, f = el.dataset.focus; ui.goalEdit = ui.goalEdit === id && !f ? null : id; ui.goalLog = null; render();
    if (f) $(`.goal[data-id="${id}"] [data-f=${f}]`)?.focus(); },
  delGoal: el => { const g = find(S.goals, el); if (confirm(`Delete goal "${g.name || 'Untitled goal'}" and its history?`)) { S.goals = S.goals.filter(x => x !== g); ui.goalEdit = null; save(); render(); } },
  logContrib: el => { ui.goalLog = el.closest('[data-id]').dataset.id; ui.goalEdit = null; render(); $('#gcAmt')?.focus(); },
  cancelContrib: () => { ui.goalLog = null; render(); },
  saveContrib: el => {
    const g = find(S.goals, el), tid = $('#gcTxn').value, t = tid && S.transactions.find(x => x.id === tid), typed = num($('#gcAmt').value);
    const amount = typed > 0 ? typed : t ? t.amount : typed, date = t && !(typed > 0) ? t.date : ($('#gcDate').value || today()), note = $('#gcNote').value.trim();
    if (!(amount > 0)) return toast('Enter an amount or pick a transfer.');
    const cur = goalStatus(g);   // guard the old mix-up: typing the goal amount here instead of under Edit
    if (cur.saved === 0 && g.target > 0 && amount >= g.target && !confirm(`Log ${money(amount)} as money already saved? That marks "${g.name || 'this goal'}" as reached. (To change the goal amount, use Edit.)`)) return;
    g.contributions.push({ id: uid(), date, amount: r2(amount), ...(t ? { txnId: t.id } : {}), ...(note ? { note } : {}) });
    ui.goalLog = null; ui.goalHist = g.id; save(); render(); toast(`Added ${money(amount)} to ${g.name || 'goal'}`);
  },
  delContrib: el => { const g = find(S.goals, el), cid = el.closest('[data-cid]').dataset.cid, c = g.contributions.find(x => x.id === cid);
    if (!confirm(`Remove ${money(c.amount)} (${fmtDate(c.date)}) from ${g.name || 'this goal'}?`)) return;
    g.contributions = g.contributions.filter(x => x !== c); ui.goalHist = g.id; save(); render(); },
  reviewRemove: el => { const g = find(S.goals, el), i = g.contributions.findIndex(c => !c.txnId && Math.abs(c.amount - g.target) < 0.005);
    if (i >= 0) g.contributions.splice(i, 1); delete g.review; save(); render(); toast('Removed. Log real savings with “+ Add money saved”.'); },
  reviewKeep: el => { delete find(S.goals, el).review; save(); render(); },
  toggleWorkDay: el => { const d = el.dataset.date; if (S.work.days[d]) delete S.work.days[d]; else S.work.days[d] = true; save(); render(); },
  toggleWorkWeek: el => { const ws = el.dataset.ws, ds = Array.from({ length: 7 }, (_, i) => addDays(ws, i)), all = ds.every(d => S.work.days[d]);
    ds.forEach(d => { if (all) delete S.work.days[d]; else S.work.days[d] = true; }); save(); render(); },
  dismissCheckin: el => { const c = weekSummary(el.dataset.ws); S.checkins.unshift({ ...c, dismissed: new Date().toISOString() }); S.checkins = S.checkins.slice(0, 104); save(); render(); },
  setSub: el => { const k = el.closest('[data-key]').dataset.key, v = el.dataset.v; if (S.subStatus[k] === v) delete S.subStatus[k]; else S.subStatus[k] = v; save(); render(); },
  reset: () => { if (confirm('Erase ALL budget data on this device? Export a backup first!') && confirm('Really erase everything?')) { const dev = Object.fromEntries(DEVICE.map(k => [k, S.sync[k]])); S = defaults(); Object.assign(S.sync, dev); save(); ui.imp = null; render(); toast('Reset done'); } }
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (t && t.closest('.tabs')) { tab = t.dataset.tab; ui.editTxn = null; render(); scrollTo(0, 0); return; }
  const a = e.target.closest('[data-act]'); if (a && actions[a.dataset.act] && a.type !== 'checkbox') { e.preventDefault(); actions[a.dataset.act](a); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.act === 'toggleDebts') return actions.toggleDebts(el);
  if (el.id === 'fMonth') { ui.txnMonth = el.value; return render(); }
  if (el.id === 'fCat') { ui.txnCat = el.value; return render(); }
  if (el.id === 'csvFile') return onCsvFile(el.files[0]);
  if (el.id === 'restoreFile') return restore(el.files[0]);
  if (el.dataset.aw) {
    const a = S.settings.autoWork, v = el.dataset.v;
    if (el.dataset.aw === 'on') a.on = el.checked;
    else { const key = el.dataset.aw === 'day' ? 'days' : 'cats', val = el.dataset.aw === 'day' ? +v : v;
      a[key] = el.checked ? [...new Set([...a[key], val])] : a[key].filter(x => x !== val); }
    save(); return render();
  }
  if (el.dataset.set) { S.settings[el.dataset.set] = el.dataset.set === 'weekStart' ? +el.value : el.value; save(); return render(); }
  if (el.dataset.map) { ui.imp.m[el.dataset.map] = el.type === 'checkbox' ? el.checked : ['date', 'desc', 'amount', 'debit', 'credit'].includes(el.dataset.map) ? +el.value : el.value;
    if (ui.imp.preview) buildPreview(); $('#impArea').innerHTML = importHTML(); return; }
  if (el.dataset.imp) { const x = ui.imp.preview.find(p => p.i === +el.closest('tr').dataset.i);
    if (el.dataset.imp === 'on') x.on = el.checked; else x.categoryId = el.value; $('#impArea').innerHTML = importHTML(); return; }
  if (el.dataset.edit) {
    const coll = { alloc: S.allocations, bill: S.bills, debt: S.debts, cat: S.categories, goal: S.goals }[el.dataset.edit];
    const item = find(coll, el), f = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.edit === 'goal' && ['target', 'startAmount'].includes(f)) {   // strict: "3k" must not silently become 3
      const t = String(v).trim();
      if (t && !/^\$?\s*(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(t)) { toast('Enter a plain number, e.g. 3000'); el.value = item[f] || ''; return; }
      v = num(t); item[f] = f === 'startAmount' ? (v > 0 ? r2(v) : 0) : (v > 0 ? r2(v) : null); delete item.review; save(); return render();
    }
    if (['value', 'amount', 'balance', 'payment', 'budget', 'apr', 'target'].includes(f)) { v = num(v); if (v != null && v < 0) v = Math.abs(v); }
    item[f] = v; save();
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') render();
    else { ui.dirty = true; if ($('#planOut')) $('#planOut').innerHTML = planHTML(ui.planPay); }
  }
});
// Re-render after text edits only once focus leaves the form fields, so tapping the next field on a phone isn't interrupted.
document.addEventListener('toggle', e => { const k = e.target.dataset?.keep; if (k) ui[k] = e.target.open;
  if (e.target.classList?.contains('goal-hist')) { const id = e.target.closest('[data-id]').dataset.id; if (e.target.open) ui.goalHist = id; else if (ui.goalHist === id) ui.goalHist = null; } }, true);
document.addEventListener('focusout', () => setTimeout(() => {
  if (ui.dirty && !document.activeElement?.matches('#view input, #view select')) { ui.dirty = false; render(); }
}, 0));
document.addEventListener('input', e => { if (e.target.dataset.live === 'plan') { ui.planPay = num(e.target.value); $('#planOut').innerHTML = planHTML(ui.planPay); } });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('#txnForm') && e.target.tagName === 'INPUT') actions.saveTxn(); });

async function restore(file) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text()); const d = j.data || j;
    if (!Array.isArray(d.categories) || !Array.isArray(d.transactions)) throw new Error('Not a budget backup');
    if (!confirm(`Replace current data with backup (${d.transactions.length} transactions${j.exported ? ', from ' + new Date(j.exported).toLocaleDateString() : ''})?`)) return;
    const def = defaults(), pc = S.sync?.passcode || '', ses = { session: S.sync?.session || '', label: S.sync?.label || '' }; S = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) }, sync: { ...blankSync(), ...(d.sync || {}) } }; if (!S.sync.passcode) S.sync.passcode = pc; if (!S.sync.session) Object.assign(S.sync, ses); migrate(); save(); render(); toast('Backup restored');
  } catch (err) { alert('Could not restore: ' + err.message); }
}

/* ---------- boot ---------- */
if (S.sync.session && !cloud.user) { S.sync.session = ''; save(true); }   // v2.7 bank-only login: sign in again once
render();
cloudSync();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudSync(); else cloudPush(); });
addEventListener('online', cloudSync);
const net = () => $('#offline').classList.toggle('hidden', navigator.onLine);
addEventListener('online', net); addEventListener('offline', net); net();
if ('serviceWorker' in navigator) {
  // Check for a new version on load and whenever the app comes back to the foreground; offer a one-tap reload when it takes over.
  const hadController = !!navigator.serviceWorker.controller; let reloading = false;
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('SW', err)));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || $('#updateBar')) return;
    const bar = document.createElement('div'); bar.id = 'updateBar'; bar.className = 'updatebar';
    bar.innerHTML = 'A new version is ready. <button class="mini primary">Reload</button>';
    bar.querySelector('button').onclick = () => { reloading = true; location.reload(); };
    document.body.appendChild(bar);
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// Resume Plaid Link after an OAuth bank redirect, then auto-sync at most every 6 hours when connected.
if (syncOn() && /[?&]oauth_state_id=/.test(location.search) && sessionStorage.getItem('plaidLinkToken')) {
  const href = location.href; history.replaceState(null, '', location.pathname);
  openLink(sessionStorage.getItem('plaidLinkToken'), href, sessionStorage.getItem('plaidLinkMode') || 'new').catch(e => toast(e.message));
} else if (syncOn() && S.sync.connected && navigator.onLine && (!S.sync.lastSync || Date.now() - Date.parse(S.sync.lastSync) > 6 * 3600e3)) {
  setTimeout(() => syncNow(true), 1500);
}
window.__budget = { get state() { return S; }, get cloud() { return cloud; }, goalStatus, workWeeks, weekSummary, dueCheckin, detectSubs, merchKey, parseCSV, parseDate, autoCat, computePlan, debtStatus, applySync, applyCards, safeToSpend };
