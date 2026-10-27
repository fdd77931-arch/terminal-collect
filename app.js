/* ==================================================================
   终端数据填报 · 单页应用
   数据源：terminals.js（321 家终端主数据）
   存储：本机 localStorage / 可选 Supabase（共享收集）
   ================================================================== */
'use strict';

/* ---------------- 0. 默认配置（可在页面“设置”里改） ---------------- */
const DEF_TYPES = [
  '核苷(酸)类似物单药经治',
  '核苷(酸)类似物联合经治',
  '干扰素经治',
  '口服药 + 干扰素经治',
  '耐药 / 应答不佳',
  '其他'
];
const DEF_TESTS = [
  'HBV DNA',
  'HBsAg 定量',
  '肝功能',
  '肝弹性 / FibroScan',
  'AFP / 肝脏超声',
  '耐药位点检测'
];
const DEFAULT_CFG = {
  period: '',            // 空 = 跟随当前月份；也可写 2026-10
  reporter: '',
  storage: 'local',       // local | supabase
  sbUrl: '',
  sbKey: '',
  types: DEF_TYPES.slice(),
  tests: DEF_TESTS.slice()
};

const K_CFG = 'tf.cfg.v1';
const K_SUB = 'tf.subs.v1';
const K_DRAFT = 'tf.draft.';

/* ---------------- 1. 工具 ---------------- */
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const fmt = v => isNum(v) ? Number(v).toLocaleString('en-US') : '—';
const fmt1 = v => isNum(v) ? Number(v).toFixed(1) : '—';
const pct = v => isNum(v) ? (v * 100).toFixed(1) + '%' : '—';
const median = a => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y), m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const uniq = a => Array.from(new Set(a));
const sum = (a, f) => a.reduce((s, x) => s + (isNum(f(x)) ? f(x) : 0), 0);

/* ---------- 周期 ---------- */
function curPeriod() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function normPeriod(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/年]?(\d{1,2})月?$/);
  if (m) return m[1] + '-' + String(+m[2]).padStart(2, '0');
  m = s.match(/^(\d{1,2})月$/);
  if (m) return new Date().getFullYear() + '-' + String(+m[1]).padStart(2, '0');
  return s;
}
function shareLink() {
  const base = (location.origin && location.origin !== 'null')
    ? location.origin + location.pathname
    : 'https://fdd77931-arch.github.io/terminal-collect/';
  return base + '?p=' + encodeURIComponent(PERIOD);
}
function pLabel(p) {
  const m = String(p || '').match(/^(\d{4})-(\d{2})$/);
  return m ? (m[1] + '年' + (+m[2]) + '月') : (p || '未标周期');
}

let _toastT = null;
function toast(msg, type) {
  const t = byId('toast');
  t.textContent = msg;
  t.className = 'show' + (type === 'err' ? ' err' : '');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.className = ''; }, 2600);
}
function download(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ---------------- 2. 状态 ---------------- */
const K_CUSTOM = 'tf.custom.v1';
const K_LOG = 'tf.log.v1';

function loadCustom() {
  try { return JSON.parse(localStorage.getItem(K_CUSTOM) || '[]') || []; } catch (e) { return []; }
}
function saveCustom() {
  try { localStorage.setItem(K_CUSTOM, JSON.stringify(CUSTOM)); } catch (e) { toast('自定义终端保存失败', 'err'); }
}
const CUSTOM = loadCustom();
// 把自定义终端并进主数据（id 以 C 开头，方便区分）
CUSTOM.forEach(c => {
  if (!c || !c.n) return;
  if (TERMINALS.some(t => t.id === c.id)) return;
  TERMINALS.push({ id: c.id, r: c.r || '未分配', p: c.p || '', c: c.c || '', n: c.n, t: c.t || '', s: c.s || '', pot: c.pot === undefined ? null : c.pot });
});

const T_BY_ID = {};
TERMINALS.forEach(t => { T_BY_ID[t.id] = t; });

// 名称归一：全半角、括号、空格、标点都抹掉，用于查重和搜索
function normName(v) {
  return String(v || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，,。.、·•\-—_/\\|:：;；'"“”‘’]/g, '')
    .toLowerCase();
}
function findByName(name) {
  const k = normName(name);
  if (!k) return null;
  return TERMINALS.find(t => normName(t.n) === k) || null;
}
function nextCustomId() {
  let n = 1;
  while (TERMINALS.some(t => t.id === 'C' + String(n).padStart(3, '0'))) n++;
  return 'C' + String(n).padStart(3, '0');
}
function addCustom(list) {
  let added = 0, dup = 0;
  list.forEach(it => {
    if (!it || !it.n) return;
    if (findByName(it.n)) { dup++; return; }
    const id = nextCustomId();
    const rec = { id: id, r: it.r || '未分配', p: it.p || '', c: it.c || '', n: it.n, t: it.t || '', s: it.s || '', pot: it.pot };
    CUSTOM.push(rec);
    TERMINALS.push({ id: rec.id, r: rec.r, p: rec.p, c: rec.c, n: rec.n, t: rec.t, s: rec.s, pot: rec.pot });
    T_BY_ID[id] = TERMINALS[TERMINALS.length - 1];
    added++;
  });
  saveCustom();
  return { added: added, dup: dup };
}
function removeCustom(id) {
  const i = CUSTOM.findIndex(c => c.id === id);
  if (i >= 0) CUSTOM.splice(i, 1);
  const j = TERMINALS.findIndex(t => t.id === id);
  if (j >= 0) TERMINALS.splice(j, 1);
  delete T_BY_ID[id];
  delete SUBS[id];
  persistSubs();
  saveCustom();
}

/* ---------- 提交日志（本机留痕；云端另有一份完整历史） ---------- */
function loadLog() {
  try { return JSON.parse(localStorage.getItem(K_LOG) || '[]') || []; } catch (e) { return []; }
}
function pushLog(rec) {
  const log = loadLog();
  log.unshift({ id: rec.id, name: rec.name, reporter: rec.reporter, ts: rec.ts, h: rec.h, i: rec.i, pot: rec.pot });
  try { localStorage.setItem(K_LOG, JSON.stringify(log.slice(0, 800))); } catch (e) { }
}

let CFG = loadCfg();
let PERIOD = '';          // 本次填报周期，boot 时确定
let PERIOD_SRC = '';      // url | cfg | auto
let RP = '';              // 报告当前查看的周期
let SUBS = loadSubs();
let FO = null;
let REMOTE = null;        // 云端拉下来的报告数据（按终端取最新）
let REMOTE_RAW = null;    // 云端原始提交行（用于留痕）
let LAST_INFO = null;     // 云端提交次数等
let F = { region: '', province: '', q: '', onlyTodo: false, onlyMine: false };
let listLimit = 60;

function loadCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(K_CFG) || '{}') || {}; } catch (e) { c = {}; }
  if (c && c.period === '9月') c.period = '2026-09';   // 旧版本迁移
  const out = Object.assign({}, DEFAULT_CFG, c);
  out.period = normPeriod(out.period);
  if (!Array.isArray(out.types) || !out.types.length) out.types = DEF_TYPES.slice();
  if (!Array.isArray(out.tests) || !out.tests.length) out.tests = DEF_TESTS.slice();
  return out;
}
function saveCfg() {
  try { localStorage.setItem(K_CFG, JSON.stringify(CFG)); } catch (e) { toast('配置保存失败', 'err'); }
}
function loadSubs() {
  try { return JSON.parse(localStorage.getItem(K_SUB) || '{}') || {}; } catch (e) { return {}; }
}
function persistSubs() {
  try { localStorage.setItem(K_SUB, JSON.stringify(SUBS)); }
  catch (e) { toast('本机存储写入失败（可能已满），请先导出备份', 'err'); }
}
function loadDraft(id) {
  try { return JSON.parse(localStorage.getItem(K_DRAFT + id) || 'null'); } catch (e) { return null; }
}
function saveDraft() {
  if (!FO) return;
  try { localStorage.setItem(K_DRAFT + FO.id, JSON.stringify(FO)); } catch (e) { /* ignore */ }
}
function clearDraft(id) { try { localStorage.removeItem(K_DRAFT + id); } catch (e) { } }
let _draftT = null;
function scheduleDraft() { clearTimeout(_draftT); _draftT = setTimeout(saveDraft, 450); }

/* ---------------- 3. 云端（Supabase） ---------------- */
function sbBase() { return (CFG.sbUrl || '').replace(/\/+$/, ''); }
async function sbReq(path, opts) {
  opts = opts || {};
  if (!sbBase() || !CFG.sbKey) throw new Error('未配置 Supabase 地址或 Key');
  const hdrs = { apikey: CFG.sbKey, 'Content-Type': 'application/json' };
  // 老版 anon key 是 JWT（eyJ 开头），需要同时放 Authorization；
  // 新版 sb_publishable_ 开头的 key 只放 apikey 就行，带错 Bearer 反而会被拒
  if (String(CFG.sbKey).indexOf('eyJ') === 0) hdrs.Authorization = 'Bearer ' + CFG.sbKey;
  const res = await fetch(sbBase() + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign(hdrs, opts.headers || {})
  }));
  if (!res.ok) {
    let txt = '';
    try { txt = await res.text(); } catch (e) { }
    throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 140));
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(16).slice(2, 10);
}
// 只写不读：任何人提交都只是往表里追加一行
async function sbPush(rec) {
  await sbReq('submissions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: uuid(), terminal_id: rec.id, payload: rec, created_at: new Date().toISOString()
    })
  });
}
function sbHint(e) {
  const m = String((e && e.message) || e || '');
  if (m.indexOf('401') >= 0 || m.indexOf('403') >= 0) return 'anon key 不对，去 Supabase 的 API 页面重新复制一次';
  if (m.indexOf('404') >= 0) return '地址不对，或者 SQL 还没跑（找不到表/函数）';
  if (m.indexOf('Failed to fetch') >= 0 || m.indexOf('NetworkError') >= 0) return '连不上，检查地址有没有写错、网络是否正常';
  if (m.indexOf('bad passcode') >= 0) return '口令不对';
  return m;
}
async function sbPing() {
  await sbReq('rpc/ping', { method: 'POST', body: '{}' });
  return true;
}
// 管理员口令读取：走 SECURITY DEFINER 函数，anon 对表没有 select 权限
async function sbPull(pass) {
  const rows = await sbReq('rpc/report_rows', { method: 'POST', body: JSON.stringify({ pass: pass }) });
  const list = Array.isArray(rows) ? rows : [];
  const map = {};
  list.forEach(r => {
    const p = r && (r.payload !== undefined ? r.payload : r);
    if (!p || !p.id || !T_BY_ID[p.id]) return;
    const cur = map[p.id];
    if (!cur || !cur.ts || !p.ts || p.ts >= cur.ts) map[p.id] = p;
  });
  REMOTE = map;
  REMOTE_RAW = list.map(r => (r && r.payload !== undefined ? r.payload : r)).filter(p => p && p.id);
  return { rows: list.length, terminals: Object.keys(map).length };
}

/* ---------------- 4. 路由 ---------------- */
function go(hash) { location.hash = hash; }

function route() {
  const raw = (location.hash || '#/fill').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const v = parts[0] || 'fill';
  document.body.classList.toggle('form-open', v === 'form');
  if (v === 'form' && parts[1]) viewForm(parts[1]);
  else if (v === 'report') viewReport();
  else if (v === 'settings') viewSettings();
  else viewFill();
}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (t) { go(t.getAttribute('data-go')); }
});

/* ---------------- 5. 通用渲染件 ---------------- */
function topbar(title, back) {
  return '<div class="topbar">' +
    (back ? '<button class="back" data-go="' + back + '">‹ 返回</button>' : '') +
    '<div class="ttl">' + esc(title) + '</div></div>';
}
function tabbar(active) {
  const items = [
    { k: 'fill', h: '#/fill', ic: '▤', lb: '填报' },
    { k: 'report', h: '#/report', ic: '◔', lb: '报告' },
    { k: 'settings', h: '#/settings', ic: '⚙', lb: '设置' }
  ];
  byId('tabbar').innerHTML = items.map(i =>
    '<button data-go="' + i.h + '" class="' + (active === i.k ? 'on' : '') + '"><span class="ic">' + i.ic + '</span>' + i.lb + '</button>'
  ).join('');
}
function bars(items, maxOverride) {
  const max = maxOverride || Math.max.apply(null, items.map(i => i.v).concat([0.000001]));
  return '<div class="bars">' + items.map(i => {
    const w = Math.max(2, Math.min(100, i.v / max * 100));
    const col = i.color ? 'background:' + i.color + ';' : '';
    return '<div class="bar-row"><div class="lb" title="' + esc(i.lb) + '">' + esc(i.lb) + '</div>' +
      '<div class="tr"><i style="width:' + w.toFixed(1) + '%;' + col + '"></i></div>' +
      '<div class="vv">' + esc(i.txt) + '</div></div>';
  }).join('') + '</div>';
}
function doneCount() { return Object.keys(SUBS).filter(id => T_BY_ID[id]).length; }

/* ---------------- 6. 填报首页 ---------------- */
function filteredTerminals() {
  const q = F.q.trim().toLowerCase();
  return TERMINALS.filter(t => {
    if (F.region && t.r !== F.region) return false;
    if (F.province && t.p !== F.province) return false;
    if (F.onlyTodo && SUBS[t.id]) return false;
    if (F.onlyMine) {
      const s = SUBS[t.id];
      if (!s || (s.reporter || '') !== (CFG.reporter || '\u0000')) return false;
    }
    if (q) {
      const hay = (t.n + ' ' + t.p + ' ' + t.c + ' ' + t.r).toLowerCase();
      if (hay.indexOf(q) < 0) {
        const nq = normName(F.q);
        if (!nq || normName(t.n).indexOf(nq) < 0) return false;
      }
    }
    return true;
  }).slice().sort((a, b) => (SUBS[a.id] ? 1 : 0) - (SUBS[b.id] ? 1 : 0));
}

function viewFill(keep) {
  tabbar('fill');
  const total = TERMINALS.length;
  const done = doneCount();
  const rate = total ? done / total : 0;

  const regions = uniq(TERMINALS.map(t => t.r));
  const regDone = {};
  regions.forEach(r => {
    const ts = TERMINALS.filter(t => t.r === r);
    regDone[r] = { n: ts.length, d: ts.filter(t => SUBS[t.id]).length };
  });

  const provSet = uniq(TERMINALS.filter(t => !F.region || t.r === F.region).map(t => t.p).filter(Boolean)).sort();

  const list = filteredTerminals();
  const shown = list.slice(0, listLimit);

  let html = '';
  html += '<div class="shell">';
  const cloud = CFG.storage === 'supabase';
  html += '<div class="hero">' +
    '<div class="k">TERMINAL DATA</div>' +
    '<h1>' + esc(pLabel(PERIOD)) + '终端数据填报</h1>' +
    '<div class="sub">共 ' + total + ' 家终端 · 找到你负责的，填完点提交</div>' +
    (cloud ? '' : '<div class="prog"><i style="width:' + (rate * 100).toFixed(1) + '%"></i></div>') +
    '<div class="prog-txt"><span>' + (cloud ? '我已提交 ' + done + ' 家' : '已提交 ' + done + ' / ' + total) + '</span><span>' + (cloud ? '提交后由管理员汇总' : pct(rate)) + '</span></div>' +
    '</div>';

  html += '<div class="search"><span class="ico">⌕</span><input id="q" type="search" placeholder="搜索医院 / 城市 / 省份" value="' + esc(F.q) + '"></div>';

  html += '<div class="chips">';
  const cnt = (a, b) => cloud ? '' : '<span class="n">' + a + '/' + b + '</span>';
  html += '<button class="chip ' + (!F.region ? 'on' : '') + '" data-r="">全部' + cnt(done, total) + '</button>';
  regions.forEach(r => {
    html += '<button class="chip ' + (F.region === r ? 'on' : '') + '" data-r="' + esc(r) + '">' +
      esc(r.replace(/^感染|区域$/g, '')) + cnt(regDone[r].d, regDone[r].n) + '</button>';
  });
  html += '</div>';

  html += '<div class="toggles">';
  html += '<select id="prov" class="tg" style="max-width:42%">' +
    '<option value="">全部省份</option>' +
    provSet.map(p => '<option value="' + esc(p) + '"' + (F.province === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('') +
    '</select>';
  html += '<button class="tg ' + (F.onlyTodo ? 'on' : '') + '" id="tg-todo">只看未填</button>';
  html += '<button class="tg ' + (F.onlyMine ? 'on' : '') + '" id="tg-mine">只看我填的</button>';
  html += '</div>';

  html += '<div id="listwrap">' + listBlock() + '</div>';
  html += '<div style="height:8px"></div></div>';
  byId('view').innerHTML = html;
  if (!keep) window.scrollTo(0, 0);

  const qi = byId('q');
  let composing = false;
  qi.addEventListener('compositionstart', () => { composing = true; });
  qi.addEventListener('compositionend', () => {
    composing = false;
    F.q = qi.value;
    listLimit = 60;
    scheduleList();
  });
  qi.addEventListener('input', e => {
    F.q = qi.value;
    if (composing || e.isComposing) return;   // 拼音还没选字，先不动列表
    listLimit = 60;
    scheduleList();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-r]'), b => {
    b.addEventListener('click', () => { F.region = b.getAttribute('data-r'); F.province = ''; viewFill(); });
  });
  byId('prov').addEventListener('change', e => { F.province = e.target.value; viewFill(); });
  byId('tg-todo').addEventListener('click', () => { F.onlyTodo = !F.onlyTodo; viewFill(); });
  byId('tg-mine').addEventListener('click', () => {
    if (!CFG.reporter) { toast('请先在“设置”里填你的名字'); go('#/settings'); return; }
    F.onlyMine = !F.onlyMine; viewFill();
  });
}

function listBlock() {
  const list = filteredTerminals();
  const shown = list.slice(0, listLimit);
  if (!shown.length) {
    return '<div class="card"><div class="empty">没有符合条件的终端<br><span style="font-size:12px">换个关键词，或清空筛选</span></div></div>';
  }
  let h = '<div class="list">';
  shown.forEach(t => {
    const s = SUBS[t.id];
    const meta = [t.p, t.c, t.t, t.s].filter(Boolean).join(' · ');
    const rt = s
      ? '<span class="badge done">已填</span>' + (isNum(s.h) || isNum(s.i) ? '<div class="num">初治 ' + fmt(s.h) + ' / 经治 ' + fmt(s.i) + '</div>' : '')
      : '<span class="badge">未填</span>';
    h += '<div class="row ' + (s ? 'done' : '') + '" data-go="#/form/' + t.id + '">' +
      '<div class="main"><div class="nm">' + esc(t.n) + '</div><div class="mt">' + esc(meta) + '</div></div>' +
      '<div class="rt">' + rt + '</div></div>';
  });
  h += '</div>';
  if (list.length > shown.length) {
    h += '<div style="margin-top:10px"><button class="more" id="more">还有 ' + (list.length - shown.length) + ' 家，点击显示更多</button></div>';
  }
  return h;
}

// 只重绘列表，不碰输入框 —— 否则中文输入法打拼音时会被打断
function paintList() {
  const w = byId('listwrap');
  if (!w) return;
  w.innerHTML = listBlock();
  const more = byId('more');
  if (more) more.addEventListener('click', () => { listLimit += 80; paintList(); });
}

let _listT = null;
function scheduleList() {
  clearTimeout(_listT);
  _listT = setTimeout(paintList, 120);
}

/* ---------------- 7. 填报页 ---------------- */
function openForm(id) {
  const t = T_BY_ID[id];
  if (!t) return;
  const sub = SUBS[id];
  const draft = loadDraft(id);
  const base = draft || sub || {};
  const pick = (a, b) => (a === undefined || a === null || a === '') ? (b === undefined || b === null ? '' : b) : a;
  FO = {
    id: id,
    pot: pick(base.pot, t.pot),
    h: pick(base.h, t.h),
    i: pick(base.i, t.i),
    ha: pick(base.ha, t.ha),
    ia: pick(base.ia, t.ia),
    noTreated: !!base.noTreated,
    types: Object.assign({}, base.types || {}),
    tests: JSON.parse(JSON.stringify(base.tests || {})),
    reporter: base.reporter || CFG.reporter || '',
    note: base.note || '',
    ver: sub ? (sub.ver || 1) : 0
  };
  // 统一补全检查项
  CFG.tests.forEach(n => { if (!FO.tests[n]) FO.tests[n] = { on: null, ratio: '' }; });
  Object.keys(FO.tests).forEach(n => { if (!FO.tests[n].on && FO.tests[n].on !== false) FO.tests[n].on = null; });
}

function allTypeNames() {
  const s = new Set(CFG.types);
  Object.keys(FO.types || {}).forEach(n => s.add(n));
  return Array.from(s);
}
function allTestNames() {
  const s = new Set(CFG.tests);
  Object.keys(FO.tests || {}).forEach(n => s.add(n));
  return Array.from(s);
}

function viewForm(id) {
  openForm(id);
  const t = T_BY_ID[id];
  if (!t) { go('#/fill'); return; }
  tabbar('');

  let html = topbar(t.n, '#/fill');
  html += '<div class="shell">';

  html += '<div class="card tight">' +
    '<div class="tagline"><span class="tag">' + esc(t.r) + '</span><span class="tag">' + esc(t.s || '—') + '</span><span class="tag">' + esc(t.t || '—') + '</span></div>' +
    '<div class="readonly">' +
    '<div><div class="k">省份</div><div class="v">' + esc(t.p) + '</div></div>' +
    '<div><div class="k">城市</div><div class="v">' + esc(t.c) + '</div></div>' +
    '<div><div class="k">终端名称</div><div class="v" style="font-size:13px">' + esc(t.n) + '</div></div>' +
    '<div><div class="k">终端 ID</div><div class="v mono">' + esc(t.id) + '</div></div>' +
    '</div></div>';

  html += '<div class="sec-title">一、终端潜力</div><div class="card">' +
    '<div class="field"><label>潜力（本月自填）</label>' +
    '<input class="input" id="f-pot" type="number" inputmode="numeric" min="0" step="100" value="' + esc(FO.pot) + '">' +
    '<div class="hint">按你们自己的口径填，系统用它算“目标 / 潜力”。上期值已带出，可直接改。</div></div></div>';

  html += '<div class="sec-title">二、目标（' + esc(pLabel(PERIOD)) + '）</div><div class="card">' +
    '<div class="grid2">' +
    '<div class="field"><label>初治目标</label><input class="input" id="f-h" type="number" inputmode="numeric" min="0" value="' + esc(FO.h) + '"></div>' +
    '<div class="field"><label>经治改方目标</label><input class="input" id="f-i" type="number" inputmode="numeric" min="0" value="' + esc(FO.i) + '"></div>' +
    '</div>' +
    '<div class="grid2">' +
    '<div class="field"><label>初治目标准确率</label><input class="input" id="f-ha" type="number" inputmode="decimal" min="0" max="300" value="' + esc(FO.ha) + '"><div class="hint">百分数，如 92</div></div>' +
    '<div class="field"><label>经治改方准确率</label><input class="input" id="f-ia" type="number" inputmode="decimal" min="0" max="300" value="' + esc(FO.ia) + '"><div class="hint">百分数，如 81</div></div>' +
    '</div>' +
    '<div class="ratio" id="ratio-box"><span>目标合计 / 潜力</span><span><b id="ratio-val">—</b></span></div>' +
    '</div>';

  html += '<div class="sec-title">三、经治患者类型</div><div class="card">' +
    '<label class="cb" style="margin-bottom:6px"><input type="checkbox" id="f-notreated"' + (FO.noTreated ? ' checked' : '') + '> 本终端本月无经治患者</label>' +
    '<div id="type-list"></div></div>';

  html += '<div class="sec-title">四、对应检查开展情况</div><div class="card">' +
    '<div class="hint" style="margin:-2px 0 6px">每一项都要选“是 / 否”，选了“是”请填覆盖患者比例。</div>' +
    '<div id="test-list"></div>' +
    '<button class="btn ghost small" id="btn-all-no" style="margin-top:12px">本终端以上检查均未开展</button>' +
    '</div>';

  html += '<div class="sec-title">五、填报信息</div><div class="card">' +
    '<div class="field"><label>填报人</label><input class="input" id="f-reporter" type="text" value="' + esc(FO.reporter) + '" placeholder="你的姓名"></div>' +
    '<div class="field"><label>备注（可选）</label><textarea class="input" id="f-note" placeholder="口径说明、特殊情况等">' + esc(FO.note) + '</textarea></div>' +
    '</div>';

  html += '<div style="height:10px"></div></div>';

  html += '<div class="actionbar"><button class="btn ghost" id="btn-draft">暂存</button><button class="btn primary" id="btn-submit">提交</button></div>';
  byId('view').innerHTML = html;
  window.scrollTo(0, 0);

  ['pot', 'h', 'i', 'ha', 'ia'].forEach(k => {
    const e = byId('f-' + k);
    e.addEventListener('input', () => {
      const v = e.value.trim();
      FO[k] = v === '' ? null : Number(v);
      e.classList.remove('err');
      updateRatio();
      scheduleDraft();
    });
  });
  byId('f-reporter').addEventListener('input', e => { FO.reporter = e.target.value; e.target.classList.remove('err'); scheduleDraft(); });
  byId('f-note').addEventListener('input', e => { FO.note = e.target.value; scheduleDraft(); });
  byId('f-notreated').addEventListener('change', e => {
    FO.noTreated = e.target.checked;
    if (FO.noTreated) FO.types = {};
    paintTypes();
    scheduleDraft();
  });
  paintTypes();
  paintTests();
  updateRatio();

  byId('btn-draft').addEventListener('click', () => { saveDraft(); toast('已暂存到本机'); });
  byId('btn-submit').addEventListener('click', submitForm);
  byId('btn-all-no').addEventListener('click', () => {
    allTestNames().forEach(n => { FO.tests[n] = { on: false, ratio: '' }; });
    paintTests();
    toast('已全部标为“未开展”，可单独修改');
  });
}

function updateRatio() {
  const box = byId('ratio-box'), val = byId('ratio-val');
  if (!box) return;
  const pot = FO.pot, h = FO.h || 0, i = FO.i || 0;
  if (!isNum(pot) || pot <= 0) { val.textContent = '—'; box.classList.remove('bad'); return; }
  const r = (h + i) / pot;
  val.textContent = fmt(h + i) + ' / ' + fmt(pot) + ' = ' + pct(r);
  box.classList.toggle('bad', r > 0.15);
  if (r > 0.15) val.textContent += '（偏高，请复核）';
}

function paintTypes() {
  const box = byId('type-list');
  if (!box) return;
  const names = allTypeNames();
  const dis = FO.noTreated ? ' disabled' : '';
  box.innerHTML = names.map(n => {
    const on = Object.prototype.hasOwnProperty.call(FO.types, n);
    return '<div class="trow">' +
      '<label class="cb"><input type="checkbox" data-tp="' + esc(n) + '"' + (on ? ' checked' : '') + dis + '>' + esc(n) + '</label>' +
      '<input class="input num-in" type="number" inputmode="numeric" min="0" data-tn="' + esc(n) + '" value="' + (on && FO.types[n] != null ? esc(FO.types[n]) : '') + '" placeholder="人数"' + (on && !FO.noTreated ? '' : ' disabled') + '>' +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('[data-tp]'), cb => {
    cb.addEventListener('change', () => {
      const n = cb.getAttribute('data-tp');
      if (cb.checked) { FO.types[n] = null; } else { delete FO.types[n]; }
      paintTypes();
      scheduleDraft();
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-tn]'), inp => {
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      FO.types[inp.getAttribute('data-tn')] = v === '' ? null : Number(v);
      scheduleDraft();
    });
  });
}

function paintTests() {
  const box = byId('test-list');
  if (!box) return;
  const names = allTestNames();
  box.innerHTML = names.map(n => {
    const s = FO.tests[n] || { on: null, ratio: '' };
    const on = s.on === true, off = s.on === false;
    return '<div class="titem">' +
      '<div class="hd"><span class="nm">' + esc(n) + '</span>' +
      '<div class="yn" data-yn="' + esc(n) + '">' +
      '<button type="button" data-v="1" class="' + (on ? 'on' : '') + '">是</button>' +
      '<button type="button" data-v="0" class="' + (off ? 'on' : '') + '">否</button>' +
      '</div></div>' +
      '<div class="ratio-line" style="' + (on ? '' : 'display:none') + '">' +
      '<label>覆盖患者比例</label>' +
      '<input class="input" type="number" inputmode="decimal" min="0" max="100" data-tr="' + esc(n) + '" value="' + esc(s.ratio) + '"><span style="font-size:12.5px;color:var(--muted)">%</span>' +
      '</div></div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('[data-yn]'), g => {
    g.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const n = g.getAttribute('data-yn');
      const v = b.getAttribute('data-v') === '1';
      const cur = FO.tests[n] || { ratio: '' };
      FO.tests[n] = { on: v, ratio: v ? (cur.ratio || '') : '' };
      paintTests();
      scheduleDraft();
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-tr]'), inp => {
    inp.addEventListener('input', () => {
      const n = inp.getAttribute('data-tr');
      FO.tests[n] = FO.tests[n] || { on: null, ratio: '' };
      FO.tests[n].ratio = inp.value.trim();
      scheduleDraft();
    });
  });
}

/* ---------------- 8. 校验与提交 ---------------- */
function validateForm() {
  const errs = [];
  const mark = id => { const e = byId(id); if (e) e.classList.add('err'); return e; };
  if (!isNum(FO.pot) || FO.pot <= 0) errs.push({ id: 'f-pot', msg: '请填写终端潜力（大于 0）' });
  if (!isNum(FO.h) || FO.h < 0) errs.push({ id: 'f-h', msg: '请填写初治目标' });
  if (!isNum(FO.i) || FO.i < 0) errs.push({ id: 'f-i', msg: '请填写经治改方目标' });
  if (!FO.reporter.trim()) errs.push({ id: 'f-reporter', msg: '请填写填报人姓名' });

  if (!FO.noTreated) {
    const keys = Object.keys(FO.types);
    if (!keys.length) errs.push({ id: 'type-list', msg: '请选择经治患者类型，或勾选“本月无经治患者”' });
    keys.forEach(n => {
      const v = FO.types[n];
      if (!isNum(v) || v <= 0) errs.push({ id: 'type-list', msg: '“' + n + '”请填写人数' });
    });
  }
  const unanswered = allTestNames().filter(n => !FO.tests[n] || (FO.tests[n].on !== true && FO.tests[n].on !== false));
  if (unanswered.length) errs.push({ id: 'test-list', msg: '检查项目未选择：' + unanswered.join('、') });

  const warns = [];
  if (isNum(FO.ha) && FO.ha > 100) warns.push('初治准确率 ' + fmt1(FO.ha) + '% 超过 100%');
  if (isNum(FO.ia) && FO.ia > 100) warns.push('经治改方准确率 ' + fmt1(FO.ia) + '% 超过 100%');
  return { errs, warns };
}

function buildRec() {
  const t = T_BY_ID[FO.id];
  const types = {};
  Object.keys(FO.types).forEach(k => { if (isNum(FO.types[k])) types[k] = FO.types[k]; });
  const tests = {};
  Object.keys(FO.tests).forEach(k => {
    const s = FO.tests[k];
    if (s && (s.on === true || s.on === false)) {
      tests[k] = { on: s.on, ratio: s.on && s.ratio !== '' ? Number(s.ratio) : null };
    }
  });
  return {
    id: t.id, name: t.n, region: t.r, province: t.p, city: t.c, tier: t.t, spec: t.s,
    pot: FO.pot, h: FO.h, i: FO.i, ha: isNum(FO.ha) ? FO.ha : null, ia: isNum(FO.ia) ? FO.ia : null,
    noTreated: !!FO.noTreated && !Object.keys(types).length,
    types: types, tests: tests,
    reporter: FO.reporter.trim(), note: FO.note.trim(), period: PERIOD,
    ts: new Date().toISOString(), ver: (FO.ver || 0) + 1, synced: false
  };
}

async function submitForm() {
  const { errs, warns } = validateForm();
  if (errs.length) {
    const first = errs[0];
    const e = byId(first.id);
    if (e) { e.classList.add('err'); e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    toast(first.msg, 'err');
    return;
  }
  const rec = buildRec();
  const typeTxt = rec.noTreated ? '本月无经治患者' : Object.keys(rec.types).length + ' 类';
  const ans = Object.keys(rec.tests).length;
  let msg = '确认提交？\n\n' + rec.name + '\n' +
    '潜力 ' + fmt(rec.pot) + ' · 初治 ' + fmt(rec.h) + ' · 经治 ' + fmt(rec.i) +
    (isNum(rec.pot) && rec.pot > 0 ? '（占潜力 ' + pct((rec.h + rec.i) / rec.pot) + '）' : '') + '\n' +
    '经治患者 ' + typeTxt + ' · 检查 ' + ans + ' 项已作答';
  if (warns.length) msg += '\n\n⚠ ' + warns.join('；');
  msg += '\n\n提交后如需修改，重新提交一次即可，以最新一次为准。';
  if (!window.confirm(msg)) return;

  SUBS[rec.id] = rec;
  persistSubs();
  pushLog(rec);
  clearDraft(rec.id);
  CFG.reporter = rec.reporter;
  saveCfg();

  if (CFG.storage === 'supabase' && sbBase() && CFG.sbKey) {
    toast('已保存，正在同步云端…');
    try {
      await sbPush(rec);
      rec.synced = true;
      SUBS[rec.id] = rec;
      persistSubs();
      toast('提交成功，已同步云端');
    } catch (e) {
      toast('已存本机，云端同步失败：' + e.message, 'err');
    }
  } else {
    toast('提交成功' + (CFG.storage === 'local' ? '（仅存本机）' : ''));
  }
  go('#/fill');
}

/* ---------------- 9. 报告 ---------------- */
function computeReport(dataMap) {
  const S = dataMap || SUBS;
  const subs = Object.keys(S).map(id => S[id]).filter(s => s && T_BY_ID[s.id]);
  const total = TERMINALS.length;
  const done = subs.length;
  const sumPot = sum(subs, s => s.pot);
  const sumH = sum(subs, s => s.h);
  const sumI = sum(subs, s => s.i);

  const regions = uniq(TERMINALS.map(t => t.r));
  const byRegion = regions.map(r => {
    const all = TERMINALS.filter(t => t.r === r);
    const d = all.filter(t => S[t.id]).map(t => S[t.id]);
    return {
      name: r, total: all.length, done: d.length,
      pot: sum(d, s => s.pot), h: sum(d, s => s.h), i: sum(d, s => s.i),
      rate: all.length ? d.length / all.length : 0
    };
  }).sort((a, b) => b.total - a.total);

  const bandDef = [
    { lb: '< 3000', lo: 0, hi: 3000 },
    { lb: '3000–5999', lo: 3000, hi: 6000 },
    { lb: '6000–9999', lo: 6000, hi: 10000 },
    { lb: '≥ 10000', lo: 10000, hi: Infinity }
  ];
  const bands = bandDef.map(b => {
    const d = subs.filter(s => isNum(s.pot) && s.pot >= b.lo && s.pot < b.hi);
    return { lb: b.lb, n: d.length, pot: sum(d, s => s.pot), h: sum(d, s => s.h), i: sum(d, s => s.i) };
  });

  const testNames = uniq(TERMINALS.length ? CFG.tests.concat(Object.keys(subs.reduce((m, s) => { Object.keys(s.tests || {}).forEach(k => m[k] = 1); return m; }, {}))) : CFG.tests);
  const tests = testNames.map(n => {
    const answered = subs.filter(s => s.tests && s.tests[n] && (s.tests[n].on === true || s.tests[n].on === false));
    const on = answered.filter(s => s.tests[n].on === true);
    const ratios = on.map(s => s.tests[n].ratio).filter(isNum);
    return {
      name: n, answered: answered.length, on: on.length,
      onRate: subs.length ? on.length / subs.length : 0,
      avgRatio: ratios.length ? sum(ratios, x => x) / ratios.length : null
    };
  });

  const typeTotals = {};
  subs.forEach(s => Object.keys(s.types || {}).forEach(k => { typeTotals[k] = (typeTotals[k] || 0) + (isNum(s.types[k]) ? s.types[k] : 0); }));
  const typeSum = sum(Object.keys(typeTotals), k => typeTotals[k]);
  const types = Object.keys(typeTotals).map(k => ({ name: k, n: typeTotals[k], share: typeSum ? typeTotals[k] / typeSum : 0 }))
    .sort((a, b) => b.n - a.n);

  const withPot = subs.filter(s => isNum(s.pot) && s.pot > 0);
  const ratios = withPot.map(s => (sum([s], x => x.h) + sum([s], x => x.i)) / s.pot);
  const med = median(ratios);

  const zeros = subs.filter(s => (s.h || 0) + (s.i || 0) === 0).sort((a, b) => (b.pot || 0) - (a.pot || 0));
  const over100 = subs.filter(s => (isNum(s.ha) && s.ha > 100) || (isNum(s.ia) && s.ia > 100));
  const highRatio = withPot.map(s => ({ s: s, r: ((s.h || 0) + (s.i || 0)) / s.pot }))
    .filter(x => x.r > 0.15).sort((a, b) => b.r - a.r).slice(0, 5);
  const lowRatio = withPot.filter(s => s.pot >= 10000)
    .map(s => ({ s: s, r: ((s.h || 0) + (s.i || 0)) / s.pot }))
    .filter(x => x.r < med).sort((a, b) => a.r - b.r).slice(0, 5);
  const grp = (keyFn) => {
    const m = new Map();
    TERMINALS.forEach(t => { const k = keyFn(t) || '未标注'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    return Array.from(m.entries()).map(function (e) {
      const ts = e[1], d = ts.filter(t => S[t.id]).map(t => S[t.id]);
      return { name: e[0], total: ts.length, done: d.length, pot: sum(d, s => s.pot), h: sum(d, s => s.h), i: sum(d, s => s.i) };
    }).sort((a, b) => b.total - a.total);
  };
  const bySpec = grp(t => t.s);
  const tierOrder = ['省会', '地级市', '县域'];
  const byTier = grp(t => t.t).sort((a, b) => {
    const ia = tierOrder.indexOf(a.name), ib = tierOrder.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const haV = subs.map(s => s.ha).filter(isNum);
  const iaV = subs.map(s => s.ia).filter(isNum);

  const missing = TERMINALS.filter(t => !S[t.id]);
  const missingByRegion = regions.map(r => ({ r: r, n: missing.filter(t => t.r === r).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n);

  return {
    subs, total, done, rate: total ? done / total : 0,
    sumPot, sumH, sumI, byRegion, bands, tests, types, typeSum,
    med, zeros, over100, highRatio, lowRatio, missing, missingByRegion,
    bySpec, byTier, avgHa: avg(haV), avgIa: avg(iaV), nHa: haV.length, nIa: iaV.length
  };
}

function conclusions(r) {
  const out = [];
  const P = RP || PERIOD;

  if (r.done === 0) return out;

  if (r.rate < 0.9) {
    const top = r.missingByRegion.slice(0, 3).map(x => x.r.replace(/^感染|区域$/g, '') + ' ' + x.n).join('、');
    out.push({ lv: 'warn', t: '回收率 ' + pct(r.rate) + '，还有 ' + r.missing.length + ' 家未提交', x: '缺口集中在：' + top + '。建议按区域催办，优先补潜力 ≥ 10000 的终端。' });
  } else {
    out.push({ lv: 'ok', t: '回收率 ' + pct(r.rate) + '，采集基本完成', x: '共收到 ' + r.done + ' 家终端数据，覆盖潜力 ' + fmt(r.sumPot) + '。' });
  }

  if (r.zeros.length) {
    out.push({
      lv: 'bad',
      t: r.zeros.length + ' 家终端目标填了 0',
      x: '包括 ' + r.zeros.slice(0, 3).map(s => s.name + '（潜力 ' + fmt(s.pot) + '）').join('、') +
        '。目标为 0 会让区域目标合计失真，需要逐家确认是“本月无计划”还是漏填。'
    });
  }

  if (r.over100.length) {
    out.push({
      lv: 'warn',
      t: r.over100.length + ' 家准确率超过 100%',
      x: '例：' + r.over100.slice(0, 3).map(s => s.name + ' ' + fmt1(isNum(s.ha) ? s.ha : s.ia) + '%').join('、') +
        '。原表里也存在 0.92 与 266 混填的情况，建议统一口径（完成率还是达标率）后重新校准。'
    });
  }

  if (r.highRatio.length) {
    out.push({
      lv: 'warn',
      t: '目标 / 潜力偏高：' + r.highRatio.length + ' 家超过 15%',
      x: r.highRatio.slice(0, 3).map(x => x.s.name + ' ' + pct(x.r)).join('、') +
        '（样本中位数 ' + pct(r.med) + '）。可能是潜力填低了，也可能是目标虚高，建议复核。'
    });
  }

  if (r.lowRatio.length) {
    out.push({
      lv: 'info',
      t: '高潜力终端目标偏低',
      x: r.lowRatio.slice(0, 3).map(x => x.s.name + '（潜力 ' + fmt(x.s.pot) + '，' + pct(x.r) + '）').join('、') +
        ' 低于样本中位数 ' + pct(r.med) + '，是本月最值得追加资源的地方。'
    });
  }

  const worstTest = r.tests.filter(t => t.answered > 0).sort((a, b) => a.onRate - b.onRate)[0];
  if (worstTest && worstTest.onRate < 0.5) {
    out.push({
      lv: 'warn',
      t: '检查开展率最低：' + worstTest.name + '（' + pct(worstTest.onRate) + '）',
      x: '经治改方的依据主要靠检查结果。' + worstTest.name + ' 未开展的终端占 ' + pct(1 - worstTest.onRate) +
        '，这部分改方缺乏客观依据，建议在代表培训里单独强调。'
    });
  }

  if (r.types.length) {
    const t0 = r.types[0];
    const conc = t0.share >= 0.5;
    out.push({
      lv: 'info',
      t: '经治患者以「' + t0.name + '」为主（' + pct(t0.share) + '）',
      x: '共 ' + fmt(r.typeSum) + ' 人。' + (conc
        ? '该类型占比过半，改方空间主要集中在这一类，活动和话术可以集中投放。'
        : '前几类占比接近，说明改方场景比较分散，需要按类型分别准备话术，不能只打一类。')
    });
  }

  const regs = r.byRegion.filter(x => x.done > 0 && x.pot > 0).map(x => ({ n: x.name, r: (x.h + x.i) / x.pot }));
  if (regs.length >= 2) {
    regs.sort((a, b) => b.r - a.r);
    const hi = regs[0], lo = regs[regs.length - 1];
    if (hi.r > lo.r * 1.8) {
      out.push({
        lv: 'info',
        t: '区域目标强度差异大',
        x: hi.n.replace(/^感染|区域$/g, '') + ' 为 ' + pct(hi.r) + '，' + lo.n.replace(/^感染|区域$/g, '') + ' 仅 ' + pct(lo.r) +
          '，同一套潜力口径下差 ' + (hi.r / lo.r).toFixed(1) + ' 倍，建议对齐口径再汇总。'
      });
    }
  }

  const pri = { bad: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => pri[a.lv] - pri[b.lv]).slice(0, 7);
}

function renderGate(msg, noCfg) {
  let html = '<div class="shell">';
  html += '<div class="hero"><div class="k">ADMIN</div><h1>' + esc(pLabel(RP || PERIOD)) + '填报分析</h1>' +
    '<div class="sub">报告仅管理员可见 · 销售提交不需要口令</div></div>';
  html += '<div class="card">';
  if (noCfg) {
    html += '<div class="empty">云端还没配置<br><span style="font-size:12px">先到「设置 → 数据源」填 Supabase 地址和 Key</span></div>' +
      '<button class="btn primary" id="g-set" style="width:100%">去设置</button>';
  } else {
    html += '<div class="field"><label>管理口令</label>' +
      '<input class="input" id="g-pass" type="password" placeholder="输入后查看全部提交" autocomplete="current-password"></div>' +
      '<button class="btn primary" id="g-go" style="width:100%">查看报告</button>';
    if (msg) html += '<div class="note" style="margin-top:12px;color:var(--danger)">' + esc(msg) + '</div>';
    html += '<div class="note" style="margin-top:12px">口令在 supabase.sql 里设置。改口令：重新执行那段 SQL 函数即可，已登录的页面不受影响。</div>';
  }
  html += '</div></div>';
  byId('view').innerHTML = html;
  window.scrollTo(0, 0);
  if (noCfg) { byId('g-set').addEventListener('click', () => go('#/settings')); return; }
  const btn = byId('g-go'), inp = byId('g-pass');
  const submit = async () => {
    const p = inp.value.trim();
    if (!p) { toast('请输入管理口令'); return; }
    sessionStorage.setItem('tf.pass', p);
    btn.disabled = true; btn.textContent = '验证中…';
    await viewReport();
  };
  btn.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  inp.focus();
}

async function viewReport() {
  tabbar('report');
  REMOTE = null;
  REMOTE_RAW = null;
  if (CFG.storage === 'supabase') {
    if (!sbBase() || !CFG.sbKey) { renderGate('', true); return; }
    const pass = sessionStorage.getItem('tf.pass') || '';
    if (!pass) { renderGate(''); return; }
    try {
      LAST_INFO = await sbPull(pass);
    } catch (e) {
      sessionStorage.removeItem('tf.pass');
      renderGate(sbHint(e));
      return;
    }
  }
  const srcAll = REMOTE || SUBS;
  const plist = periodListOf(srcAll);
  if (!RP || plist.indexOf(RP) < 0) RP = plist[plist.length - 1] || PERIOD;
  const r = computeReport(byPeriod(srcAll, RP));
  const cs = conclusions(r);

  let html = '';
  html += '<div class="shell wide">';
  html += '<div class="hero"><div class="k">AUTO REPORT</div><h1>' + esc(pLabel(RP || PERIOD)) + '填报分析</h1>' +
    '<div class="sub">' + (CFG.storage === 'supabase'
      ? '数据源：云端 · 共 ' + (LAST_INFO ? LAST_INFO.rows : 0) + ' 次提交'
      : '数据源：本机浏览器') + ' · 自动生成</div>' +
    '<div class="prog"><i style="width:' + (r.rate * 100).toFixed(1) + '%"></i></div>' +
    '<div class="prog-txt"><span>回收 ' + r.done + ' / ' + r.total + '</span><span>' + pct(r.rate) + '</span></div></div>';

  if (r.done === 0) {
    html += '<div class="card"><div class="empty">还没有任何提交<br><span style="font-size:12px;line-height:1.8">先去「填报」录一家，或到「设置」里生成演示数据看效果</span></div>' +
      '<div style="display:flex;gap:8px"><button class="btn ghost small" style="flex:1" data-go="#/fill">去填报</button>' +
      '<button class="btn ghost small" style="flex:1" id="btn-demo2">生成演示数据</button></div></div>';
    html += '</div>';
    byId('view').innerHTML = html;
    const d2 = byId('btn-demo2');
    if (d2) d2.addEventListener('click', () => { genDemo(); viewReport(); });
    window.scrollTo(0, 0);
    return;
  }

  html += '<div class="kpis">' +
    '<div class="kpi"><div class="l">回收率</div><div class="v">' + (r.rate * 100).toFixed(1) + '<small>%</small></div><div class="d">' + r.done + ' / ' + r.total + ' 家</div></div>' +
    '<div class="kpi"><div class="l">初治目标</div><div class="v">' + fmt(r.sumH) + '</div><div class="d">潜力 ' + fmt(r.sumPot) + '</div></div>' +
    '<div class="kpi"><div class="l">经治改方</div><div class="v">' + fmt(r.sumI) + '</div><div class="d">目标合计 ' + fmt(r.sumH + r.sumI) + '</div></div>' +
    '<div class="kpi"><div class="l">目标 / 潜力</div><div class="v">' + pct(r.sumPot ? (r.sumH + r.sumI) / r.sumPot : 0) + '</div><div class="d">中位数 ' + pct(r.med) + '</div></div>' +
    '</div>';

  html += '<div class="card tight"><div class="stat3">' +
    '<div><div class="sv">' + (isNum(r.avgHa) ? r.avgHa.toFixed(1) + '%' : '—') + '</div><div class="sl">平均初治准确率（' + r.nHa + ' 家）</div></div>' +
    '<div><div class="sv">' + (isNum(r.avgIa) ? r.avgIa.toFixed(1) + '%' : '—') + '</div><div class="sl">平均经治准确率（' + r.nIa + ' 家）</div></div>' +
    '<div><div class="sv" style="' + (r.over100.length ? 'color:var(--warn)' : '') + '">' + r.over100.length + '</div><div class="sl">准确率 &gt; 100%</div></div>' +
    '</div></div>';

  if (plist.length > 1) {
    html += '<div class="chips" style="margin:2px 0 12px">' + plist.map(p =>
      '<button class="chip ' + (p === RP ? 'on' : '') + '" data-rp="' + esc(p) + '">' + esc(pLabel(p)) + '</button>'
    ).join('') + '</div>';
  }

  if (CFG.storage === 'local' && Object.keys(SUBS).some(id => SUBS[id] && !SUBS[id].demo)) {
    html += '<div class="concl warn"><span class="dot"></span><div><div class="tt">当前是「本机模式」</div>' +
      '<div class="tx">报告只统计这台设备上的 ' + r.done + ' 条提交，别人手机上填的不会到这里。正式收集请在「设置 → 数据源」切到云端（Supabase），大家共用一个链接。</div></div></div>';
  }

  html += '<div class="sec-title">关键结论</div>';
  cs.forEach(c => {
    html += '<div class="concl ' + c.lv + '"><span class="dot"></span><div><div class="tt">' + esc(c.t) + '</div><div class="tx">' + esc(c.x) + '</div></div></div>';
  });

  html += '<div class="sec-title">回收进度（按区域）</div><div class="card">' +
    bars(r.byRegion.map(x => ({ lb: x.name.replace(/^感染|区域$/g, ''), v: x.rate, txt: x.done + '/' + x.total })), 1) + '</div>';

  html += '<div class="sec-title">检查开展率</div><div class="card">' +
    bars(r.tests.slice().sort((a, b) => b.onRate - a.onRate).map(t => ({
      lb: t.name, v: t.onRate,
      txt: t.answered ? pct(t.onRate) : '未作答',
      color: t.onRate < 0.5 ? '#d97706' : '#0f766e'
    })), 1) +
    '<div class="note" style="margin-top:12px">开展率 = 选“是”的终端数 / 已提交终端数；括号外的平均覆盖率见导出明细。</div></div>';

  if (r.types.length) {
    html += '<div class="sec-title">经治患者类型结构</div><div class="card">' +
      bars(r.types.map(t => ({ lb: t.name, v: t.share, txt: fmt(t.n) + '（' + pct(t.share) + '）' }))) + '</div>';
  }

  var structRow = function (x) {
    return '<tr><td>' + esc(x.name) + '</td><td>' + x.total + '</td><td>' + x.done + '</td><td>' + fmt(x.h) + '</td><td>' + fmt(x.i) + '</td><td>' + pct(x.pot ? (x.h + x.i) / x.pot : 0) + '</td></tr>';
  };
  html += '<div class="sec-title">结构分析</div><div class="card">' +
    '<div class="mini-t">按专科 / 综合</div><div class="scroll-x"><table class="tb"><thead><tr><th>类型</th><th>终端</th><th>已填</th><th>初治</th><th>经治</th><th>目标/潜力</th></tr></thead><tbody>' +
    r.bySpec.map(structRow).join('') + '</tbody></table></div>' +
    '<div class="mini-t" style="margin-top:16px">按城市层级</div><div class="scroll-x"><table class="tb"><thead><tr><th>层级</th><th>终端</th><th>已填</th><th>初治</th><th>经治</th><th>目标/潜力</th></tr></thead><tbody>' +
    r.byTier.map(structRow).join('') + '</tbody></table></div></div>';

  html += '<div class="sec-title">潜力段 × 目标</div><div class="card"><div class="scroll-x"><table class="tb">' +
    '<thead><tr><th>潜力段</th><th>已填</th><th>潜力</th><th>初治</th><th>经治</th><th>目标/潜力</th></tr></thead><tbody>' +
    r.bands.map(b => '<tr><td>' + esc(b.lb) + '</td><td>' + b.n + '</td><td>' + fmt(b.pot) + '</td><td>' + fmt(b.h) + '</td><td>' + fmt(b.i) + '</td><td>' + pct(b.pot ? (b.h + b.i) / b.pot : 0) + '</td></tr>').join('') +
    '</tbody></table></div></div>';

  html += '<div class="sec-title">区域汇总</div><div class="card"><div class="scroll-x"><table class="tb">' +
    '<thead><tr><th>区域</th><th>终端</th><th>已填</th><th>初治</th><th>经治</th><th>潜力</th><th>目标/潜力</th></tr></thead><tbody>' +
    r.byRegion.map(x => '<tr><td>' + esc(x.name.replace(/^感染|区域$/g, '')) + '</td><td>' + x.total + '</td><td>' + x.done + '</td><td>' + fmt(x.h) + '</td><td>' + fmt(x.i) + '</td><td>' + fmt(x.pot) + '</td><td>' + pct(x.pot ? (x.h + x.i) / x.pot : 0) + '</td></tr>').join('') +
    '</tbody></table></div></div>';

  const hist = historyData().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  if (hist.length) {
    const byId = {};
    hist.forEach(h => { if (h && h.id) (byId[h.id] = byId[h.id] || []).push(h); });
    const multi = Object.keys(byId).filter(k => byId[k].length > 1).length;
    html += '<div class="sec-title">提交记录</div><div class="card">' +
      '<div style="font-size:12.5px;color:#4a5567;margin-bottom:8px">共 ' + hist.length + ' 次提交 · 覆盖 ' +
      Object.keys(byId).length + ' 家终端' +
      (multi ? ' · <b style="color:var(--brand)">' + multi + ' 家改过</b>，报告取最新一次' : '') + '</div>' +
      '<div class="scroll-x"><table class="tb"><thead><tr><th>时间</th><th>终端</th><th>填报人</th><th>初治/经治</th></tr></thead><tbody>' +
      hist.slice(0, 12).map(h => '<tr><td style="white-space:nowrap">' + esc(tstr(h.ts)) + '</td>' +
        '<td style="text-align:left;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(h.name || (T_BY_ID[h.id] ? T_BY_ID[h.id].n : h.id)) + '</td>' +
        '<td>' + esc(h.reporter || '—') + '</td>' +
        '<td>' + fmt(h.h) + ' / ' + fmt(h.i) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (hist.length > 12 ? '<div class="hint" style="margin-top:6px">只显示最近 12 条，' +
        (CFG.storage === 'supabase' ? '完整记录在 Supabase 表里。' : '更早的记录保存在本机。') + '</div>' : '') +
      '</div>';
  }

  const notes = [];
  if (r.zeros.length) notes.push('目标为 0：' + r.zeros.slice(0, 6).map(s => s.name).join('、'));
  if (r.over100.length) notes.push('准确率 > 100%：' + r.over100.slice(0, 6).map(s => s.name).join('、'));
  if (r.missingByRegion.length) notes.push('未提交：' + r.missingByRegion.map(x => x.r.replace(/^感染|区域$/g, '') + ' ' + x.n).join('、'));
  if (notes.length) {
    html += '<div class="sec-title">待处理</div><div class="card">' +
      notes.map(n => '<div style="font-size:12.5px;color:#4a5567;padding:5px 0;border-bottom:1px dashed #eef1f5">' + esc(n) + '</div>').join('') + '</div>';
  }

  html += '<div class="sec-title">导出</div><div class="card">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn ghost small" id="btn-csv">导出明细 CSV</button>' +
    '<button class="btn ghost small" id="btn-miss">导出未填名单</button>' +
    '<button class="btn ghost small" id="btn-copy">复制结论文字</button>' +
    (CFG.storage === 'supabase' ? '<button class="btn ghost small" id="btn-logout">退出管理</button>' : '') +
    '</div>' +
    (TERMINALS.some(t => t.n.indexOf('155') >= 0)
      ? '<div class="note" style="margin-top:12px">155 家潜力＜2000 的终端已作为一行汇总纳入（设置 → 终端名单可查看）。有逐家名单的话，可以删掉汇总行、批量导入明细。</div>'
      : '<div class="note" style="margin-top:12px">另有 155 家潜力＜2000 的终端在原表中为一行汇总（上期初治 1,076 / 经治 767），未纳入逐家填报。可在「设置 → 终端名单」一键插入汇总行，或批量导入明细。</div>') +
    '</div>';

  html += '<div style="height:8px"></div></div>';
  byId('view').innerHTML = html;
  window.scrollTo(0, 0);

  const lo = byId('btn-logout');
  if (lo) lo.addEventListener('click', () => {
    sessionStorage.removeItem('tf.pass');
    toast('已退出');
    go('#/fill');
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-rp]'), b => {
    b.addEventListener('click', () => { RP = b.getAttribute('data-rp'); viewReport(); });
  });
  byId('btn-csv').addEventListener('click', exportCSV);
  byId('btn-miss').addEventListener('click', exportMissing);
  byId('btn-copy').addEventListener('click', () => {
    const txt = pLabel(RP || PERIOD) + '填报分析（回收 ' + r.done + '/' + r.total + '，' + pct(r.rate) + '）\n\n' +
      cs.map((c, i) => (i + 1) + '. ' + c.t + '\n' + c.x).join('\n\n');
    navigator.clipboard.writeText(txt).then(() => toast('结论已复制'), () => toast('复制失败，请手动选择', 'err'));
  });
}

/* ---------------- 10. 导出 ---------------- */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows) {
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
function periodListOf(src) {
  const set = new Set([PERIOD]);
  Object.keys(src).forEach(id => { const v = src[id]; if (v) set.add(v.period || PERIOD); });
  return Array.from(set).filter(Boolean).sort();
}
function byPeriod(src, p) {
  const out = {};
  Object.keys(src).forEach(id => {
    const v = src[id];
    if (v && (v.period || PERIOD) === p) out[id] = v;
  });
  return out;
}
function reportSource() {
  const all = REMOTE || SUBS;
  return RP ? byPeriod(all, RP) : all;
}
function historyData() {
  if (CFG.storage === 'supabase' && REMOTE_RAW) {
    return REMOTE_RAW.filter(h => h && (h.period || PERIOD) === RP);
  }
  const log = loadLog();
  if (log.length) return log;
  // 没有历史（比如导入/演示数据）时，用当前数据合成一条时间线
  const src = reportSource();
  return Object.keys(src).map(id => {
    const v = src[id];
    return { id: id, name: v.name, reporter: v.reporter, ts: v.ts, h: v.h, i: v.i };
  });
}
function tstr(ts) {
  const v = String(ts || '');
  return v.length >= 16 ? v.slice(5, 16).replace('T', ' ') : (v || '—');
}
function exportCSV() {
  const src = reportSource();
  const head = ['终端ID', '区域', '省份', '城市', '终端名称', '城市层级', '专科/综合', '潜力',
    '初治目标', '经治改方目标', '目标合计', '目标/潜力', '初治准确率%', '经治准确率%',
    '经治患者类型', '检查开展', '填报人', '提交时间'];
  const rows = [head];
  TERMINALS.forEach(t => {
    const s = src[t.id];
    if (!s) return;
    const types = Object.keys(s.types || {}).map(k => k + ':' + s.types[k]).join(' | ');
    const tests = Object.keys(s.tests || {}).map(k => k + ':' + (s.tests[k].on ? ('是' + (isNum(s.tests[k].ratio) ? '(' + s.tests[k].ratio + '%)' : '')) : '否')).join(' | ');
    rows.push([t.id, t.r, t.p, t.c, t.n, t.t, t.s, s.pot, s.h, s.i,
      (s.h || 0) + (s.i || 0),
      isNum(s.pot) && s.pot > 0 ? ((s.h || 0) + (s.i || 0)) / s.pot : '',
      s.ha, s.ia, types, tests, s.reporter, s.ts]);
  });
  download('终端填报明细_' + (RP || PERIOD) + '.csv', toCSV(rows));
  toast('已导出明细');
}
function exportMissing() {
  const src = reportSource();
  const rows = [['终端ID', '区域', '省份', '城市', '终端名称', '城市层级', '专科/综合', '上期潜力']];
  TERMINALS.forEach(t => { if (!src[t.id]) rows.push([t.id, t.r, t.p, t.c, t.n, t.t, t.s, t.pot]); });
  download('未填终端名单_' + (RP || PERIOD) + '.csv', toCSV(rows));
  toast('已导出未填名单（' + (rows.length - 1) + ' 家）');
}

/* ---------------- 11. 设置 ---------------- */
function viewSettings() {
  tabbar('settings');
  let html = topbar('设置', '');
  html += '<div class="shell">';

  html += '<div class="sec-title">基础</div><div class="card">' +
    '<div class="field"><label>填报周期</label><input class="input" id="s-period" type="text" value="' + esc(CFG.period) + '" placeholder="2026-10（留空 = 跟随当前月份）"><div class="hint">当前生效：<b>' + esc(pLabel(PERIOD)) + '</b>' +
      (PERIOD_SRC === 'url' ? '（来自链接参数 ?p=）' : PERIOD_SRC === 'cfg' ? '（来自本机设置）' : '（跟随当前月份）') +
      '。写成 2026-10 或 2026年10月 都行；留空就按当月算。</div></div>' +
    '<div class="field"><label>本月分享链接</label>' +
    '<input class="input" id="s-share" readonly value="' + esc(shareLink()) + '" style="font-size:12.5px;background:#f7f9fb">' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button class="btn primary small" id="btn-copy-link" style="flex:1">复制链接发群</button>' +
    '<button class="btn ghost small" id="btn-open-link">预览</button></div>' +
    '<div class="hint">改上面的周期，这条链接会跟着变。销售打开哪个链接，数据就归到哪个月——因为每个人的手机不共享设置，<b>链接才是月份开关</b>。</div></div>' +
    '<div class="field"><label>我的姓名</label><input class="input" id="s-reporter" type="text" value="' + esc(CFG.reporter) + '" placeholder="填一次，之后自动带出"><div class="hint">用于“只看我填的”和报告里的填报人。</div></div>' +
    '</div>';

  html += '<div class="sec-title">数据源</div><div class="card">' +
    '<div class="set-row"><div><div class="lb">存储方式</div><div class="sb">本机：只有这台设备能看到；云端：一个链接收集，报告需口令</div></div>' +
    '<div class="seg"><button data-st="local" class="' + (CFG.storage === 'local' ? 'on' : '') + '">本机</button><button data-st="supabase" class="' + (CFG.storage === 'supabase' ? 'on' : '') + '">云端</button></div></div>' +
    '<div id="sb-box" style="' + (CFG.storage === 'supabase' ? '' : 'display:none') + '">' +
    '<div class="field" style="margin-top:12px"><label>Supabase URL</label><input class="input" id="s-url" type="text" value="' + esc(CFG.sbUrl) + '" placeholder="https://xxxx.supabase.co"></div>' +
    '<div class="field"><label>Anon Key（可公开）</label><input class="input" id="s-key" type="text" value="' + esc(CFG.sbKey) + '" placeholder="eyJhbGciOi..."><div class="hint">这个 key 放在网页里是安全的：只能往表里追加提交，读不到任何数据。</div></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" id="btn-test">测试连接</button><button class="btn ghost small" id="btn-pull">去看报告</button></div>' +
    '<div class="note" style="margin-top:10px">建表 SQL 见同目录 <b>supabase.sql</b>：里面同时设置管理口令（默认 change-me-2026，务必改掉）。填完先点“测试连接”。</div>' +
    '</div></div>';

  html += '<div class="sec-title">终端名单</div><div class="card">' +
    '<div class="set-row"><div><div class="lb">当前共 ' + TERMINALS.length + ' 家</div>' +
    '<div class="sb">内置 ' + (TERMINALS.length - CUSTOM.length) + ' 家 · 自定义 ' + CUSTOM.length + ' 家</div></div>' +
    '<button class="btn ghost small" id="btn-add155">插入 155 家汇总行</button></div>' +
    '<div class="field" style="margin-top:6px"><label>批量添加终端</label>' +
    '<textarea class="input" id="s-terms" placeholder="每行一家，只写名称也可以：&#10;某某市人民医院&#10;&#10;要带信息就按七列写：&#10;感染华东区域,江苏省,南京市,某某医院,地级市,综合,3000"></textarea>' +
    '<div class="hint">逗号或 Tab 分隔。名称是唯一标识，重名会自动跳过。</div></div>' +
    '<button class="btn primary" id="btn-addterms" style="width:100%">添加到名单</button>' +
    '<div id="custom-list" style="margin-top:10px"></div>' +
    '</div>';

  html += '<div class="sec-title">选项配置</div><div class="card">' +
    '<div class="field"><label>经治患者类型（一行一个）</label><textarea class="input" id="s-types">' + esc(CFG.types.join('\n')) + '</textarea></div>' +
    '<div class="field"><label>检查项目（一行一个）</label><textarea class="input" id="s-tests">' + esc(CFG.tests.join('\n')) + '</textarea></div>' +
    '<div class="hint">改完点下方保存。已有填报里用到的旧选项不会丢，会继续显示在表单里。</div>' +
    '</div>';

  html += '<div class="sec-title">数据</div><div class="card">' +
    '<div class="set-row"><div><div class="lb">已提交</div><div class="sb">' + doneCount() + ' 家 · 本机</div></div><button class="btn ghost small" id="btn-json">导出备份 JSON</button></div>' +
    '<div class="set-row"><div><div class="lb">导入备份</div><div class="sb">合并到本机（同一终端以时间新的为准）</div></div><button class="btn ghost small" id="btn-import">选择文件</button></div>' +
    '<div class="set-row"><div><div class="lb">演示数据</div><div class="sb">随机生成约 7 成提交，用来看报告效果</div></div><button class="btn ghost small" id="btn-demo">生成</button></div>' +
    '<div class="set-row"><div><div class="lb">清空演示数据</div><div class="sb">只删演示生成的那部分</div></div><button class="btn ghost small" id="btn-clear-demo">清除</button></div>' +
    '<div class="set-row"><div><div class="lb">清空全部</div><div class="sb">本机所有提交记录，谨慎</div></div><button class="btn ghost small" id="btn-clear" style="color:var(--danger)">清空</button></div>' +
    '</div>';

  html += '<div class="sec-title">说明</div><div class="card"><div class="note">' +
    '1. 一个终端一条记录，重复提交会覆盖旧的（保留最新）。<br>' +
    '2. 本机模式只存在这台设备的浏览器里，换设备看不到；正式收集请切到云端。<br>' +
    '3. 只采集终端级汇总数，不要填患者姓名、病历号等可识别信息。<br>' +
    '4. 生成的文件可直接放到 GitHub Pages / 任意静态托管。' +
    '</div></div>';

  html += '<div style="height:8px"></div></div>';
  byId('view').innerHTML = html;

  byId('btn-copy-link').addEventListener('click', () => {
    const v = byId('s-share').value;
    navigator.clipboard.writeText(v).then(
      () => toast('链接已复制，发群里就行'),
      () => { byId('s-share').select(); toast('请手动复制（已全选）'); }
    );
  });
  byId('btn-open-link').addEventListener('click', () => {
    const v = byId('s-share').value;
    if (v.indexOf('file:') === 0) { toast('本地文件模式没有在线链接'); return; }
    window.open(v, '_blank');
  });
  byId('s-period').addEventListener('change', e => {
    CFG.period = normPeriod(e.target.value);
    saveCfg();
    PERIOD = CFG.period || curPeriod();
    toast('填报周期：' + pLabel(PERIOD));
    route();
  });
  byId('s-reporter').addEventListener('input', e => { CFG.reporter = e.target.value; saveCfg(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-st]'), b => {
    b.addEventListener('click', () => {
      CFG.storage = b.getAttribute('data-st'); saveCfg(); viewSettings();
    });
  });
  const url = byId('s-url'), key = byId('s-key');
  if (url) url.addEventListener('input', e => { CFG.sbUrl = e.target.value.trim(); saveCfg(); });
  if (key) key.addEventListener('input', e => { CFG.sbKey = e.target.value.trim(); saveCfg(); });
  const bt = byId('btn-test');
  if (bt) bt.addEventListener('click', async () => {
    toast('测试中…');
    try {
      await sbPing();
      toast('连接成功');
    } catch (e) { toast('连接失败：' + sbHint(e), 'err'); }
  });
  const bp = byId('btn-pull');
  if (bp) bp.addEventListener('click', () => { go('#/report'); });

  byId('s-types').addEventListener('change', e => {
    const arr = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!arr.length) { toast('不能为空', 'err'); return; }
    CFG.types = arr; saveCfg(); toast('类型选项已保存');
  });
  byId('s-tests').addEventListener('change', e => {
    const arr = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!arr.length) { toast('不能为空', 'err'); return; }
    CFG.tests = arr; saveCfg(); toast('检查项目已保存');
  });

  const cl = byId('custom-list');
  if (cl) {
    cl.innerHTML = CUSTOM.length
      ? CUSTOM.map(c => '<div class="set-row"><div><div class="lb" style="font-size:13px">' + esc(c.n) + '</div>' +
        '<div class="sb">' + esc([c.r, c.p, c.c].filter(Boolean).join(' · ')) + '</div></div>' +
        '<button class="btn ghost small" data-del="' + esc(c.id) + '" style="color:var(--danger)">删除</button></div>').join('')
      : '<div class="hint">还没有自定义终端。</div>';
    Array.prototype.forEach.call(cl.querySelectorAll('[data-del]'), b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-del');
        const t = T_BY_ID[id];
        if (!confirm('删除「' + (t ? t.n : id) + '」？该终端的提交记录也会一起清掉。')) return;
        removeCustom(id);
        toast('已删除');
        viewSettings();
      });
    });
  }
  byId('btn-addterms').addEventListener('click', () => {
    const txt = byId('s-terms').value || '';
    const list = parseTermLines(txt);
    if (!list.length) { toast('先粘贴终端名', 'err'); return; }
    const res = addCustom(list);
    toast('新增 ' + res.added + ' 家' + (res.dup ? '，跳过重名 ' + res.dup + ' 家' : ''));
    viewSettings();
  });
  byId('btn-add155').addEventListener('click', () => {
    const res = addCustom([{ n: '潜力＜2000 终端汇总（155 家）', r: '未分配' }]);
    toast(res.added ? '已插入汇总行，去填报页可见' : '已存在，无需重复插入');
    viewSettings();
  });

  byId('btn-json').addEventListener('click', () => {
    download('终端填报备份_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ cfg: CFG, subs: SUBS }, null, 2), 'application/json');
  });
  byId('btn-import').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          let n = 0;
          Object.keys(d.subs || {}).forEach(id => {
            const rec = d.subs[id];
            if (!rec || !T_BY_ID[rec.id]) return;
            const old = SUBS[rec.id];
            if (!old || !old.ts || !rec.ts || rec.ts >= old.ts) { SUBS[rec.id] = rec; n++; }
          });
          persistSubs();
          toast('导入 ' + n + ' 条');
          viewSettings();
        } catch (e) { toast('文件格式不对', 'err'); }
      };
      rd.readAsText(f);
    });
    inp.click();
  });
  byId('btn-demo').addEventListener('click', () => { genDemo(); viewSettings(); });
  byId('btn-clear-demo').addEventListener('click', () => {
    let n = 0;
    Object.keys(SUBS).forEach(id => { if (SUBS[id].demo) { delete SUBS[id]; n++; } });
    persistSubs(); toast('已清除 ' + n + ' 条演示数据'); viewSettings();
  });
  byId('btn-clear').addEventListener('click', () => {
    if (!confirm('确定清空本机所有提交记录？此操作不可恢复，建议先导出备份。')) return;
    SUBS = {}; persistSubs(); toast('已清空'); viewSettings();
  });
}

/* ---------------- 11b. 终端名单解析 ---------------- */
function parseTermLines(txt) {
  const out = [];
  String(txt || '').split('\n').forEach(line => {
    const raw = line.trim();
    if (!raw) return;
    const f = raw.split(/[\t,，]/).map(x => x.trim()).filter(x => x !== '');
    if (!f.length) return;
    if (f.length >= 5) {
      out.push({ r: f[0], p: f[1], c: f[2], n: f[3], t: f[4], s: f[5] || '', pot: f[6] && !isNaN(Number(f[6])) ? Number(f[6]) : null });
    } else {
      out.push({ n: f[f.length - 1] });
    }
  });
  return out;
}

/* ---------------- 12. 演示数据 ---------------- */
function genDemo() {
  const names = ['张伟', '李娜', '王强', '陈静', '刘洋', '赵敏', '孙磊', '周婷', '郑凯', '何雪'];
  const types = CFG.types, tests = CFG.tests;
  let n = 0;
  TERMINALS.forEach((t, i) => {
    if (SUBS[t.id] && !SUBS[t.id].demo) return;
    if (Math.random() > 0.7) return;
    const pot = isNum(t.pot) ? t.pot : (2000 + Math.round(Math.random() * 80) * 100);
    const h = Math.max(0, Math.round(pot * (0.008 + Math.random() * 0.022)));
    const iv = Math.max(0, Math.round(pot * (0.008 + Math.random() * 0.022)));
    const tt = {};
    const k = 1 + Math.floor(Math.random() * 2);
    for (let j = 0; j < k; j++) {
      const nm = types[Math.floor(Math.random() * types.length)];
      tt[nm] = (tt[nm] || 0) + Math.round(6 + Math.random() * 40);
    }
    const tst = {};
    tests.forEach(nm => {
      const on = Math.random() > (nm.indexOf('耐药') >= 0 || nm.indexOf('肝弹性') >= 0 ? 0.62 : 0.3);
      tst[nm] = { on: on, ratio: on ? Math.round(40 + Math.random() * 58) : null };
    });
    SUBS[t.id] = {
      id: t.id, name: t.n, region: t.r, province: t.p, city: t.c, tier: t.t, spec: t.s,
      pot: pot, h: h, i: iv,
      ha: Math.round(70 + Math.random() * 30), ia: Math.round(65 + Math.random() * 33),
      noTreated: false, types: tt, tests: tst,
      reporter: names[i % names.length], note: '',
      ts: new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(), ver: 1, synced: false, demo: true
    };
    n++;
  });
  persistSubs();
  toast(n ? '已生成 ' + n + ' 条演示数据' : '演示数据已存在');
}

/* ---------------- 13. 启动 ---------------- */
(function boot() {
  if (!TERMINALS || !TERMINALS.length) {
    byId('view').innerHTML = '<div class="shell"><div class="card"><div class="empty">终端主数据未加载（terminals.js）</div></div></div>';
    return;
  }
  const qp = new URLSearchParams(location.search);
  const qsb = qp.get('sb'), qkey = qp.get('key');
  if (qsb && qkey) {
    CFG.sbUrl = qsb.replace(/\/+$/, '');
    CFG.sbKey = qkey;
    CFG.storage = 'supabase';
    saveCfg();
    qp.delete('sb'); qp.delete('key');
    const rest = qp.toString();
    try {
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    } catch (e) { }
    setTimeout(() => toast('已写入云端配置，去「报告」输口令试试'), 400);
  }
  const _up = normPeriod(qp.get('p'));
  PERIOD = _up || CFG.period || curPeriod();
  PERIOD_SRC = _up ? 'url' : (CFG.period ? 'cfg' : 'auto');
  RP = PERIOD;
  if (qp.get('demo') === '1' && doneCount() === 0) genDemo();
  if (!location.hash) location.hash = '#/fill';
  route();
})();
