import { Octokit } from 'octokit';
import bcrypt from 'bcryptjs';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace(/^\/+|\/+$/g, '');
  
  // 添加 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };

  // 详细日志
  console.log('API 请求详情:', {
    fullUrl: request.url,
    pathname: url.pathname,
    path: path,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    hasDB: !!env.DB,
    env: {
      hasGithubToken: !!env.GITHUB_TOKEN,
      hasGithubOwner: !!env.GITHUB_OWNER,
      hasGithubRepo: !!env.GITHUB_REPO,
      hasSiteUrl: !!env.SITE_URL
    }
  });

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  try {
    // 处理管理员登出请求
    if (path.toLowerCase() === 'admin/logout') {
      try {
        console.log('处理管理员登出请求');
        
        // 设置一个空值的Cookie来删除session_id，使用简单格式
        const cookieHeader = `session_id=; Path=/; Max-Age=0`;
        
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieHeader,
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('登出错误:', error);
        return new Response(JSON.stringify({ error: '登出失败' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理管理员登录请求
    if (path.toLowerCase() === 'admin/login') {
      // 只允许 POST 方法
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      try {
        console.log('处理管理员登录请求');
        const data = await request.json();
        const { username, password } = data;
        
        console.log(`尝试登录: 用户名=${username}, 密码长度=${password ? password.length : 0}`);
        
        if (!username || !password) {
          return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 查询用户
        console.log('查询用户:', username);
        if (!env.DB) {
          console.error('数据库未连接');
          return new Response(JSON.stringify({ error: '服务器错误: 数据库未连接' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const user = await env.DB.prepare(
          'SELECT * FROM users WHERE username = ?'
        ).bind(username).first();
        
        if (!user) {
          console.log('用户不存在');
          return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 验证密码
        console.log('验证密码');
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          console.log('密码错误');
          return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        console.log('登录成功，创建会话');
        // 创建会话，使用 Web Crypto API 的 randomUUID 方法
        const sessionId = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7天后过期
        
        await env.DB.prepare(`
          INSERT INTO sessions (id, user_id, username, expires_at)
          VALUES (?, ?, ?, ?)
        `).bind(
          sessionId,
          user.id,
          user.username,
          expiresAt.toISOString()
        ).run();
        
        // 设置 cookie - 使用简单的格式，避免可能导致问题的选项
        const cookieHeader = `session_id=${sessionId}; Path=/`;
        
        console.log('设置Cookie:', cookieHeader);
        
        return new Response(JSON.stringify({ 
          success: true,
          message: '登录成功',
          user: {
            id: user.id,
            username: user.username
          }
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieHeader,
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('登录错误:', error);
        return new Response(JSON.stringify({ error: '登录失败: ' + error.message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理文件上传 - 优化路径匹配
    if (path.toLowerCase() === 'upload') {
      // 只允许 POST 方法
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      try {
        // 检查游客上传权限
        console.log('检查游客上传权限');
        const session = request.headers.get('cookie')?.includes('userId=1') ? { userId: 1 } : null;
        
        if (!session) {
          const setting = await env.DB.prepare(
            'SELECT value FROM settings WHERE key = ?'
          ).bind('allow_guest_upload').first();
          
          if (!setting || setting.value !== 'true') {
            console.log('游客上传已禁用');
            return new Response(JSON.stringify({ error: '游客上传已禁用' }), {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
        }

        console.log('开始处理文件上传');
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
          console.error('未找到文件');
          return new Response(JSON.stringify({ error: '未找到文件' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        console.log('文件信息:', {
          name: file.name,
          type: file.type,
          size: file.size
        });

        // 检查文件大小
        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
        if (file.size > MAX_FILE_SIZE) {
          return new Response(JSON.stringify({ error: '文件大小超过限制 (最大 25MB)' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 初始化 Octokit
        console.log('初始化 Octokit');
        const octokit = new Octokit({
          auth: env.GITHUB_TOKEN
        });

        // 验证 GitHub 配置
        console.log('验证 GitHub 配置');
        try {
          const repoInfo = await octokit.rest.repos.get({
            owner: env.GITHUB_OWNER,
            repo: env.GITHUB_REPO
          });
          console.log('仓库信息:', {
            name: repoInfo.data.name,
            full_name: repoInfo.data.full_name,
            private: repoInfo.data.private,
            permissions: repoInfo.data.permissions
          });
        } catch (error) {
          console.error('GitHub 仓库验证失败:', error);
          return new Response(JSON.stringify({ 
            error: 'GitHub 仓库验证失败，请检查仓库名称和权限设置',
            details: error.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 上传到 GitHub
        console.log('开始上传到 GitHub');
        const buffer = await file.arrayBuffer();
        
        // 使用更高效的方式将 ArrayBuffer 转换为 base64
        const base64 = btoa(
          new Uint8Array(buffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        
        console.log('GitHub 配置:', {
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          path: `public/images/${file.name}`
        });

        try {
          const response = await octokit.rest.repos.createOrUpdateFileContents({
            owner: env.GITHUB_OWNER,
            repo: env.GITHUB_REPO,
            path: `public/images/${file.name}`,
            message: `Upload ${file.name}`,
            content: base64,
            branch: 'main'
          });

          console.log('GitHub 上传成功:', response.data);

          // 保存到数据库
          console.log('开始保存到数据库');
          await env.DB.prepare(`
            INSERT INTO images (filename, size, mime_type, github_path, sha)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            file.name,
            file.size,
            file.type,
            `public/images/${file.name}`,
            response.data.content.sha
          ).run();

          console.log('数据库保存成功');

          // 返回各种格式的链接
          const imageUrl = `${env.SITE_URL}/images/${file.name}`;
          console.log('返回图片链接:', imageUrl);

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
          console.error('GitHub API 错误:', error);
          console.error('错误详情:', {
            status: error.status,
            message: error.message,
            response: error.response?.data,
            request: {
              owner: env.GITHUB_OWNER,
              repo: env.GITHUB_REPO,
              path: `public/images/${file.name}`
            }
          });
          
          if (error.status === 404) {
            return new Response(JSON.stringify({ 
              error: 'GitHub 仓库配置错误，请检查仓库名称和权限设置',
              details: error.message
            }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          throw error;
        }
      } catch (error) {
        console.error('上传错误:', error);
        console.error('错误详情:', {
          message: error.message,
          stack: error.stack,
          env: {
            hasGithubToken: !!env.GITHUB_TOKEN,
            hasGithubOwner: !!env.GITHUB_OWNER,
            hasGithubRepo: !!env.GITHUB_REPO,
            hasSiteUrl: !!env.SITE_URL,
            hasDB: !!env.DB
          }
        });
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
    if (path.toLowerCase() === 'settings/guest-upload') {
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
    console.log('未找到匹配的路由:', path);
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
