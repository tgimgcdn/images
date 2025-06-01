import { getCookie } from 'hono/cookie';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  console.log('管理后台请求:', path);
  
  // 如果是登录页面，直接返回登录页面
  if (path === '/admin/login.html') {
    console.log('访问登录页面，直接放行');
    return next();
  }
  
  // 检查会话
  const sessionId = getCookie(request, 'session_id');
  let isAuthenticated = false;
  
  if (sessionId && env?.DB) {
    try {
      const session = await env.DB.prepare(
        'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
      ).bind(sessionId).first();
      
      if (session) {
        console.log('用户已登录:', session.username);
        isAuthenticated = true;
      } else {
        console.log('会话无效或已过期');
      }
    } catch (error) {
      console.error('检查会话出错:', error);
    }
  }
  
  // 如果用户未登录，重定向到登录页面
  if (!isAuthenticated) {
    console.log('用户未登录，重定向到登录页面');
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin/login.html'
      }
    });
  }
  
  // 用户已登录，继续处理请求
  console.log('用户已登录，继续处理请求');
  return next();
} 

