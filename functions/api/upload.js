import { Octokit } from 'octokit';
import { v4 as uuidv4 } from 'uuid';

// 保存上传会话的临时内存存储
// 注意：这种方法在多实例环境中不可靠，生产环境应使用持久化存储
const uploadSessions = new Map();

// 每个会话的分块数据
const sessionChunks = new Map();

// 每个会话的过期时间 - 10分钟后自动清理
const sessionExpiry = new Map();

// 过期时间设定（毫秒）
const SESSION_EXPIRY_TIME = 10 * 60 * 1000; // 10分钟

// CORS头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 清理过期会话的函数
function cleanupExpiredSessions() {
  const now = Date.now();
  
  for (const [sessionId, expiry] of sessionExpiry.entries()) {
    if (now > expiry) {
      // 清理过期会话
      uploadSessions.delete(sessionId);
      sessionChunks.delete(sessionId);
      sessionExpiry.delete(sessionId);
      console.log(`已清理过期会话: ${sessionId}`);
    }
  }
}

// 获取北京时间的日期字符串 (YYYY/MM/DD)
function getBeijingDatePath() {
  // 获取当前UTC时间
  const now = new Date();
  
  // 转换为北京时间（UTC+8）
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  // 格式化为 YYYY/MM/DD
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  
  return `${year}/${month}/${day}`;
}

// 将 ArrayBuffer 转换为 Base64 的安全方法，避免栈溢出
function arrayBufferToBase64(buffer) {
  // 对于大文件，分块处理
  const CHUNK_SIZE = 32768; // 32KB 分块
  let binary = '';
  
  // 创建一个 Uint8Array 视图来访问 buffer
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  
  // 分块处理，避免栈溢出
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, Math.min(i + CHUNK_SIZE, len));
    const array = Array.from(chunk);
    binary += String.fromCharCode.apply(null, array);
  }
  
  return btoa(binary);
}

// 导入或定义triggerDeployHook函数
/**
 * 触发Cloudflare Pages部署钩子
 * @param {Object} env - 环境变量
 * @returns {Promise<Object>} - 返回部署结果
 */
async function triggerDeployHook(env) {
  // 检查环境变量是否存在
  if (!env.DEPLOY_HOOK) {
    console.log('DEPLOY_HOOK环境变量未设置，跳过部署');
    return { success: false, error: 'DEPLOY_HOOK环境变量未设置' };
  }

  // 检查格式是否正确
  const deployHook = env.DEPLOY_HOOK.trim();
  if (!deployHook.startsWith('@https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/')) {
    console.error('DEPLOY_HOOK格式不正确，应以@https://api.cloudflare.com/开头');
    return { success: false, error: 'DEPLOY_HOOK格式不正确' };
  }

  // 提取真实URL
  const deployUrl = deployHook.substring(1);
  
  try {
    console.log('触发Cloudflare Pages部署...');
    const response = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const result = await response.json();
      console.log('部署成功触发:', result);
      return { success: true, result };
    } else {
      const errorText = await response.text();
      console.error('部署触发失败:', response.status, errorText);
      return { success: false, error: `部署触发失败: ${response.status} ${errorText}` };
    }
  } catch (error) {
    console.error('部署钩子请求异常:', error);
    return { success: false, error: `部署钩子请求异常: ${error.message}` };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // 使用查询参数确定操作类型，而不是路径
  const action = url.searchParams.get('action');
  
  console.log('处理请求路径:', url.pathname, '操作:', action);
  
  // 每次请求时清理过期会话
  cleanupExpiredSessions();
  
  // 处理OPTIONS请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  
  // 检查是否允许游客上传
  const allowGuestUpload = await checkGuestUpload(env);
  const isAuthenticated = await checkAuthentication(request, env);
  
  if (!isAuthenticated && !allowGuestUpload) {
    return new Response(JSON.stringify({
      success: false,
      error: '游客上传已禁用'
    }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  
  // 处理后台直接上传（非分块）
  if (action === 'upload' && request.method === 'POST') {
    try {
      // 解析表单数据
      const formData = await request.formData();
      const file = formData.get('file');
      
      if (!file) {
        return new Response(JSON.stringify({
          success: false,
          error: '未找到上传文件'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        return new Response(JSON.stringify({
          success: false,
          error: '仅支持上传图片文件'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 读取文件内容
      const fileBuffer = await file.arrayBuffer();
      const base64Data = arrayBufferToBase64(fileBuffer);
      
      // 使用GitHub API上传文件
      const octokit = new Octokit({
        auth: env.GITHUB_TOKEN
      });
      
      // 获取北京时间的日期路径
      const datePath = getBeijingDatePath();
      
      // 使用原始文件名
      const fileName = file.name;
      
      // 构建完整路径：public/images/年/月/日/文件名
      const filePath = `public/images/${datePath}/${fileName}`;
      
      console.log(`后台直接上传文件到GitHub: ${filePath}`);
      
      // 检查文件是否已存在
      try {
        const fileExists = await octokit.rest.repos.getContent({
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          path: filePath,
          ref: 'main'
        });
        
        // 如果没有抛出错误，说明文件存在
        return new Response(JSON.stringify({
          success: false,
          error: `文件 "${fileName}" 已存在，请重命名后重试`,
          details: 'File already exists'
        }), {
          status: 409, // 明确返回409冲突状态码
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (existingFileError) {
        // 如果是404错误，说明文件不存在，可以继续上传
        if (existingFileError.status !== 404) {
          // 如果是其他错误，记录下来，但继续尝试上传
          console.warn('检查文件是否存在时出错:', existingFileError);
        }
      }
      
      // 上传到GitHub
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: env.GITHUB_OWNER,
        repo: env.GITHUB_REPO,
        path: filePath,
        message: `Upload ${fileName} (${datePath})`,
        content: base64Data,
        branch: 'main'
      });
      
      console.log(`文件上传到GitHub成功，SHA: ${response.data.content.sha}`);
      
      // 保存到数据库 - 使用北京时间而不是UTC时间
      try {
        // 获取当前北京时间的格式字符串
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        
        // 使用getUTC*方法正确格式化北京时间
        const beijingYear = beijingTime.getUTCFullYear();
        const beijingMonth = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
        const beijingDay = String(beijingTime.getUTCDate()).padStart(2, '0');
        const beijingHour = String(beijingTime.getUTCHours()).padStart(2, '0');
        const beijingMinute = String(beijingTime.getUTCMinutes()).padStart(2, '0');
        const beijingSecond = String(beijingTime.getUTCSeconds()).padStart(2, '0');
        const beijingTimeString = `${beijingYear}-${beijingMonth}-${beijingDay} ${beijingHour}:${beijingMinute}:${beijingSecond}`;
        
        await env.DB.prepare(`
          INSERT INTO images (filename, size, mime_type, github_path, sha, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime(?), datetime(?))
        `).bind(
          fileName,
          file.size,
          file.type,
          filePath,
          response.data.content.sha,
          beijingTimeString,
          beijingTimeString
        ).run();
        
        console.log(`文件信息已保存到数据库，上传时间(北京): ${beijingTimeString}`);
      } catch (dbError) {
        console.error('数据库保存失败:', dbError);
        // 继续执行，不因为数据库错误而中断响应
      }
      
      // 触发Cloudflare Pages部署钩子
      const deployResult = await triggerDeployHook(env);
      if (deployResult.success) {
        console.log('图片上传后部署已成功触发');
      } else {
        console.error('图片上传后部署失败:', deployResult.error);
      }
      
      // 返回链接信息
      const imageUrl = `${env.SITE_URL}/images/${datePath}/${fileName}`;
      return new Response(JSON.stringify({
        success: true,
        data: {
          url: imageUrl,
          markdown: `![${fileName}](${imageUrl})`,
          html: `<img src="${imageUrl}" alt="${fileName}">`,
          bbcode: `[img]${imageUrl}[/img]`
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('直接上传失败:', error);
      
      // 处理特定类型的错误
      if (error.message && error.message.includes('already exists')) {
        // 文件已存在冲突
        return new Response(JSON.stringify({
          success: false,
          error: `文件 "${file.name}" 已存在，请重命名后重试`,
          details: 'File already exists'
        }), {
          status: 409, // 明确返回409冲突状态码
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } else if (error.status === 403 || error.status === 401) {
        // 权限不足
        return new Response(JSON.stringify({
          success: false,
          error: 'GitHub授权失败，请检查Token是否正确',
          message: error.message,
          details: {
            stack: error.stack,
            env: {
              hasToken: !!env.GITHUB_TOKEN
            }
          }
        }), {
          status: error.status,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 其他错误
      return new Response(JSON.stringify({
        success: false,
        error: '上传失败',
        message: error.message,
        details: {
          stack: error.stack,
          env: {
            hasToken: !!env.GITHUB_TOKEN,
            hasOwner: !!env.GITHUB_OWNER,
            hasRepo: !!env.GITHUB_REPO,
            hasDB: !!env.DB
          }
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
  
  // 创建上传会话
  if (action === 'create-session' && request.method === 'POST') {
    try {
      const { fileName, fileSize, totalChunks, mimeType } = await request.json();
      
      // 验证必要参数
      if (!fileName || !fileSize || !totalChunks || !mimeType) {
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
      
      // 验证文件类型
      if (!mimeType.startsWith('image/')) {
        return new Response(JSON.stringify({
          success: false,
          error: '仅支持上传图片文件'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 生成会话ID
      const sessionId = uuidv4();
      
      // 存储会话信息
      uploadSessions.set(sessionId, {
        fileName,
        fileSize,
        totalChunks,
        mimeType,
        uploadedChunks: 0,
        createdAt: Date.now()
      });
      
      // 初始化分块存储
      sessionChunks.set(sessionId, new Map());
      
      // 设置过期时间 - 10分钟后
      sessionExpiry.set(sessionId, Date.now() + SESSION_EXPIRY_TIME);
      
      return new Response(JSON.stringify({
        success: true,
        sessionId,
        message: '上传会话已创建'
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('创建上传会话失败:', error);
      return new Response(JSON.stringify({
        success: false,
        error: '创建上传会话失败',
        message: error.message,
        details: {
          stack: error.stack,
          env: {
            hasToken: !!env.GITHUB_TOKEN,
            hasOwner: !!env.GITHUB_OWNER,
            hasRepo: !!env.GITHUB_REPO
          }
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
  
  // 上传分块
  if (action === 'chunk' && request.method === 'POST') {
    try {
      const formData = await request.formData();
      const chunk = formData.get('chunk');
      const sessionId = formData.get('sessionId');
      const chunkIndex = parseInt(formData.get('chunkIndex'), 10);
      const totalChunks = parseInt(formData.get('totalChunks'), 10);
      
      // 验证参数
      if (!chunk || !sessionId || isNaN(chunkIndex) || isNaN(totalChunks)) {
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
      
      // 验证会话是否存在
      const session = uploadSessions.get(sessionId);
      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: '会话不存在或已过期'
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 获取分块存储
      const chunks = sessionChunks.get(sessionId);
      
      // 存储分块数据
      const buffer = await chunk.arrayBuffer();
      chunks.set(chunkIndex, buffer);
      
      // 更新会话信息
      session.uploadedChunks++;
      
      // 刷新会话过期时间
      sessionExpiry.set(sessionId, Date.now() + SESSION_EXPIRY_TIME);
      
      return new Response(JSON.stringify({
        success: true,
        chunkIndex,
        received: true,
        progress: Math.floor((session.uploadedChunks / session.totalChunks) * 100)
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('上传分块失败:', error);
      return new Response(JSON.stringify({
        success: false,
        error: '上传分块失败',
        message: error.message,
        details: {
          stack: error.stack,
          sessionExists: !!uploadSessions.get(sessionId),
          sessionChunksExists: !!sessionChunks.get(sessionId)
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
  
  // 完成上传
  if (action === 'complete' && request.method === 'POST') {
    try {
      const requestData = await request.json();
      const { sessionId } = requestData;
      
      // 验证参数
      if (!sessionId) {
        return new Response(JSON.stringify({
          success: false,
          error: '缺少会话ID'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 验证会话是否存在
      const session = uploadSessions.get(sessionId);
      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: '会话不存在或已过期'
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 获取分块数据
      const chunks = sessionChunks.get(sessionId);
      
      // 验证是否所有分块都已上传
      if (chunks.size !== session.totalChunks) {
        return new Response(JSON.stringify({
          success: false,
          error: '文件分块不完整，请重新上传',
          uploaded: chunks.size,
          expected: session.totalChunks
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 合并所有分块
      const totalLength = Array.from(chunks.values()).reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const mergedBuffer = new Uint8Array(totalLength);
      
      let offset = 0;
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkBuffer = chunks.get(i);
        mergedBuffer.set(new Uint8Array(chunkBuffer), offset);
        offset += chunkBuffer.byteLength;
      }
      
      // 使用优化的方法将数据转换为Base64编码
      console.log(`开始对 ${totalLength} 字节的文件进行Base64编码`);
      const base64Data = arrayBufferToBase64(mergedBuffer.buffer);
      console.log(`Base64编码完成，编码后长度: ${base64Data.length}`);
      
      // 使用GitHub API上传文件
      const octokit = new Octokit({
        auth: env.GITHUB_TOKEN
      });
      
      // 获取北京时间的日期路径
      const datePath = getBeijingDatePath();
      
      // 构建文件路径 - 使用原始文件名（或在必要时添加时间戳）
      // 检查文件名是否已经包含扩展名
      let uploadFileName = session.fileName;
      if (!uploadFileName.includes('.')) {
        // 如果没有扩展名，根据MIME类型添加
        const mimeToExt = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/svg+xml': '.svg'
        };
        const ext = mimeToExt[session.mimeType] || '.jpg';
        uploadFileName = `${uploadFileName}${ext}`;
      }
      
      // 构建完整路径：public/images/年/月/日/文件名
      const filePath = `public/images/${datePath}/${uploadFileName}`;
      
      console.log(`准备上传文件到GitHub: ${filePath}`);
      
      // 检查文件是否已存在
      try {
        const fileExists = await octokit.rest.repos.getContent({
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          path: filePath,
          ref: 'main'
        });
        
        // 如果没有抛出错误，说明文件存在
        // 清理会话数据
        uploadSessions.delete(sessionId);
        sessionChunks.delete(sessionId);
        sessionExpiry.delete(sessionId);
        
        return new Response(JSON.stringify({
          success: false,
          error: `文件 "${uploadFileName}" 已存在，请重命名后重试`,
          details: 'File already exists'
        }), {
          status: 409, // 明确返回409冲突状态码
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (existingFileError) {
        // 如果是404错误，说明文件不存在，可以继续上传
        if (existingFileError.status !== 404) {
          // 如果是其他错误，记录下来，但继续尝试上传
          console.warn('检查文件是否存在时出错:', existingFileError);
        }
      }
      
      // 上传到GitHub
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: env.GITHUB_OWNER,
        repo: env.GITHUB_REPO,
        path: filePath,
        message: `Upload ${uploadFileName} (${datePath})`,
        content: base64Data,
        branch: 'main'
      });
      
      console.log(`文件上传到GitHub成功，SHA: ${response.data.content.sha}`);
      
      // 保存到数据库 - 使用北京时间而非UTC时间
      try {
        // 获取当前北京时间的格式字符串
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        
        // 使用getUTC*方法正确格式化北京时间
        const beijingYear = beijingTime.getUTCFullYear();
        const beijingMonth = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
        const beijingDay = String(beijingTime.getUTCDate()).padStart(2, '0');
        const beijingHour = String(beijingTime.getUTCHours()).padStart(2, '0');
        const beijingMinute = String(beijingTime.getUTCMinutes()).padStart(2, '0');
        const beijingSecond = String(beijingTime.getUTCSeconds()).padStart(2, '0');
        const beijingTimeString = `${beijingYear}-${beijingMonth}-${beijingDay} ${beijingHour}:${beijingMinute}:${beijingSecond}`;
        
        await env.DB.prepare(`
          INSERT INTO images (filename, size, mime_type, github_path, sha, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime(?), datetime(?))
        `).bind(
          uploadFileName,
          session.fileSize,
          session.mimeType,
          filePath,
          response.data.content.sha,
          beijingTimeString,
          beijingTimeString
        ).run();
        
        console.log(`文件信息已保存到数据库，上传时间(北京): ${beijingTimeString}`);
      } catch (dbError) {
        console.error('数据库保存失败:', dbError);
        // 继续执行，不因为数据库错误而中断响应
      }
      
      // 触发Cloudflare Pages部署钩子
      const deployResult = await triggerDeployHook(env);
      if (deployResult.success) {
        console.log('图片上传后部署已成功触发');
      } else {
        console.error('图片上传后部署失败:', deployResult.error);
      }
      
      // 返回链接信息
      const imageUrl = `${env.SITE_URL}/images/${datePath}/${uploadFileName}`;
      return new Response(JSON.stringify({
        success: true,
        data: {
          url: imageUrl,
          markdown: `![${uploadFileName}](${imageUrl})`,
          html: `<img src="${imageUrl}" alt="${uploadFileName}">`,
          bbcode: `[img]${imageUrl}[/img]`
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('完成上传失败:', error);
      
      // 清理会话数据
      if (sessionId) {
        uploadSessions.delete(sessionId);
        sessionChunks.delete(sessionId);
        sessionExpiry.delete(sessionId);
      }
      
      // 处理特定类型的错误
      if (error.message && error.message.includes('already exists')) {
        // 文件已存在冲突
        return new Response(JSON.stringify({
          success: false,
          error: `文件 "${uploadFileName}" 已存在，请重命名后重试`,
          details: 'File already exists'
        }), {
          status: 409, // 明确返回409冲突状态码
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } else if (error.status === 403 || error.status === 401) {
        // 权限不足
        return new Response(JSON.stringify({
          success: false,
          error: 'GitHub授权失败，请检查Token是否正确',
          message: error.message,
          details: {
            stack: error.stack,
            env: {
              hasToken: !!env.GITHUB_TOKEN
            }
          }
        }), {
          status: error.status,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 其他错误
      return new Response(JSON.stringify({
        success: false,
        error: '完成上传失败',
        message: error.message,
        details: {
          stack: error.stack,
          env: {
            hasToken: !!env.GITHUB_TOKEN,
            hasOwner: !!env.GITHUB_OWNER,
            hasRepo: !!env.GITHUB_REPO,
            hasDB: !!env.DB
          },
          sessionExists: !!uploadSessions.get(sessionId),
          chunksCount: sessionChunks.get(sessionId)?.size || 0
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
  
  // 取消上传
  if (action === 'cancel' && request.method === 'POST') {
    try {
      const { sessionId } = await request.json();
      
      // 验证参数
      if (!sessionId) {
        return new Response(JSON.stringify({
          success: false,
          error: '缺少会话ID'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 清理会话数据
      uploadSessions.delete(sessionId);
      sessionChunks.delete(sessionId);
      sessionExpiry.delete(sessionId);
      
      return new Response(JSON.stringify({
        success: true,
        message: '上传已取消'
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('取消上传失败:', error);
      return new Response(JSON.stringify({
        success: false,
        error: '取消上传失败',
        message: error.message,
        details: {
          stack: error.stack,
          sessionExists: sessionId ? !!uploadSessions.get(sessionId) : false
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
  
  // 如果没有匹配的操作，返回API使用说明
  return new Response(JSON.stringify({
    success: false,
    error: '无效的API请求',
    usage: '请使用查询参数指定操作，例如: /api/upload?action=create-session',
    availableActions: [
      'upload',
      'create-session',
      'chunk',
      'complete',
      'cancel'
    ]
  }), {
    status: 400,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

// 检查是否允许游客上传
async function checkGuestUpload(env) {
  if (!env.DB) {
    return false;
  }
  
  try {
    const setting = await env.DB.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('allow_guest_upload').first();
    
    return setting?.value === 'true';
  } catch (error) {
    console.error('检查游客上传设置失败:', error);
    return false;
  }
}

// 检查用户是否已登录
async function checkAuthentication(request, env) {
  // 从Cookie中获取会话ID
  let sessionId = null;
  const cookieHeader = request.headers.get('Cookie');
  
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'session_id') {
        sessionId = value;
        break;
      }
    }
  }
  
  if (!sessionId || !env.DB) {
    return false;
  }
  
  try {
    // 检查会话是否有效
    const session = await env.DB.prepare(
      'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
    ).bind(sessionId).first();
    
    return !!session;
  } catch (error) {
    console.error('验证用户登录状态失败:', error);
    return false;
  }
} 
