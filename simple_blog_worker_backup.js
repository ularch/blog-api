// 简化的 Cloudflare Workers 博客 API
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS 处理
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
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

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};

// 获取帖子列表
async function getPosts(db, searchParams, corsHeaders) {
  const page = parseInt(searchParams.get('page')) || 1;
  const limit = parseInt(searchParams.get('limit')) || 10;
  const status = searchParams.get('status');

  // 参数验证
  if (page < 1) {
    return new Response(JSON.stringify({ error: 'Page number must be greater than 0' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (limit < 1 || limit > 100) {
    return new Response(JSON.stringify({ error: 'Limit must be between 1 and 100' }), {
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
  const post = await db.prepare(`
    SELECT * FROM posts WHERE id = ?
  `).bind(postId).first();

  if (!post) {
    return new Response('Post not found', { status: 404, headers: corsHeaders });
  }

  return new Response(JSON.stringify(post), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 创建新帖子
async function createPost(db, request, corsHeaders) {
  try {
    const data = await request.json();
    const { title, content, author, slug, status = 'draft', excerpt } = data;

    // 输入验证
    if (!title || !content || !author) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: title, content, author' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 生成 slug（如果未提供）
    const finalSlug = slug || title.toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '');

    // 检查 slug 是否已存在
    const existingPost = await db.prepare('SELECT id FROM posts WHERE slug = ?').bind(finalSlug).first();
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
      finalSlug, 
      status, 
      excerpt, 
      status === 'published' ? new Date().toISOString() : null
    ).run();

    return new Response(JSON.stringify({ 
      id: result.meta.last_row_id, 
      message: 'Post created successfully' 
    }), {
      status: 201, // 修正状态码
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Invalid JSON or request format' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 更新帖子
async function updatePost(db, postId, request, corsHeaders) {
  try {
    // 检查帖子是否存在
    const existingPost = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
    if (!existingPost) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await request.json();
    const { title, content, status, excerpt } = data;

    // 至少需要一个字段来更新
    if (!title && !content && !status && !excerpt) {
      return new Response(JSON.stringify({ 
        error: 'At least one field is required for update' 
      }), {
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

    return new Response(JSON.stringify({ message: 'Post updated successfully' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Invalid JSON or request format' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 删除帖子
async function deletePost(db, postId, corsHeaders) {
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
  
  return new Response(JSON.stringify({ message: 'Post deleted successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}