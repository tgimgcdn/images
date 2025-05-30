import { Octokit } from 'octokit';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // 添加 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cookie',
    'Access-Control-Allow-Credentials': 'true'
  };

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  // 记录请求信息
  console.log('接收到请求:', {
    path: path,
    method: request.method,
    url: request.url,
    hasDB: !!env.DB
  });

  try {
    // 处理文件上传
    if (path === 'upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
          return new Response(JSON.stringify({ error: '未找到文件' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 初始化 Octokit
        const octokit = new Octokit({
          auth: env.GITHUB_TOKEN
        });

        // 上传到 GitHub
        const buffer = await file.arrayBuffer();
        const content = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        
        const response = await octokit.rest.repos.createOrUpdateFileContents({
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          path: `images/${file.name}`,
          message: `Upload ${file.name}`,
          content: content,
          branch: 'main'
        });

        // 保存到数据库
        await env.DB.prepare(`
          INSERT INTO images (filename, size, mime_type, github_path, sha)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          file.name,
          file.size,
          file.type,
          `images/${file.name}`,
          response.data.content.sha
        ).run();

        // 返回各种格式的链接
        const imageUrl = `${env.SITE_URL}/images/${file.name}`;
        return new Response(JSON.stringify({
          success: true,
          data: {
            url: imageUrl,
            markdown: `![${file.name}](${imageUrl})`,
            html: `<img src="${imageUrl}" alt="${file.name}">`,
            bbcode: `[img]${imageUrl}[/img]`
          }
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('Upload error:', error);
        return new Response(JSON.stringify({ error: '上传失败' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理 settings/guest-upload 请求
    if (path === 'settings/guest-upload') {
      console.log('Entering /settings/guest-upload handler');
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: 'Database not configured' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        const result = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
          .bind('allow_guest_upload')
          .first();
        
        console.log('Guest upload setting:', result);
        
        return new Response(JSON.stringify({
          success: true,
          data: {
            allowGuestUpload: result?.value === 'true'
          }
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('Error fetching guest upload settings:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to fetch settings'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 如果没有匹配的路由，返回 404
    return new Response(JSON.stringify({
      error: 'Not Found',
      message: `API endpoint ${path} not found`
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error('API request error:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
} 
