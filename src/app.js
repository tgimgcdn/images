import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { handle } from 'hono/vercel';
import { Octokit } from 'octokit';
import bcrypt from 'bcryptjs';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const app = new Hono();

// 初始化 Octokit
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

// 静态文件服务
app.use('/*', serveStatic({ root: './' }));

// 验证 reCAPTCHA
async function verifyRecaptcha(token) {
    if (!token || !process.env.RECAPTCHA_SECRET_KEY) {
        return true; // 如果没有配置 reCAPTCHA，直接返回 true
    }

    try {
        const response = await fetch('https://recaptcha.net/recaptcha/api/siteverify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
        });

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        return false;
    }
}

// 中间件：会话管理
async function sessionMiddleware(c, next) {
    const sessionId = getCookie(c, 'session_id');
    if (sessionId) {
        // 从数据库获取会话信息
        const session = await c.env.DB.prepare(
            'SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP'
        ).bind(sessionId).first();
        
        if (session) {
            c.set('session', {
                userId: session.user_id,
                username: session.username
            });
        } else {
            // 会话已过期，删除 cookie
            deleteCookie(c, 'session_id');
        }
    }
    await next();
}

// 中间件：检查是否允许游客上传
async function checkGuestUpload(c, next) {
    if (c.req.path === '/api/upload' && c.req.method === 'POST') {
        const setting = await c.env.DB.prepare(
            'SELECT value FROM settings WHERE key = ?'
        ).bind('allow_guest_upload').first();
        
        if (!setting || setting.value !== 'true') {
            // 检查用户是否已登录
            const session = await c.get('session');
            if (!session || !session.userId) {
                return c.json({ error: '游客上传已禁用' }, 403);
            }
        }
    }
    await next();
}

// 中间件：管理员验证
async function requireAdmin(c, next) {
    const session = await c.get('session');
    if (!session || !session.userId) {
        return c.json({ error: '请先登录' }, 401);
    }
    await next();
}

// 应用中间件
app.use('*', sessionMiddleware);
app.use('*', checkGuestUpload);

// API 路由
app.post('/api/upload', async (c) => {
    try {
        const formData = await c.req.formData();
        const file = formData.get('file');
        
        if (!file) {
            return c.json({ error: '未找到文件' }, 400);
        }

        // 上传到 GitHub
        const buffer = await file.arrayBuffer();
        const content = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        
        const response = await octokit.rest.repos.createOrUpdateFileContents({
            owner: process.env.GITHUB_OWNER,
            repo: process.env.GITHUB_REPO,
            path: `images/${file.name}`,
            message: `Upload ${file.name}`,
            content: content,
            branch: 'main'
        });

        // 保存到数据库
        await c.env.DB.prepare(`
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
        const imageUrl = `${process.env.SITE_URL}/images/${file.name}`;
        return c.json({
            success: true,
            data: {
                url: imageUrl,
                markdown: `![${file.name}](${imageUrl})`,
                html: `<img src="${imageUrl}" alt="${file.name}">`,
                bbcode: `[img]${imageUrl}[/img]`
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        return c.json({ error: '上传失败' }, 500);
    }
});

// 获取 reCAPTCHA 配置
app.get('/api/admin/recaptcha-config', async (c) => {
    const enabled = !!(process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY);
    return c.json({
        enabled,
        siteKey: process.env.RECAPTCHA_SITE_KEY || ''
    });
});

// 后台管理 API 路由
app.post('/api/admin/login', async (c) => {
    try {
        const { username, password, recaptchaResponse } = await c.req.json();
        
        // 验证 reCAPTCHA
        if (process.env.RECAPTCHA_SECRET_KEY) {
            if (!recaptchaResponse) {
                return c.json({ error: '请完成人机验证' }, 400);
            }
            
            const isValid = await verifyRecaptcha(recaptchaResponse);
            if (!isValid) {
                return c.json({ error: '人机验证失败' }, 400);
            }
        }
        
        // 查询用户
        const user = await c.env.DB.prepare(
            'SELECT * FROM users WHERE username = ?'
        ).bind(username).first();
        
        if (!user) {
            return c.json({ error: '用户名或密码错误' }, 401);
        }
        
        // 验证密码
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return c.json({ error: '用户名或密码错误' }, 401);
        }
        
        // 创建会话
        const sessionId = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7天后过期
        
        await c.env.DB.prepare(`
            INSERT INTO sessions (id, user_id, username, expires_at)
            VALUES (?, ?, ?, ?)
        `).bind(
            sessionId,
            user.id,
            user.username,
            expiresAt.toISOString()
        ).run();
        
        // 设置 cookie
        setCookie(c, 'session_id', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
            expires: expiresAt,
            path: '/'
        });
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Login error:', error);
        return c.json({ error: '登录失败' }, 500);
    }
});

app.post('/api/admin/logout', async (c) => {
    const sessionId = getCookie(c, 'session_id');
    if (sessionId) {
        // 从数据库删除会话
        await c.env.DB.prepare(
            'DELETE FROM sessions WHERE id = ?'
        ).bind(sessionId).run();
        
        // 删除 cookie
        deleteCookie(c, 'session_id');
    }
    return c.json({ success: true });
});

// 获取统计数据
app.get('/api/admin/stats', requireAdmin, async (c) => {
    try {
        const stats = await c.env.DB.prepare(`
            SELECT 
                COUNT(*) as total_images,
                SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as today_uploads,
                SUM(views) as total_views
            FROM images
        `).first();
        
        return c.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        return c.json({ error: '获取统计数据失败' }, 500);
    }
});

// 获取系统设置
app.get('/api/admin/settings', requireAdmin, async (c) => {
    try {
        const settings = await c.env.DB.prepare(
            'SELECT key, value FROM settings'
        ).all();
        
        const settingsMap = {};
        settings.results.forEach(setting => {
            settingsMap[setting.key] = setting.value;
        });
        
        return c.json(settingsMap);
    } catch (error) {
        console.error('Settings error:', error);
        return c.json({ error: '获取系统设置失败' }, 500);
    }
});

// 更新系统设置
app.post('/api/admin/settings', requireAdmin, async (c) => {
    try {
        const { allow_guest_upload, site_name } = await c.req.json();
        
        // 更新设置
        await c.env.DB.prepare(`
            UPDATE settings 
            SET value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key = ?
        `).bind(allow_guest_upload.toString(), 'allow_guest_upload').run();
        
        await c.env.DB.prepare(`
            UPDATE settings 
            SET value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key = ?
        `).bind(site_name, 'site_name').run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Update settings error:', error);
        return c.json({ error: '更新系统设置失败' }, 500);
    }
});

// 获取图片列表
app.get('/api/admin/images', requireAdmin, async (c) => {
    try {
        const page = parseInt(c.req.query('page')) || 1;
        const search = c.req.query('search') || '';
        const sort = c.req.query('sort') || 'newest';
        const category = c.req.query('category');
        const tag = c.req.query('tag');
        const perPage = 20;
        
        // 构建查询条件
        let whereClause = '';
        let params = [];
        
        if (search) {
            whereClause = 'WHERE filename LIKE ?';
            params.push(`%${search}%`);
        }
        
        if (category) {
            whereClause = whereClause ? `${whereClause} AND` : 'WHERE';
            whereClause += ' category_id = ?';
            params.push(category);
        }
        
        if (tag) {
            whereClause = whereClause ? `${whereClause} AND` : 'WHERE';
            whereClause += ' id IN (SELECT image_id FROM image_tags WHERE tag_id = ?)';
            params.push(tag);
        }
        
        // 构建排序条件
        let orderClause = '';
        switch (sort) {
            case 'oldest':
                orderClause = 'ORDER BY created_at ASC';
                break;
            case 'most_views':
                orderClause = 'ORDER BY views DESC';
                break;
            case 'least_views':
                orderClause = 'ORDER BY views ASC';
                break;
            default:
                orderClause = 'ORDER BY created_at DESC';
        }
        
        // 获取总数
        const totalResult = await c.env.DB.prepare(`
            SELECT COUNT(*) as total
            FROM images
            ${whereClause}
        `).bind(...params).first();
        
        const total = totalResult.total;
        const totalPages = Math.ceil(total / perPage);
        
        // 获取当前页数据
        const images = await c.env.DB.prepare(`
            SELECT i.*, c.name as category_name,
                   GROUP_CONCAT(t.name) as tags
            FROM images i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN image_tags it ON i.id = it.image_id
            LEFT JOIN tags t ON it.tag_id = t.id
            ${whereClause}
            GROUP BY i.id
            ${orderClause}
            LIMIT ? OFFSET ?
        `).bind(...params, perPage, (page - 1) * perPage).all();
        
        // 添加图片 URL
        const imagesWithUrl = images.results.map(image => ({
            ...image,
            url: `${process.env.SITE_URL}/images/${image.filename}`,
            tags: image.tags ? image.tags.split(',') : []
        }));
        
        return c.json({
            images: imagesWithUrl,
            total_pages: totalPages,
            current_page: page
        });
    } catch (error) {
        console.error('Images list error:', error);
        return c.json({ error: '获取图片列表失败' }, 500);
    }
});

// 删除图片
app.delete('/api/admin/images/:id', requireAdmin, async (c) => {
    try {
        const id = c.req.param('id');
        
        // 获取图片信息
        const image = await c.env.DB.prepare(
            'SELECT * FROM images WHERE id = ?'
        ).bind(id).first();
        
        if (!image) {
            return c.json({ error: '图片不存在' }, 404);
        }
        
        // 从 GitHub 删除文件
        await octokit.rest.repos.deleteFile({
            owner: process.env.GITHUB_OWNER,
            repo: process.env.GITHUB_REPO,
            path: image.github_path,
            message: `Delete ${image.filename}`,
            sha: image.sha
        });
        
        // 从数据库删除记录
        await c.env.DB.prepare(
            'DELETE FROM images WHERE id = ?'
        ).bind(id).run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Delete image error:', error);
        return c.json({ error: '删除图片失败' }, 500);
    }
});

// 获取地理位置信息
async function getGeoLocation(ip) {
    try {
        const response = await fetch(`https://ipapi.co/${ip}/json/`);
        const data = await response.json();
        return {
            country: data.country_name,
            city: data.city
        };
    } catch (error) {
        console.error('Geo location error:', error);
        return { country: null, city: null };
    }
}

// 更新每日统计
async function updateDailyStats(c, size) {
    const today = new Date().toISOString().split('T')[0];
    
    // 更新或插入每日统计
    await c.env.DB.prepare(`
        INSERT INTO daily_stats (date, total_views, unique_visitors, bandwidth_used)
        VALUES (?, 1, 1, ?)
        ON CONFLICT(date) DO UPDATE SET
            total_views = total_views + 1,
            bandwidth_used = bandwidth_used + ?
    `).bind(today, size, size).run();
}

// 图片访问统计
app.get('/images/:filename', async (c) => {
    try {
        const filename = c.req.param('filename');
        
        // 获取图片信息
        const image = await c.env.DB.prepare(
            'SELECT * FROM images WHERE filename = ?'
        ).bind(filename).first();
        
        if (!image) {
            return c.json({ error: '图片不存在' }, 404);
        }

        // 获取访问者信息
        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for');
        const userAgent = c.req.header('user-agent');
        const referer = c.req.header('referer');

        // 获取地理位置信息
        const geo = await getGeoLocation(ip);

        // 记录访问统计
        await c.env.DB.prepare(`
            INSERT INTO image_stats (image_id, ip_address, user_agent, referer, country, city)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
            image.id,
            ip,
            userAgent,
            referer,
            geo.country,
            geo.city
        ).run();

        // 更新图片访问次数
        await c.env.DB.prepare(`
            UPDATE images 
            SET views = views + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(image.id).run();

        // 更新每日统计
        await updateDailyStats(c, image.size);
        
        // 重定向到 GitHub 原始文件
        const url = `https://raw.githubusercontent.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/main/images/${filename}`;
        return c.redirect(url);
    } catch (error) {
        console.error('Image access error:', error);
        return c.json({ error: '图片访问失败' }, 500);
    }
});

// 获取图片统计信息
app.get('/api/admin/stats/image/:id', requireAdmin, async (c) => {
    try {
        const id = c.req.param('id');
        
        // 获取图片基本信息
        const image = await c.env.DB.prepare(
            'SELECT * FROM images WHERE id = ?'
        ).bind(id).first();
        
        if (!image) {
            return c.json({ error: '图片不存在' }, 404);
        }

        // 获取访问统计
        const stats = await c.env.DB.prepare(`
            SELECT 
                COUNT(*) as total_views,
                COUNT(DISTINCT ip_address) as unique_visitors,
                COUNT(DISTINCT DATE(created_at)) as days_accessed,
                SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as today_views
            FROM image_stats
            WHERE image_id = ?
        `).bind(id).first();

        // 获取最近访问记录
        const recentAccess = await c.env.DB.prepare(`
            SELECT 
                ip_address,
                user_agent,
                referer,
                country,
                city,
                created_at
            FROM image_stats
            WHERE image_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `).bind(id).all();

        // 获取每日访问统计
        const dailyStats = await c.env.DB.prepare(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as views,
                COUNT(DISTINCT ip_address) as unique_visitors
            FROM image_stats
            WHERE image_id = ?
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `).bind(id).all();

        return c.json({
            image,
            stats,
            recentAccess: recentAccess.results,
            dailyStats: dailyStats.results
        });
    } catch (error) {
        console.error('Stats error:', error);
        return c.json({ error: '获取统计信息失败' }, 500);
    }
});

// 获取系统统计信息
app.get('/api/admin/stats/system', requireAdmin, async (c) => {
    try {
        // 获取总体统计
        const totalStats = await c.env.DB.prepare(`
            SELECT 
                COUNT(*) as total_images,
                SUM(views) as total_views,
                SUM(size) as total_size,
                COUNT(DISTINCT DATE(created_at)) as total_days
            FROM images
        `).first();

        // 获取每日统计
        const dailyStats = await c.env.DB.prepare(`
            SELECT *
            FROM daily_stats
            ORDER BY date DESC
            LIMIT 30
        `).all();

        // 获取最受欢迎的图片
        const popularImages = await c.env.DB.prepare(`
            SELECT *
            FROM images
            ORDER BY views DESC
            LIMIT 10
        `).all();

        return c.json({
            totalStats,
            dailyStats: dailyStats.results,
            popularImages: popularImages.results
        });
    } catch (error) {
        console.error('System stats error:', error);
        return c.json({ error: '获取系统统计信息失败' }, 500);
    }
});

// 获取所有分类
app.get('/api/admin/categories', requireAdmin, async (c) => {
    try {
        const categories = await c.env.DB.prepare(
            'SELECT * FROM categories ORDER BY name'
        ).all();
        
        return c.json(categories.results);
    } catch (error) {
        console.error('Categories error:', error);
        return c.json({ error: '获取分类列表失败' }, 500);
    }
});

// 创建新分类
app.post('/api/admin/categories', requireAdmin, async (c) => {
    try {
        const { name, description } = await c.req.json();
        
        const result = await c.env.DB.prepare(`
            INSERT INTO categories (name, description)
            VALUES (?, ?)
        `).bind(name, description).run();
        
        return c.json({ 
            success: true,
            id: result.lastRowId
        });
    } catch (error) {
        console.error('Create category error:', error);
        return c.json({ error: '创建分类失败' }, 500);
    }
});

// 更新分类
app.put('/api/admin/categories/:id', requireAdmin, async (c) => {
    try {
        const id = c.req.param('id');
        const { name, description } = await c.req.json();
        
        await c.env.DB.prepare(`
            UPDATE categories 
            SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(name, description, id).run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Update category error:', error);
        return c.json({ error: '更新分类失败' }, 500);
    }
});

// 删除分类
app.delete('/api/admin/categories/:id', requireAdmin, async (c) => {
    try {
        const id = c.req.param('id');
        
        // 检查是否有关联的图片
        const images = await c.env.DB.prepare(
            'SELECT COUNT(*) as count FROM images WHERE category_id = ?'
        ).bind(id).first();
        
        if (images.count > 0) {
            return c.json({ error: '该分类下还有图片，无法删除' }, 400);
        }
        
        await c.env.DB.prepare(
            'DELETE FROM categories WHERE id = ?'
        ).bind(id).run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Delete category error:', error);
        return c.json({ error: '删除分类失败' }, 500);
    }
});

// 获取所有标签
app.get('/api/admin/tags', requireAdmin, async (c) => {
    try {
        const tags = await c.env.DB.prepare(
            'SELECT * FROM tags ORDER BY name'
        ).all();
        
        return c.json(tags.results);
    } catch (error) {
        console.error('Tags error:', error);
        return c.json({ error: '获取标签列表失败' }, 500);
    }
});

// 创建新标签
app.post('/api/admin/tags', requireAdmin, async (c) => {
    try {
        const { name } = await c.req.json();
        
        const result = await c.env.DB.prepare(`
            INSERT INTO tags (name)
            VALUES (?)
        `).bind(name).run();
        
        return c.json({ 
            success: true,
            id: result.lastRowId
        });
    } catch (error) {
        console.error('Create tag error:', error);
        return c.json({ error: '创建标签失败' }, 500);
    }
});

// 更新图片分类和标签
app.put('/api/admin/images/:id', requireAdmin, async (c) => {
    try {
        const id = c.req.param('id');
        const { category_id, tags } = await c.req.json();
        
        // 更新分类
        await c.env.DB.prepare(`
            UPDATE images 
            SET category_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(category_id, id).run();
        
        // 更新标签
        if (tags) {
            // 删除现有标签
            await c.env.DB.prepare(
                'DELETE FROM image_tags WHERE image_id = ?'
            ).bind(id).run();
            
            // 添加新标签
            for (const tagName of tags) {
                // 获取或创建标签
                let tag = await c.env.DB.prepare(
                    'SELECT id FROM tags WHERE name = ?'
                ).bind(tagName).first();
                
                if (!tag) {
                    const result = await c.env.DB.prepare(`
                        INSERT INTO tags (name)
                        VALUES (?)
                    `).bind(tagName).run();
                    tag = { id: result.lastRowId };
                }
                
                // 关联标签
                await c.env.DB.prepare(`
                    INSERT INTO image_tags (image_id, tag_id)
                    VALUES (?, ?)
                `).bind(id, tag.id).run();
            }
        }
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Update image error:', error);
        return c.json({ error: '更新图片信息失败' }, 500);
    }
});

// 批量更新图片分类
app.post('/api/admin/images/batch-update', requireAdmin, async (c) => {
    try {
        const { image_ids, category_id } = await c.req.json();
        
        await c.env.DB.prepare(`
            UPDATE images 
            SET category_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${image_ids.join(',')})
        `).bind(category_id).run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Batch update error:', error);
        return c.json({ error: '批量更新失败' }, 500);
    }
});

// 批量删除图片
app.post('/api/admin/images/batch-delete', requireAdmin, async (c) => {
    try {
        const { image_ids } = await c.req.json();
        
        // 获取要删除的图片信息
        const images = await c.env.DB.prepare(`
            SELECT * FROM images WHERE id IN (${image_ids.join(',')})
        `).all();
        
        // 从 GitHub 删除文件
        for (const image of images.results) {
            await octokit.rest.repos.deleteFile({
                owner: process.env.GITHUB_OWNER,
                repo: process.env.GITHUB_REPO,
                path: image.github_path,
                message: `Delete ${image.filename}`,
                sha: image.sha
            });
        }
        
        // 从数据库删除记录
        await c.env.DB.prepare(`
            DELETE FROM images WHERE id IN (${image_ids.join(',')})
        `).run();
        
        return c.json({ success: true });
    } catch (error) {
        console.error('Batch delete error:', error);
        return c.json({ error: '批量删除失败' }, 500);
    }
});

// 导出处理函数
export default {
    fetch: app.fetch
}; 