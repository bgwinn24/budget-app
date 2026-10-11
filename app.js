/* Budget — v1. Vanilla JS, all data in localStorage on this device. */
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
    cat('Other', 'week'), cat('Income', 'week', { income: true })];
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
    settings: { weekStart: 1, theme: 'auto', includeDebts: true, countdownDate: '', countdownName: '' },
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
    sync: blankSync()
  };
}
const blankSync = () => ({ url: '', passcode: '', key: '', cursor: '', connected: false, institution: null, lastSync: null, accounts: [] });
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = defaults(), s = JSON.parse(raw); return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) }, sync: { ...blankSync(), ...(s.sync || {}) } }; }
  } catch (e) { console.error(e); }
  return defaults();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert('Could not save — device storage may be full. Export a backup now.'); }
}
const catById = id => S.categories.find(c => c.id === id);
const catName = id => catById(id)?.name || 'Uncategorized';
const catOpts = (sel, withBlank) => (withBlank ? `<option value="">${h(withBlank)}</option>` : '') + opts(S.categories.map(c => [c.id, c.name]), sel);

/* ---------- calculations ---------- */
function debtStatus(d) {
  const paid = sum(d.payments, p => p.amount);
  const remaining = d.balance == null ? null : Math.max(0, r2(d.balance - paid));
  let projected = null, periods = null;
  if (remaining === 0) projected = d.payments.length ? d.payments.map(p => p.date).sort().at(-1) : today();
  else if (remaining && d.payment > 0) {
    periods = Math.ceil(remaining / d.payment - 1e-9);
    const last = d.payments.map(p => p.date).sort().at(-1);
    projected = addPeriods(last || today(), last ? periods : periods - 1, d.frequency);
  }
  const behind = projected && d.endDate && remaining > 0 && projected > d.endDate;
  return { paid, remaining, projected, periods, behind };
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

/* ---------- views ---------- */
let tab = 'home';
const ui = { editTxn: null, txnMonth: today().slice(0, 7), txnCat: '', planPay: null, planDate: null, imp: null, logDebt: null };

function render() {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.documentElement.dataset.theme = S.settings.theme === 'auto' ? '' : S.settings.theme;
  if (S.settings.theme === 'auto') delete document.documentElement.dataset.theme;
  $('#view').innerHTML = { home: viewHome, plan: viewPlan, spend: viewSpend, debts: viewDebts, more: viewMore }[tab]();
  $('#title').textContent = { home: 'Budget', plan: 'Paycheck plan', spend: 'Spending', debts: 'Debts', more: 'More' }[tab];
}

function viewHome() {
  const wd = S.settings.countdownDate, wn = S.settings.countdownName || 'Countdown';
  const days = wd ? Math.round((parseISO(wd) - parseISO(today())) / 864e5) : null;
  const pc = [...S.paychecks].sort((a, b) => b.date.localeCompare(a.date))[0];
  const plan = pc ? computePlan(pc.amount) : null;
  const rows = budgetRows(); const overs = rows.filter(r => r.over);
  const [ws, we] = periodRange('week');
  const weekSpent = sum(S.transactions.filter(t => t.type !== 'income' && t.date >= ws && t.date <= we), t => t.amount);
  const debtLeft = sum(S.debts, d => debtStatus(d).remaining);
  return `
  ${days != null && days >= 0 ? `<div class="card"><div class="row"><div><div class="muted small">${h(wn)} · ${fmtDate(wd)}</div>
    <div class="big">${days === 0 ? 'Today! 🎉' : `${days} day${days === 1 ? '' : 's'} to go`}</div></div></div></div>` : ''}
  ${overs.map(o => `<div class="alert">⚠ <b>${h(o.c.name)}</b> is over budget by ${money(o.s - o.c.budget)} ${o.c.period === 'month' ? 'this month' : 'this week'}.</div>`).join('')}
  <div class="card"><h2>This week <span class="muted small">(${fmtShort(ws)} – ${fmtShort(we)})</span></h2>
    <div class="grid2"><div><div class="muted small">Spent</div><div class="big">${money(weekSpent)}</div></div>
    <div><div class="muted small">Last paycheck</div><div class="big">${pc ? money(pc.amount) : '—'}</div>
    ${pc ? `<div class="small muted">${fmtDate(pc.date)}</div>` : ''}</div></div>
    ${plan ? `<p>Left to spend after plan: <b class="${plan.left < 0 ? 'bad' : 'good'}">${money(plan.left)}</b></p>`
      : `<p class="muted small">Enter your paycheck on the <b>Paycheck</b> tab to see your weekly plan.</p>`}
    <button class="primary" data-act="goto" data-tab="spend">+ Add a transaction</button></div>
  <div class="card"><h2>Budgets</h2>${budgetHTML(rows)}</div>
  <div class="card"><h2>Debts</h2>
    ${S.debts.length ? `<ul class="list">${S.debts.map(d => { const st = debtStatus(d); return `<li><div class="grow"><div class="t">${h(d.name)}</div>
      <div class="small muted">${st.projected ? 'Payoff ~' + fmtDate(st.projected) : 'Enter balance & payment'}${st.behind ? ' <span class="tag bad">past end date</span>' : ''}</div></div>
      <span class="amt">${money(st.remaining)}</span></li>`; }).join('')}</ul>
      <p class="small muted">Total remaining: <b>${money(debtLeft)}</b></p>` : '<p class="muted small">No debts listed.</p>'}</div>`;
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
      <div class="grow">${fmtDate(p.date)}</div><span class="amt">${money(p.amount)}</span>
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

function viewDebts() {
  return S.debts.map(d => {
    const st = debtStatus(d);
    const pct = d.balance > 0 ? Math.min(100, st.paid / d.balance * 100) : 0;
    return `<div class="card" data-id="${d.id}">
      <div class="row"><h2 style="margin:0">${h(d.name)}</h2><div class="amt" style="text-align:right">${money(st.remaining)}<div class="small muted">remaining</div></div></div>
      <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <p class="small">${st.remaining === 0 ? '<b class="good">Paid off! 🎉</b>' : st.projected ? `Projected payoff: <b>${fmtDate(st.projected)}</b> (${st.periods} more payment${st.periods === 1 ? '' : 's'})` : '<span class="muted">Enter balance and payment amount to project payoff.</span>'}
      ${d.endDate ? `<br>Plan end date: ${fmtDate(d.endDate)} ${st.behind ? '<span class="tag bad">projection runs past end date</span>' : ''}` : ''}</p>
      <div class="row"><button class="primary" data-act="logPay">Log payment</button></div>
      ${ui.logDebt === d.id ? `<div style="margin-top:.6rem"><div class="grid2"><div><label>Amount</label><input id="dpAmt" inputmode="decimal" value="${d.payment ?? ''}"></div>
        <div><label>Date</label><input id="dpDate" type="date" value="${today()}"></div></div>
        <label class="row" style="color:var(--text)"><input type="checkbox" id="dpTxn" checked style="flex:0"><span>Also record as spending in <b>${h(catName(d.categoryId))}</b></span></label>
        <div class="row"><button class="primary" data-act="savePayment">Save payment</button><button data-act="cancelLog">Cancel</button></div></div>` : ''}
      <details><summary>Edit details</summary><div class="editor-row" data-id="${d.id}">
        <div class="full"><label>Name</label><input data-edit="debt" data-f="name" value="${h(d.name)}"></div>
        <div><label>Starting balance</label><input data-edit="debt" data-f="balance" inputmode="decimal" placeholder="0.00" value="${d.balance ?? ''}"></div>
        <div><label>Payment amount</label><input data-edit="debt" data-f="payment" inputmode="decimal" placeholder="0.00" value="${d.payment ?? ''}"></div>
        <div><label>Frequency</label><select data-edit="debt" data-f="frequency">${opts(Object.entries(FREQS), d.frequency)}</select></div>
        <div><label>End date (optional)</label><input type="date" data-edit="debt" data-f="endDate" value="${h(d.endDate || '')}"></div>
        <div><label>Spending category</label><select data-edit="debt" data-f="categoryId">${catOpts(d.categoryId, 'None')}</select></div>
        <div style="align-self:end"><button class="mini danger" data-act="delDebt">Delete debt</button></div></div></details>
      <details><summary>Payments (${d.payments.length}) · paid ${money(st.paid)}</summary>
        <ul class="list">${[...d.payments].sort((a, b) => b.date.localeCompare(a.date)).map(p => `<li data-pid="${p.id}"><div class="grow">${fmtDate(p.date)}</div>
          <span class="amt">${money(p.amount)}</span><button class="mini danger" data-act="delPayment">✕</button></li>`).join('') || '<li class="muted small">No payments logged.</li>'}</ul></details>
    </div>`;
  }).join('') + `<button class="primary" data-act="addDebt">+ Add debt</button>`;
}

function viewMore() {
  return `
  <div class="card"><h2>Import bank CSV</h2>
    <p class="small muted">Download transactions from your bank's online banking as CSV, then pick the file. Nothing leaves your phone.</p>
    <input type="file" id="csvFile" accept=".csv,text/csv,text/plain">
    <div id="impArea">${importHTML()}</div></div>
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
  <div class="card"><h2>Auto-categorize rules</h2>
    <p class="small muted">If a bank description contains the keyword (not case sensitive), it gets that category. First match wins, top to bottom.</p>
    <div class="grid2"><input id="rKw" placeholder="keyword e.g. sheetz"><select id="rCat">${catOpts('')}</select></div>
    <button data-act="addRule" style="margin-top:.5rem">+ Add rule</button>
    <details><summary>${S.rules.length} rules</summary><ul class="list">${S.rules.map(r => `<li data-id="${r.id}"><div class="grow"><b>${h(r.keyword)}</b> → ${h(catName(r.categoryId))}</div>
      <button class="mini danger" data-act="delRule">✕</button></li>`).join('')}</ul></details></div>
  <div class="card"><h2>Backup &amp; restore</h2>
    <p class="small muted">Your data lives only in this browser on this phone. Export a backup regularly (e.g. to Google Drive) — clearing browser data or uninstalling deletes it.</p>
    <div class="row"><button class="primary" data-act="export">Export backup (JSON)</button></div>
    <label for="restoreFile">Restore from backup file</label><input type="file" id="restoreFile" accept=".json,application/json">
    <details><summary class="bad">Danger zone</summary><button class="danger" data-act="reset">Erase all data &amp; start over</button></details></div>
${syncCardHTML()}
  <div class="card"><h2>Settings</h2>
    <div class="grid2"><div><label for="sWeek">Week starts on</label><select id="sWeek" data-set="weekStart">${opts(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [i, d]), S.settings.weekStart)}</select></div>
      <div><label for="sTheme">Theme</label><select id="sTheme" data-set="theme">${opts([['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']], S.settings.theme)}</select></div></div>
    <div class="grid2"><div><label for="sCdName">Countdown event name (optional)</label><input id="sCdName" data-set="countdownName" placeholder="e.g. Vacation" value="${h(S.settings.countdownName || '')}"></div>
      <div><label for="sCdDate">Countdown date (optional)</label><input id="sCdDate" type="date" data-set="countdownDate" value="${h(S.settings.countdownDate || '')}"></div></div>
    <p class="small muted">v1.0 · ${S.transactions.length} transactions stored on this device.</p></div>`;
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
  im.preview.filter(x => x.ok && x.on).forEach(x => {
    S.transactions.push({ id: uid(), date: x.date, amount: x.amount, type: x.type, categoryId: x.categoryId || S.categories.find(c => c.name === 'Other')?.id || '',
      note: x.desc, importDesc: x.desc, source: 'import', created: now + n++ });
  });
  S.csvMappings[im.sig] = { ...im.m };
  save(); ui.imp = null; toast(`Imported ${n} transaction${n === 1 ? '' : 's'}`);
  render(); const f = $('#csvFile'); if (f) f.value = '';
}

const actions_sync = {};
/* ---------- bank sync (optional; only active when a Worker URL is set) ---------- */
const PLAID_JS = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
const syncOn = () => !!S.sync.url;
function syncCardHTML() {
  const y = S.sync, on = syncOn();
  return `<div class="card" id="syncCard"><h2>Bank sync <span class="tag">optional</span></h2>
    <details ${on ? 'open' : ''}><summary>${on ? (y.connected ? `Connected${y.institution ? ' to ' + h(y.institution) : ''}` : 'Not connected') : 'Set up automatic bank sync (advanced)'}</summary>
    <p class="small muted">Uses your own sync server (a free Cloudflare Worker) and Plaid. Your bank login goes only to Plaid; this phone never stores bank credentials or access tokens.</p>
    <label for="syUrl">Sync server URL</label><input id="syUrl" type="url" inputmode="url" placeholder="https://….workers.dev" value="${h(y.url)}" autocomplete="off">
    <label for="syPass">App passcode</label><input id="syPass" type="password" value="${h(y.passcode)}" autocomplete="off">
    <div class="row" style="margin-top:.6rem"><button data-act="syncSave">Save</button></div>
    ${on ? `<p class="small">${y.lastSync ? 'Last sync: ' + new Date(y.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never synced'}
      ${y.accounts?.length ? '<br>Accounts: ' + y.accounts.map(a => h(`${a.name || 'Account'}${a.mask ? ' ••' + a.mask : ''}`)).join(', ') : ''}</p>
      <div class="row">${y.connected ? `<button class="primary" data-act="syncNow">Sync now</button><button class="danger" data-act="syncDisconnect">Disconnect</button>`
        : `<button class="primary" data-act="syncConnect">Connect bank</button>`}</div>
      <p class="small muted" id="syncMsg"></p>` : ''}
    </details></div>`;
}
async function syncApi(path, body = {}) {
  const y = S.sync;
  if (!y.key) { const b = crypto.getRandomValues(new Uint8Array(32)); y.key = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); save(); }
  let res;
  try {
    res = await fetch(y.url.replace(/\/+$/, '') + '/' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': y.passcode, 'X-Sync-Key': y.key }, body: JSON.stringify(body) });
  } catch { throw Object.assign(new Error('Could not reach the sync server. Are you online?'), { code: 'NETWORK' }); }
  const data = await res.json().catch(() => ({}));
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
async function openLink(token, receivedRedirectUri) {
  const Plaid = await loadPlaid();
  const handler = Plaid.create({ token, ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: async (publicToken, meta) => {
      sessionStorage.removeItem('plaidLinkToken');
      try {
        const r = await syncApi('exchange', { public_token: publicToken, institution: meta?.institution?.name || null });
        Object.assign(S.sync, { connected: true, institution: r.institution, cursor: '' }); save(); render();
        await syncNow();
      } catch (e) { toast(e.message); }
    },
    onExit: err => { sessionStorage.removeItem('plaidLinkToken'); if (err) toast(err.display_message || err.error_message || 'Bank connection cancelled'); } });
  handler.open();
}
let syncing = false;
async function syncNow(quiet) {
  if (syncing || !syncOn() || !S.sync.connected) return; syncing = true; syncMsg('Syncing…');
  const tot = { added: 0, matched: 0, updated: 0, removed: 0 };
  try {
    for (let i = 0; i < 20; i++) {
      const r = await syncApi('sync', { cursor: S.sync.cursor || '' });
      const c = applySync(r); for (const k in tot) tot[k] += c[k];
      if (r.accounts?.length) S.sync.accounts = r.accounts;
      S.sync.cursor = r.next_cursor; save();            // cursor saved only after the batch is applied
      if (!r.has_more) break;
    }
    S.sync.lastSync = new Date().toISOString(); save(); render();
    if (!quiet || tot.added) toast(`Bank sync: ${tot.added} new, ${tot.matched} matched, ${tot.updated} updated, ${tot.removed} removed`);
  } catch (e) {
    if (e.code === 'NOT_CONNECTED') { S.sync.connected = false; save(); render(); }
    if (!quiet) toast(e.code === 'ITEM_LOGIN_REQUIRED' ? 'Your bank needs you to log in again: Disconnect, then Connect bank.' : e.message);
    syncMsg(e.message);
  } finally { syncing = false; }
}
/* Merge a /sync response into S.transactions. Returns counts. Pure apart from mutating S. */
function applySync(r) {
  const n = { added: 0, matched: 0, updated: 0, removed: 0 };
  const incomeCat = S.categories.find(c => c.income)?.id, otherCat = S.categories.find(c => c.name === 'Other')?.id || '';
  for (const b of [...(r.added || []), ...(r.modified || [])]) {
    if (!b || !b.transaction_id || !b.date || !b.amount) continue;
    const type = b.amount > 0 ? 'expense' : 'income', amount = r2(Math.abs(b.amount)), desc = b.name || b.merchant_name || '';
    // 1) same Plaid id, or the posted version of a pending one we already have
    let t = S.transactions.find(x => x.plaidId === b.transaction_id)
      || (b.pending_transaction_id && S.transactions.find(x => x.plaidId === b.pending_transaction_id));
    if (t) { Object.assign(t, { plaidId: b.transaction_id, date: b.date, amount, type, pending: !!b.pending }); if (t.source === 'bank') t.importDesc = desc; n.updated++; continue; }
    // 2) soft match against manual / CSV / debt entries: same direction, same amount, within 3 days (closest wins)
    const cand = S.transactions.filter(x => !x.plaidId && x.type === type && Math.abs(x.amount - amount) < 0.005 && Math.abs(dayDiff(x.date, b.date)) <= 3)
      .sort((x, y) => Math.abs(dayDiff(x.date, b.date)) - Math.abs(dayDiff(y.date, b.date)))[0];
    if (cand) { cand.plaidId = b.transaction_id; cand.pending = !!b.pending; n.matched++; continue; }
    // 3) new
    S.transactions.push({ id: uid(), date: b.date, amount, type, pending: !!b.pending,
      categoryId: autoCat(`${desc} ${b.merchant_name || ''}`) || (type === 'income' ? incomeCat : otherCat) || '',
      note: b.merchant_name || desc, importDesc: desc, source: 'bank', plaidId: b.transaction_id, created: Date.now() + n.added });
    n.added++;
  }
  for (const x of r.removed || []) {
    const t = S.transactions.find(y => y.plaidId === x.transaction_id); if (!t) continue;
    if (t.source === 'bank') S.transactions = S.transactions.filter(y => y !== t);
    else { delete t.plaidId; delete t.pending; }   // never delete something you entered yourself
    n.removed++;
  }
  return n;
}
Object.assign(actions_sync, {
  syncSave: () => {
    const url = $('#syUrl').value.trim(), pass = $('#syPass').value;
    if (url && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) return toast('The sync server URL must start with https://');
    const changed = url !== S.sync.url;
    S.sync.url = url; S.sync.passcode = pass;
    if (changed) Object.assign(S.sync, { connected: false, institution: null, cursor: '', accounts: [] });
    save(); render();
    if (url) syncApi('status').then(st => { Object.assign(S.sync, { connected: st.connected, institution: st.institution }); save(); render(); toast(st.connected ? 'Connected' : 'Sync server OK'); })
      .catch(e => { toast(e.message); syncMsg(e.message); });
  },
  syncConnect: async () => {
    try { syncMsg('Opening Plaid…'); const { link_token } = await syncApi('link-token');
      sessionStorage.setItem('plaidLinkToken', link_token); await openLink(link_token); syncMsg(''); }
    catch (e) { toast(e.message); syncMsg(e.message); }
  },
  syncNow: () => syncNow(false),
  syncDisconnect: async () => {
    if (!confirm('Disconnect your bank? Transactions already synced stay in the app.')) return;
    try { await syncApi('remove'); } catch (e) { if (e.code !== 'NOT_CONNECTED' && !confirm(`${e.message}\n\nForget the connection on this phone anyway?`)) return; }
    S.transactions.forEach(t => { delete t.plaidId; delete t.pending; });   // a reconnect gets new ids; soft-match will relink
    Object.assign(S.sync, { connected: false, institution: null, cursor: '', accounts: [] }); save(); render(); toast('Bank disconnected');
  }
});

/* ---------- events ---------- */
const find = (arr, el) => arr.find(x => x.id === el.closest('[data-id]')?.dataset.id);
const actions = {
  goto: el => { tab = el.dataset.tab; render(); scrollTo(0, 0); },
  savePay: () => {
    const amount = num($('#payAmt').value), date = $('#payDate').value || today();
    if (!(amount > 0)) return toast('Enter the paycheck amount first.');
    const ex = S.paychecks.find(p => p.date === date);
    if (ex) ex.amount = amount; else S.paychecks.push({ id: uid(), date, amount });
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
  delTxn: el => { const t = find(S.transactions, el); if (confirm(`Delete ${money(t.amount)} ${t.note || ''}?`)) { S.transactions = S.transactions.filter(x => x !== t); save(); render(); } },
  addDebt: () => { S.debts.push({ id: uid(), name: 'New debt', balance: null, payment: null, frequency: 'monthly', endDate: '', categoryId: '', payments: [] }); save(); render(); },
  delDebt: el => { const d = find(S.debts, el); if (confirm(`Delete "${d.name}" and its payment history?`)) { S.debts = S.debts.filter(x => x !== d); save(); render(); } },
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
  export: () => download(`budget-backup-${today()}.json`, JSON.stringify({ app: 'budget-app', exported: new Date().toISOString(), data: { ...S, sync: { ...S.sync, passcode: '' } } }, null, 2), 'application/json'),
  ...actions_sync,
  reset: () => { if (confirm('Erase ALL budget data on this device? Export a backup first!') && confirm('Really erase everything?')) { S = defaults(); save(); ui.imp = null; render(); toast('Reset done'); } }
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
  if (el.dataset.set) { S.settings[el.dataset.set] = el.dataset.set === 'weekStart' ? +el.value : el.value; save(); return render(); }
  if (el.dataset.map) { ui.imp.m[el.dataset.map] = el.type === 'checkbox' ? el.checked : ['date', 'desc', 'amount', 'debit', 'credit'].includes(el.dataset.map) ? +el.value : el.value;
    if (ui.imp.preview) buildPreview(); $('#impArea').innerHTML = importHTML(); return; }
  if (el.dataset.imp) { const x = ui.imp.preview.find(p => p.i === +el.closest('tr').dataset.i);
    if (el.dataset.imp === 'on') x.on = el.checked; else x.categoryId = el.value; $('#impArea').innerHTML = importHTML(); return; }
  if (el.dataset.edit) {
    const coll = { alloc: S.allocations, bill: S.bills, debt: S.debts, cat: S.categories }[el.dataset.edit];
    const item = find(coll, el), f = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['value', 'amount', 'balance', 'payment', 'budget'].includes(f)) { v = num(v); if (v != null && v < 0) v = Math.abs(v); }
    item[f] = v; save();
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') render();
    else { ui.dirty = true; if ($('#planOut')) $('#planOut').innerHTML = planHTML(ui.planPay); }
  }
});
// Re-render after text edits only once focus leaves the form fields, so tapping the next field on a phone isn't interrupted.
document.addEventListener('toggle', e => { const k = e.target.dataset?.keep; if (k) ui[k] = e.target.open; }, true);
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
    const def = defaults(), pc = S.sync?.passcode || ''; S = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) }, sync: { ...blankSync(), ...(d.sync || {}) } }; if (!S.sync.passcode) S.sync.passcode = pc; save(); render(); toast('Backup restored');
  } catch (err) { alert('Could not restore: ' + err.message); }
}

/* ---------- boot ---------- */
render();
const net = () => $('#offline').classList.toggle('hidden', navigator.onLine);
addEventListener('online', net); addEventListener('offline', net); net();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err)));
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// Resume Plaid Link after an OAuth bank redirect, then auto-sync at most every 6 hours when connected.
if (syncOn() && /[?&]oauth_state_id=/.test(location.search) && sessionStorage.getItem('plaidLinkToken')) {
  const href = location.href; history.replaceState(null, '', location.pathname);
  openLink(sessionStorage.getItem('plaidLinkToken'), href).catch(e => toast(e.message));
} else if (syncOn() && S.sync.connected && navigator.onLine && (!S.sync.lastSync || Date.now() - Date.parse(S.sync.lastSync) > 6 * 3600e3)) {
  setTimeout(() => syncNow(true), 1500);
}
window.__budget = { get state() { return S; }, parseCSV, parseDate, autoCat, computePlan, debtStatus, applySync };
