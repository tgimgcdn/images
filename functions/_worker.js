import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { serveStatic } from 'hono/cloudflare-workers';

const app = new Hono();
const api = new Hono();

// 错误处理中间件
app.use('*', async (c, next) => {
    try {
        await next();
    } catch (err) {
        console.error('Error:', err);
        c.header('Content-Type', 'application/json');
        return c.json({ error: 'Internal Server Error' }, 500);
    }
});

// 请求日志中间件
app.use('*', async (c, next) => {
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}`);
    await next();
});

// 检查数据库连接中间件
app.use('/api/*', async (c, next) => {
    if (!c.env?.DB) {
        console.error('Database not bound!');
        c.header('Content-Type', 'application/json');
        return c.json({ error: 'Database not configured' }, 500);
    }
    await next();
});

// 应用中间件
app.use('*', sessionMiddleware);
app.use('*', checkAdminAccess);
app.use('*', checkGuestUpload);

// 添加调试中间件
app.use('/api/*', async (c, next) => {
    console.log('API Request:', {
        method: c.req.method,
        path: c.req.path,
        headers: Object.fromEntries(c.req.headers.entries())
    });
    c.header('Content-Type', 'application/json');
    await next();
});

// API routes
api.get('/settings/guest-upload', async (c) => {
    console.log('Entering /settings/guest-upload handler');
    try {
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

// 添加一个健康检查端点
api.get('/health', (c) => {
    return c.json({
        success: true,
        message: 'Service is running',
        database: c.env?.DB ? 'connected' : 'not connected'
    });
});

// 重要：先挂载 API 路由，再处理静态文件
app.route('/api', api);

// 最后处理静态文件
app.use('/*', serveStatic({ root: './public' }));

// 中间件：会话管理
async function sessionMiddleware(c, next) {
    const sessionId = getCookie(c, 'session_id');
    
    if (sessionId && c.env?.DB) {
        try {
            const session = await c.env.DB.prepare(
                'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
            ).bind(sessionId).first();
            
            if (session) {
                c.set('session', {
                    userId: session.user_id,
                    username: session.username
                });
            } else {
                deleteCookie(c, 'session_id');
            }
        } catch (error) {
            console.error('Session error:', error);
            deleteCookie(c, 'session_id');
        }
    }
    await next();
}

// 中间件：检查管理后台访问权限
async function checkAdminAccess(c, next) {
    // 只检查 /admin/ 路径，且排除登录页面和API
    if (c.req.path.startsWith('/admin/') && 
        !c.req.path.includes('/admin/login.html') && 
        !c.req.path.includes('/api/admin/login')) {
        const session = c.get('session');
        if (!session || !session.userId) {
            return c.redirect('/admin/login.html');
        }
    }
    await next();
}

// 中间件：检查是否允许游客上传
async function checkGuestUpload(c, next) {
    // 只检查上传路径
    if (c.req.path === '/api/upload' && c.req.method === 'POST' && c.env?.DB) {
        try {
            const setting = await c.env.DB.prepare(
                'SELECT value FROM settings WHERE key = ?'
            ).bind('allow_guest_upload').first();
            
            if (!setting || setting.value !== 'true') {
                const session = await c.get('session');
                if (!session || !session.userId) {
                    return c.json({ error: '游客上传已禁用' }, 403);
                }
            }
        } catch (error) {
            console.error('Guest upload check error:', error);
            return c.json({ error: '检查上传权限失败' }, 500);
        }
    }
    await next();
}

// 导出处理函数
export const onRequest = app.fetch; 
