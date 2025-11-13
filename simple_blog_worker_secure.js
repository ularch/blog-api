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
