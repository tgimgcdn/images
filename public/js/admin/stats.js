document.addEventListener('DOMContentLoaded', async () => {
    // 加载系统统计信息
    async function loadSystemStats() {
        try {
            const response = await fetch('/api/admin/stats/system');
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // 更新总体统计
            document.getElementById('totalImages').textContent = data.totalStats.total_images;
            document.getElementById('totalSize').textContent = formatSize(data.totalStats.total_size);
            document.getElementById('totalDays').textContent = data.totalStats.total_days;

            // 更新最受欢迎图片
            const popularImagesContainer = document.getElementById('popularImages');
            popularImagesContainer.innerHTML = data.popularImages.map(image => `
                <div class="popular-image-card" onclick="showImageStats(${image.id})">
                    <img src="/images/${image.filename}" alt="${image.filename}">
                    <div class="image-info">
                        <div>上传日期: ${new Date(image.created_at).toLocaleDateString()}</div>
                        <div>大小: ${formatSize(image.size)}</div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('加载系统统计信息失败:', error);
            showToast('加载系统统计信息失败', 'error');
        }
    }

    // 加载图片统计信息
    async function loadImageStats(imageId) {
        try {
            const response = await fetch(`/api/admin/stats/image/${imageId}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            const imageStatsContainer = document.getElementById('imageStats');
            imageStatsContainer.innerHTML = `
                <div class="image-stats-card">
                    <h3>基本信息</h3>
                    <div class="stat-item">
                        <span class="label">文件名</span>
                        <span class="value">${data.image.filename}</span>
                    </div>
                    <div class="stat-item">
                        <span class="label">大小</span>
                        <span class="value">${formatSize(data.image.size)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="label">上传时间</span>
                        <span class="value">${new Date(data.image.created_at).toLocaleString()}</span>
                    </div>
                    <div class="stat-item">
                        <span class="label">MIME类型</span>
                        <span class="value">${data.image.mime_type || '未知'}</span>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('加载图片统计信息失败:', error);
            showToast('加载图片统计信息失败', 'error');
        }
    }

    // 格式化文件大小
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 显示提示消息
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // 将showImageStats函数添加到全局作用域
    window.showImageStats = loadImageStats;

    // 初始加载系统统计信息
    await loadSystemStats();
}); 
