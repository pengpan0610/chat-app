// app.js - ChatNova 后端主入口
// 先跑起来，再优化 —— 后盾

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ─── 配置 ───────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'chatnova-secret-change-in-production',
  JWT_EXPIRES: '7d',
  DB: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'chatnova',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'chatnova',
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
  },
  UPLOAD_DIR: path.join(__dirname, '../uploads'),
};

// 确保上传目录存在
if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
}

// ─── MySQL 连接池 ────────────────────────────────────────
const pool = mysql.createPool(CONFIG.DB);

// 测试数据库连接
async function testDB() {
  try {
    const conn = await pool.getConnection();
    console.log('[DB] MySQL 连接成功');
    conn.release();
    return true;
  } catch (err) {
    console.error('[DB] MySQL 连接失败：', err.message);
    return false;
  }
}

// ─── Express 应用 ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件：uploads 目录可公开访问
app.use('/uploads', express.static(CONFIG.UPLOAD_DIR));

// ─── 图片上传（multipart/form-data）────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONFIG.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB 限制
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpeg|jpg|png|gif|webp)$/i.test(file.originalname);
    cb(null, ok);
  }
});

app.post('/api/upload', verifyToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ code: 400, msg: '未收到文件' });
  // 返回可访问的 URL（相对于服务器域名）
  const url = `/chat-app/uploads/${req.file.filename}`;
  res.json({ code: 0, data: { url, filename: req.file.filename } });
});

// ─── 工具函数 ─────────────────────────────────────────────
function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function signToken(userId) {
  return jwt.sign({ uid: userId }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES });
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, msg: '未登录' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), CONFIG.JWT_SECRET);
    req.uid = decoded.uid;
    next();
  } catch {
    return res.status(401).json({ code: 401, msg: 'Token 失效' });
  }
}

// ─── 初始化默认数据 ───────────────────────────────────────
async function initDefaultData() {
  const conn = await pool.getConnection();
  try {
    // 检查是否已有管理员
    const [rows] = await conn.execute('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
    if (rows.length === 0) {
      const adminId = genId('user');
      const hash = await bcrypt.hash('admin123', 10);
      await conn.execute(
        'INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)',
        [adminId, 'admin', hash, 'admin', Date.now()]
      );
      console.log('[INIT] 默认管理员已创建：admin / admin123');
    } else {
      console.log('[INIT] 管理员账号已存在，跳过初始化');
    }
  } catch (err) {
    console.error('[INIT] 初始化失败：', err.message);
  } finally {
    conn.release();
  }
}

// ─── REST API 路由 ────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ code: 400, msg: '用户名和密码必填' });
  if (password.length < 6) return res.status(400).json({ code: 400, msg: '密码至少6位' });

  try {
    const conn = await pool.getConnection();
    const [exist] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (exist.length > 0) {
      conn.release();
      return res.status(400).json({ code: 400, msg: '用户名已存在' });
    }
    const userId = genId('user');
    const hash = await bcrypt.hash(password, 10);
    await conn.execute(
      'INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, username, hash, 'member', Date.now()]
    );
    // 记录注册申请
    await conn.execute(
      'INSERT INTO reg_requests (id, username, requested_at, status) VALUES (?, ?, ?, ?)',
      [genId('reg'), username, Date.now(), 'approved']
    );
    conn.release();
    res.json({ code: 0, msg: '注册成功', data: { token: signToken(userId) } });
  } catch (err) {
    console.error('[REGISTER]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ code: 400, msg: '用户名和密码必填' });

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT * FROM users WHERE username = ?', [username]);
    conn.release();
    if (rows.length === 0) return res.status(400).json({ code: 400, msg: '用户不存在' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ code: 400, msg: '密码错误' });
    res.json({
      code: 0, msg: '登录成功',
      data: {
        token: signToken(user.id),
        user: { id: user.id, username: user.username, role: user.role, avatar_emoji: user.avatar_emoji }
      }
    });
  } catch (err) {
    console.error('[LOGIN]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT id, username, role, avatar_emoji, created_at, last_online FROM users WHERE id = ?',
      [req.uid]
    );
    conn.release();
    if (rows.length === 0) return res.status(404).json({ code: 404, msg: '用户不存在' });
    res.json({ code: 0, data: rows[0] });
  } catch (err) {
    console.error('[ME]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// GET /api/users
app.get('/api/users', verifyToken, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT id, username, role, avatar_emoji, last_online FROM users WHERE id != ? ORDER BY username',
      [req.uid]
    );
    conn.release();
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('[USERS]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// GET /api/groups
app.get('/api/groups', verifyToken, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    // 获取用户加入的群
    const [groups] = await conn.execute(
      `SELECT g.* FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ? ORDER BY g.created_at DESC`,
      [req.uid]
    );
    conn.release();
    res.json({ code: 0, data: groups });
  } catch (err) {
    console.error('[GROUPS]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// POST /api/groups
app.post('/api/groups', verifyToken, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name) return res.status(400).json({ code: 400, msg: '群名必填' });

  try {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const groupId = genId('group');
    await conn.execute(
      'INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
      [groupId, name, req.uid, Date.now()]
    );
    // 添加群主
    await conn.execute(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)',
      [groupId, req.uid, Date.now()]
    );
    // 添加成员
    if (Array.isArray(memberIds)) {
      for (const mid of memberIds) {
        await conn.execute(
          'INSERT IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)',
          [groupId, mid, Date.now()]
        );
      }
    }
    await conn.commit();
    conn.release();
    res.json({ code: 0, msg: '群聊创建成功', data: { id: groupId, name } });
  } catch (err) {
    console.error('[CREATE GROUP]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// GET /api/messages   ?with=userId 或 ?group=groupId
app.get('/api/messages', verifyToken, async (req, res) => {
  const { with: withId, group: groupId, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conn = await pool.getConnection();
    let sql, params;
    if (withId) {
      // 私聊：双方互发
      sql = `(SELECT * FROM messages WHERE from_user = ? AND to_user = ?) UNION ALL
             (SELECT * FROM messages WHERE from_user = ? AND to_user = ?)
             ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params = [req.uid, withId, withId, req.uid, parseInt(limit), offset];
    } else if (groupId) {
      // 群聊
      sql = 'SELECT * FROM messages WHERE to_group = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params = [groupId, parseInt(limit), offset];
    } else {
      conn.release();
      return res.status(400).json({ code: 400, msg: '缺少参数' });
    }
    const [rows] = await conn.query(sql, params);
    conn.release();
    res.json({ code: 0, data: rows.reverse() });  // 按时间正序返回
  } catch (err) {
    console.error('[MESSAGES]', err.message);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// ─── HTTP Server + Socket.IO ───────────────────────────────
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 在线用户映射：userId -> socketId
const onlineUsers = new Map();

io.use(async (socket, next) => {
  // Socket 认证：从 handshake 拿 token
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('未授权'));
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
    socket.uid = decoded.uid;
    next();
  } catch {
    next(new Error('Token 失效'));
  }
});

io.on('connection', async (socket) => {
  const uid = socket.uid;
  console.log(`[WS] 用户连接：${uid} (${socket.id})`);

  // 标记在线
  onlineUsers.set(uid, socket.id);
  await updateOnlineStatus(uid, Date.now());

  // 加入个人房间（用于精准推送）
  socket.join(`user_${uid}`);

  // 获取用户所在的所有群，自动加入群房间
  try {
    const conn = await pool.getConnection();
    const [groups] = await conn.execute(
      'SELECT group_id FROM group_members WHERE user_id = ?',
      [uid]
    );
    conn.release();
    groups.forEach(g => socket.join(`group_${g.group_id}`));
  } catch (err) { console.error('[WS JOIN GROUPS]', err.message); }

  // ── 发送消息 ────────────────────────────────────────────
  socket.on('send_message', async (data) => {
    const { toUser, toGroup, text, msgType = 'text' } = data;
    if (!text) return;

    try {
      const conn = await pool.getConnection();
      const msgId = genId('msg');
      const now = Date.now();
      await conn.execute(
        'INSERT INTO messages (id, from_user, to_user, to_group, text, msg_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [msgId, uid, toUser || null, toGroup || null, text, msgType, now]
      );

      const [userRows] = await conn.execute('SELECT username, avatar_emoji FROM users WHERE id = ?', [uid]);
      conn.release();

      const msg = {
        id: msgId, from: uid,
        toUser, toGroup, text, msgType,
        createdAt: now,
        fromUsername: userRows[0]?.username || '',
        fromAvatar: userRows[0]?.avatar_emoji || '😀',
      };

      // 推送目标
      if (toUser) {
        io.to(`user_${toUser}`).emit('new_message', msg);
        socket.emit('new_message', msg);  // 自己也收到（多端同步）
      } else if (toGroup) {
        io.to(`group_${toGroup}`).emit('new_message', msg);
      }
    } catch (err) {
      console.error('[SEND MSG]', err.message);
      socket.emit('error_msg', { msg: '发送失败' });
    }
  });

  // ── 加入群聊房间 ────────────────────────────────────────
  socket.on('join_group', (groupId) => {
    socket.join(`group_${groupId}`);
  });

  // ── 离开群聊房间 ────────────────────────────────────────
  socket.on('leave_group', (groupId) => {
    socket.leave(`group_${groupId}`);
  });

  // ── 正在输入 ────────────────────────────────────────────
  socket.on('typing', (data) => {
    const { toUser, toGroup } = data;
    const payload = { from: uid, ...data };
    if (toUser) io.to(`user_${toUser}`).emit('typing', payload);
    else if (toGroup) io.to(`group_${toGroup}`).emit('typing', payload);
  });

  // ── 断开连接 ────────────────────────────────────────────
  socket.on('disconnect', async () => {
    console.log(`[WS] 用户断开：${uid}`);
    onlineUsers.delete(uid);
    await updateOnlineStatus(uid, 0);
  });
});

async function updateOnlineStatus(uid, ts) {
  try {
    const conn = await pool.getConnection();
    await conn.execute('UPDATE users SET last_online = ? WHERE id = ?', [ts, uid]);
    conn.release();
  } catch (err) { console.error('[ONLINE STATUS]', err.message); }
}

// ─── 启动 ────────────────────────────────────────────────
async function start() {
  const dbOk = await testDB();
  if (!dbOk) { console.error('数据库不可用，退出'); process.exit(1); }

  await initDefaultData();

  httpServer.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`[ChatNova] 服务启动成功：http://0.0.0.0:${CONFIG.PORT}`);
    console.log(`[ChatNova] WebSocket 可用：ws://0.0.0.0:${CONFIG.PORT}`);
  });
}

start();
