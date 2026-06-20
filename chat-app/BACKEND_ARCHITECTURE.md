# ChatNova 后端架构方案

> 作者：后盾-后端架构师  
> 日期：2026-06-19  
> 目标：将纯前端 localStorage 应用迁移至 Node.js + MySQL + WebSocket 持久化架构

---

## 一、当前状态分析

### 现有数据结构（index.html 前端 store）

```
chatnova_store (localStorage KEY)
├── users: [{id, username, password, role, createdAt}]
├── groups: [{id, name, ownerId, members: [userId], createdAt}]
├── messages: [{id, from, to, text, time, type:'user'|'group', ...}]
├── groupMsgReviews: [{id, groupId, fromUserId, originalText, status, ...}]
└── version: 4
```

**问题**：
- 数据存在浏览器本地，换设备/清缓存全丢
- 无法跨设备同步消息
- 无实时推送，只能轮询
- 图片存在 IndexedDB，无法跨用户共享

---

## 二、技术选型

| 层级 | 方案 | 理由 |
|------|------|------|
| 运行时 | **Node.js 18+** | 服务器已有 Ubuntu，apt 直接装 |
| Web框架 | **Express 4** | 轻量，团队熟悉，够用 |
| 数据库 | **MySQL 8** | 关系型数据天然适合用户/群组/消息；服务器内存有限，MySQL 比 MongoDB 省资源 |
| 实时通信 | **Socket.IO** | 自带房间、断线重连、降级兼容，比原生 WebSocket 省心 |
| 文件存储 | **服务器本地磁盘** + Nginx 静态服务 | 早期用户量少，直接存 `/var/www/html/chat-app/uploads/`；后续可迁 COS |
| 认证 | **JWT** (jsonwebtoken) | 无状态，适合多端（H5 + 未来小程序） |
| 部署 | **PM2** + Nginx 反向代理 | PM2 守护进程，Nginx 处理静态文件和 HTTPS 终止 |

**不选的**：
- ❌ MongoDB：关系查询（查群成员消息）需要 `$lookup`，不如 SQL JOIN 直观
- ❌ Redis：早期没必要，MySQL 8 的 memory engine 够用；后续加缓存再引入
- ❌ Docker：服务器资源有限，裸机部署更简单，运维成本低
- ❌ 微服务：一个 ChatNova 用不上，单体先跑起来

---

## 三、数据库设计

### 3.1 表结构

```sql
-- 用户表
CREATE TABLE users (
  id VARCHAR(32) PRIMARY KEY,          -- 'user_' + timestamp
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,        -- bcrypt 哈希
  role ENUM('admin','whitelist','member') DEFAULT 'member',
  avatar_emoji VARCHAR(8) DEFAULT '😀',
  created_at BIGINT NOT NULL,             -- Unix ms
  last_online BIGINT DEFAULT 0,          -- 最后在线时间
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 群聊表
CREATE TABLE groups (
  id VARCHAR(32) PRIMARY KEY,          -- 'group_' + timestamp
  name VARCHAR(100) NOT NULL,
  owner_id VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 群成员表（多对多）
CREATE TABLE group_members (
  group_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 消息表
CREATE TABLE messages (
  id VARCHAR(32) PRIMARY KEY,
  from_user VARCHAR(32) NOT NULL,
  to_user VARCHAR(32) DEFAULT NULL,     -- 私聊目标（NULL=群消息）
  to_group VARCHAR(32) DEFAULT NULL,    -- 群聊目标（NULL=私聊）
  text LONGTEXT NOT NULL,                -- 文本内容或 "IMG:base64" / "SHOT:base64"
  msg_type ENUM('text','image','shot','system') DEFAULT 'text',
  created_at BIGINT NOT NULL,
  INDEX idx_to_user (to_user, created_at),
  INDEX idx_to_group (to_group, created_at),
  INDEX idx_from_user (from_user, created_at),
  FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (to_group) REFERENCES groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 群消息审核表
CREATE TABLE group_msg_reviews (
  id VARCHAR(32) PRIMARY KEY,
  group_id VARCHAR(32) NOT NULL,
  from_user VARCHAR(32) NOT NULL,
  original_text LONGTEXT,
  final_text LONGTEXT,                   -- 审核后最终文本（可能被修改）
  status ENUM('pending','approved','rejected','edited') DEFAULT 'pending',
  reviewer_id VARCHAR(32) DEFAULT NULL,  -- 审核人
  reviewed_at BIGINT DEFAULT NULL,
  INDEX idx_group_status (group_id, status),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 注册申请表（审计用）
CREATE TABLE reg_requests (
  id VARCHAR(32) PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  requested_at BIGINT NOT NULL,
  status ENUM('approved','rejected') DEFAULT 'approved'  -- 当前流程是自动通过
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.2 图片存储方案

**第一阶段（MVP）**：图片以 Base64 存入 `messages.text` 字段（保持前端兼容）

**第二阶段**：图片上传到服务器，表中只存 URL：
```
/var/www/html/chat-app/uploads/
  ├── 2026/06/19/
  │   ├── img_abc123.png
  │   └── shot_xyz789.png
```

`messages.text` 格式改为：`IMG:/chat-app/uploads/2026/06/19/img_abc123.png`

---

## 四、API 接口设计

### 基础约定
- Base URL：`http://124.220.2.184:3000/api`
- 认证：Bearer Token（JWT），放 Authorization Header
- 响应格式：`{ code: 0, data: ..., msg: 'ok' }`

### 4.1 认证接口

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/register` | 注册（自动创建 member） |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 4.2 用户接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/users` | 获取用户列表（不含密码） |
| GET | `/api/users/:id` | 获取用户详情 |
| PUT | `/api/users/:id/role` | 修改用户角色（admin only） |
| PUT | `/api/users/me/password` | 修改自己的密码 |

### 4.3 群组接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/groups` | 获取我加入的群列表 |
| POST | `/api/groups` | 创建群（admin/whitelist） |
| PUT | `/api/groups/:id/members` | 添加/移除群成员 |
| DELETE | `/api/groups/:id` | 解散群（owner only） |

### 4.4 消息接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/messages?with=:userId` | 获取私聊记录（分页） |
| GET | `/api/messages?group=:groupId` | 获取群聊记录（分页） |
| POST | `/api/messages` | 发送消息（文本/图片 URL） |

**分页参数**：`?page=1&limit=50`，按 `created_at DESC` 返回

### 4.5 审核接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/reviews?group=:groupId` | 获取待审消息列表 |
| PUT | `/api/reviews/:id/approve` | 通过 |
| PUT | `/api/reviews/:id/reject` | 拒绝 |
| PUT | `/api/reviews/:id/edit` | 修改后通过 |

---

## 五、WebSocket 实时通信方案

### 5.1 连接建立

```javascript
// 前端连接
const socket = io('http://124.220.2.184:3000', {
  auth: { token: jwtToken },
  transports: ['websocket', 'polling']  // 自动降级
});
```

### 5.2 房间机制

- 每个用户加入个人房间：`room_user_{userId}`
- 每个群聊有房间：`room_group_{groupId}`
- 服务器维护在线用户列表（用于显示"在线"状态）

### 5.3 事件定义

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `auth` | C→S | 携带 JWT 认证 |
| `join_group` | C→S | 加入群聊房间 |
| `leave_group` | C→S | 离开群聊房间 |
| `send_message` | C→S | 发送消息 |
| `new_message` | S→C | 收到新消息（推送给目标用户/群） |
| `message_revoked` | S→C | 消息撤回通知 |
| `user_online` | S→C | 用户上线通知（群内广播） |
| `user_offline` | S→C | 用户下线通知 |
| `typing` | C→S→C | 正在输入（群内广播） |

### 5.4 消息持久化流程

```
前端 send_message
  → Socket.IO 收到
  → 写入 MySQL messages 表
  → 向目标 to_user 或 to_group 房间广播 new_message
  → 离线用户：消息已存 DB，下次上线拉取（无需额外推送）
```

---

## 六、部署方案（腾讯云轻量服务器）

### 6.1 服务器环境

- OS：Ubuntu（已有）
- IP：124.220.2.184
- 现有：Nginx 托管静态文件 `/var/www/html/`
- 需要安装：Node.js 18、MySQL 8、PM2

### 6.2 安装步骤

```bash
# 1. 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 MySQL 8
sudo apt-get install -y mysql-server
sudo mysql_secure_installation

# 3. 安装 PM2
sudo npm install -g pm2

# 4. 创建数据库
mysql -u root -p
CREATE DATABASE chatnova CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'chatnova'@'localhost' IDENTIFIED BY '强密码';
GRANT ALL PRIVILEGES ON chatnova.* TO 'chatnova'@'localhost';
FLUSH PRIVILEGES;
```

### 6.3 项目目录结构

```
/var/www/html/chat-app/
├── index.html          # 前端（已有）
├── admin.html
├── reset.html
├── uploads/           # 图片上传目录（新建）
└── server/            # 后端（新建）
    ├── package.json
    ├── app.js         # Express 入口
    ├── socket.js      # Socket.IO 逻辑
    ├── config.js      # 数据库配置
    ├── middleware/
    │   └── auth.js   # JWT 验证中间件
    ├── routes/
    │   ├── auth.js
    │   ├── users.js
    │   ├── groups.js
    │   ├── messages.js
    │   └── reviews.js
    └── db/
        ├── init.sql   # 建表 SQL
        └── connection.js
```

### 6.4 Nginx 反向代理配置

```nginx
# /etc/nginx/sites-available/chat-app
server {
    listen 80;
    server_name 124.220.2.184;

    # 静态文件
    location /chat-app/ {
        root /var/www/html;
        try_files $uri $uri/ =404;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 反向代理
    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 6.5 PM2 启动配置

```json
// /var/www/html/chat-app/server/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'chatnova-api',
    script: 'app.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_USER: 'chatnova',
      DB_PASS: '强密码',
      DB_NAME: 'chatnova',
      JWT_SECRET: '随机长字符串'
    }
  }]
}
```

启动：`pm2 start ecosystem.config.js && pm2 save && pm2 startup`

---

## 七、前端适配改造（给阿码-前端开发工程师）

### 需要改动的点

1. **登录/注册**：改调 `/api/auth/login` 和 `/api/auth/register`，拿到 JWT 存 localStorage
2. **消息发送**：原来直接写 localStorage，改为 `socket.emit('send_message', data)`
3. **消息拉取**：原来读 localStorage，改为页面加载时 `GET /api/messages?with=xxx`
4. **实时接收**：监听 `socket.on('new_message')` 推入消息列表
5. **图片上传**：先 `POST /api/upload` 拿到 URL，再发消息存 URL

### 兼容策略（推荐）

**分阶段迁移**，不要一次性全改：

1. **Phase 1**：后端先跑起来，前端仍用 localStorage（双轨并行）
2. **Phase 2**：登录后前端把 localStorage 数据同步到后端（migrate 接口）
3. **Phase 3**：新注册用户直接用后端，老用户引导数据迁移

---

## 八、开发优先级

### P0（必须先做）
1. ✅ 数据库建表 SQL + 连接测试
2. ✅ 登录/注册 API（JWT 签发）
3. ✅ Socket.IO 基础连接 + 认证
4. ✅ 消息发送 + 广播（核心路径跑通）

### P1（核心功能）
5. 私聊/群聊消息存储和拉取（分页）
6. 群消息审核接口 + WebSocket 通知群主
7. 图片上传接口 + 静态文件 serving

### P2（体验优化）
8. 用户在线状态广播
9. 消息分页加载（无限滚动）
10. 消息撤回/删除

### P3（未来）
11. 小程序端适配（同一套 API）
12. 图片迁到 CDN/COS
13. Redis 缓存热点数据
14. 消息搜索

---

## 九、风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 服务器只有1台，挂了全挂 | 高 | 每天 mysqldump 备份到本地；PM2 自动重启 |
| MySQL 连接数上限 | 中 | 用连接池，max_connections=100 够早期用 |
| Socket.IO 内存泄漏 | 中 | PM2 设置 memory_limit，超了自动重启 |
| 图片存本地磁盘满 | 中 | 限制单文件 5MB；定期清理超过 30 天的图片 |
| JWT 无法主动吊销 | 低 | 早期可以接受；后续加 Redis 黑名单 |

---

## 十、下一步行动

1. **等待森哥确认**：技术选型是否有调整？MySQL 是否可以？
2. **我来做**：在本地搭建 Node.js + Express + MySQL 原型，跑通登录→发消息→实时接收 完整链路
3. **给阿码**：提供前端需要改动的接口文档和 Socket.IO 事件清单
4. **给小七**：后端准备好后，提供测试用例

---
*先跑起来，再优化。* — 后盾
