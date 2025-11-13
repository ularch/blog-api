# Cloudflare D1 博客数据库部署指南

## 1. 创建 D1 数据库

```bash
# 登录 Cloudflare
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create blog-db

# 记录数据库 ID，将在 wrangler.toml 中使用
```

## 2. 配置文件 (wrangler.toml)

```toml
name = "blog-api"
compatibility_date = "2024-08-13"

[[d1_databases]]
binding = "DB"
database_name = "blog-db"
database_id = "你的数据库ID"  # 从创建命令中获取
```

## 3. 初始化数据库

```bash
# 执行 SQL 架构文件
npx wrangler d1 execute blog-db --file=./schema.sql

# 或者直接执行命令
npx wrangler d1 execute blog-db --command="CREATE TABLE IF NOT EXISTS posts (...)"
```

## 4. 本地开发

```bash
# 本地开发模式
npx wrangler dev

# 本地开发时使用本地 D1 数据库
npx wrangler dev --local --persist
```

## 5. 部署到生产环境

```bash
# 部署 Worker
npx wrangler deploy

# 在生产环境执行数据库迁移
npx wrangler d1 execute blog-db --file=./schema.sql --remote
```

## 6. API 端点

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/posts` | 获取帖子列表 |
| GET | `/api/posts/:id` | 获取单个帖子 |
| POST | `/api/posts` | 创建新帖子 |
| PUT | `/api/posts/:id` | 更新帖子 |
| DELETE | `/api/posts/:id` | 删除帖子 |
| GET | `/api/categories` | 获取分类列表 |
| GET | `/api/posts/:id/comments` | 获取帖子评论 |
| POST | `/api/posts/:id/comments` | 创建评论 |

## 7. 查询参数

**GET /api/posts**
- `page`: 页码 (默认 1)
- `limit`: 每页数量 (默认 10)
- `status`: 帖子状态 (published/draft/archived)
- `category`: 分类 slug

## 8. 示例请求

### 创建帖子
```javascript
const response = await fetch('/api/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '新博客文章',
    content: '文章内容...',
    author: '作者名称',
    slug: 'new-blog-post',
    status: 'published',
    excerpt: '文章摘要',
    tags: ['标签1', '标签2'],
    categoryIds: [1, 2]
  })
});
```

### 获取帖子
```javascript
const response = await fetch('/api/posts?page=1&limit=5&category=tech');
const data = await response.json();
```

## 9. 数据库管理

```bash
# 查看数据库信息
npx wrangler d1 info blog-db

# 执行 SQL 查询
npx wrangler d1 execute blog-db --command="SELECT * FROM posts LIMIT 5"

# 备份数据库
npx wrangler d1 export blog-db --output=backup.sql
```

## 10. 环境变量

在 Cloudflare Dashboard 中设置：
- `ADMIN_SECRET`: 管理员密钥（可选）
- `ALLOWED_ORIGINS`: 允许的域名（CORS）

这个设计提供了完整的博客功能，包括帖子管理、分类、评论系统，并充分利用了 Cloudflare D1 的边缘计算优势。