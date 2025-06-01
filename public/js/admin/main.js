// 全局变量
let currentPage = 1;
let totalPages = 1;
let currentSort = 'newest';
let currentSearch = '';
let viewsChart = null;
let isDebugMode = false; // 添加调试模式标志
let allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon']; // 默认允许的文件类型

// DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('DOM加载完成，开始初始化');
        // 检查是否启用调试模式
        isDebugMode = localStorage.getItem('debugMode') === 'true' || new URLSearchParams(window.location.search).has('debug');
        if (isDebugMode) {
            console.log('调试模式已启用');
            document.body.classList.add('debug-mode');
        }

        // 初始化基本页面功能
        console.log('初始化导航');
        initNavigation();
        
        // 异步初始化其他功能，确保不会阻塞UI
        setTimeout(() => {
            console.log('初始化控制面板');
            initDashboard();
            console.log('初始化图片管理');
            initImageManagement();
            console.log('初始化设置');
            initSettings();
            console.log('初始化上传模态框');
            initUploadModal();
        
            // 最后尝试加载文件类型，如果失败不影响基本功能
            console.log('加载允许的文件类型');
            loadAllowedFileTypes().catch(err => {
                console.error('加载文件类型失败，使用默认值:', err);
            });
        }, 100);
    } catch (error) {
        console.error('初始化页面时出错:', error);
    }
});

// 加载允许的文件类型
async function loadAllowedFileTypes() {
    try {
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await safeApiCall('/api/settings', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.error && response.allowed_types) {
            allowedFileTypes = response.allowed_types.split(',');
            console.log('已加载允许的文件类型:', allowedFileTypes);
        } else {
            console.log('使用默认的允许文件类型:', allowedFileTypes);
        }
    } catch (error) {
        console.error('加载允许的文件类型失败，使用默认值:', error);
        // 出错不影响继续使用默认值
    }
}

// 安全的API调用函数，包含错误处理
async function safeApiCall(url, options = {}) {
    try {
        // 在调试模式下添加debug参数
        if (isDebugMode) {
            url = url.includes('?') ? `${url}&debug=true` : `${url}?debug=true`;
        }
        
        // 提取自定义选项
        const { timeout, ...fetchOptions } = options;
        const requestTimeout = timeout || 10000; // 默认10秒
        
        // 设置请求选项
        const finalOptions = {
            ...fetchOptions,
            credentials: 'include',
            headers: {
                ...fetchOptions.headers,
                'X-Debug-Mode': isDebugMode ? 'true' : 'false'
            }
        };
        
        // 添加超时处理
        const controller = new AbortController();
        if (!finalOptions.signal) {
            finalOptions.signal = controller.signal;
        }
        const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
        
        try {
            const response = await fetch(url, finalOptions);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.error(`API错误: ${url} 返回状态码 ${response.status}`);
                return { error: `服务器错误 (${response.status})` };
            }
            
            return await response.json();
        } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`API请求超时: ${url}`);
            return { error: '请求超时，请稍后再试' };
        }
        console.error(`API调用错误:`, error);
        return { error: '网络请求失败，请检查连接' };
    }
}

// 导航功能
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-menu li');
    const pages = document.querySelectorAll('.page');
    const pageTitle = document.getElementById('pageTitle');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.getAttribute('data-page');
            
            // 更新导航状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 更新页面显示
            pages.forEach(page => {
                page.classList.remove('active');
                if (page.id === targetPage) {
                    page.classList.add('active');
                    pageTitle.textContent = item.querySelector('span').textContent;
                }
            });
        });
    });

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            // 直接使用原生 cookie API 删除 session_id cookie
            document.cookie = 'session_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            window.location.href = '/admin/login.html';
        } catch (error) {
            console.error('退出登录失败:', error);
        }
    });
}

// 控制面板功能
async function initDashboard() {
    try {
        // 获取统计数据
        const stats = await safeApiCall('/api/stats/summary');
        
        if (stats.error) {
            showToast(`加载统计数据失败: ${stats.error}`, 'error');
            // 使用默认值
            document.getElementById('totalImages').textContent = '-';
            document.getElementById('todayUploads').textContent = '-';
            document.getElementById('totalViews').textContent = '-';
        } else {
            // 更新统计卡片
            document.getElementById('totalImages').textContent = stats.total_images;
            document.getElementById('todayUploads').textContent = stats.today_uploads;
            document.getElementById('totalViews').textContent = stats.total_views;
        }

        // 获取访问趋势数据
        const trendData = await safeApiCall('/api/stats/trend');
        
        if (trendData.error) {
            showToast(`加载趋势数据失败: ${trendData.error}`, 'error');
            // 显示空图表或占位符
            document.getElementById('viewsChart').innerHTML = '<div class="chart-placeholder">暂无数据</div>';
        } else {
            // 初始化图表
            initViewsChart(trendData);
        }
    } catch (error) {
        console.error('加载控制面板数据失败:', error);
        showToast('加载控制面板数据失败', 'error');
    }
}

function initViewsChart(data) {
    const ctx = document.getElementById('viewsChart').getContext('2d');
    
    if (viewsChart) {
        viewsChart.destroy();
    }
    
    viewsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [{
                label: '访问量',
                data: data.values,
                borderColor: '#4a90e2',
                backgroundColor: 'rgba(74, 144, 226, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// 图片管理功能
function initImageManagement() {
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const uploadBtn = document.getElementById('uploadBtn');

    // 搜索功能
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value;
            currentPage = 1;
            loadImages();
        }, 300);
    });

    // 排序功能
    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        loadImages();
    });

    // 上传按钮
    uploadBtn.addEventListener('click', () => {
        document.getElementById('uploadModal').style.display = 'block';
    });
    
    // 添加批量操作按钮
    const toolbar = document.querySelector('.toolbar');
    const batchOperationsDiv = document.createElement('div');
    batchOperationsDiv.className = 'batch-operations';
    batchOperationsDiv.innerHTML = `
        <label class="select-all-container">
            <input type="checkbox" id="selectAllCheckbox">
            <span>全选</span>
        </label>
        <button class="btn btn-danger" id="batchDeleteBtn" disabled>
            <i class="fas fa-trash"></i>
            批量删除
        </button>
    `;
    
    toolbar.appendChild(batchOperationsDiv);
    
    // 全选功能
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.image-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
        updateBatchOperationButtons();
    });
    
    // 批量删除功能
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    batchDeleteBtn.addEventListener('click', () => {
        const selectedIds = getSelectedImageIds();
        if (selectedIds.length > 0) {
            if (confirm(`确定要删除选中的 ${selectedIds.length} 张图片吗？`)) {
                batchDeleteImages(selectedIds);
            }
        }
    });
    
    // 添加委托事件监听，处理复选框变化
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('image-checkbox')) {
            updateBatchOperationButtons();
        }
    });

    // 初始加载图片
    loadImages();
}

// 获取选中的图片ID
function getSelectedImageIds() {
    const checkboxes = document.querySelectorAll('.image-checkbox:checked');
    return Array.from(checkboxes).map(checkbox => checkbox.dataset.id);
}

// 更新批量操作按钮状态
function updateBatchOperationButtons() {
    const selectedIds = getSelectedImageIds();
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    
    if (selectedIds.length > 0) {
        batchDeleteBtn.disabled = false;
        batchDeleteBtn.textContent = `删除选中(${selectedIds.length})`;
    } else {
        batchDeleteBtn.disabled = true;
        batchDeleteBtn.innerHTML = `<i class="fas fa-trash"></i> 批量删除`;
    }
    
    // 更新全选复选框状态
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const allCheckboxes = document.querySelectorAll('.image-checkbox');
    
    if (allCheckboxes.length > 0 && selectedIds.length === allCheckboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedIds.length > 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}

// 批量删除图片
async function batchDeleteImages(ids) {
    try {
        // 显示加载状态
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        const originalText = batchDeleteBtn.innerHTML;
        batchDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 删除中...';
        batchDeleteBtn.disabled = true;
        
        let successCount = 0;
        let failCount = 0;
        
        // 顺序删除每个图片
        for (const id of ids) {
            try {
                const response = await fetch(`/api/images/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`删除图片 ${id} 失败:`, error);
                failCount++;
            }
        }
        
        // 恢复按钮状态
        batchDeleteBtn.innerHTML = originalText;
        batchDeleteBtn.disabled = false;
        
        // 显示结果
        if (failCount === 0) {
            showToast(`成功删除 ${successCount} 张图片`, 'success');
        } else {
            showToast(`删除完成: ${successCount} 成功, ${failCount} 失败`, 'warning');
        }
        
        // 重新加载图片列表
        loadImages();
    } catch (error) {
        console.error('批量删除图片失败:', error);
        showToast('批量删除失败', 'error');
        
        // 恢复按钮状态
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        batchDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> 批量删除';
        batchDeleteBtn.disabled = false;
    }
}

async function loadImages() {
    try {
        // 设置每页显示36张图片（6行×6列）
        const limit = 36;
        const data = await safeApiCall(
            `/api/images?page=${currentPage}&limit=${limit}&sort=${currentSort}&search=${currentSearch}`
        );
        
        if (data.error) {
            showToast(`加载图片列表失败: ${data.error}`, 'error');
            return;
        }
        
        // 更新图片列表
        const imageList = document.getElementById('imageList');
        imageList.innerHTML = '';
        
        if (data.images && data.images.length > 0) {
            data.images.forEach(image => {
                const imageCard = createImageCard(image);
                imageList.appendChild(imageCard);
            });
        } else {
            imageList.innerHTML = '<div class="no-images">暂无图片</div>';
        }
        
        // 更新分页
        totalPages = data.total_pages || 1;
        updatePagination();
    } catch (error) {
        console.error('加载图片列表失败:', error);
        showToast('加载图片列表失败', 'error');
    }
}

function createImageCard(image) {
    const card = document.createElement('div');
    card.className = 'image-card';
    
    // 截断文件名，超过18个字符显示...
    const truncatedName = image.name.length > 18 ? image.name.substring(0, 15) + '...' : image.name;
    
    card.innerHTML = `
        <div class="image-preview">
            <img src="${image.url}" alt="${image.name}">
        </div>
        <div class="image-info">
            <h3 title="${image.name}">
                <span class="checkbox-container">
                    <input type="checkbox" class="image-checkbox" data-id="${image.id}">
                </span>
                ${truncatedName}
            </h3>
            <p class="image-meta">
                ${formatDate(image.upload_time)}
            </p>
            <div class="image-actions">
                <button class="btn btn-primary copy-btn" data-url="${image.url}">
                    <i class="fas fa-copy"></i>
                    复制
                </button>
                <button class="btn btn-danger delete-btn" data-id="${image.id}">
                    <i class="fas fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
    `;
    
    // 添加悬停文件名显示全名的功能
    const filename = card.querySelector('h3');
    filename.addEventListener('mouseenter', (e) => {
        if (image.name.length > 18) {
            const tooltip = document.createElement('div');
            tooltip.className = 'image-filename-tooltip';
            tooltip.textContent = image.name;
            tooltip.style.top = `${e.target.offsetTop + e.target.offsetHeight}px`;
            tooltip.style.left = `${e.target.offsetLeft}px`;
            document.body.appendChild(tooltip);
            
            // 显示工具提示
            setTimeout(() => {
                tooltip.style.opacity = '1';
            }, 10);
            
            // 保存工具提示引用
            e.target.tooltip = tooltip;
        }
    });
    
    filename.addEventListener('mouseleave', (e) => {
        if (e.target.tooltip) {
            e.target.tooltip.style.opacity = '0';
            setTimeout(() => {
                if (e.target.tooltip && e.target.tooltip.parentNode) {
                    e.target.tooltip.parentNode.removeChild(e.target.tooltip);
                }
                e.target.tooltip = null;
            }, 300);
        }
    });
    
    // 添加事件监听器
    card.querySelector('.copy-btn').addEventListener('click', (e) => {
        const url = e.target.closest('.copy-btn').dataset.url;
        copyToClipboard(url);
    });
    
    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        const id = e.target.closest('.delete-btn').dataset.id;
        if (confirm('确定要删除这张图片吗？')) {
            await deleteImage(id);
        }
    });
    
    return card;
}

function updatePagination() {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    
    // 上一页按钮
    if (currentPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '上一页';
        prevBtn.addEventListener('click', () => {
            currentPage--;
            loadImages();
        });
        pagination.appendChild(prevBtn);
    }
    
    // 页码按钮
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const pageBtn = document.createElement('button');
            pageBtn.textContent = i;
            pageBtn.className = i === currentPage ? 'active' : '';
            pageBtn.addEventListener('click', () => {
                currentPage = i;
                loadImages();
            });
            pagination.appendChild(pageBtn);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            pagination.appendChild(ellipsis);
        }
    }
    
    // 下一页按钮
    if (currentPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页';
        nextBtn.addEventListener('click', () => {
            currentPage++;
            loadImages();
        });
        pagination.appendChild(nextBtn);
    }
}

// 系统设置功能
async function initSettings() {
    try {
        // 获取当前设置
        const settings = await safeApiCall('/api/settings');
        
        if (settings.error) {
            showToast(`加载设置失败: ${settings.error}`, 'error');
            return;
        }
        
        // 更新表单
        document.getElementById('allowGuestUpload').checked = settings.allow_guest_upload === 'true';
        document.getElementById('siteName').value = settings.site_name || '图床管理系统';
        
        // 保存设置
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const settingsData = Object.fromEntries(formData.entries());
            
            try {
                const response = await safeApiCall('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(settingsData)
                });
                
                if (response.error) {
                    showToast(`保存设置失败: ${response.error}`, 'error');
                } else {
                    showToast('设置已保存', 'success');
                }
            } catch (error) {
                console.error('保存设置失败:', error);
                showToast('保存设置失败', 'error');
            }
        });
        
        // 添加调试模式切换
        const debugModeContainer = document.createElement('div');
        debugModeContainer.className = 'form-group';
        debugModeContainer.innerHTML = `
            <div class="switch-label">
                <span>调试模式</span>
                <label class="switch">
                    <input type="checkbox" id="debugModeToggle" ${isDebugMode ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <p class="hint">调试模式会显示更多信息，并在没有数据时显示模拟数据</p>
        `;
        
        document.querySelector('.settings-form').appendChild(debugModeContainer);
        
        document.getElementById('debugModeToggle').addEventListener('change', (e) => {
            isDebugMode = e.target.checked;
            localStorage.setItem('debugMode', isDebugMode);
            
            if (isDebugMode) {
                document.body.classList.add('debug-mode');
                showToast('调试模式已启用', 'info');
            } else {
                document.body.classList.remove('debug-mode');
                showToast('调试模式已关闭', 'info');
            }
            
            // 刷新数据
            initDashboard();
            loadImages();
        });
    } catch (error) {
        console.error('加载设置失败:', error);
        showToast('加载设置失败', 'error');
    }
}

// 上传模态框功能
function initUploadModal() {
    const modal = document.getElementById('uploadModal');
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const closeBtn = document.querySelector('.close-btn');
    
    // 关闭模态框
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // 点击外部关闭
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // 拖放上传
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });
    
    // 点击上传
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
}

async function handleFiles(files) {
    const progressBar = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    const progressSpeed = document.querySelector('.progress-speed');
    const uploadProgress = document.querySelector('.upload-progress');
    
    uploadProgress.style.display = 'block';
    
    for (const file of files) {
        // 检查文件类型是否在允许列表中 - 添加更健壮的检查
        try {
            if (!file || !file.type) {
                showToast(`文件类型无效`, 'error');
                continue;
            }
            
            // 默认基本检查 - 确保是图片文件
            if (!file.type.startsWith('image/')) {
                showToast(`只支持图片文件，当前文件类型: ${file.type}`, 'error');
                continue;
            }
            
            // 如果有具体的类型限制，进行精确匹配
            if (allowedFileTypes && allowedFileTypes.length > 0) {
                if (!allowedFileTypes.includes(file.type)) {
                    showToast(`不支持的文件类型: ${file.type}。允许的类型: ${allowedFileTypes.join(', ')}`, 'error');
                    continue;
                }
            }
            
            const formData = new FormData();
            formData.append('file', file);
            
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/upload', true);
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressBar.style.width = percent + '%';
                        progressText.textContent = percent + '%';
                        
                        const speed = e.loaded / ((Date.now() - startTime) / 1000);
                        progressSpeed.textContent = formatFileSize(speed) + '/s';
                    }
                };
                
                const startTime = Date.now();
                
                xhr.onload = async () => {
                    if (xhr.status === 200) {
                        showToast('上传成功', 'success');
                        loadImages();
                    } else {
                        let errorMsg = '上传失败';
                        try {
                            const response = JSON.parse(xhr.responseText);
                            if (response.error) {
                                errorMsg = response.error;
                            }
                        } catch (e) {
                            console.error('解析响应失败:', e);
                        }
                        showToast(errorMsg, 'error');
                    }
                };
                
                xhr.onerror = () => {
                    showToast('上传失败，网络错误', 'error');
                };
                
                xhr.send(formData);
            } catch (error) {
                console.error('上传文件失败:', error);
                showToast('上传失败: ' + error.message, 'error');
            }
        } catch (error) {
            console.error('处理文件时出错:', error);
            showToast('处理文件时出错', 'error');
        }
    }
}

// 工具函数
function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('链接已复制', 'success');
    } catch (error) {
        console.error('复制失败:', error);
        showToast('复制失败', 'error');
    }
}

async function deleteImage(id) {
    try {
        const response = await fetch(`/api/images/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            showToast('删除成功', 'success');
            loadImages();
        } else {
            showToast('删除失败', 'error');
        }
    } catch (error) {
        console.error('删除图片失败:', error);
        showToast('删除失败', 'error');
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
} 
