/**
 * 核心服务（本地存档读写/云存档传输/境界推进/主界面刷新）
 *
 * 拓扑层 L3~L4，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, DROP_CFG, JRN_CAP, SAVE_KEY, SKILL_DEFS, STORY_BY_KEY, STORY_PAGE, __set_rate, __set_rkAt, __set_srvOffset, __set_state, __set_storyChap, _pred, _rkAt, _storyChap, cld, cnNum, esc, fmt, rnOk, state } from './00-pure.js';
import * as RM from './00-realm.js';
import { CLD_API, SND, adopt, apiRoot, cldFlash, cldId, cldUI, closeRename, cloudSnap, cloudSoon, deviceId, exitDim, g1Pack, g1Unpack, handleKicked, migrate, pushBattleStats, pushMsg, renderPName, renderSettings, resetDimKnob, rkSegLabel, setRealmSub, sizeBurst, skillVal, storyItemHtml, trimJournal } from './10-base.js';

/**
 * 当前境界描述（旧体系入口，现已改为读 v6 境界表）。
 *
 * ── 阶段5c 改造 ──────────────────────────────────────────────────
 * 原来这里走旧分段表查询（查 00-pure 的 SEG_META，旧的分段表，
 * 由 30-systems.buildSegs() 在启动时填充）。那张表与 v6 的 BIG_REALMS
 * 是【同一套境界的另一份副本】，两处维护必然漂移。
 *
 * 现在直接问 v6 的权威境界表：RM.realmName(state.realmIdx)。
 * 由于阶段5b 已把 v6 境界单向镜像到 state.realmIdx（见 06-v6ui.mirrorRealmToLegacy），
 * 本函数拿到的就是 v6 的当前境界 —— 主线因此「跟境界挂钩」且只有一个数据源。
 *
 * 返回值形状与旧分段函数保持兼容（bigIdx/big/color 等字段名一致），
 * 这样 30-systems/40-app 里的 `realm().big` 等调用一行都不用改。
 */
function realm() { return RM.realmName(state.realmIdx); }

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

sizeBurst();

addEventListener("resize", sizeBurst);

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
  bigIdx,
  cldFail,
  cloudCopyId,
  fallbackCopy,
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
  storyLoadMore,
  toggleBgm,
  toggleSfx,
  updateRealmUI,
};
