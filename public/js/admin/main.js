// 全局变量
let currentPage = 1;
let totalPages = 1;
let currentSort = 'newest';
let currentSearch = '';
let viewsChart = null;

// DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 初始化页面
    initNavigation();
    initDashboard();
    initImageManagement();
    initSettings();
    initUploadModal();
});

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
        const statsResponse = await fetch('/api/stats/summary', {
            credentials: 'include'
        });
        const stats = await statsResponse.json();
        
        // 更新统计卡片
        document.getElementById('totalImages').textContent = stats.total_images;
        document.getElementById('todayUploads').textContent = stats.today_uploads;
        document.getElementById('totalViews').textContent = stats.total_views;

        // 获取访问趋势数据
        const trendResponse = await fetch('/api/stats/trend', {
            credentials: 'include'
        });
        const trendData = await trendResponse.json();
        
        // 初始化图表
        initViewsChart(trendData);
    } catch (error) {
        console.error('加载控制面板数据失败:', error);
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

    // 初始加载图片
    loadImages();
}

async function loadImages() {
    try {
        const response = await fetch(`/api/images?page=${currentPage}&sort=${currentSort}&search=${currentSearch}`, {
            credentials: 'include'
        });
        const data = await response.json();
        
        // 更新图片列表
        const imageList = document.getElementById('imageList');
        imageList.innerHTML = '';
        
        data.images.forEach(image => {
            const imageCard = createImageCard(image);
            imageList.appendChild(imageCard);
        });
        
        // 更新分页
        totalPages = data.total_pages;
        updatePagination();
    } catch (error) {
        console.error('加载图片列表失败:', error);
    }
}

function createImageCard(image) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
        <div class="image-preview">
            <img src="${image.url}" alt="${image.name}">
        </div>
        <div class="image-info">
            <h3>${image.name}</h3>
            <p class="image-meta">
                <span>${formatDate(image.upload_time)}</span>
                <span>${formatFileSize(image.size)}</span>
            </p>
            <div class="image-actions">
                <button class="btn btn-primary copy-btn" data-url="${image.url}">
                    <i class="fas fa-copy"></i>
                    复制链接
                </button>
                <button class="btn btn-danger delete-btn" data-id="${image.id}">
                    <i class="fas fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
    `;
    
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
        const response = await fetch('/api/settings', {
            credentials: 'include'
        });
        const settings = await response.json();
        
        // 更新表单
        document.getElementById('allowGuestUpload').checked = settings.allow_guest_upload;
        document.getElementById('siteName').value = settings.site_name;
        
        // 保存设置
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const settings = Object.fromEntries(formData.entries());
            
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(settings),
                    credentials: 'include'
                });
                
                if (response.ok) {
                    showToast('设置已保存', 'success');
                }
            } catch (error) {
                console.error('保存设置失败:', error);
                showToast('保存设置失败', 'error');
            }
        });
    } catch (error) {
        console.error('加载设置失败:', error);
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
        if (!file.type.startsWith('image/')) {
            showToast('只能上传图片文件', 'error');
            continue;
        }
        
        const formData = new FormData();
        formData.append('image', file);
        
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
                    showToast('上传失败', 'error');
                }
            };
            
            xhr.onerror = () => {
                showToast('上传失败', 'error');
            };
            
            xhr.send(formData);
        } catch (error) {
            console.error('上传文件失败:', error);
            showToast('上传失败', 'error');
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
