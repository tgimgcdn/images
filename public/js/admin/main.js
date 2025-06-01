// 全局变量
let currentPage = 1;
let totalPages = 1;
let currentSort = 'newest';
let currentSearch = '';
let isDebugMode = false; // 添加调试模式标志
let allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon']; // 默认允许的文件类型

// 批量删除相关变量和函数
let selectAllCheckbox;
let batchDeleteButton;
let imageGrid; // 定义全局变量，用于引用图片网格

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

        // 获取图片网格和分页元素
        imageGrid = document.getElementById('imageGrid');
        
        // 确保元素存在
        if (!imageGrid) {
            console.error('未找到图片网格元素，将创建一个新的');
            imageGrid = document.createElement('div');
            imageGrid.id = 'imageGrid';
            imageGrid.className = 'image-grid';
            
            // 尝试找到合适的位置插入这个元素
            const imagesSection = document.getElementById('images');
            if (imagesSection) {
                const toolbar = imagesSection.querySelector('.toolbar');
                if (toolbar) {
                    toolbar.after(imageGrid);
                } else {
                    imagesSection.appendChild(imageGrid);
                }
            } else {
                document.querySelector('.main-content').appendChild(imageGrid);
            }
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
            console.log('初始化批量操作');
            initBatchOperations();
            
            // 添加图片复选框变化事件委托
            document.addEventListener('change', function(e) {
                if (e.target.classList.contains('image-checkbox')) {
                    updateBatchButtonsState();
                }
            });
            
            // 加载图片列表
            console.log('加载图片列表');
            loadImages();
            
            // 最后尝试加载文件类型，如果失败不影响基本功能
            console.log('加载允许的文件类型');
            loadAllowedFileTypes().catch(err => {
                console.error('加载文件类型失败，使用默认值:', err);
            });
        }, 100);

        // 添加全屏预览容器
        const fullsizePreview = document.createElement('div');
        fullsizePreview.className = 'fullsize-preview';
        fullsizePreview.innerHTML = `
            <div class="preview-controls">
                <button class="zoom-in" title="放大"><i class="fas fa-search-plus"></i></button>
                <button class="zoom-out" title="缩小"><i class="fas fa-search-minus"></i></button>
                <button class="zoom-reset" title="重置缩放"><i class="fas fa-sync-alt"></i></button>
                <button class="close-preview">&times;</button>
            </div>
            <div class="preview-container">
                <img src="" alt="Full size preview" />
            </div>
            <div class="image-info-panel"></div>
        `;
        document.body.appendChild(fullsizePreview);
        
        // 缩放与拖动控制变量
        let currentZoom = 1;
        const zoomStep = 0.2;
        const previewContainer = fullsizePreview.querySelector('.preview-container');
        const previewImg = previewContainer.querySelector('img');
        
        // 拖动状态变量
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let currentTranslate = { x: 0, y: 0 };
        
        // 重置预览状态
        function resetPreview() {
            currentZoom = 1;
            currentTranslate = { x: 0, y: 0 };
            previewImg.style.transform = `scale(${currentZoom}) translate(${currentTranslate.x / currentZoom}px, ${currentTranslate.y / currentZoom}px)`;
            previewImg.style.cursor = 'default';
        }
        
        // 缩放按钮功能
        fullsizePreview.querySelector('.zoom-in').addEventListener('click', function(e) {
            e.stopPropagation();
            currentZoom = Math.min(8, currentZoom + zoomStep);
            previewImg.style.transform = `scale(${currentZoom}) translate(${currentTranslate.x / currentZoom}px, ${currentTranslate.y / currentZoom}px)`;
            
            // 放大时启用拖动样式
            if (currentZoom > 1.2) {
                previewImg.style.cursor = 'grab';
            }
        });
        
        fullsizePreview.querySelector('.zoom-out').addEventListener('click', function(e) {
            e.stopPropagation();
            currentZoom = Math.max(0.5, currentZoom - zoomStep);
            previewImg.style.transform = `scale(${currentZoom}) translate(${currentTranslate.x / currentZoom}px, ${currentTranslate.y / currentZoom}px)`;
            
            // 缩小到一定程度时关闭拖动样式
            if (currentZoom <= 1.2) {
                previewImg.style.cursor = 'default';
            }
        });
        
        fullsizePreview.querySelector('.zoom-reset').addEventListener('click', function(e) {
            e.stopPropagation();
            resetPreview();
        });
        
        // 拖动功能
        previewImg.addEventListener('mousedown', function(e) {
            // 只有放大到一定程度才启用拖动
            if (currentZoom <= 1.2) return;
            
            isDragging = true;
            dragStart = {
                x: e.clientX - currentTranslate.x,
                y: e.clientY - currentTranslate.y
            };
            previewImg.style.cursor = 'grabbing';
            e.preventDefault(); // 防止图片被拖拽
        });
        
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            
            currentTranslate = {
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            };
            
            previewImg.style.transform = `scale(${currentZoom}) translate(${currentTranslate.x / currentZoom}px, ${currentTranslate.y / currentZoom}px)`;
        });
        
        document.addEventListener('mouseup', function() {
            if (!isDragging) return;
            
            isDragging = false;
            previewImg.style.cursor = currentZoom > 1.2 ? 'grab' : 'default';
        });
        
        // 点击关闭按钮隐藏预览
        fullsizePreview.querySelector('.close-preview').addEventListener('click', function() {
            fullsizePreview.classList.remove('active');
            resetPreview();
        });
        
        // 点击背景也可以关闭预览
        fullsizePreview.addEventListener('click', function(e) {
            if (e.target === fullsizePreview || e.target === previewContainer) {
                fullsizePreview.classList.remove('active');
                resetPreview();
            }
        });
        
        // ESC键关闭预览
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && fullsizePreview.classList.contains('active')) {
                fullsizePreview.classList.remove('active');
                resetPreview();
            }
        });
        
        // 鼠标滚轮缩放
        fullsizePreview.addEventListener('wheel', function(e) {
            if (fullsizePreview.classList.contains('active')) {
                e.preventDefault();
                
                // 记录旧的缩放值
                const oldZoom = currentZoom;
                
                // 根据滚轮方向调整缩放
                if (e.deltaY < 0) {
                    currentZoom = Math.min(8, currentZoom + zoomStep); // 限制最大缩放8倍
                } else {
                    currentZoom = Math.max(0.5, currentZoom - zoomStep); // 限制最小缩放0.5倍
                }
                
                // 如果缩放值没变，则不需要更新变换
                if (oldZoom === currentZoom) return;

                // 应用缩放
                previewImg.style.transform = `scale(${currentZoom}) translate(${currentTranslate.x / currentZoom}px, ${currentTranslate.y / currentZoom}px)`;
                
                // 更新鼠标样式
                previewImg.style.cursor = currentZoom > 1.2 ? 'grab' : 'default';
            }
        }, { passive: false });

        // 添加全局下拉菜单容器 - 这将用于所有下拉菜单
        const globalDropdownContainer = document.createElement('div');
        globalDropdownContainer.className = 'global-dropdown-container';
        document.body.appendChild(globalDropdownContainer);

        // 点击页面其他地方关闭所有下拉菜单
        document.addEventListener('click', function(e) {
            // 如果点击的不是下拉菜单触发器，则关闭所有下拉菜单
            if (!e.target.closest('.dropdown-toggle')) {
                closeAllDropdowns();
            }
        });
    } catch (error) {
        console.error('初始化页面时出错:', error);
    }
});

// 系统设置功能
function initSettings() {
    console.log('初始化系统设置');
    const settingsForm = document.getElementById('settingsForm');
    if (!settingsForm) {
        console.error('未找到设置表单元素');
        return;
    }
    
    try {
        // 尝试从API获取当前设置
        safeApiCall('/api/settings')
            .then(settings => {
                if (!settings.error) {
                    console.log('已加载设置:', settings);
                    // 更新表单值
                    const allowGuestUpload = document.getElementById('allowGuestUpload');
                    const siteName = document.getElementById('siteName');
                    
                    if (allowGuestUpload) {
                        // 确保使用严格比较，string类型的'true'转换为布尔值
                        allowGuestUpload.checked = settings.allow_guest_upload === 'true';
                        console.log('设置游客上传状态:', allowGuestUpload.checked);
                    }
                    
                    if (siteName) {
                        siteName.value = settings.site_name || '参界图床';
                    }
                    
                    // 添加调试模式开关
                    addDebugModeToggle();
                }
            })
            .catch(err => {
                console.error('加载设置失败:', err);
                showNotification('加载设置失败', 'error');
                
                // 即使出错也添加调试模式开关
                addDebugModeToggle();
            });
        
        // 处理设置表单提交
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(settingsForm);
            const settings = {};
            
            // 特殊处理复选框
            settings.allow_guest_upload = document.getElementById('allowGuestUpload').checked ? 'true' : 'false';
            settings.site_name = document.getElementById('siteName').value;
            
            console.log('保存设置:', settings);
            
            try {
                const response = await safeApiCall('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(settings)
                });
                
                if (!response.error) {
                    console.log('设置保存成功');
                    showNotification('设置已保存', 'success');
                } else {
                    console.error('保存设置失败:', response.error);
                    showNotification('保存设置失败: ' + response.error, 'error');
                }
            } catch (error) {
                showNotification('保存设置失败', 'error');
                console.error('保存设置出错:', error);
            }
        });
    } catch (error) {
        console.error('初始化设置功能失败:', error);
    }
}

// 添加调试模式开关
function addDebugModeToggle() {
    const settingsForm = document.querySelector('.settings-form');
    if (!settingsForm) return;
    
    // 检查是否已经存在调试模式开关
    if (document.getElementById('debugModeToggle')) return;
    
    // 创建调试模式开关元素
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
    
    settingsForm.appendChild(debugModeContainer);
    
    // 添加开关事件处理
    document.getElementById('debugModeToggle').addEventListener('change', (e) => {
        isDebugMode = e.target.checked;
        localStorage.setItem('debugMode', isDebugMode);
        
        if (isDebugMode) {
            document.body.classList.add('debug-mode');
            showNotification('调试模式已启用', 'info');
        } else {
            document.body.classList.remove('debug-mode');
            showNotification('调试模式已关闭', 'info');
        }
        
        // 刷新数据
        initDashboard();
        loadImages();
    });
}

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
            document.getElementById('totalSize').textContent = '-';
        } else {
            // 更新统计卡片 - 只保留图片总数和今日上传
            document.getElementById('totalImages').textContent = stats.total_images || '0';
            document.getElementById('todayUploads').textContent = stats.today_uploads || '0';
            
            // 处理并显示图片总大小，保留2位小数
            const totalSizeElement = document.getElementById('totalSize');
            if (totalSizeElement) {
                const sizeInBytes = stats.total_size || 0;
                totalSizeElement.textContent = formatFileSize(sizeInBytes, 2);
            }
        }
    } catch (error) {
        console.error('加载控制面板数据失败:', error);
        showToast('加载控制面板数据失败', 'error');
    }
}

// 图片管理功能
function initImageManagement() {
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const uploadBtn = document.getElementById('uploadBtn');

    if (searchInput) {
        // 搜索功能
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentSearch = e.target.value.trim();
                currentPage = 1;
                loadImages();
            }, 300);
        });
        
        // 确保回车键也能触发搜索
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                currentSearch = e.target.value.trim();
                currentPage = 1;
                loadImages();
            }
        });
    } else {
        console.warn('未找到搜索输入框');
    }

    if (sortSelect) {
        // 排序功能
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            currentPage = 1;
            loadImages();
        });
    } else {
        console.warn('未找到排序选择框');
    }

    if (uploadBtn) {
        // 上传按钮
        uploadBtn.addEventListener('click', () => {
            const uploadModal = document.getElementById('uploadModal');
            if (uploadModal) {
                uploadModal.style.display = 'block';
            } else {
                console.error('未找到上传模态框');
            }
        });
    } else {
        console.warn('未找到上传按钮');
    }
}

// 初始化批量操作按钮
function initBatchOperations() {
    // 创建批量操作工具栏
    const batchOpsToolbar = document.createElement('div');
    batchOpsToolbar.className = 'batch-operations';
    batchOpsToolbar.innerHTML = `
        <div class="select-all-container">
            <input type="checkbox" id="selectAllImages">
            <label for="selectAllImages">全选</label>
        </div>
        <div class="batch-buttons">
            <div class="dropdown batch-copy-dropdown">
                <button id="batchCopyBtn" class="btn-primary dropdown-toggle" disabled>
                    <i class="fas fa-copy"></i> 批量复制
                </button>
            </div>
            <button id="batchDeleteBtn" class="btn-danger" disabled>
                <i class="fas fa-trash"></i> 批量删除
            </button>
        </div>
    `;
    
    // 将工具栏插入到图片网格上方
    const imageSection = document.querySelector('.image-section');
    if (imageSection) {
        imageSection.insertBefore(batchOpsToolbar, imageSection.firstChild);
    } else {
        // 如果找不到.image-section，则插入到图片网格上方
        if (imageGrid && imageGrid.parentNode) {
            imageGrid.parentNode.insertBefore(batchOpsToolbar, imageGrid);
        } else {
            console.warn('无法找到合适的位置插入批量操作工具栏');
            return; // 提前退出，避免后续出错
        }
    }
    
    // 获取引用
    selectAllCheckbox = document.getElementById('selectAllImages');
    batchDeleteButton = document.getElementById('batchDeleteBtn');
    const batchCopyButton = document.getElementById('batchCopyBtn');
    const batchCopyDropdown = document.querySelector('.batch-copy-dropdown');
    
    if (selectAllCheckbox) {
        // 添加全选事件监听
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.image-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
            });
            
            updateBatchButtonsState();
        });
    } else {
        console.warn('未找到全选复选框元素');
    }
    
    if (batchDeleteButton) {
        // 添加批量删除事件监听
        batchDeleteButton.addEventListener('click', batchDeleteImages);
    } else {
        console.warn('未找到批量删除按钮元素');
    }
    
    // 批量复制下拉菜单
    batchCopyButton.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        // 如果当前按钮已经激活，则关闭菜单并返回
        if (batchCopyButton.classList.contains('active')) {
            closeAllDropdowns();
            return;
        }
        
        // 先关闭所有已打开的下拉菜单
        closeAllDropdowns();
        
        // 获取选中的图片
        const checkedBoxes = document.querySelectorAll('.image-checkbox:checked');
        const selectedImages = [];
        
        // 获取所有选中图片信息
        checkedBoxes.forEach(checkbox => {
            const card = checkbox.closest('.image-card');
            const id = checkbox.dataset.id;
            
            // 查找图片URL和文件名
            const imageElement = card.querySelector('.image-preview img');
            const url = imageElement ? imageElement.src : '';
            const filename = card.querySelector('.image-filename').getAttribute('title');
            
            selectedImages.push({ id, url, filename });
        });
        
        if (selectedImages.length === 0) {
            showNotification('请选择要复制的图片', 'warning');
            return;
        }
        
        // 标记当前按钮为激活状态
        batchCopyButton.classList.add('active');
        
        // 创建下拉菜单项
        const menuItems = [
            { label: '复制URL', format: 'url' },
            { label: '复制Markdown', format: 'markdown' },
            { label: '复制BBCode', format: 'bbcode' },
            { label: '复制HTML', format: 'html' }
        ];
        
        // 使用全局下拉菜单
        showGlobalDropdown(menuItems, batchCopyButton, (format) => {
            // 根据格式生成复制内容，每个链接一行
            let copyText = '';
            selectedImages.forEach(img => {
                switch(format) {
                    case 'url':
                        copyText += `${img.url}\n`;
                        break;
                    case 'markdown':
                        copyText += `![${img.filename}](${img.url})\n`;
                        break;
                    case 'bbcode':
                        copyText += `[img]${img.url}[/img]\n`;
                        break;
                    case 'html':
                        copyText += `<img src="${img.url}" alt="${img.filename}">\n`;
                        break;
                }
            });
            
            // 移除最后一个换行符
            copyText = copyText.trim();
            
            navigator.clipboard.writeText(copyText)
                .then(() => {
                    showNotification(`已复制${selectedImages.length}张图片的${format.toUpperCase()}格式链接`, 'success');
                    closeAllDropdowns();
                })
                .catch(err => {
                    showNotification('复制失败: ' + err, 'error');
                });
        });
    });
}

// 更新批量操作按钮状态
function updateBatchButtonsState() {
    const checkedBoxes = document.querySelectorAll('.image-checkbox:checked');
    const hasCheckedItems = checkedBoxes.length > 0;
    
    if (batchDeleteButton) {
        batchDeleteButton.disabled = !hasCheckedItems;
    }
    
    const batchCopyButton = document.getElementById('batchCopyBtn');
    if (batchCopyButton) {
        batchCopyButton.disabled = !hasCheckedItems;
    }
}

// 点击页面其他地方关闭所有下拉菜单
document.addEventListener('click', function(e) {
    // 如果点击的不是下拉菜单触发器，则关闭所有下拉菜单
    if (!e.target.closest('.dropdown-toggle')) {
        closeAllDropdowns();
    }
});

// 添加一个新函数，用于单独更新控制面板上的统计数据
async function updateDashboardStats() {
    try {
        // 获取统计数据
        const stats = await safeApiCall('/api/stats/summary');
        
        if (stats.error) {
            console.error('更新统计数据失败:', stats.error);
            return;
        }
        
        // 更新统计卡片
        const totalImagesElement = document.getElementById('totalImages');
        const todayUploadsElement = document.getElementById('todayUploads');
        const totalSizeElement = document.getElementById('totalSize');
        
        if (totalImagesElement) {
            totalImagesElement.textContent = stats.total_images || '0';
        }
        
        if (todayUploadsElement) {
            todayUploadsElement.textContent = stats.today_uploads || '0';
        }
        
        if (totalSizeElement) {
            const sizeInBytes = stats.total_size || 0;
            totalSizeElement.textContent = formatFileSize(sizeInBytes, 2);
        }
    } catch (error) {
        console.error('更新控制面板统计数据失败:', error);
    }
}

// 修改单个图片删除函数
async function deleteImage(id) {
    try {
        const response = await safeApiCall(`/api/images/${id}`, {
            method: 'DELETE'
        });
        
        // 修复响应判断逻辑
        if (!response.error) {  // 改为判断是否有error字段，而不是判断ok属性
            // 从DOM中移除对应的图片卡片
            const card = document.querySelector(`.image-card[data-id="${id}"]`);
            if (card) {
                card.remove();
            }
            
            showNotification('图片已成功删除', 'success');
            
            // 更新仪表盘统计数据
            await updateDashboardStats();
            
            // 如果所有图片都被删除了，显示无图片提示
            if (document.querySelectorAll('.image-card').length === 0) {
                imageGrid.innerHTML = '<div class="no-images">暂无图片</div>';
                const paginationContainer = document.getElementById('pagination');
                if (paginationContainer) {
                    paginationContainer.innerHTML = '';
                }
            }
        } else {
            console.error('删除图片失败:', response.error);
            showNotification(`删除图片失败: ${response.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        console.error('删除图片时出错:', error);
        showNotification('删除图片失败: ' + error.message, 'error');
    }
}

// 批量删除图片
async function batchDeleteImages() {
    const checkedBoxes = document.querySelectorAll('.image-checkbox:checked');
    const imageIds = Array.from(checkedBoxes).map(checkbox => checkbox.dataset.id);
    
    if (imageIds.length === 0) {
        showNotification('请选择要删除的图片', 'warning');
        return;
    }
    
    if (confirm(`确定要删除选中的 ${imageIds.length} 张图片吗？此操作不可逆。`)) {
        try {
            batchDeleteButton.disabled = true;
            batchDeleteButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 删除中...';
            
            // 逐个删除图片
            let successCount = 0;
            let failCount = 0;
            
            for (const id of imageIds) {
                try {
                    const response = await safeApiCall(`/api/images/${id}`, {
                        method: 'DELETE'
                    });
                    
                    // 修复响应判断逻辑
                    if (!response.error) {  // 改为判断是否有error字段，而不是判断ok属性
                        successCount++;
                        // 从DOM中移除对应的图片卡片
                        const card = document.querySelector(`.image-card[data-id="${id}"]`);
                        if (card) {
                            card.remove();
                        }
                    } else {
                        failCount++;
                        console.error(`删除图片 ${id} 失败:`, response.error);
                    }
                } catch (err) {
                    failCount++;
                    console.error(`删除图片 ${id} 出错:`, err);
                }
            }
            
            // 更新仪表盘统计数据
            await updateDashboardStats();
            
            // 重置全选状态
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = false;
            }
            
            // 如果所有图片都被删除了，显示无图片提示
            if (document.querySelectorAll('.image-card').length === 0) {
                imageGrid.innerHTML = '<div class="no-images">暂无图片</div>';
                const paginationContainer = document.getElementById('pagination');
                if (paginationContainer) {
                    paginationContainer.innerHTML = '';
                }
            }
            
            // 显示结果
            let message = '';
            if (successCount > 0) {
                message += `成功删除 ${successCount} 张图片。`;
            }
            if (failCount > 0) {
                message += `${failCount} 张图片删除失败。`;
            }
            
            showNotification(message, successCount > 0 ? 'success' : 'error');
        } catch (error) {
            console.error('批量删除图片失败:', error);
            showNotification('批量删除操作失败: ' + error.message, 'error');
        } finally {
            batchDeleteButton.disabled = false;
            batchDeleteButton.innerHTML = '<i class="fas fa-trash"></i> 批量删除';
            updateBatchButtonsState();
        }
    }
}

// 显示通知消息
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 2秒后淡出
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 500);
    }, 2000);
}

// 设置分页
function setupPagination(total, currentPage, totalPages) {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;
    
    paginationContainer.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    const createPageButton = (page, text, isActive = false, isDisabled = false) => {
        const button = document.createElement('button');
        button.className = `page-btn ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;
        button.textContent = text;
        
        if (!isDisabled) {
            button.addEventListener('click', () => {
                loadImages(page, document.getElementById('searchInput')?.value || '');
            });
        }
        
        return button;
    };
    
    // 上一页按钮
    paginationContainer.appendChild(
        createPageButton(currentPage - 1, '上一页', false, currentPage === 1)
    );
    
    // 页码按钮
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        paginationContainer.appendChild(
            createPageButton(i, i.toString(), i === currentPage)
        );
    }
    
    // 下一页按钮
    paginationContainer.appendChild(
        createPageButton(currentPage + 1, '下一页', false, currentPage === totalPages)
    );
}

async function loadImages(page = 1, search = '') {
    if (!imageGrid) {
        console.error('图片网格元素不存在');
        return;
    }
    
    try {
        imageGrid.innerHTML = '<div class="loading-spinner"></div>';
        
        // 获取当前的搜索关键词
        const searchInput = document.getElementById('searchInput');
        search = search || (searchInput ? searchInput.value.trim() : '');
        
        // 构建API URL
        let url = `/api/images?page=${page}&limit=36`;
        if (search) {
            // 确保正确编码搜索参数
            url += `&search=${encodeURIComponent(search)}`;
            console.log(`执行搜索: "${search}"`);
        }
        
        if (currentSort) {
            url += `&sort=${currentSort}`;
        }
        
        console.log('加载图片，URL:', url);
        const data = await safeApiCall(url);
        
        if (data.error) {
            throw new Error(`Failed to load images: ${data.error}`);
        }
        
        // 清除当前显示
        imageGrid.innerHTML = '';
        
        if (data.images && data.images.length > 0) {
            // 显示图片
            data.images.forEach(image => {
                // 修复字段名称不匹配的问题
                const normalizedImage = {
                    id: image.id,
                    filename: image.name || image.filename,
                    url: image.url,
                    thumbnail_url: image.thumbnail_url || image.url,
                    size: image.size,
                    type: image.type,
                    views: image.views || 0,
                    created_at: image.upload_time || image.created_at
                };
                
                const card = createImageCard(normalizedImage);
                imageGrid.appendChild(card);
            });
            
            // 更新选中状态
            updateBatchButtonsState();
            
            // 设置分页
            setupPagination(data.total, data.page, data.total_pages || Math.ceil(data.total / 36));
        } else {
            // 没有图片时显示提示
            if (search) {
                imageGrid.innerHTML = `<div class="no-images">没有找到匹配"${search}"的图片</div>`;
            } else {
                imageGrid.innerHTML = '<div class="no-images">暂无图片</div>';
            }
            const paginationContainer = document.getElementById('pagination');
            if (paginationContainer) {
                paginationContainer.innerHTML = '';
            }
        }
    } catch (error) {
        console.error('Error loading images:', error);
        imageGrid.innerHTML = `<div class="error-message">加载图片失败: ${error.message}</div>`;
    }
}

function createImageCard(image) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.id = image.id;
    
    // 截断文件名，超过18个字符显示...
    const displayName = image.filename.length > 18 
        ? image.filename.substring(0, 18) + '...' 
        : image.filename;
    
    // 格式化文件大小，保留2位小数
    const formattedSize = formatFileSize(image.size, 2);
    
    card.innerHTML = `
        <div class="image-preview">
            <img src="${image.thumbnail_url || image.url}" alt="${image.filename}" loading="lazy">
        </div>
        <div class="image-info">
            <div class="filename-container">
                <input type="checkbox" class="image-checkbox" data-id="${image.id}">
                <span class="image-filename" title="${image.filename}">${displayName}</span>
            </div>
            <div class="image-meta">
                <span class="upload-date">${formatDate(image.created_at)}</span>
                <span class="file-size">${formattedSize}</span>
            </div>
        </div>
        <div class="image-actions">
            <div class="dropdown">
                <button class="btn-copy dropdown-toggle" title="复制链接">
                    <i class="fas fa-copy"></i> 复制
                </button>
            </div>
            <button class="btn-delete" data-id="${image.id}" title="删除图片">
                <i class="fas fa-trash"></i> 删除
            </button>
        </div>
    `;
    
    // 文件名提示工具
    const filenameSpan = card.querySelector('.image-filename');
    
    filenameSpan.addEventListener('mouseenter', function() {
        if (image.filename.length > 18) {
            // 使用浏览器原生的title属性来显示完整文件名
            // 而不是创建额外的tooltip元素
        }
    });
    
    // 添加点击预览大图功能
    const imagePreview = card.querySelector('.image-preview');
    imagePreview.addEventListener('click', function() {
        const fullsizePreview = document.querySelector('.fullsize-preview');
        const previewImg = fullsizePreview.querySelector('img');
        const infoPanel = fullsizePreview.querySelector('.image-info-panel');
        
        // 重置预览状态
        previewImg.style.transform = '';
        
        // 设置原图URL
        previewImg.src = image.url;
        
        // 设置图片信息
        infoPanel.innerHTML = `
            <div>文件名: ${image.filename}</div>
            <div>上传时间: ${formatDate(image.created_at)}</div>
            <div>尺寸: <span id="img-dimensions">加载中...</span></div>
        `;
        
        // 显示预览
        fullsizePreview.classList.add('active');
        
        // 图片加载完成后获取尺寸并可能调整初始显示大小
        previewImg.onload = function() {
            document.getElementById('img-dimensions').textContent = 
                `${previewImg.naturalWidth} × ${previewImg.naturalHeight}`;
            
            // 检查图片尺寸，对于较大图片可以适当默认放大一些
            if (previewImg.naturalWidth > window.innerWidth * 1.5 || 
                previewImg.naturalHeight > window.innerHeight * 1.5) {
                // 大图不做特殊处理，使用默认缩放
            } else {
                // 小图可以适当放大初始显示
                currentZoom = 1.2;
                previewImg.style.transform = `scale(${currentZoom})`;
            }
        };
    });
    
    // 复制按钮下拉菜单
    const dropdown = card.querySelector('.dropdown');
    const dropdownToggle = dropdown.querySelector('.dropdown-toggle');
    
    // 点击按钮显示下拉菜单
    dropdownToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        // 如果当前按钮已经激活，则关闭菜单并返回
        if (dropdownToggle.classList.contains('active')) {
            closeAllDropdowns();
            return;
        }
        
        // 先关闭所有已打开的下拉菜单
        closeAllDropdowns();
        
        // 标记当前按钮为激活状态
        dropdownToggle.classList.add('active');
        
        // 获取下拉菜单内容
        const menuItems = [];
        const formats = [
            { key: 'url', label: 'URL', url: image.url, filename: '' },
            { key: 'markdown', label: 'Markdown', url: image.url, filename: image.filename },
            { key: 'bbcode', label: 'BBCode', url: image.url, filename: '' },
            { key: 'html', label: 'HTML', url: image.url, filename: image.filename }
        ];
        
        formats.forEach(format => {
            menuItems.push({
                label: format.label,
                format: format.key,
                url: format.url,
                filename: format.filename
            });
        });
        
        // 使用全局下拉菜单
        showGlobalDropdown(menuItems, dropdownToggle, (format, url, filename) => {
            let copyText = '';
            switch(format) {
                case 'url':
                    copyText = url;
                    break;
                case 'markdown':
                    copyText = `![${filename}](${url})`;
                    break;
                case 'bbcode':
                    copyText = `[img]${url}[/img]`;
                    break;
                case 'html':
                    copyText = `<img src="${url}" alt="${filename}">`;
                    break;
            }
            
            navigator.clipboard.writeText(copyText)
                .then(() => {
                    showNotification(`已复制${format.toUpperCase()}格式链接`, 'success');
                    closeAllDropdowns();
                })
                .catch(err => {
                    showNotification('复制失败: ' + err, 'error');
                });
        });
    });
    
    // 删除按钮
    card.querySelector('.btn-delete').addEventListener('click', function(e) {
        e.stopPropagation();
        const imageId = this.dataset.id;
        if (confirm('确定要删除这张图片吗？此操作不可逆。')) {
            deleteImage(imageId);
        }
    });
    
    return card;
}

// 工具函数
function formatDate(timestamp) {
    if (!timestamp) {
        return '未知日期';
    }
    
    // 创建日期对象
    const date = new Date(timestamp);
    
    // 调整为北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    
    // 使用toLocaleString格式化日期，采用中文格式
    return beijingTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatFileSize(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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

// 新增全局函数用于关闭所有下拉菜单
function closeAllDropdowns() {
    // 移除全局下拉菜单
    const globalContainer = document.querySelector('.global-dropdown-container');
    if (globalContainer) {
        globalContainer.innerHTML = '';
    }
    
    // 重置所有下拉菜单触发器的激活状态
    document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
        toggle.classList.remove('active');
    });
}

// 新增函数：显示全局下拉菜单
function showGlobalDropdown(items, triggerElement, onItemClick) {
    const globalContainer = document.querySelector('.global-dropdown-container');
    if (!globalContainer) return;
    
    // 创建下拉菜单
    const menu = document.createElement('div');
    menu.className = 'dropdown-menu global-dropdown-menu show';
    
    // 添加菜单项
    items.forEach(item => {
        const menuItem = document.createElement('a');
        menuItem.href = "#";
        menuItem.className = 'dropdown-item';
        menuItem.textContent = item.label;
        
        menuItem.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (onItemClick) {
                onItemClick(item.format, item.url, item.filename);
            }
        });
        
        menu.appendChild(menuItem);
    });
    
    // 将菜单添加到全局容器
    globalContainer.appendChild(menu);
    
    // 定位菜单
    positionDropdownMenu(menu, triggerElement);
}

// 新增函数：定位下拉菜单
function positionDropdownMenu(menu, triggerElement) {
    // 获取触发元素的位置信息
    const triggerRect = triggerElement.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    
    // 设置菜单初始位置 - 相对于视口
    menu.style.position = 'fixed'; // 使用fixed而不是absolute，避免滚动问题
    
    if (isMobile) {
        // 移动设备上，在点击位置附近居中显示
        const menuWidth = 200; // 预估菜单宽度
        let leftPosition = triggerRect.left + (triggerRect.width / 2) - (menuWidth / 2);
        
        // 确保不会超出屏幕边缘
        leftPosition = Math.max(10, leftPosition);
        leftPosition = Math.min(window.innerWidth - menuWidth - 10, leftPosition);
        
        menu.style.left = leftPosition + 'px';
        
        // 在触发元素上方或下方显示，优先显示在下方
        if (triggerRect.bottom + 200 > window.innerHeight && triggerRect.top > 200) {
            // 如果下方空间不足且上方空间足够，则显示在上方
            menu.style.bottom = (window.innerHeight - triggerRect.top + 10) + 'px';
            menu.style.top = 'auto';
        } else {
            // 否则显示在下方
            menu.style.top = (triggerRect.bottom + 10) + 'px';
            menu.style.bottom = 'auto';
        }
    } else {
        // 桌面设备上，跟随触发元素定位
        menu.style.top = triggerRect.bottom + 'px';
        menu.style.left = triggerRect.left + 'px';
        
        // 确保菜单可见
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            // 检查水平方向 - 确保不超出右边界
            if (menuRect.right > windowWidth) {
                menu.style.left = 'auto';
                menu.style.right = (windowWidth - triggerRect.right) + 'px';
            }
            
            // 检查垂直方向 - 如果下方空间不足，则向上显示
            if (menuRect.bottom > windowHeight && triggerRect.top > menuRect.height) {
                menu.style.top = 'auto';
                menu.style.bottom = (windowHeight - triggerRect.top) + 'px';
            }
        }, 10); // 稍微延长超时确保DOM更新
    }
} 
