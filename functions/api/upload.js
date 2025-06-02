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
  
  // 完成上传
  if (action === 'complete' && request.method === 'POST') {
    try {
      const { sessionId, fileName, mimeType } = await request.json();
      
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
      
      // 防止重名，添加随机后缀
      const fileNameParts = session.fileName.split('.');
      const ext = fileNameParts.pop();
      const baseName = fileNameParts.join('.');
      const randomSuffix = Date.now().toString().slice(-6);
      const uniqueFileName = `${baseName}_${randomSuffix}.${ext}`;
      
      console.log(`准备上传文件到GitHub: ${uniqueFileName}`);
      
      // 上传到GitHub
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: env.GITHUB_OWNER,
        repo: env.GITHUB_REPO,
        path: `images/${uniqueFileName}`,
        message: `Upload ${uniqueFileName}`,
        content: base64Data,
        branch: 'main'
      });
      
      console.log(`文件上传到GitHub成功，SHA: ${response.data.content.sha}`);
      
      // 保存到数据库
      try {
        await env.DB.prepare(`
          INSERT INTO images (filename, size, mime_type, github_path, sha)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          uniqueFileName,
          session.fileSize,
          session.mimeType,
          `images/${uniqueFileName}`,
          response.data.content.sha
        ).run();
        
        console.log(`文件信息已保存到数据库`);
      } catch (dbError) {
        console.error('数据库保存失败:', dbError);
        // 继续执行，不因为数据库错误而中断响应
      }
      
      // 清理会话数据
      uploadSessions.delete(sessionId);
      sessionChunks.delete(sessionId);
      sessionExpiry.delete(sessionId);
      
      // 返回链接信息
      const imageUrl = `${env.SITE_URL}/images/${uniqueFileName}`;
      return new Response(JSON.stringify({
        success: true,
        data: {
          url: imageUrl,
          markdown: `![${uniqueFileName}](${imageUrl})`,
          html: `<img src="${imageUrl}" alt="${uniqueFileName}">`,
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
      return new Response(JSON.stringify({
        success: false,
        error: '完成上传失败',
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
        error: '取消上传失败'
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
