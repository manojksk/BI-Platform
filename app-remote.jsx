const { useState, useEffect, useMemo } = React;

const displayFont = { fontFamily: "'Fraunces', Georgia, serif" };
const inputCls = "w-full border border-stone-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400";

/* ---------------- server API storage layer ---------------- */
// Table name -> URL path segment used by the server's REST API.
const TABLE_PATH = {
  customers: 'customers',
  staff: 'staff',
  services: 'services',
  bills: 'bills',
  membershipPlans: 'membership-plans',
  offerCodes: 'offer-codes',
  outreachLog: 'outreach-log',
  enquiries: 'enquiries',
  appointments: 'appointments',
  attendance: 'attendance',
  roster: 'roster',
  makeupBookings: 'makeup-bookings',
  stockEntries: 'stock-entries',
  pnlLiabilities: 'pnl-liabilities',
  expenses: 'expenses',
  payrollRecords: 'payroll-records',
};

let authToken = null; // kept in memory only, never written to browser storage

class AuthError extends Error {}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers['X-Auth-Token'] = authToken;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) throw new AuthError('Session expired');
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchBootstrapStatus() {
  return apiFetch('/api/bootstrap-status');
}
async function apiSetup(username, password) {
  const out = await apiFetch('/api/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
  authToken = out.token;
  return out;
}
async function apiLogin(username, password) {
  const out = await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  authToken = out.token;
  return out;
}
async function apiLogout() {
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch (e) {}
  authToken = null;
}
async function apiAddUser(username, password) {
  return apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ username, password }) });
}
async function fetchAll() {
  return apiFetch('/api/all');
}
async function fetchPnlIncome(month) {
  return apiFetch(`/api/pnl?month=${encodeURIComponent(month)}`);
}
async function apiUpdateSettings(patch) {
  return apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
}
async function apiBackupNow() {
  return apiFetch('/api/backup', { method: 'POST' });
}

// Compares the previous and next array for one table and issues only the
// create/update/delete calls actually needed, so UI code can keep calling
// save*(wholeNewArray) exactly like before with no changes at call sites.
async function diffAndSync(table, oldArr, newArr) {
  const path = TABLE_PATH[table];
  const oldById = {}; oldArr.forEach(r => { oldById[r.id] = r; });
  const newById = {}; newArr.forEach(r => { newById[r.id] = r; });
  const serverUpdates = [];
  for (const r of newArr) {
    if (!oldById[r.id]) {
      const created = await apiFetch(`/api/${path}`, { method: 'POST', body: JSON.stringify(r) });
      if (created) serverUpdates.push(created);
    } else if (JSON.stringify(oldById[r.id]) !== JSON.stringify(r)) {
      await apiFetch(`/api/${path}/${r.id}`, { method: 'PUT', body: JSON.stringify(r) });
    }
  }
  for (const r of oldArr) {
    if (!newById[r.id]) {
      await apiFetch(`/api/${path}/${r.id}`, { method: 'DELETE' });
    }
  }
  return serverUpdates;
}

/* ---------------- date & format helpers ---------------- */
function localDateStr(d) {
  // Extracts the LOCAL calendar date directly (no UTC conversion) -- toISOString()
  // converts through UTC first, which silently shifts the date by a day in any
  // timezone ahead of UTC (like IST, UTC+5:30). This is the safe way to turn a
  // Date into a 'YYYY-MM-DD' string that matches what the person actually sees.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayISO() { return localDateStr(new Date()); }
function nowISO() { return new Date().toISOString(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); if (isNaN(dt)) return '—'; return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(d) { if (!d) return '—'; const dt = new Date(d); if (isNaN(dt)) return '—'; return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtINR(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
function startOfWeek(d) { const dt = new Date(d); const day = dt.getDay(); const diff = (day === 0 ? -6 : 1 - day); const monday = new Date(dt); monday.setDate(dt.getDate() + diff); monday.setHours(0, 0, 0, 0); return monday; }
function endOfWeek(d) { const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999); return e; }
function diffMinutes(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return null;
  const sp = startHHMM.split(':').map(Number);
  const ep = endHHMM.split(':').map(Number);
  if (sp.length < 2 || ep.length < 2) return null;
  let mins = (ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
function calcOT(minutesWorked, standardMinutes = 540, otRatePerHour = 50, minOtMinutes = 30) {
  const otMin = Math.max(0, minutesWorked - standardMinutes);
  if (otMin < minOtMinutes) return { otMinutes: otMin, otPay: 0 };
  return { otMinutes: otMin, otPay: Math.round((otMin / 60) * otRatePerHour) };
}
function calcIncentive(netSales, dailyTarget, incentivePercent) {
  return netSales >= (dailyTarget || 0) ? Math.round(netSales * ((incentivePercent || 0) / 100)) : 0;
}
function staffNetSalesForDate(bills, staffId, dateStr) {
  let total = 0;
  bills.forEach(b => {
    if ((b.date || '').slice(0, 10) !== dateStr) return;
    (b.items || []).forEach(it => {
      if (itemStaffId(it, b) === staffId) total += itemNetRevenue(it, b);
    });
    if (b.items && b.items.length && itemStaffId(b.items[0], b) === staffId) {
      total += (b.productAmount || 0) + (b.makeupAdvance || 0);
    }
  });
  return total;
}

/* ---------------- business logic helpers ---------------- */
function getAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
function getAgeBracket(dob) {
  const age = getAge(dob);
  if (age === null) return 'Unknown';
  if (age < 25) return 'Under 25';
  if (age < 40) return '25–39';
  if (age < 55) return '40–54';
  return '55+';
}
function isPremiumBill(bill, servicesById) {
  return bill.items.some(it => servicesById[it.serviceId] && servicesById[it.serviceId].category === 'Premium');
}
function itemStaffId(item, bill) { return item.staffId || bill.staffId || ''; }

// ---- Dashboard color palette: existing brand (stone/amber) stays for the shell;
// this curated set is used specifically for Dashboard data visualization ----
const DASH_GOLD = '#B45309';
const DASH_CORAL = '#E11D48';
const DASH_TEAL = '#0D9488';
const DASH_VIOLET = '#7C3AED';
const DASH_SKY = '#0284C7';
const DASH_SOURCE_COLORS = { 'In-Salon': DASH_TEAL, 'Phone': DASH_SKY, 'Whatsapp': DASH_GOLD, 'JustDial': DASH_VIOLET, 'Instagram': DASH_CORAL };

function dashCardStyle(hex) {
  return { background: `linear-gradient(135deg, ${hex}22, ${hex}0d)`, borderColor: hex + '40' };
}
const DASH_CARD = 'rounded-2xl border p-5';

function DashAreaChart({ data, height = 170, color = DASH_GOLD }) {
  const width = 600;
  const max = Math.max(...data.map(d => d.value), 1);
  const stepX = width / (data.length - 1 || 1);
  const points = data.map((d, i) => [i * stepX, height - (d.value / max) * (height - 24) - 10]);
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${width},${height} L0,${height} Z`;
  const gradId = 'dashgrad-' + color.replace('#', '');
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="white" stroke={color} strokeWidth="2.5" />)}
    </svg>
  );
}

function DashDonut({ segments, size = 108, strokeWidth = 15 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f5f5f4" strokeWidth={strokeWidth} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circumference;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={seg.color} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

function DashHBar({ label, value, max, color }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-stone-600 font-medium">{label}</span>
        <span className="text-stone-500">{fmtINR(value)}</span>
      </div>
      <div className="w-full bg-white/60 rounded-full h-2.5">
        <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
      </div>
    </div>
  );
}

function DashStatChip({ icon, label, value, color }) {
  return (
    <div className="rounded-xl border p-3 flex items-center gap-3" style={{ background: `linear-gradient(135deg, ${color}20, ${color}0c)`, borderColor: color + '35' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: color + '30' }}>{icon}</div>
      <div>
        <div className="text-lg leading-tight" style={displayFont}>{value}</div>
        <div className="text-xs text-stone-500">{label}</div>
      </div>
    </div>
  );
}


function itemNetRevenue(item, bill) {
  const discountPercent = Number(bill.discountPercent) || 0;
  return (Number(item.price) || 0) * (1 - discountPercent / 100);
}
function customerStats(customerId, bills) {
  const cb = bills.filter(b => b.customerId === customerId);
  const totalSpend = cb.reduce((s, b) => s + (b.total || 0), 0);
  const totalVisits = cb.length;
  const lastVisit = cb.length ? cb.map(b => b.date).sort().slice(-1)[0] : null;
  return { totalSpend, totalVisits, lastVisit };
}
function calcBillTotals(items, discountPercent) {
  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const discountAmount = subtotal * ((Number(discountPercent) || 0) / 100);
  const total = Math.max(0, subtotal - discountAmount);
  return { subtotal, discountAmount, total };
}
function computeStaffMetrics(bills, staffId, start, end, servicesById) {
  const inRange = bills.filter(b => new Date(b.date) >= start && new Date(b.date) <= end);
  const myItems = []; // { bill, item } pairs where THIS staff did the item
  inRange.forEach(b => (b.items || []).forEach(it => {
    if (itemStaffId(it, b) === staffId) myItems.push({ bill: b, item: it });
  }));
  const revenue = myItems.reduce((s, { bill, item }) => s + itemNetRevenue(item, bill), 0);
  const uniqueCustomers = new Set(myItems.map(({ bill }) => bill.customerId)).size;
  const billIdsForStaff = new Set(myItems.map(({ bill }) => bill.id)); // bills where this staff did >=1 item
  const totalBills = billIdsForStaff.size;
  const abv = totalBills ? revenue / totalBills : 0;
  const premiumBillIds = new Set(myItems.filter(({ item }) => servicesById[item.serviceId] && servicesById[item.serviceId].category === 'Premium').map(({ bill }) => bill.id));
  const premiumConversion = totalBills ? (premiumBillIds.size / totalBills * 100) : 0;
  let totalMins = 0, itemCount = 0, standardMinsTotal = 0;
  myItems.forEach(({ item: it }) => {
    if (typeof it.durationMins === 'number') { totalMins += it.durationMins; itemCount++; }
    const svc = servicesById[it.serviceId];
    if (svc) standardMinsTotal += (svc.standardMins || 0);
  });
  const avgServiceMins = itemCount ? totalMins / itemCount : 0;
  const avgStandardMins = itemCount ? standardMinsTotal / itemCount : 0;
  return { staffId, revenue, uniqueCustomers, totalBills, abv, premiumConversion, avgServiceMins, avgStandardMins, itemCount };
}
function computeServiceStats(bills, services) {
  const map = {};
  services.forEach(s => { map[s.id] = { service: s, revenue: 0, count: 0, totalMins: 0 }; });
  bills.forEach(b => (b.items || []).forEach(it => {
    if (!map[it.serviceId]) return;
    map[it.serviceId].revenue += (it.price || 0);
    map[it.serviceId].count += 1;
    map[it.serviceId].totalMins += (it.durationMins || 0);
  }));
  return Object.values(map).map(m => ({ ...m, avgMins: m.count ? m.totalMins / m.count : 0 })).sort((a, b) => b.revenue - a.revenue);
}
function computeAgeBracketStats(bills, customers, servicesById) {
  const brackets = ['Under 25', '25–39', '40–54', '55+', 'Unknown'];
  const map = {};
  brackets.forEach(b => { map[b] = { bracket: b, revenue: 0, bills: 0, premiumBills: 0 }; });
  const custById = {};
  customers.forEach(c => { custById[c.id] = c; });
  bills.forEach(b => {
    const cust = custById[b.customerId];
    const bracket = cust ? getAgeBracket(cust.dob) : 'Unknown';
    map[bracket].revenue += (b.total || 0);
    map[bracket].bills += 1;
    if (isPremiumBill(b, servicesById)) map[bracket].premiumBills += 1;
  });
  return brackets.map(b => ({ ...map[b], premiumPct: map[b].bills ? (map[b].premiumBills / map[b].bills * 100) : 0 }));
}
function computeInactive(customers, bills, thresholdDays) {
  return customers.map(c => {
    const cbills = bills.filter(b => b.customerId === c.id).sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastVisit = cbills.length ? cbills[0].date : null;
    const refDate = lastVisit || c.joinDate;
    if (!refDate) return null;
    const days = Math.floor((Date.now() - new Date(refDate).getTime()) / 86400000);
    if (days < thresholdDays) return null;
    return { ...c, lastVisit, daysSince: days };
  }).filter(Boolean).sort((a, b) => b.daysSince - a.daysSince);
}
function computeBirthdays(customers, windowDays) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return customers.filter(c => c.dob).map(c => {
    const dob = new Date(c.dob);
    if (isNaN(dob)) return null;
    let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
    const daysAway = Math.round((next - today) / 86400000);
    return { ...c, daysAway };
  }).filter(c => c && c.daysAway <= (windowDays || 7)).sort((a, b) => a.daysAway - b.daysAway);
}
function normalizePhone(phone) { return (phone || '').replace(/\D/g, ''); }
function findCustomerByPhone(customers, phone, excludeId) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return customers.find(c => c.id !== excludeId && normalizePhone(c.phone) === normalized) || null;
}

function membershipStatus(customer) {
  if (!customer.membershipPlanId || !customer.membershipEnd) return 'None';
  return new Date(customer.membershipEnd) >= new Date() ? 'Active' : 'Expired';
}

/* ---------------- GST / sales helpers ---------------- */
const GST_RATE = 0.05;
const NET_FROM_GROSS_FACTOR = 1 - 0.047; // per salon's own rule: Net = Gross - 4.7% of Gross
function billGross(bill) { return (bill.total || 0) + (bill.productAmount || 0) + (bill.makeupAdvance || 0); }
function billNet(bill) { return billGross(bill) * NET_FROM_GROSS_FACTOR; }
function billPayments(bill) {
  // Bills created before split-payment support only have a single paymentMode
  // string -- fall back to treating that as one payment covering the full total.
  if (bill.payments && bill.payments.length) return bill.payments;
  if (bill.paymentMode) return [{ mode: bill.paymentMode, amount: bill.total || 0 }];
  return [];
}
function billPaymentSummary(bill) {
  const payments = billPayments(bill);
  if (payments.length === 0) return '—';
  if (payments.length === 1) return payments[0].mode;
  return payments.map(p => p.mode).join(' + ');
}
function inDateRange(dateStr, fromStr, toStr) {
  const d = new Date(dateStr);
  const from = new Date(fromStr); from.setHours(0, 0, 0, 0);
  const to = new Date(toStr); to.setHours(23, 59, 59, 999);
  return d >= from && d <= to;
}
function daysBetweenInclusive(fromStr, toStr) {
  const from = new Date(fromStr); from.setHours(0, 0, 0, 0);
  const to = new Date(toStr); to.setHours(0, 0, 0, 0);
  return Math.round((to - from) / 86400000) + 1;
}
function prorateTarget(monthlyTarget, fromStr, toStr) {
  const days = Math.max(0, daysBetweenInclusive(fromStr, toStr));
  return (Number(monthlyTarget) || 0) * (days / 30.44);
}
function computeGenderStats(bills, customers) {
  const genders = ['Female', 'Male', 'Other', 'Unknown'];
  const map = {};
  genders.forEach(g => { map[g] = { gender: g, visits: 0, revenue: 0, premiumVisits: 0 }; });
  const custById = {}; customers.forEach(c => { custById[c.id] = c; });
  bills.forEach(b => {
    const cust = custById[b.customerId];
    const g = (cust && cust.gender) ? cust.gender : 'Unknown';
    const bucket = genders.includes(g) ? g : 'Other';
    map[bucket].visits += 1;
    map[bucket].revenue += billGross(b);
  });
  return genders.map(g => map[g]);
}

/* ---------------- export & messaging helpers ---------------- */
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadJSON(filename, obj) { downloadText(filename, JSON.stringify(obj, null, 2), 'application/json'); }
function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(',')));
  return lines.join('\n');
}
function waLink(phone, message) {
  const digits = (phone || '').replace(/\D/g, '');
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
function generateCode(prefix) { return `${prefix}${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function inactiveMessage(salonName, name, code, pct) { return `Hi ${name}! We've missed you at ${salonName}. Here's ${pct}% off your next visit with code ${code}. Valid for 15 days — book your slot soon!`; }
function birthdayMessage(salonName, name, code, pct) { return `Happy Birthday ${name}! From all of us at ${salonName}, enjoy ${pct}% off any service this month with code ${code}. See you soon!`; }

/* ---------------- small UI atoms ---------------- */
function StatCard({ label, value, tone }) {
  const toneColor = tone === 'accent' ? 'text-amber-700' : 'text-stone-800';
  return (
    <div className="bg-white rounded-lg border border-stone-200 p-4">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`text-2xl mt-1 ${toneColor}`} style={displayFont}>{value}</div>
    </div>
  );
}
function Badge({ children, tone }) {
  const map = {
    default: 'bg-stone-100 text-stone-600',
    premium: 'bg-rose-50 text-rose-700',
    active: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-700',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${map[tone] || map.default}`}>{children}</span>;
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900 bg-opacity-50" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto`} style={{ maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 sticky top-0 bg-white">
          <h3 className="text-lg text-stone-800" style={displayFont}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-stone-100 text-stone-500 text-lg leading-none px-2">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="block mb-3 text-sm">
      <span className="block text-xs font-medium text-stone-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
function EmptyState({ title, sub }) {
  return (
    <div className="text-center py-12 text-stone-400">
      <div className="text-stone-600 text-sm font-medium">{title}</div>
      {sub && <div className="text-xs mt-1">{sub}</div>}
    </div>
  );
}
function SectionHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl text-stone-800" style={displayFont}>{title}</h2>
      {action}
    </div>
  );
}

/* ---------------- setup / login screens ---------------- */
function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="bg-white border border-stone-200 rounded-xl p-8 max-w-sm w-full">
        <div className="text-amber-600 text-xs uppercase tracking-widest mb-2 text-center">Salon Ops</div>
        <h1 className="text-2xl mb-2 text-stone-800 text-center" style={displayFont}>{title}</h1>
        {subtitle && <p className="text-sm text-stone-500 mb-6 text-center">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function SetupScreen({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!username.trim()) { setError('Choose a username'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const out = await apiSetup(username.trim(), password);
      onDone(out.username, out.role);
    } catch (e) {
      setError(e.message || 'Could not create the account');
    } finally { setLoading(false); }
  };

  return (
    <AuthShell title="Set Up This Salon" subtitle="This is the first time the app has run here. Create the owner login — you can add your manager and family as separate logins afterwards.">
      <Field label="Username"><input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} autoFocus /></Field>
      <Field label="Password"><input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" /></Field>
      <Field label="Confirm Password"><input type="password" className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></Field>
      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
      <button onClick={submit} disabled={loading} className="w-full bg-amber-700 hover:bg-amber-800 text-white text-sm px-4 py-3 rounded-md disabled:opacity-50">
        {loading ? 'Creating…' : 'Create Account & Continue'}
      </button>
      <p className="text-xs text-stone-400 mt-5 text-center">Your customer and billing data lives only on this server's computer — never in this browser.</p>
    </AuthShell>
  );
}

function LoginScreen({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!username.trim() || !password) { setError('Enter your username and password'); return; }
    setLoading(true);
    try {
      const out = await apiLogin(username.trim(), password);
      onDone(out.username, out.role);
    } catch (e) {
      setError(e.message || 'Could not log in');
    } finally { setLoading(false); }
  };

  return (
    <AuthShell title="Salon Manager" subtitle="Log in to continue.">
      <Field label="Username"><input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} autoFocus /></Field>
      <Field label="Password"><input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></Field>
      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
      <button onClick={submit} disabled={loading} className="w-full bg-amber-700 hover:bg-amber-800 text-white text-sm px-4 py-3 rounded-md disabled:opacity-50">
        {loading ? 'Logging in…' : 'Log In'}
      </button>
      <p className="text-xs text-stone-400 mt-5 text-center">For your security, logging in again is required each time you reopen the app — nothing is kept in this browser between visits.</p>
    </AuthShell>
  );
}

/* ---------------- sidebar ---------------- */
const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'billing', label: 'Billing' },
  { key: 'customers', label: 'Customers' },
  { key: 'staff', label: 'Staff' },
  { key: 'services', label: 'Services' },
  { key: 'memberships', label: 'Memberships' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'roster', label: 'Shift Roster' },
  { key: 'makeup', label: 'Makeup Bookings' },
  { key: 'inventory', label: 'Product Inventory' },
  { key: 'manage-products', label: 'Manage Products' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'payroll', label: 'OT & Incentives' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'reports', label: 'Reports' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'backup', label: 'Backup' },
];
const ADMIN_NAV = [{ key: 'admin-pnl', label: 'Admin — P&L' }];
function Sidebar({ activeTab, setActiveTab, salonName, username, role, onLogout }) {
  const items = role === 'admin' ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <div className="md:w-56 w-full bg-stone-900 md:min-h-screen flex md:flex-col no-print flex-shrink-0">
      <div className="px-5 py-5 hidden md:block">
        <div className="text-amber-500 text-xs tracking-widest uppercase">Salon Ops</div>
        <div className="text-white text-lg mt-0.5 truncate" style={displayFont}>{salonName || 'My Salon'}</div>
        <div className="text-stone-500 text-xs mt-2 truncate">Logged in as {username}</div>
        <button onClick={onLogout} className="text-stone-500 hover:text-stone-300 text-xs mt-1 underline">Log out</button>
      </div>
      <nav className="flex md:flex-col overflow-x-auto md:overflow-visible flex-1 md:px-2 md:py-2">
        {items.map(item => {
          const active = activeTab === item.key;
          return (
            <button key={item.key} onClick={() => setActiveTab(item.key)}
              className={`flex items-center gap-2 px-4 md:px-3 py-3 md:py-2 md:rounded-md text-sm whitespace-nowrap border-l-4 ${active ? 'bg-stone-800 border-amber-500 text-white' : 'border-transparent text-stone-400 hover:text-stone-200 hover:bg-stone-800'}`}>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ---------------- dashboard ---------------- */
function DashboardView({ ctx }) {
  const { bills, customers, enquiries, appointments, staff, servicesById, staffById, settings, setActiveTab } = ctx;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000); // re-check urgency every minute so reminders stay live
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const calc = (start) => {
    const rel = bills.filter(b => new Date(b.date) >= start);
    const revenue = rel.reduce((s, b) => s + (b.total || 0), 0);
    const count = rel.length;
    const premiumCount = rel.filter(b => isPremiumBill(b, servicesById)).length;
    return { revenue, count, premiumCount };
  };
  const week = calc(weekStart);

  // ---- Revenue trend: last 7 days, real bills ----
  const revenueTrend = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const value = bills.filter(b => { const bd = new Date(b.date); return bd >= d && bd < next; }).reduce((s, b) => s + (b.total || 0), 0);
      days.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), value });
    }
    return days;
  }, [bills]);
  const last7Total = revenueTrend.reduce((s, d) => s + d.value, 0);
  const prev7Total = useMemo(() => {
    let total = 0;
    for (let i = 13; i >= 7; i--) {
      const d = new Date(todayStart); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      total += bills.filter(b => { const bd = new Date(b.date); return bd >= d && bd < next; }).reduce((s, b) => s + (b.total || 0), 0);
    }
    return total;
  }, [bills]);
  const trendPct = prev7Total > 0 ? ((last7Total - prev7Total) / prev7Total * 100) : null;

  const topStaff = useMemo(() => {
    const map = {};
    bills.filter(b => new Date(b.date) >= weekStart).forEach(b => (b.items || []).forEach(it => {
      const sid = itemStaffId(it, b);
      map[sid] = (map[sid] || 0) + itemNetRevenue(it, b);
    }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([staffId, revenue]) => ({ staffId, revenue, name: staffById[staffId] ? staffById[staffId].name : 'Unknown' }));
  }, [bills, staffById]);
  const maxStaffRev = Math.max(...topStaff.map(s => s.revenue), 1);

  const inactiveCount = computeInactive(customers, bills, settings.inactiveDays).length;
  const birthdayCount = computeBirthdays(customers, settings.birthdayWindowDays).length;

  const totalClients = customers.length;
  const newClientsThisMonth = customers.filter(c => c.joinDate && new Date(c.joinDate) >= monthStart).length;
  const maleClients = customers.filter(c => c.gender === 'Male').length;
  const femaleClients = customers.filter(c => c.gender === 'Female').length;
  const premiumServiceCount = bills.reduce((sum, b) => sum + b.items.filter(it => servicesById[it.serviceId] && servicesById[it.serviceId].category === 'Premium').length, 0);
  const totalEnquiries = (enquiries || []).length;

  // ---- This Week's Appointments ribbon ----
  const weekDates = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return { day: label, dateStr: localDateStr(d), dayNum: d.getDate() }; });
  const apptsByDay = {};
  (appointments || []).forEach(a => { const ds = (a.dateTime || '').slice(0, 10); if (!ds) return; (apptsByDay[ds] = apptsByDay[ds] || []).push(a); });
  const [selectedDay, setSelectedDay] = useState(null);
  const todayStr = localDateStr(todayStart);
  const totalThisWeek = weekDates.reduce((s, wd) => s + (apptsByDay[wd.dateStr] || []).length, 0);

  // ---- Appointments reminder due (within next 2 hours, still upcoming) ----
  const apptReminders = useMemo(() => {
    return (appointments || [])
      .filter(a => a.status === 'Upcoming' && a.dateTime)
      .map(a => ({ ...a, dt: new Date(a.dateTime) }))
      .filter(a => { const diffH = (a.dt - now) / 3600000; return diffH >= 0 && diffH <= 2; })
      .sort((a, b) => a.dt - b.dt);
  }, [appointments, tick]); // eslint-disable-line

  // ---- Enquiry follow-ups due (overdue, or within next 2 hours) ----
  const followUpsDue = useMemo(() => {
    return (enquiries || [])
      .filter(e => e.followUpDate && e.followUpTime && e.status !== 'Converted' && e.status !== 'Closed')
      .map(e => ({ ...e, dt: new Date(`${e.followUpDate}T${e.followUpTime}`) }))
      .filter(e => (e.dt - now) / 3600000 <= 2)
      .sort((a, b) => a.dt - b.dt);
  }, [enquiries, tick]); // eslint-disable-line

  return (
    <div className="-m-6 md:-m-8 p-6 md:p-8 min-h-screen bg-gradient-to-br from-amber-100/70 via-rose-50/60 to-violet-100/50">
      <SectionHeader title={`Welcome back${settings.salonName ? ', ' + settings.salonName : ''}`} />

      {/* Hero: revenue trend + service mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className={`lg:col-span-2 ${DASH_CARD}`} style={dashCardStyle(DASH_GOLD)}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-xs text-stone-400 uppercase tracking-wide">Last 7 Days Revenue</div>
              <div className="text-2xl" style={{ ...displayFont, color: DASH_GOLD }}>{fmtINR(last7Total)}</div>
            </div>
            {trendPct !== null && (
              <div className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: (trendPct >= 0 ? DASH_TEAL : '#dc2626') + '18', color: trendPct >= 0 ? DASH_TEAL : '#dc2626' }}>
                <span>{trendPct >= 0 ? '▲' : '▼'}</span> {Math.abs(trendPct).toFixed(0)}% vs previous 7 days
              </div>
            )}
          </div>
          <DashAreaChart data={revenueTrend} color={DASH_GOLD} />
          <div className="flex justify-between text-xs text-stone-400 -mt-2 px-1">
            {revenueTrend.map((d, i) => <span key={i}>{d.label}</span>)}
          </div>
        </div>

        <div className={DASH_CARD + ' flex flex-col'} style={dashCardStyle(DASH_CORAL)}>
          <div className="text-xs text-stone-400 uppercase tracking-wide mb-3">Service Mix (This Week)</div>
          {week.count === 0 ? <div className="text-sm text-stone-400 flex-1 flex items-center">No bills yet this week.</div> : (
            <div className="flex items-center gap-4 flex-1">
              <DashDonut segments={[{ value: week.count - week.premiumCount, color: DASH_GOLD }, { value: week.premiumCount, color: DASH_CORAL }]} />
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DASH_GOLD }}></span> Regular <span className="text-stone-400">{Math.round((week.count - week.premiumCount) / week.count * 100)}%</span></div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DASH_CORAL }}></span> Premium <span className="text-stone-400">{Math.round(week.premiumCount / week.count * 100)}%</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Signature: This Week's Appointments ribbon */}
      <div className={DASH_CARD + ' mb-5'} style={dashCardStyle(DASH_CORAL)}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs text-stone-400 uppercase tracking-wide">This Week's Appointments</div>
          <div className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: DASH_CORAL + '18', color: DASH_CORAL }}>{totalThisWeek} booked</div>
        </div>
        {totalThisWeek === 0 ? <div className="text-sm text-stone-400">No appointments booked this week.</div> : (
          <>
            <div className="flex md:grid md:grid-cols-7 gap-2 overflow-x-auto pb-1 -mx-1 px-1 md:mx-0 md:px-0 md:overflow-visible">
              {weekDates.map(wd => {
                const dayAppts = (apptsByDay[wd.dateStr] || []).sort((a, b) => a.dateTime.localeCompare(b.dateTime));
                const isToday = wd.dateStr === todayStr;
                return (
                  <div key={wd.dateStr} onClick={() => setSelectedDay(wd.dateStr === selectedDay ? null : wd.dateStr)}
                    className={`rounded-xl p-2.5 border-2 cursor-pointer transition-all min-h-[128px] flex-shrink-0 w-[118px] md:w-auto ${isToday ? 'border-amber-400 bg-white' : 'border-white/60 bg-white/60 hover:bg-white/90'}`}>
                    <div className="text-[10px] text-stone-400 uppercase tracking-wide">{wd.day}</div>
                    <div className="text-base leading-tight mb-1.5" style={{ ...displayFont, color: isToday ? DASH_GOLD : '#44403c' }}>{wd.dayNum}</div>
                    <div className="space-y-1">
                      {dayAppts.slice(0, 3).map(a => {
                        const t = (a.dateTime || '').slice(11, 16);
                        const col = DASH_SOURCE_COLORS[a.source] || DASH_SKY;
                        return <div key={a.id} className="text-[10px] px-1.5 py-1 rounded-md truncate font-medium" style={{ background: col + '18', color: col }} title={`${t} — ${a.name} (${a.source})`}>{t} {(a.name || '').split(' ')[0]}</div>;
                      })}
                      {dayAppts.length > 3 && <div className="text-[10px] text-stone-400 pl-1">+{dayAppts.length - 3} more</div>}
                      {dayAppts.length === 0 && <div className="text-[10px] text-stone-300 pl-1">—</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedDay && (
              <div className="mt-4 pt-4 border-t border-white/60">
                <div className="text-xs text-stone-500 mb-2 font-medium">Full schedule — {weekDates.find(w => w.dateStr === selectedDay).day}</div>
                <div className="flex flex-wrap gap-2">
                  {(apptsByDay[selectedDay] || []).sort((a, b) => a.dateTime.localeCompare(b.dateTime)).map(a => {
                    const col = DASH_SOURCE_COLORS[a.source] || DASH_SKY;
                    return <div key={a.id} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: col + '15', color: col }}>{(a.dateTime || '').slice(11, 16)} · {a.name} <span className="opacity-60">({a.source})</span></div>;
                  })}
                  {(!apptsByDay[selectedDay] || apptsByDay[selectedDay].length === 0) && <div className="text-xs text-stone-400">Nothing booked yet.</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Top Staff + Client Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className={`lg:col-span-2 ${DASH_CARD}`} style={dashCardStyle(DASH_VIOLET)}>
          <div className="text-xs text-stone-400 uppercase tracking-wide mb-4">Top Staff This Week</div>
          {topStaff.length === 0 ? <div className="text-sm text-stone-400">No bills yet this week.</div> :
            topStaff.map((s, i) => <DashHBar key={s.staffId} label={`${i + 1}. ${s.name}`} value={s.revenue} max={maxStaffRev} color={DASH_VIOLET} />)}
        </div>
        <div className={DASH_CARD} style={dashCardStyle(DASH_SKY)}>
          <div className="text-xs text-stone-400 uppercase tracking-wide mb-3">Client Mix</div>
          {(maleClients + femaleClients) === 0 ? <div className="text-sm text-stone-400">No customers yet.</div> : (
            <div className="flex items-center gap-4">
              <DashDonut segments={[{ value: femaleClients, color: DASH_CORAL }, { value: maleClients, color: DASH_SKY }]} size={90} strokeWidth={12} />
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DASH_CORAL }}></span> Female <span className="text-stone-400">{Math.round(femaleClients / (maleClients + femaleClients) * 100)}%</span></div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DASH_SKY }}></span> Male <span className="text-stone-400">{Math.round(maleClients / (maleClients + femaleClients) * 100)}%</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <DashStatChip icon="👥" label="Total Clients" value={totalClients} color={DASH_SKY} />
        <DashStatChip icon="✨" label="New This Month" value={newClientsThisMonth} color={DASH_TEAL} />
        <DashStatChip icon="💎" label="Premium Services" value={premiumServiceCount} color={DASH_CORAL} />
        <DashStatChip icon="📋" label="Total Enquiries" value={totalEnquiries} color={DASH_VIOLET} />
      </div>

      {/* Appointments reminder due */}
      <div className={DASH_CARD + ' mb-5'} style={dashCardStyle(DASH_SKY)}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-stone-400 uppercase tracking-wide">Appointments — Reminder Due</div>
          <div className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: DASH_SKY + '18', color: DASH_SKY }}>Starting within 2 hrs</div>
        </div>
        {apptReminders.length === 0 ? <div className="text-sm text-stone-400">Nothing starting in the next 2 hours.</div> : (
          <div className="space-y-2">
            {apptReminders.map(a => {
              const minsAway = Math.round((a.dt - now) / 60000);
              const t = a.dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              const msg = `Hi ${a.name}, just a reminder about your appointment today at ${t} — see you soon!`;
              return (
                <div key={a.id} className="flex items-center justify-between bg-white/70 rounded-xl px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DASH_SKY }}></span>
                    <div>
                      <div className="text-sm font-medium text-stone-800">{a.name}</div>
                      <div className="text-xs" style={{ color: DASH_SKY }}>Starts at {t} ({minsAway <= 60 ? `in ${minsAway} min` : `in ${(minsAway / 60).toFixed(1)} hrs`})</div>
                    </div>
                  </div>
                  <a href={waLink(a.phone, msg)} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-full font-medium text-white flex-shrink-0" style={{ background: '#16a34a' }}>Send Reminder</a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Enquiry follow-ups due */}
      <div className={DASH_CARD + ' mb-5'} style={dashCardStyle(DASH_CORAL)}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-stone-400 uppercase tracking-wide">Follow-Ups Due</div>
          <div className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: '#dc262618', color: '#dc2626' }}>Overdue + next 2 hrs</div>
        </div>
        {followUpsDue.length === 0 ? <div className="text-sm text-stone-400">Nothing due right now.</div> : (
          <div className="space-y-2">
            {followUpsDue.map(e => {
              const overdue = e.dt < now;
              const t = e.dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              const svcName = servicesById[e.serviceId] ? servicesById[e.serviceId].name : 'their enquiry';
              const msg = `Hi ${e.customerName}, following up on your enquiry about ${svcName} — happy to help you book a time whenever suits you!`;
              return (
                <div key={e.id} className="flex items-center justify-between bg-white/70 rounded-xl px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: overdue ? '#dc2626' : '#f59e0b' }}></span>
                    <div>
                      <div className="text-sm font-medium text-stone-800">{e.customerName} <span className="text-stone-400 font-normal">· {svcName}</span></div>
                      <div className="text-xs" style={{ color: overdue ? '#dc2626' : '#b45309' }}>{overdue ? `Overdue — was due ${t}` : `Due at ${t} (within 2 hrs)`}</div>
                    </div>
                  </div>
                  <a href={waLink(e.phone, msg)} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-full font-medium text-white flex-shrink-0" style={{ background: '#16a34a' }}>Send Reminder</a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Needs attention */}
      <div className={DASH_CARD} style={dashCardStyle(DASH_TEAL)}>
        <div className="text-xs text-stone-400 uppercase tracking-wide mb-3">Needs Attention</div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setActiveTab('outreach')} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: DASH_GOLD + '12' }}>
            <span className="text-lg">⏰</span>
            <div className="text-left"><div className="text-sm font-medium" style={{ color: DASH_GOLD }}>{inactiveCount} Inactive Customers</div><div className="text-[11px] text-stone-400">{settings.inactiveDays || 45}+ days since last visit</div></div>
          </button>
          <button onClick={() => setActiveTab('outreach')} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: DASH_CORAL + '12' }}>
            <span className="text-lg">🎂</span>
            <div className="text-left"><div className="text-sm font-medium" style={{ color: DASH_CORAL }}>{birthdayCount} Upcoming Birthdays</div><div className="text-[11px] text-stone-400">Within the next {settings.birthdayWindowDays || 7} days</div></div>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- billing ---------------- */
function BillingView({ ctx }) {
  const { bills, servicesById, staffById, customersById } = ctx;
  const [modal, setModal] = useState(null); // null | 'new' | bill object
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const filteredByDate = bills.filter(b => {
    if (!fromDate && !toDate) return true;
    const bd = (b.date || '').slice(0, 10);
    if (fromDate && bd < fromDate) return false;
    if (toDate && bd > toDate) return false;
    return true;
  });
  const sorted = [...filteredByDate].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageBills = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applyDateFilter = (setter) => (e) => { setter(e.target.value); setPage(1); };

  return (
    <div>
      <SectionHeader title="Billing" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Bill</button>
      } />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><input type="date" className={inputCls} value={fromDate} onChange={applyDateFilter(setFromDate)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={toDate} onChange={applyDateFilter(setToDate)} /></Field>
        {(fromDate || toDate) && <button onClick={() => { setFromDate(''); setToDate(''); setPage(1); }} className="text-xs px-3 py-2 rounded-md border border-stone-300 text-stone-600 h-10">Clear Dates</button>}
        <div className="text-xs text-stone-400 ml-auto">{sorted.length} bill{sorted.length === 1 ? '' : 's'}{(fromDate || toDate) ? ' in range' : ' total'}</div>
      </div>
      {bills.length === 0 ? <EmptyState title="No bills yet" sub="Create your first bill to start tracking revenue." /> : sorted.length === 0 ? <EmptyState title="No bills in this date range" sub="Try a different range or clear the filter." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Invoice #</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Services (by Staff)</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {pageBills.map(b => (
                <tr key={b.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(b)}>
                  <td className="px-4 py-2 text-stone-500 font-mono text-xs whitespace-nowrap">{b.invoiceNumber || '—'}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(b.date)}</td>
                  <td className="px-4 py-2 text-stone-800 whitespace-nowrap">{customersById[b.customerId] ? customersById[b.customerId].name : 'Deleted'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {b.items.map((it, idx) => {
                        const svc = servicesById[it.serviceId];
                        const sid = itemStaffId(it, b);
                        const staffName = staffById[sid] ? staffById[sid].name : 'Unassigned';
                        return <Badge key={idx} tone={svc && svc.category === 'Premium' ? 'premium' : 'default'}>{svc ? svc.name : 'Service'} — {staffName}</Badge>;
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-stone-800 whitespace-nowrap">{fmtINR(b.total)}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{billPaymentSummary(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 disabled:opacity-40 disabled:cursor-not-allowed">← Previous</button>
          <span className="text-stone-500">Page {safePage} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 disabled:opacity-40 disabled:cursor-not-allowed">Next →</button>
        </div>
      )}
      {modal && <BillForm ctx={ctx} bill={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ---------------- customer search picker ---------------- */
function CustomerPicker({ customers, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = customers.find(c => c.id === value);
  const q = query.trim().toLowerCase();
  const pool = q ? customers.filter(c => (c.phone || '').toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : customers;
  const matches = pool.slice(0, 8);

  return (
    <div className="relative">
      <input
        className={inputCls}
        placeholder={placeholder || 'Search by phone or name…'}
        value={open ? query : (selected ? `${selected.name} — ${selected.phone}` : '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (value) onChange(''); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 bg-white border border-stone-200 rounded-md mt-1 w-full max-h-52 overflow-y-auto shadow-lg">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-xs text-stone-400">No matches</div>
          ) : matches.map(c => (
            <div key={c.id} className="px-3 py-2 text-sm hover:bg-stone-50 cursor-pointer" onMouseDown={e => { e.preventDefault(); onChange(c.id); setQuery(''); setOpen(false); }}>
              <span className="font-medium text-stone-800">{c.name}</span> <span className="text-stone-400">— {c.phone}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PAYMENT_MODES = ['Cash', 'Card', 'UPI-HDFC', 'UPI-PhonePe', 'Other'];

function applyStockDelta(stockEntries, oldProductsSold, newProductsSold) {
  const deltaMap = {};
  (oldProductsSold || []).forEach(p => { const k = `${p.entryId}_${p.productId}`; deltaMap[k] = (deltaMap[k] || 0) - p.quantitySold; });
  (newProductsSold || []).forEach(p => { const k = `${p.entryId}_${p.productId}`; deltaMap[k] = (deltaMap[k] || 0) + p.quantitySold; });
  let updated = stockEntries;
  Object.entries(deltaMap).forEach(([key, delta]) => {
    if (!delta) return;
    const [entryId, productId] = key.split('_');
    updated = updated.map(entry => entry.id !== entryId ? entry : {
      ...entry, products: entry.products.map(p => p.id === productId ? { ...p, quantity: p.quantity - delta } : p),
    });
  });
  return updated;
}

function BillForm({ ctx, bill, onClose }) {
  const { customers, staff, services, bills, saveBills, saveCustomers, membershipPlans, stockEntries, makeupBookings, refreshAll, notify } = ctx;
  const isNew = !bill;
  const [customerId, setCustomerId] = useState(bill ? bill.customerId : '');
  const [date, setDate] = useState(bill ? bill.date.slice(0, 10) : todayISO());
  const [items, setItems] = useState(bill
    ? bill.items.map(it => ({ ...it, staffId: it.staffId || bill.staffId || '' })) // backfill old bills that only had a bill-level staff
    : [{ serviceId: '', price: 0, startTime: '', endTime: '', staffId: '' }]);
  const [discountPercent, setDiscountPercent] = useState(bill ? bill.discountPercent : 0);
  const [offerCodeText, setOfferCodeText] = useState(bill ? (bill.offerCode || '') : '');
  const [payments, setPayments] = useState(bill ? billPayments(bill).map(p => ({ ...p })) : [{ mode: 'Cash', amount: 0 }]);
  const [productAmount, setProductAmount] = useState(bill ? (bill.productAmount || 0) : 0);
  const [makeupAdvance, setMakeupAdvance] = useState(bill ? (bill.makeupAdvance || 0) : 0);
  const [linkedMakeupBookingId, setLinkedMakeupBookingId] = useState(bill ? (bill.linkedMakeupBookingId || '') : '');
  const [productsSold, setProductsSold] = useState(bill ? (bill.productsSold || []) : []);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustGender, setNewCustGender] = useState('');
  const [newCustDob, setNewCustDob] = useState('');

  const originalProductsSold = bill ? (bill.productsSold || []) : [];
  const availableRetail = [];
  stockEntries.forEach(entry => {
    (entry.products || []).filter(p => p.type === 'Retail').forEach(p => {
      const reservedByThisBill = originalProductsSold.find(x => x.entryId === entry.id && x.productId === p.id);
      const effectiveAvailable = p.quantity + (reservedByThisBill ? reservedByThisBill.quantitySold : 0);
      if (effectiveAvailable > 0) availableRetail.push({ entryId: entry.id, productId: p.id, name: p.product, salePrice: p.salePrice, landingPrice: p.landingPrice, effectiveAvailable });
    });
  });

  const updateProductSold = (idx, patch) => setProductsSold(productsSold.map((p, i) => i === idx ? { ...p, ...patch } : p));
  const selectProductSold = (idx, entryId, productId) => {
    const found = availableRetail.find(p => p.entryId === entryId && p.productId === productId);
    updateProductSold(idx, { entryId, productId, productName: found ? found.name : '', salePriceEach: found ? found.salePrice : 0, landingPriceEach: found ? found.landingPrice : 0, quantitySold: 1 });
  };
  const addProductSoldRow = () => setProductsSold([...productsSold, { entryId: '', productId: '', productName: '', quantitySold: 1, salePriceEach: 0, landingPriceEach: 0 }]);
  const removeProductSoldRow = (idx) => setProductsSold(productsSold.filter((_, i) => i !== idx));
  const productsSoldTotal = productsSold.reduce((s, p) => s + (p.salePriceEach || 0) * (p.quantitySold || 0), 0);


  const customer = customers.find(c => c.id === customerId);
  const activeMembership = !!(customer && customer.membershipPlanId && customer.membershipEnd && new Date(customer.membershipEnd) >= new Date());

  useEffect(() => {
    if (!isNew) return; // don't override a saved bill's discount when just viewing/editing it
    if (activeMembership && customer) {
      const plan = membershipPlans.find(p => p.id === customer.membershipPlanId);
      if (plan) setDiscountPercent(plan.discountPercent || 0);
    }
    // eslint-disable-next-line
  }, [customerId]);

  const itemsWithDuration = items.map(it => ({ ...it, durationMins: diffMinutes(it.startTime, it.endTime) }));
  const { subtotal, discountAmount, total } = calcBillTotals(itemsWithDuration, discountPercent);
  const grandTotal = total + (Number(productAmount) || 0) + (Number(makeupAdvance) || 0) + productsSoldTotal;
  const paymentsTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remainingToAllocate = grandTotal - paymentsTotal;
  const updatePayment = (idx, patch) => setPayments(payments.map((p, i) => i === idx ? { ...p, ...patch } : p));
  const addPaymentRow = () => setPayments([...payments, { mode: 'Cash', amount: Math.max(0, remainingToAllocate) }]);
  const removePaymentRow = (idx) => setPayments(payments.filter((_, i) => i !== idx));
  useEffect(() => {
    // with a single payment row (the common case), auto-track the Grand Total
    // so this feels exactly as simple as the old single-payment-mode dropdown --
    // manual amount entry only kicks in once a second payment mode is added.
    if (payments.length === 1 && payments[0].amount !== grandTotal) {
      setPayments([{ ...payments[0], amount: grandTotal }]);
    }
    // eslint-disable-next-line
  }, [grandTotal, payments.length]);

  const updateItem = (idx, patch) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const selectService = (idx, serviceId) => {
    const svc = services.find(s => s.id === serviceId);
    updateItem(idx, { serviceId, price: svc ? svc.price : 0 });
  };
  const addItemRow = () => setItems([...items, { serviceId: '', price: 0, startTime: '', endTime: '', staffId: items.length ? items[items.length - 1].staffId : '' }]);
  const removeItemRow = (idx) => setItems(items.filter((_, i) => i !== idx));

  const quickAddCustomer = () => {
    if (!newCustName.trim()) { notify('Enter a name for the new customer'); return; }
    const dup = findCustomerByPhone(customers, newCustPhone);
    if (dup) {
      notify(`${dup.name} already has this number — selected them instead`);
      setCustomerId(dup.id);
      setShowNewCustomer(false); setNewCustName(''); setNewCustPhone(''); setNewCustGender(''); setNewCustDob('');
      return;
    }
    const c = { id: uid(), name: newCustName.trim(), phone: newCustPhone.trim(), dob: newCustDob, gender: newCustGender, joinDate: todayISO(), membershipPlanId: '', membershipStart: '', membershipEnd: '' };
    saveCustomers([...customers, c]);
    setCustomerId(c.id);
    setShowNewCustomer(false); setNewCustName(''); setNewCustPhone(''); setNewCustGender(''); setNewCustDob('');
    notify('Customer added');
  };

  const submit = () => {
    if (!customerId) { notify('Select a customer'); return; }
    const validItems = itemsWithDuration.filter(it => it.serviceId);
    if (!validItems.length) { notify('Add at least one service'); return; }
    if (validItems.some(it => !it.staffId)) { notify('Select a staff member for every service'); return; }
    const validProductsSold = productsSold.filter(p => p.entryId && p.productId && p.quantitySold > 0);
    const validPayments = payments.filter(p => Number(p.amount) > 0);
    if (!validPayments.length) { notify('Enter at least one payment amount'); return; }
    if (Math.abs(remainingToAllocate) >= 0.5) { notify(`Payments must add up to the Grand Total (${fmtINR(remainingToAllocate)} still unallocated)`); return; }
    const record = {
      id: bill ? bill.id : uid(),
      date: new Date(date).toISOString(), customerId,
      staffId: validItems[0].staffId, // "primary" staff for this bill, kept for simple displays/backward-compat; per-item staffId below is the source of truth
      items: validItems.map(({ serviceId, price, durationMins, startTime, endTime, staffId }) => ({ serviceId, price, durationMins, startTime, endTime, staffId })),
      subtotal, discountPercent: Number(discountPercent) || 0, discountAmount, total,
      productAmount: Number(productAmount) || 0, makeupAdvance: Number(makeupAdvance) || 0,
      linkedMakeupBookingId: Number(makeupAdvance) > 0 ? linkedMakeupBookingId : '',
      offerCode: offerCodeText.trim(),
      payments: validPayments, paymentMode: validPayments[0].mode, // paymentMode kept as a simple fallback for anything reading the old field
      productsSold: validProductsSold,
      retailProducts: validProductsSold.map(p => ({
        stockEntryId: p.entryId, productLineId: p.productId,
        quantity: Number(p.quantitySold) || 0, salePrice: Number(p.salePriceEach) || 0, landingPrice: Number(p.landingPriceEach) || 0,
      })),
    };
    if (!isNew) record.invoiceNumber = bill.invoiceNumber; // preserve on edit; server assigns a new one only when absent
    const savingRetail = validProductsSold.length > 0 || originalProductsSold.length > 0;
    const savingMakeupLink = record.linkedMakeupBookingId || (bill && bill.linkedMakeupBookingId);
    if (isNew) saveBills([...bills, record]);
    else saveBills(bills.map(b => b.id === record.id ? record : b));
    if (savingRetail || savingMakeupLink) {
      // the server just reconciled stock quantities and/or the linked makeup booking's balance -- refresh to reflect it immediately
      setTimeout(() => { refreshAll().catch(() => {}); }, 400);
    }
    notify(isNew ? 'Bill saved' : 'Bill updated');
    onClose();
  };
  const removeBill = () => {
    if (!window.confirm(`Delete invoice ${bill.invoiceNumber || ''}? This cannot be undone.`)) return;
    saveBills(bills.filter(b => b.id !== bill.id));
    notify('Bill deleted');
    onClose();
  };

  return (
    <Modal title={isNew ? 'New Bill' : `Edit Bill${bill.invoiceNumber ? ' — ' + bill.invoiceNumber : ''}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Customer">
          {!showNewCustomer ? (
            <div className="flex gap-2">
              <div className="flex-1"><CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} /></div>
              <button type="button" onClick={() => setShowNewCustomer(true)} className="text-xs px-2 rounded-md border border-stone-300 text-stone-600 whitespace-nowrap">+ New</button>
            </div>
          ) : (
            <div className="bg-stone-50 border border-stone-200 rounded-md p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder="Name" value={newCustName} onChange={e => setNewCustName(e.target.value)} />
                <input className={inputCls} placeholder="Phone" value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={newCustGender} onChange={e => setNewCustGender(e.target.value)}>
                  <option value="">Gender —</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
                <input type="date" className={inputCls} value={newCustDob} onChange={e => setNewCustDob(e.target.value)} placeholder="Birthday" />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowNewCustomer(false)} className="text-xs px-2 py-1 rounded-md border border-stone-300 text-stone-600">Cancel</button>
                <button type="button" onClick={quickAddCustomer} className="text-xs px-3 py-1 rounded-md bg-amber-700 text-white">Add Customer</button>
              </div>
            </div>
          )}
          {activeMembership && <div className="mt-1"><Badge tone="active">Member — discount auto-applied</Badge></div>}
        </Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>

      <div className="mt-2 mb-2 text-xs font-medium text-stone-500">Services — pick the staff member for each one (useful when two customers on one bill are attended by different staff)</div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2 bg-stone-50 border border-stone-200 rounded-md p-2">
            <select className={inputCls} style={{ maxWidth: '180px' }} value={it.serviceId} onChange={e => selectService(idx, e.target.value)}>
              <option value="">Select service…</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtINR(s.price)})</option>)}
            </select>
            <select className={inputCls} style={{ maxWidth: '150px' }} value={it.staffId} onChange={e => updateItem(idx, { staffId: e.target.value })}>
              <option value="">Staff…</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="number" className="border border-stone-300 rounded-md px-2 py-2 text-sm" style={{ width: '90px' }} value={it.price} onChange={e => updateItem(idx, { price: Number(e.target.value) || 0 })} title="Price — edit for on-spot discounts" />
            <input type="time" className="border border-stone-300 rounded-md px-2 py-2 text-sm" value={it.startTime} onChange={e => updateItem(idx, { startTime: e.target.value })} />
            <span className="text-stone-400 text-xs">to</span>
            <input type="time" className="border border-stone-300 rounded-md px-2 py-2 text-sm" value={it.endTime} onChange={e => updateItem(idx, { endTime: e.target.value })} />
            <span className="text-xs text-stone-500 whitespace-nowrap">{diffMinutes(it.startTime, it.endTime) ? diffMinutes(it.startTime, it.endTime) + ' min' : ''}</span>
            <button type="button" onClick={() => removeItemRow(idx)} className="text-stone-400 hover:text-red-600 ml-auto text-sm">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addItemRow} className="mt-2 text-xs text-amber-700">+ Add another service</button>
      <div className="text-xs text-stone-400 mt-1">Tip: the price field next to each service is editable — adjust it directly for on-spot discounts.</div>

      <div className="grid grid-cols-2 gap-x-4 mt-4">
        <Field label="Discount %"><input type="number" min="0" max="100" className={inputCls} value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} /></Field>
        <Field label="Offer Code (optional)"><input className={inputCls} value={offerCodeText} onChange={e => setOfferCodeText(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Product Amount (₹, optional)"><input type="number" min="0" className={inputCls} value={productAmount} onChange={e => setProductAmount(e.target.value)} /></Field>
        <Field label="Makeup Advance (₹, optional)"><input type="number" min="0" className={inputCls} value={makeupAdvance} onChange={e => setMakeupAdvance(e.target.value)} /></Field>
      </div>
      {Number(makeupAdvance) > 0 && (
        <Field label="Link Advance to Makeup Booking">
          <select className={inputCls} value={linkedMakeupBookingId} onChange={e => setLinkedMakeupBookingId(e.target.value)}>
            <option value="">Not linked — just a general advance</option>
            {(makeupBookings || []).map(mb => (
              <option key={mb.id} value={mb.id}>{mb.clientName} — {mb.type} — Balance {fmtINR(makeupBalance(mb.price, mb.advanceReceived))}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="text-xs text-stone-400 -mt-2 mb-3">"Product Amount" above is for anything not tracked in inventory. To sell a specific tracked product (and deduct it from stock automatically), use Retail Products Sold below. Linking the advance to a booking updates that booking's balance automatically.</div>

      <div className="mt-2 mb-2 text-xs font-medium text-stone-500">Retail Products Sold (deducts from stock automatically)</div>
      <div className="space-y-2">
        {productsSold.map((p, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2 bg-stone-50 border border-stone-200 rounded-md p-2">
            <select className={inputCls} style={{ maxWidth: '220px' }} value={p.entryId && p.productId ? `${p.entryId}|${p.productId}` : ''}
              onChange={e => { const [entryId, productId] = e.target.value.split('|'); selectProductSold(idx, entryId, productId); }}>
              <option value="">Select product…</option>
              {availableRetail.map(r => <option key={`${r.entryId}|${r.productId}`} value={`${r.entryId}|${r.productId}`}>{r.name} ({fmtINR(r.salePrice)}, {r.effectiveAvailable} left)</option>)}
            </select>
            <input type="number" min="1" className="border border-stone-300 rounded-md px-2 py-2 text-sm" style={{ width: '80px' }} value={p.quantitySold} onChange={e => updateProductSold(idx, { quantitySold: Number(e.target.value) || 1 })} />
            <span className="text-xs text-stone-500 whitespace-nowrap">{p.quantitySold > 0 && p.salePriceEach > 0 ? fmtINR(p.quantitySold * p.salePriceEach) : ''}</span>
            <button type="button" onClick={() => removeProductSoldRow(idx)} className="text-stone-400 hover:text-red-600 ml-auto text-sm">Remove</button>
          </div>
        ))}
      </div>
      {availableRetail.length === 0
        ? <div className="text-xs text-stone-400 mb-3">No retail stock available — add some under Product Inventory.</div>
        : <button type="button" onClick={addProductSoldRow} className="text-xs text-amber-700 mb-3">+ Add a retail product sold</button>}

      <div className="border-t border-stone-200 mt-3 pt-3 text-sm space-y-1">
        <div className="flex justify-between text-stone-500"><span>Subtotal (services)</span><span>{fmtINR(subtotal)}</span></div>
        <div className="flex justify-between text-stone-500"><span>Discount</span><span>-{fmtINR(discountAmount)}</span></div>
        <div className="flex justify-between text-stone-800 font-medium text-base"><span>Total (services)</span><span>{fmtINR(total)}</span></div>
        {productsSoldTotal > 0 && (
          <div className="flex justify-between text-stone-500"><span>Retail products sold</span><span>{fmtINR(productsSoldTotal)}</span></div>
        )}
        <div className="flex justify-between text-stone-800 font-medium text-base pt-1 border-t border-stone-100">
          <span>Grand Total</span>
          <span>{fmtINR(grandTotal)}</span>
        </div>
        {isNew && <div className="text-xs text-stone-400">An invoice number is assigned automatically when you save.</div>}
      </div>

      <div className="mt-3 mb-2 text-xs font-medium text-stone-500">Payment{payments.length > 1 ? 's' : ''} — split across modes if needed</div>
      <div className="space-y-2">
        {payments.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select className={inputCls} style={{ maxWidth: '160px' }} value={p.mode} onChange={e => updatePayment(idx, { mode: e.target.value })}>
              {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
            </select>
            <input type="number" min="0" className="border border-stone-300 rounded-md px-2 py-2 text-sm w-32" value={p.amount} onChange={e => updatePayment(idx, { amount: Number(e.target.value) || 0 })} />
            {payments.length > 1 && <button type="button" onClick={() => removePaymentRow(idx)} className="text-stone-400 hover:text-red-600 text-sm">Remove</button>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 mb-3">
        <button type="button" onClick={addPaymentRow} className="text-xs text-amber-700">+ Split into another payment mode</button>
        <span className={`text-xs font-medium ${Math.abs(remainingToAllocate) < 0.5 ? 'text-emerald-700' : 'text-red-600'}`}>
          {Math.abs(remainingToAllocate) < 0.5 ? 'Fully allocated' : `Remaining to allocate: ${fmtINR(remainingToAllocate)}`}
        </span>
      </div>

      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={removeBill} className="text-red-600 text-sm">Delete Bill</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 hover:bg-amber-800 text-white">{isNew ? 'Save Bill' : 'Update Bill'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- customers ---------------- */
function CustomersView({ ctx }) {
  const { customers, bills, settings } = ctx;
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [lastVisitFrom, setLastVisitFrom] = useState('');
  const [lastVisitTo, setLastVisitTo] = useState('');
  const searched = customers.filter(c => (c.name + ' ' + (c.phone || '')).toLowerCase().includes(query.toLowerCase()));
  const filtered = searched.filter(c => {
    if (!lastVisitFrom && !lastVisitTo) return true;
    const stats = customerStats(c.id, bills);
    if (!stats.lastVisit) return false;
    const lv = stats.lastVisit.slice(0, 10);
    if (lastVisitFrom && lv < lastVisitFrom) return false;
    if (lastVisitTo && lv > lastVisitTo) return false;
    return true;
  });
  return (
    <div>
      <SectionHeader title="Customers" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Customer</button>
      } />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]"><input className={inputCls} placeholder="Search by name or phone…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <Field label="Last Visit From"><input type="date" className={inputCls} value={lastVisitFrom} onChange={e => setLastVisitFrom(e.target.value)} /></Field>
        <Field label="Last Visit To"><input type="date" className={inputCls} value={lastVisitTo} onChange={e => setLastVisitTo(e.target.value)} /></Field>
        {(lastVisitFrom || lastVisitTo) && <button onClick={() => { setLastVisitFrom(''); setLastVisitTo(''); }} className="text-xs px-3 py-2 rounded-md border border-stone-300 text-stone-600 h-10">Clear Dates</button>}
      </div>
      {customers.length === 0 ? <EmptyState title="No customers yet" sub="Add your first customer to get started." /> : filtered.length === 0 ? <EmptyState title="No customers match" sub="Try a different search or date range." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Membership</th>
                <th className="px-4 py-2 font-medium">Last Visit</th>
                <th className="px-4 py-2 font-medium text-right">Visits</th>
                <th className="px-4 py-2 font-medium text-right">Spend</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {filtered.map(c => {
                const stats = customerStats(c.id, bills);
                const inactive = stats.lastVisit
                  ? Math.floor((Date.now() - new Date(stats.lastVisit).getTime()) / 86400000) >= settings.inactiveDays
                  : Math.floor((Date.now() - new Date(c.joinDate).getTime()) / 86400000) >= settings.inactiveDays;
                const mStatus = membershipStatus(c);
                return (
                  <tr key={c.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(c)}>
                    <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{c.name}</td>
                    <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{c.phone || '—'}</td>
                    <td className="px-4 py-2">{mStatus !== 'None' ? <Badge tone={mStatus === 'Active' ? 'active' : 'danger'}>{mStatus}</Badge> : <span className="text-stone-300">—</span>}</td>
                    <td className="px-4 py-2 text-stone-500 whitespace-nowrap">
                      {fmtDate(stats.lastVisit)} {inactive && <Badge tone="warn">Inactive</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right text-stone-600">{stats.totalVisits}</td>
                    <td className="px-4 py-2 text-right font-medium text-stone-800 whitespace-nowrap">{fmtINR(stats.totalSpend)}</td>
                    <td className="px-4 py-2 text-right text-stone-300">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal && <CustomerForm ctx={ctx} customer={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function CustomerForm({ ctx, customer, onClose }) {
  const { customers, saveCustomers, bills, membershipPlans, notify } = ctx;
  const isNew = !customer;
  const [name, setName] = useState(customer ? customer.name : '');
  const [phone, setPhone] = useState(customer ? customer.phone : '');
  const [dob, setDob] = useState(customer ? customer.dob : '');
  const [gender, setGender] = useState(customer ? customer.gender : '');
  const [membershipPlanId, setMembershipPlanId] = useState(customer ? customer.membershipPlanId : '');
  const [membershipStart, setMembershipStart] = useState(customer ? customer.membershipStart : '');
  const [membershipEnd, setMembershipEnd] = useState(customer ? customer.membershipEnd : '');

  const applyPlan = (planId) => {
    setMembershipPlanId(planId);
    const plan = membershipPlans.find(p => p.id === planId);
    if (plan) {
      const start = todayISO();
      const end = new Date(); end.setDate(end.getDate() + (plan.durationDays || 365));
      setMembershipStart(start);
      setMembershipEnd(localDateStr(end));
    } else {
      setMembershipStart(''); setMembershipEnd('');
    }
  };

  const stats = !isNew ? customerStats(customer.id, bills) : null;
  const history = !isNew ? bills.filter(b => b.customerId === customer.id).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8) : [];

  const submit = () => {
    if (!name.trim()) { notify('Enter a name'); return; }
    const dup = findCustomerByPhone(customers, phone, customer ? customer.id : null);
    if (dup) { notify(`${dup.name} already has this phone number — use their profile instead of creating a duplicate`); return; }
    const record = { id: customer ? customer.id : uid(), name: name.trim(), phone: (phone || '').trim(), dob: dob || '', gender: gender || '', joinDate: customer ? customer.joinDate : todayISO(), membershipPlanId: membershipPlanId || '', membershipStart: membershipStart || '', membershipEnd: membershipEnd || '' };
    if (isNew) saveCustomers([...customers, record]);
    else saveCustomers(customers.map(c => c.id === record.id ? record : c));
    notify(isNew ? 'Customer added' : 'Customer updated');
    onClose();
  };

  const remove = () => {
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return;
    saveCustomers(customers.filter(c => c.id !== customer.id));
    notify('Customer deleted');
    onClose();
  };

  return (
    <Modal title={isNew ? 'New Customer' : 'Edit Customer'} onClose={onClose} wide>
      {!isNew && stats && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard label="Total Visits" value={stats.totalVisits} />
          <StatCard label="Total Spend" value={fmtINR(stats.totalSpend)} />
          <StatCard label="Last Visit" value={fmtDate(stats.lastVisit)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Phone"><input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit number" /></Field>
        <Field label="Date of Birth"><input type="date" className={inputCls} value={dob || ''} onChange={e => setDob(e.target.value)} /></Field>
        <Field label="Gender">
          <select className={inputCls} value={gender || ''} onChange={e => setGender(e.target.value)}>
            <option value="">—</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
        </Field>
      </div>
      <Field label="Membership Plan">
        <select className={inputCls} value={membershipPlanId || ''} onChange={e => applyPlan(e.target.value)}>
          <option value="">No membership</option>
          {membershipPlans.map(p => <option key={p.id} value={p.id}>{p.name} — {p.discountPercent}% off</option>)}
        </select>
      </Field>
      {membershipPlanId && (
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Start Date"><input type="date" className={inputCls} value={membershipStart || ''} onChange={e => setMembershipStart(e.target.value)} /></Field>
          <Field label="End Date"><input type="date" className={inputCls} value={membershipEnd || ''} onChange={e => setMembershipEnd(e.target.value)} /></Field>
        </div>
      )}
      {!isNew && history.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Recent Visits</div>
          <div className="border border-stone-200 rounded-md divide-y divide-dotted divide-stone-200">
            {history.map(b => (
              <div key={b.id} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-stone-600">{fmtDate(b.date)}</span>
                <span className="text-stone-500">{b.items.length} service{b.items.length > 1 ? 's' : ''}</span>
                <span className="font-medium">{fmtINR(b.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- staff ---------------- */
function StaffView({ ctx }) {
  const { staff, bills, servicesById, setActiveTab } = ctx;
  const [modal, setModal] = useState(null);
  const weekStart = startOfWeek(new Date()), weekEnd = endOfWeek(new Date());
  return (
    <div>
      <SectionHeader title="Staff" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Staff</button>
      } />
      {staff.length === 0 ? <EmptyState title="No staff yet" sub="Add your team to start tracking performance." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium text-right">Customers (wk)</th>
                <th className="px-4 py-2 font-medium text-right">Revenue (wk)</th>
                <th className="px-4 py-2 font-medium text-right">ABV (wk)</th>
                <th className="px-4 py-2 font-medium text-right">Premium % (wk)</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {staff.map(s => {
                const m = computeStaffMetrics(bills, s.id, weekStart, weekEnd, servicesById);
                return (
                  <tr key={s.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(s)}>
                    <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{s.name}</td>
                    <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{s.role || '—'}</td>
                    <td className="px-4 py-2 text-right text-stone-600">{m.uniqueCustomers}</td>
                    <td className="px-4 py-2 text-right font-medium text-stone-800 whitespace-nowrap">{fmtINR(m.revenue)}</td>
                    <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(m.abv)}</td>
                    <td className="px-4 py-2 text-right text-stone-600">{m.premiumConversion.toFixed(0)}%</td>
                    <td className="px-4 py-2 text-right text-stone-300">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button onClick={() => setActiveTab('reports')} className="mt-3 text-xs text-amber-700">View full weekly report →</button>
      {modal && <StaffForm ctx={ctx} staffMember={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
function StaffForm({ ctx, staffMember, onClose }) {
  const { staff, saveStaff, notify } = ctx;
  const isNew = !staffMember;
  const [name, setName] = useState(staffMember ? staffMember.name : '');
  const [role, setRole] = useState(staffMember ? staffMember.role : '');
  const [phone, setPhone] = useState(staffMember ? staffMember.phone : '');
  const [monthlyTarget, setMonthlyTarget] = useState(staffMember ? (staffMember.monthlyTarget || 0) : 0);
  const [dailyTarget, setDailyTarget] = useState(staffMember ? (staffMember.dailyTarget || 0) : 0);
  const [incentivePercent, setIncentivePercent] = useState(staffMember ? (staffMember.incentivePercent || 5) : 5);
  const submit = () => {
    if (!name.trim()) { notify('Enter a name'); return; }
    const record = {
      id: staffMember ? staffMember.id : uid(), name: name.trim(), role: (role || '').trim(), phone: (phone || '').trim(),
      monthlyTarget: Number(monthlyTarget) || 0, dailyTarget: Number(dailyTarget) || 0, incentivePercent: Number(incentivePercent) || 0,
      joinDate: staffMember ? staffMember.joinDate : todayISO(),
    };
    if (isNew) saveStaff([...staff, record]); else saveStaff(staff.map(s => s.id === record.id ? record : s));
    notify(isNew ? 'Staff added' : 'Staff updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm(`Remove ${staffMember.name}?`)) return;
    saveStaff(staff.filter(s => s.id !== staffMember.id));
    notify('Staff removed');
    onClose();
  };
  return (
    <Modal title={isNew ? 'New Staff' : 'Edit Staff'} onClose={onClose}>
      <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Role"><input className={inputCls} value={role || ''} onChange={e => setRole(e.target.value)} placeholder="e.g. Senior Stylist" /></Field>
      <Field label="Phone"><input className={inputCls} value={phone || ''} onChange={e => setPhone(e.target.value)} /></Field>
      <Field label="Monthly Target (₹)"><input type="number" min="0" className={inputCls} value={monthlyTarget} onChange={e => setMonthlyTarget(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Daily Target (₹, for incentive)"><input type="number" min="0" className={inputCls} value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} /></Field>
        <Field label="Incentive % (of daily net sales, if target met)"><input type="number" min="0" max="100" className={inputCls} value={incentivePercent} onChange={e => setIncentivePercent(e.target.value)} /></Field>
      </div>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Remove</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- services ---------------- */
function ServicesView({ ctx }) {
  const { services, bills } = ctx;
  const [modal, setModal] = useState(null);
  const stats = computeServiceStats(bills, services);
  const maxRevenue = Math.max(1, ...stats.map(s => s.revenue));
  return (
    <div>
      <SectionHeader title="Services" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Service</button>
      } />
      {services.length === 0 ? <EmptyState title="No services yet" sub="Add services to your catalog to start billing." /> : (
        <div className="bg-white rounded-lg border border-stone-200 divide-y divide-dotted divide-stone-200">
          {stats.map(s => (
            <div key={s.service.id} className="px-4 py-3 hover:bg-stone-50 cursor-pointer" onClick={() => setModal(s.service)}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-800 text-sm">{s.service.name}</span>
                  <Badge tone={s.service.category === 'Premium' ? 'premium' : 'default'}>{s.service.category}</Badge>
                </div>
                <div className="text-sm text-stone-600">{fmtINR(s.revenue)} · {s.count}x</div>
              </div>
              <div className="w-full bg-stone-100 rounded-full h-1.5">
                <div className="bg-amber-600 h-1.5 rounded-full" style={{ width: `${(s.revenue / maxRevenue) * 100}%` }}></div>
              </div>
              <div className="text-xs text-stone-400 mt-1">
                Price {fmtINR(s.service.price)} · Standard {s.service.standardMins || 0} min · Avg actual {s.avgMins.toFixed(0)} min
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && <ServiceForm ctx={ctx} service={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
function ServiceForm({ ctx, service, onClose }) {
  const { services, saveServices, notify } = ctx;
  const isNew = !service;
  const [name, setName] = useState(service ? service.name : '');
  const [category, setCategory] = useState(service ? service.category : 'Regular');
  const [price, setPrice] = useState(service ? service.price : '');
  const [standardMins, setStandardMins] = useState(service ? service.standardMins : '');
  const submit = () => {
    if (!name.trim() || !price) { notify('Enter a name and price'); return; }
    const record = { id: service ? service.id : uid(), name: name.trim(), category, price: Number(price), standardMins: Number(standardMins) || 0 };
    if (isNew) saveServices([...services, record]); else saveServices(services.map(s => s.id === record.id ? record : s));
    notify(isNew ? 'Service added' : 'Service updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm(`Delete ${service.name}?`)) return;
    saveServices(services.filter(s => s.id !== service.id));
    notify('Service deleted');
    onClose();
  };
  return (
    <Modal title={isNew ? 'New Service' : 'Edit Service'} onClose={onClose}>
      <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Category">
        <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="Regular">Regular</option>
          <option value="Premium">Premium</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Price (₹)"><input type="number" className={inputCls} value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field label="Standard Duration (min)"><input type="number" className={inputCls} value={standardMins} onChange={e => setStandardMins(e.target.value)} /></Field>
      </div>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- memberships ---------------- */
function MembershipsView({ ctx }) {
  const { membershipPlans, customers } = ctx;
  const [modal, setModal] = useState(null);
  const members = customers.filter(c => c.membershipPlanId);
  const planName = (id) => { const p = membershipPlans.find(p => p.id === id); return p ? p.name : '—'; };
  return (
    <div>
      <SectionHeader title="Membership Plans" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Plan</button>
      } />
      {membershipPlans.length === 0 ? <EmptyState title="No membership plans yet" sub="Create a plan to start enrolling members." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden mb-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Duration</th><th className="px-4 py-2 font-medium">Price</th><th className="px-4 py-2 font-medium">Discount</th><th></th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {membershipPlans.map(p => (
                <tr key={p.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(p)}>
                  <td className="px-4 py-2 font-medium text-stone-800">{p.name}</td>
                  <td className="px-4 py-2 text-stone-600">{p.durationDays} days</td>
                  <td className="px-4 py-2 text-stone-600">{fmtINR(p.price)}</td>
                  <td className="px-4 py-2 text-stone-600">{p.discountPercent}%</td>
                  <td className="px-4 py-2 text-right text-stone-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="text-xl text-stone-800 mb-4" style={displayFont}>Members</h2>
      {members.length === 0 ? <EmptyState title="No members yet" sub="Assign a plan to a customer from their profile." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Ends</th><th className="px-4 py-2 font-medium">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {members.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-stone-800">{c.name}</td>
                  <td className="px-4 py-2 text-stone-600">{planName(c.membershipPlanId)}</td>
                  <td className="px-4 py-2 text-stone-600">{fmtDate(c.membershipEnd)}</td>
                  <td className="px-4 py-2"><Badge tone={membershipStatus(c) === 'Active' ? 'active' : 'danger'}>{membershipStatus(c)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <PlanForm ctx={ctx} plan={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
function PlanForm({ ctx, plan, onClose }) {
  const { membershipPlans, saveMembershipPlans, notify } = ctx;
  const isNew = !plan;
  const [name, setName] = useState(plan ? plan.name : '');
  const [durationDays, setDurationDays] = useState(plan ? plan.durationDays : 365);
  const [price, setPrice] = useState(plan ? plan.price : '');
  const [discountPercent, setDiscountPercent] = useState(plan ? plan.discountPercent : 10);
  const submit = () => {
    if (!name.trim()) { notify('Enter a plan name'); return; }
    const record = { id: plan ? plan.id : uid(), name: name.trim(), durationDays: Number(durationDays), price: Number(price) || 0, discountPercent: Number(discountPercent) || 0 };
    if (isNew) saveMembershipPlans([...membershipPlans, record]); else saveMembershipPlans(membershipPlans.map(p => p.id === record.id ? record : p));
    notify(isNew ? 'Plan added' : 'Plan updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm(`Delete ${plan.name}?`)) return;
    saveMembershipPlans(membershipPlans.filter(p => p.id !== plan.id));
    notify('Plan deleted');
    onClose();
  };
  return (
    <Modal title={isNew ? 'New Plan' : 'Edit Plan'} onClose={onClose}>
      <Field label="Plan Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-x-4">
        <Field label="Duration (days)"><input type="number" className={inputCls} value={durationDays} onChange={e => setDurationDays(e.target.value)} /></Field>
        <Field label="Price (₹)"><input type="number" className={inputCls} value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field label="Discount %"><input type="number" className={inputCls} value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} /></Field>
      </div>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- enquiries ---------------- */
const ENQUIRY_STATUSES = ['Pending', 'Converted', 'Closed'];
const ENQUIRY_SOURCES = ['In-Salon', 'JustDial', 'Phone', 'Whatsapp', 'Instagram'];
function statusTone(status) {
  if (status === 'Converted') return 'active';
  if (status === 'Closed') return 'danger';
  return 'warn';
}
function EnquiriesView({ ctx }) {
  const { enquiries, services } = ctx;
  const [modal, setModal] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const servicesById = ctx.servicesById;
  const filtered = statusFilter ? enquiries.filter(e => e.status === statusFilter) : enquiries;
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <div>
      <SectionHeader title="Enquiries" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Enquiry</button>
      } />
      <div className="mb-4 flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={`text-xs px-3 py-1.5 rounded-full ${statusFilter === '' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>All</button>
        {ENQUIRY_STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`text-xs px-3 py-1.5 rounded-full ${statusFilter === s ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>{s}</button>
        ))}
      </div>
      {enquiries.length === 0 ? <EmptyState title="No enquiries logged yet" sub="Track walk-in and phone enquiries here, even before they become a paid visit." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Location</th>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Follow-up</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {sorted.map(e => (
                <tr key={e.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(e)}>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{e.customerName}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{e.phone || '—'}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{e.location || '—'}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{(servicesById[e.serviceId] && servicesById[e.serviceId].name) || e.serviceInterested || '—'}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{e.followUpDate ? fmtDate(e.followUpDate) + (e.followUpTime ? ' ' + e.followUpTime : '') : '—'}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{e.source || '—'}</td>
                  <td className="px-4 py-2"><Badge tone={statusTone(e.status)}>{e.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <EnquiryForm ctx={ctx} enquiry={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
function EnquiryForm({ ctx, enquiry, onClose }) {
  const { enquiries, saveEnquiries, services, notify } = ctx;
  const isNew = !enquiry;
  const [customerName, setCustomerName] = useState(enquiry ? enquiry.customerName : '');
  const [phone, setPhone] = useState(enquiry ? enquiry.phone : '');
  const [location, setLocation] = useState(enquiry ? enquiry.location : '');
  const [date, setDate] = useState(enquiry ? enquiry.date : todayISO());
  const [serviceId, setServiceId] = useState(enquiry ? enquiry.serviceId : '');
  const [notes, setNotes] = useState(enquiry ? enquiry.notes : '');
  const [followUpDate, setFollowUpDate] = useState(enquiry ? enquiry.followUpDate : '');
  const [followUpTime, setFollowUpTime] = useState(enquiry ? (enquiry.followUpTime || '') : '');
  const [source, setSource] = useState(enquiry ? enquiry.source : ENQUIRY_SOURCES[0]);
  const [status, setStatus] = useState(enquiry ? enquiry.status : 'Pending');

  const submit = () => {
    if (!customerName.trim()) { notify('Enter a client name'); return; }
    const record = {
      id: enquiry ? enquiry.id : uid(), customerName: customerName.trim(), phone: (phone || '').trim(),
      location: location.trim(), date, serviceId, notes: notes.trim(), followUpDate, followUpTime, source, status,
    };
    if (isNew) saveEnquiries([...enquiries, record]); else saveEnquiries(enquiries.map(e => e.id === record.id ? record : e));
    notify(isNew ? 'Enquiry logged' : 'Enquiry updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm('Delete this enquiry?')) return;
    saveEnquiries(enquiries.filter(e => e.id !== enquiry.id));
    notify('Enquiry deleted');
    onClose();
  };

  return (
    <Modal title={isNew ? 'New Enquiry' : 'Edit Enquiry'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Client Name"><input className={inputCls} value={customerName} onChange={e => setCustomerName(e.target.value)} /></Field>
        <Field label="Contact Number"><input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Location"><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Anna Nagar" /></Field>
        <Field label="Enquiry Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Enquiry For Which Service">
        <select className={inputCls} value={serviceId} onChange={e => setServiceId(e.target.value)}>
          <option value="">Select service…</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Notes"><textarea className={inputCls} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add updates as the enquiry progresses" /></Field>
      <div className="grid grid-cols-4 gap-x-4">
        <Field label="Follow-up Date"><input type="date" className={inputCls} value={followUpDate || ''} onChange={e => setFollowUpDate(e.target.value)} /></Field>
        <Field label="Follow-up Time"><input type="time" className={inputCls} value={followUpTime || ''} onChange={e => setFollowUpTime(e.target.value)} /></Field>
        <Field label="Source of Enquiry">
          <select className={inputCls} value={source} onChange={e => setSource(e.target.value)}>
            {ENQUIRY_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Lead Status">
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
            {ENQUIRY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="text-xs text-stone-400 -mt-3 mb-3">Set both date and time to get a "Follow-Ups Due" reminder on the Dashboard within 2 hours of this time.</div>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- appointments ---------------- */
const APPOINTMENT_SOURCES = ['In-Salon', 'JustDial', 'Phone', 'Whatsapp', 'Instagram'];
const APPOINTMENT_STATUSES = ['Upcoming', 'Completed', 'Cancelled', 'No-show'];
function appointmentStatusTone(status) {
  if (status === 'Completed') return 'active';
  if (status === 'Cancelled' || status === 'No-show') return 'danger';
  return 'premium';
}
function AppointmentsView({ ctx }) {
  const { appointments } = ctx;
  const [modal, setModal] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const now = new Date();
  const upcoming = appointments.filter(a => new Date(a.dateTime) >= now && a.status === 'Upcoming');
  const others = appointments.filter(a => !(new Date(a.dateTime) >= now && a.status === 'Upcoming'));
  const list = (showPast ? [...upcoming, ...others] : upcoming).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
  return (
    <div>
      <SectionHeader title="Appointments" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Appointment</button>
      } />
      <div className="mb-4">
        <button onClick={() => setShowPast(v => !v)} className="text-xs px-3 py-1.5 rounded-full bg-stone-100 text-stone-600">{showPast ? 'Showing all' : 'Showing upcoming only'} — click to toggle</button>
      </div>
      {appointments.length === 0 ? <EmptyState title="No appointments yet" sub="Book a customer in for a future visit here." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Date &amp; Time</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">WhatsApp</th>
                <th className="px-4 py-2 font-medium">Gender</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {list.map(a => (
                <tr key={a.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(a)}>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDateTime(a.dateTime)}</td>
                  <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{a.name}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{a.phone || '—'}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{a.whatsapp || '—'}</td>
                  <td className="px-4 py-2 text-stone-600">{a.gender || '—'}</td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{a.source || '—'}</td>
                  <td className="px-4 py-2"><Badge tone={appointmentStatusTone(a.status)}>{a.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <AppointmentForm ctx={ctx} appointment={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
function AppointmentForm({ ctx, appointment, onClose }) {
  const { appointments, saveAppointments, notify } = ctx;
  const isNew = !appointment;
  const [name, setName] = useState(appointment ? appointment.name : '');
  const [phone, setPhone] = useState(appointment ? appointment.phone : '');
  const [whatsapp, setWhatsapp] = useState(appointment ? appointment.whatsapp : '');
  const [dateTime, setDateTime] = useState(appointment ? appointment.dateTime : '');
  const [gender, setGender] = useState(appointment ? appointment.gender : '');
  const [source, setSource] = useState(appointment ? appointment.source : APPOINTMENT_SOURCES[0]);
  const [status, setStatus] = useState(appointment ? appointment.status : 'Upcoming');

  const submit = () => {
    if (!name.trim()) { notify('Enter a name'); return; }
    if (!dateTime) { notify('Pick an appointment date and time'); return; }
    const record = { id: appointment ? appointment.id : uid(), name: name.trim(), phone: (phone || '').trim(), whatsapp: (whatsapp || '').trim(), dateTime, gender, source, status };
    if (isNew) saveAppointments([...appointments, record]); else saveAppointments(appointments.map(a => a.id === record.id ? record : a));
    notify(isNew ? 'Appointment booked' : 'Appointment updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm('Delete this appointment?')) return;
    saveAppointments(appointments.filter(a => a.id !== appointment.id));
    notify('Appointment deleted');
    onClose();
  };
  const sameAsPhone = () => setWhatsapp(phone);

  return (
    <Modal title={isNew ? 'New Appointment' : 'Edit Appointment'} onClose={onClose}>
      <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Contact Number"><input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        <Field label="WhatsApp Number">
          <div className="flex gap-2">
            <input className={inputCls} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
            <button type="button" onClick={sameAsPhone} className="text-xs px-2 rounded-md border border-stone-300 text-stone-600 whitespace-nowrap">Same</button>
          </div>
        </Field>
      </div>
      <Field label="Appointment Date &amp; Time"><input type="datetime-local" className={inputCls} value={dateTime} onChange={e => setDateTime(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-x-4">
        <Field label="Gender">
          <select className={inputCls} value={gender} onChange={e => setGender(e.target.value)}>
            <option value="">—</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
        </Field>
        <Field label="Source">
          <select className={inputCls} value={source} onChange={e => setSource(e.target.value)}>
            {APPOINTMENT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
            {APPOINTMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- attendance ---------------- */
const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Half Day', 'On Leave', 'Week Off'];

function getAttendanceMapForDate(attendance, date, staffList) {
  const map = {};
  staffList.forEach(s => { map[s.id] = 'Present'; });
  attendance.filter(a => a.date === date).forEach(a => { map[a.staffId] = a.status; });
  return map;
}

function AttendanceView({ ctx }) {
  const { staff, attendance, saveAttendance, notify } = ctx;
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState(() => getAttendanceMapForDate(attendance, todayISO(), staff));
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return localDateStr(d); });
  const [toDate, setToDate] = useState(todayISO());

  if (staff.length === 0) {
    return (
      <div>
        <SectionHeader title="Attendance" />
        <EmptyState title="Add staff first" sub="Attendance is marked per staff member — add your team under Staff, then come back here." />
      </div>
    );
  }

  const savedForDate = getAttendanceMapForDate(attendance, date, staff);
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(savedForDate);

  const loadDate = (newDate) => {
    setDate(newDate);
    setDraft(getAttendanceMapForDate(attendance, newDate, staff));
  };
  const handleDateChange = (newDate) => {
    if (hasUnsavedChanges && !window.confirm(`You have unsaved changes for ${fmtDate(date)}. Switch dates and lose them?`)) return;
    loadDate(newDate);
  };

  const setStatus = (staffId, status) => setDraft(prev => ({ ...prev, [staffId]: status }));
  const markAllPresent = () => { const all = {}; staff.forEach(s => { all[s.id] = 'Present'; }); setDraft(all); };

  const saveAttendanceForDate = () => {
    const others = attendance.filter(a => a.date !== date);
    const existingForDate = attendance.filter(a => a.date === date);
    const newRecords = staff.map(s => {
      const existing = existingForDate.find(a => a.staffId === s.id);
      return { id: existing ? existing.id : uid(), staffId: s.id, date, status: draft[s.id] || 'Present' };
    });
    saveAttendance([...others, ...newRecords]);
    notify(`Attendance saved for ${fmtDate(date)}`);
  };

  const counts = ATTENDANCE_STATUSES.reduce((acc, st) => {
    acc[st] = Object.values(draft).filter(v => v === st).length;
    return acc;
  }, {});

  const pillClass = (st, isActive) => {
    if (!isActive) return 'bg-white text-stone-500 border-stone-300 hover:bg-stone-50';
    if (st === 'Present') return 'bg-emerald-600 text-white border-emerald-600';
    if (st === 'Absent') return 'bg-red-600 text-white border-red-600';
    if (st === 'On Leave') return 'bg-amber-600 text-white border-amber-600';
    if (st === 'Week Off') return 'bg-rose-600 text-white border-rose-600';
    return 'bg-stone-700 text-white border-stone-700';
  };

  const exportAttendanceCSV = () => {
    const from = new Date(fromDate); const to = new Date(toDate); to.setHours(23, 59, 59, 999);
    const staffById2 = {}; staff.forEach(s => { staffById2[s.id] = s; });
    const rows = attendance
      .filter(a => { const d = new Date(a.date); return d >= from && d <= to; })
      .map(a => ({ Staff: staffById2[a.staffId] ? staffById2[a.staffId].name : 'Unknown', Role: staffById2[a.staffId] ? staffById2[a.staffId].role : '', Date: fmtDate(a.date), Status: a.status }))
      .sort((a, b) => a.Date.localeCompare(b.Date));
    if (!rows.length) { notify('No attendance marked in that date range yet'); return; }
    downloadText(`attendance-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl text-stone-800" style={displayFont}>Attendance</h2>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => handleDateChange(e.target.value)} className={inputCls} style={{ width: '160px' }} />
          <button onClick={markAllPresent} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50">Mark All Present</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard label="Present" value={counts['Present'] || 0} tone="accent" />
        <StatCard label="Absent" value={counts['Absent'] || 0} />
        <StatCard label="Half Day" value={counts['Half Day'] || 0} />
        <StatCard label="On Leave" value={counts['On Leave'] || 0} />
        <StatCard label="Week Off" value={counts['Week Off'] || 0} />
      </div>

      <div className="bg-white rounded-lg border border-stone-200 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Staff</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dotted divide-stone-200">
            {staff.map(s => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium text-stone-800 whitespace-nowrap">{s.name}</td>
                <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{s.role}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {ATTENDANCE_STATUSES.map(st => (
                      <button key={st} onClick={() => setStatus(s.id, st)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${pillClass(st, draft[s.id] === st)}`}>
                        {st}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className={`text-xs ${hasUnsavedChanges ? 'text-amber-700 font-medium' : 'text-stone-400'}`}>
          {hasUnsavedChanges ? `Unsaved changes for ${fmtDate(date)}` : `Saved for ${fmtDate(date)}`}
        </div>
        <button onClick={saveAttendanceForDate} className="text-sm px-4 py-2 rounded-md bg-amber-700 text-white">Save Attendance</button>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 p-4">
        <div className="text-sm font-medium text-stone-700 mb-3">Export Attendance Report</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inputCls} /></Field>
          <Field label="To"><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inputCls} /></Field>
          <button onClick={exportAttendanceCSV} className="text-sm px-3 py-2 rounded-md bg-amber-700 text-white h-10">Export CSV</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- shift roster ---------------- */
function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
const ROSTER_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function getWeekDatesFromOffset(weekOffset) {
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  return ROSTER_DAY_LABELS.map((label, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return { day: label, date: dt, dateStr: localDateStr(dt) };
  });
}

const SHIFTS = [
  { code: '10-7', label: '10 AM – 7 PM' },
  { code: '11-8', label: '11 AM – 8 PM' },
  { code: '12-9', label: '12 PM – 9 PM' },
];
const SHIFT_CODES = SHIFTS.map(s => s.code);
function normalizeShiftStatus(status) {
  // Existing rosters saved before shift-tracking only ever stored 'Working' or
  // 'Week Off' -- treat a legacy 'Working' as the first shift so old data
  // still displays sensibly without needing a migration.
  if (status === 'Week Off') return 'Week Off';
  if (SHIFT_CODES.includes(status)) return status;
  return SHIFT_CODES[0];
}
function shiftLabel(status) {
  if (status === 'Week Off') return 'Week Off';
  const s = SHIFTS.find(s => s.code === normalizeShiftStatus(status));
  return s ? s.label : status;
}

function RosterView({ ctx }) {
  const { staff, roster, saveRoster, notify } = ctx;
  const [weekOffset, setWeekOffset] = useState(0);
  const [showShare, setShowShare] = useState(false);

  if (staff.length === 0) {
    return (
      <div>
        <SectionHeader title="Weekly Shift Roster" />
        <EmptyState title="Add staff first" sub="Assign shifts and week-offs per staff member — add your team under Staff, then come back here." />
      </div>
    );
  }

  const weekDates = getWeekDatesFromOffset(weekOffset);
  const getStatus = (staffId, dateStr) => {
    const rec = roster.find(r => r.staffId === staffId && r.date === dateStr);
    return normalizeShiftStatus(rec ? rec.status : SHIFT_CODES[0]);
  };
  const weekOffCount = (staffId) => weekDates.filter(wd => getStatus(staffId, wd.dateStr) === 'Week Off').length;

  const setShift = (staffId, dateStr, status) => {
    const existing = roster.find(r => r.staffId === staffId && r.date === dateStr);
    const newRoster = existing
      ? roster.map(r => r.id === existing.id ? { ...r, status } : r)
      : [...roster, { id: uid(), staffId, date: dateStr, status }];
    saveRoster(newRoster);
  };

  const autoAssign = () => {
    const weekDateStrs = weekDates.map(wd => wd.dateStr);
    const kept = roster.filter(r => !weekDateStrs.includes(r.date));
    const generated = [];
    staff.forEach((s, i) => {
      weekDates.forEach((wd, di) => {
        const status = (di === (i + 1) % 7) ? 'Week Off' : SHIFT_CODES[i % SHIFT_CODES.length];
        generated.push({ id: uid(), staffId: s.id, date: wd.dateStr, status });
      });
    });
    saveRoster([...kept, ...generated]);
    notify('Shifts auto-assigned — review and adjust as needed');
  };

  const exportRosterCSV = () => {
    const rows = staff.map(s => {
      const row = { Staff: s.name, Role: s.role };
      weekDates.forEach(wd => { row[`${wd.day} (${fmtDate(wd.dateStr)})`] = shiftLabel(getStatus(s.id, wd.dateStr)); });
      row['Week Offs'] = weekOffCount(s.id);
      return row;
    });
    downloadText(`shift-roster-week-of-${weekDates[0].dateStr}.csv`, toCSV(rows), 'text/csv');
  };

  const scheduleMessage = (s) => {
    const lines = weekDates.map(wd => `${wd.day} ${fmtDate(wd.dateStr)}: ${shiftLabel(getStatus(s.id, wd.dateStr))}`).join('\n');
    return `Hi ${s.name}, here's your schedule for the week of ${fmtDate(weekDates[0].dateStr)} – ${fmtDate(weekDates[6].dateStr)}:\n${lines}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl text-stone-800" style={displayFont}>Weekly Shift Roster</h2>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setWeekOffset(w => w - 1)} className="px-2 py-1 rounded border border-stone-300">←</button>
          <span className="text-stone-600">Week of {fmtDate(weekDates[0].dateStr)} – {fmtDate(weekDates[6].dateStr)}</span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="px-2 py-1 rounded border border-stone-300">→</button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs text-stone-500 flex-wrap">
          {SHIFTS.map(s => <span key={s.code} className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-white border border-stone-300 inline-block"></span> {s.code} ({s.label})</span>)}
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-600 inline-block"></span> Week Off</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={autoAssign} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50">Auto-Assign Shifts</button>
          <button onClick={exportRosterCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50">Export CSV</button>
          <button onClick={() => setShowShare(true)} className="text-xs px-3 py-1.5 rounded-md bg-amber-700 text-white">Publish &amp; Share</button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium whitespace-nowrap">Staff</th>
              {weekDates.map(wd => (
                <th key={wd.dateStr} className="px-2 py-2 font-medium text-center whitespace-nowrap">
                  <div>{wd.day}</div>
                  <div className="text-stone-400 normal-case font-normal">{fmtDate(wd.dateStr)}</div>
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-center whitespace-nowrap">Week Offs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dotted divide-stone-200">
            {staff.map(s => {
              const count = weekOffCount(s.id);
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-stone-800 whitespace-nowrap">{s.name}</td>
                  {weekDates.map(wd => {
                    const status = getStatus(s.id, wd.dateStr);
                    const isOff = status === 'Week Off';
                    return (
                      <td key={wd.dateStr} className="px-1.5 py-2 text-center">
                        <select
                          value={status}
                          onChange={e => setShift(s.id, wd.dateStr, e.target.value)}
                          title={shiftLabel(status)}
                          className={`w-full rounded-md py-1.5 text-xs font-medium text-center transition border cursor-pointer ${isOff ? 'bg-rose-600 text-white border-rose-600' : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'}`}>
                          {SHIFTS.map(sh => <option key={sh.code} value={sh.code}>{sh.code}</option>)}
                          <option value="Week Off">OFF</option>
                        </select>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    {count === 1 ? <Badge tone="active">1 ✓</Badge> : count === 0 ? <Badge tone="danger">0 ⚠</Badge> : <Badge tone="warn">{count}</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-stone-400 mt-3">Pick a shift (10-7, 11-8, 12-9) or Week Off for each day. "Auto-Assign" staggers shifts and days off across staff.</div>


      {showShare && (
        <Modal title="Publish & Share via WhatsApp" onClose={() => setShowShare(false)}>
          <p className="text-sm text-stone-500 mb-4">
            Sends each employee their own schedule for the week of {fmtDate(weekDates[0].dateStr)} – {fmtDate(weekDates[6].dateStr)}.
            WhatsApp needs one message per person, so send each individually below.
          </p>
          <div className="divide-y divide-dotted divide-stone-200 border border-stone-200 rounded-md">
            {staff.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-stone-800">{s.name}</div>
                  <div className="text-xs text-stone-400">{s.phone || 'No phone on file'} · {weekOffCount(s.id)} day{weekOffCount(s.id) === 1 ? '' : 's'} off</div>
                </div>
                {s.phone ? (
                  <a href={waLink(s.phone, scheduleMessage(s))} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white">Send via WhatsApp</a>
                ) : <span className="text-xs text-stone-300">No phone</span>}
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={() => setShowShare(false)} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- makeup bookings ---------------- */
const MAKEUP_TYPES = ['Bride', 'Groom', 'Party'];
function makeupBalance(price, advance) { return Math.max(0, (Number(price) || 0) - (Number(advance) || 0)); }
function makeupTypeTone(type) {
  if (type === 'Bride') return 'premium';
  if (type === 'Groom') return 'active';
  return 'warn';
}

function MakeupBookingsView({ ctx }) {
  const { makeupBookings, staffById } = ctx;
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState(null);
  const filtered = typeFilter ? makeupBookings.filter(m => m.type === typeFilter) : makeupBookings;
  const sorted = [...filtered].sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));

  return (
    <div>
      <SectionHeader title="Makeup Bookings" action={
        <button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Booking</button>
      } />
      <div className="mb-4 flex gap-2 flex-wrap">
        <button onClick={() => setTypeFilter('')} className={`text-xs px-3 py-1.5 rounded-full ${typeFilter === '' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>All</button>
        {MAKEUP_TYPES.map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} className={`text-xs px-3 py-1.5 rounded-full ${typeFilter === t ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>{t}</button>
        ))}
      </div>
      {makeupBookings.length === 0 ? <EmptyState title="No makeup bookings yet" sub="Log a Bride, Groom, or Party makeup package once a client confirms." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Date &amp; Time</th>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium text-right">Price</th>
                <th className="px-4 py-2 font-medium text-right">Advance</th>
                <th className="px-4 py-2 font-medium text-right">Balance</th>
                <th className="px-4 py-2 font-medium">Next Due</th>
                <th className="px-4 py-2 font-medium">Artist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {sorted.map(m => (
                <tr key={m.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(m)}>
                  <td className="px-4 py-2"><Badge tone={makeupTypeTone(m.type)}>{m.type}</Badge></td>
                  <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{m.clientName}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{m.dateTime}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{m.venue || '—'}</td>
                  <td className="px-4 py-2 text-right text-stone-800 whitespace-nowrap">{fmtINR(m.price)}</td>
                  <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(m.advanceReceived)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <span className={makeupBalance(m.price, m.advanceReceived) > 0 ? 'text-amber-700 font-medium' : 'text-emerald-700'}>{fmtINR(makeupBalance(m.price, m.advanceReceived))}</span>
                  </td>
                  <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{m.nextDueDate ? fmtDate(m.nextDueDate) : '—'}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{staffById[m.makeupArtistId] ? staffById[m.makeupArtistId].name : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <MakeupBookingForm ctx={ctx} booking={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function MakeupBookingForm({ ctx, booking, onClose }) {
  const { makeupBookings, saveMakeupBookings, staff, notify } = ctx;
  const isNew = !booking;
  const [type, setType] = useState(booking ? booking.type : 'Bride');
  const [clientName, setClientName] = useState(booking ? booking.clientName : '');
  const [phone, setPhone] = useState(booking ? booking.phone : '');
  const [dateTime, setDateTime] = useState(booking ? booking.dateTime : '');
  const [venue, setVenue] = useState(booking ? booking.venue : '');
  const [location, setLocation] = useState(booking ? booking.location : '');
  const [price, setPrice] = useState(booking ? booking.price : '');
  const [advanceReceived, setAdvanceReceived] = useState(booking ? booking.advanceReceived : '');
  const [nextDueDate, setNextDueDate] = useState(booking ? booking.nextDueDate : '');
  const [servicesIncluded, setServicesIncluded] = useState(booking ? booking.servicesIncluded : false);
  const [servicesList, setServicesList] = useState(booking ? booking.servicesList : '');
  const [servicesDate, setServicesDate] = useState(booking ? booking.servicesDate : '');
  const [flower, setFlower] = useState(booking ? booking.flower : false);
  const [jewel, setJewel] = useState(booking ? booking.jewel : false);
  const [sareeDrapingCount, setSareeDrapingCount] = useState(booking ? booking.sareeDrapingCount : 0);
  const [makeupSessionCount, setMakeupSessionCount] = useState(booking ? booking.makeupSessionCount : 1);
  const [trialCompletionDate, setTrialCompletionDate] = useState(booking ? booking.trialCompletionDate : '');
  const [makeupArtistId, setMakeupArtistId] = useState(booking ? booking.makeupArtistId : '');

  const balance = makeupBalance(price, advanceReceived);

  const submit = () => {
    if (!clientName.trim()) { notify('Enter the client name'); return; }
    if (!dateTime.trim()) { notify('Enter the function date & time'); return; }
    const record = {
      id: booking ? booking.id : uid(), type, clientName: clientName.trim(), phone: (phone || '').trim(),
      dateTime: dateTime.trim(), venue: venue.trim(), location: location.trim(),
      price: Number(price) || 0, advanceReceived: Number(advanceReceived) || 0, balanceAmount: balance,
      nextDueDate, servicesIncluded, servicesList: servicesIncluded ? servicesList.trim() : '', servicesDate: servicesIncluded ? servicesDate : '',
      flower, jewel, sareeDrapingCount: Number(sareeDrapingCount) || 0, makeupSessionCount: Number(makeupSessionCount) || 0,
      trialCompletionDate, makeupArtistId,
    };
    if (isNew) saveMakeupBookings([...makeupBookings, record]);
    else saveMakeupBookings(makeupBookings.map(m => m.id === record.id ? record : m));
    notify(isNew ? 'Makeup booking added' : 'Makeup booking updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm(`Delete this ${type.toLowerCase()} makeup booking for ${clientName}?`)) return;
    saveMakeupBookings(makeupBookings.filter(m => m.id !== booking.id));
    notify('Booking deleted');
    onClose();
  };

  const YesNo = ({ label, value, onChange }) => (
    <Field label={label}>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(true)} className={`flex-1 text-sm py-2 rounded-md border ${value ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>Yes</button>
        <button type="button" onClick={() => onChange(false)} className={`flex-1 text-sm py-2 rounded-md border ${!value ? 'bg-stone-700 text-white border-stone-700' : 'bg-white text-stone-600 border-stone-300'}`}>No</button>
      </div>
    </Field>
  );

  return (
    <Modal title={isNew ? 'New Makeup Booking' : `Edit Booking — ${booking.clientName}`} onClose={onClose} wide>
      <div className="flex gap-2 mb-4">
        {MAKEUP_TYPES.map(t => (
          <button key={t} type="button" onClick={() => setType(t)} className={`flex-1 text-sm py-2 rounded-md border ${type === t ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>{t}</button>
        ))}
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 mt-4">Client &amp; Event</div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Client Name"><input className={inputCls} value={clientName} onChange={e => setClientName(e.target.value)} /></Field>
        <Field label="Contact Number"><input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Date &amp; Time (note multiple sessions here if needed)">
        <input className={inputCls} value={dateTime} onChange={e => setDateTime(e.target.value)} placeholder="e.g. Trial: 12 Sep 4pm, Function: 14 Sep 6am" />
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Function Venue"><input className={inputCls} value={venue} onChange={e => setVenue(e.target.value)} /></Field>
        <Field label="Client Location"><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} /></Field>
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 mt-4">Package &amp; Payment</div>
      <div className="grid grid-cols-3 gap-x-4">
        <Field label="Price of Package (₹)"><input type="number" min="0" className={inputCls} value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field label="Advance Received (₹)"><input type="number" min="0" className={inputCls} value={advanceReceived} onChange={e => setAdvanceReceived(e.target.value)} /></Field>
        <Field label="Balance (auto)"><input className={inputCls} value={fmtINR(balance)} disabled style={{ backgroundColor: '#f5f5f4' }} /></Field>
      </div>
      <Field label="Next Due Date"><input type="date" className={inputCls} value={nextDueDate || ''} onChange={e => setNextDueDate(e.target.value)} /></Field>

      <div className="text-xs font-medium text-stone-500 mb-2 mt-4">Services &amp; Extras</div>
      <YesNo label="Services Included" value={servicesIncluded} onChange={setServicesIncluded} />
      {servicesIncluded && (
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="List of Services"><textarea className={inputCls} rows={2} value={servicesList} onChange={e => setServicesList(e.target.value)} placeholder="e.g. Mehendi, Hairdo" /></Field>
          <Field label="Date Services Provided"><input type="date" className={inputCls} value={servicesDate || ''} onChange={e => setServicesDate(e.target.value)} /></Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4">
        <YesNo label="Flower" value={flower} onChange={setFlower} />
        <YesNo label="Jewel" value={jewel} onChange={setJewel} />
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="No. of Sarees to Drape"><input type="number" min="0" className={inputCls} value={sareeDrapingCount} onChange={e => setSareeDrapingCount(e.target.value)} /></Field>
        <Field label="No. of Makeup Sessions"><input type="number" min="0" className={inputCls} value={makeupSessionCount} onChange={e => setMakeupSessionCount(e.target.value)} /></Field>
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 mt-4">Trial &amp; Assignment</div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Trial Completion Date"><input type="date" className={inputCls} value={trialCompletionDate || ''} onChange={e => setTrialCompletionDate(e.target.value)} /></Field>
        <Field label="Makeup Artist Assigned">
          <select className={inputCls} value={makeupArtistId} onChange={e => setMakeupArtistId(e.target.value)}>
            <option value="">Select staff…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- product inventory ---------------- */
function calcMargin(landing, sale) {
  const s = Number(sale) || 0;
  if (!s) return 0;
  return ((s - (Number(landing) || 0)) / s) * 100;
}
function monthsUntil(dateStr) {
  if (!dateStr) return 999;
  const d = new Date(dateStr); const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function InventoryView({ ctx }) {
  const [tab, setTab] = useState('add');
  return (
    <div>
      <SectionHeader title="Product Inventory" />
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('add')} className={`text-sm px-3 py-1.5 rounded-full ${tab === 'add' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Add Stock</button>
        <button onClick={() => setTab('current')} className={`text-sm px-3 py-1.5 rounded-full ${tab === 'current' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Current Stock</button>
      </div>
      {tab === 'add' ? <AddStockView ctx={ctx} onSaved={() => setTab('current')} /> : <CurrentStockView ctx={ctx} />}
    </div>
  );
}

function AddStockView({ ctx, onSaved }) {
  const { stockEntries, saveStockEntries, notify } = ctx;
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [paymentStatus, setPaymentStatus] = useState('Completed');
  const [dueDate, setDueDate] = useState('');
  const [products, setProducts] = useState([{ id: uid(), product: '', volumeMl: '', type: 'Retail', landingPrice: '', salePrice: '', quantity: '', expiryDate: '' }]);

  const updateProduct = (id, patch) => setProducts(products.map(p => p.id === id ? { ...p, ...patch } : p));
  const addRow = () => setProducts([...products, { id: uid(), product: '', volumeMl: '', type: 'Retail', landingPrice: '', salePrice: '', quantity: '', expiryDate: '' }]);
  const removeRow = (id) => setProducts(products.filter(p => p.id !== id));

  const save = () => {
    if (!vendorName.trim()) { notify('Enter a vendor name'); return; }
    const validProducts = products.filter(p => p.product.trim());
    if (!validProducts.length) { notify('Add at least one product'); return; }
    const entry = {
      id: uid(), vendorName: vendorName.trim(), vendorContact: vendorContact.trim(), gstNumber: gstNumber.trim(),
      invoiceAmount: Number(invoiceAmount) || 0, purchaseDate, paymentStatus, dueDate,
      products: validProducts.map(p => ({ ...p, landingPrice: Number(p.landingPrice) || 0, salePrice: Number(p.salePrice) || 0, quantity: Number(p.quantity) || 0 })),
    };
    saveStockEntries([...stockEntries, entry]);
    notify('Stock entry saved');
    onSaved && onSaved();
  };

  return (
    <div>
      <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
        <div className="text-sm font-medium text-stone-700 mb-3">Vendor / Invoice Details</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4">
          <Field label="Vendor Name"><input className={inputCls} value={vendorName} onChange={e => setVendorName(e.target.value)} /></Field>
          <Field label="Contact Number"><input className={inputCls} value={vendorContact} onChange={e => setVendorContact(e.target.value)} /></Field>
          <Field label="GST Number"><input className={inputCls} value={gstNumber} onChange={e => setGstNumber(e.target.value)} /></Field>
          <Field label="Invoice Amount (₹)"><input type="number" className={inputCls} value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} /></Field>
          <Field label="Date of Purchase"><input type="date" className={inputCls} value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></Field>
          <Field label="Payment Status">
            <select className={inputCls} value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>
              <option value="Completed">Completed</option>
              <option value="Due">Due — enter date</option>
            </select>
          </Field>
        </div>
        {paymentStatus === 'Due' && (
          <Field label="Due Date"><input type="date" className={inputCls} value={dueDate || ''} onChange={e => setDueDate(e.target.value)} /></Field>
        )}
      </div>

      <div className="text-sm font-medium text-stone-700 mb-3">Products in This Invoice</div>
      <div className="space-y-3 mb-4">
        {products.map(p => {
          const margin = calcMargin(p.landingPrice, p.salePrice);
          return (
            <div key={p.id} className="bg-white rounded-lg border border-stone-200 p-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Product"><input className={inputCls} value={p.product} onChange={e => updateProduct(p.id, { product: e.target.value })} /></Field>
                <Field label="Volume (ml)"><input type="number" className={inputCls} value={p.volumeMl} onChange={e => updateProduct(p.id, { volumeMl: e.target.value })} /></Field>
                <Field label="Type">
                  <select className={inputCls} value={p.type} onChange={e => updateProduct(p.id, { type: e.target.value })}>
                    <option value="Retail">Retail</option>
                    <option value="Salon Use">Salon Use</option>
                  </select>
                </Field>
                <Field label="Quantity"><input type="number" className={inputCls} value={p.quantity} onChange={e => updateProduct(p.id, { quantity: e.target.value })} /></Field>
                <Field label="Landing Price (₹)"><input type="number" className={inputCls} value={p.landingPrice} onChange={e => updateProduct(p.id, { landingPrice: e.target.value })} /></Field>
                <Field label="Sale Price (₹)"><input type="number" className={inputCls} value={p.salePrice} onChange={e => updateProduct(p.id, { salePrice: e.target.value })} /></Field>
                <Field label="Margin % (auto)"><input className={inputCls} value={margin.toFixed(1) + '%'} disabled style={{ backgroundColor: '#f5f5f4' }} /></Field>
                <Field label="Expiry Date"><input type="date" className={inputCls} value={p.expiryDate} onChange={e => updateProduct(p.id, { expiryDate: e.target.value })} /></Field>
              </div>
              <button onClick={() => removeRow(p.id)} className="text-xs text-red-600 mt-2">Remove row</button>
            </div>
          );
        })}
      </div>
      <button onClick={addRow} className="text-xs text-amber-700 mb-6">+ Add another product</button>

      <div className="flex justify-end">
        <button onClick={save} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save Stock Entry</button>
      </div>
    </div>
  );
}

function CurrentStockView({ ctx }) {
  const { stockEntries, saveStockEntries, notify } = ctx;
  const [subTab, setSubTab] = useState('retail');
  const [modal, setModal] = useState(null); // { entryId, product } | null
  const wantType = subTab === 'retail' ? 'Retail' : 'Salon Use';
  const rows = [];
  stockEntries.forEach(entry => {
    (entry.products || []).filter(p => p.type === wantType).forEach(p => {
      rows.push({ entryId: entry.id, invoiceNumber: entry.invoiceNumber, product: p });
    });
  });
  const expiringSoon = rows.filter(r => monthsUntil(r.product.expiryDate) <= 10);

  const saveProduct = (entryId, updatedProduct) => {
    const newEntries = stockEntries.map(entry => {
      if (entry.id !== entryId) return entry;
      return { ...entry, products: entry.products.map(p => p.id === updatedProduct.id ? updatedProduct : p) };
    });
    saveStockEntries(newEntries);
    notify('Product updated');
  };

  const removeProduct = (entryId, productId) => {
    const newEntries = stockEntries
      .map(entry => entry.id === entryId ? { ...entry, products: entry.products.filter(p => p.id !== productId) } : entry)
      .filter(entry => entry.products.length > 0); // drop the whole invoice if it's now empty
    saveStockEntries(newEntries);
    notify('Product removed from stock');
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setSubTab('retail')} className={`text-sm px-3 py-1.5 rounded-full ${subTab === 'retail' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Available Stock (Retail)</button>
        <button onClick={() => setSubTab('salon')} className={`text-sm px-3 py-1.5 rounded-full ${subTab === 'salon' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Available Stock (Salon Use)</button>
      </div>
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-lg mb-4">
          ⚠ {expiringSoon.length} product(s) expiring within 10 months.
        </div>
      )}
      {rows.length === 0 ? <EmptyState title="No stock in this category yet" sub="Add stock under the Add Stock tab — it appears here immediately." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Invoice #</th><th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium text-right">Available Stock</th>
              <th className="px-4 py-2 font-medium text-right">Sale Price</th><th className="px-4 py-2 font-medium">Expiry Date</th><th className="px-4 py-2 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {rows.map((r, i) => {
                const soon = monthsUntil(r.product.expiryDate) <= 10;
                return (
                  <tr key={r.product.id || i} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal({ entryId: r.entryId, product: r.product })}>
                    <td className="px-4 py-2 font-mono text-xs text-stone-500 whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                    <td className="px-4 py-2 font-medium text-stone-800 whitespace-nowrap">{r.product.product}</td>
                    <td className="px-4 py-2 text-right text-stone-600">{r.product.quantity}</td>
                    <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{r.product.salePrice ? fmtINR(r.product.salePrice) : '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={soon ? 'text-amber-700 font-medium' : 'text-stone-600'}>{r.product.expiryDate ? fmtDate(r.product.expiryDate) : '—'}</span>
                      {soon && <Badge tone="warn"> Expiring soon</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right text-stone-300">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-stone-400 mt-3">Click any row to edit its details, adjust quantity, or remove it entirely (e.g. once a product is finished). Selling a product through Billing's Products Sold section reduces this quantity automatically.</div>
      {modal && (
        <StockProductForm
          entryId={modal.entryId}
          product={modal.product}
          onSave={(updated) => { saveProduct(modal.entryId, updated); setModal(null); }}
          onRemove={() => { removeProduct(modal.entryId, modal.product.id); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function StockProductForm({ product, onSave, onRemove, onClose }) {
  const [name, setName] = useState(product.product);
  const [volumeMl, setVolumeMl] = useState(product.volumeMl);
  const [type, setType] = useState(product.type);
  const [landingPrice, setLandingPrice] = useState(product.landingPrice);
  const [salePrice, setSalePrice] = useState(product.salePrice);
  const [quantity, setQuantity] = useState(product.quantity);
  const [expiryDate, setExpiryDate] = useState(product.expiryDate || '');
  const margin = calcMargin(landingPrice, salePrice);

  const save = () => {
    onSave({ ...product, product: name.trim(), volumeMl, type, landingPrice: Number(landingPrice) || 0, salePrice: Number(salePrice) || 0, quantity: Number(quantity) || 0, expiryDate });
  };
  const remove = () => {
    if (!window.confirm(`Remove "${name}" from stock? Use this once a product is finished or discontinued.`)) return;
    onRemove();
  };

  return (
    <Modal title={`Edit — ${product.product}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Product"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Volume (ml)"><input type="number" className={inputCls} value={volumeMl} onChange={e => setVolumeMl(e.target.value)} /></Field>
      </div>
      <Field label="Type">
        <select className={inputCls} value={type} onChange={e => setType(e.target.value)}>
          <option value="Retail">Retail</option>
          <option value="Salon Use">Salon Use</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Landing Price (₹)"><input type="number" className={inputCls} value={landingPrice} onChange={e => setLandingPrice(e.target.value)} /></Field>
        <Field label="Sale Price (₹)"><input type="number" className={inputCls} value={salePrice} onChange={e => setSalePrice(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Margin % (auto)"><input className={inputCls} value={margin.toFixed(1) + '%'} disabled style={{ backgroundColor: '#f5f5f4' }} /></Field>
        <Field label="Quantity Available"><input type="number" className={inputCls} value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
      </div>
      <Field label="Expiry Date"><input type="date" className={inputCls} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></Field>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <button onClick={remove} className="text-red-600 text-sm">Remove from Stock</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

function ManageProductsView({ ctx }) {
  const { stockEntries, saveStockEntries, notify } = ctx;
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const rows = [];
  stockEntries.forEach(entry => {
    (entry.products || []).forEach(p => {
      rows.push({ entryId: entry.id, invoiceNumber: entry.invoiceNumber, vendorName: entry.vendorName, product: p });
    });
  });
  const filtered = rows.filter(r => {
    if (typeFilter && r.product.type !== typeFilter) return false;
    if (search && !r.product.product.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const markOver = (entryId, productId, productName) => {
    if (!window.confirm(`Mark "${productName}" as over? It will be removed from Current Stock immediately.`)) return;
    const newEntries = stockEntries
      .map(entry => entry.id === entryId ? { ...entry, products: entry.products.filter(p => p.id !== productId) } : entry)
      .filter(entry => entry.products.length > 0);
    saveStockEntries(newEntries);
    notify(`${productName} marked as over and removed from stock`);
  };

  return (
    <div>
      <SectionHeader title="Manage Products" />
      <div className="text-xs text-stone-400 mb-4">Every product currently in stock, across all vendors — Retail and Salon Use. Use "Mark as Over" the moment something runs out (e.g. a spa cream finishing mid-use), so Current Stock always reflects what's actually on the shelf.</div>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className={inputCls} style={{ maxWidth: 260 }} placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={() => setTypeFilter('')} className={`text-xs px-3 py-1.5 rounded-full ${typeFilter === '' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>All</button>
        <button onClick={() => setTypeFilter('Retail')} className={`text-xs px-3 py-1.5 rounded-full ${typeFilter === 'Retail' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Retail</button>
        <button onClick={() => setTypeFilter('Salon Use')} className={`text-xs px-3 py-1.5 rounded-full ${typeFilter === 'Salon Use' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>Salon Use</button>
      </div>
      {filtered.length === 0 ? <EmptyState title="No products match" sub="Add stock under Product Inventory first." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Vendor</th>
              <th className="px-4 py-2 font-medium">Invoice #</th><th className="px-4 py-2 font-medium text-right">Stock Left</th><th className="px-4 py-2 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {filtered.map(r => (
                <tr key={r.product.id}>
                  <td className="px-4 py-2 font-medium text-stone-800 whitespace-nowrap">{r.product.product}</td>
                  <td className="px-4 py-2"><Badge tone={r.product.type === 'Retail' ? 'active' : 'default'}>{r.product.type}</Badge></td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{r.vendorName || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-stone-500 whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{r.product.quantity}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => markOver(r.entryId, r.product.id, r.product.product)} className="text-xs text-red-600">Mark as Over</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtMonthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function defaultLiability(month, staffList) {
  return { id: uid(), month, rent: 0, eb: 0, salaries: staffList.map(s => ({ staffId: s.id, name: s.name, amount: 0 })), salonExpenses: 0, ot: 0, incentive: 0, royalty: 0 };
}

function AdminPLView({ ctx }) {
  const { staff, pnlLiabilities, savePnlLiabilities, notify } = ctx;
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [income, setIncome] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(() => defaultLiability(month, staff));

  useEffect(() => {
    setLoading(true);
    fetchPnlIncome(month).then(setIncome).catch(() => notify('Could not load P&L income data')).finally(() => setLoading(false));
    const found = pnlLiabilities.find(l => l.month === month);
    setDraft(found ? { ...found } : defaultLiability(month, staff));
    // eslint-disable-next-line
  }, [month]);

  const updateField = (field, value) => setDraft(prev => ({ ...prev, [field]: Number(value) || 0 }));
  const updateSalary = (staffId, value) => setDraft(prev => ({ ...prev, salaries: prev.salaries.map(s => s.staffId === staffId ? { ...s, amount: Number(value) || 0 } : s) }));

  const saveLiability = () => {
    const others = pnlLiabilities.filter(l => l.month !== month);
    savePnlLiabilities([...others, draft]);
    notify(`Liability figures saved for ${fmtMonthLabel(month)}`);
  };

  const totalSalary = draft.salaries.reduce((s, x) => s + (x.amount || 0), 0);
  const totalLiability = draft.rent + draft.eb + totalSalary + draft.salonExpenses + draft.ot + draft.incentive + draft.royalty;
  const totalNetSales = income ? income.netSalonSales + income.productSalesMargin : 0;
  const profitLoss = totalNetSales - totalLiability;

  const shiftMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(d.toISOString().slice(0, 7));
  };

  const exportCSV = () => {
    if (!income) return;
    const rows = [
      { Item: 'Net Salon Sales', Amount: income.netSalonSales },
      { Item: 'Product Sales Margin', Amount: income.productSalesMargin },
      { Item: 'Total Net Sales', Amount: totalNetSales },
      { Item: 'Rent', Amount: draft.rent },
      { Item: 'EB / Electricity', Amount: draft.eb },
      ...draft.salaries.map(s => ({ Item: `Salary — ${s.name}`, Amount: s.amount })),
      { Item: 'Salon Expenses', Amount: draft.salonExpenses },
      { Item: 'OT', Amount: draft.ot },
      { Item: 'Incentive', Amount: draft.incentive },
      { Item: 'Royalty', Amount: draft.royalty },
      { Item: 'Total Liability', Amount: totalLiability },
      { Item: profitLoss >= 0 ? 'Profit' : 'Loss', Amount: Math.round(Math.abs(profitLoss)) },
    ];
    downloadText(`pnl-${month}.csv`, toCSV(rows), 'text/csv');
  };

  return (
    <div>
      <SectionHeader title="Profit & Loss" action={<Badge tone="danger">Admin Only</Badge>} />
      <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
        <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-stone-300">←</button>
        <span className="text-stone-700 font-medium">{fmtMonthLabel(month)}</span>
        <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-stone-300">→</button>
        <button onClick={exportCSV} disabled={!income} className="ml-auto text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 disabled:opacity-50">Export CSV</button>
      </div>

      {loading ? <div className="text-sm text-stone-400">Loading…</div> : income && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-700 mb-3">Income — Salon Service &amp; Product Only</div>
              <div className="flex justify-between text-sm py-1"><span className="text-stone-500">Net Salon Sales</span><span className="text-stone-800">{fmtINR(income.netSalonSales)}</span></div>
              <div className="flex justify-between text-sm py-1"><span className="text-stone-500">Product Sales — Margin Only</span><span className="text-stone-800">{fmtINR(income.productSalesMargin)}</span></div>
              <div className="text-xs text-stone-400 mt-1">{income.productsSoldCount} unit(s) sold this month — profit margin shown, not the full sale value.</div>
              <div className="pt-3 mt-3 border-t border-stone-200 flex justify-between">
                <span className="text-sm font-medium text-stone-700">Total Net Sales</span>
                <span className="text-lg font-medium text-emerald-700" style={displayFont}>{fmtINR(totalNetSales)}</span>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-700 mb-3">Liability — configurable per month</div>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Rent (₹)"><input type="number" className={inputCls} value={draft.rent} onChange={e => updateField('rent', e.target.value)} /></Field>
                <Field label="EB / Electricity (₹)"><input type="number" className={inputCls} value={draft.eb} onChange={e => updateField('eb', e.target.value)} /></Field>
              </div>
              <div className="text-xs font-medium text-stone-500 mb-1">Salary Breakup</div>
              <div className="space-y-1 mb-3">
                {draft.salaries.map(s => (
                  <div key={s.staffId} className="flex items-center gap-2">
                    <span className="text-sm text-stone-600 w-24 truncate">{s.name}</span>
                    <input type="number" className={inputCls} value={s.amount} onChange={e => updateSalary(s.staffId, e.target.value)} />
                  </div>
                ))}
                {draft.salaries.length === 0 && <div className="text-xs text-stone-400">Add staff first to break down salaries.</div>}
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Salon Expenses (₹)"><input type="number" className={inputCls} value={draft.salonExpenses} onChange={e => updateField('salonExpenses', e.target.value)} /></Field>
                <Field label="OT (₹)"><input type="number" className={inputCls} value={draft.ot} onChange={e => updateField('ot', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Incentive (₹)"><input type="number" className={inputCls} value={draft.incentive} onChange={e => updateField('incentive', e.target.value)} /></Field>
                <Field label="Royalty (₹)"><input type="number" className={inputCls} value={draft.royalty} onChange={e => updateField('royalty', e.target.value)} /></Field>
              </div>
              <button onClick={saveLiability} className="text-sm px-4 py-2 rounded-md bg-amber-700 text-white mt-2">Save Liability Figures</button>
              <div className="pt-3 mt-3 border-t border-stone-200 flex justify-between">
                <span className="text-sm font-medium text-stone-700">Total Liability</span>
                <span className="text-lg font-medium text-red-700" style={displayFont}>{fmtINR(totalLiability)}</span>
              </div>
            </div>
          </div>

          <div className={`rounded-lg p-6 text-center ${profitLoss >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
            <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">{profitLoss >= 0 ? 'Profit' : 'Loss'} for {fmtMonthLabel(month)}</div>
            <div className={`text-4xl ${profitLoss >= 0 ? 'text-emerald-700' : 'text-red-700'}`} style={displayFont}>{fmtINR(Math.abs(profitLoss))}</div>
            <div className="text-xs text-stone-400 mt-1">Total Net Sales ({fmtINR(totalNetSales)}) − Total Liability ({fmtINR(totalLiability)})</div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- expenses ---------------- */
function ExpensesView({ ctx }) {
  const { expenses, saveExpenses, notify } = ctx;
  const [modal, setModal] = useState(null);
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(1); return localDateStr(d); });
  const [toDate, setToDate] = useState(todayISO());

  const inRange = expenses.filter(e => e.date >= fromDate && e.date <= toDate);
  const sorted = [...inRange].sort((a, b) => b.date.localeCompare(a.date));
  const total = inRange.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory = {};
  inRange.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0); });
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const exportCSV = () => {
    if (!sorted.length) { notify('No expenses in this date range'); return; }
    const rows = sorted.map(e => ({ Date: fmtDate(e.date), Category: e.category, Amount: e.amount, 'Payment Mode': e.mode, Recipient: e.recipient, Description: e.description }));
    downloadText(`expenses-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  return (
    <div>
      <SectionHeader title="Expenses" action={<button onClick={() => setModal('new')} className="bg-amber-700 hover:bg-amber-800 text-white text-sm px-3 py-2 rounded-md">+ New Expense</button>} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="From"><input type="date" className={inputCls} value={fromDate} onChange={e => setFromDate(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={toDate} onChange={e => setToDate(e.target.value)} /></Field>
        <button onClick={exportCSV} className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600 h-10">Export CSV</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total in Range" value={fmtINR(total)} tone="accent" />
        {topCategories.map(([cat, amt]) => <StatCard key={cat} label={cat} value={fmtINR(amt)} />)}
      </div>
      {sorted.length === 0 ? <EmptyState title="No expenses in this range" sub="Log rent, utilities, supplies, and other costs to track them here." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Category</th><th className="px-4 py-2 font-medium text-right">Amount</th>
              <th className="px-4 py-2 font-medium">Payment Mode</th><th className="px-4 py-2 font-medium">Recipient</th><th className="px-4 py-2 font-medium">Description</th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {sorted.map(e => (
                <tr key={e.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setModal(e)}>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{e.category}</td>
                  <td className="px-4 py-2 text-right text-stone-800 whitespace-nowrap">{fmtINR(e.amount)}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{e.mode}</td>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{e.recipient}</td>
                  <td className="px-4 py-2 text-stone-500">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <ExpenseForm ctx={ctx} expense={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function ExpenseForm({ ctx, expense, onClose }) {
  const { expenses, saveExpenses, notify } = ctx;
  const isNew = !expense;
  const [date, setDate] = useState(expense ? expense.date : todayISO());
  const [category, setCategory] = useState(expense ? expense.category : '');
  const [amount, setAmount] = useState(expense ? expense.amount : '');
  const [mode, setMode] = useState(expense ? expense.mode : '');
  const [recipient, setRecipient] = useState(expense ? expense.recipient : '');
  const [description, setDescription] = useState(expense ? expense.description : '');

  const submit = () => {
    if (!category.trim()) { notify('Enter a category'); return; }
    if (!amount || Number(amount) <= 0) { notify('Enter an amount'); return; }
    const record = { id: expense ? expense.id : uid(), date, category: category.trim(), amount: Number(amount), mode: mode.trim(), recipient: recipient.trim(), description: description.trim() };
    if (isNew) saveExpenses([...expenses, record]);
    else saveExpenses(expenses.map(e => e.id === record.id ? record : e));
    notify(isNew ? 'Expense added' : 'Expense updated');
    onClose();
  };
  const remove = () => {
    if (!window.confirm('Delete this expense?')) return;
    saveExpenses(expenses.filter(e => e.id !== expense.id));
    notify('Expense deleted');
    onClose();
  };

  return (
    <Modal title={isNew ? 'New Expense' : 'Edit Expense'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Category"><input className={inputCls} value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Rent, Utilities, Supplies" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Amount Paid (₹)"><input type="number" min="0" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Mode of Payment"><input className={inputCls} value={mode} onChange={e => setMode(e.target.value)} placeholder="e.g. Cash, UPI, Bank Transfer" /></Field>
      </div>
      <Field label="Recipient Name"><input className={inputCls} value={recipient} onChange={e => setRecipient(e.target.value)} /></Field>
      <Field label="Description"><textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <div className="flex justify-between mt-5 pt-4 border-t border-stone-200">
        <div>{!isNew && <button onClick={remove} className="text-red-600 text-sm">Delete</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-stone-300 text-stone-600">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- payroll: OT & incentives ---------------- */
function PayrollView({ ctx }) {
  const { staff, bills, payrollRecords, savePayrollRecords, notify } = ctx;
  const [selectedStaff, setSelectedStaff] = useState(staff.length ? staff[0].id : '');
  const [date, setDate] = useState(todayISO());
  const [clockIn, setClockIn] = useState('10:00');
  const [clockOut, setClockOut] = useState('19:00');
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(1); return localDateStr(d); });
  const [toDate, setToDate] = useState(todayISO());

  if (staff.length === 0) {
    return (
      <div>
        <SectionHeader title="OT & Incentives" />
        <EmptyState title="Add staff first" sub="Daily Target and Incentive % are set per staff member under Staff." />
      </div>
    );
  }

  const person = staff.find(s => s.id === selectedStaff) || staff[0];
  const minutesWorked = diffMinutes(clockIn, clockOut) || 0;
  const { otMinutes, otPay } = calcOT(minutesWorked);
  const netSales = staffNetSalesForDate(bills, person.id, date);
  const incentive = calcIncentive(netSales, person.dailyTarget, person.incentivePercent);
  const alreadySaved = payrollRecords.find(r => r.staffId === person.id && r.date === date);

  const saveRecord = () => {
    const record = {
      id: alreadySaved ? alreadySaved.id : uid(), staffId: person.id, date, clockIn, clockOut,
      minutesWorked, otMinutes, otPay, dailyNetSales: netSales, dailyTarget: person.dailyTarget || 0,
      incentivePercent: person.incentivePercent || 0, incentivePay: incentive,
    };
    if (alreadySaved) savePayrollRecords(payrollRecords.map(r => r.id === record.id ? record : r));
    else savePayrollRecords([...payrollRecords, record]);
    notify(`Payroll saved for ${person.name} — ${fmtDate(date)}`);
  };

  const historyRows = payrollRecords
    .filter(r => r.date >= fromDate && r.date <= toDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const staffById2 = {}; staff.forEach(s => { staffById2[s.id] = s; });

  const exportCSV = () => {
    if (!historyRows.length) { notify('No saved payroll records in this range'); return; }
    const rows = historyRows.map(r => ({
      Date: fmtDate(r.date), Staff: staffById2[r.staffId] ? staffById2[r.staffId].name : 'Unknown',
      'Clock In': r.clockIn, 'Clock Out': r.clockOut, 'OT Minutes': r.otMinutes, 'OT Pay': r.otPay,
      'Net Sales': r.dailyNetSales.toFixed(0), 'Daily Target': r.dailyTarget, 'Incentive Pay': r.incentivePay,
      'Total OT + Incentive': r.otPay + r.incentivePay,
    }));
    downloadText(`payroll-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  return (
    <div>
      <SectionHeader title="OT & Incentives" />
      <div className="text-xs text-stone-400 mb-4">OT: ₹50/hour beyond a 9-hour day, prorated by the minute, only once overtime reaches 30 minutes. Incentive: staff's configured % of that day's actual net sales, only if the day's net sales meet or exceed their Daily Target — both set per staff under Staff → Edit.</div>

      <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
        <div className="text-sm font-medium text-stone-700 mb-3">Daily Calculator</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4">
          <Field label="Staff">
            <select className={inputCls} value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Clock In"><input type="time" className={inputCls} value={clockIn} onChange={e => setClockIn(e.target.value)} /></Field>
          <Field label="Clock Out"><input type="time" className={inputCls} value={clockOut} onChange={e => setClockOut(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <StatCard label="Hours Worked" value={(minutesWorked / 60).toFixed(1) + 'h'} />
          <StatCard label="OT Pay" value={fmtINR(otPay)} tone="accent" />
          <StatCard label={`Net Sales (${fmtDate(date)})`} value={fmtINR(netSales)} />
          <StatCard label="Incentive Earned" value={fmtINR(incentive)} tone={incentive > 0 ? 'good' : 'default'} sub={person.dailyTarget ? `Target: ${fmtINR(person.dailyTarget)}` : 'No daily target set'} />
        </div>
        <div className="mt-4 pt-4 border-t border-stone-200 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium text-stone-700">Total OT + Incentive for {person.name} on {fmtDate(date)}</span>
          <div className="flex items-center gap-3">
            <span className="text-xl font-medium text-amber-700" style={displayFont}>{fmtINR(otPay + incentive)}</span>
            <button onClick={saveRecord} className="text-sm px-4 py-2 rounded-md bg-amber-700 text-white">{alreadySaved ? 'Update Saved Record' : 'Save to Payroll'}</button>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
        <div className="text-sm font-medium text-stone-700">Saved Payroll History</div>
        <div className="flex items-end gap-2">
          <Field label="From"><input type="date" className={inputCls} value={fromDate} onChange={e => setFromDate(e.target.value)} /></Field>
          <Field label="To"><input type="date" className={inputCls} value={toDate} onChange={e => setToDate(e.target.value)} /></Field>
          <button onClick={exportCSV} className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600 h-10">Export CSV</button>
        </div>
      </div>
      {historyRows.length === 0 ? <EmptyState title="No saved payroll records in this range" sub="Use the calculator above and click Save to Payroll." /> : (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Staff</th><th className="px-4 py-2 font-medium text-right">OT Pay</th>
              <th className="px-4 py-2 font-medium text-right">Net Sales</th><th className="px-4 py-2 font-medium text-right">Incentive</th><th className="px-4 py-2 font-medium text-right">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-dotted divide-stone-200">
              {historyRows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{staffById2[r.staffId] ? staffById2[r.staffId].name : 'Unknown'}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{fmtINR(r.otPay)}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{fmtINR(r.dailyNetSales)}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{fmtINR(r.incentivePay)}</td>
                  <td className="px-4 py-2 text-right font-medium text-stone-800">{fmtINR(r.otPay + r.incentivePay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- outreach ---------------- */
function OutreachView({ ctx }) {
  const { customers, bills, settings, offerCodes, saveOfferCodes, outreachLog, saveOutreachLog, notify } = ctx;
  const inactiveList = computeInactive(customers, bills, settings.inactiveDays);
  const birthdayList = computeBirthdays(customers, settings.birthdayWindowDays);

  const findCode = (customerId, type) => offerCodes.find(o => o.customerId === customerId && o.type === type && !o.used);

  const sendMessage = (customer, type) => {
    let codeEntry = findCode(customer.id, type);
    if (!codeEntry) {
      codeEntry = { id: uid(), code: generateCode(type === 'inactive' ? 'BACK' : 'BDAY'), type, customerId: customer.id, discountPercent: type === 'inactive' ? 15 : 20, createdDate: nowISO(), used: false };
      saveOfferCodes([...offerCodes, codeEntry]);
    }
    const msg = type === 'inactive'
      ? inactiveMessage(settings.salonName, customer.name, codeEntry.code, codeEntry.discountPercent)
      : birthdayMessage(settings.salonName, customer.name, codeEntry.code, codeEntry.discountPercent);
    window.open(waLink(customer.phone, msg), '_blank');
    saveOutreachLog([...outreachLog, { id: uid(), customerId: customer.id, type, date: nowISO(), code: codeEntry.code }]);
    notify('WhatsApp opened — review and hit send');
  };

  return (
    <div>
      <SectionHeader title="Outreach" />
      <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
        <div className="text-sm font-medium text-stone-700 mb-3">Inactive Customers ({inactiveList.length}) — no visit in {settings.inactiveDays}+ days</div>
        {inactiveList.length === 0 ? <div className="text-sm text-stone-400">Everyone's been in recently. Nice work.</div> : (
          <div className="divide-y divide-dotted divide-stone-200">
            {inactiveList.map(c => (
              <div key={c.id} className="flex items-center justify-between py-2 gap-2">
                <div>
                  <div className="text-sm font-medium text-stone-800">{c.name}</div>
                  <div className="text-xs text-stone-400">{c.phone || 'No phone on file'} · {c.daysSince} days inactive</div>
                </div>
                <button disabled={!c.phone} onClick={() => sendMessage(c, 'inactive')} className="text-xs px-3 py-1.5 rounded-md bg-amber-700 text-white disabled:opacity-40 whitespace-nowrap">Send Offer</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-stone-200 p-4">
        <div className="text-sm font-medium text-stone-700 mb-3">Upcoming Birthdays ({birthdayList.length}) — next {settings.birthdayWindowDays} days</div>
        {birthdayList.length === 0 ? <div className="text-sm text-stone-400">No birthdays coming up in this window.</div> : (
          <div className="divide-y divide-dotted divide-stone-200">
            {birthdayList.map(c => (
              <div key={c.id} className="flex items-center justify-between py-2 gap-2">
                <div>
                  <div className="text-sm font-medium text-stone-800">{c.name}</div>
                  <div className="text-xs text-stone-400">{c.phone || 'No phone on file'} · {c.daysAway === 0 ? 'Today!' : `in ${c.daysAway} days`}</div>
                </div>
                <button disabled={!c.phone} onClick={() => sendMessage(c, 'birthday')} className="text-xs px-3 py-1.5 rounded-md bg-rose-600 text-white disabled:opacity-40 whitespace-nowrap">Send Wish</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- reports ---------------- */
function DateRangeControls({ fromDate, toDate, setFromDate, setToDate }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm no-print mb-4">
      <span className="text-stone-500">From</span>
      <input type="date" className="border border-stone-300 rounded-md px-2 py-1 text-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
      <span className="text-stone-500">To</span>
      <input type="date" className="border border-stone-300 rounded-md px-2 py-1 text-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
    </div>
  );
}

function ReportsView({ ctx }) {
  const { bills, staff, services, customers, enquiries, appointments, servicesById, staffById, customersById } = ctx;
  const [subTab, setSubTab] = useState('sales');
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [toDate, setToDate] = useState(todayISO());
  const [expandedService, setExpandedService] = useState(null);
  const [billModal, setBillModal] = useState(null);

  const billsInRange = bills.filter(b => inDateRange(b.date, fromDate, toDate));
  const rangeLabel = `${fmtDate(fromDate)} – ${fmtDate(toDate)}`;

  // ---- Funnel: Enquiry -> Appointment -> Bill ----
  // No explicit link exists between these three entities, so this matches by
  // normalized phone number -- the best available signal without a schema change.
  const enquiriesInRange = enquiries.filter(e => inDateRange(e.date, fromDate, toDate));
  const enquiryPhones = [...new Set(enquiriesInRange.map(e => normalizePhone(e.phone)).filter(Boolean))];
  const appointmentPhoneSet = new Set(appointments.map(a => normalizePhone(a.phone)).filter(Boolean));
  const customerPhoneById = {}; customers.forEach(c => { customerPhoneById[c.id] = normalizePhone(c.phone); });
  const billedPhoneSet = new Set(bills.map(b => customerPhoneById[b.customerId]).filter(Boolean));
  const funnelEnquiries = enquiryPhones.length;
  const funnelAppointments = enquiryPhones.filter(p => appointmentPhoneSet.has(p)).length;
  const funnelBills = enquiryPhones.filter(p => billedPhoneSet.has(p)).length;

  // ---- No-Show & Cancellation Analytics (by Appointments' Source) ----
  const APPT_SOURCES = ['In-Salon', 'JustDial', 'Phone', 'Whatsapp', 'Instagram'];
  const noShowRows = APPT_SOURCES.map(source => {
    const forSource = appointments.filter(a => a.source === source);
    const total = forSource.length;
    const noShow = forSource.filter(a => a.status === 'No-show').length;
    const cancelled = forSource.filter(a => a.status === 'Cancelled').length;
    return { source, total, noShow, cancelled, noShowPct: total ? (noShow / total * 100) : 0, cancelPct: total ? (cancelled / total * 100) : 0 };
  }).filter(r => r.total > 0);

  // ---- 8.1 Total Sales Report ----
  const serviceAmountTotal = billsInRange.reduce((s, b) => s + (b.total || 0), 0);
  const productAmountTotal = billsInRange.reduce((s, b) => s + (b.productAmount || 0), 0);
  const makeupAdvanceTotal = billsInRange.reduce((s, b) => s + (b.makeupAdvance || 0), 0);
  const grossSalesTotal = serviceAmountTotal + productAmountTotal + makeupAdvanceTotal;
  const netSalesTotal = grossSalesTotal * NET_FROM_GROSS_FACTOR;
  const exportSalesCSV = () => {
    downloadText(`total-sales-${fromDate}-to-${toDate}.csv`, toCSV([{
      'From': fromDate, 'To': toDate, 'Service Amount': serviceAmountTotal.toFixed(0), 'Product Amount': productAmountTotal.toFixed(0),
      'Makeup Advance': makeupAdvanceTotal.toFixed(0), 'Gross Sale (incl. GST)': grossSalesTotal.toFixed(0), 'Net Sale (excl. GST)': netSalesTotal.toFixed(0),
    }]), 'text/csv');
  };

  // ---- 8.2 Bill Summary Report ----
  // ---- Product Sales: date-wise, from real retail product sales on bills ----
  const productSalesRows = useMemo(() => {
    const stockProductNameByKey = {};
    (ctx.stockEntries || []).forEach(entry => {
      (entry.products || []).forEach(prod => {
        stockProductNameByKey[`${entry.id}::${prod.id}`] = prod.product;
      });
    });
    const rows = [];
    billsInRange.forEach(b => {
      (b.retailProducts || []).forEach(rp => {
        const name = stockProductNameByKey[`${rp.stockEntryId}::${rp.productLineId}`] || 'Deleted Product';
        const qty = rp.quantity || 0;
        const saleValue = (rp.salePrice || 0) * qty;
        const margin = ((rp.salePrice || 0) - (rp.landingPrice || 0)) * qty;
        rows.push({ date: b.date, invoiceNumber: b.invoiceNumber, product: name, quantity: qty, saleValue, margin });
      });
    });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [billsInRange, ctx.stockEntries]);
  const productSalesTotals = productSalesRows.reduce((acc, r) => ({
    quantity: acc.quantity + r.quantity, saleValue: acc.saleValue + r.saleValue, margin: acc.margin + r.margin,
  }), { quantity: 0, saleValue: 0, margin: 0 });
  const exportProductSalesCSV = () => {
    const rows = productSalesRows.map(r => ({
      Date: fmtDate(r.date), 'Invoice #': r.invoiceNumber || '—', Product: r.product,
      Quantity: r.quantity, 'Sale Value': r.saleValue.toFixed(0), Margin: r.margin.toFixed(0),
    }));
    downloadText(`product-sales-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  const billSummaryRows = [...billsInRange].sort((a, b) => new Date(b.date) - new Date(a.date)).map(b => {
    const distinctStaffNames = [...new Set((b.items || []).map(it => { const sid = itemStaffId(it, b); return staffById[sid] ? staffById[sid].name : null; }).filter(Boolean))];
    return {
      invoiceNumber: b.invoiceNumber || '—',
      customer: customersById[b.customerId] ? customersById[b.customerId].name : 'Deleted',
      phone: customersById[b.customerId] ? customersById[b.customerId].phone : '',
      staffName: distinctStaffNames.length ? distinctStaffNames.join(', ') : 'Deleted',
      gross: billGross(b), net: billNet(b), date: b.date,
      servicesText: b.items.map(it => (servicesById[it.serviceId] ? servicesById[it.serviceId].name : 'Service')).join(', '),
      paymentMode: billPaymentSummary(b),
      billRef: b,
    };
  });
  const exportBillSummaryCSV = () => {
    const rows = billSummaryRows.map(r => ({
      'Invoice #': r.invoiceNumber, Customer: r.customer, Contact: r.phone, 'Service Provider': r.staffName,
      'Gross (incl. GST)': r.gross.toFixed(0), 'Net (excl. GST)': r.net.toFixed(0), Date: fmtDate(r.date), Services: r.servicesText, Payment: r.paymentMode,
    }));
    downloadText(`bill-summary-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  // ---- 9. Service Provider Report ----
  const rangeStart = new Date(fromDate); rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(toDate); rangeEnd.setHours(23, 59, 59, 999);
  const staffRows = staff.map(s => {
    const m = computeStaffMetrics(bills, s.id, rangeStart, rangeEnd, servicesById);
    // Bill-level extras (Product Amount, Makeup Advance) aren't tied to a specific service/staff,
    // so attribute them once per bill to that bill's primary (first item's) staff -- avoids double-
    // counting the same rupees against two different staff when a bill is split across services.
    let extras = 0, productSale = 0;
    billsInRange.forEach(b => {
      if (!b.items || !b.items.length) return;
      if (itemStaffId(b.items[0], b) !== s.id) return;
      extras += (b.productAmount || 0) + (b.makeupAdvance || 0);
      productSale += (b.productAmount || 0);
    });
    const gross = m.revenue + extras;
    const net = gross * NET_FROM_GROSS_FACTOR;
    const target = prorateTarget(s.monthlyTarget, fromDate, toDate);
    const achievedPct = target > 0 ? (gross / target * 100) : null;
    return { staff: s, ...m, gross, net, productSale, target, achievedPct };
  });
  const exportServiceProviderCSV = () => {
    const rows = staffRows.map(r => ({
      Staff: r.staff.name, Target: r.target.toFixed(0), Achieved: r.gross.toFixed(0),
      'Achieved %': r.achievedPct === null ? 'No target set' : r.achievedPct.toFixed(1),
      'Gross Sales': r.gross.toFixed(0), 'Net Sales': r.net.toFixed(0), 'Product Sale': r.productSale.toFixed(0),
      'Clients Attended': r.uniqueCustomers, ABV: r.abv.toFixed(0),
    }));
    downloadText(`service-provider-${fromDate}-to-${toDate}.csv`, toCSV(rows), 'text/csv');
  };

  // ---- 11. Service Performance + premium customer drill-down ----
  const serviceStats = computeServiceStats(bills, services);
  const maxServiceRevenue = Math.max(1, ...serviceStats.map(s => s.revenue));
  const customersForService = (serviceId) => bills.flatMap(b => b.items
    .filter(it => it.serviceId === serviceId)
    .map(it => ({
      name: customersById[b.customerId] ? customersById[b.customerId].name : 'Deleted',
      phone: customersById[b.customerId] ? customersById[b.customerId].phone : '',
      date: b.date,
    })))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // ---- 10. Customer Report (age + gender) ----
  const ageStats = computeAgeBracketStats(bills, customers, servicesById);
  const eligibleAge = ageStats.filter(a => a.bracket !== 'Unknown' && a.bills > 0);
  const opportunity = eligibleAge.length ? eligibleAge.reduce((a, b) => a.premiumPct <= b.premiumPct ? a : b) : null;
  const genderStats = computeGenderStats(bills, customers);
  const customerRows = customers.map(c => ({ name: c.name, phone: c.phone, age: getAge(c.dob), gender: c.gender || 'Unknown' }));
  const exportCustomerReportCSV = () => {
    const rows = customerRows.map(r => ({ Name: r.name, Contact: r.phone, Age: r.age === null ? '' : r.age, Gender: r.gender }));
    downloadText('customer-report.csv', toCSV(rows), 'text/csv');
  };

  const REPORT_TABS = [
    { key: 'sales', label: 'Total Sales' },
    { key: 'bills', label: 'Bill Summary' },
    { key: 'staff', label: 'Service Provider' },
    { key: 'services', label: 'Service Performance' },
    { key: 'customers', label: 'Customer Report' },
    { key: 'products', label: 'Product Sales' },
    { key: 'funnel', label: 'Enquiry→Bill Funnel' },
    { key: 'noshow', label: 'No-Show Analytics' },
  ];

  return (
    <div>
      <SectionHeader title="Reports" />
      <div className="flex gap-2 mb-3 no-print flex-wrap">
        {REPORT_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} className={`text-sm px-3 py-1.5 rounded-full ${subTab === t.key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>{t.label}</button>
        ))}
      </div>

      {(subTab === 'sales' || subTab === 'bills' || subTab === 'staff') && (
        <DateRangeControls fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} />
      )}

      {subTab === 'sales' && (
        <div>
          <div className="mb-3 text-sm text-stone-600">{rangeLabel}</div>
          <div className="flex justify-end mb-3 no-print gap-2">
            <button onClick={exportSalesCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Export CSV</button>
            <button onClick={() => window.print()} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Print</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Service Amount" value={fmtINR(serviceAmountTotal)} />
            <StatCard label="Product Amount" value={fmtINR(productAmountTotal)} />
            <StatCard label="Makeup Advance" value={fmtINR(makeupAdvanceTotal)} />
            <StatCard label="Gross Sale (incl. GST)" value={fmtINR(grossSalesTotal)} tone="accent" />
            <StatCard label="Net Sale (excl. GST)" value={fmtINR(netSalesTotal)} />
          </div>
          <div className="text-xs text-stone-400 mt-3">GST applied at 5%. Net sale = Gross sale − 4.7% of Gross sale, per your salon's calculation.</div>
        </div>
      )}

      {subTab === 'bills' && (
        <div>
          <div className="mb-3 text-sm text-stone-600">{rangeLabel} · {billSummaryRows.length} bill{billSummaryRows.length === 1 ? '' : 's'}</div>
          <div className="flex justify-end mb-3 no-print gap-2">
            <button onClick={exportBillSummaryCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Export CSV</button>
            <button onClick={() => window.print()} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Print</button>
          </div>
          {billSummaryRows.length === 0 ? <EmptyState title="No bills in this date range" /> : (
            <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                  <th className="px-4 py-2 font-medium">Invoice #</th><th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Service Provider</th><th className="px-4 py-2 font-medium text-right">Gross</th><th className="px-4 py-2 font-medium text-right">Net</th>
                  <th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Service</th><th className="px-4 py-2 font-medium">Payment</th>
                </tr></thead>
                <tbody className="divide-y divide-dotted divide-stone-200">
                  {billSummaryRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50 cursor-pointer" onClick={() => setBillModal(r.billRef)}>
                      <td className="px-4 py-2 font-mono text-xs text-stone-500 whitespace-nowrap">{r.invoiceNumber}</td>
                      <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{r.customer}</td>
                      <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{r.phone}</td>
                      <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{r.staffName}</td>
                      <td className="px-4 py-2 text-right font-medium text-stone-800 whitespace-nowrap">{fmtINR(r.gross)}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(r.net)}</td>
                      <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-4 py-2 text-stone-600">{r.servicesText}</td>
                      <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{r.paymentMode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-stone-400 mt-3">Click any row to edit or delete that bill.</div>
        </div>
      )}
      {billModal && <BillForm ctx={ctx} bill={billModal} onClose={() => setBillModal(null)} />}

      {subTab === 'staff' && (
        <div>
          <div className="mb-3 text-sm text-stone-600">{rangeLabel}</div>
          <div className="flex justify-end mb-3 no-print gap-2">
            <button onClick={exportServiceProviderCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Export CSV</button>
            <button onClick={() => window.print()} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Print</button>
          </div>
          {staffRows.length === 0 ? <EmptyState title="No staff to report on" /> : (
            <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                  <th className="px-4 py-2 font-medium">Staff</th><th className="px-4 py-2 font-medium text-right">Target</th><th className="px-4 py-2 font-medium text-right">Achieved</th>
                  <th className="px-4 py-2 font-medium text-right">Achieved %</th><th className="px-4 py-2 font-medium text-right">Gross</th><th className="px-4 py-2 font-medium text-right">Net</th>
                  <th className="px-4 py-2 font-medium text-right">Product Sale</th><th className="px-4 py-2 font-medium text-right">Clients</th><th className="px-4 py-2 font-medium text-right">ABV</th>
                </tr></thead>
                <tbody className="divide-y divide-dotted divide-stone-200">
                  {staffRows.map(r => (
                    <tr key={r.staff.id}>
                      <td className="px-4 py-2 font-medium text-stone-800 whitespace-nowrap">{r.staff.name}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{r.target > 0 ? fmtINR(r.target) : '—'}</td>
                      <td className="px-4 py-2 text-right font-medium text-stone-800 whitespace-nowrap">{fmtINR(r.gross)}</td>
                      <td className={`px-4 py-2 text-right whitespace-nowrap ${r.achievedPct !== null && r.achievedPct >= 100 ? 'text-emerald-600' : 'text-stone-600'}`}>{r.achievedPct === null ? 'No target' : r.achievedPct.toFixed(0) + '%'}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(r.gross)}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(r.net)}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(r.productSale)}</td>
                      <td className="px-4 py-2 text-right text-stone-600">{r.uniqueCustomers}</td>
                      <td className="px-4 py-2 text-right text-stone-600 whitespace-nowrap">{fmtINR(r.abv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-stone-400 mt-3">Target is the staff's Monthly Target (set in Staff → Edit) prorated to the number of days in the selected range.</div>
        </div>
      )}

      {subTab === 'services' && (
        <div className="bg-white rounded-lg border border-stone-200 divide-y divide-dotted divide-stone-200">
          {serviceStats.length === 0 ? <EmptyState title="No service data yet" /> : serviceStats.map(s => (
            <div key={s.service.id} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1 cursor-pointer" onClick={() => setExpandedService(expandedService === s.service.id ? null : s.service.id)}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-800 text-sm">{s.service.name}</span>
                  <Badge tone={s.service.category === 'Premium' ? 'premium' : 'default'}>{s.service.category}</Badge>
                </div>
                <span className="text-sm text-stone-600">{fmtINR(s.revenue)} · {s.count} bookings {expandedService === s.service.id ? '▲' : '▼'}</span>
              </div>
              <div className="w-full bg-stone-100 rounded-full h-1.5">
                <div className="bg-amber-600 h-1.5 rounded-full" style={{ width: `${(s.revenue / maxServiceRevenue) * 100}%` }}></div>
              </div>
              {expandedService === s.service.id && (
                <div className="mt-3 border border-stone-200 rounded-md divide-y divide-dotted divide-stone-200">
                  <div className="px-3 py-1.5 text-xs font-medium text-stone-500 bg-stone-50">Customers who took this service — useful for a premium customer list</div>
                  {customersForService(s.service.id).map((c, i) => (
                    <div key={i} className="flex justify-between px-3 py-2 text-sm">
                      <span className="text-stone-800">{c.name}</span>
                      <span className="text-stone-500">{c.phone}</span>
                      <span className="text-stone-500">{fmtDate(c.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {subTab === 'customers' && (
        <div>
          <div className="flex justify-end mb-3 no-print">
            <button onClick={exportCustomerReportCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600">Export CSV</button>
          </div>
          {opportunity && (
            <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-lg mb-4">
              <strong>{opportunity.bracket}</strong> has the lowest premium-service conversion ({opportunity.premiumPct.toFixed(0)}%) — an opportunity to upsell this group.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs font-medium text-stone-500 mb-2">By Age Bracket</div>
              <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                    <th className="px-3 py-2 font-medium">Bracket</th><th className="px-3 py-2 font-medium text-right">Bills</th><th className="px-3 py-2 font-medium text-right">Revenue</th><th className="px-3 py-2 font-medium text-right">Premium %</th>
                  </tr></thead>
                  <tbody className="divide-y divide-dotted divide-stone-200">
                    {ageStats.map(a => (
                      <tr key={a.bracket}>
                        <td className="px-3 py-2 text-stone-800">{a.bracket}</td>
                        <td className="px-3 py-2 text-right text-stone-600">{a.bills}</td>
                        <td className="px-3 py-2 text-right font-medium text-stone-800">{fmtINR(a.revenue)}</td>
                        <td className="px-3 py-2 text-right text-stone-600">{a.premiumPct.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-stone-500 mb-2">By Gender</div>
              <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                    <th className="px-3 py-2 font-medium">Gender</th><th className="px-3 py-2 font-medium text-right">Visits</th><th className="px-3 py-2 font-medium text-right">Revenue</th>
                  </tr></thead>
                  <tbody className="divide-y divide-dotted divide-stone-200">
                    {genderStats.map(g => (
                      <tr key={g.gender}>
                        <td className="px-3 py-2 text-stone-800">{g.gender}</td>
                        <td className="px-3 py-2 text-right text-stone-600">{g.visits}</td>
                        <td className="px-3 py-2 text-right font-medium text-stone-800">{fmtINR(g.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="text-xs font-medium text-stone-500 mb-2">Customer List</div>
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                <th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Contact</th><th className="px-4 py-2 font-medium text-right">Age</th><th className="px-4 py-2 font-medium">Gender</th>
              </tr></thead>
              <tbody className="divide-y divide-dotted divide-stone-200">
                {customerRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{r.phone}</td>
                    <td className="px-4 py-2 text-right text-stone-600">{r.age === null ? '—' : r.age}</td>
                    <td className="px-4 py-2 text-stone-600">{r.gender}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'products' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-stone-600">{rangeLabel} · {productSalesRows.length} sale{productSalesRows.length === 1 ? '' : 's'}</div>
            {productSalesRows.length > 0 && <button onClick={exportProductSalesCSV} className="text-xs px-3 py-1.5 rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50">Export CSV</button>}
          </div>
          {productSalesRows.length === 0 ? <EmptyState title="No tracked product sales in this range" sub="Sales recorded via Billing's Retail Products Sold section will show here." /> : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatCard label="Units Sold" value={productSalesTotals.quantity} />
                <StatCard label="Sale Value" value={fmtINR(productSalesTotals.saleValue)} tone="accent" />
                <StatCard label="Margin" value={fmtINR(productSalesTotals.margin)} />
              </div>
              <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                    <th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Invoice #</th><th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 font-medium text-right">Quantity</th><th className="px-4 py-2 font-medium text-right">Sale Value</th><th className="px-4 py-2 font-medium text-right">Margin</th>
                  </tr></thead>
                  <tbody className="divide-y divide-dotted divide-stone-200">
                    {productSalesRows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="px-4 py-2 text-stone-500 font-mono text-xs whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                        <td className="px-4 py-2 text-stone-800 font-medium whitespace-nowrap">{r.product}</td>
                        <td className="px-4 py-2 text-right text-stone-600">{r.quantity}</td>
                        <td className="px-4 py-2 text-right text-stone-800 whitespace-nowrap">{fmtINR(r.saleValue)}</td>
                        <td className="px-4 py-2 text-right text-emerald-700 whitespace-nowrap">{fmtINR(r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="text-xs text-stone-400 mt-3">Shows tracked retail products sold via Billing's Retail Products Sold section — not the general "Product Amount" field, which isn't tied to a specific product.</div>
        </div>
      )}

      {subTab === 'funnel' && (
        <div>
          <div className="text-xs text-stone-400 mb-4">Matches enquiries to appointments and bills by phone number, since these aren't directly linked records — the best available signal without changing how they're entered.</div>
          <div className="bg-white rounded-lg border border-stone-200 p-6 mb-6">
            <div className="space-y-4">
              {[
                { label: 'Enquiries', count: funnelEnquiries, tone: 'bg-stone-700' },
                { label: 'Appointments Booked', count: funnelAppointments, tone: 'bg-amber-700' },
                { label: 'Bills (Converted)', count: funnelBills, tone: 'bg-emerald-700' },
              ].map((s, i, arr) => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-stone-700">{s.label}</span>
                    <span className="text-stone-600">{s.count}</span>
                  </div>
                  <div className="w-full bg-stone-100 rounded-full h-8">
                    <div className={`${s.tone} h-8 rounded-full flex items-center justify-end pr-3 text-white text-xs font-medium transition-all`} style={{ width: `${funnelEnquiries ? (s.count / funnelEnquiries) * 100 : 0}%`, minWidth: s.count ? '40px' : '0' }}>
                      {i > 0 && arr[i - 1].count > 0 && `${((s.count / arr[i - 1].count) * 100).toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Enquiry → Appointment" value={funnelEnquiries ? `${((funnelAppointments / funnelEnquiries) * 100).toFixed(0)}%` : '—'} tone="accent" />
            <StatCard label="Appointment → Bill" value={funnelAppointments ? `${((funnelBills / funnelAppointments) * 100).toFixed(0)}%` : '—'} tone="accent" />
            <StatCard label="Overall Conversion" value={funnelEnquiries ? `${((funnelBills / funnelEnquiries) * 100).toFixed(0)}%` : '—'} tone="accent" />
          </div>
        </div>
      )}

      {subTab === 'noshow' && (
        <div>
          <div className="text-xs text-stone-400 mb-4">Based on Appointments' Source and Status fields.</div>
          {noShowRows.length === 0 ? <EmptyState title="No appointment data yet" sub="No-show and cancellation rates will appear here once appointments are logged." /> : (
            <>
              {(() => {
                const worst = [...noShowRows].sort((a, b) => (b.noShowPct + b.cancelPct) - (a.noShowPct + a.cancelPct))[0];
                return worst && (worst.noShowPct + worst.cancelPct) > 0 ? (
                  <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-lg mb-4">
                    <strong>{worst.source}</strong> has the highest combined no-show + cancellation rate ({(worst.noShowPct + worst.cancelPct).toFixed(0)}%) — worth tightening confirmation follow-up for that channel.
                  </div>
                ) : null;
              })()}
              <div className="bg-white rounded-lg border border-stone-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400 uppercase tracking-wide border-b border-stone-200">
                    <th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium text-right">Total</th><th className="px-4 py-2 font-medium text-right">No-Shows</th>
                    <th className="px-4 py-2 font-medium text-right">No-Show %</th><th className="px-4 py-2 font-medium text-right">Cancelled</th><th className="px-4 py-2 font-medium text-right">Cancel %</th>
                  </tr></thead>
                  <tbody className="divide-y divide-dotted divide-stone-200">
                    {noShowRows.map(r => (
                      <tr key={r.source}>
                        <td className="px-4 py-2 font-medium text-stone-800 whitespace-nowrap">{r.source}</td>
                        <td className="px-4 py-2 text-right text-stone-600">{r.total}</td>
                        <td className="px-4 py-2 text-right text-stone-600">{r.noShow}</td>
                        <td className="px-4 py-2 text-right"><Badge tone={r.noShowPct >= 25 ? 'danger' : r.noShowPct > 0 ? 'warn' : 'active'}>{r.noShowPct.toFixed(0)}%</Badge></td>
                        <td className="px-4 py-2 text-right text-stone-600">{r.cancelled}</td>
                        <td className="px-4 py-2 text-right"><Badge tone={r.cancelPct >= 15 ? 'danger' : r.cancelPct > 0 ? 'warn' : 'active'}>{r.cancelPct.toFixed(0)}%</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function TeamAccessCard({ ctx }) {
  const { notify } = ctx;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const addUser = async () => {
    if (!username.trim()) { notify('Enter a username'); return; }
    if (password.length < 6) { notify('Password must be at least 6 characters'); return; }
    setBusy(true);
    try {
      await apiAddUser(username.trim(), password);
      notify(`${username.trim()} can now log in`);
      setUsername(''); setPassword('');
    } catch (e) {
      notify(e.message || 'Could not add that login');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
      <div className="text-sm font-medium text-stone-700 mb-2">Team Access</div>
      <div className="text-sm text-stone-500 mb-3">
        Everyone who logs in — you, your manager, family — sees and edits the same live data. Add a login for each person below; there's no limit.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
        <Field label="Username"><input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} /></Field>
        <Field label="Password"><input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" /></Field>
      </div>
      <button onClick={addUser} disabled={busy} className="text-sm px-4 py-2 rounded-md bg-amber-700 text-white disabled:opacity-50">Add Login</button>
    </div>
  );
}

/* ---------------- AI assistant ---------------- */
function AssistantView({ ctx }) {
  const { notify } = ctx;
  const [provider, setProvider] = useState('claude');
  const [claudeConfigured, setClaudeConfigured] = useState(null); // null = checking
  const [geminiConfigured, setGeminiConfigured] = useState(null);
  const [displayMessages, setDisplayMessages] = useState([]);
  const [chatHistory, setChatHistory] = useState([]); // provider-specific history shape, passed through as-is
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = React.useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await apiFetch('/api/assistant/status');
        setClaudeConfigured(!!status.claudeConfigured);
        setGeminiConfigured(!!status.geminiConfigured);
      } catch (e) {
        setClaudeConfigured(false);
        setGeminiConfigured(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [displayMessages, sending]);

  const switchProvider = (p) => {
    if (p === provider) return;
    setProvider(p);
    setChatHistory([]);       // each provider's history shape is different -- a switch starts a fresh conversation
    setDisplayMessages([]);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setInput('');
    setDisplayMessages(m => [...m, { role: 'user', text: message }]);
    setSending(true);
    try {
      const res = await apiFetch('/api/assistant', { method: 'POST', body: JSON.stringify({ message, history: chatHistory, provider }) });
      setChatHistory(res.history || []);
      setDisplayMessages(m => [...m, { role: 'assistant', text: res.answer }]);
    } catch (e) {
      if (e instanceof AuthError) { notify('Session expired — please log in again'); }
      else setDisplayMessages(m => [...m, { role: 'assistant', text: `Sorry — ${e.message || 'something went wrong'}.` }]);
    } finally {
      setSending(false);
    }
  };

  const suggestions = [
    "Get me Kavya's report for last week",
    'What premium services has Ramesh done?',
    'Which age group is visiting the most?',
    'Show me new enquiries',
  ];

  if (claudeConfigured === null || geminiConfigured === null) {
    return <div className="text-sm text-stone-400">Checking assistant setup…</div>;
  }

  const currentlyConfigured = provider === 'gemini' ? geminiConfigured : claudeConfigured;
  const providerToggle = (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xs text-stone-400">Assistant:</span>
      <button onClick={() => switchProvider('claude')} className={`text-xs px-3 py-1.5 rounded-full border ${provider === 'claude' ? 'bg-amber-700 text-white border-amber-700' : 'border-stone-300 text-stone-600'}`}>Claude</button>
      <button onClick={() => switchProvider('gemini')} className={`text-xs px-3 py-1.5 rounded-full border ${provider === 'gemini' ? 'bg-amber-700 text-white border-amber-700' : 'border-stone-300 text-stone-600'}`}>Gemini</button>
    </div>
  );

  if (!currentlyConfigured) {
    return (
      <div>
        <SectionHeader title="Assistant" />
        {providerToggle}
        <div className="bg-white rounded-lg border border-stone-200 p-6">
          <div className="text-sm font-medium text-stone-700 mb-2">{provider === 'gemini' ? 'Gemini' : 'Claude'} isn't set up yet</div>
          {provider === 'gemini' ? (
            <>
              <p className="text-sm text-stone-500 mb-3">
                The Gemini assistant needs an API key on the server. On the server
                computer, create a file named <span className="font-mono text-xs bg-stone-100 px-1 rounded">gemini-api-key.txt</span> inside
                the <span className="font-mono text-xs bg-stone-100 px-1 rounded">data</span> folder next to <span className="font-mono text-xs bg-stone-100 px-1 rounded">server.py</span>, paste your key into it, save, and restart the server.
              </p>
              <p className="text-xs text-stone-400">Get a key at aistudio.google.com. Gemini has a free usage tier with rate limits — this is billed (or rate-limited) on your own Google account, not Anthropic's.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-500 mb-3">
                The AI assistant needs an Anthropic API key on the server. On the server
                computer, create a file named <span className="font-mono text-xs bg-stone-100 px-1 rounded">anthropic-api-key.txt</span> inside
                the <span className="font-mono text-xs bg-stone-100 px-1 rounded">data</span> folder next to <span className="font-mono text-xs bg-stone-100 px-1 rounded">server.py</span>, paste your key into it, save, and restart the server.
              </p>
              <p className="text-xs text-stone-400">Get a key at console.anthropic.com. Each question costs a small amount — this is billed to your Anthropic account, not free.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>
      {providerToggle}
      <SectionHeader title="Assistant" />
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white rounded-lg border border-stone-200 p-4 mb-3">
        {displayMessages.length === 0 && (
          <div>
            <div className="text-sm text-stone-400 mb-3">Ask about your staff, services, customers, or enquiries. Try one of these:</div>
            <div className="flex flex-col gap-2 items-start">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => setInput(s)} className="text-sm text-left px-3 py-2 rounded-md bg-stone-50 border border-stone-200 text-stone-600 hover:bg-stone-100">{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3">
          {displayMessages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-800'}`}>{m.text}</div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-stone-100 text-stone-400">Thinking…</div>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 no-print">
        <input
          className={inputCls}
          placeholder="Ask a question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()} className="px-4 py-2 text-sm rounded-md bg-amber-700 hover:bg-amber-800 text-white disabled:opacity-50 whitespace-nowrap">Send</button>
      </div>
    </div>
  );
}

function BackupView({ ctx }) {
  const { settings, saveSettings, runBackup, restoreFromFile, customers, bills, notify } = ctx;
  const [salonName, setSalonName] = useState(settings.salonName || '');
  const [inactiveDays, setInactiveDays] = useState(settings.inactiveDays || 45);
  const [birthdayWindowDays, setBirthdayWindowDays] = useState(settings.birthdayWindowDays || 7);

  const saveSettingsForm = () => {
    saveSettings({ ...settings, salonName: salonName.trim(), inactiveDays: Number(inactiveDays) || 45, birthdayWindowDays: Number(birthdayWindowDays) || 7 });
    notify('Settings saved');
  };

  const exportCustomersCSV = () => {
    const rows = customers.map(c => {
      const stats = customerStats(c.id, bills);
      return { Name: c.name, Phone: c.phone, DOB: c.dob, 'Age Bracket': getAgeBracket(c.dob), Membership: membershipStatus(c), 'Last Visit': stats.lastVisit ? fmtDate(stats.lastVisit) : '', Visits: stats.totalVisits, 'Total Spend': stats.totalSpend.toFixed(0) };
    });
    downloadText('customers.csv', toCSV(rows), 'text/csv');
  };
  const exportBillsCSV = () => {
    const rows = bills.map(b => ({ Date: fmtDate(b.date), CustomerId: b.customerId, StaffId: b.staffId, Services: b.items.length, Subtotal: b.subtotal.toFixed(0), 'Discount %': b.discountPercent, Total: b.total.toFixed(0), Payment: b.paymentMode }));
    downloadText('bills.csv', toCSV(rows), 'text/csv');
  };
  const downloadCopy = () => {
    downloadJSON(`salon-backup-${todayISO()}.json`, { customers, staff: ctx.staff, services: ctx.services, bills, membershipPlans: ctx.membershipPlans, offerCodes: ctx.offerCodes, outreachLog: ctx.outreachLog, settings });
  };

  return (
    <div>
      <SectionHeader title="Backup & Settings" />
      <TeamAccessCard ctx={ctx} />
      <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
        <div className="text-sm font-medium text-stone-700 mb-2">Backups</div>
        <div className="text-sm text-stone-500 mb-3">
          Every change saves to the server immediately. Last dated backup:{' '}
          <strong className="text-stone-700">{settings.lastBackupISO ? fmtDateTime(settings.lastBackupISO) : 'Never'}</strong>.
          {' '}A timestamped copy is written into the server's <span className="font-mono text-xs">data/backups</span> folder automatically, once a day.
        </div>
        <div className="bg-stone-50 border border-stone-200 rounded-md p-3 text-xs text-stone-500 mb-3">
          If the server's data folder is inside a Google Drive Desktop sync folder on that computer, both the live database and every dated backup reach Drive automatically — no extra step.
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => runBackup(false)} className="text-sm px-3 py-2 rounded-md bg-amber-700 text-white">Back Up Now</button>
          <button onClick={downloadCopy} className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600">Download a Copy</button>
          <label className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600 cursor-pointer">
            Restore from File
            <input type="file" accept="application/json" className="hidden" onChange={e => e.target.files[0] && restoreFromFile(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 p-4 mb-6">
        <div className="text-sm font-medium text-stone-700 mb-3">Export Data</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCustomersCSV} className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600">Export Customers (CSV)</button>
          <button onClick={exportBillsCSV} className="text-sm px-3 py-2 rounded-md border border-stone-300 text-stone-600">Export Bills (CSV)</button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 p-4">
        <div className="text-sm font-medium text-stone-700 mb-3">Settings</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Field label="Salon Name"><input className={inputCls} value={salonName} onChange={e => setSalonName(e.target.value)} /></Field>
          <Field label="Inactive after (days)"><input type="number" className={inputCls} value={inactiveDays} onChange={e => setInactiveDays(e.target.value)} /></Field>
          <Field label="Birthday reminder window (days)"><input type="number" className={inputCls} value={birthdayWindowDays} onChange={e => setBirthdayWindowDays(e.target.value)} /></Field>
        </div>
        <button onClick={saveSettingsForm} className="mt-2 text-sm px-4 py-2 rounded-md bg-amber-700 text-white">Save Settings</button>
      </div>
    </div>
  );
}

/* ---------------- app root ---------------- */
const EMPTY_SETTINGS = { salonName: 'My Salon', inactiveDays: 45, birthdayWindowDays: 7, lastBackupISO: null };

function App() {
  const [authPhase, setAuthPhase] = useState('checking'); // checking | setup | login | ready
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('staff');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [services, setServices] = useState([]);
  const [bills, setBills] = useState([]);
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [offerCodes, setOfferCodes] = useState([]);
  const [outreachLog, setOutreachLog] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [roster, setRoster] = useState([]);
  const [makeupBookings, setMakeupBookings] = useState([]);
  const [stockEntries, setStockEntries] = useState([]);
  const [pnlLiabilities, setPnlLiabilities] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [toast, setToast] = useState(null);

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const handleAuthError = () => {
    authToken = null;
    setAuthPhase('login');
    notify('Session expired — please log in again');
  };

  const loadEverything = async () => {
    const data = await fetchAll();
    setCustomers(data.customers || []);
    setStaff(data.staff || []);
    setServices(data.services || []);
    setBills(data.bills || []);
    setMembershipPlans(data.membershipPlans || []);
    setOfferCodes(data.offerCodes || []);
    setOutreachLog(data.outreachLog || []);
    setEnquiries(data.enquiries || []);
    setAppointments(data.appointments || []);
    setAttendance(data.attendance || []);
    setRoster(data.roster || []);
    setMakeupBookings(data.makeupBookings || []);
    setStockEntries(data.stockEntries || []);
    setPnlLiabilities(data.pnlLiabilities || []);
    setExpenses(data.expenses || []);
    setPayrollRecords(data.payrollRecords || []);
    setSettings(data.settings || EMPTY_SETTINGS);
  };

  useEffect(() => {
    (async () => {
      try {
        const status = await fetchBootstrapStatus();
        setAuthPhase(status.needsSetup ? 'setup' : 'login');
      } catch (e) {
        setAuthPhase('login');
      }
    })();
  }, []);

  const onAuthed = async (loggedInUsername, loggedInRole) => {
    setUsername(loggedInUsername || '');
    setRole(loggedInRole || 'staff');
    try {
      await loadEverything();
      setAuthPhase('ready');
    } catch (e) {
      if (e instanceof AuthError) handleAuthError();
      else notify('Could not load data from the server');
    }
  };

  const logout = async () => {
    await apiLogout();
    setCustomers([]); setStaff([]); setServices([]); setBills([]);
    setMembershipPlans([]); setOfferCodes([]); setOutreachLog([]); setEnquiries([]); setAppointments([]); setAttendance([]); setRoster([]); setMakeupBookings([]); setStockEntries([]); setPnlLiabilities([]); setExpenses([]); setPayrollRecords([]); setSettings(EMPTY_SETTINGS);
    setAuthPhase('login');
  };

  const withAuthHandling = async (fn) => {
    try { await fn(); }
    catch (e) {
      if (e instanceof AuthError) handleAuthError();
      else { console.error(e); notify(e.message || 'Could not save — check the connection'); }
    }
  };

  const saveEntity = (table, old, setter, arr) => {
    setter(arr);
    withAuthHandling(async () => {
      try {
        const updates = await diffAndSync(table, old, arr);
        if (updates.length) {
          setter(current => current.map(r => {
            const u = updates.find(x => x.id === r.id);
            return u ? { ...r, ...u } : r;
          }));
        }
      } catch (e) {
        setter(old); // roll back the optimistic update so rejected records don't linger in the UI
        throw e;
      }
    });
  };

  const saveCustomers = (arr) => saveEntity('customers', customers, setCustomers, arr);
  const saveStaff = (arr) => saveEntity('staff', staff, setStaff, arr);
  const saveServices = (arr) => saveEntity('services', services, setServices, arr);
  const saveBills = (arr) => saveEntity('bills', bills, setBills, arr);
  const saveMembershipPlans = (arr) => saveEntity('membershipPlans', membershipPlans, setMembershipPlans, arr);
  const saveOfferCodes = (arr) => saveEntity('offerCodes', offerCodes, setOfferCodes, arr);
  const saveOutreachLog = (arr) => saveEntity('outreachLog', outreachLog, setOutreachLog, arr);
  const saveEnquiries = (arr) => saveEntity('enquiries', enquiries, setEnquiries, arr);
  const saveAppointments = (arr) => saveEntity('appointments', appointments, setAppointments, arr);
  const saveAttendance = (arr) => saveEntity('attendance', attendance, setAttendance, arr);
  const saveRoster = (arr) => saveEntity('roster', roster, setRoster, arr);
  const saveMakeupBookings = (arr) => saveEntity('makeupBookings', makeupBookings, setMakeupBookings, arr);
  const saveStockEntries = (arr) => saveEntity('stockEntries', stockEntries, setStockEntries, arr);
  const savePnlLiabilities = (arr) => saveEntity('pnlLiabilities', pnlLiabilities, setPnlLiabilities, arr);
  const saveExpenses = (arr) => saveEntity('expenses', expenses, setExpenses, arr);
  const savePayrollRecords = (arr) => saveEntity('payrollRecords', payrollRecords, setPayrollRecords, arr);
  const saveSettings = (obj) => {
    const old = settings;
    setSettings(obj);
    withAuthHandling(async () => {
      try {
        const updated = await apiUpdateSettings(obj);
        setSettings(updated);
      } catch (e) {
        setSettings(old);
        throw e;
      }
    });
  };

  const runBackup = async (auto) => {
    await withAuthHandling(async () => {
      const out = await apiBackupNow();
      setSettings(s => ({ ...s, lastBackupISO: out.backedUpAt }));
      notify(auto ? 'Daily backup saved on the server' : 'Backup saved on the server');
    });
  };

  const restoreFromFile = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!window.confirm('This replaces all current data with this backup file, for everyone. Continue?')) return;
        await withAuthHandling(async () => {
          await diffAndSync('customers', customers, data.customers || []);
          await diffAndSync('staff', staff, data.staff || []);
          await diffAndSync('services', services, data.services || []);
          await diffAndSync('bills', bills, data.bills || []);
          await diffAndSync('membershipPlans', membershipPlans, data.membershipPlans || []);
          await diffAndSync('offerCodes', offerCodes, data.offerCodes || []);
          await diffAndSync('outreachLog', outreachLog, data.outreachLog || []);
          await diffAndSync('enquiries', enquiries, data.enquiries || []);
          await diffAndSync('appointments', appointments, data.appointments || []);
          await diffAndSync('attendance', attendance, data.attendance || []);
          await diffAndSync('roster', roster, data.roster || []);
          await diffAndSync('makeupBookings', makeupBookings, data.makeupBookings || []);
          await diffAndSync('stockEntries', stockEntries, data.stockEntries || []);
          await diffAndSync('pnlLiabilities', pnlLiabilities, data.pnlLiabilities || []);
          await diffAndSync('expenses', expenses, data.expenses || []);
          await diffAndSync('payrollRecords', payrollRecords, data.payrollRecords || []);
          if (data.settings) await apiUpdateSettings(data.settings);
          await loadEverything();
          notify('Data restored');
        });
      } catch (err) { notify('Could not read that file — is it a valid backup?'); }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (authPhase !== 'ready') return;
    const last = settings.lastBackupISO ? new Date(settings.lastBackupISO) : null;
    const due = !last || (Date.now() - last.getTime()) > 24 * 60 * 60 * 1000;
    if (due && (customers.length || staff.length || services.length || bills.length)) {
      runBackup(true);
    }
    // eslint-disable-next-line
  }, [authPhase]);

  const servicesById = useMemo(() => { const o = {}; services.forEach(s => { o[s.id] = s; }); return o; }, [services]);
  const staffById = useMemo(() => { const o = {}; staff.forEach(s => { o[s.id] = s; }); return o; }, [staff]);
  const customersById = useMemo(() => { const o = {}; customers.forEach(c => { o[c.id] = c; }); return o; }, [customers]);

  if (authPhase === 'checking') {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-500 text-sm">Connecting…</div>;
  }
  if (authPhase === 'setup') {
    return <SetupScreen onDone={onAuthed} />;
  }
  if (authPhase === 'login') {
    return <LoginScreen onDone={onAuthed} />;
  }

  const ctx = {
    customers, staff, services, bills, membershipPlans, offerCodes, outreachLog, enquiries, appointments, attendance, roster, makeupBookings, stockEntries, pnlLiabilities, expenses, payrollRecords, settings, role,
    saveCustomers, saveStaff, saveServices, saveBills, saveMembershipPlans, saveOfferCodes, saveOutreachLog, saveEnquiries, saveAppointments, saveAttendance, saveRoster, saveMakeupBookings, saveStockEntries, savePnlLiabilities, saveExpenses, savePayrollRecords, saveSettings,
    servicesById, staffById, customersById, notify, setActiveTab, runBackup, restoreFromFile, refreshAll: loadEverything,
  };

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="flex flex-col md:flex-row">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} salonName={settings.salonName} username={username} role={role} onLogout={logout} />
        <div className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
          {activeTab === 'dashboard' && <DashboardView ctx={ctx} />}
          {activeTab === 'billing' && <BillingView ctx={ctx} />}
          {activeTab === 'customers' && <CustomersView ctx={ctx} />}
          {activeTab === 'staff' && <StaffView ctx={ctx} />}
          {activeTab === 'services' && <ServicesView ctx={ctx} />}
          {activeTab === 'memberships' && <MembershipsView ctx={ctx} />}
          {activeTab === 'enquiries' && <EnquiriesView ctx={ctx} />}
          {activeTab === 'appointments' && <AppointmentsView ctx={ctx} />}
          {activeTab === 'attendance' && <AttendanceView ctx={ctx} />}
          {activeTab === 'roster' && <RosterView ctx={ctx} />}
          {activeTab === 'makeup' && <MakeupBookingsView ctx={ctx} />}
          {activeTab === 'inventory' && <InventoryView ctx={ctx} />}
          {activeTab === 'manage-products' && <ManageProductsView ctx={ctx} />}
          {activeTab === 'expenses' && <ExpensesView ctx={ctx} />}
          {activeTab === 'payroll' && <PayrollView ctx={ctx} />}
          {activeTab === 'admin-pnl' && (role === 'admin' ? <AdminPLView ctx={ctx} /> : <div className="text-sm text-stone-500">Admin access required.</div>)}
          {activeTab === 'outreach' && <OutreachView ctx={ctx} />}
          {activeTab === 'reports' && <ReportsView ctx={ctx} />}
          {activeTab === 'assistant' && <AssistantView ctx={ctx} />}
          {activeTab === 'backup' && <BackupView ctx={ctx} />}
        </div>
      </div>
      {toast && <div className="fixed bottom-4 right-4 bg-stone-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg no-print z-50">{toast}</div>}
    </div>
  );
}

