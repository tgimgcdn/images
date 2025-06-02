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
    // 活跃的上传器列表
    let activeUploaders = [];

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

    // 上传文件 - 使用分块上传
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

        // 清除现有的上传器
        activeUploaders.forEach(uploader => {
            if (uploader.status === 'uploading') {
                uploader.cancel();
            }
        });
        activeUploaders = [];

        // 定义文件大小阈值，超过此值使用分块上传，否则使用普通上传
        const CHUNK_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB

        // 逐个上传文件
        for (const file of files) {
            try {
                console.log(`开始上传文件: ${file.name}, 大小: ${file.size}`);
                
                // 判断是否使用分块上传
                if (file.size > CHUNK_SIZE_THRESHOLD) {
                    console.log(`文件大小超过${formatFileSize(CHUNK_SIZE_THRESHOLD)}，使用分块上传`);
                    
                    // 创建分块上传器
                    const uploader = new ChunkedUploader(file, {
                        // 进度更新回调
                        onProgress: (progressData) => {
                            // 计算总体进度 (已上传完成的文件 + 当前文件的进度)
                            const fileContribution = progressData.uploadedSize / totalBytes;
                            const completedContribution = uploadedBytes / totalBytes;
                            const overallProgress = completedContribution + fileContribution;
                            const percent = Math.min(100, Math.round(overallProgress * 100));
                            
                            // 更新进度条
                            progressBar.style.width = percent + '%';
                            progressText.textContent = percent + '%';
                            
                            // 计算上传速度
                            const elapsedSeconds = (Date.now() - startTime) / 1000;
                            if (elapsedSeconds > 0) {
                                const speed = (uploadedBytes + progressData.uploadedSize) / elapsedSeconds;
                                progressSpeed.textContent = formatSpeed(speed);
                            }
                        },
                        // 上传完成回调
                        onComplete: (result) => {
                            uploadedCount++;
                            uploadedBytes += file.size;
                            uploadedResults.push(result.data);
                            
                            // 显示所有文件的上传结果
                            if (uploadedCount === totalFiles) {
                                showResult(uploadedResults);
                            }
                        },
                        // 错误处理回调
                        onError: (error) => {
                            showToast(error.message || '上传失败');
                        }
                    });
                    
                    activeUploaders.push(uploader);
                    uploader.start();
                } else {
                    // 小文件，使用普通上传方式
                    console.log(`文件大小小于${formatFileSize(CHUNK_SIZE_THRESHOLD)}，使用普通上传`);
                    
                    const result = await uploadFileWithXHR(file, (loaded, total) => {
                        // 计算总体进度
                        const fileContribution = loaded / totalBytes;
                        const completedContribution = uploadedBytes / totalBytes;
                        const overallProgress = completedContribution + fileContribution;
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
                    
                    uploadedCount++;
                    uploadedBytes += file.size;
                    
                    if (result.success) {
                        uploadedResults.push(result.data);
                        
                        if (uploadedCount === totalFiles) {
                            showResult(uploadedResults);
                        }
                    } else {
                        showToast(result.error || '上传失败');
                    }
                }
                
            } catch (error) {
                showToast(error.message);
            }
        }

        // 隐藏文件列表和确认按钮
        const fileList = document.querySelector('.file-list');
        const confirmBtn = document.querySelector('.confirm-upload-btn');
        if (fileList) fileList.remove();
        if (confirmBtn) confirmBtn.remove();
    }

    // 使用XMLHttpRequest上传小文件
    function uploadFileWithXHR(file, onProgress) {
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
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        errorMessage = errorResponse.error || `服务器错误 (${xhr.status})`;
                    } catch (e) {
                        errorMessage = `服务器错误 (${xhr.status})`;
                    }
                    reject(new Error(errorMessage));
                }
            });
            
            // 监听错误
            xhr.addEventListener('error', () => {
                reject(new Error('网络连接错误，请检查您的网络连接'));
            });
            
            xhr.addEventListener('abort', () => {
                reject(new Error('上传已取消'));
            });
            
            // 发送请求
            xhr.open('POST', '/api/upload?action=upload', true);
            xhr.send(formData);
        });
    }

    // 显示上传结果
    function showResult(results) {
        // 隐藏进度条
        const uploadProgress = document.querySelector('.upload-progress');
        uploadProgress.style.display = 'none';
        
        // 获取第一个结果用于显示
        const firstResult = results[0];
        
        if (!firstResult) {
            showToast('上传成功，但未返回链接信息');
            return;
        }
        
        // 更新各种链接格式
        const linkInputs = document.querySelectorAll('.link-input');
        
        // 直接链接
        linkInputs[0].value = firstResult.url;
        
        // Markdown
        linkInputs[1].value = firstResult.markdown;
        
        // HTML
        linkInputs[2].value = firstResult.html;
        
        // BBCode
        linkInputs[3].value = firstResult.bbcode;
        
        // 如果有多个文件，显示附加信息
        if (results.length > 1) {
            // 添加多文件上传信息
            const multipleFilesNotice = document.createElement('div');
            multipleFilesNotice.className = 'multiple-files-notice';
            multipleFilesNotice.innerHTML = `
                <p>成功上传了 ${results.length} 个文件：</p>
                <div class="all-links"></div>
            `;
            
            document.querySelector('.result-content').appendChild(multipleFilesNotice);
            
            // 添加所有文件的链接
            const allLinksContainer = multipleFilesNotice.querySelector('.all-links');
            results.forEach((result, index) => {
                const linkItem = document.createElement('div');
                linkItem.className = 'all-link-item';
                linkItem.innerHTML = `
                    <h4>文件 ${index + 1}</h4>
                    <div class="link-rows">
                        <div class="link-row">
                            <span class="link-label">URL:</span>
                            <input type="text" value="${result.url}" readonly>
                            <button class="copy-all-btn" data-link="${result.url}">复制</button>
                        </div>
                        <div class="link-row">
                            <span class="link-label">Markdown:</span>
                            <input type="text" value="${result.markdown}" readonly>
                            <button class="copy-all-btn" data-link="${result.markdown}">复制</button>
                        </div>
                        <div class="link-row">
                            <span class="link-label">HTML:</span>
                            <input type="text" value="${result.html}" readonly>
                            <button class="copy-all-btn" data-link="${result.html}">复制</button>
                        </div>
                        <div class="link-row">
                            <span class="link-label">BBCode:</span>
                            <input type="text" value="${result.bbcode}" readonly>
                            <button class="copy-all-btn" data-link="${result.bbcode}">复制</button>
                        </div>
                    </div>
                `;
                allLinksContainer.appendChild(linkItem);
            });
            
            // 添加复制按钮事件
            document.querySelectorAll('.copy-all-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const linkValue = btn.getAttribute('data-link');
                    copyToClipboard(linkValue);
                    showToast('链接已复制到剪贴板', 'success');
                });
            });
        }
        
        // 显示结果容器
        document.querySelector('.result-container').style.display = 'block';
        
        // 添加复制按钮事件
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-type');
                const inputElement = btn.previousElementSibling;
                copyToClipboard(inputElement.value);
                showToast('链接已复制到剪贴板', 'success');
            });
        });
    }

    // 显示消息提示
    function showToast(message, type = 'error', duration = 5000) {
        // 清除所有现有的提示
        clearTimeout(toast.timeoutId);
        
        // 设置提示内容和样式
        toast.textContent = message;
        toast.className = `toast ${type}`;
        
        // 显示提示
        toast.style.display = 'block';
        toast.style.opacity = '1';
        
        // 设置自动隐藏
        toast.timeoutId = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, duration);
    }
    
    // 复制到剪贴板
    function copyToClipboard(text) {
        // 创建一个临时输入框
        const input = document.createElement('textarea');
        input.style.position = 'fixed';
        input.style.opacity = 0;
        input.value = text;
        document.body.appendChild(input);
        
        // 选择并复制
        input.select();
        document.execCommand('copy');
        
        // 移除临时元素
        document.body.removeChild(input);
    }
    
    // 格式化上传速度
    function formatSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '0 B/s';
        
        const k = 1024;
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        
        return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // 检查是否允许游客上传
    async function checkGuestUpload() {
        try {
            const response = await fetch('/api/settings/guest-upload');
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success && data.data) {
                    const { allowGuestUpload } = data.data;
                    
                    if (!allowGuestUpload) {
                        disableUpload('游客上传当前已禁用，请联系管理员或登录后再试。');
                    }
                }
            } else {
                // 无法获取设置，假设允许上传
                console.warn('无法获取游客上传设置，默认允许上传');
            }
        } catch (error) {
            console.error('检查游客上传设置失败:', error);
            // 出错时默认允许上传
        }
    }
    
    // 禁用上传功能
    function disableUpload(message) {
        uploadBtn.disabled = true;
        uploadBtn.classList.add('disabled');
        
        const warningMessage = document.createElement('div');
        warningMessage.className = 'warning-message';
        warningMessage.textContent = message;
        
        // 移除现有的警告消息
        const existingWarning = document.querySelector('.warning-message');
        if (existingWarning) {
            existingWarning.remove();
        }
        
        // 添加警告消息
        uploadContainer.appendChild(warningMessage);
        
        // 阻止拖放
        const preventDrag = (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
        
        dropZone.addEventListener('dragover', preventDrag);
        dropZone.addEventListener('dragenter', preventDrag);
        dropZone.addEventListener('dragleave', preventDrag);
        dropZone.addEventListener('drop', preventDrag);
        
        // 修改样式
        dropZone.classList.add('disabled');
        uploadBtn.textContent = '上传已禁用';
    }
    
    // 初始化
    initUpload();
    checkGuestUpload();
}); 
