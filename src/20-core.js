/**
 * 核心服务（本地存档读写/云存档传输/境界推进/主界面刷新）
 *
 * 拓扑层 L3~L4，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, BIGS, DROP_CFG, EQUI_CELLPOS, FX_TXT, JRN_CAP, LIC_QCOL, MATS, QUALITY, SAVE_KEY, SKILL_DEFS, SKILL_MAX, SLOT_TYPES, STORY_BY_KEY, STORY_PAGE, __set_rate, __set_rkAt, __set_skillSaveT, __set_srvOffset, __set_state, __set_storyChap, __set_traceT, __set_travelReturned, _eqRecycle, _eqSel, _pred, _rkAt, _skillSaveT, _storyChap, _traceT, _travelReturned, cld, cnNum, esc, fmt, rnOk, selRecipe, skillExpNeed, state } from './00-pure.js';
import { CLD_API, EQUI_SLOTN, SND, adopt, apiRoot, artCtx, cldFlash, cldId, cldUI, closeRename, cloudSnap, cloudSoon, debugEncounter, deviceId, ensureScrollFx, exitDim, fitsRecipe, g1Pack, g1Unpack, handleKicked, licBuild, locById, mailDot, mailLine, migrate, pushBattleStats, pushMsg, renderPName, renderPillHints, renderSettings, resetDimKnob, rkSegLabel, seg, setRealmSub, sizeBurst, skillDef, skillGet, skillLv, storyItemHtml, traceRefresh, travelBtnLbl, trimJournal } from './10-base.js';

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

function save() {
  state.lastTs = Date.now();
  trimJournal();
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
    cult0.style.setProperty("--rg", `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},.32)`);   // v1.7.38: 辉光调淡
  }
}

function addJournal(entry) {
  const b = entry.key && STORY_BY_KEY[entry.key];
  if (b) {                          // 预置剧情: 只存数字引用, 不存文本
    state.journal.push({ sid: b.sid, big: b.big || entry.big, kind: b.kind || entry.kind, ts: Date.now() });
  } else {                          // 动态事件(离线游历/纪事等): 仍存文本
    entry.ts = Date.now();
    state.journal.push(entry);
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
    arts[idx] = a; return true;
  }
  return false;   // v5.4: 新件不入眼直接丢弃, 不熔灵石
}

function renderCraftBtn() {
  const b = $("craftBtn"); if (!b) return;
  b.disabled = !(selRecipe && fitsRecipe());
}

travelBtnLbl();

renderPillHints();

function adoptKeep(st) {          // 采用结算后的存档, 但本地叙事(非云端净化)不回退
  const keep = (state.journal || []).slice();
  const hadTravel = state.travel;          // 采纳前的本地云游状态
  /* v2.5 技能存档保护: 服务端旧档(神通系统上线前入库)不带 skills —— 不得用它回滚本地技能等级 */
  const keepSkills = (state.skills && Object.keys(state.skills).length) ? state.skills : null;
  const c = adopt(st);
  if (!c) return false;
  if (!c.skills && keepSkills) c.skills = keepSkills;
  c.journal = keep.length >= (c.journal || []).length ? keep : c.journal;
  /* v1.8.1 派发竞态保护(沿用): 心跳的普通 settle 不该把刚派发的云游抹掉。
   * 只有当服务端明确给出「化身归来」事件(gains.travel)时才认可清空。
   * v1.9.0 补充: 归来由「满 8 封」决定, 因此若本地已发满 8 封而服务端尚未判归来,
   * 也保留 travel —— 等下一次上线结算时由服务端统一收走, 不在此提前清。 */
  if (hadTravel && !c.travel && !_travelReturned) {
    c.travel = hadTravel;
  }
  __set_state(c);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  travelBtnLbl();            // 云端结算可能清 travel(化身归来) → 按钮文字同步
  renderPillHints();         // v1.9.8c.2: 结算合并后药力过期段已被服务端清掉 → 药力行同步
  mailDot();
  return true;
}

function showTravelMail(mail) {
  const loc = locById(mail.loc);
  const where = loc ? loc.n : "远方";
  pushMsg("avatar", `鸿雁衔书而至｜化身自${where}寄回一封手札`);
  pushMsg("main", `<span class="b">雁书已入信匣</span>：化身在${where}写了封信，内附几样远行收获。<br>点右上角鸿雁展开，收取后方才归你。`);
  if ($("mailModal") && $("mailModal").classList.contains("show")) renderMailBox();
  mailDot();
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
      /* v1.8.1: 先判定本轮是否「真归来」, 再 adopt —— adoptKeep 据此决定是否保留本地 travel */
      __set_travelReturned(!!(j.gains && j.gains.travel));
      const j0 = await g1Unpack(j.data);
      if (!adoptKeep(j0)) return null;
      __set_travelReturned(false);
      _pred.exp = 0; _pred.spirit = 0;     // 账本已被服务端权威值覆盖 → 本地预测清零, 从新账本重新开始
      state._lastTs0 = Date.now(); state._settledTs = Date.now();
      mailDot();
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

function openMail() {
  const m = $("mailModal"); if (!m) return;
  renderMailBox();
  m.classList.add("show");
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

function renderMailBox() {
  const box = $("mailBody"); if (!box) return;
  const ml = (state.mails || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  /* v1.8.2 一键收取: 信匣有条数时显示批量条 */
  const bar = $("mailBulkBar"), cnt = $("mailBulkCount");
  if (bar) bar.style.display = ml.length ? "" : "none";
  if (cnt) cnt.textContent = ml.length ? `共 ${ml.length} 封` : "";
  if (!ml.length) {
    box.innerHTML = `<div class="mail-empty">信匣空空。<br>遣化身出门远行，它每半小时便会托雁足捎信回来——<br>到时候，记得拆开看看。</div>`;
    return;
  }
  box.innerHTML = ml.map(m => {
    const loc = locById(m.loc);
    const where = loc ? loc.n : "远方";
    const mins = Math.max(1, Math.round((Date.now() - (m.ts || Date.now())) / 60000));
    const ag = mins >= 60 ? (mins / 60 >= 24 ? Math.round(mins / 1440) + " 天前" : Math.round(mins / 60) + " 小时前") : mins + " 分钟前";
    /* v1.9.9e 内附物品图标化: 缩小的 ico 物品图 + 名称 + 数量(图标库 assets/modals/ico/<id>.webp);
       丹方残页无专属图, 用内联纸卷 SVG 兜底; 无附件显示平安信 */
    const chips = [];
    for (const mk of (m.mats || [])) if (MATS[mk.id]) {
      chips.push(`<span class="mg" title="${MATS[mk.id].n}"><img src="assets/modals/ico/${mk.id}.webp" alt="" onerror="this.remove()"><em>${MATS[mk.id].n}</em><i>×${mk.q}</i></span>`);
    }
    if (m.page) chips.push(`<span class="mg" title="丹方残页"><svg viewBox="0 0 24 24"><path d="M7 3.5h7.2L18.5 8v12.5H7z" fill="#e8dcc0" stroke="rgba(140,110,60,.55)" stroke-width="1.1"/><path d="M14.2 3.5 18.5 8h-4.3z" fill="#c9b98f"/><path d="M9.2 11.5h6.4M9.2 14.2h6.4M9.2 16.9h4.2" stroke="rgba(120,95,55,.5)" stroke-width="1.1" stroke-linecap="round"/></svg><em>丹方残页</em><i>×1</i></span>`);
    const goods = chips.length
      ? `<span class="m-gl">内附</span>${chips.join("")}`
      : `<span class="m-plain">一封平安信，无甚物什</span>`;
    return `<div class="mail-item">
      <div class="mail-head">
        <span class="m-loc" title="${where}">${where.slice(0, 1)}</span>
        <span class="m-from">${where} · 化身亲笔</span>
        <span class="m-age">${ag}</span>
      </div>
      <p class="mail-txt">“${mailLine(m.loc, m.ts)}”</p>
      <div class="mail-foot">
        <span class="m-goods">${goods}</span>
        <button class="btn primary seal" type="button" onclick="collectMail('${m.id}')"><span class="label">收 取</span></button>
      </div>
    </div>`;
  }).join("");
}

function traceBeat() {
  if (!state) return;
  if (document.hidden) return;
  /* 原战斗系统已移除，新战斗动画后续接入资源结算 */
  if (Date.now() - _traceT > 150000) { __set_traceT(Date.now()); traceRefresh(); }
}

function traceBeatLoop() {
  traceBeat();
  setTimeout(traceBeatLoop, 2500);
}

setTimeout(traceBeatLoop, 2500);

traceRefresh();

window.debugEncounter = debugEncounter;

function artScore(a) {                    /* v1.9.6 品质锚定: 星品主导、浮分封顶, 低星数学上永不越高星 */
  const lv = (state.realmIdx || 0) + 1;
  let base = (a.a || 0) + 3 * (a.d || 0) + (a.h || 0) / 30;   // 斗法三维(实战权重不变)
  const c = artCtx();
  let fx = 0;
  for (const f of (a.fx || [])) {
    const p = f.v / 100;
    let val = 0;
    if (f.k === "atk") val = p * c.atkRef;
    else if (f.k === "hp") val = p * c.hpRef / 30;
    else if (f.k === "dfn") val = p * c.defRef * 3;
    else if (f.k === "crit") val = p * c.atkRef * 0.55;
    else if (f.k === "critB") val = p * c.atkRef * 1.0;
    else if (f.k === "critD") val = p * c.atkRef * 0.15;
    else if (f.k === "pen") val = p * c.atkRef * 0.35;
    else if (f.k === "dodge") val = p * c.defRef * 1.4;
    else if (f.k === "life") val = p * c.atkRef * 0.5;
    else if (f.k === "aspd") val = p * c.atkRef * 0.8;
    /* v5.0 极品词条: 数值已×1.8, 评分额外再加30%权重, 确保极品在阿青择优中优先 */
    fx += val * (f.legendary ? 1.3 : 1);
  }
  /* 星级锚: 相邻星差 ×境界逐级放宽; 三维+词条压缩成浮分且封顶在本档步长内
     → 同星内比 roll 肥瘦, 跨星看锚差 —— 2星防血装 roll 再肥也压不过 4星古宝,
     阿青择优(smartEquip/keepArtQuiet 同用此分)恢复"品质优先, 同品质比养成"的直觉 */
  const STEP = [32, 38, 44, 50, 56, 62];
  const q = Math.max(0, Math.min(5, a.q | 0));
  const anchor = lv * STEP.slice(0, q).reduce((s, x) => s + x, 0);
  return Math.round(anchor + Math.min(lv * STEP[q], (base + fx) * 0.32));
}

function smartEquip(a) {
  const arts = state.arts || [];
  const idx = (typeof a.slot === "number" && a.slot < 4) ? a.slot : arts.length;
  const q0 = QUALITY[a.q];
  if (idx >= arts.length) {                 // 空槽: 直接穿戴
    arts.push(a); state.arts = arts;
    pushMsg("avatar", `阿青把 ${a.name}（${q0.name}·${SLOT_TYPES[idx].n}）放进藏宝阁 —— 已替穿戴。`);
    updateArts(true); save(); cloudSoon(); return;
  }
  const w = arts[idx];
  if (!w) { arts[idx] = a; updateArts(true); save(); cloudSoon(); return; }
  if (artScore(a) > artScore(w)) {                          // 同槽择优: 只看综合分, 同品质可替换
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
  E.nb.textContent = a.name || "无名法宝";
  E.nb.style.color = LIC_QCOL[a.q] || "#e9e2d0";
  const bigName = (BIGS[Math.max(0, (a.lv || 1) - 1)] || BIGS[0]).n;
  E.lhI.textContent = `${bigName}·${qn}·${EQUI_SLOTN[slotIdx] || ""} ★${a.q + 1}`;
  E.icoims.forEach(im => im.classList.toggle("on", +im.dataset.idx === _eqSel));
  E.aB.textContent = "+" + (a.a || 0);
  E.dB.textContent = "+" + (a.d || 0);
  E.hB.textContent = "+" + (a.h || 0);
  E.lfx.innerHTML = (a.fx || []).map(f => `<div class="lr"><span>${FX_TXT[f.k] || f.k}</span><b class="teal">+${f.v}%</b></div>`).join("");
  E.lsealEm.textContent = "战力 " + Math.round(artScore(a));
}

function skillVal(id) {
  const d = skillDef(id); if (!d) return null;
  const t = (skillLv(id) - 1) / (SKILL_MAX - 1), o = {};
  for (const k in d.from) o[k] = d.from[k] + (d.to[k] - d.from[k]) * t;
  return o;
}

function skillAddExp(id, n) {
  if (!(n > 0)) return;
  const s = skillGet(id);
  if (s.lv >= SKILL_MAX) { s.exp = 0; return; }
  s.exp += n;
  s.exp = Math.round(s.exp * 100) / 100;   // 浮点累加收敛到两位小数，避免 0.1+0.2 类误差累积
  let up = 0;
  while (s.lv < SKILL_MAX && s.exp >= skillExpNeed(s.lv)) { s.exp -= skillExpNeed(s.lv); s.lv++; up++; }
  if (up) {
    const d = skillDef(id);
    pushMsg("main", `<b style="color:#f0c98a">${d ? d.name : id}</b> 精进至 <b>Lv.${s.lv}</b>`);
    __set_skillSaveT(0);                                   // 升级立刻落档, 不节流
  }
  if (Date.now() - _skillSaveT > 15000) { __set_skillSaveT(Date.now()); save(); cloudSoon(); }
}

function skillTotalLv() { let t = 0; for (const d of SKILL_DEFS) t += skillLv(d.id); return t; }

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
  const rows = SKILL_DEFS.map(d => {
    const s = skillGet(d.id), lv = skillLv(d.id), maxed = lv >= SKILL_MAX;
    const need = skillExpNeed(lv), pct = maxed ? 100 : Math.min(100, (s.exp / need) * 100);
    const v = skillVal(d.id);
    /* v2.6.1: 单行紧凑卡 —— 触发时机并入 fmt, 砍说明行, 经验并入进度条同行 → 8 门一屏放下 */
    return `<div class="sk-row${maxed ? " maxed" : ""}">
      <div class="sk-ic">${d.ico}</div>
      <div class="sk-main">
        <div class="sk-top"><b>${d.name}</b><span class="sk-lv">Lv.${lv}<i>/${SKILL_MAX}</i></span></div>
        <div class="sk-eff">${d.fmt(v)}</div>
        <div class="sk-meta"><div class="sk-bar"><i style="width:${pct.toFixed(1)}%"></i></div><span class="sk-exp">${maxed ? "已臻化境" : `${Math.floor(s.exp)} / ${need}`}</span></div>
      </div>
    </div>`;
  }).join("");
  const total = skillTotalLv();
  box.innerHTML = `<p class="sk-sum">神通战斗中自行触发精进，不增益攻防血<br>共习 <b>${SKILL_DEFS.length}</b> 门 · 累计 <b>${total}</b> / ${SKILL_MAX * SKILL_DEFS.length} 阶</p>`
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
  openMail,
  openRank,
  openSettings,
  realm,
  renderCraftBtn,
  renderMailBox,
  renderSkills,
  save,
  saveRename,
  showChapter,
  showTravelMail,
  skillAddExp,
  skillTotalLv,
  skillVal,
  smartEquip,
  storyLoadMore,
  toggleBgm,
  toggleSfx,
  traceBeat,
  updateArts,
  updateRealmUI,
};
