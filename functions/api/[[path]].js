import { Hono } from 'hono';

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

// 导出处理函数
export default {
  fetch: api.fetch
}; 
