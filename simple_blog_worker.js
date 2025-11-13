// 安全加固版 Cloudflare Workers 博客 API
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // 安全的 CORS 配置
    const allowedOrigins = [
      'https://huaman-lou.top',
      'https://api.huaman-lou.top', 
      'https://simple-blog-api.gudaobaiyun12.workers.dev',
      'http://localhost:8787' // 仅开发环境
    ];

    const origin = request.headers.get('Origin');
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 身份验证 (对写操作)
      if (['POST', 'PUT', 'DELETE'].includes(method)) {
        const authError = await authenticateRequest(request, env);
        if (authError) {
          return authError;
        }
      }

      // 速率限制检查
      const rateLimitError = await checkRateLimit(request, env);
      if (rateLimitError) {
        return rateLimitError;
      }

      // 路由处理
      if (pathname === '/api/posts' && method === 'GET') {
        return await getPosts(env.DB, url.searchParams, corsHeaders);
      }
      
      if (pathname.match(/^\/api\/posts\/\d+$/) && method === 'GET') {
        const postId = pathname.split('/').pop();
        return await getPost(env.DB, postId, corsHeaders);
      }
      
      if (pathname === '/api/posts' && method === 'POST') {
        return await createPost(env.DB, request, corsHeaders);
      }
      
      if (pathname.match(/^\/api\/posts\/\d+$/) && method === 'PUT') {
        const postId = pathname.split('/').pop();
        return await updatePost(env.DB, postId, request, corsHeaders);
      }
      
      if (pathname.match(/^\/api\/posts\/\d+$/) && method === 'DELETE') {
        const postId = pathname.split('/').pop();
        return await deletePost(env.DB, postId, corsHeaders);
      }

      // 健康检查端点
      if (pathname === '/api/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy', 
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 网页界面路由
      if (pathname === '/' || pathname === '/index.html') {
        return await getPublicBlogPage(corsHeaders);
      }
      
      if (pathname === '/admin' || pathname === '/admin.html') {
        return await getAdminBlogPage(corsHeaders);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('API Error:', error);
      
      // 不暴露详细错误信息
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        requestId: generateRequestId()
      }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// 身份验证函数
async function authenticateRequest(request, env) {
  const apiKey = request.headers.get('X-API-Key');
  
  // 从环境变量获取API密钥
  const validApiKey = env.API_SECRET || 'undefined'; // 生产环境应该设置 env.API_SECRET
  
  if (!apiKey) {
    return new Response(JSON.stringify({ 
      error: 'API key required',
      message: 'Please provide X-API-Key header for write operations'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (apiKey !== validApiKey) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return null; // 验证通过
}

// 简单的速率限制 (基于内存，重启后重置)
const requestCounts = new Map();

async function checkRateLimit(request, env) {
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1分钟窗口
  const maxRequests = 60; // 每分钟最多60个请求
  
  // 清理过期记录
  for (const [ip, data] of requestCounts.entries()) {
    if (now - data.firstRequest > windowMs) {
      requestCounts.delete(ip);
    }
  }
  
  // 检查当前IP的请求数
  const ipData = requestCounts.get(clientIP) || { count: 0, firstRequest: now };
  
  if (now - ipData.firstRequest > windowMs) {
    // 重置窗口
    ipData.count = 1;
    ipData.firstRequest = now;
  } else {
    ipData.count++;
  }
  
  requestCounts.set(clientIP, ipData);
  
  if (ipData.count > maxRequests) {
    return new Response(JSON.stringify({ 
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((windowMs - (now - ipData.firstRequest)) / 1000)
    }), {
      status: 429,
      headers: { 
        'Content-Type': 'application/json',
        'Retry-After': '60'
      }
    });
  }
  
  return null;
}

// 输入清理函数
function sanitizeInput(input, maxLength = 10000) {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // 移除script标签
    .replace(/<[^>]*>/g, '') // 移除其他HTML标签
    .substring(0, maxLength)
    .trim();
}

// 验证slug格式
function isValidSlug(slug) {
  return /^[a-z0-9-]{1,100}$/.test(slug);
}

// 生成请求ID
function generateRequestId() {
  return Math.random().toString(36).substring(2, 15);
}

// 获取帖子列表
async function getPosts(db, searchParams, corsHeaders) {
  const page = parseInt(searchParams.get('page')) || 1;
  const limit = parseInt(searchParams.get('limit')) || 10;
  const status = searchParams.get('status');

  // 参数验证
  if (page < 1 || page > 1000) {
    return new Response(JSON.stringify({ error: 'Invalid page number (1-1000)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (limit < 1 || limit > 100) {
    return new Response(JSON.stringify({ error: 'Invalid limit (1-100)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 验证status参数
  if (status && !['published', 'draft', 'archived'].includes(status)) {
    return new Response(JSON.stringify({ error: 'Invalid status' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const offset = (page - 1) * limit;

  let query, countQuery;
  let queryParams, countParams;

  if (status) {
    query = `
      SELECT * FROM posts 
      WHERE status = ? 
      ORDER BY published_at DESC, created_at DESC 
      LIMIT ? OFFSET ?
    `;
    countQuery = `SELECT COUNT(*) as total FROM posts WHERE status = ?`;
    queryParams = [status, limit, offset];
    countParams = [status];
  } else {
    query = `
      SELECT * FROM posts 
      ORDER BY published_at DESC, created_at DESC 
      LIMIT ? OFFSET ?
    `;
    countQuery = `SELECT COUNT(*) as total FROM posts`;
    queryParams = [limit, offset];
    countParams = [];
  }

  const result = await db.prepare(query).bind(...queryParams).all();
  const countResult = await db.prepare(countQuery).bind(...countParams).first();
  
  return new Response(JSON.stringify({
    posts: result.results,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit)
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 获取单个帖子
async function getPost(db, postId, corsHeaders) {
  // 验证postId是数字
  if (!/^\d+$/.test(postId)) {
    return new Response(JSON.stringify({ error: 'Invalid post ID' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const post = await db.prepare(`
    SELECT * FROM posts WHERE id = ?
  `).bind(postId).first();

  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { 
      status: 404, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify(post), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 创建新帖子
async function createPost(db, request, corsHeaders) {
  try {
    const data = await request.json();
    let { title, content, author, slug, status = 'draft', excerpt } = data;

    // 输入验证和清理
    if (!title || !content || !author) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: title, content, author' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 清理输入
    title = sanitizeInput(title, 200);
    content = sanitizeInput(content, 50000);
    author = sanitizeInput(author, 100);
    excerpt = excerpt ? sanitizeInput(excerpt, 500) : null;

    // 生成或验证 slug
    if (slug) {
      slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    } else {
      slug = title.toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    if (!isValidSlug(slug)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid slug format' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 验证status
    if (!['draft', 'published', 'archived'].includes(status)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid status' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 检查 slug 是否已存在
    const existingPost = await db.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first();
    if (existingPost) {
      return new Response(JSON.stringify({ 
        error: 'Slug already exists' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await db.prepare(`
      INSERT INTO posts (title, content, author, slug, status, excerpt, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      title, 
      content, 
      author, 
      slug, 
      status, 
      excerpt, 
      status === 'published' ? new Date().toISOString() : null
    ).run();

    return new Response(JSON.stringify({ 
      id: result.meta.last_row_id, 
      message: 'Post created successfully',
      slug: slug
    }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Invalid request format',
      details: 'Please check your JSON syntax'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 更新帖子
async function updatePost(db, postId, request, corsHeaders) {
  try {
    // 验证postId
    if (!/^\d+$/.test(postId)) {
      return new Response(JSON.stringify({ error: 'Invalid post ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 检查帖子是否存在
    const existingPost = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
    if (!existingPost) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await request.json();
    let { title, content, status, excerpt } = data;

    // 至少需要一个字段来更新
    if (!title && !content && !status && excerpt === undefined) {
      return new Response(JSON.stringify({ 
        error: 'At least one field is required for update' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 清理和验证输入
    if (title) title = sanitizeInput(title, 200);
    if (content) content = sanitizeInput(content, 50000);
    if (excerpt !== undefined) excerpt = excerpt ? sanitizeInput(excerpt, 500) : null;
    if (status && !['draft', 'published', 'archived'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 使用现有值作为默认值
    const finalTitle = title || existingPost.title;
    const finalContent = content || existingPost.content;
    const finalStatus = status || existingPost.status;
    const finalExcerpt = excerpt !== undefined ? excerpt : existingPost.excerpt;

    let publishedAt = existingPost.published_at;
    if (finalStatus === 'published' && !publishedAt) {
      publishedAt = new Date().toISOString();
    }

    const result = await db.prepare(`
      UPDATE posts 
      SET title = ?, content = ?, status = ?, excerpt = ?, 
          updated_at = CURRENT_TIMESTAMP, published_at = ?
      WHERE id = ?
    `).bind(finalTitle, finalContent, finalStatus, finalExcerpt, publishedAt, postId).run();

    if (result.changes === 0) {
      return new Response(JSON.stringify({ error: 'No changes made' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      message: 'Post updated successfully',
      updated: result.changes
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Invalid request format',
      details: 'Please check your JSON syntax'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 删除帖子
async function deletePost(db, postId, corsHeaders) {
  // 验证postId
  if (!/^\d+$/.test(postId)) {
    return new Response(JSON.stringify({ error: 'Invalid post ID' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 检查帖子是否存在
  const existingPost = await db.prepare('SELECT id FROM posts WHERE id = ?').bind(postId).first();
  if (!existingPost) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const result = await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
  
  if (result.changes === 0) {
    return new Response(JSON.stringify({ error: 'Failed to delete post' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ 
    message: 'Post deleted successfully',
    deletedId: postId
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 公开博客页面
async function getPublicBlogPage(corsHeaders) {
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>技术博客 - 分享与学习</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
            padding: 40px 0;
        }

        .header h1 {
            font-size: 3em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.2em;
            opacity: 0.9;
            margin-bottom: 20px;
        }

        .stats {
            color: white;
            opacity: 0.8;
            font-size: 0.95em;
        }

        .filters {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filters label {
            font-weight: 500;
            color: #555;
        }

        select, button {
            padding: 8px 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background: white;
            color: #333;
            cursor: pointer;
            transition: all 0.3s;
        }

        button {
            background: #667eea;
            color: white;
            border: none;
        }

        button:hover {
            background: #5a6fd8;
            transform: translateY(-1px);
        }

        .posts-container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .post {
            padding: 30px;
            border-bottom: 1px solid #eee;
            transition: background 0.3s;
        }

        .post:hover {
            background: #f8f9ff;
        }

        .post:last-child {
            border-bottom: none;
        }

        .post-title {
            color: #333;
            font-size: 1.8em;
            margin-bottom: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: color 0.3s;
        }

        .post-title:hover {
            color: #667eea;
        }

        .post-meta {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 15px;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        .post-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .post-content {
            margin-bottom: 15px;
            line-height: 1.7;
            color: #555;
        }

        .post-excerpt {
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f2ff 100%);
            padding: 15px;
            border-left: 4px solid #667eea;
            font-style: italic;
            color: #555;
            border-radius: 0 5px 5px 0;
        }

        .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 0.8em;
            font-weight: 500;
        }

        .status-published {
            background: #d4edda;
            color: #155724;
        }

        .status-draft {
            background: #fff3cd;
            color: #856404;
        }

        .loading {
            text-align: center;
            padding: 60px;
            font-size: 1.1em;
            color: #666;
        }

        .footer {
            text-align: center;
            color: white;
            opacity: 0.8;
            margin-top: 40px;
            padding: 20px 0;
        }

        .admin-link {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            text-decoration: none;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
            transition: all 0.3s;
        }

        .admin-link:hover {
            background: #5a6fd8;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }

        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .filters {
                flex-direction: column;
                align-items: stretch;
            }
            
            .post {
                padding: 20px;
            }
            
            .post-meta {
                flex-direction: column;
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 技术博客</h1>
            <p>分享技术知识，探索创新思维</p>
            <div class="stats">
                <span id="blogStats">由 Cloudflare D1 驱动</span>
            </div>
        </div>

        <div class="filters">
            <label>📂 文章筛选：</label>
            <select id="statusFilter" onchange="filterPosts()">
                <option value="">全部文章</option>
                <option value="published">已发布</option>
                <option value="draft">草稿</option>
            </select>
            
            <label>📄 每页显示：</label>
            <select id="limitSelect" onchange="loadPosts()">
                <option value="5">5篇</option>
                <option value="10" selected>10篇</option>
                <option value="20">20篇</option>
            </select>
            
            <button onclick="loadPosts()">🔄 刷新</button>
        </div>

        <div class="posts-container" id="postsContainer">
            <div class="loading">📖 正在加载精彩内容...</div>
        </div>

        <div class="footer">
            <p>⚡ 本博客使用 Cloudflare Workers + D1 数据库构建</p>
            <p>🌍 全球边缘计算，毫秒级响应</p>
        </div>
    </div>

    <a href="/admin" class="admin-link">🔧 管理</a>

    <script>
        const API_BASE = location.origin + '/api';
        let currentPage = 1;

        document.addEventListener('DOMContentLoaded', function() {
            loadPosts();
        });

        async function loadPosts(page = 1) {
            const container = document.getElementById('postsContainer');
            const limit = document.getElementById('limitSelect').value;
            const status = document.getElementById('statusFilter').value;
            
            container.innerHTML = '<div class="loading">📖 正在加载精彩内容...</div>';
            
            try {
                let url = \`\${API_BASE}/posts?page=\${page}&limit=\${limit}\`;
                if (status) {
                    url += \`&status=\${status}\`;
                }
                
                const response = await fetch(url);
                const data = await response.json();
                
                currentPage = page;
                displayPosts(data.posts, data.pagination);
                updateStats(data.pagination);
            } catch (error) {
                container.innerHTML = \`<div class="loading">❌ 加载失败: \${error.message}</div>\`;
            }
        }

        function displayPosts(posts, pagination) {
            const container = document.getElementById('postsContainer');
            
            if (!posts || posts.length === 0) {
                container.innerHTML = '<div class="loading">📝 暂无文章内容</div>';
                return;
            }

            let html = '';
            posts.forEach((post, index) => {
                const statusClass = \`status-\${post.status}\`;
                const shortContent = post.content.length > 200 ? 
                    post.content.substring(0, 200) + '...' : post.content;
                
                html += \`
                    <div class="post">
                        <h2 class="post-title">\${post.title}</h2>
                        <div class="post-meta">
                            <span>👤 \${post.author}</span>
                            <span>📅 \${new Date(post.created_at).toLocaleDateString('zh-CN')}</span>
                            <span class="status-badge \${statusClass}">
                                \${post.status === 'published' ? '✅ 已发布' : '📝 草稿'}
                            </span>
                        </div>
                        <div class="post-content">\${shortContent}</div>
                        \${post.excerpt ? \`<div class="post-excerpt">💡 \${post.excerpt}</div>\` : ''}
                    </div>
                \`;
            });

            if (pagination && pagination.totalPages > 1) {
                html += \`
                    <div style="text-align: center; padding: 20px; background: #f8f9ff;">
                        \${pagination.page > 1 ? \`<button onclick="loadPosts(\${pagination.page - 1})">⬅️ 上一页</button>\` : ''}
                        <span style="margin: 0 15px;">第 \${pagination.page} 页 / 共 \${pagination.totalPages} 页</span>
                        \${pagination.page < pagination.totalPages ? \`<button onclick="loadPosts(\${pagination.page + 1})">下一页 ➡️</button>\` : ''}
                    </div>
                \`;
            }

            container.innerHTML = html;
        }

        function updateStats(pagination) {
            const statsElement = document.getElementById('blogStats');
            if (pagination) {
                statsElement.innerHTML = \`📊 共 \${pagination.total} 篇文章 | 由 Cloudflare D1 驱动\`;
            }
        }

        function filterPosts() {
            loadPosts(1);
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

// 管理界面页面
async function getAdminBlogPage(corsHeaders) {
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>博客管理 - 后台管理系统</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .controls {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }

        .controls h3 {
            margin-bottom: 15px;
            color: #555;
        }

        .controls div {
            margin-bottom: 10px;
        }

        button {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-right: 10px;
            margin-bottom: 10px;
            transition: background 0.3s;
        }

        button:hover {
            background: #5a6fd8;
        }

        input, select, textarea {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 5px;
            margin-right: 10px;
            width: 100%;
            font-family: inherit;
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }

        .form-group textarea {
            height: 120px;
            resize: vertical;
        }

        .create-form {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: none;
        }

        .create-form.show {
            display: block;
        }

        .edit-form {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: none;
        }

        .edit-form.show {
            display: block;
        }

        .posts-container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .post {
            padding: 30px;
            border-bottom: 1px solid #eee;
            transition: background 0.3s;
        }

        .post:hover {
            background: #f8f9ff;
        }

        .post:last-child {
            border-bottom: none;
        }

        .post-title {
            color: #333;
            font-size: 1.8em;
            margin-bottom: 10px;
            font-weight: 600;
        }

        .post-meta {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 15px;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: 500;
        }

        .status-published {
            background: #d4edda;
            color: #155724;
        }

        .status-draft {
            background: #fff3cd;
            color: #856404;
        }

        .status-archived {
            background: #f8d7da;
            color: #721c24;
        }

        .loading {
            text-align: center;
            padding: 40px;
            font-size: 1.1em;
            color: #666;
        }

        .api-key-notice {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            color: #856404;
        }

        .back-link {
            color: white;
            text-decoration: none;
            display: inline-block;
            margin-bottom: 20px;
            padding: 8px 15px;
            background: rgba(255,255,255,0.2);
            border-radius: 5px;
            transition: all 0.3s;
        }

        .back-link:hover {
            background: rgba(255,255,255,0.3);
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">⬅️ 返回博客首页</a>
        
        <div class="header">
            <h1>🛠️ 博客管理系统</h1>
            <p>管理你的博客内容</p>
        </div>

        <div class="api-key-section">
            <h3>🔑 API密钥设置</h3>
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 20px;">
                <input type="password" id="apiKeyInput" placeholder="请输入你的API密钥" style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                <button onclick="saveApiKey()" style="background: #28a745; padding: 10px 20px;">💾 保存密钥</button>
                <button onclick="clearApiKey()" style="background: #6c757d; padding: 10px 20px;">🗑️ 清除密钥</button>
            </div>
            <div id="apiKeyStatus" style="padding: 10px; border-radius: 5px; margin-bottom: 20px; display: none;"></div>
        </div>

        <div class="controls">
            <h3>📚 博客管理</h3>
            <div>
                <button onclick="loadPosts()">🔄 刷新文章</button>
                <button onclick="toggleCreateForm()">✏️ 写新文章</button>
                <input type="number" id="postId" placeholder="文章ID" min="1" style="width: 100px;">
                <button onclick="loadSinglePost()">🔍 查看指定文章</button>
            </div>
        </div>

        <div class="create-form" id="createForm">
            <h3>✏️ 创建新文章</h3>
            <form onsubmit="createPost(event)">
                <div class="form-group">
                    <label>文章标题</label>
                    <input type="text" id="newTitle" required>
                </div>
                <div class="form-group">
                    <label>作者</label>
                    <input type="text" id="newAuthor" required>
                </div>
                <div class="form-group">
                    <label>URL标识 (slug)</label>
                    <input type="text" id="newSlug" required>
                </div>
                <div class="form-group">
                    <label>文章内容</label>
                    <textarea id="newContent" required></textarea>
                </div>
                <div class="form-group">
                    <label>文章摘要</label>
                    <input type="text" id="newExcerpt">
                </div>
                <div class="form-group">
                    <label>状态</label>
                    <select id="newStatus">
                        <option value="draft">草稿</option>
                        <option value="published">发布</option>
                        <option value="archived">归档</option>
                    </select>
                </div>
                <button type="submit">📝 创建文章</button>
                <button type="button" onclick="toggleCreateForm()">❌ 取消</button>
            </form>
        </div>

        <div class="edit-form" id="editForm" style="display: none;">
            <h3>✏️ 编辑文章</h3>
            <form onsubmit="updatePost(event)">
                <input type="hidden" id="editPostId">
                <div class="form-group">
                    <label>文章标题</label>
                    <input type="text" id="editTitle" required>
                </div>
                <div class="form-group">
                    <label>作者</label>
                    <input type="text" id="editAuthor" required>
                </div>
                <div class="form-group">
                    <label>URL标识 (slug)</label>
                    <input type="text" id="editSlug" required>
                </div>
                <div class="form-group">
                    <label>文章内容</label>
                    <textarea id="editContent" required></textarea>
                </div>
                <div class="form-group">
                    <label>文章摘要</label>
                    <input type="text" id="editExcerpt">
                </div>
                <div class="form-group">
                    <label>状态</label>
                    <select id="editStatus">
                        <option value="draft">草稿</option>
                        <option value="published">发布</option>
                        <option value="archived">归档</option>
                    </select>
                </div>
                <button type="submit">💾 保存修改</button>
                <button type="button" onclick="toggleEditForm()">❌ 取消</button>
            </form>
        </div>

        <div class="posts-container" id="postsContainer">
            <div class="loading">📖 正在加载博客文章...</div>
        </div>
    </div>

    <script>
        const API_BASE = location.origin + '/api';
        let currentPage = 1;

        document.addEventListener('DOMContentLoaded', function() {
            loadPosts();
            loadSavedApiKey();
        });

        async function loadPosts() {
            const container = document.getElementById('postsContainer');
            container.innerHTML = '<div class="loading">📖 正在加载博客文章...</div>';
            
            try {
                const response = await fetch(\`\${API_BASE}/posts\`);
                const data = await response.json();
                displayPosts(data.posts);
            } catch (error) {
                container.innerHTML = \`<div class="loading">❌ 加载失败: \${error.message}</div>\`;
            }
        }

        function displayPosts(posts) {
            const container = document.getElementById('postsContainer');
            
            if (!posts || posts.length === 0) {
                container.innerHTML = '<div class="loading">📝 暂无文章，开始创建你的第一篇文章吧！</div>';
                return;
            }

            let html = '';
            posts.forEach(post => {
                const statusClass = \`status-\${post.status}\`;
                html += \`
                    <div class="post">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                            <h2 class="post-title" style="margin: 0; flex: 1;">\${post.title}</h2>
                            <div style="display: flex; gap: 10px;">
                                <button onclick="editPost(\${post.id})" style="background: #28a745; padding: 8px 15px; font-size: 0.9em;">✏️ 编辑</button>
                                <button onclick="deletePost(\${post.id})" style="background: #dc3545; padding: 8px 15px; font-size: 0.9em;">🗑️ 删除</button>
                            </div>
                        </div>
                        <div class="post-meta">
                            <span>👤 \${post.author}</span>
                            <span>🆔 ID: \${post.id}</span>
                            <span>📅 \${new Date(post.created_at).toLocaleDateString('zh-CN')}</span>
                            <span class="status-badge \${statusClass}">
                                \${post.status === 'published' ? '✅ 已发布' : 
                                  post.status === 'draft' ? '📝 草稿' : '📦 已归档'}
                            </span>
                        </div>
                        <div style="margin-bottom: 15px; line-height: 1.7;">\${post.content}</div>
                        \${post.excerpt ? \`<div style="background: #f0f4ff; padding: 15px; border-left: 4px solid #667eea; font-style: italic;">💡 \${post.excerpt}</div>\` : ''}
                    </div>
                \`;
            });

            container.innerHTML = html;
        }

        function toggleCreateForm() {
            const form = document.getElementById('createForm');
            form.classList.toggle('show');
            if (form.classList.contains('show')) {
                document.getElementById('newTitle').focus();
            }
        }

        async function createPost(event) {
            event.preventDefault();
            
            const title = document.getElementById('newTitle').value;
            const author = document.getElementById('newAuthor').value;
            const slug = document.getElementById('newSlug').value;
            const content = document.getElementById('newContent').value;
            const excerpt = document.getElementById('newExcerpt').value;
            const status = document.getElementById('newStatus').value;

            const apiKey = getApiKey();
            if (!apiKey) {
                alert('❌ 请先设置API密钥！');
                return;
            }

            try {
                const response = await fetch(\`\${API_BASE}/posts\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify({
                        title,
                        author,
                        slug,
                        content,
                        excerpt,
                        status
                    })
                });

                const result = await response.json();
                
                if (response.ok) {
                    alert('✅ 文章创建成功！');
                    toggleCreateForm();
                    event.target.reset();
                    loadPosts();
                } else {
                    alert(\`❌ 创建失败: \${result.error}\`);
                }
            } catch (error) {
                alert(\`❌ 创建失败: \${error.message}\`);
            }
        }

        async function loadSinglePost() {
            const postId = document.getElementById('postId').value;
            if (!postId) {
                alert('请输入文章ID');
                return;
            }

            const container = document.getElementById('postsContainer');
            container.innerHTML = '<div class="loading">🔍 正在查找文章...</div>';

            try {
                const response = await fetch(\`\${API_BASE}/posts/\${postId}\`);
                if (!response.ok) {
                    throw new Error('文章不存在');
                }
                const post = await response.json();
                displayPosts([post]);
            } catch (error) {
                container.innerHTML = \`<div class="loading">❌ 查找失败: \${error.message}</div>\`;
            }
        }

        function toggleEditForm() {
            const form = document.getElementById('editForm');
            form.classList.toggle('show');
            if (!form.classList.contains('show')) {
                form.style.display = 'none';
            } else {
                form.style.display = 'block';
            }
        }

        async function editPost(postId) {
            try {
                const response = await fetch(\`\${API_BASE}/posts/\${postId}\`);
                if (!response.ok) {
                    throw new Error('文章不存在');
                }
                const post = await response.json();
                
                // 填充编辑表单
                document.getElementById('editPostId').value = post.id;
                document.getElementById('editTitle').value = post.title;
                document.getElementById('editAuthor').value = post.author;
                document.getElementById('editSlug').value = post.slug;
                document.getElementById('editContent').value = post.content;
                document.getElementById('editExcerpt').value = post.excerpt || '';
                document.getElementById('editStatus').value = post.status;
                
                // 显示编辑表单
                toggleEditForm();
                document.getElementById('editTitle').focus();
            } catch (error) {
                alert(\`❌ 加载文章失败: \${error.message}\`);
            }
        }

        async function updatePost(event) {
            event.preventDefault();
            
            const postId = document.getElementById('editPostId').value;
            const title = document.getElementById('editTitle').value;
            const author = document.getElementById('editAuthor').value;
            const slug = document.getElementById('editSlug').value;
            const content = document.getElementById('editContent').value;
            const excerpt = document.getElementById('editExcerpt').value;
            const status = document.getElementById('editStatus').value;

            const apiKey = getApiKey();
            if (!apiKey) {
                alert('❌ 请先设置API密钥！');
                return;
            }

            try {
                const response = await fetch(\`\${API_BASE}/posts/\${postId}\`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify({
                        title,
                        author,
                        slug,
                        content,
                        excerpt,
                        status
                    })
                });

                const result = await response.json();
                
                if (response.ok) {
                    alert('✅ 文章更新成功！');
                    toggleEditForm();
                    loadPosts();
                } else {
                    alert(\`❌ 更新失败: \${result.error}\`);
                }
            } catch (error) {
                alert(\`❌ 更新失败: \${error.message}\`);
            }
        }

        async function deletePost(postId) {
            if (!confirm(\`⚠️ 确定要删除文章 ID \${postId} 吗？\n\n此操作不可恢复！\`)) {
                return;
            }

            const apiKey = getApiKey();
            if (!apiKey) {
                alert('❌ 请先设置API密钥！');
                return;
            }

            try {
                const response = await fetch(\`\${API_BASE}/posts/\${postId}\`, {
                    method: 'DELETE',
                    headers: {
                        'X-API-Key': apiKey
                    }
                });

                const result = await response.json();
                
                if (response.ok) {
                    alert('✅ 文章删除成功！');
                    loadPosts();
                } else {
                    alert(\`❌ 删除失败: \${result.error}\`);
                }
            } catch (error) {
                alert(\`❌ 删除失败: \${error.message}\`);
            }
        }

        // API密钥管理函数
        function saveApiKey() {
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            if (!apiKey) {
                showApiKeyStatus('❌ 请输入API密钥', 'error');
                return;
            }
            
            // 保存到localStorage
            localStorage.setItem('blogApiKey', apiKey);
            showApiKeyStatus('✅ API密钥已保存到浏览器', 'success');
            
            // 清空输入框
            document.getElementById('apiKeyInput').value = '';
        }

        function clearApiKey() {
            localStorage.removeItem('blogApiKey');
            showApiKeyStatus('🗑️ API密钥已清除', 'info');
            document.getElementById('apiKeyInput').value = '';
        }

        function loadSavedApiKey() {
            const savedKey = localStorage.getItem('blogApiKey');
            if (savedKey) {
                showApiKeyStatus('🔑 已加载保存的API密钥', 'success');
            }
        }

        function getApiKey() {
            return localStorage.getItem('blogApiKey');
        }

        function showApiKeyStatus(message, type) {
            const statusDiv = document.getElementById('apiKeyStatus');
            statusDiv.textContent = message;
            statusDiv.style.display = 'block';
            
            // 根据类型设置样式
            statusDiv.style.background = type === 'success' ? '#d4edda' : 
                                       type === 'error' ? '#f8d7da' : '#d1ecf1';
            statusDiv.style.color = type === 'success' ? '#155724' : 
                                   type === 'error' ? '#721c24' : '#0c5460';
            statusDiv.style.border = \`1px solid \${type === 'success' ? '#c3e6cb' : 
                                               type === 'error' ? '#f5c6cb' : '#bee5eb'}\`;
            
            // 3秒后自动隐藏
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
