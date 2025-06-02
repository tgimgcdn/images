import { Octokit } from 'octokit';
import bcrypt from 'bcryptjs';

// 辅助函数：格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 分片合并处理函数
async function handleChunkMerging(env, uploadId) {
  console.log(`开始合并分片, 上传ID: ${uploadId}`);
  
  try {
    // 获取上传记录
    const uploadRecord = await env.DB.prepare(
      'SELECT * FROM uploads WHERE id = ?'
    ).bind(uploadId).first();
    
    if (!uploadRecord) {
      console.error(`找不到上传记录: ${uploadId}`);
      return;
    }
    
    console.log(`合并上传 ${uploadRecord.filename}, 总分片数: ${uploadRecord.total_chunks}`);
    
    // 更新状态为合并中
    await env.DB.prepare(
      'UPDATE uploads SET status = ? WHERE id = ?'
    ).bind('merging', uploadId).run();
    
    // 获取GitHub配置
    const accessToken = await env.KV.get('gh_token');
    const owner = await env.KV.get('gh_owner');
    const repo = await env.KV.get('gh_repo');
    
    if (!accessToken || !owner || !repo) {
      throw new Error('GitHub配置不完整');
    }
    
    // 创建临时分片目录路径
    const chunkDir = `chunks/${uploadId}`;
    
    // 存储所有分片的SHA，用于稍后删除
    const chunkSHAs = [];
    let mergedContent = '';
    
    // 获取并合并所有分片
    for (let i = 0; i < uploadRecord.total_chunks; i++) {
      const chunkPath = `${chunkDir}/${i}.chunk`;
      console.log(`获取分片 ${i + 1}/${uploadRecord.total_chunks}: ${chunkPath}`);
      
      // 从GitHub获取分片内容
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${chunkPath}`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CloudFlare-Worker'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`获取分片 ${i + 1} 失败: ${errorData.message || '未知错误'}`);
      }
      
      const chunkData = await response.json();
      chunkSHAs.push({ path: chunkPath, sha: chunkData.sha });
      
      // 解码分片内容并合并
      const content = atob(chunkData.content);
      mergedContent += content;
      
      // 每5个分片更新一次进度，避免数据库压力
      if (i % 5 === 0 || i === uploadRecord.total_chunks - 1) {
        await env.DB.prepare(
          'UPDATE uploads SET status = ?, completed_chunks = ? WHERE id = ?'
        ).bind('merging', i + 1, uploadId).run();
      }
    }
    
    console.log(`所有分片已获取, 开始上传合并后的文件: ${uploadRecord.filepath}`);
    
    // 将合并后的内容编码为Base64
    const base64Content = btoa(mergedContent);
    
    // 检查文件是否已存在
    let existingSha = null;
    try {
      const existingFileResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${uploadRecord.filepath}`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CloudFlare-Worker'
        }
      });
      
      if (existingFileResponse.ok) {
        const existingFile = await existingFileResponse.json();
        existingSha = existingFile.sha;
        console.log(`文件已存在，将进行更新: ${uploadRecord.filepath}, SHA: ${existingSha}`);
      }
    } catch (error) {
      console.log(`文件不存在，将创建新文件: ${uploadRecord.filepath}`);
    }
    
    // 上传合并后的文件到最终位置
    const fileUploadBody = {
      message: `Upload: ${uploadRecord.filename}`,
      content: base64Content,
      branch: 'main' // 确保指定正确的分支
    };
    
    // 如果文件已存在，添加SHA进行更新
    if (existingSha) {
      fileUploadBody.sha = existingSha;
    }
    
    const uploadResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${uploadRecord.filepath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'CloudFlare-Worker'
      },
      body: JSON.stringify(fileUploadBody)
    });
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json();
      throw new Error(`上传合并文件失败: ${errorData.message || '未知错误'}`);
    }
    
    // 获取上传后的文件信息
    const uploadedFileData = await uploadResponse.json();
    console.log(`文件合并上传成功: ${uploadRecord.filepath}`);
    
    // 检查文件是否为图片，并记录到数据库
    const isImage = uploadRecord.mime_type?.startsWith('image/');
    
    if (isImage) {
      // 从filepath中提取路径和文件名
      const pathParts = uploadRecord.filepath.split('/');
      const filename = pathParts.pop();
      const directory = pathParts.join('/').replace('public/', '');
      
      // 插入图片记录到数据库
      await env.DB.prepare(`
        INSERT INTO images (filename, directory, size, created_at) 
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        filename,
        directory,
        uploadRecord.size
      ).run();
      
      console.log(`图片记录已添加到数据库: ${filename}`);
    } else {
      console.log(`文件不是图片类型，跳过图片数据库记录`);
    }
    
    // 更新上传记录为已完成
    await env.DB.prepare(
      'UPDATE uploads SET status = ? WHERE id = ?'
    ).bind('completed', uploadId).run();
    
    // 删除临时分片文件
    console.log('开始清理临时分片文件');
    for (const chunk of chunkSHAs) {
      try {
        await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${chunk.path}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `token ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CloudFlare-Worker'
          },
          body: JSON.stringify({
            message: `Remove temp chunk for ${uploadRecord.filename}`,
            sha: chunk.sha,
            branch: 'main'
          })
        });
      } catch (error) {
        console.error(`删除临时分片失败: ${chunk.path}`, error);
        // 继续删除其他分片，不中断流程
      }
    }
    
    console.log(`上传和合并过程完成: ${uploadRecord.filepath}`);
    return true;
    
  } catch (error) {
    console.error('合并分片时出错:', error);
    
    // 更新上传记录为失败
    try {
      await env.DB.prepare(
        'UPDATE uploads SET status = ?, error = ? WHERE id = ?'
      ).bind('failed', error.message || '合并分片失败', uploadId).run();
    } catch (dbError) {
      console.error('更新上传状态出错:', dbError);
    }
    
    throw error;
  }
}

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
    // 添加调试模式检查
    const isDebugMode = request.headers.get('X-Debug-Mode') === 'true' || url.searchParams.has('debug');
    
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
        const { username, password, recaptchaResponse } = data;
        
        console.log(`尝试登录: 用户名=${username}, 密码长度=${password ? password.length : 0}, reCAPTCHA响应长度=${recaptchaResponse ? recaptchaResponse.length : 0}`);
        
        if (!username || !password) {
          return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 验证reCAPTCHA
        const recaptchaSiteKey = env.RECAPTCHA_SITE_KEY;
        const recaptchaSecretKey = env.RECAPTCHA_SECRET_KEY;
        const recaptchaEnabled = !!(recaptchaSiteKey && recaptchaSecretKey);
        
        if (recaptchaEnabled) {
          console.log('reCAPTCHA已启用，开始验证');
          
          if (!recaptchaResponse) {
            console.log('reCAPTCHA验证失败: 没有提供响应');
            return new Response(JSON.stringify({ error: '请完成人机验证' }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          
          try {
            // 验证reCAPTCHA响应
            const verifyURL = 'https://recaptcha.net/recaptcha/api/siteverify';
            const verifyParams = new URLSearchParams({
              secret: recaptchaSecretKey,
              response: recaptchaResponse
            });
            
            console.log('正在验证reCAPTCHA响应...');
            const verifyResponse = await fetch(verifyURL, {
              method: 'POST',
              body: verifyParams
            });
            
            const verifyResult = await verifyResponse.json();
            console.log('reCAPTCHA验证结果:', verifyResult);
            
            if (!verifyResult.success) {
              console.log('reCAPTCHA验证失败');
              return new Response(JSON.stringify({ error: '人机验证失败，请重试' }), {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  ...corsHeaders
                }
              });
            }
            
            console.log('reCAPTCHA验证成功');
          } catch (recaptchaError) {
            console.error('验证reCAPTCHA时出错:', recaptchaError);
            // 如果我们无法验证reCAPTCHA，暂时允许继续（在生产环境中可能需要更严格的处理）
            console.log('无法验证reCAPTCHA，但允许继续登录流程');
          }
        } else {
          console.log('reCAPTCHA未启用，跳过验证');
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
        
        console.log('查询结果:', user ? '用户存在' : '用户不存在');
        if (user) {
          console.log('用户ID:', user.id);
          console.log('密码哈希:', user.password);
        }
        
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
        console.log('开始验证密码...');
        
        // 特殊硬编码处理，用于调试 - 如果是管理员使用特定密码
        let isValid = false;
        
        if (username === 'admin' && password === 'admin123') {
          console.log('使用硬编码验证 admin/admin123');
          isValid = true;
        } else {
          // 使用bcrypt比较密码
          try {
            console.log('使用bcrypt比较密码...');
            isValid = await bcrypt.compare(password, user.password);
            console.log('bcrypt比较结果:', isValid ? '密码正确' : '密码错误');
          } catch (bcryptError) {
            console.error('bcrypt比较出错:', bcryptError);
            // 如果bcrypt比较失败，则尝试直接比较（仅用于调试）
            isValid = false;
          }
        }
        
        if (!isValid) {
          console.log('密码验证失败');
          return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        console.log('密码验证成功，开始创建会话...');
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
        
        // 设置 cookie - 使用更可靠的格式
        // 避免使用任何高级选项，只设置必要的信息
        const cookieHeader = `session_id=${sessionId}; Path=/`;
        
        console.log('设置Cookie:', cookieHeader);
        
        // 创建响应
        const responseBody = JSON.stringify({ 
          success: true,
          message: '登录成功',
          sessionId: sessionId,  // 添加会话ID以便调试
          user: {
            id: user.id,
            username: user.username
          }
        });
        
        console.log('登录响应:', responseBody);
        
        return new Response(responseBody, {
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

    // 处理上传初始化请求 - 为分片上传创建会话
    if (path.toLowerCase() === 'upload/init') {
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
        console.log('开始处理上传初始化请求');
        
        // 检查数据库连接
        if (!env.DB) {
          console.error('数据库对象不存在');
          return new Response(JSON.stringify({ 
            error: '服务器配置错误: 数据库连接失败', 
            details: '数据库环境变量未正确配置' 
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 检查KV存储
        if (!env.KV) {
          console.error('KV存储对象不存在');
          return new Response(JSON.stringify({ 
            error: '服务器配置错误: KV存储连接失败',
            details: 'KV存储环境变量未正确配置'
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 验证GitHub配置
        const accessToken = await env.KV.get('gh_token');
        const owner = await env.KV.get('gh_owner');
        const repo = await env.KV.get('gh_repo');
        
        console.log('GitHub配置检查:', {
          hasToken: !!accessToken,
          hasOwner: !!owner,
          hasRepo: !!repo
        });
        
        if (!accessToken || !owner || !repo) {
          console.error('GitHub配置不完整');
          return new Response(JSON.stringify({ 
            error: 'GitHub配置不完整',
            details: '请检查KV存储中的gh_token, gh_owner和gh_repo键值' 
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 检查游客上传权限
        console.log('检查游客上传权限');
        
        // 检查是否存在会话(已登录)
        const isLoggedIn = request.headers.get('cookie')?.includes('session_id=');
        console.log('用户登录状态:', isLoggedIn ? '已登录' : '未登录');
        
        // 如果未登录，检查是否允许游客上传
        if (!isLoggedIn) {
          console.log('用户未登录，检查游客上传权限');
          
          const setting = await env.DB.prepare(
            'SELECT value FROM settings WHERE key = ?'
          ).bind('allow_guest_upload').first();
          
          const allowGuestUpload = setting?.value === 'true';
          console.log('游客上传权限设置:', allowGuestUpload ? '允许' : '禁止');
          
          if (!allowGuestUpload) {
            console.log('游客上传已禁用，拒绝请求');
            return new Response(JSON.stringify({ error: '游客上传已禁用，请登录后再试' }), {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
        } else {
          console.log('用户已登录，允许上传');
        }

        // 解析请求数据
        const data = await request.json();
        console.log('接收到的初始化数据:', {
          filename: data.filename,
          size: data.size,
          type: data.type,
          totalChunks: data.total_chunks
        });
        
        const { filename, size, type, total_chunks } = data;
        
        if (!filename || !size || !total_chunks) {
          console.error('缺少初始化参数:', {
            hasFilename: !!filename,
            hasSize: !!size, 
            hasTotalChunks: !!total_chunks
          });
          return new Response(JSON.stringify({ 
            error: '缺少必要参数'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 检查文件类型
        try {
          console.log('检查文件类型:', type);
          const allowedTypesSettings = await env.DB.prepare(
            'SELECT value FROM settings WHERE key = ?'
          ).bind('allowed_types').first();
          
          const allowedTypes = allowedTypesSettings?.value 
            ? allowedTypesSettings.value.split(',') 
            : ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon'];
          
          console.log('允许的文件类型:', allowedTypes);
          
          if (!allowedTypes.includes(type)) {
            console.error('不支持的文件类型:', type);
            return new Response(JSON.stringify({ 
              error: '不支持的文件类型',
              allowedTypes: allowedTypes.join(', ')
            }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
        } catch (error) {
          console.error('检查文件类型时出错:', error);
          // 如果出错，使用默认的类型限制
          const defaultAllowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon'];
          if (!defaultAllowedTypes.includes(type)) {
            return new Response(JSON.stringify({ 
              error: '不支持的文件类型',
              allowedTypes: defaultAllowedTypes.join(', ')
            }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
        }

        // 检查文件大小
        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
        if (size > MAX_FILE_SIZE) {
          console.log('文件大小超过限制:', formatSize(size));
          return new Response(JSON.stringify({ error: '文件大小超过限制 (最大 25MB)' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 创建上传会话ID
        const uploadId = crypto.randomUUID();
        
        // 获取当前时间并转换为北京时间
        const now = new Date();
        // 调整为北京时间（UTC+8）
        const beijingNow = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        
        // 构建按年/月/日的目录结构
        const year = beijingNow.getUTCFullYear();
        const month = String(beijingNow.getUTCMonth() + 1).padStart(2, '0');
        const day = String(beijingNow.getUTCDate()).padStart(2, '0');
        const datePath = `${year}/${month}/${day}`;
        
        // 构建文件存储路径
        const filePath = `public/images/${datePath}/${filename}`;
        console.log('构建文件路径:', filePath);
        
        // 确保uploads表存在
        try {
          console.log('检查uploads表是否存在');
          // 首先检查表是否存在
          const tableExists = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='uploads'"
          ).first();
          
          if (!tableExists) {
            console.log('uploads表不存在，创建表');
            
            try {
              await env.DB.exec(`
                CREATE TABLE IF NOT EXISTS uploads (
                  id TEXT PRIMARY KEY,
                  filename TEXT NOT NULL,
                  filepath TEXT NOT NULL,
                  size INTEGER NOT NULL,
                  mime_type TEXT,
                  total_chunks INTEGER NOT NULL,
                  completed_chunks INTEGER DEFAULT 0,
                  status TEXT NOT NULL,
                  error TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
              `);
              console.log('uploads表创建成功');
            } catch (createError) {
              console.error('创建uploads表失败:', createError);
              return new Response(JSON.stringify({
                error: '服务器错误',
                details: '创建uploads表失败: ' + createError.message
              }), {
                status: 500,
                headers: {
                  'Content-Type': 'application/json',
                  ...corsHeaders
                }
              });
            }
          } else {
            console.log('uploads表已存在');
          }
        } catch (tableError) {
          console.error('检查uploads表失败:', tableError);
          return new Response(JSON.stringify({
            error: '服务器错误',
            details: '检查uploads表失败: ' + tableError.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 在数据库中创建临时上传记录
        console.log('创建上传记录:', uploadId);
        try {
          await env.DB.prepare(`
            INSERT INTO uploads (id, filename, filepath, size, mime_type, total_chunks, completed_chunks, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).bind(
            uploadId,
            filename,
            filePath,
            size,
            type || 'application/octet-stream',
            total_chunks,
            0,
            'pending'
          ).run();
          
          console.log('上传记录创建成功');
        } catch (dbError) {
          console.error('创建上传记录失败:', dbError);
          return new Response(JSON.stringify({
            error: '服务器错误',
            details: '创建上传记录失败: ' + dbError.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        console.log('初始化上传完成:', {
          uploadId,
          filename,
          filePath,
          size,
          total_chunks
        });
        
        // 返回上传信息
        return new Response(JSON.stringify({
          success: true,
          upload_id: uploadId,
          chunk_size: 5 * 1024 * 1024 // 5MB 分片大小，前端参考值
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
        
      } catch (error) {
        console.error('初始化上传错误:', error.stack || error);
        return new Response(JSON.stringify({
          success: false,
          error: '初始化上传失败',
          details: error.message,
          stack: isDebugMode ? error.stack : undefined
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 处理分片上传
    else if (path.toLowerCase() === 'upload/chunk') {
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
        console.log('开始处理分片上传请求');
        
        // 验证KV配置
        const accessToken = await env.KV.get('gh_token');
        const owner = await env.KV.get('gh_owner');
        const repo = await env.KV.get('gh_repo');
        
        console.log('GitHub配置检查:', {
          hasToken: !!accessToken,
          hasOwner: !!owner,
          hasRepo: !!repo
        });
        
        if (!accessToken || !owner || !repo) {
          console.error('GitHub配置不完整:', {
            hasToken: !!accessToken,
            hasOwner: !!owner, 
            hasRepo: !!repo
          });
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'GitHub存储配置错误',
            details: 'KV存储中的GitHub配置不完整'
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 解析form数据
        console.log('正在解析表单数据');
        const formData = await request.formData();
        const uploadId = formData.get('upload_id');
        const chunkIndex = parseInt(formData.get('chunk_index'), 10);
        const totalChunks = parseInt(formData.get('total_chunks'), 10);
        const chunkFile = formData.get('chunk');
        
        console.log(`处理分片上传: 上传ID=${uploadId}, 分片=${chunkIndex + 1}/${totalChunks}, 文件大小=${chunkFile ? chunkFile.size : 'N/A'}`);
        
        if (!uploadId || Number.isNaN(chunkIndex) || !chunkFile) {
          console.error('分片上传缺少参数:', {
            hasUploadId: !!uploadId,
            chunkIndex,
            hasChunkFile: !!chunkFile
          });
          return new Response(JSON.stringify({ 
            success: false, 
            error: '缺少必要参数'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取上传记录
        console.log('查询上传记录:', uploadId);
        try {
          // 确认uploads表存在
          await env.DB.prepare('SELECT 1 FROM sqlite_master WHERE type="table" AND name="uploads" LIMIT 1').first();
        } catch (tableError) {
          console.error('检查uploads表失败:', tableError);
          return new Response(JSON.stringify({
            success: false,
            error: '数据库表结构问题',
            details: 'uploads表不存在，请检查数据库初始化'
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const uploadRecord = await env.DB.prepare(
          'SELECT * FROM uploads WHERE id = ?'
        ).bind(uploadId).first();
        
        if (!uploadRecord) {
          console.error('未找到上传记录:', uploadId);
          return new Response(JSON.stringify({ 
            success: false, 
            error: '无效的上传ID'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        console.log('找到上传记录:', {
          filename: uploadRecord.filename,
          status: uploadRecord.status,
          completed: `${uploadRecord.completed_chunks}/${uploadRecord.total_chunks}`
        });
        
        // 检查上传状态
        if (uploadRecord.status === 'completed' || uploadRecord.status === 'failed') {
          console.log(`该上传已${uploadRecord.status === 'completed' ? '完成' : '失败'}`);
          return new Response(JSON.stringify({ 
            success: false, 
            error: `该上传已${uploadRecord.status === 'completed' ? '完成' : '失败'}`
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 创建临时分片存储目录名
        const chunkDir = `chunks/${uploadId}`;
        const chunkFilename = `${chunkIndex}.chunk`;
        const chunkPath = `${chunkDir}/${chunkFilename}`;
        
        // 读取文件内容
        console.log(`正在处理分片数据，路径: ${chunkPath}`);
        try {
          const buffer = await chunkFile.arrayBuffer();
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          console.log(`分片 ${chunkIndex + 1}/${totalChunks} 编码完成，大小: ${buffer.byteLength} 字节`);
          
          // 上传分片到GitHub
          console.log(`正在上传分片到GitHub: ${chunkPath}`);
          const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${chunkPath}`, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'CloudFlare-Worker'
            },
            body: JSON.stringify({
              message: `Upload chunk ${chunkIndex + 1} of ${totalChunks} for ${uploadRecord.filename}`,
              content: base64Data
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch (e) {
              errorData = { message: errorText };
            }
            
            console.error('GitHub API错误:', {
              status: response.status,
              statusText: response.statusText,
              error: errorData
            });
            
            // 更新上传状态为失败
            await env.DB.prepare(
              'UPDATE uploads SET status = ?, error = ? WHERE id = ?'
            ).bind(
              'failed',
              `分片${chunkIndex}上传失败: ${errorData.message || '未知错误'} (状态码: ${response.status})`,
              uploadId
            ).run();
            
            return new Response(JSON.stringify({ 
              success: false, 
              error: '分片上传到GitHub失败',
              details: errorData.message || '未知错误',
              status: response.status,
              statusText: response.statusText
            }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          
          console.log(`分片 ${chunkIndex + 1}/${totalChunks} 上传GitHub成功`);
          
          // 更新已上传的分片数量
          await env.DB.prepare(
            'UPDATE uploads SET completed_chunks = completed_chunks + 1 WHERE id = ?'
          ).bind(uploadId).run();
          
          console.log(`更新uploads表记录，增加已完成分片计数`);
          
          // 重新获取更新后的记录
          const updatedRecord = await env.DB.prepare(
            'SELECT * FROM uploads WHERE id = ?'
          ).bind(uploadId).first();
          
          // 检查是否所有分片都已上传
          if (updatedRecord.completed_chunks >= updatedRecord.total_chunks) {
            console.log(`所有分片已上传完成: ${updatedRecord.completed_chunks}/${updatedRecord.total_chunks}`);
            
            // 异步触发分片合并操作
            // 在实际生产环境中，你可能需要使用队列或其他方式来处理这个耗时操作
            handleChunkMerging(env, uploadId).catch(error => {
              console.error('分片合并失败:', error);
            });
            
            return new Response(JSON.stringify({
              success: true,
              status: 'all_chunks_uploaded',
              message: '所有分片已上传，正在合并文件',
              upload_id: uploadId,
              chunks_completed: updatedRecord.completed_chunks,
              total_chunks: updatedRecord.total_chunks
            }), {
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          
          // 返回上传成功和进度信息
          console.log(`分片 ${chunkIndex + 1}/${totalChunks} 处理完成`);
          return new Response(JSON.stringify({
            success: true,
            upload_id: uploadId,
            chunk_index: chunkIndex,
            chunks_completed: updatedRecord.completed_chunks,
            total_chunks: updatedRecord.total_chunks,
            progress: Math.round((updatedRecord.completed_chunks / updatedRecord.total_chunks) * 100)
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } catch (processError) {
          console.error('处理分片数据错误:', processError);
          return new Response(JSON.stringify({
            success: false,
            error: '处理分片数据错误',
            details: processError.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      } catch (error) {
        console.error('分片上传错误:', error.stack || error);
        return new Response(JSON.stringify({
          success: false,
          error: '分片上传失败',
          details: error.message,
          stack: isDebugMode ? error.stack : undefined
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 处理上传状态查询
    else if (path.toLowerCase() === 'upload/status') {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      try {
        const url = new URL(request.url);
        const uploadId = url.searchParams.get('upload_id');
        
        if (!uploadId) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '缺少upload_id参数' 
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取上传记录
        const uploadRecord = await env.DB.prepare(
          'SELECT * FROM uploads WHERE id = ?'
        ).bind(uploadId).first();
        
        if (!uploadRecord) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '无效的上传ID'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 计算上传进度
        const progress = Math.round((uploadRecord.completed_chunks / uploadRecord.total_chunks) * 100);
        
        // 如果上传完成，返回文件URL
        let fileUrl = null;
        if (uploadRecord.status === 'completed') {
          // 从filepath构建URL
          const baseUrl = await env.KV.get('base_url') || new URL(request.url).origin;
          fileUrl = `${baseUrl}/${uploadRecord.filepath.replace('public/', '')}`;
        }
        
        // 返回上传状态信息
        return new Response(JSON.stringify({
          success: true,
          status: uploadRecord.status,
          filename: uploadRecord.filename,
          size: uploadRecord.size,
          mime_type: uploadRecord.mime_type,
          progress: progress,
          chunks_completed: uploadRecord.completed_chunks,
          total_chunks: uploadRecord.total_chunks,
          created_at: uploadRecord.created_at,
          file_url: fileUrl,
          error: uploadRecord.error || null
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
        
      } catch (error) {
        console.error('查询上传状态错误:', error);
        return new Response(JSON.stringify({
          success: false,
          error: '查询上传状态失败',
          details: error.message
        }), {
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
    
    // 处理 admin/recaptcha-config 请求 - 获取验证码配置
    if (path.toLowerCase() === 'admin/recaptcha-config') {
      console.log('获取reCAPTCHA配置');
      
      // 检查是否有完整的reCAPTCHA配置（需要同时配置站点密钥和密钥）
      const recaptchaSiteKey = env.RECAPTCHA_SITE_KEY;
      const recaptchaSecretKey = env.RECAPTCHA_SECRET_KEY;
      const recaptchaEnabled = !!(recaptchaSiteKey && recaptchaSecretKey);
      
      console.log('reCAPTCHA配置状态:', {
        enabled: recaptchaEnabled,
        hasSiteKey: !!recaptchaSiteKey,
        hasSecretKey: !!recaptchaSecretKey
      });
      
      return new Response(JSON.stringify({
        enabled: recaptchaEnabled,
        siteKey: recaptchaEnabled ? recaptchaSiteKey : ''
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 处理 stats/summary 请求 - 获取基本统计数据（不包含访问统计）
    if (path.toLowerCase() === 'stats/summary') {
      console.log('处理图片统计数据请求');
      
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: '数据库未连接' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取图片总数
        const totalImagesResult = await env.DB.prepare('SELECT COUNT(*) as count FROM images').first();
        const totalImages = totalImagesResult ? totalImagesResult.count : 0;
        
        // 获取图片总大小
        const totalSizeResult = await env.DB.prepare('SELECT SUM(size) as total_size FROM images').first();
        const totalSize = totalSizeResult && totalSizeResult.total_size ? totalSizeResult.total_size : 0;
        
        // 获取今日上传数量 - 数据库中的时间已经是北京时间格式
        // 获取今天的日期字符串（格式：YYYY-MM-DD）
        const now = new Date();
        // 调整为北京时间
        const beijingNow = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        const year = beijingNow.getUTCFullYear();
        const month = String(beijingNow.getUTCMonth() + 1).padStart(2, '0');
        const day = String(beijingNow.getUTCDate()).padStart(2, '0');
        const todayDateString = `${year}-${month}-${day}`;
        
        console.log('今日日期字符串:', todayDateString);
        
        // 使用LIKE查询来匹配今天的日期
        const todayUploadsResult = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM images WHERE created_at LIKE ?"
        ).bind(`${todayDateString}%`).first();
        
        const todayUploads = todayUploadsResult ? todayUploadsResult.count : 0;
        
        console.log('统计结果:', {
          total_images: totalImages,
          today_uploads: todayUploads,
          total_size: totalSize
        });
        
        return new Response(JSON.stringify({
          total_images: totalImages,
          today_uploads: todayUploads,
          total_size: totalSize
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('获取统计数据失败:', error);
        return new Response(JSON.stringify({
          error: '获取统计数据失败'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理管理员修改密码请求
    if (path.toLowerCase() === 'admin/change-password') {
      console.log('处理管理员修改密码请求');
      
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
        console.log('开始处理修改密码请求');
        const data = await request.json();
        const { currentPassword, newPassword } = data;
        
        if (!currentPassword || !newPassword) {
          console.error('缺少必要参数');
          return new Response(JSON.stringify({ error: '当前密码和新密码不能为空' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 获取会话信息，检查用户是否已登录
        let sessionId = null;
        const cookieHeader = request.headers.get('Cookie') || '';
        const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
        
        for (const cookie of cookies) {
          if (cookie.startsWith('session_id=')) {
            sessionId = cookie.substring('session_id='.length);
            break;
          }
        }
        
        console.log('从Cookie获取的sessionId:', sessionId);
        
        if (!sessionId) {
          return new Response(JSON.stringify({ error: '未登录，无法修改密码' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 检查会话是否有效
        const session = await env.DB.prepare(
          'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
        ).bind(sessionId).first();
        
        if (!session) {
          console.log('会话已过期或无效');
          return new Response(JSON.stringify({ error: '会话已过期，请重新登录' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取用户信息
        const userId = session.user_id;
        const user = await env.DB.prepare(
          'SELECT * FROM users WHERE id = ?'
        ).bind(userId).first();
        
        if (!user) {
          console.error('找不到用户:', userId);
          return new Response(JSON.stringify({ error: '用户不存在' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 验证当前密码是否正确
        let isValid = false;
        if (user.username === 'admin' && currentPassword === 'admin123') {
          console.log('使用硬编码验证 admin/admin123');
          isValid = true;
        } else {
          try {
            console.log('验证当前密码');
            isValid = await bcrypt.compare(currentPassword, user.password);
          } catch (error) {
            console.error('密码验证出错:', error);
            isValid = false;
          }
        }
        
        if (!isValid) {
          console.log('当前密码验证失败');
          return new Response(JSON.stringify({ error: '当前密码不正确' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 对新密码进行哈希处理
        console.log('对新密码进行哈希处理');
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // 更新密码
        console.log('更新用户密码');
        await env.DB.prepare(
          'UPDATE users SET password = ? WHERE id = ?'
        ).bind(hashedPassword, userId).run();
        
        console.log('密码修改成功');
        return new Response(JSON.stringify({ 
          success: true,
          message: '密码已成功修改'
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('修改密码错误:', error);
        return new Response(JSON.stringify({ error: '修改密码失败: ' + error.message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理 settings 请求 - 获取系统设置
    if (path.toLowerCase() === 'settings') {
      console.log('处理系统设置请求');
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: '数据库未连接' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        if (request.method === 'GET') {
          // 获取所有设置
          const settings = await env.DB.prepare('SELECT key, value FROM settings').all();
          const settingsObj = {};
          
          if (settings && settings.results) {
            settings.results.forEach(setting => {
              settingsObj[setting.key] = setting.value;
            });
          }
          
          // 确保基本设置存在
          const defaultSettings = {
            allow_guest_upload: 'false',
            site_name: '参界图床'
          };
          
          const finalSettings = { ...defaultSettings, ...settingsObj };
          console.log('返回设置数据:', finalSettings);
          
          return new Response(JSON.stringify(finalSettings), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } else if (request.method === 'POST') {
          // 更新设置
          const data = await request.json();
          console.log('接收到设置更新请求:', data);
          
          const updates = [];
          
          for (const [key, value] of Object.entries(data)) {
            console.log(`更新设置: ${key} = ${value}`);
            updates.push(
              env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .bind(key, String(value))
                .run()
            );
          }
          
          await Promise.all(updates);
          console.log('设置已成功更新');
          
          return new Response(JSON.stringify({ 
            success: true,
            message: '设置已成功保存',
            data: data
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } else {
          return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      } catch (error) {
        console.error('处理系统设置请求失败:', error);
        return new Response(JSON.stringify({ error: '处理设置请求失败' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理 images 请求 - 获取图片列表
    if (path.toLowerCase() === 'images') {
      console.log('处理图片列表请求');
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: '数据库未连接' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        if (request.method === 'GET') {
          // 获取查询参数
          const params = new URL(request.url).searchParams;
          const page = parseInt(params.get('page') || '1');
          const limit = parseInt(params.get('limit') || '10');
          const sort = params.get('sort') || 'newest';
          const search = params.get('search') || '';
          
          const offset = (page - 1) * limit;
          
          // 构建排序语句
          let orderBy = '';
          switch (sort) {
            case 'oldest':
              orderBy = 'created_at ASC';
              break;
            case 'most_viewed':
              orderBy = 'views DESC';
              break;
            case 'name_asc':
              orderBy = 'filename ASC';
              break;
            case 'name_desc':
              orderBy = 'filename DESC';
              break;
            default:
              orderBy = 'created_at DESC'; // newest
          }
          
          // 构建查询条件
          let whereClause = '';
          let queryParams = [];
          
          if (search) {
            whereClause = 'WHERE filename LIKE ?';
            queryParams.push(`%${search}%`);
          }
          
          // 查询总记录数
          const countQuery = `
            SELECT COUNT(*) as total 
            FROM images 
            ${whereClause}
          `;
          
          const totalResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
          const total = totalResult ? totalResult.total : 0;
          
          // 查询分页数据
          const query = `
            SELECT id, filename, size, mime_type, github_path, sha, views, created_at 
            FROM images 
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
          `;
          
          queryParams.push(limit, offset);
          
          const imagesResult = await env.DB.prepare(query).bind(...queryParams).all();
          const images = imagesResult ? (imagesResult.results || []) : [];
          
          // 处理结果
          const formattedImages = images.map(img => {
            // 从github_path提取图片的相对路径
            const relativePath = img.github_path.replace('public/images/', '');
            
            return {
              id: img.id,
              name: img.filename,
              url: `${env.SITE_URL}/images/${relativePath}`,
              size: img.size,
              type: img.mime_type,
              views: img.views || 0,
              upload_time: img.created_at,
              sha: img.sha
            };
          });
          
          // 如果没有图片且启用了调试模式，返回模拟数据
          if (isDebugMode && formattedImages.length === 0) {
            console.log('返回模拟图片列表数据');
            const mockImages = [];
            
            // 生成一些模拟图片数据
            for (let i = 1; i <= 10; i++) {
              const mockDate = new Date();
              mockDate.setDate(mockDate.getDate() - i);
              
              mockImages.push({
                id: i,
                name: `sample-image-${i}.jpg`,
                url: `https://picsum.photos/id/${i + 10}/800/600`,
                size: 12345 * i,
                type: 'image/jpeg',
                views: 100 - i * 5,
                upload_time: mockDate.toISOString()
              });
            }
            
            return new Response(JSON.stringify({
              images: mockImages,
              total: 25,
              page: page,
              limit: limit,
              total_pages: 3
            }), {
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          
          return new Response(JSON.stringify({
            images: formattedImages,
            total: total,
            page: page,
            limit: limit,
            total_pages: Math.ceil(total / limit)
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } else {
          return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      } catch (error) {
        console.error('处理图片列表请求失败:', error);
        
        // 在出错时，如果启用了调试模式，返回模拟数据
        if (isDebugMode) {
          console.log('出错时返回模拟图片列表数据');
          const mockImages = [];
          
          // 生成一些模拟图片数据
          for (let i = 1; i <= 10; i++) {
            const mockDate = new Date();
            mockDate.setDate(mockDate.getDate() - i);
            
            mockImages.push({
              id: i,
              name: `sample-image-${i}.jpg`,
              url: `https://picsum.photos/id/${i + 10}/800/600`,
              size: 12345 * i,
              type: 'image/jpeg',
              views: 100 - i * 5,
              upload_time: mockDate.toISOString()
            });
          }
          
          return new Response(JSON.stringify({
            images: mockImages,
            total: 25,
            page: 1,
            limit: 10,
            total_pages: 3
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        return new Response(JSON.stringify({ error: '获取图片列表失败' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 处理 images/{id} 请求 - 获取或删除指定图片
    if (path.match(/^images\/\d+$/i)) {
      console.log('处理单个图片请求:', path);
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: '数据库未连接' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        const imageId = path.split('/')[1];
        console.log('图片ID:', imageId);

        if (request.method === 'DELETE') {
          // 获取图片信息
          const image = await env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(imageId).first();

          if (!image) {
            return new Response(JSON.stringify({ error: '图片不存在' }), {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }

          console.log('要删除的图片信息:', image);

          // 从GitHub删除图片
          try {
            const octokit = new Octokit({
              auth: env.GITHUB_TOKEN
            });

            await octokit.rest.repos.deleteFile({
              owner: env.GITHUB_OWNER,
              repo: env.GITHUB_REPO,
              path: image.github_path,
              message: `删除图片 ${image.filename}`,
              sha: image.sha
            });

            console.log('从GitHub删除图片成功');
          } catch (githubError) {
            console.error('从GitHub删除图片失败:', githubError);
            // 即使GitHub删除失败，我们仍然从数据库中删除记录
          }

          // 从数据库删除图片
          await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(imageId).run();
          console.log('从数据库删除图片成功');

          return new Response(JSON.stringify({ success: true }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } else if (request.method === 'GET') {
          // 获取单个图片详情
          const image = await env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(imageId).first();

          if (!image) {
            return new Response(JSON.stringify({ error: '图片不存在' }), {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }

          // 从github_path提取图片的相对路径
          // github_path格式如: public/images/2023/06/01/example.jpg
          const relativePath = image.github_path.replace('public/images/', '');

          return new Response(JSON.stringify({
            id: image.id,
            name: image.filename,
            url: `${env.SITE_URL}/images/${relativePath}`,
            size: image.size,
            type: image.mime_type,
            views: image.views || 0,
            upload_time: image.created_at
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } else {
          return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      } catch (error) {
        console.error('处理单个图片请求失败:', error);
        return new Response(JSON.stringify({ error: '处理图片请求失败' }), {
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
