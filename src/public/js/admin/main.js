document.addEventListener('DOMContentLoaded', () => {
    // 页面导航
    const navItems = document.querySelectorAll('.nav-menu li');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.dataset.page;
            
            // 更新导航状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 更新页面显示
            pages.forEach(page => {
                page.classList.remove('active');
                if (page.id === targetPage) {
                    page.classList.add('active');
                }
            });

            // 如果切换到图片管理页面，加载图片列表
            if (targetPage === 'images') {
                loadImages();
            }
        });
    });

    // 加载统计数据
    loadStats();

    // 加载系统设置
    loadSettings();

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/admin/logout', { method: 'POST' });
            window.location.href = '/admin/login.html';
        } catch (error) {
            console.error('退出登录失败:', error);
        }
    });

    // 保存系统设置
    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const allowGuestUpload = document.getElementById('allowGuestUpload').checked;
        const siteName = document.getElementById('siteName').value;

        try {
            const response = await fetch('/api/admin/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    allow_guest_upload: allowGuestUpload,
                    site_name: siteName
                })
            });

            if (response.ok) {
                alert('设置已保存');
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            alert('网络错误，请稍后重试');
        }
    });

    // 图片搜索和排序
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');

    searchInput.addEventListener('input', debounce(loadImages, 300));
    sortSelect.addEventListener('change', loadImages);
});

// 加载统计数据
async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats');
        const data = await response.json();

        document.getElementById('totalImages').textContent = data.total_images;
        document.getElementById('todayUploads').textContent = data.today_uploads;
        document.getElementById('totalViews').textContent = data.total_views;
    } catch (error) {
        console.error('加载统计数据失败:', error);
    }
}

// 加载系统设置
async function loadSettings() {
    try {
        const response = await fetch('/api/admin/settings');
        const data = await response.json();

        document.getElementById('allowGuestUpload').checked = data.allow_guest_upload === 'true';
        document.getElementById('siteName').value = data.site_name;
    } catch (error) {
        console.error('加载系统设置失败:', error);
    }
}

// 加载图片列表
async function loadImages(page = 1) {
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const imageList = document.getElementById('imageList');
    const pagination = document.getElementById('pagination');

    try {
        const response = await fetch(`/api/admin/images?page=${page}&search=${searchInput.value}&sort=${sortSelect.value}`);
        const data = await response.json();

        // 渲染图片列表
        imageList.innerHTML = data.images.map(image => `
            <div class="image-item">
                <img src="${image.url}" alt="${image.filename}" class="image-preview">
                <div class="image-info">
                    <div class="image-name">${image.filename}</div>
                    <div class="image-meta">
                        <div>大小: ${formatSize(image.size)}</div>
                        <div>上传时间: ${formatDate(image.created_at)}</div>
                        <div>访问次数: ${image.views}</div>
                    </div>
                    <div class="image-actions">
                        <button class="copy-btn" onclick="copyImageUrl('${image.url}')">复制链接</button>
                        <button class="delete-btn" onclick="deleteImage(${image.id})">删除</button>
                    </div>
                </div>
            </div>
        `).join('');

        // 渲染分页
        renderPagination(data.total_pages, page);
    } catch (error) {
        console.error('加载图片列表失败:', error);
    }
}

// 渲染分页
function renderPagination(totalPages, currentPage) {
    const pagination = document.getElementById('pagination');
    let html = '';

    // 上一页
    html += `
        <button onclick="loadImages(${currentPage - 1})" 
                ${currentPage === 1 ? 'disabled' : ''}>
            上一页
        </button>
    `;

    // 页码
    for (let i = 1; i <= totalPages; i++) {
        if (
            i === 1 || // 第一页
            i === totalPages || // 最后一页
            (i >= currentPage - 2 && i <= currentPage + 2) // 当前页附近的页码
        ) {
            html += `
                <button onclick="loadImages(${i})" 
                        class="${i === currentPage ? 'active' : ''}">
                    ${i}
                </button>
            `;
        } else if (
            i === currentPage - 3 || // 当前页前第三页
            i === currentPage + 3 // 当前页后第三页
        ) {
            html += '<span>...</span>';
        }
    }

    // 下一页
    html += `
        <button onclick="loadImages(${currentPage + 1})" 
                ${currentPage === totalPages ? 'disabled' : ''}>
            下一页
        </button>
    `;

    pagination.innerHTML = html;
}

// 复制图片链接
function copyImageUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
        alert('链接已复制到剪贴板');
    }).catch(() => {
        // 如果 clipboard API 不可用，使用传统方法
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('链接已复制到剪贴板');
    });
}

// 删除图片
async function deleteImage(id) {
    if (!confirm('确定要删除这张图片吗？')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/images/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadImages(); // 重新加载图片列表
            loadStats(); // 更新统计数据
        } else {
            const data = await response.json();
            alert(data.error || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请稍后重试');
    }
}

// 工具函数：格式化文件大小
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 工具函数：格式化日期
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 工具函数：防抖
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
} 