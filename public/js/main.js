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

    // 初始化文件上传功能
    function initUpload() {
        // 点击上传按钮触发文件选择
        uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            fileInput.click();
        });

        // 点击上传区域触发文件选择
        dropZone.addEventListener('click', (e) => {
            // 如果点击的是上传按钮，不触发文件选择
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
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                showToast('只支持上传图片文件');
                continue;
            }

            // 显示文件信息
            showFileInfo(file);
        }
    }

    // 显示文件信息
    function showFileInfo(file) {
        // 创建文件信息容器
        const fileInfoContainer = document.createElement('div');
        fileInfoContainer.className = 'file-info-container';
        
        // 格式化文件大小
        const fileSize = formatFileSize(file.size);
        
        // 创建文件信息HTML
        fileInfoContainer.innerHTML = `
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-size">${fileSize}</div>
            </div>
            <button class="start-upload-btn">开始上传</button>
        `;

        // 添加到上传容器
        uploadContainer.appendChild(fileInfoContainer);

        // 绑定上传按钮事件
        const startUploadBtn = fileInfoContainer.querySelector('.start-upload-btn');
        startUploadBtn.addEventListener('click', () => {
            uploadFile(file, fileInfoContainer);
        });
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
    async function uploadFile(file, fileInfoContainer) {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        
        // 显示进度条
        document.querySelector('.upload-progress').style.display = 'block';
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percent + '%';
                progressText.textContent = percent + '%';
                
                // 计算上传速度
                const speed = e.loaded / ((Date.now() - startTime) / 1000);
                progressSpeed.textContent = formatSpeed(speed);
            }
        });

        const startTime = Date.now();
        
        try {
            const baseUrl = window.location.origin;
            const response = await new Promise((resolve, reject) => {
                xhr.open('POST', `${baseUrl}/api/upload`);
                xhr.setRequestHeader('Accept', 'application/json');
                
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        try {
                            const contentType = xhr.getResponseHeader('content-type');
                            if (!contentType || !contentType.includes('application/json')) {
                                throw new Error('Invalid response format');
                            }
                            const response = JSON.parse(xhr.responseText);
                            resolve(response);
                        } catch (error) {
                            reject(new Error('解析响应失败'));
                        }
                    } else {
                        try {
                            const contentType = xhr.getResponseHeader('content-type');
                            if (contentType && contentType.includes('application/json')) {
                                const error = JSON.parse(xhr.responseText);
                                reject(new Error(error.error || '上传失败'));
                            } else {
                                reject(new Error(`上传失败 (${xhr.status})`));
                            }
                        } catch (error) {
                            reject(new Error(`上传失败 (${xhr.status})`));
                        }
                    }
                };
                
                xhr.onerror = () => {
                    reject(new Error('网络错误'));
                };
                
                xhr.send(formData);
            });

            // 移除文件信息容器
            fileInfoContainer.remove();
            
            // 显示上传结果
            showResult(response.data);
        } catch (error) {
            showToast(error.message);
        } finally {
            // 隐藏进度条
            document.querySelector('.upload-progress').style.display = 'none';
            progressBar.style.width = '0%';
        }
    }

    // 显示上传结果
    function showResult(data) {
        resultContainer.style.display = 'block';
        
        // 设置各种格式的链接
        const linkInputs = document.querySelectorAll('.link-input');
        linkInputs[0].value = data.url;
        linkInputs[1].value = data.markdown;
        linkInputs[2].value = data.html;
        linkInputs[3].value = data.bbcode;
        
        // 添加复制功能
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.type;
                const input = btn.previousElementSibling;
                input.select();
                document.execCommand('copy');
                
                // 显示复制成功提示
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
            console.log('Checking guest upload settings...');
            const baseUrl = window.location.origin;
            const response = await fetch(`${baseUrl}/api/settings/guest-upload`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                credentials: 'same-origin'
            });

            console.log('Response status:', response.status);
            console.log('Response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            console.log('Content-Type:', contentType);

            if (!contentType || !contentType.includes('application/json')) {
                console.error('Invalid content type:', contentType);
                const text = await response.text();
                console.error('Response body:', text);
                throw new Error('Invalid response format');
            }

            const data = await response.json();
            console.log('Response data:', data);
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to load settings');
            }
            
            if (!data.data.allowGuestUpload) {
                // 如果禁用游客上传，显示提示信息
                dropZone.innerHTML = `
                    <div class="upload-content">
                        <i class="fas fa-lock upload-icon"></i>
                        <h2>游客上传已禁用</h2>
                        <p>请<a href="/admin/login.html">登录</a>后上传图片</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            if (retryCount < maxRetries) {
                retryCount++;
                const delay = 1000 * retryCount;
                console.log(`Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
                setTimeout(checkGuestUpload, delay);
            } else {
                showToast('加载设置失败，请刷新页面重试');
            }
        }
    }

    // 初始化上传功能
    initUpload();

    // 开始检查游客上传权限
    checkGuestUpload();
}); 
