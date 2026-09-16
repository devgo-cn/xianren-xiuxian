/**
 * 玩法系统（云游/丹房/装备/巡猎/里程碑/心跳）
 *
 * 拓扑层 L5~L7，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, ARRAY_MAX_LV, AURA_COLORS, AURA_FPS, BIGS, BTL, DAN_ZONE, EQUI_CELLPOS, EQUI_ICON, EQUI_SLOTI, MAIL_CAP, MAIN_STORY, MATS, MS_ARRAY, MS_ART, MS_SPIRIT, MYST, PAGES_NEED, PLOT, QUALITY, REALM_DAYS, RECIPES, SEG4, SEG_META, SEG_SCALE, SKILL_DEFS, SKILL_MAX, SLOT_TYPES, TRAVEL_FIRST_WINDOW, TRAVEL_SPAN, __set_cauldron, __set_eqSel, __set_lastReadyHint, __set_selRecipe, __set_settling, _dsp, _eqSel, _floatPrev, _settling, arrMult, bigSub, cauldron, cld, cnNum, durTxt, fin, finalStats, fmt, lastReadyHint, pulseChip, selRecipe, setProg, skillExpNeed, spawnFloat, state } from './00-pure.js';
import { EQUI_SLOTN, TOTAL_SEGS, __set_auraAcc, __set_auraT, _auraAcc, _auraColor, _auraCtx, _auraP, _auraT, alHave, alInFurn, alTip, arrayCostNow, artMult, artName, attrAssign, buffMult, cldUI, equipBonus, fitsRecipe, hiddenUnlocked, locById, pagesOf, pickNoRepeat, pushMsg, recipeCan, recipeCardHTML, renderBag, renderCabinet, renderFurn, seg, skillGet, skillLv, srvNow, travelBtnLbl, travelMailCount, travelNextMailIn, travelSent, zoneOfBig, 段名 } from './10-base.js';
import { _cloudSettleRun, addJournal, artScore, bigIdx, licSync, realm, renderCraftBtn, renderSkills, save, showChapter, skillAddExp, skillTotalLv, skillVal } from './20-core.js';

(function buildSegs() {
  let cum = 0;
  for (let bi = 0; bi < BIGS.length; bi++) {
    const big = BIGS[bi];
    const s = big.segs;
    const dsecTotal = REALM_DAYS[bi] * 86400;
    const ws = [];
    for (let j = 0; j < s; j++) ws.push(s <= 1 ? 1 : 0.05 + Math.pow(j / (s - 1), 3.0));  // v2.5 段内前快后慢更极端(原1.35→3.0)
    const sw = ws.reduce((a, b) => a + b, 0);
    for (let q = 0; q < s; q++, cum++) {
      let label, isBigEnd = false;
      if (big.n === "凡人") {
        label = "凡人";
      } else if (big.n === "炼气") {
        label = `${big.n}·${cnNum(q + 1)}层`;
        isBigEnd = (q === s - 1);
      } else {
        label = `${big.n}·${SEG4[q]}`;
        isBigEnd = (q === s - 1);
      }
      // 凡人: 新手入门, 几分钟即可渡入炼气; 其余按目标时长 × 大境强度
      const need = big.n === "凡人" ? 2500
        : Math.max(120, Math.round(SEG_SCALE * Math.pow(bi + 1, 3.0) * dsecTotal * ws[q] / sw));
      SEG_META.push({ bigIdx: bi, big: big.n, label, need, isBigEnd,
        color: big.color, c: big.c, segNo: q + 1,
        sub: bigSub(bi) });
    }
  }
})();

async function cldPush() {
  /* v1.8.0: 服务端只有一种写操作 —— 结算。
   * 普通 PUT 会推进结算锚却不发那段时间的收益, 等于把那段收益吃掉;
   * 所以"上传进度"也一律走 settle: 结算本身就是最好的上传。 */
  const r = await cloudSettle();
  return !!r;
}

function cloudPushNow() {
  if (!window.fetch) return;
  if (!cld.ready) { cld.dirty = true; return; }   // 尚未完成首次同步, 先标记等 pull 后再传
  cldUI("sync");
  cldPush().then(ok => { if (ok) { cld.dirty = false; cldUI("on"); } });   // v2.5: 上传成功清脏, 避免周期兜底反复空传
}

function realmMult() { return Math.pow(bigIdx() + 1, 2.05); }

function rateNow() { return Math.max(0, fin(4 * realmMult() * artMult() * arrMult(state.arrayLv) * buffMult(), 0)); }

function maxQIdx() { return Math.min(bigIdx(), QUALITY.length - 1); }

function pickQ() {
  /* v5.0 去掉境界锁品质: 炼气期也能出玄天, 但权重天然低(玄天1/100=1%)。
   * 装备属性 = 境界lv × 品质mult, 炼气玄天也是炼气期用的(数值低), 不破坏平衡。 */
  const t = QUALITY.reduce((s, r) => s + r.w, 0);
  let x = Math.random() * t;
  for (let i = 0; i < QUALITY.length; i++) { x -= QUALITY[i].w; if (x <= 0) return i; }
  return 0;
}

function makeArt() {          // 四部位: 槽0兵器 1护体 2灵佩 3功法
  const q = pickQ();
  const arts = state.arts || [];
  const slot = arts.length < 4 ? arts.length : Math.floor(Math.random() * 4);
  const tp = SLOT_TYPES[slot];
  const lv = (state.realmIdx || 0) + 1;
  let name = artName(tp.k, q, lv);
  const art = { name, q, mult: QUALITY[q].mult, t: Date.now(), tp: tp.k, slot, lv };
  attrAssign(art, tp.k, q, lv);
  return art;
}

function updateHUD() {
  const r = realm();
  /* 聚灵阵: 灵石 / 下一级所需(满级满格); 突破: 修为 / 所需(need=∞ 视为满格) */
  setProg("arrFill", state.arrayLv >= ARRAY_MAX_LV ? 1 : (arrayCostNow() > 0 ? state.spirit / arrayCostNow() : 0));
  setProg("brkFill", (r.need === Infinity || !r.need) ? 1 : state.exp / r.need);   // 用真实修为(非缓动值), 进度与"能否渡劫"严格一致
  /* v1.7.52 按钮下方数字进度 */
  const arrNumEl = $("arrNum");
  if (arrNumEl) arrNumEl.textContent = state.arrayLv >= ARRAY_MAX_LV ? "已圆满" : fmt(state.spirit) + "/" + fmt(arrayCostNow());
  const brkNumEl = $("brkNum");
  if (brkNumEl) brkNumEl.textContent = (r.need === Infinity || !r.need) ? "∞" : fmt(state.exp) + "/" + fmt(r.need);
  $("spirit").textContent = fmt(_dsp.spirit);
  $("rateText").textContent = fmt(rateNow());
  $("arrayLv").textContent = state.arrayLv;
  // v2.5: 所有境界突破均手动 —— 修为圆满即可点突破(小境简版/大境天劫)
  const can = state.exp >= r.need && state.realmIdx < TOTAL_SEGS - 1;
  const btn = $("btnBreak");
  btn.disabled = !can;
  // 注意：绝不能 btn.textContent=...（会删除按钮内嵌的 SVG 墨块皮肤）→ 只更新文字标签
  const bt = btn.querySelector(".label");
  if (bt) bt.innerHTML = "突破";   /* v4.4: 统一"突破"二字, 去掉☯和"修为未圆满"——可突破状态已由 glow-gold 闪光+hint-gold 文字提亮提醒, 文字无需区分状态 */
  btn.classList.toggle("ready", can);
  if (can && !lastReadyHint) {
    __set_lastReadyHint(true);
    if (r.isBigEnd) {
      const nextBig = seg(state.realmIdx + 1).big;
      pushMsg("main", `<span class="r">${r.big}·${段名(r)}已圆满</span>——你随时可亲手渡劫，踏入<span class="g">${nextBig}</span>`);
    } else {
      pushMsg("main", `<span class="g">${r.label} 修为圆满</span>——点击「突破」更进一层`);
    }
  }
  if (!can) __set_lastReadyHint(false);
  /* v1.6.0-A: 离散增益飘字 — 单帧变化远超平滑增速阈值才视为一次获得/花费, 自动覆盖所有获得点(adventure/邮件/离线/精进) */
  const thr = Math.max(6, rateNow() * 0.6);
  const dS = state.spirit - _floatPrev.spirit;
  if (dS > thr) { spawnFloat($("spirit").parentElement, "+" + fmt(dS)); pulseChip($("spirit").parentElement); }
  else if (dS < -thr) { spawnFloat($("spirit").parentElement, fmt(dS), true); }
  _floatPrev.spirit = state.spirit;
  const dE = state.exp - _floatPrev.exp;
  if (dE > thr) spawnFloat($("btnBreak"), "+" + fmt(dE));   // v1.7.46: 进度条移除, 修为飘字改从突破按钮升起
  _floatPrev.exp = state.exp;
  refreshGlow(can);                       // v1.7.31: 可行动入口文字闪烁提醒(突破/聚灵阵/云游/丹房)
}

function refreshGlow(canBreak) {
  const gb = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("glow-gold", !!on); };
  const eb = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("glow-ember", !!on); };
  gb("#btnBreak", canBreak);                                    // 渡劫可突破
  gb("#btnArray", state.arrayLv < ARRAY_MAX_LV && state.spirit >= arrayCostNow());  // 聚灵阵可升级(32级圆满后不再提示)
  gb("#btnTravel", !state.travel);                              // 化身在府可遣出
  let craftAny = false;                                         // 丹房: 存在一则可炼(已通晓且材料足)
  const bi = bigIdx(), mats = state.mats || {};
  for (const id in RECIPES) {
    const rp = RECIPES[id];
    if (!rp || rp.big > bi) continue;
    if (rp.h && !hiddenUnlocked(bi)) continue;
    let ok = true;
    for (const k in rp.need) { if ((mats[k] || 0) < rp.need[k]) { ok = false; break; } }
    if (ok) { craftAny = true; break; }
  }
  eb("#alchemyChip", craftAny);
  /* 文字同步提亮(双保险: 按钮光晕 + 内部文字亮度跳动) */
  const lg = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("hint-gold", !!on); };
  lg("#btnBreak .label", canBreak); lg("#btnArray .label", state.arrayLv < ARRAY_MAX_LV && state.spirit >= arrayCostNow());
  lg("#btnTravel .label", !state.travel);
  const le = document.querySelector("#alchemyChip .lg"); if (le) le.classList.toggle("hint-ember", craftAny);
}

function fireMilestone(flagKey, title, text) {
  const M = state.milestones || (state.milestones = {});
  if (M[flagKey]) return false;
  M[flagKey] = 1;
  addJournal({ key: "ms-" + flagKey, big: realm().big, kind: "纪事", title, text });
  pushMsg("main", `<span class="b">纪事</span>·${title}｜${text}`);
  return true;
}

function checkMilestones() {
  if (state.spirit > state.peakSpirit) state.peakSpirit = state.spirit;
  const q = state.arts.reduce((m, a) => Math.max(m, a.q), -1);
  if (q > state.bestArtQ) state.bestArtQ = q;
  let fired = false;
  for (const [th, t, x] of MS_SPIRIT) if (state.peakSpirit >= th && fireMilestone("s" + th, t, x)) fired = true;
  for (const [L, t, x] of MS_ARRAY) if (state.arrayLv >= L && fireMilestone("r" + L, t, x)) fired = true;
  for (let g = 1; g <= 5; g++) { const [t, x] = MS_ART[g - 1]; if (state.bestArtQ >= g && fireMilestone("a" + g, t, x)) fired = true; }
  if (fired) save();
}

function openStory() {
  const m = $("storyModal");
  if (!m) return;
  renderStory();
  m.classList.add("show");
}

function renderStory() {
  const body = $("storyBody");
  const chips = $("storyChips");
  if (!body || !chips) return;
  const bi = Math.min(bigIdx(), PLOT.length - 1);
  const walked = PLOT.slice(0, bi + 1).map(x => x[0].big).join(" → ");
  let sum = $("storySum");
  if (!sum) {
    sum = document.createElement("div");
    sum.className = "story-sum"; sum.id = "storySum";
    chips.parentNode.insertBefore(sum, chips);
  }
  sum.innerHTML = `已历仙途：<b>${walked}</b>` +
    (state.realmIdx >= TOTAL_SEGS - 1 ? "（仙途漫漫 · 已臻极巅）" : "");
  // 只显示有记载的大境章
  const order = PLOT.slice(0, bi + 1).map(v => v[0].big);
  const chapters = order.filter(b => state.journal.some(j => j.big === b));
  chips.innerHTML = "";
  if (!chapters.length) {
    body.innerHTML = `<div class="empty-hint">尚无记载。<br>仙途伊始，一切从你打坐感应灵气开始。</div>`;
    return;
  }
  chapters.forEach(name => {
    const c = document.createElement("div");
    c.className = "chip";
    c.textContent = name;
    c.onclick = () => showChapter(name);
    chips.appendChild(c);
  });
  // 默认打开当前大境章, 否则最后一章
  const last = state.journal[state.journal.length - 1];
  showChapter(chapters.includes(realm().big) ? realm().big : (last && last.big) || chapters[0]);
}

function auraColorNow() { return AURA_COLORS[Math.min(bigIdx(), AURA_COLORS.length - 1)]; }

/* 灵气粒子层。
 *   tickAura(dt)                    —— 独立模式：画到 #aura 自己的 canvas
 *   tickAura(dt, { ctx, W, H })     —— 舞台模式（v3.2）：画到统一舞台的 ctx，尺寸由舞台给
 *
 * 两种模式共用同一套粒子状态与时序；区别只在"画到哪、按谁的尺寸算"。
 * ⚠️ dt 一律是【原始 dt】，本层不吃身法倍速。 */
function tickAura(dt, target) {
  const tctx = target && target.ctx ? target.ctx : _auraCtx;
  if (!tctx) return;
  __set_auraAcc(_auraAcc + (dt));
  if (_auraAcc < 1 / AURA_FPS) return;          // 限帧 30fps: 不足一帧间隔直接跳过(粒子位置用累计 realDt 补偿, 不丢物理)
  const realDt = _auraAcc; __set_auraAcc(0);
  __set_auraT(_auraT + (realDt));
  const W = (target && target.W) || innerWidth;
  const H = (target && target.H) || innerHeight;
  const c = auraColorNow();
  for (let i = 0; i < 3; i++) _auraColor[i] += (c[i] - _auraColor[i]) * Math.min(1, realDt * 1.5);
  const [r,g,b] = _auraColor.map(v => Math.round(v));
  if (target) {
    /* 舞台模式：不清屏 —— 背景/战斗已经画在同一块画布上，clearRect 会把它们抹掉。
     * 直接叠加绘制，退出时统一复位混合模式。 */
  } else {
    tctx.clearRect(0, 0, W, H);
  }
  /* 【合并后最关键的一处】原先本层靠 CSS mix-blend-mode:screen 与下层做「滤色」，
   * 那是画布级合成 —— 效果是 `1-(1-a)(1-b)`，永远比原色【更亮】、不会变浓。
   *
   * 合并成一张画布后，混合必须在绘制期完成。这里必须用 'screen' 而不是 'lighter'：
   *   lighter (加法)  a+b      —— 叠得越多越"曝"，大面积会糊成一片
   *   screen  (滤色)  1-(1-a)(1-b) —— 与 CSS 的 screen 语义一致，柔和不糊
   *
   * ⚠️ v3.2 首版这里用了 'lighter' 并配了 1.75× 的 alpha 补偿，是错的：
   *    绿色（凡人境灵气色 103,201,171）在加法混合下会盖住背景与纸月，
   *    表现为"几处大区域不停闪烁的绿光"。改回 screen 后不再需要任何补偿。 */
  tctx.globalCompositeOperation = "screen";
  const blobs = [[.25,.3,.5],[.7,.25,.42],[.5,.7,.55],[.82,.72,.4]];
  for (let i = 0; i < blobs.length; i++) {
    const [bx,by,bz] = blobs[i];
    const cx = (bx + Math.sin(_auraT*0.06 + i)*0.05)*W, cy = (by + Math.cos(_auraT*0.05 + i*1.3)*0.05)*H, rad = bz*Math.min(W,H)*0.6;
    const grd = tctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, `rgba(${r},${g},${b},.07)`); grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    tctx.fillStyle = grd; tctx.beginPath(); tctx.arc(cx, cy, rad, 0, 7); tctx.fill();
  }
  for (const p of _auraP) {
    p.y -= p.s*realDt; p.x += Math.sin(_auraT*0.6 + p.ph)*6*realDt;
    if (p.y < -10) { p.y = H + 10; p.x = Math.random()*W; }
    const a = p.a * (0.5 + 0.5*Math.sin(_auraT*1.2 + p.ph));
    tctx.fillStyle = `rgba(${r},${g},${b},${a*0.5})`;
    tctx.beginPath(); tctx.arc(p.x, p.y, p.r, 0, 7); tctx.fill();
  }
  tctx.globalCompositeOperation = "source-over";
}

function mainMoment() {
  const pool = MAIN_STORY[Math.min(bigIdx(), MAIN_STORY.length - 1)];
  const g = Math.round(rateNow() * 2.5);
  state.exp += g;
  pushMsg("main", `<span class="b">主线</span>·修为<span class="g">+${fmt(g)}</span>｜${pickNoRepeat(pool, "m" + bigIdx())}`);
}

function pickLoc() { const z = zoneOfBig(bigIdx()); return { z, l: z.locs[(Math.random() * z.locs.length) | 0] }; }

function travelAvatarHTML() {
  if (state.travel) {
    const l = locById(state.travel.loc);
    const awaySec = Math.max(0, Math.floor((srvNow() - state.travel.since) / 1000));
    /* v1.9.0 面板: 不再有「召回」—— 化身何时回山由信决定。
     * 这里呈现的是「已发几封 / 还要多久下一封 / 何时自动归来」。 */
    const sent = Math.min(travelSent(), travelMailCount(awaySec));
    const want = travelMailCount(awaySec);
    const inFirst = awaySec < TRAVEL_FIRST_WINDOW;
    const backAt = TRAVEL_FIRST_WINDOW;                       // 满 8 封(4 小时)即归来
    const backIn = Math.max(0, backAt - awaySec);
    const nextIn = travelNextMailIn(awaySec);
    const capped = awaySec >= TRAVEL_SPAN;
    const mailLeft = MAIL_CAP - (state.mails || []).length;
    /* 发信节奏说明 */
    const pace = inFirst
      ? `每 <b>30 分钟</b> 一封（前八封）`
      : `每 <b>2 小时</b> 一封（第八封之后）`;
    const nextTxt = capped
      ? `<span style="color:#8fd8bd">已在外满两日，信不再增，化身就此回山。</span>`
      : nextIn == null
        ? `<span style="color:#8fd8bd">八封已足，上线即可收化身回山。</span>`
        : `下一封还需 <b style="color:#c9b98a">${durTxt(nextIn)}</b>`;
    const backTxt = cld.ready
      ? (awaySec >= backAt
          ? `<span style="color:#8fd8bd">已够八封，下次上线化身便自行回山。</span>`
          : `再在外 <b style="color:#c9b98a">${durTxt(backIn)}</b> 满八封，届时上线即自行归来。`)
      : `<span style="color:#8b94a8">云端未就绪，归来判定以服务端为准。</span>`;
    /* 进度: 0..8 封(前段)；超出后段就用"距两日"的进度 */
    const prog = inFirst ? Math.min(8, sent) / 8 : Math.min(1, (awaySec - TRAVEL_FIRST_WINDOW) / (TRAVEL_SPAN - TRAVEL_FIRST_WINDOW));
    const progPct = Math.round(prog * 100);
    const mailWarn = mailLeft <= 0
      ? `<div style="color:#e08a6a;font-size:11px;margin-top:6px">信匣已满 <b>${MAIL_CAP}</b> 封 —— 化身暂时停笔，拆几封它便续上。</div>`
      : mailLeft <= 5
        ? `<div style="color:#c9b98a;font-size:11px;margin-top:6px">信匣余 <b>${mailLeft}</b> 封空位。</div>`
        : "";
    return `<div style="text-align:center;padding:14px 4px">
        <div style="font-family:var(--font-brush);font-size:18px;color:#d8b06a;letter-spacing:.12em">化身在${l ? l.n : "远方"} · ${durTxt(awaySec)}</div>
        <p style="color:#a7b0c4;margin-top:10px;line-height:1.9">化身在外游历，${pace}。已寄回 <b style="color:#c9b98a">${sent}</b> 封手札。<br>满 <b style="color:#c9b98a">八封</b>（四个时辰）化身便自行回山，<b style="color:#c9b98a">无从召回</b>——它在外的所得，全在信里。</p>
        <div style="height:4px;background:rgba(201,168,106,.14);margin:11px 18px 0">
          <i style="display:block;height:100%;width:${Math.min(100, progPct)}%;background:linear-gradient(90deg,rgba(201,168,106,.55),rgba(232,197,107,.95))"></i>
        </div>
        <p style="color:#8b94a8;font-size:11.5px;margin-top:8px;line-height:1.7">${nextTxt}</p>
        <div style="text-align:left;margin:10px 10px 0;padding:9px 11px;background:rgba(201,168,106,.07);border:1px dashed rgba(201,168,106,.22)">
          <div style="font-size:11px;color:#8b94a8;letter-spacing:.04em">归山 · 由信而定</div>
          <div style="font-size:12.5px;color:#c9b98a;margin-top:5px;line-height:1.8">${backTxt}</div>
          ${mailWarn}
        </div>
        <button class="btn" style="margin-top:12px" onclick="openMail()"><svg class="skin" viewBox="0 0 200 60" preserveAspectRatio="none"><path class="ink" d="M12 9 C28 3 44 10 60 6 C76 2 92 8 108 6 C124 4 140 8 158 6 C174 4 192 8 197 16 C199 26 198 34 195 41 C193 46 196 52 182 53 C168 55 154 50 140 53 C124 56 110 50 96 53 C82 56 68 51 56 53 C42 55 30 50 20 52 C8 54 2 46 3 38 C3 28 2 20 5 15 C7 12 9 10 12 9 Z"/></svg><span class="label">去拆信 · 已收 ${(state.mails || []).length} 封</span></button>
        <div style="font-size:10.5px;color:#6d7688;margin-top:8px">开炉炼丹与服丹，请去左上角 <b style="color:#a98a5a">丹</b> 房。</div></div>`;
  }
  const z = zoneOfBig(bigIdx());
  const placeNames = z.locs.map(x => x.n).join("、");
  return `<div style="padding:10px 4px 14px;text-align:center;border-bottom:1px dashed rgba(201,168,106,.16)">
      <div style="font-family:var(--font-brush);font-size:16px;color:#d8b06a;letter-spacing:.06em">${z.name}</div>
      <p style="color:#8b94a8;font-size:11.5px;margin-top:6px;line-height:1.9">化身会顺着自己的心意，在 ${placeNames} 一带游历。<br>在外每满 <b style="color:#a98a5a">30 分钟</b> 寄回一封手札，八封（四个时辰）后<b style="color:#a98a5a">自行回山</b>；若你久不归来，它便放慢到<b style="color:#a98a5a">每 2 小时</b>一封，最多在外守候 <b style="color:#a98a5a">两日</b>。</p>
      <button class="btn" style="margin-top:10px" onclick="startTravel()"><svg class="skin" viewBox="0 0 200 60" preserveAspectRatio="none"><path class="ink" d="M12 9 C28 3 44 10 60 6 C76 2 92 8 108 6 C124 4 140 8 158 6 C174 4 192 8 197 16 C199 26 198 34 195 41 C193 46 196 52 182 53 C168 55 154 50 140 53 C124 56 110 50 96 53 C82 56 68 51 56 53 C42 55 30 50 20 52 C8 54 2 46 3 38 C3 28 2 20 5 15 C7 12 9 10 12 9 Z"/></svg><span class="label">遣化身出门</span></button>
    </div>
    <div style="font-size:10.5px;color:#6d7688;text-align:center;padding:10px 4px;line-height:1.8">拾得的药草与丹方残页都装在<b style="color:#a98a5a">鸿雁信匣</b>里，拆开才算你的。<br>信匣最多存 <b style="color:#a98a5a">${MAIL_CAP}</b> 封，满了化身就停笔。</div>`;
}

function openTravel() {
  const m = $("travelModal"); if (!m) return;
  const box = $("travelBody"); if (!box) return;
  box.innerHTML = travelAvatarHTML();
  m.classList.add("show");
  travelBtnLbl();
}

function renderRecipes() {
  const el = $("rpList"); if (!el) return;
  const bi = bigIdx();
  const ok = Object.keys(RECIPES).filter(id => {
    const rp = RECIPES[id];
    if (rp.big > bi) return false;                        // 境界未至不示
    if (rp.h && !hiddenUnlocked(rp.big)) return false;    // 残卷未齐不示
    return recipeCan(id);                                 // 材料齐则现
  });
  el.innerHTML = ok.length ? ok.map(id => {
    const rp = RECIPES[id];
    const need = Object.keys(rp.need).map(m => `${MATS[m].n}${rp.need[m]}`).join(" · ");
    const fn = rp.d.split("：").pop();                    // 只展示功能: 取「:」后段
    return `<div class="rp-card${selRecipe === id ? " sel" : ""}" title="${rp.n} · ${rp.d}｜需 ${need}" onclick="loadRecipe('${id}')">
      <div class="rp-ico"><img class="icoim" src="assets/modals/ico/${id}.webp" alt="" onerror="this.remove()">${rp.n[rp.n.length - 2] || "丹"}</div>
      <div class="rp-bd"><span class="nm">${rp.n}</span><span class="ds">${fn}</span></div>
      <div class="rp-arrow">${selRecipe === id ? "在炉" : "入炉"}</div></div>`;
  }).join("") : `<div class="al-empty" style="border:1px dashed rgba(201,168,106,.16);border-radius:10px;padding:13px;text-align:center;font-style:normal">
    <b style="font-size:12px;color:#8b94a8;letter-spacing:2px;font-weight:normal">暂 无 可 炼 丹 方</b></div>`;
}

function renderAlch() { renderFurn(); renderBag(); renderRecipes(); renderCabinet(); renderCraftBtn(); }

function putMat(m) {
  if (alHave(m) - alInFurn(m) <= 0) return;
  cauldron[m] = alInFurn(m) + 1;
  if (selRecipe && !fitsRecipe()) __set_selRecipe(null);
  renderAlch();
  alTip("bagTip", m);
}

function takeMat(m) {
  if (!cauldron[m]) return;
  cauldron[m]--; if (!cauldron[m]) delete cauldron[m];
  if (selRecipe && !fitsRecipe()) __set_selRecipe(null);
  renderAlch();
  alTip("furnTip", m);
}

function loadRecipe(id) {
  if (!recipeCan(id)) { pushMsg("main", "材料不齐，丹炉难以为继"); return; }
  __set_selRecipe(selRecipe === id ? null : id);
  __set_cauldron({});
  if (selRecipe) for (const m in RECIPES[id].need) cauldron[m] = RECIPES[id].need[m];
  renderAlch();
}

function openAlchemy() {
  const m = $("alchemyModal"); if (!m) return;
  renderAlch();
  m.classList.add("show");
}

function craftAreaHTML() {
  const bi = bigIdx();
  const groups = {};
  for (const id of Object.keys(RECIPES)) {
    const big = RECIPES[id].big;
    (groups[big] = groups[big] || []).push(id);
  }
  let html = `<div class="al-sec">开炉炼丹 <i>已通晓「${DAN_ZONE[Math.min(bi, 11)] || "?"}」及以下丹道</i></div>`;
  for (let big = 0; big <= bi; big++) {
    const list = groups[big];
    if (!list || !list.length) continue;
    html += `<div class="al-zone">${DAN_ZONE[big] || big} · 丹道</div>`;
    for (const id of list) {
      const rp = RECIPES[id];
      if (!rp) continue;
      if (rp.h) {
        if (hiddenUnlocked(big)) html += recipeCardHTML(id);
        else {
          const got = pagesOf(big);
          html += `<div class="al-secret"><div class="bd">
            <div class="qn">???.${DAN_ZONE[big]}古方残卷 <span class="pg">残页 ${got}/${PAGES_NEED[big]}</span></div>
            <div class="tip">云游${DAN_ZONE[big]}一带有机会拾得残页，凑齐自见丹方真容。</div></div></div>`;
        }
        continue;
      }
      html += recipeCardHTML(id);
    }
  }
  if (bi < 11) html += `<div class="al-empty" style="font-style:italic">更高一境的丹方，待你亲临其境，自有丹师相授。</div>`;
  return html;
}

async function cloudSettle() {
  if (!window.fetch || !cld.id || _settling) return null;
  __set_settling(true);
  try { return await _cloudSettleRun(); } finally { __set_settling(false); }
}

function traceTap() { if (!BTL && !MYST) openTravel(); }

function openEquip() {
  const m = $("equipModal"); if (!m) return;
  renderEquip();
  m.classList.add("show");
}

function renderEquip() {                 // v1.9.8 十字格工作台: 四正方格上下左右 + 中央总战力, 点格显属性
  const box = $("equipBody"); if (!box) return;
  const eb = equipBonus();
  const arr = (state.arts || []).slice(-6);
  const SLOTN = EQUI_SLOTN, SLOTI = EQUI_SLOTI, CELLPOS = EQUI_CELLPOS, ICON = EQUI_ICON;
  const sc = (a) => Math.round(artScore(a));   // v1.9.9b: 抽 licCardHTML 时误删的局部定义, total 战力依赖它(缺失会 ReferenceError 致法宝窗打不开)
  let cross = "";
  let total = 0;
  for (const { pos, i } of CELLPOS) {
    const a = arr[i];
    const slotI = SLOTI[(typeof (a && a.slot) === "number" && a.slot < 4) ? a.slot : i];
    if (!a) {
      cross += `<div class="gx-cell ${pos}" style="cursor:default" title="${SLOTN[i]} · 空位">
        <span class="ico" style="opacity:.32"><img class="icoim" src="assets/modals/art-ico/${slotI}0.webp" alt="" onerror="this.remove()">${ICON[slotI]}</span><em>${SLOTN[i]} · 空</em></div>`;
      continue;
    }
    const q = a.q;
    total += sc(a);
    cross += `<div class="gx-cell ${pos} qc${q}" title="${(QUALITY[q] || QUALITY[0]).name} · ${a.name}" onclick="event.stopPropagation();pickArt(${i})">
      <span class="ico"><img class="icoim" src="assets/modals/art-ico/${slotI}${q}.webp" alt="" onerror="this.remove()">${ICON[slotI]}</span><em>${SLOTN[i]}</em></div>`;
  }
  /* v1.9.8c 下方面板: 角色「道身」各项总属性(裸身+装备+词条合并后的面板值), 常显不随选中变化 */
  let detail;
  {
    const lv = (state.realmIdx || 0) + 1;
    const hs = finalStats({ hp: 100 + 330 * lv, atk: 10 + 46 * lv, def: 5 + 26 * lv },
      { hp: eb.hp || 0, atk: eb.atk || 0, def: eb.def || 0 }, eb.agg);
    const ag = eb.agg || {};
    const rn = ["会心", "暴击", "爆伤", "破甲", "闪避", "吸血", "攻速"];
    const rk = ["crit", "critB", "critD", "pen", "dodge", "life", "aspd"];
    var _detRows =
      `<div class="sr"><span>气 血</span><b>${fmt(hs.hp)}</b></div>` +
      `<div class="sr"><span>攻 击</span><b>${fmt(hs.atk)}</b></div>` +
      `<div class="sr"><span>防 御</span><b>${fmt(hs.def)}</b></div>` +
      `<div class="sr"><span>修 为</span><b class="teal">×${artMult().toFixed(2)}</b></div>` +
      rk.map((k, i) => `<div class="sr"><span>${rn[i]}</span><b${ag[k] ? ` class="teal"` : ""}>${ag[k] ? "+" + ag[k] + "%" : "—"}</b></div>`).join("");
    detail = `<div class="cap" style="margin:0 1px 7px">道 身 · 各项属性</div>
      <div class="stgrid">${_detRows}</div>`;
  }
  box.innerHTML = `
    <div class="pane gx-sum"><div class="gx-grid">
      <div><em>攻</em><b>+${eb.atk}</b></div><div><em>防</em><b>+${eb.def}</b></div>
      <div><em>血</em><b>+${eb.hp}</b></div><div><em>修为</em><b>×${artMult().toFixed(2)}</b></div>
    </div></div>
    <div class="gx-cross">${cross}<div class="gx-core" onclick="closeLic(event)"><b>${total}</b><em>战 力</em></div></div>
    <div class="pane gx-detail">${detail}</div>`;
  box.onclick = closeLic;   // v1.9.9b 点弹窗任意空白处关闭执照卡(格子已 stopPropagation 转为切换)
  licSync();
}

function pickArt(i) { __set_eqSel(_eqSel === i ? -1 : i); licSync(); }

function closeLic(e) { if (e) e.stopPropagation(); __set_eqSel(-1); licSync(); }

function skillAddExpAll(n) { for (const d of SKILL_DEFS) skillAddExp(d.id, n); }

window.SkillAPI = {
  defs: SKILL_DEFS, max: SKILL_MAX, need: skillExpNeed,
  lv: skillLv, val: skillVal, exp: id => skillGet(id).exp,
  addExp: skillAddExp, addExpAll: skillAddExpAll, total: skillTotalLv,
};

function openSkills() {
  renderSkills();
  const m = $("skillModal"); if (m) m.classList.add("show");
}

window.openSkills = openSkills;

export {
  auraColorNow,
  checkMilestones,
  cldPush,
  closeLic,
  cloudPushNow,
  cloudSettle,
  craftAreaHTML,
  fireMilestone,
  loadRecipe,
  mainMoment,
  makeArt,
  maxQIdx,
  openAlchemy,
  openEquip,
  openSkills,
  openStory,
  openTravel,
  pickArt,
  pickLoc,
  pickQ,
  putMat,
  rateNow,
  realmMult,
  refreshGlow,
  renderAlch,
  renderEquip,
  renderRecipes,
  renderStory,
  skillAddExpAll,
  takeMat,
  tickAura,
  traceTap,
  travelAvatarHTML,
  updateHUD,
};
