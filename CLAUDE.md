# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 Cloudflare Workers 和 D1 数据库的博客 API 项目，提供完整的博客内容管理功能，包括文章、分类和评论系统。

## 核心架构

- **blog_worker_api.js**: 主要的 Cloudflare Worker 入口文件，处理所有 API 路由和业务逻辑
- **blog_database.sql**: 数据库架构定义文件，包含 posts、categories、post_categories 和 comments 表
- **blog_config.md**: 部署和配置指南，包含 Cloudflare D1 数据库设置

## 常用开发命令

### 数据库操作
```bash
# 创建 D1 数据库
npx wrangler d1 create blog-db

# 执行数据库架构
npx wrangler d1 execute blog-db --file=./blog_database.sql

# 本地开发时初始化数据库
npx wrangler d1 execute blog-db --file=./blog_database.sql --local

# 生产环境执行数据库迁移
npx wrangler d1 execute blog-db --file=./blog_database.sql --remote
```

### 开发和部署
```bash
# 本地开发模式
npx wrangler dev

# 本地开发使用本地 D1 数据库
npx wrangler dev --local --persist

# 部署到生产环境
npx wrangler deploy
```

### 数据库管理
```bash
# 查看数据库信息
npx wrangler d1 info blog-db

# 执行 SQL 查询
npx wrangler d1 execute blog-db --command="SELECT * FROM posts LIMIT 5"

# 备份数据库
npx wrangler d1 export blog-db --output=backup.sql
```

## API 架构

### 路由设计
- **REST API 结构**: 使用标准的 REST 接口设计
- **路径匹配**: 使用正则表达式匹配动态路由参数
- **CORS 支持**: 内置跨域访问支持

### 数据模型关系
- **posts**: 主要文章表，支持草稿/发布/归档状态
- **categories**: 分类表，通过 post_categories 中间表与文章多对多关联
- **comments**: 评论表，支持嵌套回复结构
- **标签系统**: 以 JSON 格式存储在 posts 表的 tags 字段中

### 关键功能模块
- **内容管理**: 创建、更新、删除文章，支持状态管理和 SEO 字段
- **分类系统**: 灵活的分类管理和文章分类关联
- **评论系统**: 支持嵌套评论和评论审核
- **分页查询**: 支持分页、状态过滤和分类过滤

## 开发要点

### 数据库操作
- 使用 Cloudflare D1 的 `prepare().bind().run()` 模式进行参数化查询
- 注意区分本地和远程数据库环境
- 所有外键关系都设置了级联删除

### Worker 环境变量
- `env.DB`: D1 数据库绑定，在 wrangler.toml 中配置
- 可选环境变量：`ADMIN_SECRET`（管理员密钥）、`ALLOWED_ORIGINS`（CORS 配置）

### API 响应格式
- 统一返回 JSON 格式
- 包含适当的 HTTP 状态码
- 错误处理包含详细错误信息

### 重要配置文件
需要创建 `wrangler.toml` 配置文件：
```toml
name = "blog-api"
compatibility_date = "2024-08-13"

[[d1_databases]]
binding = "DB"
database_name = "blog-db"
database_id = "你的数据库ID"
```