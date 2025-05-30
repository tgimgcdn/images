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

  // 检查是否是导航请求
  const isNavigation = request.headers.get('sec-fetch-mode') === 'navigate';
  if (isNavigation) {
    // 重定向到正确的图片URL
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `/images/${path}`,
        'Cache-Control': 'no-cache'
      }
    });
  }

  try {
    // 构建资源路径
    const assetPath = `public/images/${path}`;
    console.log('请求资源路径:', assetPath);

    // 从 Pages 的静态资源中获取文件
    const assetUrl = new URL(assetPath, request.url);
    const assetRequest = new Request(assetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    const response = await env.ASSETS.fetch(assetRequest);
    
    if (response.status === 200) {
      // 添加缓存控制头
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Content-Type', response.headers.get('Content-Type') || 'image/jpeg');
      
      return new Response(response.body, {
        status: 200,
        headers
      });
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('获取图片失败:', error);
    return new Response('Not Found', { status: 404 });
  }
} 
