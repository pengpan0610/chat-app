# ChatNova

一个基于单 HTML 文件的轻量级聊天应用，支持私聊、群聊、图片消息、截图标注和消息审核等功能。

## 功能特性

- **用户登录**：支持管理员和普通用户登录
- **注册账号**：直接注册即可使用（注册记录供管理员查看）
- **私聊**：用户之间一对一聊天
- **群聊**：支持创建群组，仅管理员和白名单用户可创建群
- **权限系统**：管理员（admin）、白名单（whitelist）、普通成员（member）
- **图片消息**：发送图片，支持压缩
- **截图标注**：使用 html2canvas 截图，配合 fabric.js 进行矩形、椭圆、箭头、画笔、文字、马赛克等标注
- **群消息审核**：群主可审核群成员发送的消息
- **数据持久化**：使用 localStorage 存储数据，IndexedDB 存储图片
- **表情支持**：内置表情选择器

## 默认账号

| 账号 | 密码 | 角色 |
|------|------|------|
| `admin` | `admin123` | 管理员 |

## 技术栈

- 前端：原生 HTML / CSS / JavaScript
- 构建工具：Vite（可选，浏览器直接打开 `index.html` 即可运行）
- 绘图：fabric.js
- 截图：html2canvas
- 数据存储：localStorage + IndexedDB

## 快速开始

### 方式一：直接打开

浏览器直接打开项目根目录下的 `index.html` 文件即可使用。

### 方式二：使用 Vite 开发服务器

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

## 项目结构

```
chat-app/
├── index.html      # 主应用文件（聊天界面）
├── admin.html      # 管理员后台
├── login.html      # 登录页面
├── register.html   # 注册页面
├── package.json    # 项目依赖（Vite）
└── .gitignore      # Git 忽略配置
```

## 部署说明

项目可通过 GitHub Actions 自动部署到服务器。部署流程：

1. 推送代码到 `main` 分支
2. GitHub Actions 自动通过 SSH 连接服务器
3. 将最新文件同步到服务器 `/var/www/html/chat-app/` 目录

服务器信息：

- IP：`124.220.2.184`
- 用户：`ubuntu`
- 部署路径：`/var/www/html/chat-app/`

## 注意事项

- 使用 `file://` 协议打开时，localStorage 数据可能无法跨浏览器窗口共享，建议部署到 HTTP 服务器后访问
- 截图、图片标注功能依赖 CDN 加载的 fabric.js 和 html2canvas，网络不稳定时可能降级

## 开发计划

- [x] 登录 / 注册
- [x] 私聊 / 群聊
- [x] 图片消息与群消息审核
- [x] 截图标注工具
- [ ] + 菜单扩展功能（发文件、发位置、语音消息、视频通话）

---

项目地址：https://github.com/pengpan0610/chat-app
