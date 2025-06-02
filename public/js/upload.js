/**
 * 文件上传管理器
 * 支持拖放、选择文件和粘贴上传
 * 提供友好的UI和进度显示
 */

// 等待ChunkUploader加载完成
async function waitForChunkUploader() {
  return new Promise((resolve) => {
    const checkUploader = () => {
      if (typeof ChunkUploader === 'function') {
        console.log('ChunkUploader已加载');
        resolve();
      } else {
        console.log('等待ChunkUploader...');
        setTimeout(checkUploader, 100);
      }
    };
    checkUploader();
  });
}

// 初始化上传功能
async function initializeUpload() {
  // 确保showToast函数已定义
  if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 5000) {
      const toast = document.getElementById('toast') || document.createElement('div');
      toast.id = 'toast';
      toast.className = `toast ${type}`;
      toast.textContent = message;
      
      if (!document.body.contains(toast)) {
        document.body.appendChild(toast);
      }
      
      toast.classList.add('show');
      
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }, duration);
    };
  }
  
  // 查找必要的DOM元素
  const uploadButton = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.querySelector('.drop-zone');
  const resultContainer = document.querySelector('.result-container');
  
  // 如果任何必需的元素不存在，记录错误并返回
  if (!uploadButton || !fileInput || !dropZone) {
    console.error('找不到必要的上传元素', { 
      uploadButton: !!uploadButton, 
      fileInput: !!fileInput, 
      dropZone: !!dropZone 
    });
    return;
  }
  
  console.log('初始化上传功能');
  
  // 等待ChunkUploader加载完成
  try {
    await waitForChunkUploader();
  } catch (err) {
    console.warn('无法加载ChunkUploader:', err);
    // 继续执行，我们将在上传时检查
  }
  
  // 点击上传按钮触发文件选择
  uploadButton.addEventListener('click', () => {
    fileInput.click();
  });
  
  // 文件选择处理
  fileInput.addEventListener('change', (e) => {
    handleSelectedFiles(e.target.files);
  });
  
  // 拖放功能
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
    handleSelectedFiles(e.dataTransfer.files);
  });
  
  // 粘贴上传功能
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        files.push(file);
      }
    }
    
    if (files.length > 0) {
      console.log('从剪贴板获取文件:', files.length);
      handleSelectedFiles(files);
    }
  });
}

// 处理选择的文件
function handleSelectedFiles(files) {
  // 如果没有选择文件，直接返回
  if (!files || files.length === 0) {
    return;
  }
  
  // 过滤支持的文件类型
  const supportedFiles = Array.from(files).filter(file => {
    if (file.type.startsWith('image/')) {
      return true;
    } else {
      showToast(`不支持的文件类型: ${file.name}`, 'error');
      return false;
    }
  });
  
  if (supportedFiles.length === 0) {
    return;
  }
  
  // 显示文件预览
  displayFilePreview(supportedFiles);
}

// 显示文件预览和上传表单
function displayFilePreview(files) {
  const uploadContainer = document.querySelector('.upload-container');
  const dropZone = document.querySelector('.drop-zone');
  
  // 创建或清空文件列表
  let fileList = document.querySelector('.file-list');
  if (!fileList) {
    fileList = document.createElement('div');
    fileList.className = 'file-list';
    uploadContainer.appendChild(fileList);
  } else {
    fileList.innerHTML = '';
  }
  
  // 隐藏拖放区域
  if (dropZone) {
    dropZone.style.display = 'none';
  }
  
  // 显示每个文件的预览
  files.forEach(file => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-info-container';
    
    const fileSize = formatFileSize(file.size);
    
    // 创建图片预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // 添加文件信息和预览
        fileItem.innerHTML = `
          <div class="file-preview">
            <img src="${e.target.result}" alt="${file.name}">
          </div>
          <div class="file-info">
            <div class="file-name" title="${file.name}">${file.name}</div>
            <div class="file-size">${fileSize}</div>
          </div>
        `;
        
        // 将文件项添加到文件列表
        fileList.appendChild(fileItem);
        
        // 确保滚动到视图
        fileItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      reader.readAsDataURL(file);
    } else {
      // 非图片文件只显示名称和大小
      fileItem.innerHTML = `
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-size">${fileSize}</div>
        </div>
      `;
      fileList.appendChild(fileItem);
    }
  });
  
  // 创建上传按钮
  let uploadButton = document.querySelector('.start-upload-btn');
  if (!uploadButton) {
    uploadButton = document.createElement('button');
    uploadButton.className = 'start-upload-btn';
    uploadButton.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> 开始上传';
    uploadButton.addEventListener('click', () => {
      startUpload(files);
    });
    uploadContainer.appendChild(uploadButton);
  }
  
  // 创建进度条容器（如果不存在）
  let progressContainer = document.querySelector('.upload-progress');
  if (!progressContainer) {
    progressContainer = document.createElement('div');
    progressContainer.className = 'upload-progress';
    progressContainer.innerHTML = `
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
      <div class="progress-info">
        <span class="progress-text">0%</span>
        <span class="progress-speed">0 KB/s</span>
        <span class="progress-time"></span>
      </div>
    `;
    progressContainer.style.display = 'none';
    uploadContainer.appendChild(progressContainer);
  }
  
  // 创建取消按钮
  let cancelButton = document.querySelector('.cancel-upload-btn');
  if (!cancelButton) {
    cancelButton = document.createElement('button');
    cancelButton.className = 'cancel-upload-btn';
    cancelButton.innerHTML = '取消';
    cancelButton.style.display = 'none';
    uploadContainer.appendChild(cancelButton);
  }
}

// 开始上传文件
async function startUpload(files) {
  // 如果没有文件，直接返回
  if (!files || files.length === 0) {
    return;
  }
  
  // 每次只上传一个文件，获取第一个文件
  const file = files[0];
  
  // 显示进度条
  const progressContainer = document.querySelector('.upload-progress');
  const progressBar = document.querySelector('.progress-fill');
  const progressText = document.querySelector('.progress-text');
  const progressSpeed = document.querySelector('.progress-speed');
  const progressTime = document.querySelector('.progress-time');
  
  if (progressContainer) {
    progressContainer.style.display = 'block';
  }
  
  // 隐藏上传按钮，显示取消按钮
  const uploadButton = document.querySelector('.start-upload-btn');
  const cancelButton = document.querySelector('.cancel-upload-btn');
  
  if (uploadButton) {
    uploadButton.style.display = 'none';
  }
  
  if (cancelButton) {
    cancelButton.style.display = 'block';
  }
  
  let uploader;
  let isAborted = false;
  
  // 设置取消按钮功能
  if (cancelButton) {
    cancelButton.onclick = () => {
      isAborted = true;
      if (uploader) {
        uploader.abort();
      }
      // 重置UI
      resetUI();
      showToast('上传已取消', 'warning');
    };
  }
  
  try {
    if (typeof ChunkUploader === 'function' && file.size > 1024 * 1024) { // 大于1MB使用分片上传
      console.log('使用分片上传，文件大小: ' + formatFileSize(file.size));
      
      // 创建ChunkUploader实例
      uploader = new ChunkUploader({
        onProgress: (progress) => {
          if (progressBar) {
            progressBar.style.width = `${progress.percentage}%`;
          }
          if (progressText) {
            progressText.textContent = `${progress.percentage}%`;
          }
          if (progressSpeed) {
            progressSpeed.textContent = progress.speed;
          }
          if (progressTime) {
            progressTime.textContent = `剩余: ${progress.remaining}`;
          }
        },
        onStatusChange: (status) => {
          console.log('上传状态变更:', status);
          if (status.status === 'error' && !isAborted) {
            showToast(`上传失败: ${status.message}`, 'error');
          }
        }
      });
      
      // 开始上传
      const result = await uploader.upload(file);
      
      if (result.success) {
        console.log('上传成功:', result);
        resetUI();
        showUploadResult(result.file);
      } else {
        console.error('上传失败:', result.error);
        if (!isAborted) {
          showToast(`上传失败: ${result.error || '未知错误'}`, 'error');
        }
      }
      
    } else {
      // 小文件使用标准上传
      console.log('使用标准上传，文件大小: ' + formatFileSize(file.size));
      
      const formData = new FormData();
      formData.append('file', file);
      
      // 使用fetch API上传
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        // 添加进度监控
        xhr: () => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && !isAborted) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              if (progressBar) {
                progressBar.style.width = `${percentComplete}%`;
              }
              if (progressText) {
                progressText.textContent = `${percentComplete}%`;
              }
            }
          });
          return xhr;
        }
      });
      
      const result = await response.json();
      
      if (result.success) {
        resetUI();
        showUploadResult(result.file);
      } else {
        console.error('上传失败:', result.error);
        if (!isAborted) {
          showToast(`上传失败: ${result.error || '未知错误'}`, 'error');
        }
      }
    }
    
  } catch (error) {
    console.error('上传过程中出错:', error);
    if (!isAborted) {
      showToast(`上传出错: ${error.message}`, 'error');
      resetUI();
    }
  }
}

// 重置UI到初始状态
function resetUI() {
  const dropZone = document.querySelector('.drop-zone');
  const fileList = document.querySelector('.file-list');
  const progressContainer = document.querySelector('.upload-progress');
  const uploadButton = document.querySelector('.start-upload-btn');
  const cancelButton = document.querySelector('.cancel-upload-btn');
  
  // 显示拖放区域
  if (dropZone) {
    dropZone.style.display = 'flex';
  }
  
  // 清除文件列表
  if (fileList) {
    fileList.innerHTML = '';
    fileList.style.display = 'none';
  }
  
  // 隐藏进度条
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
  
  // 隐藏上传按钮和取消按钮
  if (uploadButton) {
    uploadButton.style.display = 'none';
  }
  
  if (cancelButton) {
    cancelButton.style.display = 'none';
  }
}

// 显示上传结果
function showUploadResult(file) {
  const resultContainer = document.querySelector('.result-container');
  
  if (!resultContainer) {
    console.error('找不到结果容器');
    return;
  }
  
  // 清空并显示结果容器
  resultContainer.innerHTML = '';
  resultContainer.style.display = 'block';
  
  // 创建结果内容
  const resultContent = document.createElement('div');
  resultContent.className = 'result-content';
  
  // 添加标题和关闭按钮
  resultContent.innerHTML = `
    <div class="result-header">
      <h3>上传成功!</h3>
      <button class="close-btn">&times;</button>
    </div>
  `;
  
  // 添加预览
  if (file.url && file.type && file.type.startsWith('image/')) {
    const previewContainer = document.createElement('div');
    previewContainer.className = 'preview-container';
    previewContainer.innerHTML = `<img class="preview-image" src="${file.url}" alt="${file.name}">`;
    resultContent.appendChild(previewContainer);
  }
  
  // 添加链接组
  const linkGroup = document.createElement('div');
  linkGroup.className = 'link-group';
  
  // URL链接
  const urlGroup = document.createElement('div');
  urlGroup.className = 'input-group';
  urlGroup.innerHTML = `
    <label>直接链接:</label>
    <div class="input-with-button">
      <input type="text" class="link-input" value="${file.url}" readonly>
      <button class="copy-btn" data-clipboard-text="${file.url}">复制</button>
    </div>
  `;
  linkGroup.appendChild(urlGroup);
  
  // Markdown链接
  const markdownGroup = document.createElement('div');
  markdownGroup.className = 'input-group';
  const markdownText = `![${file.name}](${file.url})`;
  markdownGroup.innerHTML = `
    <label>Markdown:</label>
    <div class="input-with-button">
      <input type="text" class="link-input" value="${markdownText}" readonly>
      <button class="copy-btn" data-clipboard-text="${markdownText}">复制</button>
    </div>
  `;
  linkGroup.appendChild(markdownGroup);
  
  // HTML链接
  const htmlGroup = document.createElement('div');
  htmlGroup.className = 'input-group';
  const htmlText = `<img src="${file.url}" alt="${file.name}">`;
  htmlGroup.innerHTML = `
    <label>HTML:</label>
    <div class="input-with-button">
      <input type="text" class="link-input" value="${htmlText}" readonly>
      <button class="copy-btn" data-clipboard-text="${htmlText}">复制</button>
    </div>
  `;
  linkGroup.appendChild(htmlGroup);
  
  // BBCode链接
  const bbcodeGroup = document.createElement('div');
  bbcodeGroup.className = 'input-group';
  const bbcodeText = `[img]${file.url}[/img]`;
  bbcodeGroup.innerHTML = `
    <label>BBCode:</label>
    <div class="input-with-button">
      <input type="text" class="link-input" value="${bbcodeText}" readonly>
      <button class="copy-btn" data-clipboard-text="${bbcodeText}">复制</button>
    </div>
  `;
  linkGroup.appendChild(bbcodeGroup);
  
  resultContent.appendChild(linkGroup);
  resultContainer.appendChild(resultContent);
  
  // 设置关闭按钮事件
  const closeBtn = resultContent.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    resultContainer.style.display = 'none';
  });
  
  // 设置复制按钮事件
  const copyButtons = resultContent.querySelectorAll('.copy-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = e.target.dataset.clipboardText;
      navigator.clipboard.writeText(text)
        .then(() => {
          const originalText = btn.textContent;
          btn.textContent = '已复制!';
          setTimeout(() => {
            btn.textContent = originalText;
          }, 1500);
        })
        .catch(err => {
          console.error('复制失败:', err);
          showToast('复制失败，请手动复制', 'error');
        });
    });
  });
  
  // 自动选中URL输入框
  const firstInput = resultContent.querySelector('.link-input');
  if (firstInput) {
    firstInput.select();
  }
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化时间
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) {
    return '计算中...';
  }
  
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  } else {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}分${secs < 10 ? '0' : ''}${secs}秒`;
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 初始化上传功能
  initializeUpload();
}); 
