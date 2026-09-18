/**
 * 玩法系统（云游/丹房/装备/巡猎/里程碑/心跳）
 *
 * 拓扑层 L5~L7，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, ARRAY_MAX_LV, AURA_COLORS, AURA_FPS, BIGS, BTL, EQUI_CELLPOS, EQUI_SLOTI, MAIN_STORY, MS_ARRAY, MS_ART, MS_SPIRIT, MYST, PAGES_NEED, PLOT, QUALITY, REALM_DAYS, SEG4, SEG_META, SEG_SCALE, SKILL_DEFS, SLOT_TYPES, __set_eqSel, __set_lastReadyHint, __set_settling, _dsp, _eqSel, _floatPrev, _settling, arrMult, bigSub, cld, cnNum, durTxt, fin, finalStats, fmt, lastReadyHint, pulseChip, setProg, spawnFloat, state } from './00-pure.js';
import { BASE_STATS, EQ_POW, QW_TABLE, bigIndexOf, boostMult, EQUI_SLOTN, TOTAL_SEGS, __set_auraAcc, __set_auraT, _auraAcc, _auraColor, _auraCtx, _auraP, _auraT, arrayCostNow, artMult, artName, attrAssign, buffMult, cldUI, equipBonus, hiddenUnlocked, pagesOf, pickNoRepeat, pushMsg, seg, srvNow, 段名 } from './10-base.js';
import { _cloudSettleRun, addJournal, artScore, bigIdx, licSync, realm, renderCraftBtn, renderSkills, save, showChapter, skillVal } from './20-core.js';

(function buildSegs() {
  let cum = 0;
  for (let bi = 0; bi < BIGS.length; bi++) {
    const big = BIGS[bi];
    const s = big.segs;
    const dsecTotal = REALM_DAYS[bi] * 86400;
    const ws = [];
    for (let j = 0; j < s; j++) ws.push(s <= 1 ? 1 : (j + 1) / s);  // v2.6 线性分配: 圆满占40%, 中间段平滑递增, 消除圆满陡增
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

function rateNow() {
  /* v5.7: boost 池(丹力/兽潮)在线也生效, 与服务端 gExp = 4*arrM*dt*pillMult*offMult 对齐 —— 在线挂机不能比离线亏 */
  return Math.max(0, fin(4 * realmMult() * artMult() * arrMult(state.arrayLv) * buffMult() * boostMult(), 0));
}

function pickQ() {
  /* v7.1: 品质权重按大境界走 QW_TABLE 手动表 —— 前期玄天极稀(1%), 中后期抬升,
   * 合体之后可攒全红毕业 → 虐杀 121。装备仍境界卡死(数值=本境 EQ_POW), 不破坏平衡。 */
  const bi = bigIndexOf(state.realmIdx);   /* v7.2b 纯函数推算 */
  const qw = QW_TABLE[Math.min(QW_TABLE.length - 1, bi)] || QUALITY.map(r => r.w);
  const t = qw.reduce((s, r) => s + r, 0);
  let x = Math.random() * t;
  for (let i = 0; i < QUALITY.length; i++) { x -= qw[i]; if (x <= 0) return i; }
  return 0;
}

function makeArt() {          // 四部位: 槽0兵器 1护体 2灵佩 3功法
  const q = pickQ();
  const arts = state.arts || [];
  const slot = arts.length < 4 ? arts.length : Math.floor(Math.random() * 4);
  const tp = SLOT_TYPES[slot];
  const bi = bigIndexOf(state.realmIdx);   /* v7.2b 纯函数推算 */
  /* v7.1 FIX: lv 必须用大境界索引(bi+1), 不是 realmIdx+1。
   * realmIdx 是小境界连续编号(炼气就13段), 直接当BIGS索引会越界→全返回凡人。 */
  const lv = bi + 1;
  let name = artName(tp.k, q, lv);
  const art = { name, q, mult: QUALITY[q].mult, t: Date.now(), tp: tp.k, slot, lv };
  /* v7.1: 数值因子用 EQ_POW[ri](×4质变), art.lv 仅作展示/境界归属 */
  attrAssign(art, tp.k, q, EQ_POW[Math.min(EQ_POW.length - 1, bi)] || 1);
  return art;
}

const _hud = { arrNum: null, brkNum: null, spirit: null, rateText: null, arrayLv: null, btnBreak: null };

function updateHUD() {
  /* ⚠️ v6 关键修复（勿回退）：
   *   旧系统的 HUD 元素（#arrNum / #brkNum / #arrayLv / #btnBreak 及其 .actions 容器）
   *   已在 a70db3e 的 §9 清理中从 index.html 删除（聚灵阵/突破/云游按钮整块移除）。
   *   但 updateHUD() 仍在无条件写这些已不存在的节点 →
   *   `Cannot set properties of null (setting 'textContent')` →
   *   bootGate 抛异常返回 false → startGame() 不执行 → mountStage() 不执行 →
   *   战斗层从未挂上舞台 → 表现为「战斗 update() 完全不跑、kills 恒 0、技能 CD 不动」。
   *   所以这里把所有旧元素的访问改成【存在才写】。这些分支在 §9 收尾时随元素一起删。 */
  if (!_hud.spirit) {
    _hud.arrNum = $("arrNum"); _hud.brkNum = $("brkNum");
    _hud.spirit = $("spirit"); _hud.rateText = $("rateText");
    _hud.arrayLv = $("arrayLv"); _hud.btnBreak = $("btnBreak");
  }
  const r = realm();
  const _rate = rateNow();
  const legacy = !!_hud.btnBreak;          // 旧 UI 还在才走旧分支
  if (legacy) {
    /* 聚灵阵: 灵石 / 下一级所需(满级满格); 突破: 修为 / 所需(need=∞ 视为满格) */
    setProg("arrFill", state.arrayLv >= ARRAY_MAX_LV ? 1 : (arrayCostNow() > 0 ? state.spirit / arrayCostNow() : 0));
    setProg("brkFill", (r.need === Infinity || !r.need) ? 1 : state.exp / r.need);   // 用真实修为(非缓动值), 进度与"能否渡劫"严格一致
    /* v1.7.52 按钮下方数字进度 */
    if (_hud.arrNum) _hud.arrNum.textContent = state.arrayLv >= ARRAY_MAX_LV ? "已圆满" : fmt(state.spirit) + "/" + fmt(arrayCostNow());
    if (_hud.brkNum) _hud.brkNum.textContent = (r.need === Infinity || !r.need) ? "∞" : fmt(state.exp) + "/" + fmt(r.need);
    _hud.arrayLv.textContent = state.arrayLv;
  }
  if (_hud.spirit) _hud.spirit.textContent = fmt(_dsp.spirit);
  if (_hud.rateText) _hud.rateText.textContent = fmt(_rate);
  // v2.5: 所有境界突破均手动 —— 修为圆满即可点突破(小境简版/大境天劫)
  const can = state.exp >= r.need && state.realmIdx < TOTAL_SEGS - 1;
  const btn = _hud.btnBreak;
  if (btn) {
    btn.disabled = !can;
    // 注意：绝不能 btn.textContent=...（会删除按钮内嵌的 SVG 墨块皮肤）→ 只更新文字标签
    const bt = btn.querySelector(".label");
    if (bt) { if (bt.textContent !== "突破") bt.textContent = "突破"; }   /* v4.4: 统一"突破"二字, 去掉☯和"修为未圆满"——可突破状态已由 glow-gold 闪光+hint-gold 文字提亮提醒, 文字无需区分状态 */
    btn.classList.toggle("ready", can);
  }
  if (can && !lastReadyHint) {
    __set_lastReadyHint(true);
    if (r.isBigEnd) {
      const nextBig = seg(state.realmIdx + 1).big;
      pushMsg("main", `<span class="r">${r.big}·${段名(r)}已圆满</span>——你随时可亲手渡劫，踏入<span class="g">${nextBig}</span>`);
    } else if (legacy) {
      pushMsg("main", `<span class="g">${r.label} 修为圆满</span>——点击「突破」更进一层`);
    }
  }
  if (!can) __set_lastReadyHint(false);
  /* v1.6.0-A: 离散增益飘字 — 单帧变化远超平滑增速阈值才视为一次获得/花费, 自动覆盖所有获得点(adventure/邮件/离线/精进) */
  const thr = Math.max(6, _rate * 0.6);
  const dS = state.spirit - _floatPrev.spirit;
  if (dS > thr && _hud.spirit) { spawnFloat(_hud.spirit.parentElement, "+" + fmt(dS)); pulseChip(_hud.spirit.parentElement); }
  else if (dS < -thr && _hud.spirit) { spawnFloat(_hud.spirit.parentElement, fmt(dS), true); }
  _floatPrev.spirit = state.spirit;
  const dE = state.exp - _floatPrev.exp;
  if (dE > thr && _hud.btnBreak) spawnFloat(_hud.btnBreak, "+" + fmt(dE));   // v1.7.46: 进度条移除, 修为飘字改从突破按钮升起
  _floatPrev.exp = state.exp;
  refreshGlow(can);                       // v1.7.31: 可行动入口文字闪烁提醒(突破/聚灵阵/云游/丹房)
  /* v7.2: 境界牌显示总战斗力 = 四槽装备评分之和 */
  const pwEl = document.getElementById('realmPower');
  if (pwEl) {
    let pw = 0;
    for (const a of (state.arts || [])) pw += artScore(a);
    pwEl.textContent = fmt(pw);
  }
}

function refreshGlow(canBreak) {
  const gb = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("glow-gold", !!on); };
  const eb = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("glow-ember", !!on); };
  gb("#btnBreak", canBreak);                                    // 渡劫可突破
  gb("#btnArray", state.arrayLv < ARRAY_MAX_LV && state.spirit >= arrayCostNow());  // 聚灵阵可升级(32级圆满后不再提示)
  /* 文字同步提亮(双保险: 按钮光晕 + 内部文字亮度跳动) */
  const lg = (sel, on) => { const el = document.querySelector(sel); if (el) el.classList.toggle("hint-gold", !!on); };
  lg("#btnBreak .label", canBreak); lg("#btnArray .label", state.arrayLv < ARRAY_MAX_LV && state.spirit >= arrayCostNow());
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
  const journalSet = new Set(state.journal.map(j => j.big));
  const chapters = order.filter(b => journalSet.has(b));
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

async function cloudSettle() {
  if (!window.fetch || !cld.id || _settling) return null;
  __set_settling(true);
  try { return await _cloudSettleRun(); } finally { __set_settling(false); }
}

function openEquip() {
  const m = $("equipModal"); if (!m) return;
  renderEquip();
  m.classList.add("show");
}

function renderEquip() {                 // v1.9.8 十字格工作台: 四正方格上下左右 + 中央总战力, 点格显属性
  const box = $("equipBody"); if (!box) return;
  const eb = equipBonus();
  const arr = (state.arts || []).slice(-6);
  const SLOTN = EQUI_SLOTN, SLOTI = EQUI_SLOTI, CELLPOS = EQUI_CELLPOS;
  const sc = (a) => Math.round(artScore(a));   // v1.9.9b: 抽 licCardHTML 时误删的局部定义, total 战力依赖它(缺失会 ReferenceError 致法宝窗打不开)
  let cross = "";
  let total = 0;
  for (const { pos, i } of CELLPOS) {
    const a = arr[i];
    const slotI = SLOTI[(typeof (a && a.slot) === "number" && a.slot < 4) ? a.slot : i];
    if (!a) {
      cross += `<div class="gx-cell ${pos}" style="cursor:default" title="${SLOTN[i]} · 空位">
        <span class="ico" style="opacity:.32"><img class="icoim" src="assets/modals/art-ico/${slotI}0.webp" alt="" onerror="this.remove()"></span><em>${SLOTN[i]} · 空</em></div>`;
      continue;
    }
    const q = a.q;
    total += sc(a);
    cross += `<div class="gx-cell ${pos} qc${q}" title="${(QUALITY[q] || QUALITY[0]).name} · ${a.name}" onclick="event.stopPropagation();pickArt(${i})">
      <span class="ico"><img class="icoim" src="assets/modals/art-ico/${slotI}${q}.webp" alt="" onerror="this.remove()"></span><em>${SLOTN[i]}</em></div>`;
  }
  /* v1.9.8c 下方面板: 角色「道身」各项总属性(裸身+装备+词条合并后的面板值), 常显不随选中变化 */
  let detail;
  {
    const _bi = bigIndexOf(state.realmIdx);   /* v7.2b 纯函数推算 */
    const _bs = BASE_STATS[Math.min(BASE_STATS.length - 1, _bi)] || BASE_STATS[0];
    const hs = finalStats({ hp: _bs[1], atk: _bs[0], def: _bs[2] },
      { hp: eb.hp || 0, atk: eb.atk || 0, def: eb.def || 0 }, eb.agg);
    const ag = eb.agg || {};
    const rn = ["会心", "暴击", "爆伤", "破甲", "闪避", "吸血", "攻速"];
    const rk = ["crit", "critB", "critD", "pen", "dodge", "life", "aspd"];
    const _detRows =
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

function skillAddExpAll(n) { /* ⚠️ v6: 技能恒定无经验 —— 保留空函数只为兼容旧调用点不报错 */ }

/* ⚠️ v6 契约变更（战斗层 50-battle.js 直接消费）：
 *   · 技能【无等级】—— 删掉 max / lv / exp / addExp / addExpAll / total，因为恒定值没有成长轴。
 *   · val(id) 返回 SKILL_DEFS 里的常量对象，字段随 kind 而异：
 *       kind:"damage" → { chance, dmg[, pen|n|crit|threshold] }  —— 攻击时按概率触发
 *       kind:"buff"   → { cd, dur, dodge, hasted }               —— 按 CD 独立触发（不是攻击触发）
 *   · 技能不入存档：恒定值没有存的必要。 */
window.SkillAPI = { defs: SKILL_DEFS, val: skillVal };

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
  fireMilestone,
  mainMoment,
  makeArt,
  openEquip,
  openSkills,
  openStory,
  pickArt,
  pickQ,
  rateNow,
  realmMult,
  refreshGlow,
  renderEquip,
  renderStory,
  skillAddExpAll,
  tickAura,
  updateHUD,
};
