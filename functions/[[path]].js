import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { serveStatic } from 'hono/cloudflare-workers';

// 创建主应用实例
const app = new Hono();

// 创建 API 应用实例
const api = new Hono();

// 添加 CORS 头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cookie',
  'Access-Control-Allow-Credentials': 'true'
};

// 确保所有 API 响应都设置正确的 Content-Type
api.use('*', async (c, next) => {
  c.header('Content-Type', 'application/json');
  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.header(key, value);
  });
  await next();
});

// 处理 OPTIONS 请求
api.options('*', (c) => {
  return new Response(null, {
    headers: corsHeaders
  });
});

// API 路由定义
api.get('/settings/guest-upload', async (c) => {
  console.log('Entering /settings/guest-upload handler');
  try {
    if (!c.env?.DB) {
      return c.json({ error: 'Database not configured' }, 500);
    }

    const result = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind('allow_guest_upload')
      .first();
    
    console.log('Guest upload setting:', result);
    
    return c.json({
      success: true,
      data: {
        allowGuestUpload: result?.value === 'true'
      }
    });
  } catch (error) {
    console.error('Error fetching guest upload settings:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch settings'
    }, 500);
  }
});

// 获取所有设置
api.get('/settings', async (c) => {
    try {
        if (!c.env?.DB) {
            return c.json({ error: 'Database not configured' }, 500);
        }

        const settings = await c.env.DB.prepare('SELECT * FROM settings').all();
        const settingsMap = {};
        
        for (const setting of settings.results) {
            settingsMap[setting.key] = setting.value;
        }
        
        return c.json({
            success: true,
            data: settingsMap
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        return c.json({
            success: false,
            error: 'Failed to fetch settings'
        }, 500);
    }
});

// 获取图片列表
api.get('/admin/images', async (c) => {
    try {
        if (!c.env?.DB) {
            return c.json({ error: 'Database not configured' }, 500);
        }

        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '20');
        const offset = (page - 1) * limit;

        const images = await c.env.DB.prepare(`
            SELECT * FROM images 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).bind(limit, offset).all();

        const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM images').first();

        return c.json({
            success: true,
            data: {
                images: images.results,
                pagination: {
                    total: total.count,
                    page,
                    limit,
                    totalPages: Math.ceil(total.count / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching images:', error);
        return c.json({
            success: false,
            error: 'Failed to fetch images'
        }, 500);
    }
});

// 删除图片
api.delete('/admin/images/:id', async (c) => {
    try {
        if (!c.env?.DB) {
            return c.json({ error: 'Database not configured' }, 500);
        }

        const id = c.req.param('id');
        await c.env.DB.prepare('DELETE FROM images WHERE id = ?').bind(id).run();

        return c.json({
            success: true,
            message: 'Image deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting image:', error);
        return c.json({
            success: false,
            error: 'Failed to delete image'
        }, 500);
    }
});

// 健康检查端点
api.get('/health', (c) => {
    return c.json({
        success: true,
        message: 'Service is running',
        database: c.env?.DB ? 'connected' : 'not connected'
    });
});

// 全局错误处理
app.use('*', async (c, next) => {
  try {
    await next();
  } catch (err) {
    console.error('Error:', err);
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Internal Server Error' }, 500);
    }
    throw err;
  }
});

// 请求日志
app.use('*', async (c, next) => {
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}`);
  await next();
});

// 会话管理中间件
async function sessionMiddleware(c, next) {
  const sessionId = getCookie(c, 'session_id');
  
  if (sessionId && c.env?.DB) {
    try {
      const session = await c.env.DB.prepare(
        'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
      ).bind(sessionId).first();
      
      if (session) {
        c.set('session', {
          userId: session.user_id,
          username: session.username
        });
      } else {
        deleteCookie(c, 'session_id');
      }
    } catch (error) {
      console.error('Session error:', error);
      deleteCookie(c, 'session_id');
    }
  }
  await next();
}

// 管理后台访问权限检查
async function checkAdminAccess(c, next) {
  if (c.req.path.startsWith('/admin/') && 
      !c.req.path.includes('/admin/login.html') && 
      !c.req.path.includes('/api/admin/login')) {
    const session = c.get('session');
    if (!session || !session.userId) {
      return c.redirect('/admin/login.html');
    }
  }
  await next();
}

// 游客上传检查
async function checkGuestUpload(c, next) {
  if (c.req.path === '/api/upload' && c.req.method === 'POST' && c.env?.DB) {
    try {
      const setting = await c.env.DB.prepare(
        'SELECT value FROM settings WHERE key = ?'
      ).bind('allow_guest_upload').first();
      
      if (!setting || setting.value !== 'true') {
        const session = await c.get('session');
        if (!session || !session.userId) {
          return c.json({ error: '游客上传已禁用' }, 403);
        }
      }
    } catch (error) {
      console.error('Guest upload check error:', error);
      return c.json({ error: '检查上传权限失败' }, 500);
    }
  }
  await next();
}

// 应用通用中间件
app.use('*', sessionMiddleware);
app.use('*', checkAdminAccess);
app.use('*', checkGuestUpload);

// 先挂载 API 路由
app.route('/api', api);

// 最后处理静态文件
app.use('/*', serveStatic({ root: './public' }));

// 导出处理函数
export const onRequest = app.fetch; 
