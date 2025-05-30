import { serveStatic } from 'hono/cloudflare-workers';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/images/', '').replace(/^\/+|\/+$/g, '');
  
  console.log('处理图片请求:', {
    fullUrl: request.url,
    pathname: url.pathname,
    path: path,
    env: {
      hasDB: !!env.DB,
      hasSiteUrl: !!env.SITE_URL
    }
  });

  try {
    // 使用 Cloudflare Workers 的方式获取静态资源
    const assetKey = `public/images/${path}`;
    console.log('尝试获取资源:', assetKey);
    
    const asset = await env.ASSETS.fetch(new URL(assetKey, request.url));
    console.log('资源获取结果:', {
      status: asset.status,
      headers: Object.fromEntries(asset.headers.entries())
    });

    if (asset.status === 200) {
      // 检查内容类型
      const contentType = asset.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        console.error('非图片内容类型:', contentType);
        return new Response('Not Found', { status: 404 });
      }

      // 添加缓存控制头
      const headers = new Headers(asset.headers);
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('Access-Control-Allow-Origin', '*');
      
      return new Response(asset.body, {
        status: 200,
        headers
      });
    }

    // 如果找不到图片，返回 404
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('获取图片失败:', error);
    console.error('错误详情:', {
      message: error.message,
      stack: error.stack
    });
    return new Response('Not Found', { status: 404 });
  }
} 
