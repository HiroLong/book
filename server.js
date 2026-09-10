const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data.json');
const PORT = process.env.PORT || 3000;
const sessions = new Map();
const studentNames = ['张晨','李欣怡','王子豪','陈思远','赵雅静','黄宇轩','周可欣','吴俊杰','徐梦瑶','孙浩然','胡馨月','朱博文','高梓涵','林俊杰','何雨晴','郭家铭','马婉婷','罗天佑','梁诗涵','宋泽宇','郑晓彤','廖隆','文康','谢安琪','唐逸飞','韩雪','冯子轩','蒋欣妍','曹睿','彭佳怡','曾祥瑞','田甜','邓凯','何佳','袁野','沈悦','吕航','许诺','傅子涵','苏明','邹琳','方圆','戴维','熊婕','白杨','龚旭','邱梦','黎阳'];
function fixedStudents() { return Array.from({ length: 48 }, (_, i) => ({ id: i + 1, username: `230901${String(i + 1).padStart(4, '0')}`, name: studentNames[i], password: String(i + 1).padStart(3, '0'), role: 'student', credit: 100 })); }

const initial = {
  users: [
    { id: 1, username: '2023010426', name: '林晓雨', password: '2023010426', role: 'student', credit: 86 },
    { id: 2, username: 'admin', name: '图书馆管理员', password: 'admin123', role: 'admin', credit: 100 }
  ],
  rooms: [
    { id: 1, name: '一楼大厅 · A区', floor: 1, open: '08:00', close: '22:30', status: '开放' },
    { id: 2, name: '二楼自习区', floor: 2, open: '07:30', close: '23:00', status: '开放' },
    { id: 3, name: '三楼研讨室', floor: 3, open: '09:00', close: '21:00', status: '开放' }
  ],
  seats: [],
  reservations: [],
  violations: []
};

function seed() {
  if (!fs.existsSync(DB_FILE) || read().rooms.length === 0) {
    for (const room of initial.rooms) {
      const count = room.id === 1 ? 48 : room.id === 2 ? 72 : 24;
      for (let i = 1; i <= count; i++) initial.seats.push({ id: room.id * 1000 + i, roomId: room.id, no: `${String.fromCharCode(64 + Math.ceil(i / 12))}-${String((i - 1) % 12 + 1).padStart(2, '0')}`, power: i % 3 !== 0, window: i % 4 === 0, quiet: room.id !== 1, status: i % 11 === 0 ? '维修中' : '可预约' });
    }
    save(initial);
  }
  const db = read();
  const admin = db.users.find(x => x.role === 'admin') || { id: 100, username: 'admin', name: '图书馆管理员', password: 'admin123', role: 'admin', credit: 100 };
  db.users = [admin, ...fixedStudents()];
  save(db);
}
function read() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function save(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
function send(res, status, body, headers = {}) { const payload = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(payload); }
function parseBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); }); }
function user(req) { const cookie = req.headers.cookie || ''; const sid = (cookie.match(/sid=([^;]+)/) || [])[1]; return sid ? sessions.get(sid) : null; }
function requireRole(req, res, role) { const u = user(req); if (!u || (role && u.role !== role)) { send(res, 401, { error: '请先登录管理员账号' }); return null; } return u; }
function idFrom(url) { return Number(url.split('/').pop()); }

function api(req, res, url) {
  if (req.method === 'POST' && url === '/api/login') return parseBody(req).then(body => { const db = read(); const found = db.users.find(x => x.username === body.username && x.password === body.password); if (!found) return send(res, 401, { error: '账号或密码不正确' }); const sid = crypto.randomBytes(18).toString('hex'); sessions.set(sid, { id: found.id, username: found.username, name: found.name, role: found.role }); send(res, 200, { user: sessions.get(sid) }, { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` }); });
  if (req.method === 'POST' && url === '/api/logout') { const cookie = req.headers.cookie || ''; const sid = (cookie.match(/sid=([^;]+)/) || [])[1]; if (sid) sessions.delete(sid); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url === '/api/state') { const db = read(); const u = user(req); const reservations = u ? db.reservations.filter(x => u.role === 'admin' || x.userId === u.id) : []; return send(res, 200, { authenticated: !!u, user: u, rooms: db.rooms, seats: db.seats, reservations, violations: u ? db.violations.filter(x => x.userId === u.id) : [] }); }
  if (req.method === 'GET' && url === '/api/admin/overview') { if (!requireRole(req, res, 'admin')) return; const db = read(); const today = new Date().toISOString().slice(0, 10); return send(res, 200, { rooms: db.rooms, seats: db.seats, reservations: db.reservations, violations: db.violations, users: db.users.map(({ password, ...x }) => x), today }); }
  if (req.method === 'POST' && url === '/api/reservations') return parseBody(req).then(body => { const u = user(req); if (!u || u.role !== 'student') return send(res, 401, { error: '请先登录学生账号' }); const db = read(); const required = ['roomId', 'seatId', 'date', 'start', 'end']; if (required.some(k => !body[k])) return send(res, 400, { error: '预约信息不完整' }); if (body.start >= body.end) return send(res, 400, { error: '结束时间必须晚于开始时间' }); const overlap = db.reservations.find(x => x.seatId == body.seatId && x.date === body.date && x.status === '待签到' && body.start < x.end && body.end > x.start); if (overlap) return send(res, 409, { error: '该时间段已经被预约' }); const record = { id: Date.now(), userId: u.id, userName: u.name, roomId: Number(body.roomId), seatId: Number(body.seatId), seatNo: body.seatNo, date: body.date, start: body.start, end: body.end, preferences: body.preferences || [], status: '待签到', createdAt: new Date().toISOString() }; db.reservations.unshift(record); save(db); send(res, 201, record); });
  if (req.method === 'PATCH' && url.startsWith('/api/reservations/')) return parseBody(req).then(body => { const db = read(); const record = db.reservations.find(x => x.id === idFrom(url)); if (!record) return send(res, 404, { error: '预约不存在' }); if (body.action === 'cancel') record.status = '已取消'; if (body.action === 'checkin') { record.status = '使用中'; record.checkInAt = new Date().toISOString(); } save(db); send(res, 200, record); });
  if (req.method === 'PATCH' && url.startsWith('/api/admin/rooms/')) { if (!requireRole(req, res, 'admin')) return; return parseBody(req).then(body => { const db = read(); const room = db.rooms.find(x => x.id === idFrom(url)); if (!room) return send(res, 404, { error: '阅览室不存在' }); Object.assign(room, body); save(db); send(res, 200, room); }); }
  if (req.method === 'PATCH' && url.startsWith('/api/admin/seats/')) { if (!requireRole(req, res, 'admin')) return; return parseBody(req).then(body => { const db = read(); const seat = db.seats.find(x => x.id === idFrom(url)); if (!seat) return send(res, 404, { error: '座位不存在' }); Object.assign(seat, body); save(db); send(res, 200, seat); }); }
  if (req.method === 'DELETE' && url.startsWith('/api/admin/reservations/')) { if (!requireRole(req, res, 'admin')) return; const db = read(); const record = db.reservations.find(x => x.id === idFrom(url)); if (record) record.status = '管理员取消'; save(db); return send(res, 200, { ok: true }); }
  send(res, 404, { error: '接口不存在' });
}

function staticFile(req, res, pathname) { const file = pathname === '/' ? 'index.html' : pathname.slice(1); const safe = path.normalize(file).replace(/^([.][.][\\/])+/, ''); const full = path.join(ROOT, safe); if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, { error: '页面不存在' }); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }; res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res); }
seed();
http.createServer((req, res) => { const url = new URL(req.url, `http://${req.headers.host}`).pathname; if (url.startsWith('/api/')) return api(req, res, url); staticFile(req, res, url); }).listen(PORT, '0.0.0.0', () => console.log(`阅间已启动: http://0.0.0.0:${PORT}`));

