import { serveStatic } from 'hono/cloudflare-workers';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/images/', '').replace(/^\/+|\/+$/g, '');
  
  console.log('处理图片请求:', {
    fullUrl: request.url,
    pathname: url.pathname,
    path: path
  });

  try {
    // 直接从静态资源目录获取图片
    const response = await serveStatic({
      root: './'
    })(context);

    if (response.status === 200) {
      // 添加缓存控制头
      response.headers.set('Cache-Control', 'public, max-age=31536000');
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    }

    // 如果找不到图片，返回 404
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('获取图片失败:', error);
    return new Response('Not Found', { status: 404 });
  }
} 
