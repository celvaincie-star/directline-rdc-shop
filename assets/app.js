/* Directline RDC — site sans serveur.
   Les données (comptes, colis, paramètres) sont enregistrées dans le navigateur (localStorage) :
   elles ne sont pas partagées entre appareils. Voir README.md. */
'use strict';

/* ================================================================
   Outils
   ================================================================ */
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const multiline = (s) => esc(s).replace(/\n/g, '<br>');
const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const ICONS = window.DL_ICONS || {};
const icon = (name, size = 18, cls = '') =>
  `<svg class="shrink-0 ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const usd = (n) => `${nf2.format(Number(n) || 0)}\u00a0$`;
const num = (n) => nf.format(Number(n) || 0);
const plural = (n, word, many = word + 's') => `${num(n)}\u00a0${Math.abs(Number(n)) >= 2 ? many : word}`;
const normPhone = (s) => String(s || '').replace(/\D/g, '');
const samePhone = (a, b) => normPhone(a).length >= 9 && normPhone(a).slice(-9) === normPhone(b).slice(-9);

function toDate(value) {
  if (!value) return null;
  const d = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') : value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatDate(value, withTime = true) {
  const d = toDate(value);
  if (!d) return esc(value || '');
  return d.toLocaleString('fr-FR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'long', year: 'numeric' });
}
const nowIso = () => new Date().toISOString();

function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Empreinte du mot de passe : on n'enregistre jamais le mot de passe lui-même.
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5; // Repli si le site est ouvert hors HTTPS.
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv-' + h.toString(16);
}
async function makeCredential(password) {
  const salt = randomHex();
  return { salt, passHash: await hashPassword(password, salt) };
}
async function checkCredential(record, password) {
  if (!record) return false;
  if (record.passHash) return (await hashPassword(password, record.salt)) === record.passHash;
  return record.pass !== undefined && record.pass === password; // ancien format, converti après connexion
}
function uniqueId(prefix, exists) {
  let id;
  do { id = prefix + String(Math.floor(100000 + Math.random() * 900000)); } while (exists(id));
  return id;
}

/* ================================================================
   Stockage (navigateur)
   ================================================================ */
const cache = new Map();
const store = {
  get(key, fallback) {
    if (cache.has(key)) return cache.get(key);
    let value = fallback;
    try {
      const raw = localStorage.getItem('dl_' + key);
      if (raw !== null) value = JSON.parse(raw);
    } catch { /* valeur illisible : on garde la valeur par défaut */ }
    cache.set(key, value);
    return value;
  },
  set(key, value) {
    try {
      localStorage.setItem('dl_' + key, JSON.stringify(value));
      cache.set(key, value);
      return true;
    } catch {
      cache.delete(key);
      toast('Espace de stockage du navigateur plein : exportez une sauvegarde et supprimez d’anciennes photos.', 'error');
      return false;
    }
  },
  remove(key) {
    cache.delete(key);
    try { localStorage.removeItem('dl_' + key); } catch { /* rien à faire */ }
  },
};
const sessionFlag = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* navigation privée */ } },
  clear: (k) => { try { sessionStorage.removeItem(k); } catch { /* navigation privée */ } },
};

const PLACEHOLDER_PHONE = '+243 812 345 678';
const DEFAULT_SETTINGS = {
  ratePerKg: 5,
  contactPhone: PLACEHOLDER_PHONE,
  contactEmail: '',
  address: 'Baiyun District, Guangzhou, Guangdong, Chine\nCode postal : 510000\nTéléphone entrepôt : +86 188 0000 0000',
  addressZh: '广东省广州市白云区\n邮编：510000\n电话：+86 188 0000 0000',
  pickupPoints: 'Kinshasa\nLubumbashi',
  transitTime: '',
  paymentName: 'Directline RDC',
  mpesa: '',
  orangeMoney: '',
  airtelMoney: '',
  loyaltyPointsPerKg: 1,
  loyaltyThreshold: 50,
  loyaltyRewardKg: 2,
};

const Data = {
  settings() {
    const saved = store.get('settings', {});
    const s = { ...DEFAULT_SETTINGS, ...saved };
    if (saved.ratePerKg === undefined) s.ratePerKg = Number(store.get('rate_per_kg', DEFAULT_SETTINGS.ratePerKg));
    return s;
  },
  saveSettings(s) { store.set('rate_per_kg', s.ratePerKg); return store.set('settings', s); },
  users: () => store.get('users', []),
  saveUsers: (v) => store.set('users', v),
  parcels: () => store.get('parcels', []),
  saveParcels: (v) => store.set('parcels', v),
  notifications: () => store.get('notifications', []),
  saveNotifications: (v) => store.set('notifications', v),
};

const STATUSES = {
  RECEIVED_CHINA: { label: 'Reçu en Chine', step: 'Reçu à Guangzhou', cls: 'bg-red-50 text-brand-red', icon: 'warehouse' },
  IN_TRANSIT: { label: 'En transit', step: 'En vol', cls: 'bg-amber-50 text-amber-700', icon: 'plane' },
  ARRIVED_RDC: { label: 'Arrivé en RDC', step: 'Arrivé en RDC', cls: 'bg-brand-sky text-brand-blue', icon: 'map-pin' },
  DELIVERED: { label: 'Livré', step: 'Livré', cls: 'bg-emerald-50 text-emerald-700', icon: 'package-check' },
};
const STATUS_ORDER = Object.keys(STATUSES);
const PAYMENT_STATUSES = {
  UNPAID: { label: 'À payer', cls: 'bg-slate-100 text-slate-600' },
  PENDING: { label: 'Paiement à vérifier', cls: 'bg-amber-50 text-amber-700' },
  PAID: { label: 'Payé', cls: 'bg-emerald-50 text-emerald-700' },
};
const PAY_METHODS = [
  { id: 'mpesa', label: 'M-Pesa (Vodacom)' },
  { id: 'orangeMoney', label: 'Orange Money' },
  { id: 'airtelMoney', label: 'Airtel Money' },
  { id: 'cash', label: 'Espèces au point de retrait' },
];
const payMethodLabel = (id) => PAY_METHODS.find((m) => m.id === id)?.label || id || '';

/* ================================================================
   Règles métier
   ================================================================ */
const parcelRate = (p) => Number(p.ratePerKg ?? Data.settings().ratePerKg) || 0;
const transportCost = (p) => (Number(p.weight) || 0) * parcelRate(p);
const consolidationCost = (p) => (p.applyConsolidation ? Number(p.consolidationFee) || 0 : 0);
const customsCost = (p) => Number(p.customsFee) || 0;
const price = (p) => transportCost(p) + consolidationCost(p) + customsCost(p);
const paymentStatus = (p) => (PAYMENT_STATUSES[p.paymentStatus] ? p.paymentStatus : 'UNPAID');

function loyaltyOf(user) {
  const s = Data.settings();
  const points = Number(user?.points) || 0;
  const threshold = Math.max(1, Number(s.loyaltyThreshold) || DEFAULT_SETTINGS.loyaltyThreshold);
  return {
    points,
    threshold,
    rewards: Math.floor(points / threshold),
    rewardKg: Number(s.loyaltyRewardKg) || 0,
    pointsPerKg: Number(s.loyaltyPointsPerKg) || 0,
    toNext: threshold - (points % threshold),
    progress: (points % threshold) / threshold,
  };
}

function waNumber(phone) {
  let d = normPhone(phone);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '243' + d.slice(1);
  return d;
}
const waLink = (text = '') => `https://wa.me/${waNumber(Data.settings().contactPhone)}${text ? '?text=' + encodeURIComponent(text) : ''}`;

function addressText(user, lang = 'fr') {
  const s = Data.settings();
  if (lang === 'zh') return `收件人：Directline RDC ${user ? `${user.id} ${user.firstname} ${user.name}` : '[客户编号]'}\n${s.addressZh}`;
  return `Nom : Directline RDC · ${user ? `${user.firstname} ${user.name} · ${user.id}` : '[Votre nom · référence client]'}\n${s.address}`;
}

function notify(clientId, title, message) {
  const ns = Data.notifications();
  ns.unshift({ id: Date.now() + Math.random(), clientId, title, message, date: nowIso(), read: false });
  Data.saveNotifications(ns.slice(0, 500));
}

/* ================================================================
   Session
   ================================================================ */
let sessionUserId = store.get('session_user_id', null) || (() => {
  try { return JSON.parse(sessionStorage.getItem('dl_session_user') || 'null')?.id || null; } catch { return null; }
})();
let isAdmin = sessionFlag.get('dl_session_admin') === 'true';
const currentUser = () => (sessionUserId ? Data.users().find((u) => u.id === sessionUserId) || null : null);

function startSession(user) {
  sessionUserId = user.id;
  store.set('session_user_id', user.id);
}
function logout() {
  sessionUserId = null;
  store.remove('session_user_id');
  sessionFlag.clear('dl_session_user');
  toast('Vous êtes déconnecté.', 'info');
  go('');
}
function adminLogout() {
  isAdmin = false;
  sessionFlag.clear('dl_session_admin');
  toast('Session administrateur fermée.', 'info');
  go('');
}

/* ================================================================
   Interface commune
   ================================================================ */
function toast(message, type = 'success') {
  const root = $('#toast-root');
  if (!root) return;
  const styles = { success: ['bg-brand-night', 'circle-check'], error: ['bg-brand-red', 'circle-alert'], info: ['bg-brand-ink', 'info'] }[type] || ['bg-brand-night', 'info'];
  const n = document.createElement('div');
  n.className = `toast-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl ${styles[0]} px-4 py-3 text-sm font-medium text-white shadow-xl`;
  n.setAttribute('role', type === 'error' ? 'alert' : 'status');
  n.innerHTML = icon(styles[1], 18) + `<span>${esc(message)}</span>`;
  root.append(n);
  setTimeout(() => n.remove(), type === 'error' ? 6000 : 3500);
}

async function copyText(text, message = 'Copié dans le presse-papiers.') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    try { document.execCommand('copy'); } catch { /* ignoré */ }
    t.remove();
  }
  toast(message);
}

let lastFocus = null;
function modal(html, { wide = false } = {}) {
  lastFocus = document.activeElement;
  $('#modal-root').innerHTML = `
    <div class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-brand-night/60 p-4 backdrop-blur-sm" data-action="backdrop">
      <div class="modal-in relative my-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-3xl bg-white p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button type="button" data-action="close-modal" class="icon-btn absolute right-4 top-4" aria-label="Fermer">${icon('x', 20)}</button>
        ${html}
      </div>
    </div>`;
  const first = $('#modal-root [autofocus]') || $('#modal-root input:not([type=hidden]), #modal-root select, #modal-root textarea, #modal-root button:not([data-action=close-modal])');
  first?.focus();
}
function closeModal() {
  $('#modal-root').innerHTML = '';
  lastFocus?.focus?.();
}

const eyebrow = (text, cls = '') => `<div class="eyebrow ${cls}">${text}</div>`;
function sectionHead(kicker, title, text = '', center = true) {
  return `<div class="${center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}">
    ${eyebrow(kicker, center ? 'justify-center' : '')}
    <h2 class="display mt-4 text-3xl sm:text-4xl">${title}</h2>
    ${text ? `<p class="mt-4 text-slate-600">${text}</p>` : ''}
  </div>`;
}
function pageHead(kicker, title, text = '', extra = '') {
  return `<div class="flex flex-wrap items-end justify-between gap-6">
    <div class="max-w-2xl">${eyebrow(kicker)}<h1 class="display mt-4 text-4xl sm:text-5xl">${title}</h1>${text ? `<p class="mt-4 text-lg text-slate-600">${text}</p>` : ''}</div>
    ${extra}
  </div>`;
}
const statusBadge = (status) => {
  const s = STATUSES[status] || { label: 'Inconnu', cls: 'bg-slate-100 text-slate-600' };
  return `<span class="chip ${s.cls}"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>${s.label}</span>`;
};
const paymentBadge = (p) => {
  const s = PAYMENT_STATUSES[paymentStatus(p)];
  return `<span class="chip ${s.cls}">${s.label}</span>`;
};
const statTile = (ic, label, value, sub = '') => `
  <div class="card p-5">
    <div class="flex items-start justify-between gap-3">
      <div><div class="text-xs font-semibold text-slate-500">${label}</div><div class="mt-2 font-display text-2xl font-extrabold text-brand-night">${value}</div>${sub ? `<div class="mt-1 text-xs text-slate-400">${sub}</div>` : ''}</div>
      <span class="icon-tile !h-10 !w-10">${icon(ic, 19)}</span>
    </div>
  </div>`;

/* ---------- Dessins inspirés du logo ---------- */
function starPoints(cx, cy, r, rotation = -90) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = ((rotation + i * 36) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.4 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
function flagChina(cx, cy, r, id) {
  const small = [[0.22, -0.52, -54], [0.44, -0.24, -72], [0.44, 0.08, -100], [0.22, 0.34, -120]];
  return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <g clip-path="url(#${id})"><rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#e02010"/>
    <polygon points="${starPoints(cx - r * 0.3, cy - r * 0.1, r * 0.42)}" fill="#ffde00"/>
    ${small.map(([dx, dy, rot]) => `<polygon points="${starPoints(cx + dx * r, cy + dy * r, r * 0.13, rot)}" fill="#ffde00"/>`).join('')}</g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${r * 0.14}"/>`;
}
function flagDrc(cx, cy, r, id) {
  return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <g clip-path="url(#${id})"><rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#0a7fd9"/>
    <g transform="rotate(-33 ${cx} ${cy})"><rect x="${cx - 2 * r}" y="${cy - r * 0.27}" width="${4 * r}" height="${r * 0.54}" fill="#f9d616"/><rect x="${cx - 2 * r}" y="${cy - r * 0.17}" width="${4 * r}" height="${r * 0.34}" fill="#ce1021"/></g>
    <polygon points="${starPoints(cx - r * 0.42, cy - r * 0.4, r * 0.3)}" fill="#f9d616"/></g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${r * 0.14}"/>`;
}
function tracePath(points, color, width = 2.5, nodeFill = '#fff', flow = false) {
  const d = 'M' + points.map((p) => p.join(' ')).join(' L');
  const [ex, ey] = points[points.length - 1];
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>
    ${flow ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="${width}" stroke-linecap="round" class="circuit-flow" opacity=".75"/>` : ''}
    <circle cx="${ex}" cy="${ey}" r="${width * 2.2}" fill="${nodeFill}" stroke="${color}" stroke-width="${width}"/>`;
}
// Pistes « circuit » : chaudes côté Chine (gauche), bleues côté RDC (droite).
function circuitBackdrop(dark = false) {
  const warm = ['#e02010', '#f07a12', '#f9c20a', '#e02010'];
  const cool = dark ? ['#5b9be6', '#0a67c9', '#8fbaf0', '#0a67c9'] : ['#003a90', '#0a67c9', '#5b9be6', '#0a67c9'];
  const node = dark ? '#021c4a' : '#fff';
  const left = [
    [[-20, 630], [260, 630], [290, 660], [420, 660]],
    [[-20, 665], [150, 665], [172, 643], [235, 643]],
    [[-20, 30], [120, 30], [150, 60], [230, 60]],
    [[-20, 700], [330, 700], [350, 684], [470, 684]],
  ];
  const right = [
    [[1460, 90], [1310, 90], [1260, 140], [1130, 140]],
    [[1460, 190], [1360, 190], [1310, 240], [1210, 240]],
    [[1460, 560], [1290, 560], [1240, 610], [1100, 610]],
    [[1460, 650], [1370, 650], [1320, 600], [1240, 600]],
  ];
  return `<svg class="pointer-events-none absolute inset-0 h-full w-full ${dark ? 'opacity-40' : 'opacity-60'}" viewBox="0 0 1440 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path d="M880 60 H1060 A300 300 0 0 1 1060 660 H880" fill="none" stroke="#0a67c9" stroke-width="12" stroke-linecap="round" opacity="${dark ? '.35' : '.08'}"/>
    ${left.map((pts, i) => tracePath(pts, warm[i], 2.5, node, i < 2)).join('')}
    ${right.map((pts, i) => (dark && i < 2 ? '' : tracePath(pts, cool[i], 2.5, node, i < 2))).join('')}
  </svg>`;
}

// Carte du trajet Chine → RDC : l'avion avance selon le statut.
function routeMap(status) {
  const P0 = [120, 92], P1 = [320, -6], P2 = [520, 92];
  const t = { RECEIVED_CHINA: 0.05, IN_TRANSIT: 0.5, ARRIVED_RDC: 0.95, DELIVERED: 0.95 }[status] ?? 0.05;
  const pt = (k) => [0, 1].map((i) => (1 - k) ** 2 * P0[i] + 2 * (1 - k) * k * P1[i] + k ** 2 * P2[i]);
  const [x, y] = pt(t);
  const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
  const dy = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 45;
  const d = `M${P0.join(' ')} Q${P1.join(' ')} ${P2.join(' ')}`;
  const uid = Math.random().toString(36).slice(2, 8);
  const transit = status === 'IN_TRANSIT';
  const message = {
    RECEIVED_CHINA: ['warehouse', 'Votre colis est à notre entrepôt de Guangzhou. Il partira au prochain vol.', 'text-brand-red'],
    IN_TRANSIT: ['plane', 'Votre colis est en vol vers la RDC.', 'text-amber-700'],
    ARRIVED_RDC: ['map-pin', 'Votre colis est arrivé en RDC : il vous attend au point de retrait.', 'text-brand-blue'],
    DELIVERED: ['package-check', 'Votre colis a été livré. Merci de votre confiance !', 'text-emerald-700'],
  }[status] || ['info', '', 'text-slate-500'];
  return `<div class="rounded-2xl bg-gradient-to-r from-red-50/70 via-white to-brand-sky p-3 sm:p-5">
    <div class="relative">
      <svg viewBox="0 0 640 150" class="block h-auto w-full" role="img" aria-label="Trajet du colis de Guangzhou vers la RDC">
        <defs><linearGradient id="g-${uid}" x1="0" x2="1"><stop offset="0" stop-color="#e02010"/><stop offset=".45" stop-color="#f9c20a"/><stop offset="1" stop-color="#0a67c9"/></linearGradient></defs>
        ${tracePath([[104, 62], [130, 62], [150, 40], [190, 40]], '#f07a12', 2, '#fff')}
        ${tracePath([[112, 112], [150, 112], [170, 128], [215, 128]], '#f9c20a', 2, '#fff')}
        ${tracePath([[536, 62], [510, 62], [490, 40], [450, 40]], '#0a67c9', 2, '#fff')}
        ${tracePath([[528, 112], [490, 112], [470, 128], [425, 128]], '#5b9be6', 2, '#fff')}
        <path d="${d}" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>
        <path d="${d}" fill="none" stroke="url(#g-${uid})" stroke-width="4" stroke-linecap="round" pathLength="1" stroke-dasharray="${t} 1"/>
        ${flagChina(70, 92, 44, 'cn-' + uid)}
        ${flagDrc(570, 92, 44, 'cd-' + uid)}
        <polygon points="${starPoints(320, 43, 9)}" fill="#f9c20a"/>
        <g class="${transit ? 'plane-bob' : ''}">
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="19" fill="#fff" stroke="#e3e8ef" stroke-width="1.5"/>
          <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)}) translate(-10.5 -10.5) scale(.875)" fill="none" stroke="#003a90" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS.plane || ''}</g>
        </g>
      </svg>
      <span class="absolute left-[10.9%] top-full -translate-x-1/2 -translate-y-1 whitespace-nowrap font-display text-[10px] font-bold tracking-widest text-brand-ink sm:text-xs">GUANGZHOU</span>
      <span class="absolute left-[89.1%] top-full -translate-x-1/2 -translate-y-1 whitespace-nowrap font-display text-[10px] font-bold tracking-widest text-brand-ink sm:text-xs">RDC</span>
    </div>
    <p class="mt-7 flex items-start gap-2 text-sm font-semibold ${message[2]}">${icon(message[0], 17, 'mt-0.5')}<span>${message[1]}</span></p>
  </div>`;
}

function stepper(status) {
  const current = Math.max(0, STATUS_ORDER.indexOf(status));
  return `<ol class="grid grid-cols-4 gap-2" aria-label="Étapes de l’expédition">
    ${STATUS_ORDER.map((key, i) => {
      const done = i <= current;
      return `<li class="relative flex flex-col items-center text-center">
        ${i > 0 ? `<span class="absolute right-1/2 top-4 h-[3px] w-full -translate-y-1/2 ${i <= current ? 'bg-brand-blue' : 'bg-slate-200'}"></span>` : ''}
        <span class="relative grid h-8 w-8 place-items-center rounded-full border-2 ${done ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-200 bg-white text-slate-400'} ${i === current ? 'ring-4 ring-brand-yellow/40' : ''}">${icon(done ? 'check' : STATUSES[key].icon, 15)}</span>
        <span class="mt-2 text-[11px] font-semibold leading-tight ${done ? 'text-brand-night' : 'text-slate-400'} sm:text-xs">${STATUSES[key].step}</span>
      </li>`;
    }).join('')}
  </ol>`;
}

/* ---------- En-tête et pied de page ---------- */
const NAV = [['', 'Accueil'], ['services', 'Services'], ['tarifs', 'Tarifs'], ['suivi', 'Suivi colis'], ['faq', 'FAQ']];

function brandLogo(light = false) {
  return `<a href="#/" class="flex items-center gap-2.5 sm:gap-3" aria-label="Directline RDC, accueil">
    <img src="assets/img/directline-mark.webp" alt="" width="616" height="324" class="h-9 w-auto sm:h-11 ${light ? 'rounded-lg bg-white p-1' : ''}">
    <span class="flex flex-col">
      <span class="wordmark text-[22px] sm:text-[27px]"><span class="${light ? 'text-white' : 'text-brand-navy'}">Direct</span><span class="${light ? 'text-white/70' : 'text-brand-ink'}">line</span></span>
      <span class="mt-1 hidden items-center gap-1.5 font-display text-[8.5px] font-semibold tracking-[0.18em] ${light ? 'text-white/60' : 'text-brand-ink'} sm:flex"><span class="h-px w-3 bg-brand-red"></span>CHINA TO DRC • DIRECT TO YOU<span class="h-px w-3 bg-brand-blue"></span></span>
    </span>
  </a>`;
}

function header(r) {
  const user = currentUser();
  const active = (key) => (r.name === (key || 'accueil') ? 'aria-current="page"' : '');
  const account = user
    ? `<a href="#/espace" class="btn btn-outline btn-sm hidden sm:inline-flex">${icon('layout-dashboard', 16)} Mon espace</a>
       <button type="button" data-action="logout" class="btn btn-ghost btn-sm hidden sm:inline-flex">Déconnexion</button>
       <a href="#/espace" class="icon-btn border border-slate-200 sm:hidden" aria-label="Mon espace">${icon('user', 19)}</a>`
    : isAdmin
      ? `<a href="#/admin" class="btn btn-primary btn-sm">${icon('shield', 16)}<span class="hidden sm:inline">Administration</span></a>
         <button type="button" data-action="admin-logout" class="icon-btn hidden sm:inline-grid" aria-label="Fermer la session administrateur" title="Se déconnecter">${icon('log-out', 18)}</button>`
      : `<button type="button" data-action="open-login" class="btn btn-ghost btn-sm hidden sm:inline-flex">Connexion</button>
         <button type="button" data-action="open-register" class="btn btn-primary btn-sm"><span class="sm:hidden">S’inscrire</span><span class="hidden sm:inline">Créer un compte</span></button>`;
  const mobileAccount = user
    ? `<a href="#/espace" class="rounded-xl px-3 py-3 font-semibold hover:bg-slate-50">Mon espace client</a>
       <a href="#/adresse" class="rounded-xl px-3 py-3 font-semibold hover:bg-slate-50">Mon adresse en Chine</a>
       <button type="button" data-action="logout" class="rounded-xl px-3 py-3 text-left font-semibold text-brand-red hover:bg-red-50">Déconnexion</button>`
    : isAdmin
      ? `<button type="button" data-action="admin-logout" class="rounded-xl px-3 py-3 text-left font-semibold text-brand-red hover:bg-red-50">Fermer la session administrateur</button>`
      : `<button type="button" data-action="open-login" class="rounded-xl px-3 py-3 text-left font-semibold hover:bg-slate-50">Connexion</button>`;
  return `<header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
    <div class="brand-bar h-1"></div>
    <div class="container-page flex h-[68px] items-center justify-between gap-3 sm:h-[78px]">
      ${brandLogo()}
      <nav class="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
        ${NAV.map(([key, label]) => `<a href="#/${key}" class="navlink" ${active(key)}>${label}</a>`).join('')}
      </nav>
      <div class="flex items-center gap-2">
        ${account}
        <button type="button" data-action="toggle-menu" class="icon-btn border border-slate-200 lg:hidden" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="mobile-menu">${icon('menu', 20)}</button>
      </div>
    </div>
    <div id="mobile-menu" class="hidden border-t border-slate-200 bg-white lg:hidden">
      <nav class="container-page grid gap-1 py-3 text-[15px] text-brand-night" aria-label="Navigation mobile">
        ${NAV.map(([key, label]) => `<a href="#/${key}" class="rounded-xl px-3 py-3 font-semibold hover:bg-slate-50 ${r.name === (key || 'accueil') ? 'bg-brand-sky text-brand-navy' : ''}">${label}</a>`).join('')}
        <a href="#/achat" class="rounded-xl px-3 py-3 font-semibold hover:bg-slate-50">Demande d’achat</a>
        <div class="my-1 h-px bg-slate-100"></div>
        ${mobileAccount}
      </nav>
    </div>
  </header>`;
}

function footer() {
  const s = Data.settings();
  const user = currentUser();
  return `<footer class="relative mt-24 overflow-hidden bg-brand-night text-white">
    <div class="brand-bar h-1"></div>
    ${circuitBackdrop(true)}
    <div class="container-page relative grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div>
        <div class="inline-block rounded-2xl bg-white p-3"><img src="assets/img/directline-logo.webp" alt="Directline — China to DRC, direct to you" width="970" height="545" class="h-20 w-auto"></div>
        <p class="mt-4 max-w-xs text-sm leading-6 text-white/70">Votre partenaire de confiance pour vos importations entre la Chine et la République démocratique du Congo.</p>
      </div>
      <div>
        <div class="font-display font-bold">Navigation</div>
        <ul class="mt-4 space-y-2.5 text-sm text-white/70">
          ${NAV.map(([key, label]) => `<li><a class="hover:text-white" href="#/${key}">${label}</a></li>`).join('')}
          <li><a class="hover:text-white" href="#/achat">Demande d’achat</a></li>
        </ul>
      </div>
      <div>
        <div class="font-display font-bold">Nous contacter</div>
        <ul class="mt-4 space-y-2.5 text-sm text-white/70">
          <li><a class="inline-flex items-center gap-2 hover:text-white" href="${waLink()}" target="_blank" rel="noopener">${icon('message-circle', 16, 'text-[#25d366]')} WhatsApp · ${esc(s.contactPhone)}</a></li>
          ${s.contactEmail ? `<li><a class="inline-flex items-center gap-2 hover:text-white" href="mailto:${esc(s.contactEmail)}">${icon('mail', 16, 'text-brand-yellow')} ${esc(s.contactEmail)}</a></li>` : ''}
          ${lines(s.pickupPoints).length ? `<li class="flex items-start gap-2">${icon('map-pin', 16, 'mt-0.5 text-brand-red')}<span>Retrait : ${esc(lines(s.pickupPoints).join(' · '))}</span></li>` : ''}
        </ul>
      </div>
      <div>
        <div class="font-display font-bold">Votre espace</div>
        <ul class="mt-4 space-y-2.5 text-sm text-white/70">
          <li><a class="hover:text-white" href="#/suivi">Suivre un colis</a></li>
          <li>${user ? '<a class="hover:text-white" href="#/espace">Mon espace client</a>' : '<button type="button" data-action="open-register" class="hover:text-white">Créer un compte</button>'}</li>
          <li>${user ? '<a class="hover:text-white" href="#/adresse">Mon adresse en Chine</a>' : '<button type="button" data-action="open-login" class="hover:text-white">Connexion</button>'}</li>
        </ul>
      </div>
    </div>
    <div class="relative border-t border-white/10">
      <div class="container-page flex flex-col items-center justify-between gap-3 py-5 text-xs text-white/50 sm:flex-row">
        <span>© ${new Date().getFullYear()} Directline RDC · Fret aérien Chine → RDC</span>
        <span class="eyebrow eyebrow-light !text-[10px]">China to DRC • Direct to you</span>
        <a href="#/admin" class="hover:text-white/80">Espace gestionnaire</a>
      </div>
    </div>
  </footer>`;
}

function whatsappButton() {
  return `<a href="${waLink('Bonjour Directline RDC, j’ai une question.')}" target="_blank" rel="noopener" class="btn btn-whatsapp fixed bottom-4 right-4 z-30 !rounded-full !px-4 sm:bottom-6 sm:right-6" aria-label="Écrire à Directline sur WhatsApp">${icon('message-circle', 20)}<span class="hidden sm:inline">WhatsApp</span></a>`;
}

/* ================================================================
   Pages publiques
   ================================================================ */
function simulator(initial = 5) {
  const s = Data.settings();
  return `<div class="card p-6 sm:p-8" data-sim>
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-lg font-bold">Simulateur de tarif</h3>
      <span class="chip bg-brand-sky text-brand-blue">${icon('plane', 14)} ${num(s.ratePerKg)}\u00a0$/kg</span>
    </div>
    <label class="label mt-6" for="sim-weight">Poids estimé du colis (kg)</label>
    <div class="flex items-center gap-2">
      <button type="button" data-action="sim-step" data-step="-0.5" class="icon-btn !h-12 !w-12 border border-slate-300 text-lg" aria-label="Diminuer le poids">${icon('minus', 18)}</button>
      <input id="sim-weight" data-live="sim" type="number" inputmode="decimal" min="0" step="0.1" value="${initial}" class="input text-center font-display text-xl font-extrabold">
      <button type="button" data-action="sim-step" data-step="0.5" class="icon-btn !h-12 !w-12 border border-slate-300 text-lg" aria-label="Augmenter le poids">${icon('plus', 18)}</button>
    </div>
    <input type="range" data-live="sim-range" min="0.5" max="60" step="0.5" value="${initial}" class="mt-5 w-full accent-[#0a67c9]" aria-label="Poids en kilos">
    <div data-sim-result class="mt-6">${simulatorResult(initial)}</div>
  </div>`;
}
function simulatorResult(weight) {
  const s = Data.settings();
  const w = Math.max(0, Number(weight) || 0);
  const transport = w * s.ratePerKg;
  const points = Math.round(w * (Number(s.loyaltyPointsPerKg) || 0));
  return `<div class="relative overflow-hidden rounded-2xl bg-brand-night p-5 text-white">
    <div class="brand-bar absolute inset-x-0 top-0 h-1"></div>
    <div class="flex justify-between text-sm text-white/70"><span>Transport · ${num(w)} kg × ${num(s.ratePerKg)}\u00a0$</span><span>${usd(transport)}</span></div>
    <div class="mt-3 flex items-end justify-between gap-3 border-t border-white/10 pt-3">
      <span class="text-sm font-semibold">Estimation du transport</span>
      <span class="whitespace-nowrap font-display text-2xl font-extrabold italic text-brand-yellow sm:text-3xl">${usd(transport)}</span>
    </div>
    <p class="mt-3 text-xs leading-5 text-white/60">Hors frais de douane éventuels (selon la marchandise) et regroupement sur demande. Montant final calculé sur le poids pesé à Guangzhou.${points ? ` Cet envoi vous rapporterait ${plural(points, 'point')} fidélité.` : ''}${s.transitTime ? ` Délai moyen : ${esc(s.transitTime)}.` : ''}</p>
  </div>`;
}
function updateSimulator(root, value) {
  const v = Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
  const input = $('[data-live=sim]', root);
  const range = $('[data-live=sim-range]', root);
  if (input && document.activeElement !== input) input.value = v;
  if (range) range.value = Math.min(60, v);
  $('[data-sim-result]', root).innerHTML = simulatorResult(v);
}

function faqItems() {
  const s = Data.settings();
  const points = lines(s.pickupPoints);
  return [
    ['Comment obtenir mon adresse en Chine ?', 'Créez votre compte gratuitement : vous recevez aussitôt une référence client (par ex. CL-123456) et l’adresse de notre entrepôt de Guangzhou, en français et en chinois. Donnez cette adresse à vos fournisseurs en ajoutant toujours votre référence.'],
    ['Comment est calculé le prix ?', `Le transport est facturé au poids pesé à notre entrepôt : ${num(s.ratePerKg)}\u00a0$ le kilo. S’y ajoutent, le cas échéant, les frais de douane selon la nature des marchandises et les frais de regroupement si vous les demandez. Le montant estimé est visible dans votre espace client.`],
    ['Quel est le délai de livraison ?', s.transitTime
      ? `Comptez en moyenne ${esc(s.transitTime)} entre le départ de Guangzhou et l’arrivée en RDC. Vous êtes notifié à chaque étape.`
      : 'Le délai dépend des départs de vols : écrivez-nous sur WhatsApp pour connaître la date du prochain départ. Vous êtes notifié à chaque étape.'],
    ['Comment suivre mon colis ?', 'Chaque colis reçoit un numéro de suivi (DL-…). Saisissez-le sur la page « Suivi colis » ou retrouvez tous vos envois dans votre espace client.'],
    ['Quand et comment payer ?', 'Le paiement se fait à l’arrivée du colis en RDC, par M-Pesa, Orange Money, Airtel Money ou en espèces au point de retrait. Directline ne vous demandera jamais votre code PIN Mobile Money.'],
    ['Qu’est-ce que le regroupement de colis ?', 'Si plusieurs de vos colis attendent à Guangzhou, nous pouvons les réunir en un seul envoi. Cela peut réduire vos frais : demandez-le-nous sur WhatsApp.'],
    ['Quels produits ne peuvent pas être expédiés ?', 'En fret aérien, certains produits sont interdits ou soumis à conditions : batteries lithium seules, produits inflammables (gaz, aérosols, certains parfums), armes et munitions, contrefaçons, drogues et produits illicites. En cas de doute, demandez-nous avant d’acheter.'],
    ['Où récupérer mon colis ?', `${points.length ? `À nos points de retrait : ${esc(points.join(', '))}.` : 'À notre point de retrait en RDC.'} Vous êtes prévenu dès que votre colis est arrivé.`],
    ['Comment fonctionne la fidélité ?', `Chaque kilo livré vous rapporte ${plural(s.loyaltyPointsPerKg, 'point')}. Tous les ${num(s.loyaltyThreshold)} points, vous gagnez ${num(s.loyaltyRewardKg)} kg de transport offerts.`],
  ];
}
const faqList = (items) => `<div class="card divide-y divide-slate-100 px-5 sm:px-7">
  ${items.map(([q, a]) => `<details class="faq"><summary>${q}<span class="faq-icon grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-sky text-brand-blue">${icon('plus', 16)}</span></summary><p class="pb-5 pr-10 text-sm leading-6 text-slate-600">${a}</p></details>`).join('')}
</div>`;

function addressCard(user, { compact = false } = {}) {
  return `<div class="grid gap-4 ${compact ? '' : 'md:grid-cols-2'}">
    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div class="flex items-center justify-between gap-3"><span class="label !mb-0">En français</span>
        <button type="button" data-action="copy-address" data-lang="fr" class="btn btn-outline btn-sm">${icon('copy', 15)} Copier</button></div>
      <p class="mt-3 text-sm leading-7 text-brand-night">${multiline(addressText(user, 'fr'))}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div class="flex items-center justify-between gap-3"><span class="label !mb-0">En chinois · 中文</span>
        <button type="button" data-action="copy-address" data-lang="zh" class="btn btn-outline btn-sm">${icon('copy', 15)} 复制</button></div>
      <p class="mt-3 text-sm leading-7 text-brand-night" lang="zh">${multiline(addressText(user, 'zh'))}</p>
    </div>
  </div>`;
}

function homePage() {
  const s = Data.settings();
  const user = currentUser();
  const features = [
    ['badge-dollar-sign', 'Tarif transparent', `${num(s.ratePerKg)}\u00a0$ le kilo, sans surprise`],
    ['camera', 'Photo à réception', 'Chaque colis pesé et photographié'],
    ['map-pin', 'Retrait en RDC', lines(s.pickupPoints).join(' & ') || 'Kinshasa & Lubumbashi'],
  ];
  const steps = [
    ['bg-brand-red', 'shopping-bag', 'Achetez en Chine', 'Commandez chez vos fournisseurs (Taobao, 1688, Alibaba…) avec votre adresse Directline à Guangzhou.'],
    ['bg-brand-yellow text-brand-night', 'package-check', 'Nous réceptionnons', 'Chaque colis est pesé, photographié et ajouté à votre espace client. Vous êtes notifié.'],
    ['bg-brand-blue', 'plane', 'Recevez en RDC', 'Suivez le vol en temps réel, puis payez à l’arrivée par Mobile Money ou en espèces.'],
  ];
  return `
  <section class="relative overflow-hidden bg-gradient-to-b from-white via-white to-brand-sky/70">
    ${circuitBackdrop()}
    <div class="container-page relative grid items-center gap-12 pb-24 pt-12 sm:pt-16 lg:grid-cols-[1.12fr_.88fr] lg:pb-32 lg:pt-20">
      <div>
        ${eyebrow('Fret aérien · Guangzhou → RDC')}
        <h1 class="display mt-5 text-[42px] leading-[1.04] sm:text-6xl lg:text-[68px]">De la Chine à la RDC, <span class="brand-text pr-2">directement</span> chez vous.</h1>
        <p class="mt-6 max-w-xl text-lg leading-8 text-slate-600">Une adresse personnelle à Guangzhou, un suivi à chaque étape et un tarif clair au kilo. Vous achetez en Chine, on s’occupe du reste.</p>
        <div class="mt-8 flex flex-wrap gap-3">
          ${user
            ? `<a href="#/adresse" class="btn btn-primary">${icon('map-pin', 18)} Mon adresse en Chine</a>`
            : `<button type="button" data-action="open-register" class="btn btn-primary">Obtenir mon adresse en Chine ${icon('arrow-right', 18)}</button>`}
          <a href="#/tarifs" class="btn btn-outline">${icon('calculator', 18)} Calculer mon tarif</a>
        </div>
        <dl class="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-slate-200 pt-6">
          <div><dt class="sr-only">Tarif</dt><dd class="font-display text-xl font-extrabold italic text-brand-navy sm:text-3xl">${num(s.ratePerKg)}\u00a0$</dd><dd class="text-xs text-slate-500">le kilo en fret aérien</dd></div>
          <div><dt class="sr-only">Suivi</dt><dd class="font-display text-xl font-extrabold italic text-brand-navy sm:text-3xl">4 étapes</dd><dd class="text-xs text-slate-500">suivies en ligne</dd></div>
          <div><dt class="sr-only">Paiement</dt><dd class="font-display text-xl font-extrabold italic text-brand-navy sm:text-3xl">À l’arrivée</dd><dd class="text-xs text-slate-500">Mobile Money ou espèces</dd></div>
        </dl>
      </div>
      <div class="relative mx-auto w-full max-w-md lg:max-w-none">
        <div class="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-brand-red/10 via-brand-yellow/15 to-brand-blue/20 blur-2xl"></div>
        <div class="card overflow-hidden">
          <div class="border-b border-slate-100 px-6 pb-4 pt-6"><img src="assets/img/directline-mark.webp" alt="Emblème Directline : une ligne directe de la Chine à la RDC" width="616" height="324" class="mx-auto h-28 w-auto sm:h-36"></div>
          <form data-form="track" class="p-6">
            <div class="flex items-center justify-between gap-3">
              <div><div class="label !mb-0">Suivi rapide</div><h2 class="mt-1 text-xl font-bold">Où est votre colis ?</h2></div>
              <span class="icon-tile">${icon('package-search', 22)}</span>
            </div>
            <label class="sr-only" for="hero-tracking">Numéro de suivi</label>
            <div class="mt-4 flex gap-2">
              <input id="hero-tracking" name="tracking" class="input" placeholder="DL-${new Date().getFullYear()}-000000" autocomplete="off" required>
              <button class="btn btn-blue !px-4" aria-label="Rechercher le colis">${icon('arrow-right', 20)}</button>
            </div>
            <p class="mt-3 flex items-center gap-2 text-xs text-slate-500"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Statut mis à jour à chaque étape du trajet</p>
          </form>
        </div>
      </div>
    </div>
  </section>

  <section class="container-page relative z-10 -mt-12">
    <div class="card grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      ${features.map(([ic, t, sub]) => `<div class="flex items-center gap-4 p-5 sm:p-6"><span class="icon-tile">${icon(ic, 20)}</span><div><div class="font-display font-bold text-brand-night">${t}</div><div class="mt-0.5 text-sm text-slate-500">${esc(sub)}</div></div></div>`).join('')}
    </div>
  </section>

  <section class="container-page py-20 sm:py-24">
    ${sectionHead('Simple, du départ à l’arrivée', 'Votre fret en 3 étapes', 'Nous rendons l’importation plus simple et prévisible.')}
    <ol class="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-6">
      <span class="brand-bar absolute left-[16.6%] right-[16.6%] top-7 hidden h-[3px] rounded-full md:block" aria-hidden="true"></span>
      ${steps.map(([color, ic, title, text], i) => `<li class="relative flex flex-col items-center text-center">
        <span class="relative z-10 grid h-14 w-14 place-items-center rounded-full border-4 border-white ${color} font-display text-xl font-extrabold italic text-white shadow-lg">${i + 1}</span>
        <div class="card mt-5 w-full p-6"><span class="icon-tile mx-auto">${icon(ic, 22)}</span><h3 class="mt-4 text-lg font-bold">${title}</h3><p class="mt-2 text-sm leading-6 text-slate-600">${text}</p></div>
      </li>`).join('')}
    </ol>
  </section>

  <section class="bg-brand-sky/70 py-20 sm:py-24">
    <div class="container-page grid items-center gap-12 lg:grid-cols-2">
      <div>
        ${sectionHead('Tarif transparent', 'Combien va coûter mon envoi ?', 'Estimez votre transport en quelques secondes. Le montant final est calculé sur le poids pesé à notre entrepôt, et vous le retrouvez dans votre espace client avant de payer.', false)}
        <ul class="mt-8 space-y-3 text-sm text-brand-night">
          ${['Pesée et photo de chaque colis à Guangzhou', 'Transport aérien jusqu’en RDC', 'Suivi en ligne et notifications à chaque étape', 'Paiement à l’arrivée, sans PIN demandé'].map((t) => `<li class="flex items-center gap-3"><span class="grid h-6 w-6 place-items-center rounded-full bg-brand-blue text-white">${icon('check', 14)}</span>${t}</li>`).join('')}
        </ul>
      </div>
      ${simulator()}
    </div>
  </section>

  <section class="container-page py-20 sm:py-24">
    ${sectionHead('Nos services', 'Deux façons d’expédier avec nous')}
    <div class="mt-12 grid gap-6 md:grid-cols-2">
      ${serviceCard('shopping-cart', 'Vous achetez directement', 'Commandez chez vos fournisseurs chinois et donnez-leur notre adresse d’entrepôt avec votre référence client.', 'Vous gardez le contrôle de vos achats.', user ? '<a href="#/adresse" class="btn btn-outline btn-sm">Voir mon adresse</a>' : '<button type="button" data-action="open-register" class="btn btn-outline btn-sm">Créer mon compte</button>')}
      ${serviceCard('handshake', 'Directline achète pour vous', 'Envoyez-nous les liens des articles souhaités : nous vous faisons un devis, passons la commande et gérons l’expédition.', 'Un accompagnement de la commande à la livraison.', `<a href="#/achat" class="btn btn-primary btn-sm">Faire une demande d’achat ${icon('arrow-right', 15)}</a>`)}
    </div>
  </section>

  <section class="relative overflow-hidden bg-brand-night py-20 text-white sm:py-24">
    ${circuitBackdrop(true)}
    <div class="container-page relative grid items-center gap-10 lg:grid-cols-2">
      <div>
        ${eyebrow('Prêt à commencer ?', 'eyebrow-light')}
        <h2 class="display mt-4 text-3xl text-white sm:text-4xl">Votre adresse d’expédition personnelle à Guangzhou.</h2>
        <p class="mt-4 max-w-lg leading-7 text-white/75">Recevez votre référence client unique et partagez l’adresse avec vos fournisseurs, en français ou en chinois. Chaque colis reçu apparaît dans votre espace.</p>
        ${user
          ? `<a href="#/adresse" class="btn btn-accent mt-8">${icon('map-pin', 18)} Voir mon adresse</a>`
          : `<button type="button" data-action="open-register" class="btn btn-accent mt-8">Créer mon compte gratuit ${icon('arrow-right', 18)}</button>`}
      </div>
      <div class="card p-5 text-brand-ink sm:p-6">
        <div class="mb-4 flex items-center justify-between"><span class="font-display font-bold text-brand-night">Entrepôt Directline · Guangzhou</span><span class="chip bg-red-50 text-brand-red">🇨🇳 Guangdong</span></div>
        ${addressCard(user, { compact: true })}
        <p class="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">${icon('info', 15, 'mt-0.5')}Ajoutez toujours votre référence client sur chaque commande.</p>
      </div>
    </div>
  </section>

  <section class="container-page py-20 sm:py-24">
    <div class="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
      <div>
        ${sectionHead('Questions fréquentes', 'Vous vous posez une question ?', 'Les réponses aux questions que nos clients nous posent le plus souvent.', false)}
        <div class="mt-8 flex flex-wrap gap-3"><a href="#/faq" class="btn btn-outline">Toutes les questions</a><a href="${waLink('Bonjour Directline RDC, j’ai une question.')}" target="_blank" rel="noopener" class="btn btn-whatsapp">${icon('message-circle', 18)} Écrire sur WhatsApp</a></div>
      </div>
      ${faqList(faqItems().slice(0, 5))}
    </div>
  </section>`;
}
function serviceCard(ic, title, text, check, cta) {
  return `<div class="card flex flex-col p-7">
    <span class="icon-tile !h-12 !w-12">${icon(ic, 22)}</span>
    <h3 class="mt-5 text-xl font-bold">${title}</h3>
    <p class="mt-2 flex-1 text-sm leading-6 text-slate-600">${text}</p>
    <div class="mt-5 flex items-center gap-2 text-sm font-semibold text-emerald-700">${icon('check', 17)}${check}</div>
    <div class="mt-6">${cta}</div>
  </div>`;
}

function servicesPage() {
  const user = currentUser();
  return `<section class="container-page py-12 sm:py-16">
    ${pageHead('Comment ça marche', 'Deux façons d’expédier avec nous.', 'Achetez vous-même en Chine ou confiez-nous vos achats : nous prenons en charge la réception à Guangzhou et le transport jusqu’en RDC.')}
    <div class="mt-10 grid gap-6 md:grid-cols-2">
      ${serviceCard('shopping-cart', 'Vous achetez directement', 'Commandez chez vos fournisseurs chinois puis renseignez notre adresse d’entrepôt avec votre référence client. Nous vous prévenons à la réception.', 'Vous gardez le contrôle de vos achats.', user ? '<a href="#/adresse" class="btn btn-outline btn-sm">Voir mon adresse</a>' : '<button type="button" data-action="open-register" class="btn btn-outline btn-sm">Créer mon compte</button>')}
      ${serviceCard('handshake', 'Directline achète pour vous', 'Envoyez-nous les liens des articles souhaités. Notre équipe vérifie le fournisseur, vous fait un devis et gère l’achat jusqu’à l’expédition.', 'Un accompagnement de la commande à la livraison.', `<a href="#/achat" class="btn btn-primary btn-sm">Faire une demande d’achat ${icon('arrow-right', 15)}</a>`)}
    </div>
    <div class="mt-16 grid gap-6 lg:grid-cols-3">
      ${[
        ['camera', 'Réception documentée', 'Chaque colis est pesé et photographié dès son arrivée à Guangzhou. La photo apparaît dans votre espace.'],
        ['boxes', 'Regroupement de colis', 'Plusieurs colis en attente ? Nous pouvons les réunir en un seul envoi pour réduire vos frais.'],
        ['bell', 'Notifications à chaque étape', 'Reçu en Chine, en vol, arrivé en RDC, livré : vous savez toujours où en est votre envoi.'],
      ].map(([ic, t, d]) => `<div class="card p-6"><span class="icon-tile">${icon(ic, 20)}</span><h3 class="mt-4 font-bold">${t}</h3><p class="mt-2 text-sm leading-6 text-slate-600">${d}</p></div>`).join('')}
    </div>
    <div class="mt-16">
      ${sectionHead('Adresse d’expédition', 'Notre entrepôt à Guangzhou', user ? 'Voici votre adresse personnelle : copiez-la dans l’application de votre fournisseur.' : 'Créez votre compte pour obtenir votre référence client, à ajouter à cette adresse.', false)}
      <div class="card mt-6 p-5 sm:p-6">${addressCard(user)}</div>
    </div>
  </section>`;
}

function tarifsPage() {
  const s = Data.settings();
  return `<section class="container-page py-12 sm:py-16">
    ${pageHead('Tarifs', 'Un prix clair, calculé au kilo.', `Le transport Guangzhou → RDC est facturé ${num(s.ratePerKg)}\u00a0$ le kilo, sur le poids pesé à notre entrepôt.`)}
    <div class="mt-10 grid items-start gap-8 lg:grid-cols-[1fr_1fr]">
      ${simulator()}
      <div class="space-y-4">
        ${[
          ['plane', 'Transport aérien', `${num(s.ratePerKg)}\u00a0$ / kg`, 'Poids pesé à la réception à Guangzhou.'],
          ['boxes', 'Regroupement', 'Sur demande', 'Frais indiqués sur votre colis si vous demandez le regroupement.'],
          ['landmark', 'Douane', 'Selon la marchandise', 'Montant indiqué dans votre espace client avant le paiement.'],
          ['wallet', 'Paiement', 'À l’arrivée', 'M-Pesa, Orange Money, Airtel Money ou espèces au point de retrait.'],
        ].map(([ic, t, v, d]) => `<div class="card flex items-start gap-4 p-5"><span class="icon-tile">${icon(ic, 20)}</span><div class="flex-1"><div class="flex flex-wrap items-baseline justify-between gap-2"><h3 class="font-bold">${t}</h3><span class="font-display font-extrabold text-brand-navy">${v}</span></div><p class="mt-1 text-sm text-slate-600">${d}</p></div></div>`).join('')}
        <div class="card border-l-4 border-l-brand-yellow p-5">
          <div class="flex items-center gap-3"><span class="icon-tile !bg-amber-50 !text-amber-600">${icon('gift', 20)}</span><h3 class="font-bold">Fidélité Directline</h3></div>
          <p class="mt-3 text-sm text-slate-600">${plural(s.loyaltyPointsPerKg, 'point')} par kilo livré · ${num(s.loyaltyThreshold)} points = ${num(s.loyaltyRewardKg)} kg de transport offerts.</p>
        </div>
        <p class="text-sm text-slate-500">Un doute sur un produit ? Consultez la <a class="font-semibold text-brand-blue underline" href="#/faq">liste des produits interdits</a>.</p>
      </div>
    </div>
  </section>`;
}

function faqPage() {
  return `<section class="container-page py-12 sm:py-16">
    ${pageHead('FAQ', 'Questions fréquentes', 'Tout ce qu’il faut savoir avant d’expédier avec Directline.')}
    <div class="mt-10 grid gap-8 lg:grid-cols-[1.4fr_.6fr]">
      ${faqList(faqItems())}
      <aside class="card h-fit p-6">
        <span class="icon-tile !bg-green-50 !text-[#1faa53]">${icon('message-circle', 20)}</span>
        <h2 class="mt-4 text-lg font-bold">Vous ne trouvez pas la réponse ?</h2>
        <p class="mt-2 text-sm text-slate-600">Notre équipe vous répond sur WhatsApp.</p>
        <a href="${waLink('Bonjour Directline RDC, j’ai une question.')}" target="_blank" rel="noopener" class="btn btn-whatsapp mt-5 w-full">${icon('message-circle', 18)} Écrire sur WhatsApp</a>
      </aside>
    </div>
  </section>`;
}

function purchasePage() {
  const user = currentUser();
  return `<section class="container-page max-w-3xl py-12 sm:py-16">
    ${pageHead('Directline achète pour vous', 'Envoyez vos liens, on s’occupe de l’achat.', 'Collez les liens des articles (Taobao, 1688, Alibaba, Pinduoduo…). Votre demande est envoyée à notre équipe sur WhatsApp, qui vous répond avec un devis.')}
    <form data-form="purchase" class="card mt-10 space-y-5 p-6 sm:p-8">
      <div>
        <label class="label" for="p-links">Liens des articles</label>
        <textarea id="p-links" name="links" rows="4" class="input" placeholder="Un lien par ligne" required></textarea>
      </div>
      <div>
        <label class="label" for="p-details">Quantités, tailles, couleurs…</label>
        <textarea id="p-details" name="details" rows="3" class="input" placeholder="Ex. 2 pièces taille M, couleur noire"></textarea>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label class="label" for="p-name">Votre nom</label><input id="p-name" name="name" class="input" value="${esc(user ? `${user.firstname} ${user.name}` : '')}" required></div>
        <div><label class="label" for="p-phone">Téléphone</label><input id="p-phone" name="phone" type="tel" class="input" placeholder="+243…" value="${esc(user?.phone || '')}" required></div>
      </div>
      <div><label class="label" for="p-budget">Budget approximatif (facultatif)</label><input id="p-budget" name="budget" class="input" placeholder="Ex. 150 $"></div>
      <button class="btn btn-whatsapp w-full">${icon('message-circle', 18)} Envoyer ma demande sur WhatsApp</button>
      <p class="text-center text-xs text-slate-500">Astuce : ajoutez ensuite des captures d’écran des articles dans la conversation WhatsApp.</p>
    </form>
  </section>`;
}
function submitPurchase(f) {
  const d = Object.fromEntries(new FormData(f));
  const user = currentUser();
  const links = lines(d.links);
  const text = [
    'Bonjour Directline RDC 👋',
    'Je souhaite une demande d’achat :',
    '',
    ...links.map((l, i) => `${i + 1}. ${l}`),
    d.details ? `\nPrécisions : ${d.details.trim()}` : '',
    d.budget ? `Budget : ${d.budget.trim()}` : '',
    '',
    `Nom : ${d.name.trim()}`,
    `Téléphone : ${d.phone.trim()}`,
    user ? `Référence client : ${user.id}` : '',
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
  window.open(waLink(text), '_blank', 'noopener');
  toast('Votre demande s’ouvre dans WhatsApp.');
}

function trackingPage(param) {
  const ref = String(param || '').trim();
  const parcel = ref ? Data.parcels().find((p) => p.tracking.toLowerCase() === ref.toLowerCase()) : null;
  let result = '';
  if (ref && parcel) result = trackCard(parcel);
  else if (ref) {
    result = `<div class="card p-8 text-center">
      <span class="icon-tile mx-auto !bg-red-50 !text-brand-red">${icon('package-search', 22)}</span>
      <h2 class="mt-4 text-xl font-bold">Aucun colis trouvé pour « ${esc(ref)} »</h2>
      <p class="mt-2 text-sm text-slate-600">Vérifiez le numéro (format DL-${new Date().getFullYear()}-000000). Si votre colis vient d’être expédié par le fournisseur, il apparaîtra dès sa réception à Guangzhou.</p>
      <a href="${waLink(`Bonjour, je ne trouve pas mon colis ${ref}.`)}" target="_blank" rel="noopener" class="btn btn-whatsapp mt-6">${icon('message-circle', 18)} Nous contacter</a>
    </div>`;
  }
  return `<section class="container-page py-12 sm:py-16">
    <div class="mx-auto max-w-3xl text-center">
      ${eyebrow('Suivi colis', 'justify-center')}
      <h1 class="display mt-4 text-4xl sm:text-5xl">Suivez votre expédition.</h1>
      <p class="mt-4 text-slate-600">Saisissez votre numéro de suivi pour voir où se trouve votre colis.</p>
      <form data-form="track" class="mx-auto mt-8 flex max-w-xl gap-2">
        <label class="sr-only" for="tracking-input">Numéro de suivi</label>
        <input id="tracking-input" name="tracking" class="input" placeholder="DL-${new Date().getFullYear()}-000000" value="${esc(ref)}" autocomplete="off" required>
        <button class="btn btn-blue">${icon('search', 18)}<span class="hidden sm:inline">Rechercher</span></button>
      </form>
    </div>
    <div class="mx-auto mt-10 max-w-3xl">${result}</div>
  </section>`;
}

function trackCard(p) {
  const user = currentUser();
  const owner = isAdmin || (user && user.id === p.clientId);
  const history = (p.statusHistory || []).slice().reverse();
  const canPay = owner && !isAdmin && p.status === 'ARRIVED_RDC' && paymentStatus(p) === 'UNPAID';
  return `<article class="card overflow-hidden">
    <div class="flex flex-wrap items-start justify-between gap-4 p-6 sm:p-8">
      <div><div class="label !mb-1">Référence colis</div><div class="font-display text-2xl font-extrabold text-brand-night">${esc(p.tracking)}</div><div class="mt-1 text-sm text-slate-500">${esc(p.description)}</div></div>
      ${statusBadge(p.status)}
    </div>
    <div class="px-4 sm:px-8">${routeMap(p.status)}</div>
    <div class="px-4 pt-8 sm:px-8">${stepper(p.status)}</div>
    <div class="grid gap-8 p-6 sm:p-8 md:grid-cols-[1.15fr_.85fr]">
      <div>
        <h3 class="font-bold">Historique de l’expédition</h3>
        <ol class="mt-4 space-y-5 border-l-2 border-slate-100 pl-6">
          ${history.map((h, i) => `<li class="relative">
            <span class="absolute -left-[33px] top-0.5 grid h-4 w-4 place-items-center rounded-full ${i === 0 ? 'bg-brand-blue ring-4 ring-brand-sky' : 'bg-slate-300'}"></span>
            <div class="text-sm font-bold text-brand-night">${STATUSES[h.status]?.label || esc(h.status)}</div>
            <div class="mt-0.5 text-xs text-slate-500">${formatDate(h.date)}${h.comment ? ` · ${esc(h.comment)}` : ''}</div>
          </li>`).join('') || '<li class="text-sm text-slate-500">Aucun événement pour le moment.</li>'}
        </ol>
      </div>
      <div class="space-y-3 rounded-2xl bg-slate-50 p-5 text-sm">
        <div class="flex justify-between"><span class="text-slate-500">Poids</span><b>${num(p.weight)} kg</b></div>
        ${owner
          ? `<div class="flex justify-between"><span class="text-slate-500">Tarif appliqué</span><b>${num(parcelRate(p))} $/kg</b></div>
             <div class="flex justify-between border-t border-slate-200 pt-3"><span class="text-slate-500">Montant estimé</span><b class="font-display text-lg text-brand-navy">${usd(price(p))}</b></div>
             <div class="flex items-center justify-between"><span class="text-slate-500">Paiement</span>${paymentBadge(p)}</div>`
          : `<p class="border-t border-slate-200 pt-3 text-xs text-slate-500">${icon('lock', 13, 'mr-1 inline-block align-[-2px]')}Connectez-vous à votre espace pour voir le montant et payer.</p>`}
        ${p.photoUrl ? `<figure class="pt-2"><img src="${esc(p.photoUrl)}" alt="Photo du colis à la réception" class="max-h-56 w-full rounded-xl object-cover"><figcaption class="mt-1 text-xs text-slate-500">Photo prise à la réception à Guangzhou</figcaption></figure>` : ''}
      </div>
    </div>
    <div class="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
      <button type="button" data-action="share-tracking" data-id="${esc(p.tracking)}" class="btn btn-outline btn-sm">${icon('link', 15)} Copier le lien de suivi</button>
      ${owner ? `<button type="button" data-action="invoice" data-id="${esc(p.tracking)}" class="btn btn-outline btn-sm">${icon('file-text', 15)} Reçu</button>` : ''}
      ${canPay ? `<button type="button" data-action="pay" data-id="${esc(p.tracking)}" class="btn btn-blue btn-sm">${icon('wallet', 15)} Payer ma livraison</button>` : ''}
    </div>
  </article>`;
}

/* ================================================================
   Espace client
   ================================================================ */
function loginRequired(text) {
  return `<section class="container-page py-20">
    <div class="card mx-auto max-w-lg p-8 text-center">
      <span class="icon-tile mx-auto">${icon('lock', 22)}</span>
      <h1 class="display mt-4 text-3xl">Connectez-vous</h1>
      <p class="mt-2 text-slate-600">${text}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-3"><button type="button" data-action="open-login" class="btn btn-primary">Connexion</button><button type="button" data-action="open-register" class="btn btn-outline">Créer un compte</button></div>
    </div>
  </section>`;
}

function clientParcelActions(p) {
  const pay = paymentStatus(p);
  return `<a href="#/suivi/${encodeURIComponent(p.tracking)}" class="btn btn-outline btn-sm">${icon('map-pin', 15)} Suivre</a>
    <button type="button" data-action="invoice" data-id="${esc(p.tracking)}" class="btn btn-ghost btn-sm">${icon('file-text', 15)} Reçu</button>
    ${p.status === 'ARRIVED_RDC' && pay === 'UNPAID' ? `<button type="button" data-action="pay" data-id="${esc(p.tracking)}" class="btn btn-blue btn-sm">${icon('wallet', 15)} Payer</button>` : ''}`;
}

function dashboardPage() {
  const user = currentUser();
  if (!user) return loginRequired('Retrouvez vos colis, votre adresse en Chine et vos points fidélité.');
  const ps = Data.parcels().filter((p) => p.clientId === user.id);
  const unpaid = ps.filter((p) => paymentStatus(p) !== 'PAID').reduce((sum, p) => sum + price(p), 0);
  const moving = ps.filter((p) => ['RECEIVED_CHINA', 'IN_TRANSIT'].includes(p.status)).length;
  const inChina = ps.filter((p) => p.status === 'RECEIVED_CHINA').length;
  const ns = Data.notifications().filter((n) => n.clientId === user.id);
  const unread = ns.filter((n) => !n.read).length;
  const l = loyaltyOf(user);
  return `<section class="container-page py-10 sm:py-14">
    ${pageHead('Espace client', `Bonjour ${esc(user.firstname)} 👋`, 'Voici l’essentiel sur vos expéditions.', `<div class="flex flex-wrap gap-2">
      <button type="button" data-action="copy" data-copy="${esc(user.id)}" class="btn btn-outline btn-sm" title="Copier ma référence">${icon('copy', 15)} Réf. ${esc(user.id)}</button>
      <a href="#/adresse" class="btn btn-primary btn-sm">${icon('map-pin', 15)} Mon adresse en Chine</a>
      <a href="#/achat" class="btn btn-outline btn-sm">${icon('shopping-cart', 15)} Demande d’achat</a>
    </div>`)}
    <div class="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      ${statTile('package', 'Colis enregistrés', ps.length, 'Tous vos envois')}
      ${statTile('plane', 'En cours', moving, 'En Chine ou en vol')}
      ${statTile('wallet', 'Reste à payer', usd(unpaid), 'Estimation, frais inclus')}
      ${statTile('award', 'Points fidélité', num(l.points), plural(l.rewards, 'récompense') + ' disponible' + (l.rewards >= 2 ? 's' : ''))}
    </div>
    <div class="card mt-5 border-l-4 border-l-brand-yellow p-5 sm:p-6">
      <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div class="flex items-center gap-3"><span class="icon-tile !bg-amber-50 !text-amber-600">${icon('gift', 21)}</span>
          <div><div class="font-display font-bold text-brand-night">Fidélité Directline</div><p class="mt-0.5 text-sm text-slate-500">${plural(l.pointsPerKg, 'point')} par kilo livré · ${num(l.threshold)} points = ${num(l.rewardKg)} kg offerts</p></div></div>
        <div class="w-full sm:w-72">
          <div class="flex justify-between text-xs font-semibold"><span class="text-brand-navy">${num(l.points)} points</span><span class="text-slate-500">encore ${plural(l.toNext, 'point')}</span></div>
          <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div class="brand-bar h-full rounded-full" style="width:${Math.max(4, Math.round(l.progress * 100))}%"></div></div>
          ${l.rewards ? `<div class="mt-2 text-xs font-semibold text-amber-700">${plural(l.rewards, 'récompense')} de ${num(l.rewardKg)} kg à utiliser : contactez-nous.</div>` : ''}
        </div>
      </div>
    </div>
    ${inChina > 1 ? `<div class="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">${icon('boxes', 20, 'mt-0.5')}<div><b>${inChina} colis attendent à Guangzhou.</b><div class="mt-1 text-sm">Le regroupement peut réduire vos frais. <a class="font-semibold underline" target="_blank" rel="noopener" href="${waLink(`Bonjour, je souhaite regrouper mes colis (réf. ${user.id}).`)}">Demander le regroupement</a></div></div></div>` : ''}
    <div class="mt-10 flex items-center justify-between gap-4">
      <h2 class="display text-2xl">Mes expéditions</h2>
      <a href="#/notifications" class="btn btn-ghost btn-sm">${icon('bell', 16)} Notifications${unread ? ` <span class="rounded-full bg-brand-red px-2 py-0.5 text-[11px] text-white">${unread}</span>` : ''}</a>
    </div>
    ${ps.length ? `
      <div class="mt-4 space-y-3 md:hidden">
        ${ps.map((p) => `<article class="card p-4">
          <div class="flex items-start justify-between gap-3"><div><a href="#/suivi/${encodeURIComponent(p.tracking)}" class="font-display font-extrabold text-brand-blue">${esc(p.tracking)}</a><div class="mt-1 text-sm text-slate-600">${esc(p.description)}</div></div>${statusBadge(p.status)}</div>
          <div class="mt-4 flex items-center justify-between text-sm"><span class="text-slate-500">${num(p.weight)} kg</span><span class="flex items-center gap-2">${paymentBadge(p)}<b>${usd(price(p))}</b></span></div>
          <div class="mt-4 flex flex-wrap gap-2">${clientParcelActions(p)}</div>
        </article>`).join('')}
      </div>
      <div class="card mt-4 hidden overflow-x-auto md:block">
        <table class="table-base min-w-[760px]">
          <thead><tr><th>Suivi</th><th>Description</th><th>Poids</th><th>Statut</th><th>Montant</th><th>Paiement</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${ps.map((p) => `<tr>
            <td><a href="#/suivi/${encodeURIComponent(p.tracking)}" class="font-display font-extrabold text-brand-blue hover:underline">${esc(p.tracking)}</a></td>
            <td>${esc(p.description)}</td><td>${num(p.weight)} kg</td><td>${statusBadge(p.status)}</td>
            <td class="font-bold">${usd(price(p))}</td><td>${paymentBadge(p)}</td>
            <td><div class="flex justify-end gap-1">${clientParcelActions(p)}</div></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
    : `<div class="card mt-4 p-10 text-center">
        <span class="icon-tile mx-auto">${icon('package', 22)}</span>
        <h3 class="mt-4 text-lg font-bold">Aucun colis pour le moment</h3>
        <p class="mx-auto mt-2 max-w-md text-sm text-slate-600">Donnez votre adresse Directline à vos fournisseurs : vos colis apparaîtront ici dès leur réception à Guangzhou.</p>
        <a href="#/adresse" class="btn btn-primary mt-6">${icon('map-pin', 17)} Voir mon adresse en Chine</a>
      </div>`}
    <div class="mt-5 grid gap-5 lg:grid-cols-2">
      <div class="card p-5 sm:p-6">
        <h3 class="font-bold">Détail des frais</h3>
        <div class="mt-4 space-y-2 text-sm">
          ${ps.map((p) => `<div class="flex justify-between gap-3"><span class="text-slate-500">${esc(p.tracking)} · ${num(p.weight)} kg × ${num(parcelRate(p))} $${consolidationCost(p) ? ' + regroupement' : ''}${customsCost(p) ? ' + douane' : ''}</span><b>${usd(price(p))}</b></div>`).join('') || '<p class="text-slate-400">Aucun frais à afficher.</p>'}
        </div>
      </div>
      <div class="card p-5 sm:p-6">
        <div class="flex items-center justify-between"><h3 class="font-bold">Dernières notifications</h3><a href="#/notifications" class="text-sm font-semibold text-brand-blue">Tout voir</a></div>
        ${ns.slice(0, 3).map((n) => `<div class="mt-4 flex gap-3 text-sm"><span class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-slate-300' : 'bg-brand-red'}"></span><div><div class="font-semibold text-brand-night">${esc(n.title)}</div><div class="mt-0.5 text-xs text-slate-500">${esc(n.message)}</div></div></div>`).join('') || '<p class="mt-3 text-sm text-slate-500">Vous êtes à jour.</p>'}
      </div>
    </div>
  </section>`;
}

function addressPage() {
  const user = currentUser();
  if (!user) return loginRequired('Connectez-vous pour afficher votre adresse personnelle en Chine.');
  return `<section class="container-page max-w-4xl py-12 sm:py-16">
    <a href="#/espace" class="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-brand-blue">${icon('arrow-left', 16)} Mon espace</a>
    <div class="mt-6">${pageHead('Adresse d’expédition', 'Votre adresse personnelle en Chine', 'Donnez cette adresse à vos fournisseurs. Votre référence client nous permet d’identifier vos colis.')}</div>
    <div class="card mt-8 p-5 sm:p-8">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span class="font-display text-lg font-bold text-brand-night">Entrepôt Directline · Guangzhou</span>
        <span class="chip bg-brand-sky text-brand-blue">Référence client : ${esc(user.id)}</span>
      </div>
      ${addressCard(user)}
    </div>
    <ol class="mt-8 grid gap-4 sm:grid-cols-3">
      ${[
        ['Copiez l’adresse', 'En chinois pour les vendeurs et livreurs chinois, en français pour vous.'],
        ['Collez-la chez le vendeur', 'Dans l’application ou le site (Taobao, 1688, Alibaba…).'],
        ['Ajoutez votre référence', `Écrivez ${esc(user.id)} dans le nom du destinataire ou la remarque.`],
      ].map(([t, d], i) => `<li class="card p-5"><span class="grid h-9 w-9 place-items-center rounded-full ${['bg-brand-red', 'bg-brand-yellow text-brand-night', 'bg-brand-blue'][i]} font-display font-extrabold italic text-white">${i + 1}</span><h3 class="mt-3 font-bold">${t}</h3><p class="mt-1 text-sm text-slate-600">${d}</p></li>`).join('')}
    </ol>
  </section>`;
}

function notificationsPage() {
  const user = currentUser();
  if (!user) return loginRequired('Connectez-vous pour voir vos notifications.');
  const all = Data.notifications();
  const mine = all.filter((n) => n.clientId === user.id);
  const html = `<section class="container-page max-w-4xl py-12 sm:py-16">
    <a href="#/espace" class="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-brand-blue">${icon('arrow-left', 16)} Mon espace</a>
    <div class="mt-6">${pageHead('Notifications', 'Vos notifications')}</div>
    <div class="mt-8 space-y-3">
      ${mine.map((n) => `<div class="card flex gap-4 p-5 ${n.read ? '' : 'border-l-4 border-l-brand-red'}">
        <span class="icon-tile">${icon('bell', 19)}</span>
        <div><div class="font-display font-bold text-brand-night">${esc(n.title)}${n.read ? '' : ' <span class="chip ml-1 bg-red-50 !py-0.5 text-brand-red">Nouveau</span>'}</div><p class="mt-1 text-sm text-slate-600">${esc(n.message)}</p><div class="mt-2 text-xs text-slate-400">${formatDate(n.date)}</div></div>
      </div>`).join('') || '<div class="card p-10 text-center text-slate-500">Aucune notification pour le moment.</div>'}
    </div>
  </section>`;
  if (mine.some((n) => !n.read)) {
    all.forEach((n) => { if (n.clientId === user.id) n.read = true; });
    Data.saveNotifications(all);
  }
  return html;
}

/* ---------- Connexion et inscription client ---------- */
function authModal(kind = 'login') {
  const register = kind === 'register';
  modal(`
    ${eyebrow('Espace client')}
    <h2 id="modal-title" class="display mt-3 text-3xl">${register ? 'Créer mon compte' : 'Bon retour !'}</h2>
    <p class="mt-1 text-sm text-slate-500">${register ? 'Votre adresse en Chine et votre référence client en quelques secondes.' : 'Connectez-vous pour retrouver vos colis.'}</p>
    <div class="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
      <button type="button" data-action="open-login" class="rounded-lg py-2 ${register ? 'text-slate-500' : 'bg-white text-brand-navy shadow'}">Connexion</button>
      <button type="button" data-action="open-register" class="rounded-lg py-2 ${register ? 'bg-white text-brand-navy shadow' : 'text-slate-500'}">Inscription</button>
    </div>
    <form data-form="${register ? 'register' : 'login'}" class="mt-5 space-y-3">
      ${register ? `<div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="a-first">Prénom</label><input id="a-first" class="input" name="firstname" autocomplete="given-name" required autofocus></div>
          <div><label class="label" for="a-name">Nom</label><input id="a-name" class="input" name="name" autocomplete="family-name" required></div>
        </div>
        <div><label class="label" for="a-phone">Téléphone (WhatsApp)</label><input id="a-phone" class="input" name="phone" type="tel" placeholder="+243 8…" autocomplete="tel" required></div>
        <div><label class="label" for="a-email">E-mail (facultatif)</label><input id="a-email" class="input" name="email" type="email" autocomplete="email"></div>`
      : `<div><label class="label" for="a-id">Téléphone ou e-mail</label><input id="a-id" class="input" name="identifier" autocomplete="username" required autofocus></div>`}
      <div>
        <label class="label" for="a-pass">Mot de passe</label>
        <div class="relative"><input id="a-pass" class="input pr-12" name="pass" type="password" minlength="${register ? 6 : 1}" autocomplete="${register ? 'new-password' : 'current-password'}" required>
        <button type="button" data-action="toggle-password" class="icon-btn absolute right-1.5 top-1/2 -translate-y-1/2" aria-label="Afficher le mot de passe">${icon('eye', 18)}</button></div>
        ${register ? '<span class="help">6 caractères minimum.</span>' : ''}
      </div>
      <button class="btn btn-primary w-full">${register ? 'Créer mon compte' : 'Se connecter'}</button>
      ${register ? '' : `<p class="text-center text-xs text-slate-500">Mot de passe oublié ? <a class="font-semibold text-brand-blue" target="_blank" rel="noopener" href="${waLink('Bonjour, j’ai oublié le mot de passe de mon compte Directline.')}">Contactez-nous sur WhatsApp</a></p>`}
    </form>`);
}

function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  return Data.users().find((u) => (u.email && u.email.toLowerCase() === id) || (normPhone(id).length >= 9 && samePhone(u.phone, id)));
}

async function submitLogin(f) {
  const d = Object.fromEntries(new FormData(f));
  const users = Data.users();
  const user = findUser(d.identifier);
  if (!user || !(await checkCredential(user, d.pass))) return toast('Téléphone, e-mail ou mot de passe incorrect.', 'error');
  if (!user.passHash) { Object.assign(user, await makeCredential(d.pass)); delete user.pass; Data.saveUsers(users); }
  startSession(user);
  closeModal();
  toast(`Bienvenue ${user.firstname} !`);
  go('espace');
}

async function submitRegister(f) {
  const d = Object.fromEntries(new FormData(f));
  const users = Data.users();
  const email = String(d.email || '').trim().toLowerCase();
  if (normPhone(d.phone).length < 9) return toast('Numéro de téléphone invalide.', 'error');
  const existing = users.find((u) => samePhone(u.phone, d.phone) || (email && u.email && u.email.toLowerCase() === email));
  if (existing && (existing.passHash || existing.pass)) {
    toast('Un compte existe déjà avec ce téléphone ou cet e-mail : connectez-vous.', 'info');
    return authModal('login');
  }
  const credential = await makeCredential(d.pass);
  let user = existing;
  if (user) {
    // Client créé par l'équipe : il active simplement son compte.
    Object.assign(user, credential, { email: user.email || email, firstname: user.firstname || d.firstname.trim(), name: user.name || d.name.trim() });
  } else {
    user = { id: uniqueId('CL-', (id) => users.some((u) => u.id === id)), firstname: d.firstname.trim(), name: d.name.trim(), phone: d.phone.trim(), email, points: 0, createdAt: nowIso(), ...credential };
    users.push(user);
  }
  if (!Data.saveUsers(users)) return;
  startSession(user);
  closeModal();
  toast(existing ? `Compte activé · ${user.id}` : `Compte créé · votre référence : ${user.id}`);
  go('adresse');
}

/* ---------- Paiement ---------- */
function paymentModal(tracking) {
  const p = Data.parcels().find((x) => x.tracking === tracking);
  if (!p) return;
  modal(`
    ${eyebrow('Règlement de livraison')}
    <h2 id="modal-title" class="display mt-3 text-2xl">Payer mon colis</h2>
    <div class="mt-4 flex items-center justify-between rounded-2xl bg-brand-night p-4 text-white"><span class="text-sm text-white/70">${esc(p.tracking)}</span><b class="font-display text-2xl italic text-brand-yellow">${usd(price(p))}</b></div>
    <form data-form="payment" data-id="${esc(p.tracking)}" class="mt-5 space-y-4">
      <div><label class="label" for="pay-method">Mode de paiement</label>
        <select id="pay-method" name="method" data-live="pay-method" class="input">${PAY_METHODS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></div>
      <div data-pay-instructions>${payInstructions('mpesa', p)}</div>
      <div data-pay-reference><label class="label" for="pay-ref">Référence de la transaction (reçue par SMS)</label><input id="pay-ref" name="reference" class="input" placeholder="Ex. 8FG45HJ2K1" autocomplete="off" required></div>
      <p class="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-medium text-emerald-800">${icon('shield-check', 16, 'mt-px')}Ne communiquez jamais votre code PIN. Directline ne vous le demandera jamais.</p>
      <button class="btn btn-blue w-full" data-pay-submit>J’ai payé : envoyer la référence</button>
    </form>`);
}
function payInstructions(method, p) {
  const s = Data.settings();
  if (method === 'cash') return `<div class="rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-600">Réglez <b>${usd(price(p))}</b> en espèces au point de retrait, au moment de récupérer votre colis.</div>`;
  const numberValue = s[method];
  if (!numberValue) {
    return `<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Le numéro ${esc(payMethodLabel(method))} vous sera communiqué sur WhatsApp.
      <a class="mt-2 flex items-center gap-1 font-semibold underline" target="_blank" rel="noopener" href="${waLink(`Bonjour, je souhaite payer mon colis ${p.tracking} (${usd(price(p))}) par ${payMethodLabel(method)}.`)}">${icon('message-circle', 15)} Demander le numéro</a></div>`;
  }
  return `<ol class="list-decimal space-y-1.5 rounded-xl border border-slate-200 p-4 pl-8 text-sm leading-6 text-slate-600">
    <li>Envoyez <b class="text-brand-night">${usd(price(p))}</b> au <b class="text-brand-night">${esc(numberValue)}</b> (${esc(s.paymentName)}) via ${esc(payMethodLabel(method))}.</li>
    <li>Notez la référence de transaction reçue par SMS.</li>
    <li>Saisissez-la ci-dessous : nous confirmons votre paiement rapidement.</li>
  </ol>`;
}
function updatePayInstructions(form) {
  const p = Data.parcels().find((x) => x.tracking === form.dataset.id);
  const method = form.method.value;
  $('[data-pay-instructions]', form).innerHTML = payInstructions(method, p);
  const cash = method === 'cash';
  $('[data-pay-reference]', form).hidden = cash;
  form.reference.required = !cash;
  $('[data-pay-submit]', form).textContent = cash ? 'Compris' : 'J’ai payé : envoyer la référence';
}
function submitPayment(f) {
  const ps = Data.parcels();
  const p = ps.find((x) => x.tracking === f.dataset.id);
  if (!p) return;
  if (f.method.value === 'cash') { closeModal(); return toast('Vous réglerez en espèces au retrait du colis.', 'info'); }
  p.paymentStatus = 'PENDING';
  p.payment = { method: f.method.value, reference: f.reference.value.trim(), declaredAt: nowIso() };
  if (!Data.saveParcels(ps)) return;
  closeModal();
  render();
  toast('Référence envoyée : nous confirmons votre paiement au plus vite.');
}

/* ---------- Reçu imprimable ---------- */
function invoiceFor(tracking) {
  const p = Data.parcels().find((x) => x.tracking === tracking);
  if (!p) return;
  const u = Data.users().find((x) => x.id === p.clientId) || {};
  const s = Data.settings();
  const cell = 'padding:10px 12px;border-bottom:1px solid #e3e8ef';
  const pay = paymentStatus(p);
  $('#invoice').innerHTML = `<div style="font-family:Inter,Arial,sans-serif;color:#3b424d;max-width:760px;margin:0 auto">
    <div style="height:5px;background:linear-gradient(90deg,#e02010,#f07a12 22%,#f9c20a 45%,#0a67c9 72%,#003a90)"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 0;border-bottom:1px solid #e3e8ef">
      <img src="assets/img/directline-logo.webp" alt="Directline" style="height:78px">
      <div style="text-align:right"><div style="font-size:20px;font-weight:800;font-style:italic;color:#003a90">REÇU DE TRANSPORT</div><div style="margin-top:4px;color:#64748b">N° R-${esc(p.tracking)}</div><div style="color:#64748b">Émis le ${formatDate(nowIso(), false)}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:24px;margin:24px 0">
      <div><b style="color:#021c4a">CLIENT</b><div style="margin-top:6px">${esc(`${u.firstname || ''} ${u.name || ''}`)}</div><div>${esc(u.id || '')}</div><div>${esc(u.phone || '')}</div><div>${esc(u.email || '')}</div></div>
      <div style="text-align:right"><b style="color:#021c4a">TRAJET</b><div style="margin-top:6px">Guangzhou (Chine) → RDC</div><div>Suivi : ${esc(p.tracking)}</div><div>Statut : ${STATUSES[p.status]?.label || ''}</div></div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#eaf2fc;color:#021c4a"><th style="padding:10px 12px;text-align:left">Désignation</th><th style="padding:10px 12px;text-align:right">Montant</th></tr></thead>
      <tbody>
        <tr><td style="${cell}">Transport aérien · ${esc(p.description)}<br><small style="color:#64748b">${num(p.weight)} kg × ${num(parcelRate(p))} $/kg</small></td><td style="${cell};text-align:right">${usd(transportCost(p))}</td></tr>
        ${consolidationCost(p) ? `<tr><td style="${cell}">Frais de regroupement</td><td style="${cell};text-align:right">${usd(consolidationCost(p))}</td></tr>` : ''}
        ${customsCost(p) ? `<tr><td style="${cell}">Frais de douane</td><td style="${cell};text-align:right">${usd(customsCost(p))}</td></tr>` : ''}
      </tbody>
    </table>
    <div style="margin:18px 0 0 auto;width:280px;display:flex;justify-content:space-between;border-top:2px solid #003a90;padding-top:10px;font-size:20px;color:#021c4a"><b>TOTAL</b><b>${usd(price(p))}</b></div>
    <p style="margin-top:10px;text-align:right;font-weight:700;color:${pay === 'PAID' ? '#047857' : '#b45309'}">${pay === 'PAID' ? `Payé${p.payment?.confirmedAt ? ` le ${formatDate(p.payment.confirmedAt, false)}` : ''}${p.payment?.method ? ` · ${esc(payMethodLabel(p.payment.method))}` : ''}` : PAYMENT_STATUSES[pay].label}</p>
    <div style="margin-top:36px;padding-top:14px;border-top:1px solid #e3e8ef;font-size:12px;color:#64748b;display:flex;justify-content:space-between;gap:16px">
      <span>Merci d’avoir choisi Directline RDC.<br>WhatsApp : ${esc(s.contactPhone)}${s.contactEmail ? ` · ${esc(s.contactEmail)}` : ''}</span>
      <span style="letter-spacing:.2em;font-weight:600"><span style="display:inline-block;width:18px;height:2px;background:#e02010;vertical-align:middle"></span> CHINA TO DRC • DIRECT TO YOU <span style="display:inline-block;width:18px;height:2px;background:#0a67c9;vertical-align:middle"></span></span>
    </div>
  </div>`;
  document.body.classList.add('printing');
  const img = $('#invoice img');
  const print = () => { window.print(); };
  if (img && !img.complete) {
    img.addEventListener('load', print, { once: true });
    img.addEventListener('error', print, { once: true });
  } else print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('printing'));

/* ================================================================
   Administration
   ================================================================ */
let adminQuery = '';
let adminStatus = 'ALL';
let adminPayment = 'ALL';
let clientQuery = '';

function adminCredential() {
  const record = store.get('admin_hash', null);
  if (record?.passHash) return record;
  const legacy = store.get('admin_pass', null);
  return legacy ? { pass: legacy } : null;
}

function adminLoginPage() {
  const setup = !adminCredential();
  return `<section class="container-page py-16 sm:py-20">
    <div class="card mx-auto max-w-md p-8">
      <span class="icon-tile mx-auto">${icon('shield', 22)}</span>
      <h1 class="display mt-4 text-center text-3xl">Espace gestionnaire</h1>
      <p class="mt-2 text-center text-sm text-slate-500">${setup ? 'Première connexion sur cet appareil : choisissez le mot de passe administrateur.' : 'Accès réservé à l’équipe Directline.'}</p>
      <form data-form="${setup ? 'admin-setup' : 'admin-login'}" class="mt-6 space-y-3">
        <div><label class="label" for="ad-pass">${setup ? 'Nouveau mot de passe' : 'Mot de passe'}</label><input id="ad-pass" name="pass" type="password" class="input" minlength="${setup ? 8 : 1}" autocomplete="${setup ? 'new-password' : 'current-password'}" required autofocus></div>
        ${setup ? '<div><label class="label" for="ad-pass2">Confirmer le mot de passe</label><input id="ad-pass2" name="confirm" type="password" class="input" minlength="8" autocomplete="new-password" required><span class="help">8 caractères minimum. Notez-le en lieu sûr.</span></div>' : ''}
        <button class="btn btn-primary w-full">${setup ? 'Créer le mot de passe' : 'Se connecter'}</button>
      </form>
    </div>
  </section>`;
}
async function submitAdminSetup(f) {
  if (adminCredential()) return render();
  if (f.pass.value !== f.confirm.value) return toast('Les deux mots de passe ne correspondent pas.', 'error');
  store.set('admin_hash', await makeCredential(f.pass.value));
  isAdmin = true;
  sessionFlag.set('dl_session_admin', 'true');
  toast('Mot de passe administrateur enregistré.');
  render();
}
async function submitAdminLogin(f) {
  const record = adminCredential();
  if (!(await checkCredential(record, f.pass.value))) return toast('Mot de passe incorrect.', 'error');
  if (!record.passHash) { store.set('admin_hash', await makeCredential(f.pass.value)); store.remove('admin_pass'); }
  isAdmin = true;
  sessionFlag.set('dl_session_admin', 'true');
  toast('Bienvenue dans l’administration.');
  render();
}

function setupChecklist(s) {
  const items = [];
  if (waNumber(s.contactPhone) === waNumber(PLACEHOLDER_PHONE)) items.push('Remplacez le numéro WhatsApp d’exemple par le vôtre.');
  if (/0000 0000/.test(s.address + s.addressZh)) items.push('Complétez l’adresse réelle de l’entrepôt (en français et en chinois).');
  if (!s.contactEmail) items.push('Ajoutez votre e-mail de contact.');
  if (!s.mpesa && !s.orangeMoney && !s.airtelMoney) items.push('Indiquez vos numéros Mobile Money pour les paiements.');
  if (!s.transitTime) items.push('Précisez le délai moyen de livraison.');
  return items;
}

function adminPage(param) {
  if (!isAdmin) return adminLoginPage();
  const tab = ['clients', 'parametres'].includes(param) ? param : 'colis';
  const tabs = [['', 'Colis', 'package'], ['clients', 'Clients', 'users'], ['parametres', 'Paramètres', 'settings']];
  const body = tab === 'clients' ? adminClientsTab() : tab === 'parametres' ? adminSettingsTab() : adminParcelsTab();
  return `<section class="container-page py-10 sm:py-14">
    ${pageHead('Pilotage logistique', 'Administration', 'Gérez les colis, les clients et les informations du site.', `<div class="flex flex-wrap gap-2">
      <button type="button" data-action="export-csv" class="btn btn-outline btn-sm">${icon('download', 15)} Export CSV</button>
      <button type="button" data-action="parcel-new" class="btn btn-primary btn-sm">${icon('plus', 15)} Nouveau colis</button>
    </div>`)}
    <nav class="mt-8 flex gap-6 overflow-x-auto border-b border-slate-200" aria-label="Sections de l’administration">
      ${tabs.map(([key, label, ic]) => `<a href="#/admin${key ? '/' + key : ''}" class="tab" ${(key || 'colis') === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`).join('')}
    </nav>
    <div class="mt-8">${body}</div>
  </section>`;
}

function adminParcelsTab() {
  const all = Data.parcels();
  const s = Data.settings();
  const checklist = setupChecklist(s);
  const pendingPay = all.filter((p) => paymentStatus(p) === 'PENDING').length;
  return `
    ${checklist.length ? `<div class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
      <div class="flex items-center gap-2 font-display font-bold">${icon('list-checks', 18)} À compléter avant la mise en ligne</div>
      <ul class="mt-3 list-disc space-y-1 pl-5 text-sm">${checklist.map((c) => `<li>${c}</li>`).join('')}</ul>
      <a href="#/admin/parametres" class="btn btn-outline btn-sm mt-4">Ouvrir les paramètres</a>
    </div>` : ''}
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      ${statTile('package', 'Total colis', all.length)}
      ${statTile('warehouse', 'À Guangzhou', all.filter((p) => p.status === 'RECEIVED_CHINA').length, 'Regroupement possible')}
      ${statTile('plane', 'En transit', all.filter((p) => p.status === 'IN_TRANSIT').length, 'Chine → RDC')}
      ${statTile('map-pin', 'Arrivés en RDC', all.filter((p) => p.status === 'ARRIVED_RDC').length, 'En attente de retrait')}
      ${statTile('wallet', 'Paiements à vérifier', pendingPay, pendingPay ? 'Références reçues' : 'Rien en attente')}
    </div>
    ${loyaltyAdminPanel()}
    <div class="card mt-6 flex flex-col gap-3 p-4 md:flex-row">
      <label class="relative flex-1"><span class="sr-only">Rechercher</span>
        <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 18)}</span>
        <input class="input !pl-11" data-live="admin-query" placeholder="Suivi, client, référence CL-… ou description" value="${esc(adminQuery)}">
      </label>
      <select class="input md:!w-52" data-live="admin-status" aria-label="Filtrer par statut">
        <option value="ALL">Tous les statuts</option>
        ${STATUS_ORDER.map((k) => `<option value="${k}" ${adminStatus === k ? 'selected' : ''}>${STATUSES[k].label}</option>`).join('')}
      </select>
      <select class="input md:!w-52" data-live="admin-payment" aria-label="Filtrer par paiement">
        <option value="ALL">Tous les paiements</option>
        ${Object.entries(PAYMENT_STATUSES).map(([k, v]) => `<option value="${k}" ${adminPayment === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
    </div>
    <div id="admin-parcels" class="mt-4">${adminParcelList()}</div>`;
}

function adminParcelList() {
  const users = Data.users();
  const q = adminQuery.trim().toLowerCase();
  const ps = Data.parcels().filter((p) => {
    const u = users.find((x) => x.id === p.clientId);
    const hay = `${p.tracking} ${p.clientId} ${p.description} ${u?.firstname || ''} ${u?.name || ''} ${u?.phone || ''}`.toLowerCase();
    return (!q || hay.includes(q)) && (adminStatus === 'ALL' || p.status === adminStatus) && (adminPayment === 'ALL' || paymentStatus(p) === adminPayment);
  });
  if (!ps.length) {
    return `<div class="card p-10 text-center text-sm text-slate-500">${Data.parcels().length ? 'Aucun colis ne correspond à la recherche.' : 'Aucun colis enregistré. Cliquez sur « Nouveau colis » pour commencer.'}</div>`;
  }
  const clientName = (p) => { const u = users.find((x) => x.id === p.clientId); return u ? `${u.firstname} ${u.name}` : 'Client inconnu'; };
  const actions = (p) => `
    <button type="button" data-action="parcel-status" data-id="${esc(p.tracking)}" class="icon-btn" title="Changer le statut" aria-label="Changer le statut">${icon('refresh-cw', 17)}</button>
    <button type="button" data-action="payment-review" data-id="${esc(p.tracking)}" class="icon-btn ${paymentStatus(p) === 'PENDING' ? '!bg-amber-50 !text-amber-700' : ''}" title="Paiement" aria-label="Paiement">${icon('wallet', 17)}</button>
    <button type="button" data-action="parcel-edit" data-id="${esc(p.tracking)}" class="icon-btn" title="Modifier" aria-label="Modifier">${icon('pencil', 17)}</button>
    <button type="button" data-action="parcel-photo" data-id="${esc(p.tracking)}" class="icon-btn" title="Photo" aria-label="Photo">${icon('camera', 17)}</button>
    <button type="button" data-action="invoice" data-id="${esc(p.tracking)}" class="icon-btn" title="Reçu" aria-label="Reçu">${icon('file-text', 17)}</button>
    <button type="button" data-action="parcel-delete" data-id="${esc(p.tracking)}" class="icon-btn hover:!bg-red-50 hover:!text-brand-red" title="Supprimer" aria-label="Supprimer">${icon('trash-2', 17)}</button>`;
  return `
    <div class="space-y-3 md:hidden">
      ${ps.map((p) => `<article class="card p-4">
        <div class="flex items-start justify-between gap-3"><div><a href="#/suivi/${encodeURIComponent(p.tracking)}" class="font-display font-extrabold text-brand-blue">${esc(p.tracking)}</a><div class="mt-1 font-semibold">${esc(clientName(p))}</div><div class="text-xs text-slate-400">${esc(p.clientId)}</div></div>${statusBadge(p.status)}</div>
        <div class="mt-3 text-sm text-slate-600">${esc(p.description)} · ${num(p.weight)} kg · <b>${usd(price(p))}</b></div>
        <div class="mt-2">${paymentBadge(p)}</div>
        <div class="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-3">${actions(p)}</div>
      </article>`).join('')}
    </div>
    <div class="card hidden overflow-x-auto md:block">
      <table class="table-base min-w-[980px]">
        <thead><tr><th>Suivi</th><th>Client</th><th>Colis</th><th>Poids</th><th>Montant</th><th>Statut</th><th>Paiement</th><th>Actions</th></tr></thead>
        <tbody>${ps.map((p) => `<tr>
          <td><a href="#/suivi/${encodeURIComponent(p.tracking)}" class="font-display font-extrabold text-brand-blue hover:underline">${esc(p.tracking)}</a><div class="text-xs text-slate-400">${formatDate(p.createdAt || p.statusHistory?.[0]?.date, false)}</div></td>
          <td><div class="font-semibold">${esc(clientName(p))}</div><div class="text-xs text-slate-400">${esc(p.clientId)}</div></td>
          <td class="max-w-[220px]">${esc(p.description)}</td>
          <td>${num(p.weight)} kg</td>
          <td class="font-bold">${usd(price(p))}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${paymentBadge(p)}</td>
          <td><div class="flex gap-0.5">${actions(p)}</div></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function loyaltyAdminPanel() {
  const pending = Data.users().map((u) => ({ u, l: loyaltyOf(u) })).filter(({ u, l }) => l.rewards > (Number(u.loyaltyRewardsNotified) || 0));
  if (!pending.length) return '';
  return `<section class="card mt-6 border-l-4 border-l-brand-yellow p-5">
    <div class="flex items-start gap-3">
      <span class="icon-tile !bg-amber-50 !text-amber-600">${icon('award', 20)}</span>
      <div class="flex-1">
        <h2 class="font-display font-bold text-brand-night">Récompenses fidélité à annoncer</h2>
        <p class="mt-1 text-sm text-slate-500">Ces clients ont débloqué une nouvelle récompense.</p>
        <div class="mt-4 space-y-3">
          ${pending.map(({ u, l }) => `<div class="flex flex-col justify-between gap-3 rounded-xl bg-amber-50/70 p-3 sm:flex-row sm:items-center">
            <div><b>${esc(`${u.firstname} ${u.name}`)}</b><span class="ml-2 text-xs text-slate-500">${esc(u.id)} · ${num(l.points)} pts</span><div class="mt-1 text-sm text-amber-800">${plural(l.rewards, 'récompense')} · ${num(l.rewards * l.rewardKg)} kg offerts</div></div>
            <button type="button" data-action="loyalty-notify" data-id="${esc(u.id)}" class="btn btn-primary btn-sm">${icon('bell', 15)} Notifier le client</button>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </section>`;
}
function notifyLoyalty(clientId) {
  const users = Data.users();
  const u = users.find((x) => x.id === clientId);
  if (!u) return;
  const l = loyaltyOf(u);
  u.loyaltyRewardsNotified = l.rewards;
  Data.saveUsers(users);
  notify(u.id, 'Récompense fidélité débloquée 🎁', `Félicitations ! Vous avez ${plural(l.rewards, 'récompense')} de ${num(l.rewardKg)} kg de transport offerts. Contactez Directline pour en profiter.`);
  render();
  toast('Le client a été notifié.');
}
function redeemLoyalty(clientId) {
  const users = Data.users();
  const u = users.find((x) => x.id === clientId);
  if (!u) return;
  const l = loyaltyOf(u);
  if (!l.rewards) return toast('Aucune récompense disponible pour ce client.', 'info');
  if (!confirm(`Utiliser une récompense de ${num(l.rewardKg)} kg pour ${u.firstname} ${u.name} ? ${num(l.threshold)} points seront déduits.`)) return;
  u.points = l.points - l.threshold;
  u.loyaltyRewardsNotified = Math.min(Number(u.loyaltyRewardsNotified) || 0, loyaltyOf(u).rewards);
  Data.saveUsers(users);
  notify(u.id, 'Récompense utilisée', `Une récompense de ${num(l.rewardKg)} kg offerts a été appliquée. Il vous reste ${plural(u.points, 'point')}.`);
  render();
  toast('Récompense déduite.');
}

function adminClientsTab() {
  const users = Data.users();
  const parcels = Data.parcels();
  const q = clientQuery.trim().toLowerCase();
  const list = users.filter((u) => !q || `${u.id} ${u.firstname} ${u.name} ${u.phone} ${u.email}`.toLowerCase().includes(q))
    .sort((a, b) => `${a.name} ${a.firstname}`.localeCompare(`${b.name} ${b.firstname}`, 'fr'));
  return `<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <label class="relative md:w-96"><span class="sr-only">Rechercher un client</span>
        <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 18)}</span>
        <input class="input !pl-11" data-live="client-query" placeholder="Nom, téléphone, e-mail ou CL-…" value="${esc(clientQuery)}">
      </label>
      <button type="button" data-action="client-new" class="btn btn-primary btn-sm">${icon('user-plus', 15)} Nouveau client</button>
    </div>
    <div id="admin-clients" class="card mt-4 overflow-x-auto">
      ${list.length ? `<table class="table-base min-w-[860px]">
        <thead><tr><th>Référence</th><th>Client</th><th>Contact</th><th>Colis</th><th>Fidélité</th><th>Compte</th><th>Actions</th></tr></thead>
        <tbody>${list.map((u) => {
          const l = loyaltyOf(u);
          return `<tr>
            <td class="font-display font-extrabold text-brand-blue">${esc(u.id)}</td>
            <td class="font-semibold">${esc(`${u.firstname} ${u.name}`)}</td>
            <td><div>${esc(u.phone)}</div><div class="text-xs text-slate-400">${esc(u.email || '—')}</div></td>
            <td>${parcels.filter((p) => p.clientId === u.id).length}</td>
            <td>${num(l.points)} pts${l.rewards ? `<div class="text-xs font-semibold text-amber-700">${plural(l.rewards, 'récompense')}</div>` : ''}</td>
            <td>${u.passHash || u.pass ? '<span class="chip bg-emerald-50 text-emerald-700">Activé</span>' : '<span class="chip bg-slate-100 text-slate-500">Non activé</span>'}</td>
            <td><div class="flex gap-0.5">
              <button type="button" data-action="parcel-new" data-client="${esc(u.id)}" class="icon-btn" title="Nouveau colis pour ce client" aria-label="Nouveau colis pour ce client">${icon('package-plus', 17)}</button>
              <button type="button" data-action="client-edit" data-id="${esc(u.id)}" class="icon-btn" title="Modifier" aria-label="Modifier">${icon('pencil', 17)}</button>
              <button type="button" data-action="loyalty-redeem" data-id="${esc(u.id)}" class="icon-btn" title="Utiliser une récompense" aria-label="Utiliser une récompense" ${l.rewards ? '' : 'disabled'}>${icon('gift', 17)}</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : `<div class="p-10 text-center text-sm text-slate-500">${users.length ? 'Aucun client ne correspond à la recherche.' : 'Aucun client pour le moment. Les clients s’inscrivent eux-mêmes, ou vous pouvez les ajouter.'}</div>`}
    </div>
    <p class="mt-3 text-xs text-slate-500">Un client ajouté par l’équipe active son compte en s’inscrivant avec le même numéro de téléphone.</p>`;
}

function clientModal(id) {
  const u = id ? Data.users().find((x) => x.id === id) : null;
  modal(`
    <h2 id="modal-title" class="display text-2xl">${u ? 'Modifier le client' : 'Nouveau client'}</h2>
    ${u ? `<p class="mt-1 text-sm text-slate-500">${esc(u.id)}</p>` : '<p class="mt-1 text-sm text-slate-500">Pour un client qui vous contacte par WhatsApp ou au bureau.</p>'}
    <form data-form="client" data-id="${esc(u?.id || '')}" class="mt-5 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label" for="c-first">Prénom</label><input id="c-first" name="firstname" class="input" value="${esc(u?.firstname || '')}" required></div>
        <div><label class="label" for="c-name">Nom</label><input id="c-name" name="name" class="input" value="${esc(u?.name || '')}" required></div>
      </div>
      <div><label class="label" for="c-phone">Téléphone</label><input id="c-phone" name="phone" type="tel" class="input" value="${esc(u?.phone || '')}" placeholder="+243…" required></div>
      <div><label class="label" for="c-email">E-mail (facultatif)</label><input id="c-email" name="email" type="email" class="input" value="${esc(u?.email || '')}"></div>
      ${u ? `<div><label class="label" for="c-points">Points fidélité</label><input id="c-points" name="points" type="number" min="0" step="1" class="input" value="${Number(u.points) || 0}"></div>` : ''}
      <button class="btn btn-primary w-full">${u ? 'Enregistrer' : 'Créer le client'}</button>
    </form>`);
}
function submitClient(f) {
  const d = Object.fromEntries(new FormData(f));
  const users = Data.users();
  if (normPhone(d.phone).length < 9) return toast('Numéro de téléphone invalide.', 'error');
  const duplicate = users.find((u) => u.id !== f.dataset.id && samePhone(u.phone, d.phone));
  if (duplicate) return toast(`Ce numéro appartient déjà à ${duplicate.firstname} ${duplicate.name} (${duplicate.id}).`, 'error');
  let u = users.find((x) => x.id === f.dataset.id);
  const fields = { firstname: d.firstname.trim(), name: d.name.trim(), phone: d.phone.trim(), email: String(d.email || '').trim().toLowerCase() };
  if (u) Object.assign(u, fields, d.points !== undefined ? { points: Math.max(0, Math.round(Number(d.points) || 0)) } : {});
  else { u = { id: uniqueId('CL-', (id) => users.some((x) => x.id === id)), ...fields, points: 0, createdAt: nowIso() }; users.push(u); }
  if (!Data.saveUsers(users)) return;
  closeModal();
  render();
  toast(f.dataset.id ? 'Client mis à jour.' : `Client créé · ${u.id}`);
}

function parcelModal(tracking, clientId) {
  const p = tracking ? Data.parcels().find((x) => x.tracking === tracking) : null;
  const users = Data.users().slice().sort((a, b) => `${a.name} ${a.firstname}`.localeCompare(`${b.name} ${b.firstname}`, 'fr'));
  const s = Data.settings();
  if (!users.length) {
    return modal(`<h2 id="modal-title" class="display text-2xl">Enregistrer un colis</h2>
      <p class="mt-3 text-sm text-slate-600">Aucun client n’est enregistré. Créez d’abord le client destinataire.</p>
      <button type="button" data-action="client-new" class="btn btn-primary mt-5 w-full">${icon('user-plus', 16)} Nouveau client</button>`);
  }
  const selected = p?.clientId || clientId;
  modal(`
    <h2 id="modal-title" class="display text-2xl">${p ? 'Modifier le colis' : 'Enregistrer un colis'}</h2>
    ${p ? `<p class="mt-1 text-sm text-slate-500">${esc(p.tracking)}</p>` : '<p class="mt-1 text-sm text-slate-500">Le client est notifié de la réception à Guangzhou.</p>'}
    <form data-form="parcel" data-id="${esc(p?.tracking || '')}" class="mt-5 space-y-3">
      <div><label class="label" for="pc-client">Client</label>
        <select id="pc-client" name="clientId" class="input" required>${users.map((u) => `<option value="${esc(u.id)}" ${u.id === selected ? 'selected' : ''}>${esc(`${u.name} ${u.firstname}`)} · ${esc(u.id)}</option>`).join('')}</select></div>
      <div><label class="label" for="pc-desc">Description</label><input id="pc-desc" name="description" class="input" value="${esc(p?.description || '')}" placeholder="Ex. Vêtements, 2 cartons" required></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label" for="pc-weight">Poids (kg)</label><input id="pc-weight" name="weight" type="number" step="0.01" min="0.01" class="input" value="${esc(p?.weight ?? '')}" required></div>
        <div><label class="label" for="pc-rate">Tarif ($/kg)</label><input id="pc-rate" name="ratePerKg" type="number" step="0.01" min="0" class="input" value="${esc(p ? parcelRate(p) : s.ratePerKg)}" required></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label" for="pc-customs">Douane ($)</label><input id="pc-customs" name="customsFee" type="number" step="0.01" min="0" class="input" value="${esc(p?.customsFee ?? 0)}"></div>
        <div><label class="label" for="pc-cons">Regroupement ($)</label><input id="pc-cons" name="consolidationFee" type="number" step="0.01" min="0" class="input" value="${esc(p?.consolidationFee ?? 0)}"></div>
      </div>
      <label class="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-medium"><input type="checkbox" name="applyConsolidation" class="h-4 w-4 accent-[#0a67c9]" ${p?.applyConsolidation ? 'checked' : ''}> Appliquer les frais de regroupement</label>
      <button class="btn btn-primary w-full">${p ? 'Enregistrer les modifications' : 'Enregistrer le colis'}</button>
    </form>`);
}
function submitParcel(f) {
  const d = Object.fromEntries(new FormData(f));
  const ps = Data.parcels();
  const fields = {
    clientId: d.clientId,
    description: d.description.trim(),
    weight: Math.max(0, Number(d.weight) || 0),
    ratePerKg: Math.max(0, Number(d.ratePerKg) || 0),
    customsFee: Math.max(0, Number(d.customsFee) || 0),
    consolidationFee: Math.max(0, Number(d.consolidationFee) || 0),
    applyConsolidation: f.applyConsolidation.checked,
  };
  let p = ps.find((x) => x.tracking === f.dataset.id);
  if (p) Object.assign(p, fields);
  else {
    const prefix = `DL-${new Date().getFullYear()}-`;
    p = { ...fields, tracking: uniqueId(prefix, (id) => ps.some((x) => x.tracking === id)), status: 'RECEIVED_CHINA', paymentStatus: 'UNPAID', photoUrl: '', createdAt: nowIso(),
      statusHistory: [{ status: 'RECEIVED_CHINA', date: nowIso(), comment: 'Réception confirmée à Guangzhou' }] };
    ps.unshift(p);
  }
  if (!Data.saveParcels(ps)) return;
  if (!f.dataset.id) notify(p.clientId, 'Colis reçu à Guangzhou 📦', `Votre colis ${p.tracking} (${p.description}, ${num(p.weight)} kg) est arrivé à notre entrepôt.`);
  closeModal();
  render();
  toast(f.dataset.id ? 'Colis mis à jour.' : `Colis enregistré · ${p.tracking}`);
}
function deleteParcel(tracking) {
  if (!confirm(`Supprimer définitivement le colis ${tracking} ?`)) return;
  Data.saveParcels(Data.parcels().filter((p) => p.tracking !== tracking));
  render();
  toast('Colis supprimé.', 'info');
}

function statusModal(tracking) {
  const p = Data.parcels().find((x) => x.tracking === tracking);
  if (!p) return;
  const next = STATUS_ORDER[Math.min(STATUS_ORDER.length - 1, STATUS_ORDER.indexOf(p.status) + 1)];
  modal(`
    <h2 id="modal-title" class="display text-2xl">Mettre à jour le statut</h2>
    <p class="mt-1 text-sm text-slate-500">${esc(p.tracking)} · actuellement ${STATUSES[p.status]?.label || ''}</p>
    <form data-form="status" data-id="${esc(p.tracking)}" class="mt-5 space-y-3">
      <div><label class="label" for="st-status">Nouveau statut</label>
        <select id="st-status" name="status" class="input">${STATUS_ORDER.map((k) => `<option value="${k}" ${k === next ? 'selected' : ''}>${STATUSES[k].label}</option>`).join('')}</select></div>
      <div><label class="label" for="st-comment">Message pour le client (facultatif)</label><textarea id="st-comment" name="comment" rows="3" class="input" placeholder="Ex. Vol ET-xxx parti ce matin"></textarea></div>
      <button class="btn btn-primary w-full">${icon('bell', 16)} Confirmer et notifier le client</button>
    </form>`);
}
function submitStatus(f) {
  const ps = Data.parcels();
  const p = ps.find((x) => x.tracking === f.dataset.id);
  if (!p) return;
  const status = f.status.value;
  const comment = f.comment.value.trim();
  p.status = status;
  p.statusHistory = [...(p.statusHistory || []), { status, date: nowIso(), comment: comment || STATUSES[status].label }];
  let earned = 0;
  if (status === 'DELIVERED' && !p.loyaltyPointsAwarded) {
    const users = Data.users();
    const u = users.find((x) => x.id === p.clientId);
    earned = Math.round((Number(p.weight) || 0) * (Number(Data.settings().loyaltyPointsPerKg) || 0));
    if (u && earned) { u.points = (Number(u.points) || 0) + earned; Data.saveUsers(users); }
    p.loyaltyPointsAwarded = earned || true;
  }
  if (!Data.saveParcels(ps)) return;
  notify(p.clientId, `Mise à jour · ${STATUSES[status].label}`, `Votre colis ${p.tracking} : ${comment || STATUSES[status].label}.${earned ? ` ${plural(earned, 'point')} fidélité ajouté${earned >= 2 ? 's' : ''}.` : ''}`);
  closeModal();
  render();
  toast(earned ? `Statut mis à jour · ${plural(earned, 'point')} crédité${earned >= 2 ? 's' : ''}.` : 'Statut mis à jour et client notifié.');
}

function paymentReviewModal(tracking) {
  const p = Data.parcels().find((x) => x.tracking === tracking);
  if (!p) return;
  const pay = paymentStatus(p);
  modal(`
    <h2 id="modal-title" class="display text-2xl">Paiement du colis</h2>
    <p class="mt-1 text-sm text-slate-500">${esc(p.tracking)} · ${usd(price(p))}</p>
    <div class="mt-4">${paymentBadge(p)}</div>
    ${pay === 'PENDING' ? `<div class="mt-4 space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
        <div><span class="text-slate-500">Mode :</span> <b>${esc(payMethodLabel(p.payment?.method))}</b></div>
        <div><span class="text-slate-500">Référence :</span> <b class="font-mono">${esc(p.payment?.reference || '—')}</b></div>
        <div><span class="text-slate-500">Déclaré le :</span> ${formatDate(p.payment?.declaredAt)}</div>
      </div>
      <p class="mt-3 text-xs text-slate-500">Vérifiez la référence dans votre historique Mobile Money avant de confirmer.</p>
      <div class="mt-5 grid grid-cols-2 gap-3">
        <button type="button" data-action="payment-reject" data-id="${esc(p.tracking)}" class="btn btn-outline">Introuvable</button>
        <button type="button" data-action="payment-confirm" data-id="${esc(p.tracking)}" class="btn btn-primary">${icon('check', 16)} Confirmer</button>
      </div>`
    : pay === 'PAID' ? `<p class="mt-4 text-sm text-slate-600">Payé${p.payment?.confirmedAt ? ` le ${formatDate(p.payment.confirmedAt)}` : ''}${p.payment?.method ? ` · ${esc(payMethodLabel(p.payment.method))}` : ''}${p.payment?.reference ? ` · réf. ${esc(p.payment.reference)}` : ''}.</p>
      <button type="button" data-action="payment-reject" data-id="${esc(p.tracking)}" class="btn btn-outline mt-5 w-full">Annuler le paiement</button>`
    : `<form data-form="mark-paid" data-id="${esc(p.tracking)}" class="mt-5 space-y-3">
        <div><label class="label" for="mp-method">Mode de paiement</label><select id="mp-method" name="method" class="input">${PAY_METHODS.map((m) => `<option value="${m.id}" ${m.id === 'cash' ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
        <div><label class="label" for="mp-ref">Référence (facultatif)</label><input id="mp-ref" name="reference" class="input"></div>
        <button class="btn btn-primary w-full">${icon('check', 16)} Marquer comme payé</button>
      </form>`}`);
}
function setPayment(tracking, confirmed, extra = {}) {
  const ps = Data.parcels();
  const p = ps.find((x) => x.tracking === tracking);
  if (!p) return;
  if (confirmed) {
    p.paymentStatus = 'PAID';
    p.payment = { ...(p.payment || {}), ...extra, confirmedAt: nowIso() };
  } else {
    p.paymentStatus = 'UNPAID';
    p.payment = { ...(p.payment || {}), rejectedAt: nowIso() };
  }
  if (!Data.saveParcels(ps)) return;
  notify(p.clientId, confirmed ? 'Paiement confirmé ✅' : 'Paiement non retrouvé',
    confirmed ? `Nous avons bien reçu votre paiement de ${usd(price(p))} pour le colis ${p.tracking}. Merci !` : `Nous n’avons pas retrouvé votre paiement pour le colis ${p.tracking}. Contactez-nous sur WhatsApp.`);
  closeModal();
  render();
  toast(confirmed ? 'Paiement confirmé, client notifié.' : 'Paiement remis « à payer », client notifié.', confirmed ? 'success' : 'info');
}

function photoModal(tracking) {
  const p = Data.parcels().find((x) => x.tracking === tracking);
  if (!p) return;
  modal(`
    <h2 id="modal-title" class="display text-2xl">Photo de réception</h2>
    <p class="mt-1 text-sm text-slate-500">${esc(p.tracking)}</p>
    ${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="Photo actuelle du colis" class="mt-4 max-h-56 w-full rounded-xl object-cover">` : ''}
    <form data-form="photo" data-id="${esc(p.tracking)}" class="mt-5 space-y-3">
      <div><label class="label" for="ph-file">Importer une photo</label><input id="ph-file" type="file" name="file" accept="image/*" capture="environment" class="input !py-2.5"><span class="help">La photo est automatiquement réduite pour tenir dans le navigateur.</span></div>
      <div class="text-center text-xs text-slate-400">ou</div>
      <div><label class="label" for="ph-url">Adresse web de la photo</label><input id="ph-url" type="url" name="url" class="input" placeholder="https://…" value="${p.photoUrl?.startsWith('http') ? esc(p.photoUrl) : ''}"></div>
      <button class="btn btn-primary w-full">Enregistrer la photo</button>
      ${p.photoUrl ? `<button type="button" data-action="photo-remove" data-id="${esc(p.tracking)}" class="btn btn-danger w-full">${icon('trash-2', 16)} Supprimer la photo</button>` : ''}
    </form>`);
}
function compressImage(file, maxSize = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}
async function submitPhoto(f) {
  const file = f.file.files[0];
  const url = f.url.value.trim();
  let photoUrl;
  if (file) {
    try { photoUrl = await compressImage(file); } catch { return toast('Impossible de lire cette image.', 'error'); }
  } else if (/^https?:\/\//i.test(url)) photoUrl = url;
  else return toast('Choisissez une photo ou une adresse web commençant par https://', 'error');
  setPhoto(f.dataset.id, photoUrl);
}
function setPhoto(tracking, photoUrl) {
  const ps = Data.parcels();
  const p = ps.find((x) => x.tracking === tracking);
  if (!p) return;
  p.photoUrl = photoUrl;
  if (!Data.saveParcels(ps)) return;
  closeModal();
  render();
  toast(photoUrl ? 'Photo enregistrée.' : 'Photo supprimée.', photoUrl ? 'success' : 'info');
}

function adminSettingsTab() {
  const s = Data.settings();
  const field = (name, label, attrs = '', help = '') => `<div><label class="label" for="set-${name}">${label}</label><input id="set-${name}" name="${name}" class="input" value="${esc(s[name])}" ${attrs}>${help ? `<span class="help">${help}</span>` : ''}</div>`;
  const area = (name, label, help = '', lang = '') => `<div><label class="label" for="set-${name}">${label}</label><textarea id="set-${name}" name="${name}" rows="4" class="input" ${lang ? `lang="${lang}"` : ''}>${esc(s[name])}</textarea>${help ? `<span class="help">${help}</span>` : ''}</div>`;
  const group = (title, ic, content) => `<fieldset class="card p-5 sm:p-6"><legend class="sr-only">${title}</legend><div class="mb-5 flex items-center gap-3"><span class="icon-tile !h-10 !w-10">${icon(ic, 18)}</span><h2 class="font-display text-lg font-bold">${title}</h2></div><div class="grid gap-4 md:grid-cols-2">${content}</div></fieldset>`;
  return `<form data-form="settings" class="space-y-5">
    ${group('Tarifs et délais', 'badge-dollar-sign', `
      ${field('ratePerKg', 'Tarif transport ($/kg)', 'type="number" min="0" step="0.01" required', 'Les colis déjà enregistrés gardent leur tarif.')}
      ${field('transitTime', 'Délai moyen de livraison', 'placeholder="Ex. 7 à 14 jours"', 'Affiché dans le simulateur et la FAQ.')}`)}
    ${group('Coordonnées', 'phone', `
      ${field('contactPhone', 'WhatsApp / téléphone RDC', 'type="tel" required')}
      ${field('contactEmail', 'E-mail de contact', 'type="email"')}
      <div class="md:col-span-2">${area('pickupPoints', 'Points de retrait en RDC', 'Une ligne par point de retrait (ville, adresse…).')}</div>`)}
    ${group('Entrepôt à Guangzhou', 'warehouse', `
      ${area('address', 'Adresse en français', 'Une ligne par information : rue, ville, code postal, téléphone…')}
      ${area('addressZh', 'Adresse en chinois (中文)', 'Pour les vendeurs et livreurs chinois.', 'zh')}`)}
    ${group('Paiement Mobile Money', 'wallet', `
      ${field('paymentName', 'Nom du compte bénéficiaire')}
      ${field('mpesa', 'Numéro M-Pesa', 'type="tel"')}
      ${field('orangeMoney', 'Numéro Orange Money', 'type="tel"')}
      ${field('airtelMoney', 'Numéro Airtel Money', 'type="tel"')}`)}
    ${group('Programme de fidélité', 'award', `
      ${field('loyaltyPointsPerKg', 'Points gagnés par kilo livré', 'type="number" min="0" step="0.1" required')}
      ${field('loyaltyThreshold', 'Points pour une récompense', 'type="number" min="1" step="1" required')}
      ${field('loyaltyRewardKg', 'Kilos offerts par récompense', 'type="number" min="0" step="0.5" required', `Avec les valeurs actuelles, la remise équivaut à ${num(((Number(s.loyaltyRewardKg) || 0) * (Number(s.loyaltyPointsPerKg) || 0) * 100) / Math.max(1, Number(s.loyaltyThreshold) || 1))} % du poids expédié.`)}`)}
    <div class="flex justify-end"><button class="btn btn-primary">${icon('check', 16)} Enregistrer les paramètres</button></div>
  </form>
  <div class="mt-8 grid gap-5 md:grid-cols-2">
    <div class="card p-5 sm:p-6">
      <div class="flex items-center gap-3"><span class="icon-tile !h-10 !w-10">${icon('database', 18)}</span><h2 class="font-display text-lg font-bold">Sauvegarde des données</h2></div>
      <p class="mt-3 text-sm text-slate-600">Les données sont enregistrées dans ce navigateur uniquement. Exportez une sauvegarde régulièrement.</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" data-action="backup-export" class="btn btn-primary btn-sm">${icon('download', 15)} Exporter</button>
        <button type="button" data-action="backup-import" class="btn btn-outline btn-sm">${icon('upload', 15)} Importer</button>
        <input type="file" id="backup-file" accept="application/json,.json" class="hidden" data-live="backup-file">
      </div>
    </div>
    <div class="card p-5 sm:p-6">
      <div class="flex items-center gap-3"><span class="icon-tile !h-10 !w-10">${icon('key-round', 18)}</span><h2 class="font-display text-lg font-bold">Accès administrateur</h2></div>
      <p class="mt-3 text-sm text-slate-600">Changez le mot de passe de l’espace gestionnaire sur cet appareil.</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" data-action="change-admin-pass" class="btn btn-outline btn-sm">Modifier le mot de passe</button>
        <button type="button" data-action="admin-logout" class="btn btn-danger btn-sm">${icon('log-out', 15)} Se déconnecter</button>
      </div>
    </div>
  </div>`;
}
function submitSettings(f) {
  const d = Object.fromEntries(new FormData(f));
  const before = Data.settings();
  const s = { ...before };
  ['contactPhone', 'contactEmail', 'transitTime', 'paymentName', 'mpesa', 'orangeMoney', 'airtelMoney'].forEach((k) => { s[k] = String(d[k] || '').trim(); });
  ['address', 'addressZh', 'pickupPoints'].forEach((k) => { s[k] = String(d[k] || '').trim(); });
  s.ratePerKg = Math.max(0, Number(d.ratePerKg) || 0);
  s.loyaltyPointsPerKg = Math.max(0, Number(d.loyaltyPointsPerKg) || 0);
  s.loyaltyThreshold = Math.max(1, Math.round(Number(d.loyaltyThreshold) || 1));
  s.loyaltyRewardKg = Math.max(0, Number(d.loyaltyRewardKg) || 0);
  if (s.ratePerKg !== before.ratePerKg) {
    // Les colis enregistrés avant le changement gardent l'ancien tarif.
    const ps = Data.parcels();
    ps.forEach((p) => { if (p.ratePerKg === undefined) p.ratePerKg = before.ratePerKg; });
    Data.saveParcels(ps);
  }
  if (!Data.saveSettings(s)) return;
  render();
  toast('Paramètres enregistrés.');
}

function changeAdminPassModal() {
  modal(`
    <h2 id="modal-title" class="display text-2xl">Changer le mot de passe</h2>
    <form data-form="admin-pass" class="mt-5 space-y-3">
      <div><label class="label" for="ap-old">Mot de passe actuel</label><input id="ap-old" name="old" type="password" class="input" autocomplete="current-password" required></div>
      <div><label class="label" for="ap-new">Nouveau mot de passe</label><input id="ap-new" name="pass" type="password" minlength="8" class="input" autocomplete="new-password" required><span class="help">8 caractères minimum.</span></div>
      <div><label class="label" for="ap-confirm">Confirmer</label><input id="ap-confirm" name="confirm" type="password" minlength="8" class="input" autocomplete="new-password" required></div>
      <button class="btn btn-primary w-full">Mettre à jour</button>
    </form>`);
}
async function submitAdminPass(f) {
  if (!(await checkCredential(adminCredential(), f.old.value))) return toast('Mot de passe actuel incorrect.', 'error');
  if (f.pass.value !== f.confirm.value) return toast('Les deux mots de passe ne correspondent pas.', 'error');
  store.set('admin_hash', await makeCredential(f.pass.value));
  store.remove('admin_pass');
  closeModal();
  toast('Mot de passe modifié.');
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

function exportCSV() {
  const users = Data.users();
  const rows = [['Suivi', 'Référence client', 'Nom client', 'Téléphone', 'Description', 'Poids kg', 'Tarif $/kg', 'Statut', 'Transport $', 'Regroupement $', 'Douane $', 'Total $', 'Paiement', 'Mode', 'Référence paiement']];
  Data.parcels().forEach((p) => {
    const u = users.find((x) => x.id === p.clientId);
    rows.push([p.tracking, p.clientId, u ? `${u.firstname} ${u.name}` : '', u?.phone || '', p.description, p.weight, parcelRate(p), STATUSES[p.status]?.label || p.status,
      transportCost(p).toFixed(2), consolidationCost(p).toFixed(2), customsCost(p).toFixed(2), price(p).toFixed(2), PAYMENT_STATUSES[paymentStatus(p)].label, payMethodLabel(p.payment?.method), p.payment?.reference || '']);
  });
  const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
  download(`directline-colis-${today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}
function exportBackup() {
  const data = { app: 'directline-rdc', version: 2, exportedAt: nowIso(), settings: Data.settings(), users: Data.users(), parcels: Data.parcels(), notifications: Data.notifications() };
  download(`directline-sauvegarde-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Sauvegarde exportée.');
}
async function importBackup(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Fichier de sauvegarde illisible.', 'error'); }
  if (data?.app !== 'directline-rdc' || !Array.isArray(data.users) || !Array.isArray(data.parcels)) return toast('Ce fichier n’est pas une sauvegarde Directline.', 'error');
  if (!confirm(`Remplacer les données actuelles par la sauvegarde du ${formatDate(data.exportedAt)} ?\n${data.users.length} clients · ${data.parcels.length} colis`)) return;
  const ok = Data.saveSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) }) && Data.saveUsers(data.users) && Data.saveParcels(data.parcels) && Data.saveNotifications(Array.isArray(data.notifications) ? data.notifications : []);
  if (ok) { render(); toast('Sauvegarde restaurée.'); }
}

/* ================================================================
   Routage et événements
   ================================================================ */
const PAGES = {
  accueil: [homePage, 'Directline RDC — De la Chine à la RDC, directement chez vous'],
  services: [servicesPage, 'Nos services'],
  tarifs: [tarifsPage, 'Tarifs et simulateur'],
  suivi: [trackingPage, 'Suivi de colis'],
  faq: [faqPage, 'Questions fréquentes'],
  achat: [purchasePage, 'Demande d’achat'],
  espace: [dashboardPage, 'Mon espace client'],
  adresse: [addressPage, 'Mon adresse en Chine'],
  notifications: [notificationsPage, 'Notifications'],
  admin: [adminPage, 'Administration'],
};
function notFoundPage() {
  return `<section class="container-page py-24 text-center"><h1 class="display text-4xl">Page introuvable</h1><p class="mt-3 text-slate-600">Cette page n’existe pas ou a été déplacée.</p><a href="#/" class="btn btn-primary mt-6">Retour à l’accueil</a></section>`;
}

let currentRoute = { name: 'accueil', param: '' };
function parseRoute() {
  const hash = location.hash;
  if (hash && hash !== '#' && !hash.startsWith('#/')) return currentRoute; // ancre interne (ex. lien d'évitement)
  const [name = '', ...rest] = hash.replace(/^#\/?/, '').split('/');
  let param = rest.join('/');
  try { param = decodeURIComponent(param); } catch { /* paramètre mal encodé : laissé tel quel */ }
  return { name: name || 'accueil', param };
}
function go(path) {
  const target = '#/' + path;
  if (location.hash === target || (!path && (location.hash === '' || location.hash === '#/'))) render();
  else location.hash = target;
}
function render() {
  currentRoute = parseRoute();
  const [page, title] = PAGES[currentRoute.name] || [notFoundPage, 'Page introuvable'];
  const onAdmin = currentRoute.name === 'admin';
  $('#app').innerHTML = header(currentRoute) + `<main id="main" tabindex="-1" class="outline-none">${page(currentRoute.param)}</main>` + footer() + (onAdmin ? '' : whatsappButton());
  document.title = currentRoute.name === 'accueil' ? title : `${title} · Directline RDC`;
}

const ACTIONS = {
  backdrop: (el, e) => { if (e.target === el) closeModal(); },
  'close-modal': closeModal,
  'toggle-menu': (el) => {
    const menu = $('#mobile-menu');
    menu.classList.toggle('hidden');
    el.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
  },
  'open-login': () => authModal('login'),
  'open-register': () => authModal('register'),
  logout,
  'admin-logout': adminLogout,
  'toggle-password': (el) => {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.innerHTML = icon(show ? 'eye-off' : 'eye', 18);
    el.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  },
  copy: (el) => copyText(el.dataset.copy, 'Référence copiée.'),
  'copy-address': (el) => copyText(addressText(currentUser(), el.dataset.lang), el.dataset.lang === 'zh' ? '地址已复制 · Adresse copiée.' : 'Adresse copiée.'),
  'share-tracking': (el) => copyText(`${location.href.split('#')[0]}#/suivi/${encodeURIComponent(el.dataset.id)}`, 'Lien de suivi copié.'),
  'sim-step': (el) => {
    const root = el.closest('[data-sim]');
    const input = $('[data-live=sim]', root);
    const value = Math.max(0, Math.round(((Number(input.value) || 0) + Number(el.dataset.step)) * 10) / 10);
    input.value = value;
    updateSimulator(root, value);
  },
  invoice: (el) => invoiceFor(el.dataset.id),
  pay: (el) => paymentModal(el.dataset.id),
  'parcel-new': (el) => parcelModal(null, el.dataset.client),
  'parcel-edit': (el) => parcelModal(el.dataset.id),
  'parcel-status': (el) => statusModal(el.dataset.id),
  'parcel-photo': (el) => photoModal(el.dataset.id),
  'parcel-delete': (el) => deleteParcel(el.dataset.id),
  'photo-remove': (el) => setPhoto(el.dataset.id, ''),
  'payment-review': (el) => paymentReviewModal(el.dataset.id),
  'payment-confirm': (el) => setPayment(el.dataset.id, true),
  'payment-reject': (el) => setPayment(el.dataset.id, false),
  'client-new': () => clientModal(),
  'client-edit': (el) => clientModal(el.dataset.id),
  'loyalty-notify': (el) => notifyLoyalty(el.dataset.id),
  'loyalty-redeem': (el) => redeemLoyalty(el.dataset.id),
  'export-csv': exportCSV,
  'backup-export': exportBackup,
  'backup-import': () => $('#backup-file')?.click(),
  'change-admin-pass': changeAdminPassModal,
};

const FORMS = {
  track: (f) => {
    const ref = f.tracking.value.trim().toUpperCase();
    if (ref) go('suivi/' + encodeURIComponent(ref));
  },
  login: submitLogin,
  register: submitRegister,
  purchase: submitPurchase,
  payment: submitPayment,
  'admin-setup': submitAdminSetup,
  'admin-login': submitAdminLogin,
  'admin-pass': submitAdminPass,
  parcel: submitParcel,
  status: submitStatus,
  photo: submitPhoto,
  client: submitClient,
  settings: submitSettings,
  'mark-paid': (f) => setPayment(f.dataset.id, true, { method: f.method.value, reference: f.reference.value.trim() }),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  if (el.dataset.action !== 'backdrop') e.preventDefault();
  fn(el, e);
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const button = f.querySelector('button:not([type=button])');
  if (button) button.disabled = true;
  try { await FORMS[f.dataset.form]?.(f); } finally { if (button?.isConnected) button.disabled = false; }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const live = el.dataset?.live;
  if (live === 'sim') updateSimulator(el.closest('[data-sim]'), el.value);
  else if (live === 'sim-range') { const root = el.closest('[data-sim]'); $('[data-live=sim]', root).value = el.value; updateSimulator(root, el.value); }
  else if (live === 'admin-query') { adminQuery = el.value; $('#admin-parcels').innerHTML = adminParcelList(); }
  else if (live === 'client-query') {
    clientQuery = el.value;
    const holder = document.createElement('div');
    holder.innerHTML = adminClientsTab();
    $('#admin-clients').replaceWith(holder.querySelector('#admin-clients'));
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const live = el.dataset?.live;
  if (live === 'admin-status') { adminStatus = el.value; $('#admin-parcels').innerHTML = adminParcelList(); }
  else if (live === 'admin-payment') { adminPayment = el.value; $('#admin-parcels').innerHTML = adminParcelList(); }
  else if (live === 'pay-method') updatePayInstructions(el.form);
  else if (live === 'backup-file') importBackup(el);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#modal-root').innerHTML) closeModal();
  else $('#mobile-menu')?.classList.add('hidden');
});

window.addEventListener('hashchange', () => {
  if (location.hash && location.hash !== '#' && !location.hash.startsWith('#/')) return;
  closeModal();
  render();
  window.scrollTo({ top: 0 });
  $('#main')?.focus({ preventScroll: true });
});

// Données modifiées dans un autre onglet : on relit tout.
window.addEventListener('storage', (e) => {
  if (e.key && !e.key.startsWith('dl_')) return;
  cache.clear();
  sessionUserId = store.get('session_user_id', null);
  if (!$('#modal-root').innerHTML) render();
});

render();
