import { Octokit } from 'octokit';

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
    // 从 GitHub 获取图片
    const octokit = new Octokit({
      auth: env.GITHUB_TOKEN
    });

    const response = await octokit.rest.repos.getContent({
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      path: `images/${path}`,
      ref: 'main'
    });

    if (response.data.type === 'file') {
      const content = response.data.content;
      const contentType = response.data.type === 'file' ? 
        response.data.download_url.split('.').pop().toLowerCase() : 'application/octet-stream';
      
      return new Response(Buffer.from(content, 'base64'), {
        headers: {
          'Content-Type': `image/${contentType}`,
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  } catch (error) {
    console.error('获取图片失败:', error);
    return new Response('Not Found', { status: 404 });
  }
} 
