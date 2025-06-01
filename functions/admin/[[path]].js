import { Hono } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { serveStatic } from 'hono/cloudflare-workers';

const app = new Hono();

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
  console.log('检查管理后台访问权限:', c.req.path);
  
  // 排除登录页面和登录API
  if (c.req.path === '/admin/login.html' || c.req.path === '/api/admin/login') {
    console.log('登录页面或API，允许访问');
    await next();
    return;
  }
  
  // 检查会话
  const session = c.get('session');
  if (!session || !session.userId) {
    console.log('用户未登录，重定向到登录页面');
    return c.redirect('/admin/login.html');
  }
  
  console.log('用户已登录，允许访问管理后台');
  await next();
}

// 应用中间件
app.use('*', sessionMiddleware);
app.use('*', checkAdminAccess);

// 处理静态文件 - 确保所有请求都正确处理
app.get('*', async (c) => {
  // 这里不需要再进行路径替换和重定向，直接交给静态文件中间件处理
  return serveStatic({ root: './public' })(c);
});

export default app; 
