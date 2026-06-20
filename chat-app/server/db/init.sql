-- ChatNova 数据库初始化脚本
-- 执行：mysql -u root -p chatnova < init.sql

DROP DATABASE IF EXISTS chatnova;
CREATE DATABASE chatnova CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chatnova;

-- 用户表
CREATE TABLE users (
  id VARCHAR(32) PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','whitelist','member') NOT NULL DEFAULT 'member',
  avatar_emoji VARCHAR(8) DEFAULT '😀',
  created_at BIGINT NOT NULL,
  last_online BIGINT DEFAULT 0,
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认管理员账号（密码：admin123，bcrypt 哈希由后端启动时初始化）
-- 这里只建表，默认数据由 server init 脚本写入

-- 群聊表
CREATE TABLE groups (
  id VARCHAR(32) PRIMARY KEY,
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
  to_user VARCHAR(32) DEFAULT NULL,
  to_group VARCHAR(32) DEFAULT NULL,
  text LONGTEXT NOT NULL,
  msg_type ENUM('text','image','shot','system') NOT NULL DEFAULT 'text',
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
  final_text LONGTEXT,
  status ENUM('pending','approved','rejected','edited') NOT NULL DEFAULT 'pending',
  reviewer_id VARCHAR(32) DEFAULT NULL,
  reviewed_at BIGINT DEFAULT NULL,
  INDEX idx_group_status (group_id, status),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 注册申请表（审计用）
CREATE TABLE reg_requests (
  id VARCHAR(32) PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  requested_at BIGINT NOT NULL,
  status ENUM('approved','rejected') NOT NULL DEFAULT 'approved'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始化默认管理员（密码 admin123 的 bcrypt 哈希，由后端在首次启动时写入）
-- 这里留空，由 Node.js 初始化脚本处理
-- 原因：SQL 文件里不方便存 bcrypt 哈希（每次密码变更都要重新生成）

SHOW TABLES;
