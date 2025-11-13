-- 创建博客帖子表
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  excerpt TEXT,
  tags TEXT, -- JSON 格式存储标签
  meta_title TEXT,
  meta_description TEXT,
  featured_image TEXT
);

-- 创建分类表
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建帖子分类关联表
CREATE TABLE IF NOT EXISTS post_categories (
  post_id INTEGER,
  category_id INTEGER,
  PRIMARY KEY (post_id, category_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- 创建评论表
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  parent_id INTEGER, -- 用于回复评论
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);

-- 插入示例数据
INSERT INTO categories (name, slug, description) VALUES 
('技术', 'tech', '技术相关文章'),
('生活', 'life', '生活随笔'),
('教程', 'tutorial', '教程和指南');

INSERT INTO posts (title, content, author, slug, status, published_at, excerpt, tags) VALUES 
('欢迎来到我的博客', '这是第一篇博客文章的内容...', '管理员', 'welcome-to-my-blog', 'published', CURRENT_TIMESTAMP, '博客开张第一篇', '["欢迎", "博客"]'),
('Cloudflare D1 入门指南', 'Cloudflare D1 是一个基于 SQLite 的边缘数据库...', '技术编辑', 'cloudflare-d1-guide', 'published', CURRENT_TIMESTAMP, 'D1 数据库使用指南', '["cloudflare", "数据库", "教程"]');

INSERT INTO post_categories (post_id, category_id) VALUES 
(1, 2), -- 欢迎文章 -> 生活
(2, 1), -- D1 指南 -> 技术
(2, 3); -- D1 指南 -> 教程

INSERT INTO comments (post_id, author_name, author_email, content, status) VALUES 
(1, '张三', 'zhang@example.com', '很棒的开始！期待更多内容', 'approved'),
(2, '李四', 'li@example.com', '这个教程很实用，谢谢分享', 'approved');