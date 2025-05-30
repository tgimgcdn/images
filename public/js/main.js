document.addEventListener('DOMContentLoaded', async () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadList = document.getElementById('uploadList');
    const resultContainer = document.querySelector('.result-container');
    const closeResult = document.getElementById('closeResult');
    const progressBar = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    const progressSpeed = document.querySelector('.progress-speed');
    const previewImage = document.querySelector('.preview-image');
    const toast = document.getElementById('toast');

    // 初始化文件上传功能
    function initUpload() {
        // 点击上传按钮触发文件选择
        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        // 点击上传区域触发文件选择
        dropZone.addEventListener('click', () => {
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

    // 处理文件上传
    async function handleFiles(files) {
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                showToast('只支持上传图片文件');
                continue;
            }

            try {
                await uploadFile(file);
            } catch (error) {
                showToast(error.message);
            }
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
                console.error('Invalid content type:', contentType);
                throw new Error('Invalid response format');
            }

            const data = await response.json();
            
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

    // 上传单个文件
    async function uploadFile(file) {
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
        
        return new Promise((resolve, reject) => {
            xhr.open('POST', '/api/upload');
            xhr.setRequestHeader('Accept', 'application/json');
            
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const contentType = xhr.getResponseHeader('content-type');
                        if (!contentType || !contentType.includes('application/json')) {
                            throw new Error('Invalid response format');
                        }
                        const response = JSON.parse(xhr.responseText);
                        showResult(response.data);
                        resolve(response);
                    } catch (error) {
                        console.error('Parse response error:', error);
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
    }

    // 显示上传结果
    function showResult(data) {
        resultContainer.style.display = 'block';
        
        // 设置预览图
        previewImage.src = data.url;
        
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

        // 隐藏进度条
        document.querySelector('.upload-progress').style.display = 'none';
        progressBar.style.width = '0%';
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

    // 初始化上传功能
    initUpload();

    // 开始检查游客上传权限
    checkGuestUpload();
}); 
