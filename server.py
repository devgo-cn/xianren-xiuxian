"""校准页服务: 静态托管 + 保存接口(POST /api/calibrate 落盘)。监听 $PORT。"""
import json, os
from flask import Flask, request, jsonify, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = '/tmp/calibrate_data.json'
app = Flask(__name__, static_folder=None)

@app.get('/api/calibrate')
def get_cal():
    if os.path.exists(DATA):
        return jsonify(json.load(open(DATA)))
    return jsonify({})

@app.post('/api/calibrate')
def post_cal():
    d = request.get_json(force=True, silent=True)
    if not isinstance(d, dict) or not d:
        return jsonify({'ok': False, 'err': 'bad json'}), 400
    json.dump(d, open(DATA, 'w'))
    return jsonify({'ok': True, 'count': len(d)})

@app.get('/<path:path>')
def static_files(path):
    return send_from_directory(ROOT, path)

@app.get('/')
def index():
    return send_from_directory(ROOT, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8899)), threaded=True)
