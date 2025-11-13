// Cloudflare Workers 博客 API
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

      if (pathname === '/api/categories' && method === 'GET') {
        return await getCategories(env.DB, corsHeaders);
      }

      if (pathname.match(/^\/api\/posts\/\d+\/comments$/) && method === 'GET') {
        const postId = pathname.split('/')[3];
        return await getComments(env.DB, postId, corsHeaders);
      }

      if (pathname.match(/^\/api\/posts\/\d+\/comments$/) && method === 'POST') {
        const postId = pathname.split('/')[3];
        return await createComment(env.DB, postId, request, corsHeaders);
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
  const status = searchParams.get('status') || 'published';
  const category = searchParams.get('category');
  const offset = (page - 1) * limit;

  let query = `
    SELECT p.*, GROUP_CONCAT(c.name) as categories
    FROM posts p
    LEFT JOIN post_categories pc ON p.id = pc.post_id
    LEFT JOIN categories c ON pc.category_id = c.id
    WHERE p.status = ?
  `;
  
  const params = [status];
  
  if (category) {
    query += ` AND c.slug = ?`;
    params.push(category);
  }
  
  query += ` GROUP BY p.id ORDER BY p.published_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await db.prepare(query).bind(...params).all();
  
  // 获取总数
  let countQuery = `SELECT COUNT(*) as total FROM posts WHERE status = ?`;
  const countParams = [status];
  
  if (category) {
    countQuery += ` AND id IN (
      SELECT p.id FROM posts p
      JOIN post_categories pc ON p.id = pc.post_id
      JOIN categories c ON pc.category_id = c.id
      WHERE c.slug = ?
    )`;
    countParams.push(category);
  }
  
  const countResult = await db.prepare(countQuery).bind(...countParams).first();
  
  return new Response(JSON.stringify({
    posts: result.results.map(post => ({
      ...post,
      tags: post.tags ? JSON.parse(post.tags) : [],
      categories: post.categories ? post.categories.split(',') : []
    })),
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
    SELECT p.*, GROUP_CONCAT(c.name) as categories
    FROM posts p
    LEFT JOIN post_categories pc ON p.id = pc.post_id
    LEFT JOIN categories c ON pc.category_id = c.id
    WHERE p.id = ?
    GROUP BY p.id
  `).bind(postId).first();

  if (!post) {
    return new Response('Post not found', { status: 404, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    ...post,
    tags: post.tags ? JSON.parse(post.tags) : [],
    categories: post.categories ? post.categories.split(',') : []
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 创建新帖子
async function createPost(db, request, corsHeaders) {
  const data = await request.json();
  const { title, content, author, slug, status = 'draft', excerpt, tags = [], categoryIds = [] } = data;

  // 生成 slug（如果未提供）
  const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const result = await db.prepare(`
    INSERT INTO posts (title, content, author, slug, status, excerpt, tags, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    title, 
    content, 
    author, 
    finalSlug, 
    status, 
    excerpt, 
    JSON.stringify(tags),
    status === 'published' ? new Date().toISOString() : null
  ).run();

  // 添加分类关联
  if (categoryIds.length > 0) {
    for (const categoryId of categoryIds) {
      await db.prepare(`
        INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)
      `).bind(result.meta.last_row_id, categoryId).run();
    }
  }

  return new Response(JSON.stringify({ 
    id: result.meta.last_row_id, 
    message: 'Post created successfully' 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 更新帖子
async function updatePost(db, postId, request, corsHeaders) {
  const data = await request.json();
  const { title, content, status, excerpt, tags, categoryIds } = data;

  let publishedAt = null;
  if (status === 'published') {
    // 检查是否已经发布过
    const existingPost = await db.prepare('SELECT published_at FROM posts WHERE id = ?').bind(postId).first();
    publishedAt = existingPost.published_at || new Date().toISOString();
  }

  await db.prepare(`
    UPDATE posts 
    SET title = ?, content = ?, status = ?, excerpt = ?, tags = ?, 
        updated_at = CURRENT_TIMESTAMP, published_at = ?
    WHERE id = ?
  `).bind(title, content, status, excerpt, JSON.stringify(tags || []), publishedAt, postId).run();

  // 更新分类关联
  if (categoryIds !== undefined) {
    await db.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(postId).run();
    
    for (const categoryId of categoryIds) {
      await db.prepare(`
        INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)
      `).bind(postId, categoryId).run();
    }
  }

  return new Response(JSON.stringify({ message: 'Post updated successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 删除帖子
async function deletePost(db, postId, corsHeaders) {
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
  
  return new Response(JSON.stringify({ message: 'Post deleted successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 获取分类列表
async function getCategories(db, corsHeaders) {
  const result = await db.prepare('SELECT * FROM categories ORDER BY name').all();
  
  return new Response(JSON.stringify(result.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 获取评论
async function getComments(db, postId, corsHeaders) {
  const result = await db.prepare(`
    SELECT * FROM comments 
    WHERE post_id = ? AND status = 'approved'
    ORDER BY created_at ASC
  `).bind(postId).all();

  return new Response(JSON.stringify(result.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 创建评论
async function createComment(db, postId, request, corsHeaders) {
  const data = await request.json();
  const { author_name, author_email, content, parent_id = null } = data;

  const result = await db.prepare(`
    INSERT INTO comments (post_id, author_name, author_email, content, parent_id)
    VALUES (?, ?, ?, ?, ?)
  `).bind(postId, author_name, author_email, content, parent_id).run();

  return new Response(JSON.stringify({ 
    id: result.meta.last_row_id, 
    message: 'Comment created successfully' 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}