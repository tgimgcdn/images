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
        
        // 清除现有的确认上传按钮
        const existingUploadBtn = document.querySelector('.confirm-upload-btn');
        if (existingUploadBtn) {
            existingUploadBtn.remove();
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
        let uploadedBytes = 0;
        const totalFiles = files.length;
        const totalBytes = Array.from(files).reduce((total, file) => total + file.size, 0);
        const uploadedResults = [];

        // 显示进度条并重置
        const uploadProgress = document.querySelector('.upload-progress');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        progressSpeed.textContent = '0 KB/s';
        uploadProgress.style.display = 'block';

        for (const file of files) {
            try {
                console.log(`开始上传文件: ${file.name}, 大小: ${file.size}`);
                
                // 使用支持进度的上传方法
                const result = await uploadFileWithProgress(file, (loaded, total) => {
                    // 计算总体进度 (已上传完成的文件 + 当前文件的进度)
                    const overallProgress = (uploadedBytes + loaded) / totalBytes;
                    const percent = Math.min(100, Math.round(overallProgress * 100));
                    
                    // 更新进度条
                    progressBar.style.width = percent + '%';
                    progressText.textContent = percent + '%';
                    
                    // 计算上传速度
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    if (elapsedSeconds > 0) {
                        const speed = (uploadedBytes + loaded) / elapsedSeconds;
                        progressSpeed.textContent = formatSpeed(speed);
                    }
                });
                
                if (result.success) {
                    uploadedCount++;
                    uploadedBytes += file.size;
                    uploadedResults.push(result.data);
                    
                    // 显示所有文件的上传结果
                    if (uploadedCount === totalFiles) {
                        showResult(uploadedResults);
                    }
                } else {
                    showToast(result.error || '上传失败');
                }
            } catch (error) {
                showToast(error.message);
            }
        }

        // 隐藏进度条
        uploadProgress.style.display = 'none';
        progressBar.style.width = '0%';

        // 清空文件列表和确认按钮
        const fileList = document.querySelector('.file-list');
        const confirmBtn = document.querySelector('.confirm-upload-btn');
        if (fileList) fileList.remove();
        if (confirmBtn) confirmBtn.remove();
    }

    // 使用XMLHttpRequest上传文件并显示进度
    function uploadFileWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('file', file);
            
            // 监听上传进度
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(e.loaded, e.total);
                }
            });
            
            // 监听请求完成
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (error) {
                        reject(new Error('解析响应失败: ' + error.message));
                    }
                } else {
                    let errorMessage = '上传失败';
                    let errorDetails = '';
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        errorMessage = errorResponse.error || `服务器错误 (${xhr.status})`;
                        errorDetails = errorResponse.details || '';
                        
                        // 处理特定类型的错误
                        if (xhr.status === 409) {
                            // 文件已存在冲突
                            errorMessage = `文件 "${file.name}" 已存在，请重命名后重试`;
                        } else if (xhr.status === 413) {
                            // 文件太大
                            errorMessage = '文件大小超过服务器限制';
                        } else if (xhr.status === 403) {
                            // 权限不足
                            errorMessage = '您没有权限上传文件';
                            if (errorResponse.error && errorResponse.error.includes('游客上传已禁用')) {
                                errorMessage = '游客上传已禁用，请登录后再试';
                            }
                        }
                    } catch (e) {
                        errorMessage = `服务器错误 (${xhr.status})`;
                    }
                    
                    const error = new Error(errorMessage);
                    error.details = errorDetails;
                    error.status = xhr.status;
                    reject(error);
                }
            });
            
            // 监听错误
            xhr.addEventListener('error', () => {
                const error = new Error('网络连接错误，请检查您的网络连接');
                error.isNetworkError = true;
                reject(error);
            });
            
            xhr.addEventListener('abort', () => {
                reject(new Error('上传已取消'));
            });
            
            // 发送请求
            xhr.open('POST', '/api/upload', true);
            xhr.send(formData);
        });
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
    function showToast(message, type = 'error', duration = 5000) {
        // 如果已有toast，先移除
        if (toast.style.display === 'block') {
            toast.style.display = 'none';
            setTimeout(() => showToast(message, type, duration), 300);
            return;
        }
        
        // 设置toast类型样式
        toast.className = 'toast';
        toast.classList.add(type);
        
        // 处理复杂的错误对象
        if (message instanceof Error) {
            let errorContent = `<div class="toast-title">${message.message}</div>`;
            if (message.details) {
                errorContent += `<div class="toast-details">${message.details}</div>`;
            }
            toast.innerHTML = errorContent;
        } else {
            toast.textContent = message;
        }
        
        // 添加关闭按钮
        const closeButton = document.createElement('span');
        closeButton.className = 'notification-close';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = function(e) {
            e.stopPropagation();
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
                toast.style.opacity = '1';
                toast.innerHTML = '';
            }, 300);
        };
        toast.appendChild(closeButton);
        
        toast.style.display = 'block';
        
        // 自动隐藏
        const toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
                toast.style.opacity = '1';
                toast.innerHTML = '';
            }, 300);
        }, duration);
        
        // 点击关闭
        toast.onclick = () => {
            clearTimeout(toastTimeout);
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
                toast.style.opacity = '1';
                toast.innerHTML = '';
            }, 300);
        };
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
        // 不再尝试移除特定的事件监听器，而是替换整个dropZone的事件
        
        // 创建新的拖放防止事件 - 这会阻止任何拖放操作
        const preventDrag = (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
        
        // 添加事件处理程序来阻止任何拖放操作
        dropZone.addEventListener('dragover', preventDrag);
        dropZone.addEventListener('dragenter', preventDrag);
        dropZone.addEventListener('dragleave', preventDrag);
        dropZone.addEventListener('drop', preventDrag);
        
        // 修改点击事件处理，允许链接点击通过
        dropZone.addEventListener('click', (e) => {
            // 检查点击的元素或其父元素是否是链接
            const isLink = e.target.tagName === 'A' || e.target.closest('a');
            
            // 如果是链接，就不阻止事件
            if (!isLink) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
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
