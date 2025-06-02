/**
 * 管理后台分片上传实现
 * 实现了大文件分片上传，带进度显示，上传速度，剩余时间估计
 */
document.addEventListener('DOMContentLoaded', function() {
  // 初始化上传功能
  initUploadFeature();
});

/**
 * 初始化上传功能
 */
function initUploadFeature() {
  const fileInput = document.getElementById('file-input');
  const uploadButton = document.getElementById('upload-button');
  const dropZone = document.getElementById('drop-zone');
  const fileList = document.getElementById('file-list');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-progress-text');
  const statusText = document.getElementById('upload-status');
  const speedText = document.getElementById('upload-speed');
  const abortButton = document.getElementById('abort-upload');
  
  // 如果页面上没有所需的元素，动态创建
  if (!fileInput || !uploadButton) {
    setupUploadUi();
    return;
  }
  
  // 上传器实例
  let uploader = null;
  let isUploading = false;
  
  // 选择文件处理
  fileInput.addEventListener('change', function(e) {
    updateFileList(Array.from(e.target.files));
  });
  
  // 上传按钮处理
  uploadButton.addEventListener('click', function() {
    if (fileInput.files.length === 0) {
      alert('请先选择文件');
      return;
    }
    
    startUpload(fileInput.files);
  });
  
  // 拖放处理
  if (dropZone) {
    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', function() {
      dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        updateFileList(files);
        // 自动启动上传
        startUpload(files);
      }
    });
  }
  
  // 中止按钮处理
  if (abortButton) {
    abortButton.addEventListener('click', function() {
      if (uploader && isUploading) {
        uploader.abort();
        resetUploadUI();
        statusText.textContent = '上传已取消';
      }
    });
  }
  
  /**
   * 更新文件列表UI
   * @param {Array<File>} files 选择的文件列表
   */
  function updateFileList(files) {
    if (!fileList) return;
    
    fileList.innerHTML = '';
    
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = getFileIcon(file.type);
      
      const info = document.createElement('span');
      info.className = 'file-info';
      info.textContent = `${file.name} (${formatSize(file.size)})`;
      
      item.appendChild(icon);
      item.appendChild(info);
      fileList.appendChild(item);
    });
    
    fileList.style.display = files.length > 0 ? 'block' : 'none';
  }
  
  /**
   * 开始上传文件
   * @param {FileList} files 文件列表
   */
  function startUpload(files) {
    if (isUploading) return;
    
    const file = files[0]; // 当前只支持单文件上传
    
    // 显示进度条
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statusText.textContent = '正在初始化上传...';
    speedText.textContent = '';
    abortButton.style.display = 'inline-block';
    
    isUploading = true;
    
    // 创建ChunkUploader对象
    uploader = new ChunkUploader({
      chunkSize: 5 * 1024 * 1024, // 5MB分片
      concurrency: 3,             // 3个并发上传
      retries: 3,                 // 失败重试3次
      apiBase: '',                // API基础路径，根据实际情况修改
      
      // 进度回调
      onProgress: function(percentage, stats) {
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
        
        // 显示上传速度
        if (stats.currentSpeed > 0) {
          speedText.textContent = `${formatSpeed(stats.currentSpeed)} | 已上传:${formatSize(stats.processedBytes)}/${formatSize(stats.totalBytes)}`;
          
          // 显示剩余时间
          if (stats.remainingTime !== null) {
            speedText.textContent += ` | 剩余时间: ${formatTime(stats.remainingTime)}`;
          }
        }
      },
      
      // 状态变化回调
      onStatusChange: function(status, message) {
        statusText.textContent = message;
        
        if (status === 'error') {
          progressContainer.classList.add('error');
        } else if (status === 'completed') {
          progressContainer.classList.add('success');
          progressBar.style.width = '100%';
          progressText.textContent = '100%';
          abortButton.style.display = 'none';
          isUploading = false;
        }
      },
      
      // 成功回调
      onSuccess: function(result) {
        console.log('上传成功:', result);
        
        // 显示上传结果
        const resultDiv = document.createElement('div');
        resultDiv.className = 'upload-result';
        
        // 如果是图片，则显示预览
        if (result.mime_type && result.mime_type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = result.url;
          img.alt = result.filename;
          img.className = 'upload-preview';
          resultDiv.appendChild(img);
        }
        
        // 显示链接信息
        const linkInfo = document.createElement('div');
        linkInfo.className = 'link-info';
        
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.value = result.url;
        urlInput.readOnly = true;
        urlInput.className = 'url-input';
        
        const copyButton = document.createElement('button');
        copyButton.textContent = '复制链接';
        copyButton.className = 'copy-button';
        copyButton.onclick = function() {
          urlInput.select();
          document.execCommand('copy');
          copyButton.textContent = '已复制';
          setTimeout(() => { copyButton.textContent = '复制链接'; }, 2000);
        };
        
        linkInfo.appendChild(urlInput);
        linkInfo.appendChild(copyButton);
        resultDiv.appendChild(linkInfo);
        
        // 添加到页面
        const resultContainer = document.getElementById('upload-result') || document.createElement('div');
        if (!document.getElementById('upload-result')) {
          resultContainer.id = 'upload-result';
          progressContainer.parentNode.insertBefore(resultContainer, progressContainer.nextSibling);
        }
        resultContainer.innerHTML = '';
        resultContainer.appendChild(resultDiv);
        
        // 判断是否刷新图库
        if (typeof refreshGallery === 'function') {
          refreshGallery();
        }
        
        // 重置上传状态，准备下一次上传
        setTimeout(resetUploadUI, 3000);
      },
      
      // 错误回调
      onError: function(error) {
        console.error('上传错误:', error);
        statusText.textContent = `上传失败: ${error.message}`;
        progressContainer.classList.add('error');
        isUploading = false;
        abortButton.style.display = 'none';
      }
    });
    
    // 开始上传
    uploader.upload(file).catch(error => {
      console.error('上传失败:', error);
    });
  }
  
  /**
   * 重置上传UI
   */
  function resetUploadUI() {
    isUploading = false;
    fileInput.value = '';
    fileList.innerHTML = '';
    fileList.style.display = 'none';
    progressContainer.style.display = 'none';
    progressContainer.classList.remove('error', 'success');
    progressBar.style.width = '0%';
    progressText.textContent = '';
    statusText.textContent = '';
    speedText.textContent = '';
    abortButton.style.display = 'none';
  }
  
  /**
   * 获取文件类型图标
   * @param {string} type MIME类型
   * @returns {string} 图标标识
   */
  function getFileIcon(type) {
    if (type.startsWith('image/')) {
      return '🖼️';
    } else if (type.startsWith('video/')) {
      return '🎬';
    } else if (type.startsWith('audio/')) {
      return '🎵';
    } else if (type.includes('pdf')) {
      return '📄';
    } else {
      return '📁';
    }
  }
  
  /**
   * 格式化文件大小
   * @param {number} bytes 字节数
   * @returns {string} 格式化后的大小
   */
  function formatSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  }
  
  /**
   * 格式化上传速度
   * @param {number} kbps 速度(KB/s)
   * @returns {string} 格式化后的速度
   */
  function formatSpeed(kbps) {
    if (kbps < 1024) {
      return `${kbps.toFixed(1)} KB/s`;
    } else {
      return `${(kbps / 1024).toFixed(1)} MB/s`;
    }
  }
  
  /**
   * 格式化剩余时间
   * @param {number} seconds 秒数
   * @returns {string} 格式化后的时间
   */
  function formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds}秒`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    } else {
      return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`;
    }
  }
  
  /**
   * 动态设置上传UI
   */
  function setupUploadUi() {
    // 创建上传区域DOM
    const uploadContainer = document.createElement('div');
    uploadContainer.className = 'upload-container';
    uploadContainer.innerHTML = `
      <div id="drop-zone" class="drop-zone">
        <div class="upload-icon">📤</div>
        <p>拖放文件到这里，或</p>
        <input type="file" id="file-input" class="file-input" />
        <label for="file-input" class="file-input-label">选择文件</label>
        <button id="upload-button" class="upload-button">开始上传</button>
      </div>
      <div id="file-list" class="file-list" style="display:none;"></div>
      <div id="upload-progress-container" class="progress-container" style="display:none;">
        <div class="progress">
          <div id="upload-progress-bar" class="progress-bar"></div>
        </div>
        <div id="upload-progress-text" class="progress-text">0%</div>
        <div id="upload-status" class="status-text"></div>
        <div id="upload-speed" class="speed-text"></div>
        <button id="abort-upload" class="abort-button" style="display:none;">取消上传</button>
      </div>
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      .upload-container {
        margin: 20px 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .drop-zone {
        border: 2px dashed #aaa;
        border-radius: 8px;
        padding: 30px 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }
      .drop-zone:hover, .drop-zone.dragover {
        border-color: #007bff;
        background-color: rgba(0, 123, 255, 0.05);
      }
      .upload-icon {
        font-size: 48px;
        margin-bottom: 10px;
      }
      .file-input {
        display: none;
      }
      .file-input-label {
        display: inline-block;
        padding: 8px 16px;
        background-color: #f0f0f0;
        border-radius: 4px;
        cursor: pointer;
        margin: 10px;
        transition: all 0.2s;
      }
      .file-input-label:hover {
        background-color: #e0e0e0;
      }
      .upload-button {
        padding: 8px 16px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .upload-button:hover {
        background-color: #0069d9;
      }
      .file-list {
        margin-top: 15px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 10px;
      }
      .file-item {
        display: flex;
        align-items: center;
        padding: 8px;
        border-bottom: 1px solid #eee;
      }
      .file-item:last-child {
        border-bottom: none;
      }
      .file-icon {
        margin-right: 10px;
        font-size: 20px;
      }
      .progress-container {
        margin-top: 20px;
      }
      .progress {
        height: 20px;
        background-color: #f5f5f5;
        border-radius: 4px;
        overflow: hidden;
      }
      .progress-bar {
        height: 100%;
        background-color: #007bff;
        width: 0;
        transition: width 0.3s ease;
      }
      .progress-text {
        text-align: center;
        margin-top: 5px;
        font-weight: bold;
      }
      .status-text, .speed-text {
        margin-top: 5px;
        font-size: 14px;
        color: #555;
      }
      .abort-button {
        margin-top: 10px;
        padding: 5px 10px;
        background-color: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .abort-button:hover {
        background-color: #c82333;
      }
      .progress-container.error .progress-bar {
        background-color: #dc3545;
      }
      .progress-container.success .progress-bar {
        background-color: #28a745;
      }
      .upload-result {
        margin-top: 20px;
        padding: 15px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background-color: #f9f9f9;
      }
      .upload-preview {
        max-width: 100%;
        max-height: 300px;
        margin-bottom: 15px;
        border-radius: 4px;
      }
      .link-info {
        display: flex;
        margin-top: 10px;
      }
      .url-input {
        flex-grow: 1;
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 4px 0 0 4px;
      }
      .copy-button {
        padding: 6px 12px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 0 4px 4px 0;
        cursor: pointer;
      }
      .copy-button:hover {
        background-color: #0069d9;
      }
    `;
    
    // 将上传区域添加到页面中
    document.head.appendChild(style);
    
    // 找到合适的位置插入上传UI
    const targetElement = document.querySelector('.content-wrapper') || document.querySelector('main') || document.body;
    if (targetElement) {
      // 如果是在主内容区内，则找到合适的位置
      const heading = targetElement.querySelector('h1, h2, h3') || targetElement.firstElementChild;
      if (heading) {
        targetElement.insertBefore(uploadContainer, heading.nextElementSibling);
      } else {
        targetElement.prepend(uploadContainer);
      }
      
      // 重新初始化上传功能，因为DOM已更新
      setTimeout(initUploadFeature, 0);
    }
  }
} 
