/**
 * 基础工具与协议（编码/存档编解码/排名标签/数值基础/公式）
 *
 * 拓扑层 L1~L2，119 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, ARMOR_POOL, BASE_STATS, EQ_POW, QW_TABLE, bigIndexOf, ARRAY_COST, ART_PREFIX, ART_SPECIAL, ART_SUFFIX, AURA_COLORS, BIGS, BTL, BUFF_CAP_MS, CACHE_VER, CLD_ALPH, CLD_KEY, CUR_VER, DEV_KEY, DIMSTAT, EQUI_ICON, EQUI_SLOTI, FX_POOL, FX_TXT, G1_TPL, GAME_VER, JRN_TAIL, MATS, MIGRATIONS, MON_ATK_SCALE, MON_FX_POOL, MON_NAMES, MYST, PAGES_NEED, PEND_POOL, PLOT, QUALITY, RECIPES, RK_NAMES, RK_SEGS, SAVE_KEY, SCROLL_POOL, SEARCH_MAX, SEARCH_MIN, SEG_META, SKILL_DEFS, SKILL_MAX, SLOT_TYPES, SPIRIT_RATE, STORY_BY_KEY, STORY_BY_SID, TRACE_ACT, TRAVEL_FIRST_MAX, TRAVEL_FIRST_STEP, TRAVEL_FIRST_WINDOW, TRAVEL_LATE_STEP, TRAVEL_SPAN, ZONES, __set_alTipT, __set_hbFails, __set_kicked, __set_parts, __set_tracePool, _dsp, _hbFails, _kicked, _lastPick, _pred, _settling, _srvOffset, _tracePool, alIcoCls, alTipT, autoHuntOn, capDeviceDpr, cauldron, cld, cldApiBase, cnNum, durTxt, eqMult, esc, fin, finalStats, fmt, fxAgg, fxCount, fxValue, g1b64, g1merge, g1prune, g1unb64, parts, seekHide, selRecipe, state } from './00-pure.js';

(function () {
  const vt = document.getElementById("verTag"); if (vt) vt.textContent = GAME_VER;
  const sv = document.getElementById("spVer"); if (sv) sv.textContent = GAME_VER;
  document.title = "闲人修仙 " + GAME_VER;
})();

const SND = (function () {
  /* v1.7.60: 音乐与音效拆成两个独立开关。
   * 旧版只有一个 dt_snd, 首次升级时音乐沿用它的值, 不改变玩家原有感受。 */
  const LS_BGM = "dt_bgm", LS_SFX = "dt_snd";
  function lsOn(key, fallbackKey) {
    try {
      let v = localStorage.getItem(key);
      if (v === null && fallbackKey) v = localStorage.getItem(fallbackKey);
      return v !== "0";
    } catch (e) { return true; }
  }
  let bgmOn = lsOn(LS_BGM, LS_SFX);
  let sfxOn = lsOn(LS_SFX);
  /* v1.7.62 硬静音(黑屏挂机用): 期间 BGM 一律停, 回前台也不自动恢复。 */
  let hardMute = false;
  function silent() {
    if (hardMute) return true;
    try { return document.hidden; } catch (e) { return false; }
  }
  let bgmEl = null;
  /* v1.7.60: 页面不可见时不播 BGM —— 修掉"切到后台音乐还在响" */
  function _bgmPlay() {
    if (!bgmOn || !bgmEl || silent()) return;
    const p = bgmEl.play(); if (p && p.catch) p.catch(() => {});
  }
  /* 切后台: 停 BGM; 回前台: 恢复(硬静音期间除外) */
  function suspendAll() {
    if (bgmEl) { try { bgmEl.pause(); } catch (e) {} }
  }
  function resumeAll() {
    if (silent()) return;          // 硬静音(挂机中)时, 回前台也不恢复
    if (bgmOn) _bgmPlay();
  }
  function _armBgm() {
    try {
      bgmEl = new Audio("assets/music/bgm.mp3?v=" + CACHE_VER);   // v2.3: BGM 缓存戳统一用全局版本号
      bgmEl.loop = true; bgmEl.volume = 0.9; bgmEl.preload = "auto";   // v1.7.53: 0.32→0.9(手机最大音量仍偏小的反馈)
      bgmEl.addEventListener("error", () => {          // 文件不存在/解码失败: 放弃, 不反复打扰
        bgmEl = null;
        document.removeEventListener("pointerdown", _armOnce);
        document.removeEventListener("keydown", _armOnce);
      });
      /* v1.7.45 兜底: 个别安卓 WebView 对 HTMLAudio.loop 支持不严, 播完即停 →
       * ended 时手动归零重播; loop 正常工作的浏览器不会触发 ended, 二者互不干扰 */
      bgmEl.addEventListener("ended", () => {
        if (!bgmOn || !bgmEl) return;
        try { bgmEl.currentTime = 0; const p = bgmEl.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      });
    } catch (e) { return; }
    const _armOnce = () => { _bgmPlay(); };
    document.addEventListener("pointerdown", _armOnce);
    document.addEventListener("keydown", _armOnce);
    _bgmPlay();                                        // 立即尝试; 浏览器允许则无需任何点击
  }
  /* v6.10 PERF: 统一 SFX 播放层。
   * 之前战斗里 14 只怪同时攻击/受击, 每只都 new Audio().play(), 手机音频硬件被反复唤醒。
   * 现在走这里统一节流:
   *   - 全局最多 4 个 SFX 同时在播(超出直接丢, 不排队)
   *   - 同名音效最小间隔 50ms(防止同一帧 14 只怪同时播 slime_attack)
   *   - 播完/失败自动回收计数
   * BGM 不经过这里(它是长循环, 单独管)。 */
  let _sfxActive = 0;
  const _sfxLast = new Map();
  const SFX_MAX = 4;
  const SFX_GAP = 50;
  function playSfxAudio(a, vol, rate) {
    if (!a) return;
    if (!sfxOn || hardMute) return;
    try { if (document.hidden) return; } catch (e) {}
    if (_sfxActive >= SFX_MAX) return;
    const key = a.src || 'anon';
    const now = performance.now();
    if (now - (_sfxLast.get(key) || 0) < SFX_GAP) return;
    _sfxLast.set(key, now);
    _sfxActive++;
    a.volume = vol || 0.6;
    if (rate) { try { a.playbackRate = rate; } catch (e) {} }
    try { a.currentTime = 0; } catch (e) {}
    const done = () => { _sfxActive = Math.max(0, _sfxActive - 1); };
    const p = a.play();
    if (p && p.then) p.then(done).catch(done); else done();
  }
  return {
    get bgmOn() { return bgmOn; },
    get sfxOn() { return sfxOn && !hardMute; },
    setBgm(v) {
      bgmOn = !!v; try { localStorage.setItem(LS_BGM, bgmOn ? "1" : "0"); } catch (e) {}
      if (bgmOn) {
        if (!bgmEl) _armBgm();    /* bgmEl 因解码错误被销毁时重建; 不复用已存在实例(避免叠加爆红) */
        _bgmPlay();
      } else if (bgmEl) { try { bgmEl.pause(); } catch (e) {} }
    },
    setSfx(v) { sfxOn = !!v; try { localStorage.setItem(LS_SFX, sfxOn ? "1" : "0"); } catch (e) {} },
    suspend() { suspendAll(); },                 // 供原生层 / 黑屏挂机调用
    resume() { resumeAll(); },
    /* v1.7.62 硬静音开关: 挂机期间置 true, 任何音效都不会把上下文救活 */
    mute(v) { hardMute = !!v; if (hardMute) suspendAll(); else resumeAll(); },
    get muted() { return hardMute; },
    /* v6.10: 统一 SFX 入口, 战斗层所有 Audio.play() 都走这里 */
    play: playSfxAudio,
    /* initFiles 名字沿用旧接口; 现在只负责拉起 BGM 与页面可见性联动 */
    initFiles() {
      /* BGM: 直接建 Audio 立即试播(允许时刷新即响), 被浏览器拦截则等首次点击/按键再播;
       * 文件缺失/解码错误会触发 error 自动停手, 不产生噪音重试 */
      _armBgm();
      /* v1.7.60: 切后台停音乐(修"最小化还在响"), 回前台恢复 */
      try {
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) suspendAll(); else resumeAll();
        });
        window.addEventListener("pagehide", suspendAll);
      } catch (e) {}
    },
  };
})();

window.__sndSuspend = () => { try { SND.suspend(); } catch (e) {} };

window.__sndResume = () => { try { SND.resume(); } catch (e) {} };

SND.initFiles();

const TOTAL_SEGS = BIGS.reduce((s, b) => s + b.segs, 0);

function seg(i) { return SEG_META[Math.min(i, TOTAL_SEGS - 1)]; }

function adopt(s) {
  if (!s || !Array.isArray(s.arts)) return null;
  if (!Array.isArray(s.journal)) s.journal = [];
  if (!s.milestones || typeof s.milestones !== "object") s.milestones = {};
  s.peakSpirit = fin(s.peakSpirit, 0);
  s.bestArtQ = fin(s.bestArtQ, -1);
  s.realmIdx = Math.max(0, Math.min(TOTAL_SEGS - 1, Math.floor(fin(s.realmIdx, 0))));
  s.exp = Math.max(0, fin(s.exp, 0));
  s.spirit = Math.max(0, fin(s.spirit, 0));
  s.arrayLv = Math.max(1, Math.floor(fin(s.arrayLv, 1)));
  s.lastTs = fin(s.lastTs, Date.now());
  if (!s.mats || typeof s.mats !== "object") s.mats = {};
  if (!s.pills || typeof s.pills !== "object") s.pills = {};
  if (!Array.isArray(s.buffs)) s.buffs = [];
  /* v5.6 旧结构迁移(幂等): offPills / offlineBoostUntil / trialBoost+Until → 统一 buffs 条目,
   * 转完旧字段清零 —— buffs 从此是加成的唯一来源, 后端只认这一张表。 */
  if (!Array.isArray(s.offPills)) s.offPills = [];
  for (const p of s.offPills) {
    if (p && typeof p === "object" && (p.boost || 0) > 0 && (p.until || 0) > Date.now())
      s.buffs.push({ tag: "pill", mult: 1, boost: Math.min(1, Math.max(0, fin(p.boost, 0))),
        name: (typeof p.name === "string" ? p.name : "").slice(0, 12),
        start: Math.max(0, fin(p.start, 0)), until: Math.max(0, fin(p.until, 0)) });
  }
  s.offPills = [];
  if ((s.offlineBoostUntil || 0) > Date.now()) {
    s.buffs.push({ tag: "pill", mult: 1, boost: bigIndexOf(s.realmIdx || 0) >= 11 ? 0.5 : 0.3, name: "洗髓丹",
      start: Date.now(), until: s.offlineBoostUntil });
    s.offlineBoostUntil = 0;
  }
  if ((s.trialBoostUntil || 0) > Date.now() && (s.trialBoost || 0) > 0) {
    s.buffs.push({ tag: "trial", mult: 1, boost: Math.min(1.8, Math.max(0, fin(s.trialBoost, 0))), name: "兽潮余威",
      start: Date.now(), until: s.trialBoostUntil });
    s.trialBoost = 0; s.trialBoostUntil = 0;
  }
  s.buffs = s.buffs.filter(b => b && typeof b === "object").map(b => ({
    tag: b.tag === "trial" ? "trial" : "pill", mult: Math.min(10, Math.max(1, fin(b.mult, 1))),
    boost: b.boost ? Math.min(2, Math.max(0, fin(b.boost, 0))) : 0,
    name: (typeof b.name === "string" ? b.name : "").slice(0, 12),
    start: Math.max(0, fin(b.start, 0)), until: Math.max(0, fin(b.until, 0)),
  })).filter(b => b.mult > 1 || b.boost > 0);
  s.offlineBoostUntil = Math.max(0, fin(s.offlineBoostUntil, 0));
    /* v3.9 妖潮试炼: 纪录 + 离线收益加成(120s 击杀纪录 → 补偿档位) */
  s.trialBest = Math.max(0, Math.floor(fin(s.trialBest, 0)));
  s.trialBoost = Math.min(1.80, Math.max(0, fin(s.trialBoost, 0)));   /* v5.1 封顶180%(120只×1%+BOSS60%) */
  s.trialBoostUntil = Math.max(0, fin(s.trialBoostUntil, 0));
  if (!s.travel || typeof s.travel !== "object") s.travel = null;
  /* v1.8.5 化身行囊: 信匣满后由服务端 stayTravel 攒进 travel.bag。
   * adopt 是白名单式的"规整"而非深拷贝原样保留 —— 显式归一 bag/bagPages,
   * 免得服务端下发的行囊在本地被当作脏字段丢掉(云游面板要显示"行囊在攒")。 */
  if (s.travel) {
    s.travel.since = fin(s.travel.since, Date.now());
    if (s.travel.mailAt) s.travel.mailAt = fin(s.travel.mailAt, 0);
    s.travel.bag = Array.isArray(s.travel.bag)
      ? s.travel.bag.filter(x => x && typeof x.id === "string" && fin(x.q, 0) > 0)
          .map(x => ({ id: x.id, q: Math.round(fin(x.q, 0)) }))
      : [];
    s.travel.bagPages = Math.max(0, Math.round(fin(s.travel.bagPages, 0)));
  }
  if (!Array.isArray(s.mails)) s.mails = [];
  /* v1.10.0: 历史档迁移(六槽→四部位/缺属性老件确定性补全)已随旧档退役 —— adopt 只做
   * 「schema v1 结构的防御性规整」: 类型钳制 + 缺省补默认, 不再背负任何代际转换。 */
  if (Array.isArray(s.arts)) {
    s.arts.forEach(a => {
      if (!a || typeof a !== "object") return;
      a.slot = Math.min(3, Math.max(0, fin(a.slot, 0)));
      a.q = Math.min(5, Math.max(0, fin(a.q, 0)));
      a.lv = Math.max(1, Math.floor(fin(a.lv, 1)));
      a.mult = fin(a.mult, (QUALITY[a.q] || QUALITY[0]).mult);   // 防 NaN 污染收益链
      a.a = Math.max(0, fin(a.a, 0)); a.d = Math.max(0, fin(a.d, 0)); a.h = Math.max(0, fin(a.h, 0));
    });
  }
  if (!s.pages || typeof s.pages !== "object") s.pages = {};
  if (typeof s.name !== "string" || s.name.length > 20) s.name = "";
  s._pn = typeof s._pn === "string" ? s._pn : "";
  return s;
}

function renderPName() {
  const el = $("pName"); if (!el) return;
  const nm = (state.name || "").trim();
  el.textContent = nm || "定道号";
  el.classList.toggle("named", !!nm);
  el.title = nm ? "道号 · " + nm + "（点此改）" : "尚未定道号 · 点此起名（全服唯一；换设备寻档仍用玩家码）";
}

function apiRoot() { try { return CLD_API.replace(/\/api\/save$/, ""); } catch (e) { return "https://save.devgo.cn"; } }

function openRename() {
  const m = $("renameModal"); if (!m) return;
  const inp = $("renameInput"); if (inp) inp.value = (state.name || "").trim() || "";
  const h = $("renameHint");
  if (h) h.textContent = state.name
    ? "道号全服唯一：改名会立即与云端确认，被占用会提示换名。道号仅作风云榜留名，寻档仍请使用玩家码。"
    : "道号是你在洞天的名号（全服唯一），定名后会在风云榜留名。请务必保管好玩家码——寻档只认玩家码，道号不能反查存档。";
  m.classList.add("show");
  if (inp) setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 80);
}

function closeRename() { const m = $("renameModal"); if (m) m.classList.remove("show"); }

function rkSegLabel(rid) {
  let r = Math.max(0, Math.floor(rid || 0)), bi = 0;
  while (bi < 11 && r >= RK_SEGS[bi]) { r -= RK_SEGS[bi]; bi++; }
  if (bi === 0) return "凡人";
  const base = RK_SEGS.slice(0, bi).reduce((a, b) => a + b, 0);
  const pos = Math.max(0, Math.floor(rid || 0)) - base;
  if (bi === 1) return "炼气 " + (pos + 1) + " 层";
  return RK_NAMES[bi] + "·" + ["前期", "中期", "后期", "圆满"][Math.min(3, pos)];
}

function closeRank() { const m = $("rankModal"); if (m) m.classList.remove("show"); }

async function g1Pack(o) {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([JSON.stringify(g1prune(o, G1_TPL) ?? {})]).stream().pipeThrough(cs);
  return "g1:" + g1b64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function g1Unpack(s) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([g1unb64(s.slice(3))]).stream().pipeThrough(ds);
  return g1merge(JSON.parse(await new Response(stream).text()), G1_TPL);
}

function trimJr(list) {
  if (!Array.isArray(list) || list.length <= JRN_TAIL) return list;
  const keep = [];
  let tail = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const j = list[i];
    if (j && j.sid) { keep.unshift(j); continue; }   // 主线: 判重依据, 永不裁
    if (++tail <= JRN_TAIL) keep.unshift(j);         // 叙事: 只留最近 30 条
  }
  return keep;
}

function trimJournal() {
  if (Array.isArray(state.journal)) state.journal = trimJr(state.journal);
}

function migrate(s) {
  if (!s || typeof s !== "object") return s;
  let v = (typeof s.ver === "number" && s.ver >= 1) ? Math.floor(s.ver) : 1;
  while (v < CUR_VER) {
    const fn = MIGRATIONS[v + 1];
    if (!fn) break;
    s = fn(s) || s; s.ver = v + 1; v++;
  }
  s.ver = CUR_VER;
  return s;
}

const CLD_API = cldApiBase();

function deviceId() {
  let d = "";
  try { d = localStorage.getItem(DEV_KEY) || ""; } catch (e) {}
  if (!d) {
    d = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem(DEV_KEY, d); } catch (e) {}
  }
  return d;
}

function srvNow() { return Date.now() + _srvOffset; }

function hbFail() {
  if (__set_hbFails(_hbFails + 1) < 3) return;
  const ov = document.getElementById("netOverlay");
  if (ov) ov.classList.add("show");
}

function cldId() {
  if (cld.id) return cld.id;
  try { cld.id = localStorage.getItem(CLD_KEY) || ""; } catch (e) {}
  if (!cld.id) {
    let s = "";
    for (let i = 0; i < 12; i++) s += CLD_ALPH[Math.floor(Math.random() * CLD_ALPH.length)];
    cld.id = "dt-" + s;
    try { localStorage.setItem(CLD_KEY, cld.id); } catch (e) {}
  }
  return cld.id;
}

function cldApi(method, body, extraQ) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 6000);   // 6s 超时, 弱网不阻塞启动/离线结算
  return fetch(CLD_API + "?id=" + encodeURIComponent(cldId()) + "&device=" + encodeURIComponent(deviceId()) + (extraQ ? "&" + extraQ : ""), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: ctl.signal,
  }).then(r => { clearTimeout(tm); if (!r.ok) throw new Error("http" + r.status); return r.json(); })
    .catch(e => { clearTimeout(tm); throw e; });
}

function cldChip() { return $("cloudTxt"); }

function cldUI(mode) {
  const chip = $("cloudChip");
  if (!chip) return;
  chip.classList.remove("on", "off", "sync");
  chip.classList.add(mode);
  const el = cldChip();
  if (!el) return;
  if (mode === "sync") el.textContent = "云存·同步中";
  else if (mode === "off") el.textContent = "云存·未连接";
  else {
    const d = Date.now() - cld.lastOkTs;
    el.textContent = "云存·✓ " + (d < 60000 ? "刚才" : Math.floor(d / 60000) + "分前");
  }
  const idEl = $("cloudId");
  if (idEl) idEl.textContent = cldId();
}

let _cldFlashT = 0;

function cldFlash(txt) {
  clearTimeout(_cldFlashT);
  const el = cldChip();
  if (!el) return;
  const old = el.textContent;
  el.textContent = txt;
  _cldFlashT = setTimeout(() => { el.textContent = old; }, 1600);
}

function cloudSoon() { cld.dirty = true; }

function cloudTogglePanel(ev) {
  ev = ev || window.event;
  if (ev) ev.stopPropagation();
  const p = $("cloudPanel");
  if (!p) return;
  const show = p.classList.toggle("show");
  if (show) { const inp = $("cloudInput"); if (inp) inp.value = ""; }
}

function cloudNew() {
  if (!confirm("确定要新建存档吗？\n\n当前玩家码和本地进度将被清空，新玩家码会自动生成。\n原玩家码仍可通过「换存档」重新绑定找回。")) return;
  let s = "";
  for (let i = 0; i < 12; i++) s += CLD_ALPH[Math.floor(Math.random() * CLD_ALPH.length)];
  const newId = "dt-" + s;
  /* ⚠️⚠️ v8.4 致命 BUG 修复(勿回退) —— "新建存档建不出来" 的根因:
   * 旧实现是【先换ID、删本地档, 然后 location.reload()】。但 reload 会触发
   * pagehide 事件, 而 40-app.js 里挂的是 `pagehide → save(); cloudFlush()`——
   * 此刻内存里的 state 仍是【旧存档】, save() 立刻把旧档原样写回 SAVE_KEY,
   * 于是刚删掉的档又被写了回来 → 新档一出生就带着旧进度。
   *
   * 更糟的是第二步: 启动时 bootCloud() 走 cldPull(true, true)(服务器权威),
   * 新玩家码在云端没有档 → 落到"建档上传"分支 → 把这份刚被写回的旧档
   * 【以新玩家码的名义上传成云端档】→ 旧进度彻底"遗传"给新档, 不可逆。
   *
   * 正确顺序: ① 先摘掉 pagehide 落盘路径(置 reloading 标志) ② 换ID
   * ③ 删本地档 ④ 再 reload。页面重载后 state 从空档重建, bootCloud 的
   * cldPush 上传的就是干净的新档。 */
  window.__reloading = true;                 /* ① 先关掉 pagehide/定时器的落盘通道 */
  try {
    localStorage.setItem(CLD_KEY, newId);
    localStorage.removeItem(SAVE_KEY);       /* ② ③ */
  } catch (e) {}
  cld.id = newId; cld.ready = false; cld.dirty = false;
  location.reload();
}

function artMult() { /* v1.9.9 累乘→弱化加算: 4件玄天级(3.8)从 55x 压到 3.5x, 6件从 3011x 压到 6.9x —— 累乘乘区随装备成长指数爆炸(实测 42h 炼气→化神圆满), 需求曲线追不上; 同式已同步服务端 game-core.js rateNowOf */
  return 1 + state.arts.reduce((m, a) => m + ((a.mult || 1) - 1), 0) * 0.12;
}

let _buffCache = null;
let _buffCacheT = 0;

function buffMult() {
  const now = Date.now();
  if (_buffCache && now - _buffCacheT < 500) return _buffCache;
  const t = now;
  /* v1.9.0: 清理只丢"已过期"的; 累加出来的多段同 mult 药力一律保留 ——
   * 它们共同构成 24 小时的总时长, 提前合并会丢掉时长信息。 */
  state.buffs = (state.buffs || []).filter(b => (b.until || 0) > t);
  /* v5.6: 每条按 24h 上限裁切(与服务端 sanitize 同口径)。不再按 mult 合并重组 ——
   * 重组会把 boost/tag/name 等通用 Buff 协议字段压掉(离线丹力/兽潮余威依赖它们)。 */
  for (const b of state.buffs) {
    if (b.start && b.until - b.start > BUFF_CAP_MS) b.until = b.start + BUFF_CAP_MS;
    if (typeof b.mult !== "number" || !isFinite(b.mult)) b.mult = 1;
  }
  // 药力相冲，只取当前最强的一道（防 buff 叠乘指数爆炸）; boost 条目 mult=1 不参与
  if (!state.buffs.length) { _buffCache = 1; _buffCacheT = now; return 1; }
  const result = Math.max(1, ...state.buffs.map(b => fin(b.mult, 1)));
  _buffCache = result;
  _buffCacheT = now;
  return result;
}

function spiritRate() { return SPIRIT_RATE(state.arrayLv); }

function setRealmSub(a, b) {            // v1.7.28: 小字段位/说明 分行(不挤压截断)
  const A = $("realmSubA"), B = $("realmSubB");
  if (A) A.textContent = a || "";
  if (B) B.textContent = b || "";
}

function tickDsp(dt) {
  const k = Math.min(1, dt * 5);
  _dsp.spirit += (state.spirit - _dsp.spirit) * k;
  _dsp.exp += (state.exp - _dsp.exp) * k;
  if (Math.abs(state.spirit - _dsp.spirit) < 0.5) _dsp.spirit = state.spirit;
  if (Math.abs(state.exp - _dsp.exp) < 0.5) _dsp.exp = state.exp;
}

function 段名(r) {
  if (r.big === "凡人") return "";
  if (r.big === "炼气") return cnNum(r.segNo) + "层";
  return r.label.split("·")[1];
}

function arrayCostNow() { return ARRAY_COST(state.arrayLv); }

function pushMsg(side, html) {
  const box = $((side === "main") ? "mainFeed" : "avatarFeed");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "fmsg";
  el.innerHTML = html;
  box.insertBefore(el, box.firstChild); // column-reverse 下: 新消息出现在视觉底部
  const cap = (side === "main") ? 6 : 5;
  // 超过条数上限：最旧一条立即淡出，形成"字幕滚动"节奏
  if (box.children.length > cap) {
    const old = box.lastChild;
    old.style.transition = "opacity .55s ease";
    old.style.opacity = "0";
    setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 560);
  }
  // 驻留时长：主线适中、分身更快
  const life = (side === "main") ? 11500 : 6000;
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, life + 300);
}

(function () {
  let sid = 0;
  for (const vol of PLOT) for (const b of vol) {
    b.sid = ++sid;
    STORY_BY_SID[sid] = b;
    STORY_BY_KEY[b.key] = b;
  }
})();

function storyResolve(j) {          // journal 条目 → 剧情内容(数字引用还原 / 旧档直读)
  if (j && j.sid && STORY_BY_SID[j.sid]) return STORY_BY_SID[j.sid];
  return j;
}

function journalHasKey(b) {         // 兼容新旧两种记录格式
  return state.journal.some(j => (j.sid && j.sid === b.sid) || (j.key && j.key === b.key));
}

function closeStory() {
  const m = $("storyModal");
  if (m) m.classList.remove("show");
}

function storyItemHtml(j) {
  const pad = n => String(n).padStart(2, "0");
  const rec = storyResolve(j);                       // sid → 静态剧情; 老档/动态事件直接读自身
  const tm = new Date(j.ts);
  const big = j.big || rec.big || "";
  const kind = j.kind || rec.kind || "际遇";
  return `<div class="j-card k-${esc(kind)}">` +
    `<div class="j-head"><span class="j-big">${esc(big)}</span>` +
    `<span class="j-kind k-${esc(kind)}">${esc(kind)}</span>` +
    `<span class="j-time">${pad(tm.getMonth() + 1)}-${pad(tm.getDate())} ${pad(tm.getHours())}:${pad(tm.getMinutes())}</span></div>` +
    `<h5>${esc(rec.title || j.title || "仙途拾遗")}</h5><p>${esc(rec.text || j.text || "")}</p></div>`;
}

function pickNoRepeat(arr, key) {
  const banned = _lastPick[key] || (_lastPick[key] = []);
  const cand = [];
  for (let i = 0; i < arr.length; i++) if (!banned.includes(i)) cand.push(i);
  const pool = cand.length ? cand : arr.map((_, i) => i);
  const idx = pool[(Math.random() * pool.length) | 0];
  banned.push(idx); if (banned.length > 5) banned.shift();
  return arr[idx];
}

/* v3.2: #burst 已并入统一舞台 #stage。
 * 独立模式（调试页）下仍要求存在 #burst；舞台模式下由外部注入 ctx，这里允许为 null。 */
const bcv = $("burst");
const bctx = bcv ? bcv.getContext("2d") : null;

function sizeBurst() { if (bcv) { bcv.width = innerWidth; bcv.height = innerHeight; } }

function burstBoom() {
  /* v4.1: canvas 粒子已退役（渲染栈统一 WebGL）—— 破境特效由 flash 白闪 +
   * realmUp 弹字（DOM 动画）承担，保留导出签名兼容调用点。 */
}

/* 爆发粒子层。
 *   tickBurst(dt)                    —— 独立模式：画到 #burst 自己的 canvas
 *   tickBurst(dt, { ctx, W, H })     —— 舞台模式（v3.2）：画到统一舞台的 ctx
 * 舞台模式下不能 clearRect（会抹掉背景/战斗/灵气），粒子自然衰减到 0 即可。
 * ⚠️ dt 一律是【原始 dt】，本层不吃身法倍速。 */
function tickBurst(dt, target) {
  if (!parts.length) return;
  __set_parts(parts.filter(p => p.life > 0));
  const tctx = (target && target.ctx) || bctx;
  if (!tctx) return;
  const W = (target && target.W) || (bcv ? bcv.width : innerWidth);
  const H = (target && target.H) || (bcv ? bcv.height : innerHeight);
  if (!parts.length) { if (!target) tctx.clearRect(0, 0, W, H); return; }
  if (!target) tctx.clearRect(0, 0, W, H);
  tctx.globalCompositeOperation = "lighter";
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += .09; p.life -= dt * 1.2;
    tctx.fillStyle = `rgba(${p.color},${Math.max(0, p.life)})`;
    tctx.beginPath(); tctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, 7); tctx.fill();
  }
  tctx.globalCompositeOperation = "source-over";
}

function closeOffline() { const m = $("offlineModal"); if (m) m.classList.remove("show"); }

/* v3.2：统一舞台模式下，fx2d 不再自建 #cultFx（那是第 3 张全屏画布），
 * 改为返回一个符合 60-stage 契约的层对象 { name, draw(ctx,W,H,dt) }。
 * standalone 版保留，供单独调试页使用。 */
function initFxLayer() {
  const cult = document.getElementById("cult");
  if (!cult || document.getElementById("cultFx")) return null;
  const cv = document.createElement("canvas");
  cv.id = "cultFx";
  cv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;"
    + "pointer-events:none;z-index:3;animation:breath 4.6s ease-in-out infinite";
  cult.appendChild(cv);
  import('../fx2d.js?v=' + CACHE_VER)
    .then(m => { try { m.initFx(cv); } catch (e) { console.error("[fx2d] init:", e); } })
    .catch(e => console.error("[fx2d] load:", e));
  return null;
}

/* v3.3 丹田光华（原「旋臂星点带」，旋臂已删，只留中心那点金光）。
 * 舞台模式下作为层交给 60-stage；standalone 版 initFxLayer 供单独调试页用。 */
function createFxLayer() {
  return import('../fx2d.js?v=' + CACHE_VER)
    .then(m => { try { return m.createFxLayer(); } catch (e) { console.error("[fx2d] layer:", e); return null; } })
    .catch(e => { console.error("[fx2d] load:", e); return null; });
}

async function initBg() {
  try { await initBg2D(); }
  catch (e) { console.warn("背景初始化失败，CSS 兜底", e); document.body.classList.add("no-webgl"); }
}

/* 背景层。舞台模式下 canvas 是统一的 #stage，本层只返回绘制器，
 * 不接管 canvas 尺寸、不自持 rAF（managed: true）。 */
async function initBg2D(sharedCanvas) {
  const canvas = sharedCanvas || $("bg");
  if (!canvas) return null;
  const mod = await import('../bg.js?v=' + CACHE_VER);
  if (sharedCanvas) return mod.initDeepSpace(canvas, { managed: true });
  window.__bgCtrl = await mod.initDeepSpace(canvas);
  return null;
}

/* v3.2：一次性建好统一舞台的所有层并交给 60-stage。
 * 顺序即绘制顺序（后者盖前者）：bg → battle → aura → burst。
 * battle 层由 50-battle.js 提供，在 40-app.js 里装配时补入。 */
async function createStageLayers(stageCanvas) {
  const bgLayer = await initBg2D(stageCanvas);
  return { bgLayer };
}

let _auraCv, _auraCtx, _auraP = [], _auraT = 0, _auraColor = AURA_COLORS[0].slice(), _auraAcc = 0;

/* v3.2 舞台模式：灵气层不再自持 canvas，绘制由 60-stage 统一驱动。
 * standalone 版仍保留，供单独调试页使用。 */
function initAura(sharedCtx) {
  if (sharedCtx) {
    __set_auraCtx(sharedCtx);
    __set_auraCv(null);
    _auraP.length = 0;                       // 就地清空：_auraP 是模块级绑定，
                                             // 重新赋值需要 __set_ 包装，数组清空则不用
    for (let i = 0; i < 36; i++)
      _auraP.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, r: 1+Math.random()*2.4, s: 8+Math.random()*22, a: .25+Math.random()*.5, ph: Math.random()*7 });
    return true;
  }
  __set_auraCv($("aura")); if (!_auraCv) return false;
  __set_auraCtx(_auraCv.getContext("2d"));
  const fit = () => {
    const dpr = capDeviceDpr();                    // v1.7.20 PERF-2: 低端收敛
    _auraCv.width = innerWidth * dpr; _auraCv.height = innerHeight * dpr;
    _auraCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit(); addEventListener("resize", fit);
  for (let i = 0; i < 36; i++)
    _auraP.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, r: 1+Math.random()*2.4, s: 8+Math.random()*22, a: .25+Math.random()*.5, ph: Math.random()*7 });
  return true;
}

function zoneOfBig(bi) { const z = ZONES[bi]; return z ? z : ZONES[ZONES.length - 1]; }

function zoneOfLoc(id) { for (const z of ZONES) if (z.locs.some(l => l.id === id)) return z; return null; }

function locById(id) { for (const z of ZONES) { const l = z.locs.find(x => x.id === id); if (l) return l; } return null; }

function travelBtnLbl() {
  const b = $("btnTravel"); if (!b) return;
  const lb = b.querySelector(".label"); if (!lb) return;
  if (state.travel) {
    const l = locById(state.travel.loc);
    lb.innerHTML = "云游中";
    b.classList.add("traveling");
    b.title = l ? "化身正于 " + l.n : "化身在外游历";
  } else { lb.innerHTML = "云游"; b.classList.remove("traveling"); b.title = ""; }
}

function matBagHTML() {
  const own = Object.keys(MATS).filter(k => ((state.mats || {})[k] || 0) > 0);
  if (!own.length) return `<div class="al-sec">行囊 · 手头材料</div><div class="al-empty">行囊空空——遣化身出门云游，可捎回药草灵石。</div>`;
  const chips = own.map(k => `<span class="al-bagchip" title="${MATS[k].n} · ${MATS[k].src}">${MATS[k].n}<b>×${state.mats[k]}</b><i class="t">${MATS[k].t}</i></span>`).join("");
  return `<div class="al-sec">行囊 · 手头材料 <i>尚未采到的不在此列</i></div><div class="al-bag">${chips}</div>`;
}

function pillCabinetHTML() {
  const pk = Object.keys(state.pills || {}).filter(id => RECIPES[id]);
  if (!pk.length) return `<div class="al-sec">丹药匣</div><div class="al-empty">尚无丹药——材料齐了即可开炉。</div>`;
  const row = pk.map(id => {
    const rp = RECIPES[id];
    const fn = rp.d.split("：").pop();          // v1.9.9: 服用信息(效果摘要), 图标下方两行截断
    return `<span class="al-pill" title="${rp.d}">${pillIco(id, 44)}<span class="nm">${rp.n}</span><span class="fx">${fn}</span><b>×${state.pills[id]}</b><button class="take" onclick="consumePill('${id}')">服</button></span>`;
  }).join("");
  return `<div class="al-sec">丹药匣 <i>点“服”即用</i></div><div class="al-grid">${row}</div>`;
}

function closeAlchemy() { const m = $("alchemyModal"); if (m) m.classList.remove("show"); }

const alHave = m => (state.mats || {})[m] || 0;

const alInFurn = m => cauldron[m] || 0;

const alIco = (m, sz) => `<span class="ico ${alIcoCls(MATS[m].t)}"${sz ? ` style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .45)}px"` : ""}><img class="icoim" src="assets/modals/ico/${m}.webp" alt="" onerror="this.remove()">${MATS[m].n[0]}</span>`;

const pillIco = (id, sz) => `<span class="ico pillbg"${sz ? ` style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .45)}px"` : ""}><img class="icoim" src="assets/modals/ico/${id}.webp" alt="" onerror="this.remove()">${RECIPES[id].n[RECIPES[id].n.length - 2] || "丹"}</span>`;

const recipeCan = id => Object.keys(RECIPES[id].need).every(m => alHave(m) >= RECIPES[id].need[m]);

function renderFurn() {
  const el = $("furnSlots"); if (!el) return;
  const mids = Object.keys(cauldron).filter(m => cauldron[m] > 0);
  let h = mids.map(m => `<div class="slot" title="${MATS[m].n} · 点之退回" onclick="takeMat('${m}')">
      ${alIco(m, 34)}<b>×${cauldron[m]}</b></div>`).join("");
  for (let i = mids.length; i < 3; i++) h += `<div class="slot"><em>空</em></div>`;
  el.innerHTML = h;
}

function renderBag() {
  const nEl = $("bagN"), el = $("bagGrid"); if (!el) return;
  const own = Object.keys(MATS).filter(m => alHave(m) > 0);
  if (nEl) nEl.textContent = `${own.length} / ${Object.keys(MATS).length}`;
  let h = own.map(m => `<div class="cell" title="${MATS[m].n} · ${MATS[m].src}" onclick="putMat('${m}')">
      ${alIco(m)}<b>×${alHave(m) - alInFurn(m)}</b></div>`).join("");
  const pad = (3 - own.length % 3) % 3;
  for (let i = 0; i < pad + 3; i++) h += `<div class="cell empty"><em>空</em></div>`;
  el.innerHTML = h;
}

function renderCabinet() {
  const wrap = $("cabWrap"), el = $("cabGrid"); if (!el) return;
  const pk = Object.keys(state.pills || {}).filter(id => RECIPES[id] && state.pills[id] > 0);
  if (wrap) wrap.style.display = pk.length ? "" : "none";
  el.innerHTML = pk.map(id => {
    const rp = RECIPES[id];
    const fn = rp.d.split("：").pop();          // v1.9.9: 服用信息行
    return `<div class="pillb" title="${rp.d}" onclick="consumePill('${id}')">
      ${pillIco(id)}<span class="nm">${rp.n}</span><span class="fx">${fn}</span><b>×${state.pills[id]}</b><em>服</em></div>`;
  }).join("");
}

function fitsRecipe() {
  if (!selRecipe) return false;
  const need = RECIPES[selRecipe].need, ks = Object.keys(need);
  return ks.every(m => alInFurn(m) === need[m]) && Object.keys(cauldron).filter(m => cauldron[m] > 0).length === ks.length;
}

function alTip(id, m) {
  const el = $(id), M = MATS[m];
  if (!el || !M) return;
  el.innerHTML = `<b>${M.n}</b><i>${M.t} · ${M.src}</i>`;
  el.classList.add("on");
  clearTimeout(alTipT);
  __set_alTipT(setTimeout(() => el.classList.remove("on"), 1500));
}

function closeTravel() { const m = $("travelModal"); if (m) m.classList.remove("show"); }

function travelMailCount(awaySec) {
  const t = Math.max(0, Math.min(+awaySec || 0, TRAVEL_SPAN));
  const fast = Math.min(t, TRAVEL_FIRST_WINDOW);
  const slow = Math.max(0, t - TRAVEL_FIRST_WINDOW);
  return Math.floor(fast / TRAVEL_FIRST_STEP) + Math.floor(slow / TRAVEL_LATE_STEP);
}

function travelSent() {
  const t = state.travel;
  if (!t) return 0;
  return Math.max(0, Math.floor(t.sent || 0));
}

function travelNextMailIn(awaySec) {
  const t = Math.max(0, Math.min(+awaySec || 0, TRAVEL_SPAN));
  if (t >= TRAVEL_SPAN) return null;
  const n = travelMailCount(t);
  const at = travelSecForMails(n + 1);
  return Math.max(0, at - t);
}

function travelSecForMails(n) {
  if (n <= 0) return 0;
  if (n <= TRAVEL_FIRST_MAX) return n * TRAVEL_FIRST_STEP;
  return TRAVEL_FIRST_WINDOW + (n - TRAVEL_FIRST_MAX) * TRAVEL_LATE_STEP;
}

function buffSpanMs(mult) {
  const now = Date.now();
  const segs = [];
  for (const b of (state.buffs || [])) {
    if (b.mult !== mult) continue;
    const s = Math.max(now, b.start || now), e = b.until || 0;
    if (e > s) segs.push([s, e]);
  }
  if (!segs.length) return 0;
  segs.sort((a, b) => a[0] - b[0]);
  let total = 0, cs = segs[0][0], ce = segs[0][1];
  for (let i = 1; i < segs.length; i++) {
    const [s, e] = segs[i];
    if (s > ce) { total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}

function buffAtCap(mult) { return buffSpanMs(mult) >= BUFF_CAP_MS - 1000; }

function pushBuff(mult, durSec, name) {
  const now = Date.now();
  let end = now;
  for (const b of (state.buffs || [])) if (b.mult === mult && (b.until || 0) > end) end = b.until;
  const until = Math.min(end + durSec * 1000, now + BUFF_CAP_MS);
  if (until <= now) return false;
  state.buffs.push({ mult, start: now, until, name: (typeof name === "string" ? name : "").slice(0, 12) });
  _buffCache = null;
  return true;
}

/* v5.6 通用 Buff 协议: 离线收益加成条目(boost>0, 仅离线段生效, 不吃 24h 修为丹封顶)。
 * 兽潮余威也走这里(tag:"trial") —— 前端新增任何加成源只需 push 一条, 后端零改动。 */
function pushBoost(boost, durSec, name, tag) {
  const now = Date.now();
  if (!((boost || 0) > 0) || !((durSec || 0) > 0)) return false;
  state.buffs.push({ tag: tag === "trial" ? "trial" : "pill", mult: 1, boost,
    name: (typeof name === "string" ? name : "").slice(0, 12), start: now, until: now + durSec * 1000 });
  _buffCache = null;
  return true;
}

function buffHintOf(mult) {
  const left = BUFF_CAP_MS - buffSpanMs(mult);
  if (left <= 60000) return `（药力已积满 24 小时）`;
  return `（药力共余 ${durTxt(Math.round(left / 1000))}）`;
}

function renderPillHints() {
  const now = Date.now();
  /* v5.6: 修为丹与离线加成都在 buffs 一张表 —— 按字段分列展示 */
  const multN = (state.buffs || []).filter(b => (b.mult || 0) > 1).length;
  const boosts = (state.buffs || []).filter(b => (b.boost || 0) > 0);
  const el = $("pillHints");
  /* v1.9.0: 附一句药力剩余时长, 让"累加到 24 小时封顶"这件事可见 */
  let spanTxt = "";
  if (multN) {
    const mm = buffMult();
    const left = BUFF_CAP_MS - buffSpanMs(mm);
    spanTxt = left <= 60000 ? "·已满" : "·余" + durTxt(Math.round(left / 1000));
  }
  const bTxt = boosts.length ? boosts.map(b => `${b.name || "离线加成"}+${Math.round(b.boost * 100)}%`).join("/")
    : "";
  if (el) el.innerHTML = (multN ? `<span style="color:#f0c98a">丹力正盛 ×${buffMult().toFixed(1)}${spanTxt}</span>` : "") +
    (boosts.length ? (multN ? " · " : "") + `<span style="color:#8fd8bd">${bTxt}</span>` : "");
}

mailDot();

function pagesOf(bi) { return (state.pages && state.pages["b" + bi]) || 0; }

function hiddenUnlocked(bi) { return pagesOf(bi) >= PAGES_NEED[bi]; }

function recipeCardHTML(id) {
  const rp = RECIPES[id];
  const needTxt = Object.keys(rp.need).map(mid => {
    const have = (state.mats || {})[mid] || 0, nd = rp.need[mid];
    return `<span class="al-chip ${have >= nd ? "ok" : "no"}">${MATS[mid].n} ${have}/${nd}</span>`;
  }).join("");
  const can = Object.keys(rp.need).every(mid => ((state.mats || {})[mid] || 0) >= rp.need[mid]);
  return `<div class="al-card${can ? " can" : ""}">
    <div style="flex:1;min-width:0">
      <div class="nm">${rp.n}</div>
      <div class="ds">${rp.d}</div>
      <div class="nd">${needTxt}</div>
    </div>
    <button class="al-craft ${can ? "on" : "off"}" ${can ? `onclick="craftPill('${id}')"` : "disabled"}>开炉</button>
  </div>`;
}

function cloudSnap(src) {
  const s = src || state;
  const out = Object.assign({}, s);
  out.journal = trimJr((s.journal || []).filter(j => !(j && !j.sid && j.kind === "游历")));
  /* v1.7.26: 未定道号(_named=0)不上传名字与本地临时名 → 服务器/风云榜只见定名者 */
  if (!out._named) { delete out.name; delete out._pn; }
  /* v1.8.0: 上传「账本值」而不是「预测值」—— 本地预测只是显示, 若把预测一起传上去,
     服务端会在预测值之上再发一次同一段时间的收益, 造成双倍。把预测量扣掉即可。 */
  if (_pred.exp) out.exp = Math.max(0, (out.exp || 0) - _pred.exp);
  if (_pred.spirit) out.spirit = Math.max(0, (out.spirit || 0) - _pred.spirit);
  return out;
}

function mailLine(locId, ts) {
  const loc = locById(locId);
  if (!loc || !loc.tale || !loc.tale.length) return "";
  const t = loc.tale.length;
  return loc.tale[(((ts || 0) / 60000 | 0) % t + t) % t];
}

function mailDot() {
  const n = (state.mails || []).length;
  const d = $("mailDot"); if (d) d.style.display = n ? "block" : "none";
  const b = $("mailChip"); if (b) b.classList.toggle("has-mail", !!n);
}

function settleBlocked() {
  if (!_settling) return false;
  pushMsg("main", "云端结算中，稍候片刻再操作");
  return true;
}

function handleKicked() {
  if (_kicked) return;
  __set_kicked(true);
  try {
    const ov = document.createElement("div");
    ov.id = "kickedOverlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(8,10,16,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e8ecf5;text-align:center;padding:40px;";
    ov.innerHTML = '<div style="font-size:48px;margin-bottom:16px">⚠️</div>'
      + '<div style="font-size:20px;font-weight:bold;margin-bottom:12px;color:#ffb36b">账号已在其他设备登录</div>'
      + '<div style="font-size:14px;color:#a7b0c4;line-height:1.8;max-width:320px">同一玩家码只允许一端在线。<br>如需在本设备继续游玩，请刷新页面重新登录。</div>'
      + '<button onclick="location.reload()" style="margin-top:24px;padding:12px 36px;font-size:16px;background:#67c9ab;color:#0a0e14;border:none;border-radius:8px;cursor:pointer;font-weight:bold">重新登录</button>';
    document.body.appendChild(ov);
  } catch (e) {}
  /* 停止心跳和主循环: 不再上传, 防止旧端覆盖新端存档 */
  cld.ready = false;
  try { SND.suspend(); } catch (e) {}
}

function closeMail() { const m = $("mailModal"); if (m) m.classList.remove("show"); }

function closeSettings() { const m = $("setModal"); if (m) m.classList.remove("show"); }

function renderSettings() {
  for (const [id, on] of [["setBgm", SND.bgmOn], ["setSfx", SND.sfxOn]]) {
    const r = $(id); if (!r) continue;
    r.classList.toggle("off", !on);
    const st = r.querySelector(".set-st"); if (st) st.textContent = on ? "开" : "关";
  }
}

function dimRender() {
  const t = $("dimTrials"); if (t) t.textContent = DIMSTAT.trials;
  const s = $("dimSpirit"); if (s) s.textContent = fmt(DIMSTAT.spirit);
  const e = $("dimExp"); if (e) e.textContent = fmt(DIMSTAT.exp);
  const brEl = $("dimBreaks");
  if (brEl) {
    if (DIMSTAT.breaks.length) {
      brEl.style.display = "";
      brEl.innerHTML = DIMSTAT.breaks.map(x => `<div>突破 · ${x}</div>`).join("");
    } else { brEl.style.display = "none"; }
  }
  const l = $("dimLoot"); if (!l) return;
  if (!DIMSTAT.loot.length) {
    l.innerHTML = '<div class="li empty">尚未拾获物什</div>';
    return;
  }
  l.innerHTML = DIMSTAT.loot.slice(-8).map(x =>
    `<div class="li q${x.q || 0}">拾获 <b>「${x.n}」</b> ${x.qn}·${x.slot}</div>`).join("");
}

function resetDimKnob() {
  const k = $("dimKnob");
  if (k) { k.style.transition = "left .22s ease"; k.style.left = "4px"; }
}

function enterDim() {
  closeSettings();
  const d = $("dimScreen"); if (!d) return;
  d.classList.add("show");
  document.body.classList.add("dimmed");
  DIMSTAT.on = true;
  DIMSTAT.battles = 0; DIMSTAT.win = 0; DIMSTAT.spirit = 0; DIMSTAT.exp = 0; DIMSTAT.loot = []; DIMSTAT.trials = 0; DIMSTAT.breaks = [];
  dimRender();
  SND.mute(true);                                  // 音乐 + 音效 全关(硬静音, 音效不会自己跳出来)
  /* v5.2: 黑屏挂机不再 pause 任何层 —— ticker 继续跑, 战斗层 draw() 里
   * update(dt) 跑逻辑(打兽潮), 检测 DIMSTAT.on 后跳过 render()。
   * 其他层(背景/特效)由各自 draw() 检测 DIMSTAT.on 跳过渲染。 */
  try { document.dispatchEvent(new CustomEvent("fx-suspend")); } catch (e) {}
  resetDimKnob();
}

function exitDim() {
  const d = $("dimScreen"); if (!d) return;
  d.classList.remove("show");
  document.body.classList.remove("dimmed");
  DIMSTAT.on = false;
  SND.mute(false);                                 // 按玩家原有开关恢复
  /* v5.2: 不再 resume 任何层 —— ticker 一直在跑, 只是各层 draw() 检测 DIMSTAT.on 跳过渲染 */
  /* v2.6 省电: 回到主页 → 恢复 fx2d 旋臂动画 */
  try { document.dispatchEvent("fx-resume"); } catch (e) {}
}

function searchMs() { return (SEARCH_MIN + Math.random() * (SEARCH_MAX - SEARCH_MIN)) * 1000; }

function renderAutoHunt() {
  /* v1.5.0: 小开关 —— 文案恒为「⚔ 自动」, 开/关只切 .on 激活态(朱砂亮 / 熄墨灰) */
  const b = $("btnAuto"); if (!b) return;
  const on = autoHuntOn();
  b.classList.toggle("on", on);
  b.title = on ? "自动战斗 · 开（点击关闭）" : "自动战斗 · 关（点击开启）";
  if (!on) seekHide();
}

function traceRefresh() {
  const el = $("traceArea"); if (!el) return;
  if (BTL || MYST) return;   // 战斗/秘境演出中, 行迹条保持现状不覆写
  if (state.travel) {
    const loc = locById(state.travel.loc);
    const where = loc ? loc.n : "远方";
    const lid = state.travel.loc;
    if (el.dataset.k !== lid || !_tracePool.length) {
      el.dataset.k = lid;
      __set_tracePool((loc && loc.tale && loc.tale.length ? loc.tale.slice() : []).concat(TRACE_ACT.slice()));
      if (!_tracePool.length) __set_tracePool(TRACE_ACT.slice());
    }
    const s = _tracePool.shift(); _tracePool.push(s);
    el.className = "trace travel";
    /* v1.9.0: 「召回」按钮删除 —— 归来由满 8 封信决定。这里改成"看信"入口。 */
    el.innerHTML = `<span class="t-row"><span class="t-ic">迹</span><span class="t-txt">化身在 <b>${where}</b>：${s}</span><button class="trace-go" onclick="event.stopPropagation();openTravel()">进度</button></span>`;
    return;
  }
  if (el.dataset.k === "idle") return;
  el.dataset.k = "idle";
  el.className = "trace idle";
  el.innerHTML = `<span class="t-row"><span class="t-ic">云</span><span class="t-txt">化身尚未出行 —— 遣它下山?</span><button class="trace-go" onclick="event.stopPropagation();openTravel()">云游</button></span>`;
}

renderAutoHunt();

function debugEncounter() {
  if (BTL || MYST) { pushMsg("main", "正在斗法/探秘中，且待收场。"); return; }
  closeTravel();
  pushMsg("main", "文字斗法已撤，妖物都在下方战斗区里 —— 看着打便是。");
}

function artCtx() {
  const lv = (state.realmIdx || 0) + 1;
  let fa = 0, fd = 0, fh = 0;
  const _eb = equipBonus();
  fa = _eb.atk || 0; fd = _eb.def || 0; fh = _eb.hp || 0;
  const _bi = bigIndexOf(state.realmIdx);   /* v7.2b 同上 */
  const _bs = BASE_STATS[Math.min(BASE_STATS.length - 1, _bi)] || BASE_STATS[0];
  return {
    atkRef: Math.max(220, _bs[0] + fa),
    defRef: Math.max(90, _bs[2] + fd),
    hpRef: Math.max(320, _bs[1] + fh),
  };
}

function equipBonus() {                 // 装备数值加总 + 词条聚合(v1.7.13)
  let atk = 0, def = 0, hp = 0;
  const arts = state.arts || [];
  for (const a of arts) {
    if (typeof a.a === "number") atk += a.a;
    if (typeof a.d === "number") def += a.d;
    if (typeof a.h === "number") hp += a.h;
  }
  return { atk, def, hp, agg: fxAgg(arts) };
}

function ensureScrollFx() {
  if (!Array.isArray(state.arts)) return false;
  let changed = false;
  for (const a of state.arts) {
    if (a && a.slot === 3 && !(a.fx || []).some(f => f.k === "aspd")) {
      (a.fx = a.fx || []).push({ k: "aspd", v: fxValue("aspd", a.q) });
      changed = true;
    }
  }
  if (changed) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {} }
  return changed;
}

function closeEquip() { const m = $("equipModal"); if (m) m.classList.remove("show"); }

function licBuild(cross, arr) {
  const lic = document.createElement("div");
  lic.className = "gx-lic";
  const faces = arr.map((a, idx) => {
    const slotIdx = (typeof (a && a.slot) === "number" && a.slot < 4) ? a.slot : idx;
    const si = EQUI_SLOTI[slotIdx] || "w";
    return `<img class="icoim" data-idx="${idx}" src="assets/modals/art-ico/${si}${a.q || 0}.webp" alt="" onerror="this.classList.remove('on')">`;
  }).join("");
  lic.innerHTML = `
    <div class="lclose" onclick="closeLic(event)">✕</div>
    <div class="lh"><span class="ico licface" style="width:38px;height:38px;flex:none"><span class="licsvg">${EQUI_ICON.w}</span>${faces}</span><b></b><i></i></div>
    <div class="lr" data-k="a"><span>攻</span><b></b></div>
    <div class="lr" data-k="d"><span>防</span><b></b></div>
    <div class="lr" data-k="h"><span>血</span><b></b></div>
    <div class="lfx"></div>
    <div class="lseal"><em></em></div>`;
  cross.appendChild(lic);
  return lic;
}

const EQUI_SLOTN = SLOT_TYPES.map(t => t.n);

function artName(kind, q, lv) {
  /* v5.0 境界装: 名称带境界前缀(炼气·玄天斩灵剑), 装备 = 境界(lv) × 品级(q) 双维度 */
  const bigName = (BIGS[Math.max(0, (lv || 1) - 1)] || BIGS[0]).n;
  const sp = ART_SPECIAL.filter(s => q >= s[0]);
  if (sp.length && Math.random() < 0.35) return bigName + "·" + sp[Math.floor(Math.random() * sp.length)][1];
  if (kind === "w") return bigName + "·" + ART_PREFIX[Math.floor(Math.random() * ART_PREFIX.length)] + ART_SUFFIX[Math.floor(Math.random() * ART_SUFFIX.length)];
  const P = kind === "a" ? ARMOR_POOL : kind === "p" ? PEND_POOL : SCROLL_POOL;
  return bigName + "·" + P[Math.floor(Math.random() * P.length)];
}

function rollFx(kind, q) {                          // 装备词条(同槽不重复)
  const pool = (FX_POOL[kind] || FX_POOL.w).slice();
  const n = fxCount(q);
  const f = [];
  /* v5.0 极品词条: 每条有概率升级为极品(数值×2.4, 带legendary标记)。
   * 概率随品质递增: q0=3% → q5=20.5%。极品=带极品词条的装备, 不单独成品级。 */
  const legChance = 0.04 + q * 0.052;   /* v7.2b 极品概率上调: q0=4% → q5玄天=30% */
  /* v2.5 功法(s)必带攻速词条: 数值随品质分档(低品 3~5% / 高品 5~7%), 其余词条照常 roll;
   * 其他部位(兵/护/佩)不出攻速 */
  if (kind === "s") {
    const v = fxValue("aspd", q);
    const leg = Math.random() < legChance;
    f.push({ k: "aspd", v: leg ? Math.round(v * 2.4) : v, legendary: leg });
  }
  for (let i = f.length; i < n && pool.length; i++) {
    const key = pool.splice((Math.random() * pool.length) | 0, 1)[0];
    const v = fxValue(key, q);
    const leg = Math.random() < legChance;
    f.push({ k: key, v: leg ? Math.round(v * 2.4) : v, legendary: leg });
  }
  return f;
}

function rollMonFx(big) {                           // 词缀妖兽: ~12% 带 1~2 条(同前轴, 数值随境略抬)
  if (Math.random() >= 0.12) return [];
  const pool = MON_FX_POOL.slice();
  const n = Math.random() < 0.4 ? 2 : 1;
  const f = [];
  for (let i = 0; i < n && pool.length; i++) {
    const key = pool.splice((Math.random() * pool.length) | 0, 1)[0];
    f.push({ k: key, v: fxValue(key, Math.min(5, big)) });
  }
  return f;
}

function fmtFxTag(f) { return `${f.legendary ? "【极】" : ""}${FX_TXT[f.k]}+${f.v}%`; }

function attrAssign(art, kind, q, pow) {        // 装备数值(境界因子×品质乘子) + 词条
  /* v7.1: 第四参从境界级 lv 改为 EQ_POW[realmIdx] —— 装备数值跟怪物毛坯同走 ×4 质变 */
  const M = eqMult(q);
  const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
  if (kind === "w") { art.a = Math.max(1, Math.round((4 + r1 * 15) * pow * M)); art.h = 0; art.d = 0; }
  else if (kind === "a") { art.h = Math.round((38 + r1 * 114) * pow * M); art.d = Math.max(1, Math.round((2 + r2 * 15) * pow * M)); art.a = 0; }
  else if (kind === "p") { art.h = Math.round((15 + r1 * 46) * pow * M); art.d = Math.max(1, Math.round((2 + r2 * 6) * pow * M)); art.a = Math.round((1.5 + r3 * 4.5) * pow * M); }
  else { art.a = Math.round((2.3 + r1 * 6.7) * pow * M); art.d = Math.max(1, Math.round((2 + r2 * 5) * pow * M)); art.h = 0; }
  art.fx = rollFx(kind, q);
}

function genMonster(big, lv) {                   // 妖兽: 基础线性 + 词缀(属性乘区/判定词条)
  const names = MON_NAMES[big] || MON_NAMES[0];
  const k = MON_ATK_SCALE[big] || 1;
  const m = {
    n: names[Math.floor(Math.random() * names.length)],
    hp: Math.round((250 + Math.random() * 400) * lv),
    atk: Math.round((60 + Math.random() * 105) * lv * k),
    def: Math.max(1, Math.round((1 + Math.random() * 14) * lv)),
  };
  const fx = rollMonFx(big);
  if (fx.length) { m.fx = fx; }
  return m;
}

function skillDef(id) { for (const d of SKILL_DEFS) if (d.id === id) return d; return null; }

function skillGet(id) {                       // 惰性初始化: 老档没有 skills 字段也照常跑
  if (!state.skills || typeof state.skills !== "object") state.skills = {};
  const s = state.skills[id];
  if (!s || typeof s !== "object") { state.skills[id] = { lv: 1, exp: 0 }; return state.skills[id]; }
  if (!(s.lv >= 1)) s.lv = 1;
  if (!(s.exp >= 0)) s.exp = 0;
  return s;
}

function skillLv(id) { return Math.min(SKILL_MAX, Math.max(1, skillGet(id).lv | 0)); }

function pushBattleStats() {
  const api = window.BattleAPI;
  if (!api || !api.setStats) return;
  const lv = (state.realmIdx || 0) + 1, eb = equipBonus();
  /* v7.1: 基础三围改手动表 BASE_STATS —— 围绕怪物毛坯(境界间×4质变), 旧线性 10+46*lv 退役 */
  const bi = bigIndexOf(state.realmIdx);   /* v7.2b 纯函数推算, 修复启动期 SEG_META 未填充卡导入 */
  const bs = BASE_STATS[Math.min(BASE_STATS.length - 1, bi)] || BASE_STATS[0];
  const s = finalStats({ hp: bs[1], atk: bs[0], def: bs[2] },
    { hp: eb.hp || 0, atk: eb.atk || 0, def: eb.def || 0 }, eb.agg);
  s.lv = lv;                                  // 怪物成长按境界缩放
  api.setStats(s);
}

function closeSkills() { const m = $("skillModal"); if (m) m.classList.remove("show"); }

window.closeSkills = closeSkills;

export {
  BASE_STATS,
  CLD_API,
  EQ_POW,
  EQUI_SLOTN,
  QW_TABLE,
  SND,
  bigIndexOf,
  TOTAL_SEGS,
  _auraAcc,
  _auraColor,
  _auraCtx,
  _auraCv,
  _auraP,
  _auraT,
  adopt,
  alHave,
  alIco,
  alInFurn,
  alTip,
  apiRoot,
  arrayCostNow,
  artCtx,
  artMult,
  artName,
  attrAssign,
  bctx,
  bcv,
  buffAtCap,
  buffHintOf,
  buffMult,
  buffSpanMs,
  burstBoom,
  cldApi,
  cldChip,
  cldFlash,
  cldId,
  cldUI,
  closeAlchemy,
  closeEquip,
  closeMail,
  closeOffline,
  closeRank,
  closeRename,
  closeSettings,
  closeSkills,
  closeStory,
  closeTravel,
  cloudNew,
  cloudSnap,
  cloudSoon,
  cloudTogglePanel,
  debugEncounter,
  deviceId,
  dimRender,
  ensureScrollFx,
  enterDim,
  equipBonus,
  exitDim,
  fitsRecipe,
  fmtFxTag,
  g1Pack,
  g1Unpack,
  genMonster,
  handleKicked,
  hbFail,
  hiddenUnlocked,
  createFxLayer,
  createStageLayers,
  initAura,
  initBg,
  initBg2D,
  initFxLayer,
  journalHasKey,
  licBuild,
  locById,
  mailDot,
  mailLine,
  matBagHTML,
  migrate,
  openRename,
  pagesOf,
  pickNoRepeat,
  pillCabinetHTML,
  pillIco,
  pushBattleStats,
  pushBoost,
  pushBuff,
  pushMsg,
  recipeCan,
  recipeCardHTML,
  renderAutoHunt,
  renderBag,
  renderCabinet,
  renderFurn,
  renderPName,
  renderPillHints,
  renderSettings,
  resetDimKnob,
  rkSegLabel,
  rollFx,
  rollMonFx,
  searchMs,
  seg,
  setRealmSub,
  settleBlocked,
  sizeBurst,
  skillDef,
  skillGet,
  skillLv,
  spiritRate,
  srvNow,
  storyItemHtml,
  storyResolve,
  tickBurst,
  tickDsp,
  traceRefresh,
  travelBtnLbl,
  travelMailCount,
  travelNextMailIn,
  travelSecForMails,
  travelSent,
  trimJournal,
  trimJr,
  zoneOfBig,
  zoneOfLoc,
  段名,
};

/* ── 可变状态写入口（由 tools/split2.js 自动生成）────────────────
 * 为什么需要 setter ——
 *   ES Module 的 import 是【只读绑定】：别的模块 `import { _traceT }` 后
 *   再写 `_traceT = Date.now()` 会直接抛 "Assignment to constant variable"。
 *   本模块是这些绑定的声明方，在此提供 setter，让赋值发生在模块内部：
 *     消费方 import { __set__traceT } → __set__traceT(v)
 *   复合赋值（++ / +=）已在 hub.js 重写阶段降级为"读旧值 + 写新值"，
 *   故 setter 只需单一赋值语义。返回值即写入值，可作为表达式使用。
 * ---
 * ⚠️ 本段由工具生成，手改会在下次重建时丢失。
 */
export function __set_auraAcc(v) { _auraAcc = v; return v; }
export function __set_auraCtx(v) { _auraCtx = v; return v; }
export function __set_auraCv(v) { _auraCv = v; return v; }
export function __set_auraT(v) { _auraT = v; return v; }
