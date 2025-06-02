/**
 * 分块上传组件 - 能够处理大文件，避免CloudFlare CPU超时
 */

class ChunkedUploader {
  constructor(file, options = {}) {
    // 文件信息
    this.file = file;
    this.fileName = options.fileName || file.name;
    
    // 分块设置
    this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 默认5MB分块
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.uploadedChunks = [];
    
    // 状态
    this.status = 'ready'; // ready, uploading, paused, completed, error
    this.error = null;
    this.progress = 0;
    this.uploadStartTime = null;
    this.uploadSpeed = 0;
    this.remainingTime = 0;
    
    // 回调
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    // 初始化分块
    this._initChunks();
  }
  
  /**
   * 初始化文件分块
   */
  _initChunks() {
    this.chunks = [];
    
    for (let i = 0; i < this.totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      
      this.chunks.push({
        index: i,
        start: start,
        end: end,
        size: end - start,
        blob: this.file.slice(start, end),
        status: 'pending', // pending, uploading, uploaded, error
        uploadedAt: null,
        retries: 0,
        error: null
      });
    }
  }
  
  /**
   * 开始上传
   */
  async start() {
    if (this.status === 'uploading') {
      return;
    }
    
    this._setStatus('uploading');
    this.uploadStartTime = Date.now();
    this.currentChunkIndex = 0;
    
    // 首先创建上传会话
    try {
      await this._createUploadSession();
      await this._uploadNextChunk();
    } catch (error) {
      this._handleError(error);
    }
  }
  
  /**
   * 创建上传会话
   */
  async _createUploadSession() {
    const response = await fetch('/api/upload/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: this.fileName,
        fileSize: this.file.size,
        totalChunks: this.totalChunks,
        mimeType: this.file.type
      })
    });
    
    if (!response.ok) {
      let errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        errorText = errorJson.error || errorText;
      } catch (e) {}
      throw new Error(`创建上传会话失败: ${errorText}`);
    }
    
    const result = await response.json();
    this.sessionId = result.sessionId;
    
    if (!this.sessionId) {
      throw new Error('服务器未返回有效的会话ID');
    }
  }
  
  /**
   * 上传下一个分块
   */
  async _uploadNextChunk() {
    if (this.status !== 'uploading') {
      return;
    }
    
    if (this.currentChunkIndex >= this.totalChunks) {
      await this._completeUpload();
      return;
    }
    
    const chunk = this.chunks[this.currentChunkIndex];
    chunk.status = 'uploading';
    
    try {
      // 准备上传数据
      const formData = new FormData();
      formData.append('chunk', chunk.blob);
      formData.append('sessionId', this.sessionId);
      formData.append('chunkIndex', chunk.index);
      formData.append('totalChunks', this.totalChunks);
      
      // 上传分块
      const response = await fetch('/api/upload/chunk', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        let errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.error || errorText;
        } catch (e) {}
        throw new Error(`上传分块失败: ${errorText}`);
      }
      
      // 处理成功的分块上传
      chunk.status = 'uploaded';
      chunk.uploadedAt = Date.now();
      this.uploadedChunks.push(chunk.index);
      
      // 更新进度
      this._updateProgress();
      
      // 继续上传下一个分块
      this.currentChunkIndex++;
      await this._uploadNextChunk();
      
    } catch (error) {
      // 处理分块上传错误
      chunk.status = 'error';
      chunk.error = error.message;
      
      if (chunk.retries < 3) {
        // 重试
        chunk.retries++;
        console.log(`分块 ${chunk.index} 上传失败，正在重试 (${chunk.retries}/3)...`);
        setTimeout(() => this._uploadNextChunk(), 1000);
      } else {
        this._handleError(new Error(`分块 ${chunk.index} 上传失败，超过最大重试次数`));
      }
    }
  }
  
  /**
   * 完成上传过程
   */
  async _completeUpload() {
    try {
      const response = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          fileName: this.fileName,
          fileSize: this.file.size,
          mimeType: this.file.type
        })
      });
      
      if (!response.ok) {
        let errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.error || errorText;
        } catch (e) {}
        throw new Error(`完成上传失败: ${errorText}`);
      }
      
      const result = await response.json();
      
      this._setStatus('completed');
      this.onComplete(result);
      
    } catch (error) {
      this._handleError(error);
    }
  }
  
  /**
   * 更新上传进度
   */
  _updateProgress() {
    const uploadedSize = this.uploadedChunks.reduce((total, index) => {
      return total + this.chunks[index].size;
    }, 0);
    
    this.progress = Math.round((uploadedSize / this.file.size) * 100) / 100;
    
    // 计算上传速度
    const elapsedSeconds = (Date.now() - this.uploadStartTime) / 1000;
    if (elapsedSeconds > 0) {
      this.uploadSpeed = uploadedSize / elapsedSeconds;
      
      // 计算剩余时间
      const remainingBytes = this.file.size - uploadedSize;
      if (this.uploadSpeed > 0) {
        this.remainingTime = remainingBytes / this.uploadSpeed;
      }
    }
    
    this.onProgress({
      progress: this.progress,
      uploadedSize: uploadedSize,
      totalSize: this.file.size,
      speed: this.uploadSpeed,
      remainingTime: this.remainingTime
    });
  }
  
  /**
   * 处理错误
   */
  _handleError(error) {
    this.error = error;
    this._setStatus('error');
    this.onError(error);
  }
  
  /**
   * 设置上传状态
   */
  _setStatus(status) {
    this.status = status;
    this.onStatusChange(status);
  }
  
  /**
   * 暂停上传
   */
  pause() {
    if (this.status === 'uploading') {
      this._setStatus('paused');
    }
  }
  
  /**
   * 恢复上传
   */
  resume() {
    if (this.status === 'paused') {
      this._setStatus('uploading');
      this._uploadNextChunk();
    }
  }
  
  /**
   * 取消上传
   */
  cancel() {
    this._setStatus('cancelled');
    
    if (this.sessionId) {
      fetch('/api/upload/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId })
      }).catch(console.error);
    }
  }
}

// 导出上传组件
window.ChunkedUploader = ChunkedUploader; 
