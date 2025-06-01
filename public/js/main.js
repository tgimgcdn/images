document.addEventListener('DOMContentLoaded', async () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const resultContainer = document.querySelector('.result-container');
    const closeResult = document.getElementById('closeResult');
    const progressBar = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    const progressSpeed = document.querySelector('.progress-speed');
    const toast = document.getElementById('toast');
    const uploadContainer = document.querySelector('.upload-container');

    // 存储待上传的文件
    let pendingFiles = [];

    // 初始化文件上传功能
    function initUpload() {
        // 点击上传按钮触发文件选择
        uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        // 点击上传区域触发文件选择
        dropZone.addEventListener('click', (e) => {
            if (e.target === uploadBtn || uploadBtn.contains(e.target)) {
                return;
            }
            fileInput.click();
        });

        // 处理文件选择
        fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        // 处理拖放
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });

        // 处理粘贴
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData.items;
            const files = [];
            
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    files.push(items[i].getAsFile());
                }
            }
            
            if (files.length > 0) {
                handleFiles(files);
            }
        });

        // 关闭结果面板
        closeResult.addEventListener('click', () => {
            resultContainer.style.display = 'none';
        });
    }

    // 处理文件
    function handleFiles(files) {
        // 清空之前的文件列表
        const existingFileList = document.querySelector('.file-list');
        if (existingFileList) {
            existingFileList.remove();
        }

        // 创建文件列表容器
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        // 存储待上传的文件
        pendingFiles = Array.from(files);

        // 显示每个文件的信息
        pendingFiles.forEach(file => {
            if (!file.type.startsWith('image/')) {
                showToast('只支持上传图片文件');
                return;
            }

            const fileInfo = document.createElement('div');
            fileInfo.className = 'file-info-container';
            fileInfo.innerHTML = `
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            `;
            fileList.appendChild(fileInfo);
        });

        // 添加确认上传按钮
        const confirmUploadBtn = document.createElement('button');
        confirmUploadBtn.className = 'confirm-upload-btn';
        confirmUploadBtn.textContent = '确认上传';
        confirmUploadBtn.addEventListener('click', () => {
            uploadFiles(pendingFiles);
        });

        // 添加到上传容器
        uploadContainer.appendChild(fileList);
        uploadContainer.appendChild(confirmUploadBtn);
    }

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 上传文件
    async function uploadFiles(files) {
        const startTime = Date.now();
        let uploadedCount = 0;
        const totalFiles = files.length;
        const uploadedResults = [];

        // 显示进度条
        document.querySelector('.upload-progress').style.display = 'block';

        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || '上传失败');
                }

                const result = await response.json();
                uploadedCount++;
                uploadedResults.push(result.data);

                // 更新进度
                const percent = Math.round((uploadedCount / totalFiles) * 100);
                progressBar.style.width = percent + '%';
                progressText.textContent = percent + '%';

                // 计算上传速度
                const speed = (uploadedCount * file.size) / ((Date.now() - startTime) / 1000);
                progressSpeed.textContent = formatSpeed(speed);

                // 显示所有文件的上传结果
                if (uploadedCount === totalFiles) {
                    showResult(uploadedResults);
                }
            } catch (error) {
                showToast(error.message);
            }
        }

        // 隐藏进度条
        document.querySelector('.upload-progress').style.display = 'none';
        progressBar.style.width = '0%';

        // 清空文件列表和确认按钮
        const fileList = document.querySelector('.file-list');
        const confirmBtn = document.querySelector('.confirm-upload-btn');
        if (fileList) fileList.remove();
        if (confirmBtn) confirmBtn.remove();
    }

    // 显示上传结果
    function showResult(results) {
        resultContainer.style.display = 'block';
        
        // 设置各种格式的链接
        const linkInputs = document.querySelectorAll('.link-input');
        
        // 直接链接
        linkInputs[0].value = results.map(r => r.url).join('\n');
        
        // Markdown
        linkInputs[1].value = results.map(r => r.markdown).join('\n');
        
        // HTML
        linkInputs[2].value = results.map(r => r.html).join('\n');
        
        // BBCode
        linkInputs[3].value = results.map(r => r.bbcode).join('\n');
        
        // 添加复制功能
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.type;
                const input = btn.previousElementSibling;
                input.select();
                document.execCommand('copy');
                showToast('已复制到剪贴板');
            };
        });
    }

    // 显示提示消息
    function showToast(message) {
        toast.textContent = message;
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    }

    // 格式化速度显示
    function formatSpeed(bytesPerSecond) {
        if (bytesPerSecond < 1024) {
            return bytesPerSecond.toFixed(1) + ' B/s';
        } else if (bytesPerSecond < 1024 * 1024) {
            return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
        } else {
            return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s';
        }
    }

    // 检查是否允许游客上传
    let retryCount = 0;
    const maxRetries = 3;

    async function checkGuestUpload() {
        try {
            const response = await fetch('/api/settings/guest-upload', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Invalid response format');
            }

            const data = await response.json();
            console.log('游客上传权限检查结果:', data);
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to load settings');
            }
            
            // 检查是否有会话cookie（是否已登录）
            const isLoggedIn = document.cookie.includes('session_id=');
            
            // 如果未登录且不允许游客上传，则显示禁用信息
            if (!isLoggedIn && !data.data.allowGuestUpload) {
                console.log('未登录且游客上传已禁用，显示提示信息');
                dropZone.innerHTML = `
                    <div class="upload-content">
                        <i class="fas fa-lock upload-icon"></i>
                        <h2>游客上传已禁用</h2>
                        <p>请<a href="/admin/login.html">登录</a>后上传图片</p>
                    </div>
                `;
                // 禁用拖拽上传功能
                disableUpload();
            } else {
                console.log('允许上传，初始化上传功能');
                // 初始化上传功能
                initUpload();
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            if (retryCount < maxRetries) {
                retryCount++;
                const delay = 1000 * retryCount;
                setTimeout(checkGuestUpload, delay);
            } else {
                showToast('加载设置失败，请刷新页面重试');
                // 出错时默认允许上传，避免错误阻止已登录用户
                initUpload();
            }
        }
    }

    // 禁用上传功能
    function disableUpload() {
        // 移除所有上传相关的事件监听器
        dropZone.removeEventListener('dragover', handleDragOver);
        dropZone.removeEventListener('dragleave', handleDragLeave);
        dropZone.removeEventListener('drop', handleFileDrop);
        dropZone.removeEventListener('click', triggerFileInput);
        
        // 禁用文件输入框
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.disabled = true;
        }
        
        // 添加禁用样式
        dropZone.classList.add('disabled');
    }

    // 注释掉这个初始化调用，改为在checkGuestUpload后根据权限决定是否初始化
    // initUpload();

    // 开始检查游客上传权限
    checkGuestUpload();
}); 
