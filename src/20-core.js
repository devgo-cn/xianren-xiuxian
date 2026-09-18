/**
 * 核心服务（本地存档读写/云存档传输/境界推进/主界面刷新）
 *
 * 拓扑层 L3~L4，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, BIGS, DROP_CFG, EQUI_CELLPOS, FX_TXT, JRN_CAP, LIC_QCOL, QUALITY, SAVE_KEY, SKILL_DEFS, SLOT_TYPES, STORY_BY_KEY, STORY_PAGE, __set_rate, __set_rkAt, __set_srvOffset, __set_state, __set_storyChap, __set_traceT, _eqRecycle, _eqSel, _pred, _rkAt, _storyChap, _traceT, cld, cnNum, esc, fmt, rnOk, state } from './00-pure.js';
import { CLD_API, EQUI_SLOTN, SND, adopt, apiRoot, artCtx, cldFlash, cldId, cldUI, closeRename, cloudSnap, cloudSoon, deviceId, ensureScrollFx, exitDim, g1Pack, g1Unpack, handleKicked, licBuild, migrate, pushBattleStats, pushMsg, renderPName, renderSettings, resetDimKnob, rkSegLabel, seg, setRealmSub, sizeBurst, skillDef, skillVal, storyItemHtml, trimJournal } from './10-base.js';

function realm() { return seg(state.realmIdx); }

function bigIdx() { return realm().bigIdx; }

async function saveRename() {
  const inp = $("renameInput"); if (!inp) return;
  const v = inp.value.trim(), h = $("renameHint");
  if (!rnOk(v)) { if (h) h.textContent = "道号需 1~12 位中文/字母/数字/_/-，且不含空格。"; return; }
  if (v === state.name) { closeRename(); return; }
  if (h) h.textContent = "正在与云端确认……";
  try {
    const r = await fetch(apiRoot() + "/api/name", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cldId(), name: v }),
    });
    if (r.status === 409) {
      if (h) h.textContent = "「" + v + "」已被他人占用（全服唯一），另起一个吧。";
      return;
    }
    if (!r.ok) { if (h) h.textContent = "云端暂不可用（存档服务未连接），请稍后再试。"; return; }
    state.name = v; state._named = 1;
    save(); cloudSoon(); renderPName(); closeRename();
    pushMsg("main", "道号已定：从今往后你以 <span class=\"g\">" + v + "</span> 行走洞天，风云榜上留名。");
  } catch (e) { if (h) h.textContent = "云端暂不可用，请检查网络后重试。"; }
}

function openRank() { const m = $("rankModal"); if (!m) return; m.classList.add("show"); loadRank(true); }

async function loadRank(force) {
  const body = $("rankBody"); if (!body) return;
  if (!force && Date.now() - _rkAt < 60000) return;
  body.innerHTML = '<div class="al-empty">榜单刷新中……</div>';
  try {
    const self = cldId().replace(/^dt-/, "");       // v1.7.29: 传自己裸码换 me 标志(服务端不下发任何玩家码)
    const r = await fetch(apiRoot() + "/api/rank?top=10&self=" + encodeURIComponent(self), { cache: "no-store" });
    if (!r.ok) throw new Error("http" + r.status);
    const j = await r.json(); __set_rkAt(Date.now());
    if (!j.list || !j.list.length) { body.innerHTML = '<div class="al-empty">仙途初开，尚无修士上榜。</div>'; return; }
    body.innerHTML = j.list.map(x => {
      const isMe = !!x.me;
      const nm = x.name ? esc(x.name) : '<span style="color:#5f6778">未定道号</span>';
      return '<div class="rk-row ' + (isMe ? "me " : "") + "n" + x.rank + '">' +
        '<div class="rk-no">' + x.rank + "</div>" +
        '<div class="rk-main"><div class="rk-nm">' + nm + (isMe ? ' <span style="font-size:9px;color:#e8c56b">(我)</span>' : "") + "</div>" +
        '<div class="rk-big">' + rkSegLabel(x.rid) + "</div></div>" +
        '<div class="rk-exp">' + fmt(x.exp || 0) + "</div></div>";
    }).join("") + '<div class="rk-foot">共 ' + (j.total || j.list.length) + " 名修士在册 · 只列道号，不露玩家码</div>";
  } catch (e) { body.innerHTML = '<div class="al-empty">云端未连接，榜单待命……</div>'; }
}

/* ══════════════════════════════════════════════════════════════════
 *  v6 存档钩子
 * ──────────────────────────────────────────────────────────────────
 *  为什么用"注册回调"而不是直接 import 06-v6ui：
 *    06-v6ui 位于依赖图最下游（它 import 05-v6），20-core 在它上游。
 *    上游 import 下游 = 循环依赖，模块会炸。
 *  所以这里只留两个可注入的槽位，由 main.js（唯一能看到全图的入口）
 *  在启动时把 06-v6ui 的 saveV6/loadV6 注进来 —— 依赖方向始终单向。
 *
 *  v6 存档只存 4 样：离线 / 境界 / 灵石 / 装备（见 05-v6.js packV6）。
 *  技能不在其中（恒定数值，无等级，没有存的必要）。
 */
let _v6Save = null;   // () => void        把 v6 状态写进 state
let _v6Load = null;   // () => void        从 state 读回 v6 状态

/** 由 main.js 注入 v6 的存取实现 */
export function bindV6Save(saveV6, loadV6) {
  _v6Save = typeof saveV6 === 'function' ? saveV6 : null;
  _v6Load = typeof loadV6 === 'function' ? loadV6 : null;
}

function save() {
  /* ⚠️ v8.4: "新建存档"正在 reload 时必须跳过落盘。
   * cloudNew() 先删本地档再 location.reload(), 而 reload 会触发 pagehide →
   * 这里被调用 → 把内存里的【旧存档】写回 SAVE_KEY, 刚删的档又活了。
   * __reloading 由 cloudNew() 置位, 仅用于这一小段窗口。 */
  if (typeof window !== "undefined" && window.__reloading) return;
  state.lastTs = Date.now();
  trimJournal();
  /* v6: 落盘前先把 v6 状态同步进 state.v6（离线/境界/灵石/装备四项） */
  if (_v6Save) { try { _v6Save(); } catch (e) { console.warn('[save] v6 同步失败:', e); } }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { console.warn('[save] 存档写入失败:', e); }   // 明文同步写: pagehide 可靠
}

function load() {
  try { localStorage.removeItem("dongtian_xiuxian_v2"); } catch (e) {}          // v1.10.0 旧键退役
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = migrate(JSON.parse(raw));
    const c = adopt(s);
    if (c) {
      __set_state(c); trimJournal();
      /* 载入时先把存档里的原始 lastTs 存进 _lastTs0, 离线结算以它为基准 */
      state._lastTs0 = (s && s.lastTs) || c.lastTs || 0;
      ensureScrollFx();         // v2.5: 旧档功法补攻速词条
      /* v6: 读档后恢复 v6 状态（loadV6 内部会把 lastTick 重置为此刻，
       *     否则会把"关掉页面的这段时间"误当成在线 tick） */
      if (_v6Load) { try { _v6Load(); } catch (e) { console.warn('[load] v6 恢复失败:', e); } }
    }
  } catch (e) {
    console.warn('[load] 存档读取/解析失败:', e);
    if (raw) { try { localStorage.setItem(SAVE_KEY + '.bak', raw); } catch (e2) {} }
  }
}

function cldFail(e) {
  let msg = "";
  if (!e) msg = "unknown";
  else if (e && e.name === "AbortError") msg = "连接超时(网络慢?)";
  else if (e && e.message) msg = String(e.message).slice(0, 80);
  cld.lastErr = msg;
  try { cldUI("off"); } catch (err) {}
  const hint = $("cloudErr"); if (hint) hint.textContent = "最近错误: " + msg;
}

function cloudCopyId() {
  const id = cldId();
  const done = () => cldFlash("玩家码已复制");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(done).catch(() => fallbackCopy(id, done));
  } else fallbackCopy(id, done);
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { cldFlash("复制失败, 请手动记下"); }
  document.body.removeChild(ta);
}

function updateRealmUI() {
  const r = realm();
  if (r.big === "凡人") {
    $("realmName").textContent = "凡人";
    setRealmSub("", r.sub);                          // 凡人无段位小字段, 只显示大境界+洞天福地句
  } else if (r.big === "炼气") {
    $("realmName").textContent = "炼气";
    setRealmSub(`${cnNum(r.segNo)}层`, r.sub);       // 行1=层数; 行2=法门说明
  } else {
    $("realmName").textContent = r.big;
    setRealmSub(r.label.split("·")[1], r.sub);       // 行1=前/中/后/圆满; 行2=说明
  }
  /* 灵力辉光按大境界切换 + 角色轮廓光随境界变色(读 #cult data-big / --rg) */
  const cult0 = document.getElementById("cult");
  if (cult0) cult0.setAttribute("data-big", r.big);
  if (cult0) {
    const c = r.color || "#e8c56b";
    const n = parseInt(c.slice(1), 16);
    cult0.style.setProperty("--rg", `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},.25)`);
  }
}

function addJournal(entry) {
  const b = entry.key && STORY_BY_KEY[entry.key];
  if (b) {                          // 预置剧情: 只存数字引用, 不存文本
    state.journal.push({ sid: b.sid, big: b.big || entry.big, kind: b.kind || entry.kind, ts: Date.now() });
  } else {                          // 动态事件(离线游历/纪事等): 仍存文本
    entry.ts = Date.now();
    state.journal.push(entry);
    /* v5.7 叙事本地化: 叙事不进云端存档(cloudSnap 只传 sid 主线), 另存本地 journalLocal,
     * 换设备/瘦身档载入时由 adopt 合并回显。上限 60 条, 超出裁最旧。 */
    try {
      const loc = JSON.parse(localStorage.getItem("dt_jrn_local") || "[]");
      if (Array.isArray(loc)) {
        loc.push({ key: entry.key || "", big: entry.big || "", kind: entry.kind || "",
          title: entry.title || "", text: entry.text || "", ts: entry.ts });
        while (loc.length > 60) loc.shift();
        localStorage.setItem("dt_jrn_local", JSON.stringify(loc));
      }
    } catch (err) {}
  }
  if (state.journal.length > JRN_CAP) trimJournal();   // v1.9.2: 分流裁剪, 不再 shift 挤掉主线
  save();
}

let _chapterList = [];   // showChapter 时缓存该大境界的倒序纪事，storyLoadMore 分页直接 slice

function storyLoadMore(reset) {
  const body = $("storyBody");
  if (!body) return;
  const big = body.dataset.big || _storyChap;
  if (!big) return;
  let page = parseInt(body.dataset.page || "0", 10);
  if (reset) { page = 0; body.innerHTML = ""; }
  const slice = _chapterList.slice(page * STORY_PAGE, (page + 1) * STORY_PAGE);
  if (reset || slice.length) { page++; body.dataset.page = String(page); }
  if (slice.length) body.insertAdjacentHTML("beforeend", slice.map(storyItemHtml).join(""));
  if (reset) body.scrollTop = 0;
  if (reset && !slice.length) {
    body.innerHTML = `<div class="empty-hint">${big}期的际遇尚未写就。<br>先修行，路会自己走出来。</div>`;
  }
}

function showChapter(bigName) {
  const chips = $("storyChips");
  const body = $("storyBody");
  if (!body) return;
  __set_storyChap(bigName);
  body.dataset.big = bigName;
  _chapterList = state.journal.filter(j => j.big === bigName).reverse(); // 最新在前
  body.onscroll = () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 60) storyLoadMore(false);
  };
  if (chips) chips.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x.textContent === bigName));
  storyLoadMore(true);
}

function updateArts(highlight) {
  const row = $("artRow");
  const last6 = state.arts.slice(-6);
  row.innerHTML = last6.map((a, i) => {
    const isNew = !!(highlight && i === last6.length - 1);
    return `<span class="art${isNew ? " new" : ""}"><span class="q ${QUALITY[a.q].cls}">${QUALITY[a.q].name}</span>${a.name}</span>`;
  }).join("");
  while (state.arts.length > 4) {
    const old = state.arts.shift();
    state.spirit += Math.round(60 * Math.pow(1.6, old.q));
  }
  pushBattleStats();        // 装备变动 → 战斗里的攻防血立刻跟上
}

sizeBurst();

addEventListener("resize", sizeBurst);

function keepArtQuiet(a) {          // 静默版 smartEquip: 批量结算不发消息、不存档(同槽综合分择优, 同品质可替换)
  if (!state.arts || !Array.isArray(state.arts)) state.arts = [];
  const arts = state.arts;
  const idx = (typeof a.slot === "number" && a.slot < 4) ? a.slot : arts.length;
  if (idx >= arts.length) { arts.push(a); return true; }
  const w = arts[idx];
  if (!w) { arts[idx] = a; return true; }
  if (artScore(a) > artScore(w)) {
    state.spirit += Math.round(50 * Math.pow(1.6, w.q));
    arts[idx] = a; return true;
  }
  state.spirit += Math.round(40 * Math.pow(1.5, a.q));
  return false;
}

function renderCraftBtn() {
  const b = $("craftBtn"); if (!b) return;
}



function adoptKeep(st) {          // 采用结算后的存档, 但本地叙事(非云端净化)不回退
  const keep = (state.journal || []).slice();
  return true;
}

async function _cloudSettleRun() {
  cldUI("sync");
  const t0 = Date.now();
  /* v1.8.0: 客户端不再报"离线基准"、也不再指定区间终点 —— 区间完全由服务端自己的两次写入间隔决定。
     这里只需要上传账本快照(见 cloudSnap: 已扣掉本地预测)。 */
  let snap = null;
  try {
    const clone = (typeof structuredClone === "function") ? structuredClone(state) : JSON.parse(JSON.stringify(state));
    snap = cloudSnap(clone);
  } catch (e) { return null; }
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(CLD_API + "?id=" + encodeURIComponent(cld.id) + "&device=" + encodeURIComponent(deviceId()) + "&settle=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ __z: await g1Pack(snap) }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    if (!r.ok) throw new Error("http" + r.status);
    const j = await r.json();
    /* v2.3 单点登录: 服务端判定其他设备在线 → 踢掉本端, 停止一切操作 */
    if (j && j.kicked) { handleKicked(); return null; }
    if (j && j.ok && j.data) {
      const t1 = Date.now();
      /* 时钟校准(NTP 式): 用往返中点估计服务端"此刻"的时间, 抵消一半网络延迟。
         之后 srvNow() 就是可信的服务端时间, 所有时间显示/判断都用它, 不再用 Date.now()。 */
      if (typeof j.serverTime === "number") __set_srvOffset(j.serverTime - (t0 + (t1 - t0) / 2));
      if (j.rate) __set_rate({ exp: +j.rate.exp || 0, spirit: +j.rate.spirit || 0 });
      /* 战斗掉落系数由服务端下发(每击杀产出); 没下发就用内置默认, 断网照常可玩 */
      if (j.dropRates) applyDropRates(j.dropRates);
      const j0 = await g1Unpack(j.data);
      if (!adoptKeep(j0)) return null;
      _pred.exp = 0; _pred.spirit = 0;     // 账本已被服务端权威值覆盖 → 本地预测清零, 从新账本重新开始
      state._lastTs0 = Date.now(); state._settledTs = Date.now();
      state._cloudTs = j.ts || Date.now();
      cld.ready = true; cld.lastOkTs = Date.now(); cld.lastOkLocal = state.lastTs;
      cld.lastPushTs = Date.now();
      cldUI("on");
      return j;               // { settled, gains, mode, serverTime, rate, data }
    }
    return null;
  } catch (e) {
    clearTimeout(tm);
    cldFail(e);
    return null;
  }
}

function openSettings() {
  const m = $("setModal"); if (!m) return;
  renderSettings();
  m.classList.add("show");
}

function toggleBgm() { SND.setBgm(!SND.bgmOn); renderSettings(); }

function toggleSfx() { SND.setSfx(!SND.sfxOn); renderSettings(); }

(function initDimSlide() {
  const track = $("dimSlide"), knob = $("dimKnob");
  if (!track || !knob) return;
  let dragging = false, max = 0;
  const xOf = e => (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
  const down = e => {
    dragging = true;
    max = Math.max(1, track.clientWidth - knob.offsetWidth - 8);
    knob.style.transition = "none";
    if (e.cancelable) e.preventDefault();
  };
  const move = e => {
    if (!dragging) return;
    const r = track.getBoundingClientRect();
    let x = xOf(e) - r.left - knob.offsetWidth / 2;
    x = Math.max(4, Math.min(max + 4, x));
    knob.style.left = x + "px";
    if (x - 4 >= max * 0.88) { dragging = false; resetDimKnob(); exitDim(); }
    if (e.cancelable) e.preventDefault();
  };
  const up = () => { if (!dragging) return; dragging = false; resetDimKnob(); };
  knob.addEventListener("pointerdown", down);
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
  knob.addEventListener("touchstart", down, { passive: false });
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("touchend", up);
})();

function artScore(a) {
  /* v7.2 重写: 去掉anchor+cap, 改成属性加权×品质乘数。
   * 旧公式 anchor+min(lv*STEP, ...*0.32) 导致同品质装备分全一样(cap死了)。
   * 新公式: 基础属性按实战权重加权 + 词条按战斗公式换算 → 乘品质乘数。
   * 同品质内 roll 好坏直接体现在分差, 跨品质靠乘数拉开。 */
  const c = artCtx();
  /* 基础属性权重: 防权重高(防血乘算), 血量大量级小权重 */
  const base = (a.a || 0) * 1.0 + (a.d || 0) * 2.5 + (a.h || 0) * 0.05;
  /* 词条换算: 百分比词条按当前面板参考值换算成等效战力 */
  let fx = 0;
  for (const f of (a.fx || [])) {
    const p = f.v / 100;
    let val = 0;
    if (f.k === "atk") val = p * c.atkRef;
    else if (f.k === "hp") val = p * c.hpRef * 0.05;
    else if (f.k === "dfn") val = p * c.defRef * 2.5;
    else if (f.k === "crit") val = p * c.atkRef * 0.55;
    else if (f.k === "critB") val = p * c.atkRef * 1.0;
    else if (f.k === "critD") val = p * c.atkRef * 0.15;
    else if (f.k === "pen") val = p * c.atkRef * 0.35;
    else if (f.k === "dodge") val = p * c.defRef * 2.5;
    else if (f.k === "life") val = p * c.atkRef * 0.5;
    else if (f.k === "aspd") val = p * c.atkRef * 0.8;
    fx += val * (f.legendary ? 1.3 : 1);
  }
  /* 品质乘数: 白1.0 / 蓝1.4 / 绿1.8 / 金2.5 / 紫3.5 / 红5.0 */
  const QMUL = [1.0, 1.4, 1.8, 2.5, 3.5, 5.0];
  const q = Math.max(0, Math.min(5, a.q | 0));
  return Math.round((base + fx) * QMUL[q]);
}

function smartEquip(a) {
  const arts = state.arts || [];
  const idx = (typeof a.slot === "number" && a.slot < 4) ? a.slot : arts.length;
  const q0 = QUALITY[a.q];
  if (idx >= arts.length) {
    arts.push(a); state.arts = arts;
    pushMsg("avatar", `阿青把 ${a.name}（${q0.name}·${SLOT_TYPES[idx].n}）放进藏宝阁 —— 已替穿戴。`);
    updateArts(true); save(); cloudSoon(); return;
  }
  const w = arts[idx];
  if (!w) { arts[idx] = a; updateArts(true); save(); cloudSoon(); return; }
  if (artScore(a) > artScore(w)) {
    const g = Math.round(50 * Math.pow(1.6, w.q));
    state.spirit += g;
    arts[idx] = a;
    _eqRecycle.unshift(`熔回 ${w.name}(${QUALITY[w.q].name}) +${fmt(g)}`);
    if (_eqRecycle.length > 3) _eqRecycle.pop();
    pushMsg("avatar", `阿青见 ${a.name}(${q0.name}·${SLOT_TYPES[idx].n}) 胜过旧佩，把那 ${w.name} 熔回灵石 +${fmt(g)}，新宝自动换上。`);
    updateArts(true); save(); cloudSoon();
  } else {
    const g = Math.round(40 * Math.pow(1.5, a.q));
    state.spirit += g;
    pushMsg("avatar", `${a.name}(${q0.name}) 不及身上同槽所佩，阿青炼作灵石 +${fmt(g)}。`);
    updateArts(false); save(); cloudSoon();
  }
}

let _licCross = null;   // 缓存 .gx-cross 根节点；renderEquip 重建 innerHTML 后旧节点脱离文档，isConnected 触发重查

function licSync() {
  const cross = (_licCross && _licCross.isConnected) ? _licCross : (_licCross = document.querySelector(".gx-cross"));
  if (!cross) return;
  const arr = (state.arts || []).slice(-6);
  const cells = cross.querySelectorAll(".gx-cell");
  EQUI_CELLPOS.forEach(({ i }, idx) => { if (cells[idx]) cells[idx].classList.toggle("sel", _eqSel === i); });
  let lic = cross.querySelector(".gx-lic");
  const a = _eqSel >= 0 ? arr[_eqSel] : null;
  if (!a) { cross.classList.remove("licOn"); return; }   // 骨架常驻, licOn 类显隐
  if (!lic) {
    lic = licBuild(cross, arr);
    requestAnimationFrame(() => licSync());   // 新骨架下一帧再 licOn → 首次入场也走 transition
    return;
  }
  cross.classList.add("licOn");
  const slotIdx = (typeof a.slot === "number" && a.slot < 4) ? a.slot : _eqSel;
  const qn = (QUALITY[a.q] || QUALITY[0]).name;
  if (!lic.__els) {   // 骨架只建一次，子元素引用缓存到 lic 上，后续 sync 不再逐次 querySelector
    lic.__els = {
      nb: lic.querySelector(".lh b"),
      lhI: lic.querySelector(".lh i"),
      icoims: lic.querySelectorAll(".licface .icoim"),
      aB: lic.querySelector('.lr[data-k="a"] b'),
      dB: lic.querySelector('.lr[data-k="d"] b'),
      hB: lic.querySelector('.lr[data-k="h"] b'),
      lfx: lic.querySelector(".lfx"),
      lsealEm: lic.querySelector(".lseal em"),
    };
  }
  const E = lic.__els;
  /* v7.1 FIX: 旧存档装备 lv=realmIdx+1(大境界越界), licSync 里也越界返回凡人。
   * 用当前大境界名显示, 并把 a.name 里存的旧"凡人·"前缀替换掉。 */
  const _bi = Math.max(0, Math.min(BIGS.length - 1, Math.floor((state.realmIdx || 0) / 1)));
  /* bigIndexOf 纯函数: 累加 BIGS[i].segs */
  let bigIdx = 0, _acc = 0;
  for (let i = 0; i < BIGS.length; i++) { _acc += BIGS[i].segs; if ((state.realmIdx || 0) < _acc) { bigIdx = i; break; } }
  const bigName = BIGS[bigIdx].n;
  let dispName = a.name || "无名法宝";
  /* 旧装备 name 里存了错误的"凡人·"前缀, 替换成当前大境界 */
  dispName = dispName.replace(/^凡人·/, bigName + "·");
  E.nb.textContent = dispName;
  E.nb.style.color = LIC_QCOL[a.q] || "#e9e2d0";
  E.lhI.textContent = `${bigName}·${qn}·${EQUI_SLOTN[slotIdx] || ""} ★${a.q + 1}`;
  E.icoims.forEach(im => im.classList.toggle("on", +im.dataset.idx === _eqSel));
  E.aB.textContent = "+" + (a.a || 0);
  E.dB.textContent = "+" + (a.d || 0);
  E.hB.textContent = "+" + (a.h || 0);
  E.lfx.innerHTML = (a.fx || []).map(f => `<div class="lr"><span>${FX_TXT[f.k] || f.k}</span><b class="teal">+${f.v}%</b></div>`).join("");
  E.lsealEm.textContent = "战力 " + Math.round(artScore(a));
}

/* ⚠️ v6: 技能恒定 —— skillVal 已下沉到 10-base.js（直接返回 SKILL_DEFS 里的常量）。
 *   旧版的 skillAddExp / skillTotalLv / skillExpNeed 升级链【整条删除】：
 *   技能不再有等级与经验，也就没有"升级落档"这回事，技能彻底不入存档。 */

window.pushBattleStats = pushBattleStats;

function applyDropRates(r) {                  // 服务端下发"每击杀产出"系数(拿不到就用内置默认)
  if (!r || typeof r !== "object") return;
  if (r.equipChance != null) DROP_CFG.equipChance = +r.equipChance;
  if (r.eliteEquipMul != null) DROP_CFG.eliteEquipMul = +r.eliteEquipMul;
  if (window.BattleAPI && window.BattleAPI.setDropRates) window.BattleAPI.setDropRates(r);
  pushBattleStats();
}

window.applyDropRates = applyDropRates;

function renderSkills() {
  const box = $("skillBody"); if (!box) return;
  /* v6: 技能恒定无等级 —— 卡片只剩「名字 + 恒定数值 + 触发方式」，没有经验条 */
  const badge = k => k === "buff"
    ? `<span class="sk-kind buff">状态 · 冷却触发</span>`
    : `<span class="sk-kind dmg">攻击 · 概率触发</span>`;
  const rows = SKILL_DEFS.map(d => {
    const v = skillVal(d.id);
    return `<div class="sk-row">
      <div class="sk-ic">${d.ico}</div>
      <div class="sk-main">
        <div class="sk-top"><b>${d.name}</b>${badge(d.kind)}</div>
        <div class="sk-eff">${d.fmt(v)}</div>
      </div>
    </div>`;
  }).join("");
  const nBuff = SKILL_DEFS.filter(d => d.kind === "buff").length;
  box.innerHTML = `<p class="sk-sum">神通数值恒定，不随战斗精进<br>共习 <b>${SKILL_DEFS.length}</b> 门 · 攻伐 <b>${SKILL_DEFS.length - nBuff}</b> · 身法 <b>${nBuff}</b></p>`
    + `<div class="sk-list">${rows}</div>`;
}

export {
  _cloudSettleRun,
  addJournal,
  adoptKeep,
  applyDropRates,
  artScore,
  bigIdx,
  cldFail,
  cloudCopyId,
  fallbackCopy,
  keepArtQuiet,
  licSync,
  load,
  loadRank,
  openRank,
  openSettings,
  realm,
  renderCraftBtn,
  renderSkills,
  save,
  saveRename,
  showChapter,
  skillVal,
  state,
  smartEquip,
  storyLoadMore,
  toggleBgm,
  toggleSfx,
  updateArts,
  updateRealmUI,
};
