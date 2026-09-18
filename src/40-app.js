/**
 * 应用装配（云引导/开屏门禁/启动/主循环/顶层副作用语句）
 *
 * 拓扑层 L8~L14，31 个顶层声明。
 */
import { $, ARRAY_MAX_LV, BIGS, CACHE_VER, CLD_KEY, DIMSTAT, DROP_CFG, EVENTS, MAIL_CAP, MAIN_STORY, MATS, PET_BONUS, PET_COIN, PET_FORGE, PET_STILL, PLOT, QUALITY, RECIPES, SAVE_KEY, SLOT_TYPES, __set_breaking, __set_cauldron, __set_dropSaveT, __set_encNext, __set_equipId, __set_hiddenAt, __set_hudAcc, __set_selRecipe, __set_state, __set_stayLast, _dropSaveT, _dsp, _equipId, _equipQueue, _floatPrev, _hiddenAt, _hudAcc, _pred, _rate, _settling, _srvOffset, _stayLast, _syncAt, autoHuntOn, breaking, cld, cnNum, esc, fmt, hbOk, initFxDiag, selRecipe, state } from './00-pure.js';
import { CLD_API, TOTAL_SEGS, adopt, arrayCostNow, buffAtCap, buffHintOf, burstBoom, cldApi, cldFlash, cldId, cldUI, closeTravel, cloudSnap, cloudSoon, createFxLayer, dimRender, ensureScrollFx, fitsRecipe, g1Pack, g1Unpack, hbFail, hiddenUnlocked, journalHasKey, locById, mailDot, pickNoRepeat, pushBattleStats, pushBoost, pushBuff, pushMsg, renderAutoHunt, renderPName, renderPillHints, searchMs, seg, settleBlocked, spiritRate, srvNow, tickDsp, traceRefresh, travelBtnLbl, zoneOfLoc } from './10-base.js';
import { addJournal, adoptKeep, bigIdx, cldFail, keepArtQuiet, load, realm, renderMailBox, save, showTravelMail, smartEquip, updateArts, updateRealmUI } from './20-core.js';
import { checkMilestones, cldPush, cloudPushNow, cloudSettle, mainMoment, makeArt, openAlchemy, openStory, openTravel, pickLoc, rateNow, updateHUD } from './30-systems.js';

let __dimT = 0;   /* 黑屏挂机面板刷新计时器 */

function startHeartbeat() {
  setInterval(async () => {
    if (document.hidden) return;       // 后台不心跳(回前台会走强制刷新)
    const r = await cloudSettle();
    if (!r) { hbFail(); return; }
    hbOk();
    if (r.settled && r.gains && r.gains.mode === "away") presentSettle(r);
  }, 90000);
}

function cldAdoptCloud(s) {
  const c = adopt(s);
  if (!c) return false;
  __set_state(c);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { console.warn('[app] 本地存档写入失败:', e); }
  ensureScrollFx();             // v2.5: 云端旧档的功法可能没有攻速词条 → 补齐
  updateRealmUI(); updateHUD(); updateArts(); realmPlot();
  /* v1.5.0: 云端档可能没有 autoHunt / travel 字段(老档), 采纳后按钮与行迹要跟着重绘,
     否则会出现"state 已变、开关还停在旧态"的错看 */
  renderAutoHunt(); travelBtnLbl(); traceRefresh();
  renderPillHints();            // v1.9.8c.2: 采纳云端档后药力行(丹力正盛/洗髓)要跟着重绘, 否则重开不显示
  renderPName();                // v1.7.26: 云端档自带道号 → 界面同步
  pushBattleStats();            // 换档 → 战斗三围/技能等级随之更新
  return true;
}

async function cldPull(forceImport, silent) {        // v2.1 forceImport:以云为权威; silent=true时静默覆盖(启动时服务器权威模式用, 不弹"已导入"提示)
  if (!window.fetch) { cldUI("off"); return false; }
  cldUI("sync");
  try {
    const r = await cldApi("GET");
    if (r && r.data) r.data = await g1Unpack(r.data);
    if (r.found && r.data) {

      const cs = (r.ts || 0);               // 服务端存档时间(权威)
      const ls = (state._cloudTs || 0);
      if (forceImport || cs > ls) {
        /* 云端比本地同步点新(或用户主动导入) → 采用云端档(冲突安全方向: 云新优先, 防旧档覆盖新云)。
         * 不在此立刻推送/调 save() —— 它们会把 lastTs 刷成"现在", 吞掉随后的离线结算;
         * 改为直写本地保留云端 lastTs, 离线收益由启动门禁里的服务端结算统一处理 */
        let hadLocal = false;
        try { hadLocal = !!localStorage.getItem(SAVE_KEY); } catch (e) { console.warn('[app] 读取本地存档状态失败:', e); }
        const adopted = cldAdoptCloud(r.data);
        if (!adopted) { cldUI("off"); return false; }   // v2.3 FIX: 云端档采纳失败不得标记同步, 否则后续 cloudSettle 会用本地旧档覆盖服务器
        state._cloudTs = cs;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { console.warn('[app] 采纳云端档后写入本地失败:', e); }
        cld.ready = true; cld.lastOkTs = Date.now();
        if (forceImport && !silent) {
          cldFlash("已导入云端存档");
          pushMsg("main", `<span class="b">云存</span>已绑定玩家码并导入云端存档。`);
        } else if (adopted && hadLocal) {
          pushMsg("main", `<span class="b">云存</span>检测到云端进度更新，已采用云端存档（请勿同一玩家码多设备同时游玩）。`);
        }
        cldUI("on");
        return true;
      }
      if (cs < ls || cld.dirty) {       // 本地有未上传进度 → 上传
        if (!forceImport) await cldPush();
        cld.dirty = false;
        return true;
      }
      // 已同步一致
      cld.ready = true; cld.lastOkTs = Date.now(); cld.lastOkLocal = state.lastTs;
      cldUI("on");
      return true;
    }
    // 云端还没有此玩家码 → 建档上传
    await cldPush();
    cld.dirty = false;
    return true;
  } catch (e) { cldFail(e); return false; }
}

function cloudPullNow() { cldPull(); }

function cloudFlush() {                       // v1.5.1: 关键节点/关页/切后台 → 强制立即推(不可逆操作不丢)
  /* ⚠️ v8.4: "新建存档"正在 reload 时必须跳过上云 —— 与 save() 同一个理由:
   * pagehide 会先 save() 再 cloudFlush(), 若不拦, 旧档会以【新玩家码】的名义
   * 被推上云端, 变成新档的初始内容(旧进度遗传给新档, 不可逆)。 */
  if (typeof window !== "undefined" && window.__reloading) return;
  if (!cld.ready) { cld.dirty = true; return; }
  cloudPushNow();
}

function cloudBind() {
  let v = (($("cloudInput") || {}).value || "").trim().toLowerCase();
  if (v.indexOf("dt-") === 0) v = v.slice(3);
  if (!/^[a-hjkmnpqrstuvwxyz2-9]{12}$/.test(v)) { cldFlash("请输入 12 位玩家码（道号不可寻档）"); return; }
  v = "dt-" + v;
  try { localStorage.setItem(CLD_KEY, v); } catch (e) { console.warn('[app] 保存玩家码到本地失败:', e); }
  cld.id = v; cld.ready = false; cld.dirty = false;
  const idEl = $("cloudId"); if (idEl) idEl.textContent = v;
  cldPull(true);                     // v1.7.29: 主动绑定=导入, 以云端为权威(防止新设备本地新档覆盖云端存档)
}

function cloudInit() {
  cldId();
  const chip = $("cloudChip");
  document.addEventListener("click", e => {
    const p = $("cloudPanel");
    if (p && p.classList.contains("show") && chip &&
        !e.target.closest("#cloudPanel") && !e.target.closest("#cloudChip")) p.classList.remove("show");
  });
  cldUI("sync");
  addEventListener("online", () => {                                  // 断网恢复后自动补同步
    if (!cld.ready) cldPull(); else cloudSettle();
  });
  /* v1.8.0: 启动结算已交给门禁(bootCloud), 周期同步已交给心跳(见 startHeartbeat)。
     这里只保留面板交互与"断网恢复"。 */
}

async function bootCloud() {
  const pulled = await cldPull(true, true);   // v2.1 服务器权威模式: 启动时强制以云端存档为准覆盖本地, 静默不弹"已导入"提示
  if (!pulled) return false;                  // v2.3 FIX: 拉云端失败(网络/采纳失败)直接门禁不通过, 绝不能带着本地旧档去 cloudSettle —— 那会用旧档覆盖服务器
  let sr = null;
  try { sr = await cloudSettle(); } catch (e) { console.warn('[app] bootCloud 结算异常:', e); sr = null; }
  if (!sr) return false;                       // 门禁不通过
  if (sr.settled && sr.gains && sr.gains.mode === "away") presentSettle(sr);
  cloudFlush();                                // 启动结算后尽快把建档/离线收益上云
  updateRealmUI(); updateHUD(); updateArts(); realmPlot();
  return true;
}

function doBreak() {
  if (breaking || settleBlocked()) return;
  const r = realm();
  if (state.exp < r.need || state.realmIdx >= TOTAL_SEGS - 1) return;
  __set_breaking(true);
  const next = seg(state.realmIdx + 1);
  const isBigBreak = r.isBigEnd;   // 大境界突破(跨大境) → 天劫; 小境界 → 简版金光

  const finishBreak = () => {
    state.realmIdx++;
    state.exp = isBigBreak ? 0 : Math.max(0, state.exp - r.need);  // 大境清零, 小境扣需
    /* v7.2 跨大境重校: 兽潮离线加成与大境界绑定 —— 怪池换了, 效率必须
     * 重新校对, 否则低境刷满 121 的 180% 常驻档案吃到天荒地老。trialBest 保留作
     * 全程炫耀纪录, 小境界突破(同池)不清。
     * v5.6: 加成已迁入 buffs 表(tag:"trial") → 按条目清除。 */
    if (isBigBreak) {
      state.trialBoost = 0; state.trialBoostUntil = 0;   /* 兼容旧字段 */
      state.buffs = (state.buffs || []).filter(b => b.tag !== "trial");
    }
    __set_breaking(false);
    /* 黑屏挂机: 记录突破 */
    if (DIMSTAT.on) { DIMSTAT.breaks.push(next.label); try { dimRender(); } catch(e) {} }
    updateRealmUI(); updateHUD(); save(); pushBattleStats();   // 境界变了 → 战斗三围与怪物成长线重算
    cloudFlush();
    const nr = realm();
    if (isBigBreak) {
      const GREET_BY_BIG = { 1: "洗髓易骨，踏入炼气！", 2: "踏入筑基！", 3: "金丹凝形！", 4: "元婴出窍！",
        5: "化神之姿！", 6: "虚室生白，炼神返虚！", 7: "法相天地，合道归真！", 8: "返璞归真，大乘无上！",
        9: "度劫化凡，一步登仙！", 10: "羽化登仙，仙界之门！", 11: "位列仙班，天仙永寿！" };
      const greet = GREET_BY_BIG[nr.bigIdx] || "";
      pushMsg("main", `<span class="g">${nr.big}</span>！${greet || "修行又进一步"}`);
    } else {
      pushMsg("main", `修为精进 → <span class="g">${nr.big === "炼气" ? "炼气" + cnNum(nr.segNo) + "层" : nr.label}</span>`);
    }
    realmPlot();
  };

  // 通用破境特效: 金光闪 + 境界名弹字 + 粒子爆发
  const boomFx = () => {
    const fl = $("flash"); fl.style.transition = "none"; fl.style.opacity = .95;
    requestAnimationFrame(() => { fl.style.transition = "opacity 1.8s ease-out"; fl.style.opacity = 0; });
    const up = $("realmUp");
    $("realmUpT").textContent = isBigBreak ? next.big : next.label;
    $("realmUpT").style.fontSize = (isBigBreak ? next.big.length > 2 : next.label.length > 4) ? "26px" : "38px";
    up.classList.remove("show"); void up.offsetWidth; up.classList.add("show");
    burstBoom();
  };

  if (isBigBreak) {
    /* 大境界: 天劫蓄力1s → 破境特效 → 0.95s后落地 */
    pushMsg("main", `<span class="r">天劫将至……</span>${r.label} 将渡 ${next.label}`);
    const trib = $("trib"); if (trib) { trib.classList.remove("show"); void trib.offsetWidth; trib.classList.add("show"); }
    const cult = $("cult"); if (cult) { cult.classList.remove("trib-glow"); void cult.offsetWidth; cult.classList.add("trib-glow"); }
    setTimeout(() => {
      if (trib) trib.classList.remove("show");
      if (cult) cult.classList.remove("trib-glow");
      boomFx();
      pushMsg("main", `<span class="r">天劫降临！</span>${r.label} → <span class="r">${next.label}</span>`);
      setTimeout(finishBreak, 950);
    }, 1000);
  } else {
    /* 小境界: 直接破境特效 → 0.6s后落地 */
    boomFx();
    pushMsg("main", `突破！${r.label} → <span class="g">${next.label}</span>`);
    setTimeout(finishBreak, 600);
  }
}

function manualBreak() { doBreak(); }

function tapArray() {
  if (settleBlocked()) return;
  if (state.arrayLv >= ARRAY_MAX_LV) {
    pushMsg("main", `聚灵阵已至圆满 Lv.${state.arrayLv}，周天流转自足，灵石另作他用`);
    return;
  }
  const cost = arrayCostNow();
  if (state.spirit >= cost) {
    state.spirit -= cost; state.arrayLv++; save(); updateHUD(); cloudFlush();  // v1.5.1: 花灵石升阵 → 立即上云
    pushMsg("main", `聚灵阵升至 <span class="g">Lv.${state.arrayLv}</span>（下一级需灵石 ${fmt(arrayCostNow())}）`);
  } else {
    pushMsg("main", `灵石不足(升至 Lv.${state.arrayLv + 1} 需 ${fmt(cost)})，阿青见你叹气，尾巴一竖，满山替你找矿去了`);
  }
}

function realmPlot() {
  const bi = bigIdx();
  const vol = PLOT[bi];
  if (!vol || !vol.length) return;
  const start = BIGS.slice(0, bi).reduce((s, x) => s + x.segs, 0);   // 该大境起始全局小段 idx
  const segCount = BIGS[bi].segs;
  const r = realm();
  const pos = Math.min(segCount, (state.realmIdx - start) + Math.min(1, state.exp / r.need));
  let fired = 0, last = null;
  for (let i = 0; i < vol.length; i++) {
    const b = vol[i];
    if (journalHasKey(b)) continue;
    if (pos >= segCount * i / vol.length) {
      addJournal({ key: b.key, big: b.big || realm().big, kind: b.kind || "际遇", title: b.title, text: b.text });
      fired++;
      if (fired === 1) {
        last = b;
        pushMsg("main", `<span class="b">${b.big || realm().big} · ${b.title}</span>｜${b.text}`);
      }
    }
  }
  if (fired > 1) pushMsg("main", `<span class="b">仙途拾遗</span>｜修行之间你又经历了 ${fired} 段际遇，均已记入修行录。`);
  if (fired > 0) cloudFlush();   // v1.5.1: 主线剧情入修行录 → 关键节点立即上云
  void last;
}

function adventure() {
  const roll = Math.random();
  const bi = Math.min(bigIdx(), EVENTS.length - 1);
  const petTag = `<span class="pet">阿青</span>`;
  const artChance = 0.05 + bi * 0.005;
  if (roll < artChance) {
    const a = makeArt();
    const r = QUALITY[a.q];
    pushMsg("avatar", `${petTag}${pickNoRepeat(PET_FORGE, "petF")}，一件<span class="r">${a.name}</span>(<span class="${r.cls}">${r.name}</span>)出炉`);
    smartEquip(a);
  } else {
    pushMsg("avatar", `${petTag}${pickNoRepeat(PET_STILL, "petS")}`);
  }
  state.spirit += spiritRate();
  updateHUD();
}

function loop(dt) {
  if (!breaking) {
    /* v1.8.0: 本地这一笔是「预测」—— 只为了让数字看着在涨。计入 _pred, 上传时会被扣掉,
       真正的账由服务端按自己的钟结算。 */
    const _g = rateNow() * dt;
    state.exp += _g; _pred.exp += _g;
    if (DIMSTAT.on) DIMSTAT.exp += _g;   /* 黑屏挂机: 累加修为 */
    /* v2.5: 所有境界突破均改为手动 —— 移除自动小境界升级循环, 修为满后玩家点"突破"按钮 */
    /* v2.6 PERF: realmPlot 每帧 → 并入下方 100ms HUD 节流(幂等, 触发时机无感差异) */
  }
  /* 黑屏挂机: 跳过tickDsp/HUD/realmPlot等DOM更新(面板盖住了看不到), 只跑dimRender */
  if (DIMSTAT.on) {
    __dimT = (__dimT || 0) + dt; if (__dimT >= 0.5) { __dimT = 0; try { dimRender(); } catch(e) {} }
    return;
  }
  tickDsp(dt);
  /* v3.2: 灵气层与爆发粒子层已并入统一舞台 #stage，由 60-stage 的 ticker 驱动。
   * 原先是 `if (!DIMSTAT.on) tickAura(dt)` / `tickBurst(dt)` 两处 —— 它们各自
   * 有一份 30fps 限帧逻辑，和主循环/背景/战斗的限帧相位不齐，白白多跑。
   * 下面这个 loop 现在只管【游戏逻辑】（修为结算 / HUD 节流），不再碰渲染。 */
  __set_hudAcc(_hudAcc + (dt)); if (_hudAcc >= 0.1) { __set_hudAcc(0); updateHUD(); realmPlot(); checkMilestones(); if (Math.random() < 0.035) adventure(); if (Math.random() < 0.006) mainMoment(); }   // PERF-1: HUD ~10FPS; PERF-3: adventure/mainMoment 从每帧 60 次随机检查降到 10fps(概率等价换算: 0.35*0.1 / 0.06*0.1)
}

async function bootGate() {
  const wait = [0, 1000, 2000, 4000, 8000];
  for (let i = 0; i < wait.length; i++) {
    if (wait[i]) await new Promise(s => setTimeout(s, wait[i]));
    splashStat(i ? `正在重连服务器…（第 ${i} 次）` : "正在连接服务器…");
    let ok = false;
    try { ok = await bootCloud(); } catch (e) { console.warn('[app] bootGate 第' + i + '次引导异常:', e); ok = false; }
    if (ok) return true;
  }
  return false;
}

function startGame() {
  updateRealmUI();
  renderPName();                // v1.7.26 道号显示(默认 6 位数字)
  _dsp.spirit = state.spirit; _dsp.exp = state.exp;
  _floatPrev.spirit = state.spirit; _floatPrev.exp = state.exp;
  updateHUD();
  updateArts();
  bindBattleHooks();        // 战斗系统: 挂上掉落回流 + 首次注入玩家三围
  realmPlot(); // 按当前境界推进已及剧情
  {
    const o0 = PLOT[0] && PLOT[0][0];
    if (o0 && state.journal.length && !journalHasKey(o0) && bigIdx() > 0) {
      addJournal({ key: o0.key, big: o0.big, kind: o0.kind, title: o0.title, text: o0.text }); // 老档补记起点
    }
  }
  setInterval(() => { if (!document.hidden) save(); }, 30000);   // v2.3 PERF: 自动存档 8s→30s(pagehide/visibilitychange 已保证退出即存, 挂机期 30s 足够防崩溃丢档); 后台跳过
  /* v2.5: 关页/切后台的 cloudFlush 走异步 fetch, App 被杀瞬间请求常被掐断 → 进度白丢。
   * 改为会话内周期性兜底: 有脏数据且页面可见时每 20s 上云一次, 关闭时最多只差 20s,
   * 不再"白玩几分钟"。localStorage 同步写照旧保底(进程崩也不丢)。 */
  setInterval(() => {
    if (document.hidden || !cld.ready || !cld.dirty) return;
    cloudPushNow();
  }, 20000);
  /* v1.9.9d 法宝图标空闲预热解码(4 部位×6 品质 24 张 webp):
     安卓 WebView 首开法宝窗才现解码 4 张图, 与弹窗全卡首光栅化同帧挤爆 → 开窗卡死/掉帧闪屏;
     启动低谷期逐张 decode() 预热, 开窗只剩合成 */
  setTimeout(() => {
    ["w", "a", "p", "s"].forEach(si => { for (let q = 0; q < 6; q++) {
      const im = new Image();
      im.src = "assets/modals/art-ico/" + si + q + ".webp";
      try { im.decode && im.decode().catch(() => {}); } catch (e) { console.warn('[app] 法宝图标预热解码失败:', e); }
    } });
  }, 4000);
  addEventListener("pagehide", () => { save(); cloudFlush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      __set_hiddenAt(srvNow());
      save(); cloudFlush();     // 记下"我在场", 并同步一次
    } else if (_hiddenAt && srvNow() - _hiddenAt > 30000) {
      /* v1.8.0 切后台超 30 秒 → 一律当离线, 回前台强制刷新。
       * 刷新后重走门禁, 服务端按 [上次写入时刻, now] 结算离线收益并弹面板。
       * 好处: 客户端不需要维护任何"欠账 / 区间 / 基准"状态, 整条链路只剩一条线。 */
      location.reload();
    } else {
      cloudSettle();            // 短时切走: 补一次结算即可(服务端按 ≤180s 判为在线, 满速率)
    }
  });
  cloudInit();                  // 云存档面板交互 + 断网恢复
  startHeartbeat();             // v1.8.0 周期心跳(90s)
  setInterval(() => { if (document.hidden) return; stayMailCheck(); }, 60000);   // 在线寄包: iOS 常驻标签页也能收到化身手札; 后台跳过
  initFxDiag();
  /* v3.2: 装配统一舞台 —— 原先这里是 initAura() + initBg() + initFxLayer() 三次调用,
   * 各自启一张全屏 canvas + 一个 rAF。现在合成为 1 张 #stage / 1 个 ticker。
   * 战斗层稍后挂入（BattleAPI 由动态 import 加载，需要轮询等待）。 */
  mountStage();
  let lastLoop = performance.now();
  /* v2.6 PERF: 30fps 限帧 —— 主循环原为无上限 rAF(120Hz手机全速空转, 耗电主因之一);
   * UI 均为缓动动画, 30fps 观感无损, 帧率减半即功耗减半。 */
  let _lastPaint = 0;
  let _sleepT = 0;            /* v2.9: 限帧 sleep 句柄(便于外部/异常时清理, 防双链跑帧) */
  (function main() {
    const now = performance.now();
    /* v4.2 PERF: 后台降频 —— 页面不可见时 main 循环从 30fps 降到 1fps,
     * 只跑修为结算(挂机收益不能停), 跳过 tickDsp/HUD 更新(后台不可见),
     * 回前台自动恢复 30fps。此前后台 30fps 空转是耗电主因(CPU 后台占 91%)。 */
    if (document.hidden) {
      const dt = Math.min(1, (now - lastLoop) / 1000); lastLoop = now;
      if (!breaking) { const _g = rateNow() * dt; state.exp += _g; _pred.exp += _g; }
      _sleepT = setTimeout(() => { _sleepT = 0; main(); }, 1000);
      return;
    }
    const wait = 33 - (now - _lastPaint);
    if (wait > 4) {
      /* v2.9 PERF: 限帧期间用 setTimeout 让出主线程(原先无条件续 rAF 会按屏幕刷新率空转)。
       * 阈值 >4ms 才睡: 余量过小会导致 setTimeout 立即返回, 退化成紧凑循环(实测 5000 次/秒)。 */
      _sleepT = setTimeout(() => { _sleepT = 0; requestAnimationFrame(main); }, wait);
      return;
    }
    requestAnimationFrame(main);
    _lastPaint = now;
    const dt = Math.min(.1, (now - lastLoop) / 1000); lastLoop = now;
    loop(dt);
  })();
}

async function boot() {
  load();                      // v1.10.0: 先读本地档(明文 JSON 同步), 再走云端门禁
  _equipQueue.length = 0;      // 清空跨会话残留的未拾取装备掉落队列
  let passed = false;
  try { passed = await bootGate(); } catch (e) { console.warn('[app] boot 门禁异常:', e); passed = false; }
  if (!passed) { splashFail(); return; }   // 连不通 → 停在失败页, 不进入游戏
  await splashFinish();                    // v1.9.1: 开屏彻底退场后才初始化主页(resolve 与 startGame 同一微任务链, 中间不会被渲染)
  startGame();
}

setTimeout(boot, 0);

window.__game = {
  get state() { return state; },
  /* v1.8.0 调试句柄 */
  get srvOffset() { return _srvOffset; },
  get rate() { return _rate; },
  get pred() { return _pred; },
  get syncAt() { return _syncAt; },
  srvNow: () => srvNow(),
  settle: () => cloudSettle(),
  hbFail: () => hbFail(),
  hbOk: () => hbOk(),
  setRealm: i => { state.realmIdx = i; state.exp = 0; updateRealmUI(); updateHUD(); },
  giveExp: n => { state.exp += n; updateHUD(); },
  giveSpirit: n => { state.spirit += n; updateHUD(); },
  adventure: () => adventure(),
  mainMoment: () => mainMoment(),
  makeArt: () => makeArt(),
  updateArts: h => updateArts(h),
  realmPlot: () => realmPlot(),
  openStory, pushMsg, save, load,
};

function doCraft() { if (selRecipe && fitsRecipe()) craftPill(selRecipe); }

function refreshOpenPanel() {
  const am = $("alchemyModal"), tm = $("travelModal");
  if (am && am.classList.contains("show")) openAlchemy();
  else if (tm && tm.classList.contains("show")) openTravel();
}

function startTravel() {
  if (state.travel) { pushMsg("main", "化身尚在云游，去行迹条看看它走到哪了"); closeTravel(); return; }
  const { l } = pickLoc();
  /* v1.9.0: 派发时记录 sent=0(已发封数游标) —— 服务端据此补齐信匣, 天然幂等 */
  state.travel = { loc: l.id, since: Date.now(), sent: 0 };
  __set_encNext(autoHuntOn() ? Date.now() + searchMs() : 0);   // 重置巡猎: 自动斗法开则重新起算搜寻
  pushMsg("main", `你为化身备好行囊。它往<span class="r">${l.n}</span>的方向去了，阿青蹲在门口目送，尾巴搭在你脚边。`);
  pushMsg("avatar", `阿青送化身到山门口，回来在你蒲团边卧下`);
  pushMsg("main", `<span class="b">化身在外每满 30 分钟寄回一封手札</span>，满八封（四个小时）便自行回山。<br>记得常去右上角鸿雁处拆信——信里的东西，隔着匣子不算你的。`);
  travelBtnLbl(); traceRefresh(); updateHUD(); save(); cloudSoon();
  closeTravel();
}

function consumePill(id) {
  const rp = RECIPES[id]; if (!rp) return;
  if (!state.pills || !state.pills[id]) return;
  const now = Date.now(); const e = rp.eff;
  /* v1.9.0: 增益类丹药到顶(累计 24 小时)就不再允许服用 —— 提示而非静默失败 */
  if ((e.k === "buff" || e.k === "grand") && buffAtCap(e.mult)) {
    pushMsg("main", `<span class="b">药力已至上限</span>：此丹药力已积满 <b>24 小时</b>，再服无益，且待药力散去。`);
    renderPillHints();
    return;
  }
  state.pills[id]--;
  if (state.pills[id] <= 0) delete state.pills[id];
  /* v1.8.4: buff 记 start ✅ —— 服务端按"有效时段"计 */
  /* v5.5: 丹药 buff 记丹名(name) —— 服务端验算后随 gains.pill.names 回传, 结算面板按名展示 */
  if (e.k === "buff") { pushBuff(e.mult, e.dur, rp.n); pushMsg("main", `药力化开，周天运转如飞${buffHintOf(e.mult)}`); }
  else if (e.k === "inst") { const gg = rateNow() * e.sec; state.exp += gg; pushMsg("main", `药力化开，修为<span class="g">+${fmt(gg)}</span>`); }
  else if (e.k === "grand") { const gg = rateNow() * e.sec; state.exp += gg; pushBuff(e.mult, e.dur, rp.n); pushMsg("main", `感悟天劫真意，修为<span class="g">+${fmt(gg)}</span>，道韵萦绕${buffHintOf(e.mult)}`); }
  /* v5.6: 离线加成走通用 Buff 协议(pushBoost) —— 兽潮余威/丹药离线加成同一张表, 后端零知识验算 */
  else if (e.k === "offline") {
    pushBoost(e.boost || 0, e.dur || 0, rp.n, "pill");
    pushMsg("main", `洗髓伐脉，此后游历修炼更有所得（+${Math.round((e.boost || 0) * 100)}%·庇佑 ${Math.max(1, Math.round(e.dur / 3600))} 小时）`);
  }
  updateHUD(); save(); cloudSoon(); refreshOpenPanel(); renderPillHints();
}

function craftPill(id) {
  if (settleBlocked()) return;
  const rp = RECIPES[id]; if (!rp) return;
  if (rp.h && !hiddenUnlocked(rp.big)) { pushMsg("main", "丹方残页未集齐，此丹方还锁在雾里"); return; }
  for (const mid in rp.need) {
    if (((state.mats || {})[mid] || 0) < rp.need[mid]) {
      pushMsg("main", "材料不齐，丹炉难以为继"); return;
    }
  }
  for (const mid in rp.need) state.mats[mid] -= rp.need[mid];
  state.pills[id] = (state.pills[id] || 0) + 1;
  pushMsg("main", `丹炉开火，一炉<span class="r">${rp.n}</span>成了，药香满室。`);
  pushMsg("avatar", `阿青闻到药香，在丹炉边蹲成一团，尾巴尖轻轻晃`);
  /* v1.9.8 工程化工作台: 成丹即清炉, 重开工作台 */
  __set_selRecipe(null); __set_cauldron({});
  save(); cloudSoon(); updateHUD(); refreshOpenPanel();
}

async function stayMailCheck() {
  if (!window.fetch || !cld.id || !cld.ready) return;
  if (!state.travel || !state.travel.loc) return;          // 化身不在外无需寄信
  if (_settling) return;                                   // settle 往返中, 下轮心跳再问
  /* v1.9.0: 寄信周期 30 分钟, 故心跳每 2 分钟问一次足矣(周期远大于轮询间隔)。
   * 服务端 stayTravel 是幂等的 —— 多问几次不会多发信, 只保证"到点即寄"。 */
  const now0 = Date.now();
  if (now0 - _stayLast < 120000) return;
  __set_stayLast(now0);
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(CLD_API + "?id=" + encodeURIComponent(cld.id) + "&stay=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ __z: await g1Pack(cloudSnap(state)) }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.ok && j.data) {
      const c0 = await g1Unpack(j.data);
      if (c0 && adoptKeep(c0)) { updateHUD(); mailDot(); }
      if (j.stay && j.stay.id && ((j.stay.mats && j.stay.mats.length) || j.stay.page)) {
        showTravelMail(j.stay);
        updateRealmUI();
      }
    }
  } catch (e) { clearTimeout(tm); console.warn('[app] stayMailCheck 寄信请求失败:', e); }
}

function presentSettle(r) {
  const gg = (r && r.gains) || {};
  if (!gg || !gg.settled) return;
  const dt = gg.dt || 0;
  const hh = Math.floor(dt / 3600), mm = Math.floor((dt % 3600) / 60);
  /* v1.9.5: 面板结构化 —— 收益行(修为/灵石/巡猎) + 「机缘已收」朱印(CSS), 告别内联 style 拼串。
   * 云游产出仍全在【鸿雁信匣】(v1.9.0 约定), 此处只字提示。 */
  const icoExp = '<span style="color:#d8b06a;font-size:12px">◎</span>';   /* v5.14: SVG→字符(丹环) */
  const icoSpi = '<span style="color:#67c9ab;font-size:11px">◆</span>';   /* v5.14: SVG→字符(灵石) */
  const icoHunt = '<span style="color:#c9a86a;font-size:11px">✦</span>';   /* v5.14: SVG→字符(巡猎) */
  /* 离线装备: 阿青择优佩戴N件, 多余熔灵石 —— v5.8 全览一行: 掉落总数/佩戴/熔炼+灵石 */
  const Eq = gg.equip;
  let huntExtra = "";
  const totalSpirit = gg.spirit || 0;
  let equipRow = "";
  if (Eq && ((Eq.total || 0) > 0 || (Eq.kept || 0) > 0)) {
    const tot = (Eq.total != null) ? Eq.total : ((Eq.kept || 0) + (Eq.melted || 0));
    const wearTxt = (Eq.kept || 0) > 0 ? `阿青佩戴 ${Eq.kept} 件` : "无可入眼";
    const meltTxt = (Eq.melted || 0) > 0 ? `·熔炼 ${Eq.melted} 件 +${fmt(Eq.meltSp || 0)} 灵石` : "";
    equipRow = `<div class="off-row"><span class="o-ico">${icoHunt}</span><span class="ol">化身代狩·共掉 ${tot} 件</span><b class="ov" style="color:#e0b45a">${wearTxt}${meltTxt}</b></div>`;
  }
  /* v5.6 通用 Buff 协议回传: gains.fx = 参与本次结算的加成条目(已由服务端按区间加权验算),
   * 前端结构化循环渲染 —— 以后新增任何丹方/加成源, 面板零改动。 */
  let trialRow = "";
  const T = gg.trial;
  if (T && T.waves > 0) trialRow = `<div class="off-row"><span class="o-ico">${icoHunt}</span><span class="ol">兽潮·化身代守</span><b class="ov">${T.waves} 波 · 斩妖 ${fmt(T.kills)}</b></div>`;
  for (const f of (gg.fx || [])) {
    const nm = f.name ? "·" + esc(f.name) : "";
    if (f.mult > 1) {
      trialRow += `<div class="off-row"><span class="o-ico">${icoExp}</span><span class="ol">${f.tag === "trial" ? "兽潮加成" : "丹药加持" + nm}</span><b class="ov">×${Number(f.mult).toFixed(2)}</b></div>`;
    } else if (f.boost > 0) {
      /* v5.7: boost 在线也生效 → 结算区间可能是几分钟(心跳段), 庇佑时长智能显示 时/分 */
      const cvr = Math.max(1, Math.round((f.covered || 0) / 60000));
      const cvrTxt = cvr >= 60 ? `庇佑 ${Math.round(cvr / 60)} 时` : `庇佑 ${cvr} 分`;
      if (f.tag === "trial") trialRow += `<div class="off-row"><span class="o-ico">${icoExp}</span><span class="ol">兽潮加成${nm}</span><b class="ov" style="color:#e0b45a">×${(1 + f.boost).toFixed(2)}·${cvrTxt}</b></div>`;
      else trialRow += `<div class="off-row"><span class="o-ico">${icoSpi}</span><span class="ol">丹力加成${nm}</span><b class="ov jade">+${Math.round(f.boost * 100)}%·${cvrTxt}</b></div>`;
    }
  }
  /* v1.9.8: 连破境 → 横幅右上朱印; 闭关时长 → 横幅标题带(各一行小字) */
  const sealEl = $("offSeal");
  if (sealEl) {
    if (gg.jumps && gg.jumps > 0) { sealEl.style.display = ""; sealEl.textContent = `连破 ${gg.jumps} 境`; }
    else sealEl.style.display = "none";
  }
  const offTEl = $("offTitle");
  if (offTEl) offTEl.innerHTML =
    `闭关 ${hh ? hh + " 时" + (mm ? " " : "") : ""}${mm ? mm + " 分" : (hh ? "" : "片刻")}<i>化身替你行走的账，都回来了</i>`;
  /* v1.9.0: 信匣满则化身停笔, 只提一句(细节在云游面板) */
  const bagTip = (state.travel && state.travel.loc && (state.mails || []).length >= MAIL_CAP)
    ? `<div class="off-hunt" style="color:#a98a5a">鸿雁信匣已满 ${MAIL_CAP} 封，化身暂时停笔 —— 拆几封它便续上。</div>` : "";
  $("offlineText").innerHTML =
    `<div class="off-rows">` +
    `<div class="off-row"><span class="o-ico">${icoExp}</span><span class="ol">周天运转 · 修为</span><b class="ov">+${fmt(gg.exp)}</b></div>` +
    `<div class="off-row"><span class="o-ico">${icoSpi}</span><span class="ol">聚灵阵 · 灵石</span><b class="ov jade">+${fmt(totalSpirit)}</b></div>` +
    trialRow + equipRow +
    `</div>` + huntExtra + bagTip;
  // 离线际遇叙事(每满 1 小时一段, 至多 3 段; 纯叙事)
  const bi = Math.min(bigIdx(), MAIN_STORY.length - 1);
  const bigName = realm().big;
  const cnt = Math.min(3, Math.max(1, Math.floor(dt / 3600)));
  const lines = [];
  for (let i = 0; i < cnt; i++) {
    const line = pickNoRepeat(MAIN_STORY[bi], "off" + bi);
    lines.push(line);
    addJournal({ key: "off-" + Date.now() + "-" + i, big: bigName, kind: "游历", title: "洞天游历", text: line });
  }
  const taleEl = $("offlineTale");
  if (taleEl && lines.length) {
    taleEl.style.display = "block";
    taleEl.innerHTML = `<b>离线际遇</b>${lines.map(x => `<br>· ${x}`).join("")}`;
  }
  $("offlineModal").classList.add("show");
  updateRealmUI(); updateHUD();
}

async function mailClaim(idOrAll) {
  if (settleBlocked()) return;
  if (!window.fetch || !cld.id || !cld.ready) { cloudSoon(); return; }
  try {
    const r = await fetch(CLD_API + "?id=" + encodeURIComponent(cld.id) + "&claim=" + encodeURIComponent(idOrAll), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ __z: await g1Pack(cloudSnap(state)) }),
    });
    const j = r.ok ? await r.json() : null;
    if (j && j.ok && j.data) {
      const c0 = await g1Unpack(j.data);
      if (c0 && adoptKeep(c0)) { mailDot(); updateHUD(); }
    } else { cloudSoon(); }
  } catch (e) { cloudSoon(); }
}

function collectAllMail() {
  if (settleBlocked()) return;
  const ml = state.mails || [];
  if (!ml.length) return;
  const total = {};
  let pages = 0, n = 0;
  for (const m of ml) {
    for (const mk of (m.mats || [])) {
      if (!MATS[mk.id]) continue;
      state.mats[mk.id] = (state.mats[mk.id] || 0) + mk.q;
      total[mk.id] = (total[mk.id] || 0) + mk.q;
    }
    if (m.page) {
      const z = zoneOfLoc(m.loc);
      if (z) { state.pages["b" + z.big] = (state.pages["b" + z.big] || 0) + 1; pages++; }
    }
    n++;
  }
  state.mails = [];
  const gotTxt = Object.keys(total).map(id => MATS[id].n + "×" + total[id]).join("、");
  pushMsg("main", `你一并拆开 <b>${n}</b> 封雁书，收下 <span class="r">${gotTxt || "数纸见闻"}</span>`
    + (pages ? `，另得 <b>丹方残页×${pages}</b>` : "") + "。");
  pushMsg("avatar", `展信收取 · 共 ${n} 封`);
  renderMailBox(); mailDot(); updateHUD();
  save(); mailClaim("all");            // v1.8.4: 告知服务端清空信匣, 防重复收取
}

function collectMail(id) {
  const ml = state.mails || [];
  const i = ml.findIndex(x => String(x.id) === String(id));
  if (i < 0) return;
  const m = ml[i];
  const got = [];
  for (const mk of (m.mats || [])) {
    if (!MATS[mk.id]) continue;
    state.mats[mk.id] = (state.mats[mk.id] || 0) + mk.q;
    got.push(MATS[mk.id].n + "×" + mk.q);
  }
  if (m.page) {
    const z = zoneOfLoc(m.loc);
    if (z) { state.pages["b" + z.big] = (state.pages["b" + z.big] || 0) + 1; got.push("丹方残页×1"); }
  }
  ml.splice(i, 1);
  const loc = locById(m.loc);
  const where = loc ? loc.n : "远方";
  const gotTxt = got.length ? '收下 <span class="r">' + got.join("、") + "</span>" : "只余一纸见闻";
  pushMsg("main", "你拆开" + where + "的来信，" + gotTxt + "。");
  pushMsg("avatar", "展信收取 · 化身自" + where + "寄回");
  renderMailBox(); mailDot(); updateHUD();
  save(); mailClaim(m.id);             // v1.8.4: 告知服务端删掉这封, 防重复收取
}

function onBattleDrop(info) {
  if (!state || !info) return;
  /* v2.5 掉落分阶段: 此处只管灵石入账(飞行到顶部统计区时由战斗侧回调);
     装备掉落改由 requestEquipDrop/applyEquipDrop 驱动——宠物拾起时才入包/熔炼 */
  if (info.spirit > 0) { state.spirit += info.spirit; updateHUD(); }
}

function requestEquipDrop(info) {
  if (!state || !info) return null;
  /* v2.5 BOSS(info.boss)必掉一件; 普通怪/精英按概率 roll。品质一律照常 pickQ——
   * BOSS 刷新频繁(bossSpawnEvery=10), 品质保底会让金装泛滥 */
  if (!info.boss && Math.random() >= DROP_CFG.equipChance * (info.elite ? DROP_CFG.eliteEquipMul : 1)) return null;
  const a = makeArt();
  const id = __set_equipId(_equipId + 1);
  _equipQueue.push({ id, a, elite: !!info.elite });
  const tp = SLOT_TYPES[a.slot];
  return { id, slot: a.slot, q: a.q, name: a.name, icon: 'assets/modals/art-ico/' + tp.k + a.q + '.webp' };
}

function applyEquipDrop(id) {
  if (!state) return { kept:false, spirit:0, name:'', q:0 };
  const i = _equipQueue.findIndex(e => e.id === id);
  if (i < 0) return { kept:false, spirit:0, name:'', q:0 };  // 幂等
  const { a, elite } = _equipQueue.splice(i, 1)[0];
  /* v6.16 FIX: 不自己算灵石——keepArtQuiet内部直接改state.spirit, 口径以它为准。
   * 用 spiritBefore/after diff 拿到实际熔了多少灵石, 避免两套口径对不上。 */
  const spiritBefore = state.spirit;
  const kept = keepArtQuiet(a);
  const spiritGain = state.spirit - spiritBefore;
  if (kept && a.q > (state.bestArtQ || -1)) state.bestArtQ = a.q;
  if (elite || a.q >= 3) {
    pushMsg("avatar", `${elite ? "斩一精英" : "斩妖"}得宝 <b style="color:#f0c98a">${a.name}</b>`
      + (kept ? "（已入囊）" : "（不入眼，熔作灵石）"));
  }
  updateHUD();
  if (kept) updateArts();
  if (Date.now() - _dropSaveT > 15000) { __set_dropSaveT(Date.now()); save(); cloudSoon(); }
  return { kept, spirit: spiritGain, name: a.name, q: a.q || 0 };
}

let _bindPoll = 0;
function bindBattleHooks() {                    // 战斗 IIFE 是内联脚本, 载入序不定 → 轮询挂接
  const api = window.BattleAPI;
  if (!api) {
    if (++_bindPoll > 50) return;              // 15s 后放弃
    setTimeout(bindBattleHooks, 300);
    return;
  }
  api.onDrop = onBattleDrop;
  api.requestEquipDrop = requestEquipDrop;
  api.applyEquipDrop = applyEquipDrop;
  pushBattleStats();
}

/* ── v3.2 统一舞台装配 ───────────────────────────────────────────────
 * 把原先 4 张独立 canvas（bg / battleCanvas / aura / burst）+ 4 个 rAF 循环
 * 合成 1 张 #stage + 1 个 ticker。
 *
 * 层的加入顺序 = 绘制顺序（后者盖前者）：
 *     bg  →  battle  →  aura  →  dantian  →  burst
 *
 * ⚠️ dantian 必须排在 aura【之后】。
 *    灵气层（aura）是四团大半径柔光，铺满大半个屏幕；丹田只有几十像素，
 *    若排在 aura 之前会被灵气直接盖掉（实测：dantian 画完 (3,3,3)，
 *    aura 一过就变 (255,255,255)）。丹田是"界面上最亮的那个点"，
 *    必须压在灵气之上；burst 是爆发特效，最顶层不变。
 *
 * 战斗层是动态 import 的（见 main.js 尾部说明），所以轮询等它就绪后再插入。
 */
function mountStage() {
  if (window.__stage) return;                       // 幂等
  /* v4.1 渲染栈统一 WebGL：#stage 2D 画布已删除。
   *   · 战斗层 → BattleGL(Pixi)（v4.0 已迁）
   *   · 深空/灵气/爆发粒子 → 退役（灵气 36 光点、burst 粒子零贡献，
   *     深空透出 .bg-img 静态图即可，bg.js 保留文件待后续清理）
   * 60-stage 降级为纯 ticker：只负责限帧调度 + dt 分发 + 可见性管理，
   * 2D ctx 为 null，层 draw 的首参恒 null。 */
  const canvas = null;

  /* v4.1 丹田层壳子：fx2d.js 是动态 import（模块可能还没就绪），
   * 先用空壳占住位置，等模块到了再把真身回填进去 —— 这样层顺序不依赖加载时序。
   *
   * ⚠️ 这一层最终【不会画在已删除的 #stage 上】。
   *   丹田是"人物身上发光的一点"，必须长在人物之上 —— 做法见 dantianOverlay()：
   *   给角色容器加一张同尺寸的 overlay canvas，z-index 高于贴图。
   *   （overlay canvas 是丹田的专用绘制面，不属于舞台渲染栈，后续随 fx2d 一并迁移） */
  const dantianLayer = {
    name: "dantian",
    _real: null,
    resize(W, H) { if (this._real) this._real.resize(W, H); },
    draw(c, W, H, dt) { if (!DIMSTAT.on && this._real) this._real.draw(c, W, H, dt); },
  };

  /* 纯 ticker 模式：ctx=null，60-stage 只调度不绘制。 */
  import("./60-stage.js").then(mod => {
    const stage = mod.initStage(canvas, []);
    window.__stage = stage;
    pollBattleLayer(stage);
    /* 丹田：动态 import fx2d，回来后挂到角色之上的 overlay */
    import('../fx2d.js?v=' + CACHE_VER).then(m => {
      const real = m.createFxLayer();
      if (!real) return;
      try { m.setOverlayMode(true); } catch (e) { console.warn('[stage] setOverlayMode 调用失败:', e); }
      dantianLayer._real = real;
      mountDantianOverlay(stage, real);
    }).catch(e => console.error("[stage] dantian 加载失败:", e));
  }).catch(e => console.error("[stage] 加载失败:", e));
}

/* 丹田 overlay —— 在角色容器里插一张贴身的 canvas，z-index 压在贴图之上。
 *
 * 为什么不能画在 #stage 上：#stage z-index:0、角色 .stage z-index:5，
 * 画上去会被人物贴图整个盖住。丹田是"人物身上发光的一点"，
 * 必须跟着人物一起在最上层。
 *
 * 做法：overlay 的尺寸/位置每帧对齐 #cult（或 .bodyL，取到哪个算哪个），
 *   用 getBoundingClientRect() 反推 left/top/width/height，
 *   backing store 按 DPR 放大、再 setTransform 归一到逻辑像素 ——
 *   和 fx2d 的坐标系完全一致，所以 fx2d 的绘制代码一行都不用改。
 *
 * 生命周期：由舞台 ticker 驱动（不自持 rAF），黑屏挂机时随舞台一起暂停。
 *   挂到 window.__dantian 便于验收脚本取证。 */
function mountDantianOverlay(stage, realLayer) {
  const cult = document.getElementById("cult");
  if (!cult) return;
  if (document.getElementById("cultDantian")) return;    // 幂等

  const cv = document.createElement("canvas");
  cv.id = "cultDantian";
  cv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;"
    + "pointer-events:none;z-index:3";   /* 高于 4 张贴图，低于 UI */
  cult.appendChild(cv);
  const octx = cv.getContext("2d", { alpha: true });

  let lastW = 0, lastH = 0, lastDpr = 0;
  let _lastRectT = 0;
  function sync() {
    /* 对齐【#cult 自己】而不是它的父容器。
     * #cult 有 aspect-ratio，父容器 .stage 是 inset:0 的整屏 flex 盒 ——
     * 量父容器会拿到 420x860（整屏），overlay 就铺满屏幕了。
     * 量 #cult 才是 346x350 的角色框。 */
    /* PERF: getBoundingClientRect 每帧调用会强制布局重排，改为 500ms 节流 */
    const now = performance.now();
    if (now - _lastRectT >= 500) {
      _lastRectT = now;
      const r = cult.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (w !== lastW || h !== lastH || dpr !== lastDpr) {
        lastW = w; lastH = h; lastDpr = dpr;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = w + "px";
        cv.style.height = h + "px";
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    /* 每帧清一次自己的 overlay（它是独立画布，不共享，clear 是安全的）。
     * clearRect 的作用域也是 [0,0,w,h]，与绘制范围完全吻合。 */
    octx.clearRect(0, 0, lastW, lastH);
  }

  const layer = {
    name: "dantian",
    draw(c, W, H, dt) {
      sync();
      /* 把 overlay 自己的坐标系交给 fx2d：
       * overlay 左上角 = cult 左上角，所以 fx2d 里以 overlay 为坐标原点的
       * "角色框中心点" 就等于 (W/2, H*0.40) —— 用 overlay 尺寸算即可。 */
      realLayer.draw(octx, lastW, lastH, dt);
    },
  };
  /* 关键：不要交给 stage.addLayer —— 那会画到共享 #stage 上。
   * 这里包一层，借用舞台的 ticker 调度，但把目标 ctx 换成 overlay。 */
  stage.addLayer(layer);
  window.__dantian = layer;

  /* 把 fx2d 的锚点解析钉死在 overlay 自身上（不再去 querySelector 找 bodyL，
   * 因为 overlay 的 rect 已经是角色框，FX 内部按 40% 高定位即可）。 */
  realLayer.resize(lastW || 1, lastH || 1);
}

/* 战斗层就绪后插到 bg 与 aura 之间。
 * 最终顺序：bg → battle → aura → burst
 * （v3.4: 纸月层已移除，用"右上角挂月亮"的思路让位给换战斗区背景图） */
let _battlePoll = 0;
function pollBattleLayer(stage) {
  const api = window.BattleAPI;
  if (!api) {
    if (++_battlePoll > 100) return;                // 10s 后放弃
    setTimeout(() => pollBattleLayer(stage), 100);
    return;
  }
  if (window.__stageHasBattle) return;
  window.__stageHasBattle = true;
  setTimeout(() => {
    if (typeof api.createStageLayer !== "function") return;
    const L = api.createStageLayer();
    if (L && typeof stage.insertLayerBefore === "function") stage.insertLayerBefore("aura", L);
    else if (L) stage.addLayer(L);
  }, 300);
}

(function initSplash() {
  const sp = document.getElementById("splash");
  const bar = sp && document.getElementById("spBar");
  const pctEl = sp && document.getElementById("spPct");
  const statEl = sp && document.getElementById("spStat");
  let p = 0, done = false;
  const timer = setInterval(() => {                 // 只涨到 88%, 剩下 12% 留给"门禁通过"
    if (done) return;
    p = Math.min(88, p + 2 + Math.random() * 6);
    if (bar) bar.style.width = p.toFixed(0) + "%";
    if (pctEl) pctEl.textContent = p.toFixed(0) + "%";
  }, 150);

  window.splashStat = function (txt) {
    if (done || !statEl) return;
    statEl.textContent = txt;
  };

  /* v1.9.1: 返回 Promise, 开屏真正移除后才 resolve。
   * 之前 boot() 在同一帧就 startGame(), 主页初始化(HUD/背景/飘字/主循环)在开屏
   * 淡出的半透明窗口里抢跑 —— WebView 上掉帧, 有的帧画开屏、有的帧透出主页,
   * 看起来就是"快 100% 时主页和开屏反复交替闪烁"。现在等开屏彻底退场再进主页。 */
  window.splashFinish = function () {
    if (done) return Promise.resolve();
    done = true; clearInterval(timer);
    if (bar) bar.style.width = "100%";
    if (pctEl) pctEl.textContent = "100%";
    if (statEl) statEl.textContent = "即将进入";
    return new Promise(res => {
      setTimeout(() => {
        if (!sp) return res();
        sp.classList.add("sp-out");
        setTimeout(() => { try { sp.remove(); } catch (e) { console.warn('[splash] 开屏DOM移除失败:', e); } res(); }, 720);
      }, 240);
    });
  };

  /* 门禁失败: 停在失败页, 不进入游戏。自动重试已在 bootGate 里退避跑完, 这里给手动重试 */
  window.splashFail = function () {
    if (done && !sp) return;
    done = true; clearInterval(timer);
    if (!sp) return;
    if (bar) bar.style.width = "100%";
    if (pctEl) pctEl.textContent = "—";
    sp.style.cursor = "default";
    sp.innerHTML =
      '<div class="sp-fail">' +
        '<div class="sp-fail-t">无法连接服务器</div>' +
        '<div class="sp-fail-d">本游戏需要联网校验存档。<br>请检查网络后重试。</div>' +
        '<button class="sp-fail-b" type="button">重试</button>' +
      '</div>';
    const btn = sp.querySelector(".sp-fail-b");
    if (btn) btn.addEventListener("click", () => location.reload());
  };
})();

export {
  adventure,
  applyEquipDrop,
  bindBattleHooks,
  boot,
  bootCloud,
  bootGate,
  cldAdoptCloud,
  cldPull,
  cloudBind,
  cloudFlush,
  cloudInit,
  cloudPullNow,
  collectAllMail,
  collectMail,
  consumePill,
  craftPill,
  doBreak,
  doCraft,
  loop,
  mailClaim,
  manualBreak,
  onBattleDrop,
  presentSettle,
  realmPlot,
  refreshOpenPanel,
  requestEquipDrop,
  startGame,
  startHeartbeat,
  startTravel,
  stayMailCheck,
  tapArray,
};
