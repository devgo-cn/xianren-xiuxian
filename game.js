/**
 * game.js —— 兼容占位（v3.1）
 *
 * 真正的内容已按拓扑层拆入 src/*.js，唯一入口是 src/main.js。
 * 本文件仅作兼容保留：若有外部注入脚本 / 旧书签 / 调试页面仍以经典脚本方式
 * 加载 game.js，这里会把它转发到 src/main.js，行为与直接加载入口一致。
 *
 * ⚠️ 不要在本文件里写业务逻辑。
 *    原因见 v3.0 的教训：入口若同时存在"带 ?v= 的动态 import"与"模块间不带 ?v=
 *    的静态 import"，浏览器会把同一文件当两个模块标识，实例化两遍，
 *    state / SND / 各级缓存分裂成两份（表现为音效开关失效、rAF 重复注册）。
 *    所以入口只此一处，且模块内部一律不带 query。
 *
 * 版本号唯一来源是 index.html 顶部的 window.APP_VER；改版本号只跑 tools/bump-version.py。
 */
(function () {
  var v = window.APP_VER || "dev";
  var s = document.createElement("script");
  s.type = "module";
  s.src = "./src/main.js?v=" + v;
  document.body.appendChild(s);
})();
