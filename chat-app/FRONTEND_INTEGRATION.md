# ChatNova 前端对接文档

> 本文档供 **阿码-前端开发工程师** 参考  
> 目标：把前端从 localStorage 迁移到后端 API + WebSocket

---

## 一、认证流程改造

### 原来（localStorage）

```javascript
// 登录：直接读 localStorage
const store = JSON.parse(localStorage.getItem('chatnova_store') || '{}');
const user = store.users.find(u => u.username === name && u.password === pass);
```

### 现在（JWT）

```javascript
// 1. 登录 → 拿 token
const res = await fetch('http://124.220.2.184/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const { data } = await res.json();
const token = data.token;
localStorage.setItem('chatnova_token', token);  // 存 token

// 2. 后续请求带 Authorization header
const res2 = await fetch('http://124.220.2.184/api/users', {
  headers: { 'Authorization': 'Bearer ' + token },
});
```

**存储变化**：
- ❌ 移除：`chatnova_store` 里的密码存储（后端已哈希）
- ✅ 新增：`chatnova_token` 存 JWT

---

## 二、Socket.IO 连接

### 连接代码

```javascript
import { io } from 'https://cdn.socket.io/4.7.0/socket.io.min.js';

const socket = io('http://124.220.2.184', {
  auth: { token: localStorage.getItem('chatnova_token') },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

socket.on('connect', () => {
  console.log('WebSocket 已连接');
  // 加入所有群聊房间
  myGroups.forEach(g => socket.emit('join_group', g.id));
});

socket.on('disconnect', () => console.log('WebSocket 断开'));
socket.on('reconnect', () => console.log('WebSocket 重连成功'));
```

### 事件清单

| 事件 | 方向 | 数据格式 | 说明 |
|------|------|----------|------|
| `send_message` | C→S | `{ toUser, toGroup, text, msgType }` | 发送消息 |
| `new_message` | S→C | `{ id, from, toUser, toGroup, text, msgType, createdAt, fromUsername, fromAvatar }` | 收到新消息 |
| `join_group` | C→S | `groupId` | 加入群聊房间 |
| `leave_group` | C→S | `groupId` | 离开群聊房间 |
| `typing` | C→S→C | `{ from, toUser, toGroup }` | 正在输入 |
| `user_online` | S→C | `{ userId, username }` | 用户上线（预留） |
| `user_offline` | S→C | `{ userId }` | 用户下线（预留） |

---

## 三、消息发送改造

### 原来（localStorage）

```javascript
function doSend() {
  const msg = { id: genId(), from: currentUser.id, to: target.id, text: input.value, time: Date.now() };
  store.messages.push(msg);
  saveStore();   // 写 localStorage
  renderMessages();
}
```

### 现在（Socket.IO + 后端存储）

```javascript
function doSend() {
  const text = input.value.trim();
  if (!text) return;

  // 1. 立即显示在自己界面（乐观更新）
  const localMsg = { id: 'local_' + Date.now(), from: currentUser.id, text, createdAt: Date.now() };
  messages.push(localMsg);
  renderMessages();
  input.value = '';

  // 2. 通过 Socket 发送到服务器
  const payload = currentChat.type === 'user'
    ? { toUser: currentChat.id, text }
    : { toGroup: currentChat.id, text };

  socket.emit('send_message', payload);
}

// 3. 监听服务器广播的新消息（自己和其他人发的都能收到）
socket.on('new_message', (msg) => {
  // 去掉乐观更新的本地消息（如果有）
  messages = messages.filter(m => m.id !== 'local_' + msg.id);
  messages.push(msg);
  renderMessages();
});
```

---

## 四、消息拉取改造（分页加载）

### 原来（localStorage）

```javascript
function getMessages(chat) {
  return store.messages.filter(m => { /* 内存过滤 */ });
}
```

### 现在（API 分页）

```javascript
let messagePage = 1;
const MESSAGE_LIMIT = 50;

async function loadMessages(isLoadMore = false) {
  const params = currentChat.type === 'user'
    ? `?with=${currentChat.id}`
    : `?group=${currentChat.id}`;
  const url = `/api/messages${params}&page=${messagePage}&limit=${MESSAGE_LIMIT}`;

  const res = await fetch(`http://124.220.2.184${url}`, {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const { data } = await res.json();

  if (isLoadMore) {
    messages = [...data, ...messages];  // 加载更多插到前面
  } else {
    messages = data;
  }
  renderMessages();
}

// 滚动到顶部时加载更多
msgsDiv.addEventListener('scroll', () => {
  if (msgsDiv.scrollTop < 50) {
    messagePage++;
    loadMessages(true);
  }
});
```

---

## 五、图片上传改造

### 原来（IndexedDB + Base64）

```javascript
// 图片转 base64 直接存 messages.text
const reader = new FileReader();
reader.onload = () => {
  doSend(reader.result);  // base64 字符串直接发
};
reader.readAsDataURL(file);
```

### 现在（先上传，再发 URL）

```javascript
async function uploadImage(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('http://124.220.2.184/api/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
  });
  const { data } = await res.json();
  return data.url;  // 返回 "/chat-app/uploads/xxx.png"
}

// 使用：
const url = await uploadImage(file);
socket.emit('send_message', { toGroup: currentChat.id, text: 'IMG:' + url, msgType: 'image' });
```

**消息渲染改造**：
```javascript
// 原来：判断 m.text.startsWith('IMG:') 然后 <img src="base64...">
// 现在：<img src="http://124.220.2.184${url}">
```

---

## 六、用户/群组接口

### 获取用户列表

```javascript
const res = await fetch('http://124.220.2.184/api/users', {
  headers: { 'Authorization': 'Bearer ' + token },
});
const { data } = await res.json();
// data: [{ id, username, role, avatar_emoji, last_online }]
```

### 创建群聊

```javascript
const res = await fetch('http://124.220.2.184/api/groups', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  },
  body: JSON.stringify({ name: '新群', memberIds: ['user_xxx', 'user_yyy'] }),
});
```

---

## 七、迁移策略（推荐）

### 阶段一：后端先跑，前端仍用 localStorage（并行）

- 后端部署好，API 可用
- 前端暂时不改，仍然 localStorage
- **目的**：验证后端稳定性，不影响现有用户

### 阶段二：新用户走后端，老用户引导迁移

- 新注册用户：数据直接写后端
- 老用户打开页面时：检测到 `chatnova_store` 有数据 → 弹窗提示"是否迁移数据到服务器"
- 迁移接口（后端新增）：`POST /api/migrate` 把 localStorage 数据批量导入 MySQL

### 阶段三：全部走后端

- 移除 localStorage 消息存储
- 全部消息从 API 拉取
- localStorage 只存 `chatnova_token`

---

## 八、需要前端配合修改的文件位置

根据 `index.html` 现有结构：

| 功能 | 原位置（行号参考） | 改造内容 |
|------|---------------------|----------|
| 登录/注册 | `doLogin()` / `doRegister()` | 改调 API |
| 消息发送 | `doSend()` (~行1694) | 改 Socket.IO emit |
| 消息渲染 | `renderMessages()` | 支持 IMG:url 格式 |
| 消息拉取 | `getMessages()` (~行710) | 改 API 分页拉取 |
| 图片发送 | 输入栏按钮事件 | 先 upload 再发消息 |
| 群聊创建 | 新建群按钮事件 | 改 API 创建 |
| 用户列表 | `renderSidebar()` | 从 API 拉取 |

---

## 九、调试技巧

### 在浏览器 Console 测试 Socket.IO

```javascript
// 1. 连接
const socket = io('http://124.220.2.184', {
  auth: { token: localStorage.getItem('chatnova_token') }
});

// 2. 发消息测试
socket.emit('send_message', { toUser: 'user_xxx', text: 'hello from console' });

// 3. 监听
socket.on('new_message', m => console.log('收到', m));
```

### 用 curl 测试 API

```bash
# 登录拿 token
token=$(curl -s -X POST http://124.220.2.184/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

# 用 token 调接口
curl http://124.220.2.184/api/users \
  -H "Authorization: Bearer $token"
```

---

## 十、待后端完成后确认

- [ ] 服务器 IP 是否变更为域名（影响所有 API 地址）
- [ ] JWT_SECRET 是否配置（影响 token 签发）
- [ ] 图片上传 URL 前缀是否正确（`/chat-app/uploads/` vs 完整域名）
- [ ] Socket.IO 端口是否被防火墙拦截（3000 需开放或走 Nginx 代理）
- [ ] 跨域（CORS）是否配置正确（开发环境前端跑在 `file://` 或 `localhost:xxxx`）

---
*有问题找我（后盾），API 或 WebSocket 逻辑不清楚的直接问。*
