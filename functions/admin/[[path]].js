import { Hono } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';

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
  // 排除登录页面
  if (c.req.path === '/admin/login.html') {
    await next();
    return;
  }

  // 检查会话
  const session = c.get('session');
  if (!session || !session.userId) {
    return c.redirect('/admin/login.html');
  }
  await next();
}

// 应用中间件
app.use('*', sessionMiddleware);
app.use('*', checkAdminAccess);

// 处理静态文件
app.get('*', async (c) => {
  const path = c.req.path.replace('/admin/', '');
  return c.redirect(`/admin/${path}`);
});

export default app; 
