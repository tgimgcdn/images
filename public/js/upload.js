/**
 * 文件上传管理器
 * 处理文件上传界面、拖拽功能、上传队列和进度显示
 */

// 等待FileManager初始化完成
async function waitForChunkUploader() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50;
    
    const checkUploader = () => {
      attempts++;
      if (window.ChunkUploader) {
        resolve(window.ChunkUploader);
      } else if (attempts >= maxAttempts) {
        reject(new Error('ChunkUploader库加载超时'));
      } else {
        setTimeout(checkUploader, 100);
      }
    };
    
    checkUploader();
  });
}

// 初始化上传功能
async function initializeUpload() {
  try {
    // 确保有显示消息的函数
    if (typeof window.showToast !== 'function') {
      window.showToast = function(message, type = 'info') {
        console.log(`[${type}] ${message}`);
        alert(message);
      };
    }
    
    // 获取DOM元素
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadContainer = document.querySelector('.upload-container');
    
    if (!uploadBtn || !uploadContainer) {
      console.error('上传按钮或容器元素不存在');
      return;
    }
    
    // 确保ChunkUploader已加载
    try {
      await waitForChunkUploader();
      console.log('ChunkUploader已加载');
    } catch (error) {
      console.error('ChunkUploader加载失败:', error);
      return;
    }

    let pendingFiles = [];
    let currentUploader = null;
    let isUploading = false;

    // 点击上传按钮处理
    uploadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 创建文件选择器
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = 'image/*'; // 限制为图片类型
      
      // 监听文件选择
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
          handleSelectedFiles(fileInput.files);
        }
      });
      
      // 触发文件选择对话框
      fileInput.click();
    });
    
    // 处理选中的文件
    function handleSelectedFiles(files) {
      if (isUploading) {
        window.showToast('有上传正在进行中，请等待完成', 'warning');
        return;
      }
      
      // 转换FileList为Array以便操作
      pendingFiles = Array.from(files);
      
      if (pendingFiles.length === 0) {
        return;
      }
      
      // 显示预览和确认区域
      displayFilePreview(pendingFiles);
    }
    
    // 显示文件预览
    function displayFilePreview(files) {
      // 清除现有预览
      const existingPreview = document.querySelector('.file-preview-container');
      if (existingPreview) {
        existingPreview.remove();
      }
      
      // 创建预览容器
      const previewContainer = document.createElement('div');
      previewContainer.className = 'file-preview-container';
      
      // 创建文件列表
      const fileList = document.createElement('div');
      fileList.className = 'file-list';
      
      let totalSize = 0;
      
      // 添加每个文件的预览
      files.forEach((file, index) => {
        totalSize += file.size;
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        // 显示图片预览（如果是图片）
        if (file.type.startsWith('image/')) {
          const imgPreview = document.createElement('div');
          imgPreview.className = 'img-preview';
          
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(img.src); // 清理
          };
          
          imgPreview.appendChild(img);
          fileItem.appendChild(imgPreview);
        }
        
        // 文件信息
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = file.name;
        
        const fileSize = document.createElement('div');
        fileSize.className = 'file-size';
        fileSize.textContent = formatFileSize(file.size);
        
        // 删除按钮
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
          // 从队列中移除该文件
          pendingFiles.splice(index, 1);
          
          // 重新显示预览
          if (pendingFiles.length > 0) {
            displayFilePreview(pendingFiles);
          } else {
            previewContainer.remove();
          }
        });
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        fileItem.appendChild(fileInfo);
        fileItem.appendChild(removeBtn);
        
        fileList.appendChild(fileItem);
      });
      
      // 摘要信息
      const summaryInfo = document.createElement('div');
      summaryInfo.className = 'summary-info';
      summaryInfo.innerHTML = `共 ${files.length} 个文件，总大小 ${formatFileSize(totalSize)}`;
      
      // 上传按钮
      const uploadButton = document.createElement('button');
      uploadButton.className = 'upload-button';
      uploadButton.textContent = '开始上传';
      uploadButton.addEventListener('click', () => {
        startUpload();
      });
      
      // 取消按钮
      const cancelButton = document.createElement('button');
      cancelButton.className = 'cancel-button';
      cancelButton.textContent = '取消';
      cancelButton.addEventListener('click', () => {
        pendingFiles = [];
        previewContainer.remove();
      });
      
      // 按钮容器
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'button-container';
      buttonContainer.appendChild(uploadButton);
      buttonContainer.appendChild(cancelButton);
      
      // 进度容器（初始隐藏）
      const progressContainer = document.createElement('div');
      progressContainer.className = 'upload-progress-container';
      progressContainer.style.display = 'none';
      
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      
      const progressFill = document.createElement('div');
      progressFill.className = 'progress-fill';
      progressFill.style.width = '0%';
      
      const progressText = document.createElement('div');
      progressText.className = 'progress-text';
      progressText.textContent = '准备中...';
      
      const progressDetails = document.createElement('div');
      progressDetails.className = 'progress-details';
      
      progressBar.appendChild(progressFill);
      progressContainer.appendChild(progressBar);
      progressContainer.appendChild(progressText);
      progressContainer.appendChild(progressDetails);
      
      // 组装预览容器
      previewContainer.appendChild(fileList);
      previewContainer.appendChild(summaryInfo);
      previewContainer.appendChild(buttonContainer);
      previewContainer.appendChild(progressContainer);
      
      // 添加到上传容器
      uploadContainer.appendChild(previewContainer);
    }
    
    // 开始上传
    async function startUpload() {
      if (isUploading || pendingFiles.length === 0) {
        return;
      }
      
      isUploading = true;
      
      // 显示进度条，隐藏按钮
      const previewContainer = document.querySelector('.file-preview-container');
      const buttonContainer = previewContainer.querySelector('.button-container');
      const progressContainer = previewContainer.querySelector('.upload-progress-container');
      
      buttonContainer.style.display = 'none';
      progressContainer.style.display = 'block';
      
      const progressFill = progressContainer.querySelector('.progress-fill');
      const progressText = progressContainer.querySelector('.progress-text');
      const progressDetails = progressContainer.querySelector('.progress-details');
      
      // 处理每个文件
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const fileName = file.name;
        
        try {
          progressText.textContent = `上传文件 ${i + 1}/${pendingFiles.length}: ${fileName}`;
          progressDetails.textContent = '正在初始化...';
          
          // 创建上传器
          currentUploader = new ChunkUploader({
            apiBase: '',  // 使用相对路径
            onProgress: (percentage, stats) => {
              // 更新进度显示
              progressFill.style.width = `${percentage}%`;
              progressText.textContent = `上传文件 ${i + 1}/${pendingFiles.length}: ${fileName} (${percentage}%)`;
              
              // 显示详细信息
              let details = '';
              if (stats.currentSpeed > 0) {
                details += `速度: ${formatFileSize(stats.currentSpeed * 1024)}/s`;
              }
              if (stats.remainingTime !== null) {
                details += details ? ', ' : '';
                details += `剩余时间: ${formatTime(stats.remainingTime)}`;
              }
              details += `, 已上传: ${stats.uploadedChunks}/${stats.totalChunks} 分片`;
              
              progressDetails.textContent = details;
            },
            onStatusChange: (status, message) => {
              if (status === 'error') {
                progressDetails.textContent = `错误: ${message}`;
                progressDetails.style.color = 'red';
              } else if (status === 'completed') {
                progressDetails.textContent = '上传完成，处理中...';
                progressDetails.style.color = 'green';
              }
            },
            onError: (error) => {
              progressDetails.textContent = `错误: ${error.message}`;
              progressDetails.style.color = 'red';
              window.showToast(`上传失败: ${error.message}`, 'error');
            }
          });
          
          // 开始上传
          await currentUploader.upload(file);
          
          // 上传完成
          console.log(`文件 ${fileName} 上传成功`);
          
        } catch (error) {
          console.error(`文件 ${fileName} 上传失败:`, error);
          window.showToast(`文件 ${fileName} 上传失败: ${error.message}`, 'error');
          
          // 是否要继续下一个文件？这里选择继续
          continue;
        }
      }
      
      // 所有文件处理完成
      isUploading = false;
      currentUploader = null;
      pendingFiles = [];
      
      // 显示完成信息
      progressText.textContent = '所有文件上传完成';
      progressFill.style.width = '100%';
      progressDetails.textContent = '';
      
      // 添加关闭按钮
      const closeButton = document.createElement('button');
      closeButton.className = 'close-button';
      closeButton.textContent = '关闭';
      closeButton.addEventListener('click', () => {
        previewContainer.remove();
      });
      
      const closeContainer = document.createElement('div');
      closeContainer.className = 'close-container';
      closeContainer.appendChild(closeButton);
      
      previewContainer.appendChild(closeContainer);
      
      // 显示成功提示
      window.showToast('所有文件上传完成', 'success');
    }
    
    // 添加拖放功能
    uploadContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadContainer.classList.add('drag-over');
    });
    
    uploadContainer.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadContainer.classList.remove('drag-over');
    });
    
    uploadContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadContainer.classList.remove('drag-over');
      
      if (e.dataTransfer.files.length > 0) {
        handleSelectedFiles(e.dataTransfer.files);
      }
    });
    
    console.log('文件上传功能初始化完成');
    
  } catch (error) {
    console.error('初始化上传功能时出错:', error);
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
  if (seconds < 60) {
    return `${seconds}秒`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${mins}分`;
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 延迟一下初始化，确保其他脚本已加载
  setTimeout(() => {
    initializeUpload();
  }, 500);
}); 
