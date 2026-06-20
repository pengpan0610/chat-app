# ChatNova 后端部署指南

> 目标服务器：Ubuntu / 124.220.2.184  
> 部署路径：`/var/www/html/chat-app/server/`

---

## 一、服务器环境准备

### 1.1 安装 Node.js 18+

```bash
# 检查是否已安装
node --version
npm --version

# 未安装则执行：
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node --version   # 应显示 v18.x.x
npm --version
```

### 1.2 安装 MySQL 8

```bash
sudo apt-get update
sudo apt-get install -y mysql-server

# 安全初始化（设置 root 密码）
sudo mysql_secure_installation
# 按提示：设置密码、移除匿名用户、禁止 root 远程登录

# 登录测试
sudo mysql -u root -p
```

### 1.3 创建数据库和用户

```sql
-- 在 mysql shell 中执行
CREATE DATABASE chatnova CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'chatnova'@'localhost' IDENTIFIED BY '你的强密码';

GRANT ALL PRIVILEGES ON chatnova.* TO 'chatnova'@'localhost';

FLUSH PRIVILEGES;

-- 验证
SHOW DATABASES;
SELECT user, host FROM mysql.user;
EXIT;
```

### 1.4 安装 PM2（进程守护）

```bash
sudo npm install -g pm2
pm2 --version
```

---

## 二、上传后端代码

### 2.1 创建服务器目录

```bash
# SSH 登录服务器后执行
sudo mkdir -p /var/www/html/chat-app/server
sudo chown -R $USER:$USER /var/www/html/chat-app
mkdir -p /var/www/html/chat-app/uploads
```

### 2.2 上传文件（从本地）

```powershell
# 本地 PowerShell 执行
# 1. 先打包 server 目录
Compress-Archive -Path "c:\Users\彭盼\WorkBuddy\20260613144341\chat-app\server\*" -DestinationPath "C:\Temp\chatnova-server.zip"

# 2. SCP 上传到服务器
scp "C:\Temp\chatnova-server.zip" ubuntu@124.220.2.184:/tmp/

# 3. SSH 登录服务器解压
ssh ubuntu@124.220.2.184
cd /var/www/html/chat-app/server
unzip /tmp/chatnova-server.zip
```

### 2.3 安装依赖

```bash
cd /var/www/html/chat-app/server
npm install
```

---

## 三、配置环境变量

```bash
cd /var/www/html/chat-app/server
cp .env.example .env
nano .env
```

**.env 配置内容**：

```ini
PORT=3000
JWT_SECRET=你的随机长字符串_至少32位
JWT_EXPIRES=7d
DB_HOST=localhost
DB_PORT=3306
DB_USER=chatnova
DB_PASS=你的MySQL密码
DB_NAME=chatnova
```

**生成 JWT_SECRET**：

```bash
# 在服务器上执行，生成随机 64 位字符串
openssl rand -base64 48
# 把输出复制到 .env 的 JWT_SECRET
```

---

## 四、初始化数据库

```bash
cd /var/www/html/chat-app/server
mysql -u chatnova -p chatnova < db/init.sql
# 输入 chatnova 用户密码

# 验证表是否创建成功
mysql -u chatnova -p chatnova -e "SHOW TABLES;"
```

---

## 五、用 PM2 启动服务

### 5.1 创建 PM2 ecosystem 配置

```bash
cd /var/www/html/chat-app/server
nano ecosystem.config.js
```

**ecosystem.config.js 内容**：

```javascript
module.exports = {
  apps: [{
    name: 'chatnova-api',
    script: 'app.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    // 内存超过 500MB 自动重启（防止内存泄漏）
    max_memory_restart: '500M',
    // 自动重启
    autorestart: true,
    watch: false,
  }]
}
```

### 5.2 启动

```bash
cd /var/www/html/chat-app/server
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs chatnova-api

# 保存到开机自启
pm2 save
pm2 startup   # 按提示执行生成的命令
```

### 5.3 验证服务运行

```bash
# 测试 API 是否通
curl http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"123456"}'

# 应返回 JSON 含 token
```

---

## 六、配置 Nginx 反向代理

### 6.1 备份原配置

```bash
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak
```

### 6.2 写入新配置

```bash
sudo nano /etc/nginx/sites-available/chat-app
```

**把 `server/nginx-conf.example` 的内容复制进去**，注意修改 `server_name` 为 `124.220.2.184`。

### 6.3 启用配置并重启 Nginx

```bash
# 启用配置
sudo ln -sf /etc/nginx/sites-available/chat-app /etc/nginx/sites-enabled/chat-app

# 测试配置
sudo nginx -t

# 重启
sudo systemctl restart nginx

# 验证
sudo systemctl status nginx
```

---

## 七、防火墙配置

```bash
# 检查 UFW 状态
sudo ufw status

# 确保 80（HTTP）和 3000（直接 API 访问，可选）开放
sudo ufw allow 80/tcp
sudo ufw allow 22/tcp   # SSH 务必保留
sudo ufw reload
```

---

## 八、验证完整链路

### 8.1 注册用户

```bash
curl -X POST http://124.220.2.184/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"123456"}'
```

### 8.2 登录获取 Token

```bash
curl -X POST http://124.220.2.184/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"123456"}'
```

### 8.3 用 Token 访问 API

```bash
curl http://124.220.2.184/api/auth/me \
  -H "Authorization: Bearer 上一步返回的token"
```

### 8.4 测试 WebSocket（用浏览器 Console）

```javascript
// 在 http://124.220.2.184/chat-app/ 页面的 console 执行
const socket = io('http://124.220.2.184', {
  auth: { token: '你的JWT' },
  transports: ['websocket']
});
socket.on('connect', () => console.log('WS 连接成功', socket.id));
socket.on('new_message', (msg) => console.log('收到消息', msg));
```

---

## 九、日常运维命令

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs chatnova-api --lines 100

# 重启服务
pm2 restart chatnova-api

# 停止服务
pm2 stop chatnova-api

# 数据库备份（每天定时执行）
mysqldump -u chatnova -p chatnova > /backup/chatnova_$(date +%Y%m%d).sql

# 查看 Node 进程内存占用
pm2 monit
```

---

## 十、常见问题

### Q1：npm install 报错 `node-gyp` 失败
```bash
# 安装构建工具
sudo apt-get install -y build-essential python3
```

### Q2：MySQL 连接报 `ER_ACCESS_DENIED_ERROR`
- 检查 `.env` 的 `DB_PASS` 是否正确
- 检查 MySQL 用户权限：`SHOW GRANTS FOR 'chatnova'@'localhost';`

### Q3：Socket.IO 连不上（Nginx 超时）
- 检查 `proxy_read_timeout` 是否设置为 86400
- 确认 Nginx 配置里 WebSocket `Upgrade` header 正确转发

### Q4：上传图片返回 413（Request Entity Too Large）
- Nginx 配置加 `client_max_body_size 10M;`
- 重启 Nginx：`sudo systemctl restart nginx`

---
*先跑起来，再优化。* — 后盾
