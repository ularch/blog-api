-- 简化的博客数据库架构 - 仅包含帖子表
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
  excerpt TEXT
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);

-- 插入示例数据
INSERT INTO posts (title, content, author, slug, status, published_at, excerpt) VALUES 
('欢迎来到简化博客', '这是一个简化版博客的第一篇文章。我们专注于核心的博客功能。', '管理员', 'welcome-to-simple-blog', 'published', CURRENT_TIMESTAMP, '简化博客的开始'),
('关于 Cloudflare D1', 'Cloudflare D1 是一个基于 SQLite 的边缘数据库服务，非常适合博客应用。', '技术编辑', 'about-cloudflare-d1', 'published', CURRENT_TIMESTAMP, '了解 Cloudflare D1 数据库'),
('博客功能介绍', '这个简化的博客系统包含了基本的文章管理功能。', '管理员', 'blog-features', 'draft', NULL, '博客系统功能说明');