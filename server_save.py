#!/usr/bin/env python3
"""
v6 存档服务器 —— 完整实现客户端的云存档协议。

── 为什么要这个服务器 ───────────────────────────────────────────────
旧 server.py 只有 /api/calibrate，而客户端请求的是 /api/save（GET/PUT）。
两者对不上 → 控制台一直 ERR_CONNECTION_REFUSED，且 bootGate() 永远过不去，
startGame() 不执行 → mountStage() 不执行 → 战斗层从未挂上舞台，
表现为「战斗 update() 完全没跑、kills 恒 0、技能 CD 不动」。

── 完整协议（与 src/10-base.js cldApi / src/20-core.js _cloudSettleRun 对齐）
  GET  /api/save?id=X&device=Y
       → { ok, found, data, ts, serverTime }
         data 是 g1Pack 压缩串（服务端不透明，原样回传）
  PUT  /api/save?id=X&device=Y&settle=1   body = { __z: <g1Pack 串> }
       → { ok, settled, mode, ts, serverTime, data, gains }
         · settle=1 是【唯一写入口】—— 客户端所有上传都走它
           （见 cldPush 注释：普通 PUT 会推进结算锚却不发收益，等于吃掉那段收益）
  POST /api/save?id=X&device=Y            body = 存档对象（裸 JSON，调试用）
       → 直接落盘，不做结算

── v6 存档只存 4 样东西 ─────────────────────────────────────────────
  1. 离线相关：runT（本轮通关速度，离线按它折算轮数）
  2. 境界：realm / totalPoints
  3. 灵石：spirit
  4. 装备：equip（4 格等级）
  技能不入档（恒定伤害、无等级），服务端不解析、也不需要认识技能字段 ——
  它把 data 当成不透明串原样存取，这正是"技能不用存"的结构性保证。

落盘：/tmp/xianren_saves/<id>.json（沙箱重启会清，开发够用）
"""
import json
import os
import re
import time

from flask import Flask, jsonify, request, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.environ.get('SAVE_DIR', '/tmp/xianren_saves')
os.makedirs(SAVE_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)

# 存档码只允许安全字符，避免路径穿越
SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')

# 单档大小上限，防有人往存档里灌几十兆把盘写满
MAX_BODY = 4 * 1024 * 1024

# 在线判定阈值（秒）：两次结算间隔小于它就认为玩家一直在，离线收益为 0。
# 对齐服务端口径 —— ≤180s 视为在线（见 40-app.js visibilitychange 注释）。
ONLINE_SEC = 180


def _path(sid):
    return os.path.join(SAVE_DIR, sid + '.json')


def _valid(sid):
    return bool(sid) and bool(SAFE_ID.match(sid))


def _now_ms():
    return int(time.time() * 1000)


def _load(sid):
    p = _path(sid)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _store(sid, data, ts=None):
    """原子写入 —— 先写 .tmp 再 os.replace，防写一半崩掉留个半截档。"""
    ts = ts or _now_ms()
    tmp = _path(sid) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'data': data, 'ts': ts, 'anchor': ts}, f, ensure_ascii=False)
    os.replace(tmp, _path(sid))
    return ts


@app.get('/api/save')
def get_save():
    """拉档。found=false 时客户端据此判「新玩家」。"""
    sid = request.args.get('id', '')
    if not _valid(sid):
        return jsonify({'ok': False, 'err': 'bad id'}), 400
    rec = _load(sid)
    if rec is None:
        return jsonify({'ok': True, 'found': False, 'data': None, 'ts': 0,
                        'serverTime': _now_ms()})
    return jsonify({'ok': True, 'found': True, 'data': rec.get('data'),
                    'ts': rec.get('ts', 0), 'serverTime': _now_ms()})


@app.put('/api/save')
def put_save():
    """
    唯一写入口。settle=1 时做结算：
      · 距上次写入 ≤ ONLINE_SEC 秒 → 判为在线，settled=false，不发离线收益；
      · 超过阈值 → settled=true, mode="away"，并带上离线时长的增益。
    v6 的真实离线收益由客户端自己的 05-v6.js settleOffline() 按「本轮速度 × 轮数」算，
    服务端这里只负责【告诉客户端走了多久】+ 把新档存下来。
    """
    sid = request.args.get('id', '')
    if not _valid(sid):
        return jsonify({'ok': False, 'err': 'bad id'}), 400

    body = request.get_json(force=True, silent=True)
    if not isinstance(body, dict):
        return jsonify({'ok': False, 'err': 'bad json'}), 400

    payload = body.get('__z')            # g1Pack 压缩串，服务端不透明
    if payload is None:
        # 兼容裸 JSON（调试 / 老客户端）
        payload = body
    if isinstance(payload, str) and len(payload) > MAX_BODY:
        return jsonify({'ok': False, 'err': 'too large'}), 413

    now = _now_ms()
    prev = _load(sid)
    prev_ts = prev.get('ts', 0) if prev else 0
    away = max(0, (now - prev_ts) // 1000) if prev_ts else 0
    settled = bool(prev_ts) and away > ONLINE_SEC

    _store(sid, payload, now)

    gains = None
    if settled:
        gains = {
            'mode': 'away',
            'exp': 0,             # v6 的收益在客户端算，这里留字段保持契约完整
            'spirit': 0,
            'seconds': away,
        }

    return jsonify({
        'ok': True,
        'settled': settled,
        'mode': 'away' if settled else 'online',
        'ts': now,
        'serverTime': now,
        'data': payload,
        'gains': gains,
    })


@app.post('/api/save')
def post_save():
    """裸 JSON 落盘 —— 只用于本地调试 / 验收脚本，不参与结算。"""
    sid = request.args.get('id', '')
    if not _valid(sid):
        return jsonify({'ok': False, 'err': 'bad id'}), 400
    body = request.get_json(force=True, silent=True)
    if not isinstance(body, dict):
        return jsonify({'ok': False, 'err': 'bad json'}), 400
    ts = _store(sid, body)
    return jsonify({'ok': True, 'ts': ts, 'serverTime': ts})


@app.delete('/api/save')
def delete_save():
    """删档 —— 验收脚本用来跑「新玩家」路径。"""
    sid = request.args.get('id', '')
    if not _valid(sid):
        return jsonify({'ok': False, 'err': 'bad id'}), 400
    p = _path(sid)
    if os.path.exists(p):
        os.remove(p)
    return jsonify({'ok': True, 'serverTime': _now_ms()})


@app.get('/api/health')
def health():
    return jsonify({'ok': True, 'saves': len(os.listdir(SAVE_DIR))})


@app.get('/<path:path>')
def static_files(path):
    return send_from_directory(ROOT, path)


@app.get('/')
def index():
    return send_from_directory(ROOT, 'index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8090))
    print(f'[存档服务] http://0.0.0.0:{port}  落盘目录 {SAVE_DIR}')
    app.run(host='0.0.0.0', port=port, threaded=True)
