/**
 * ChunkUploader - 分片上传工具
 * 支持大文件分片上传，自动重试，并发控制，进度跟踪
 */
class ChunkUploader {
  /**
   * 创建分片上传器
   * @param {Object} options 配置选项
   * @param {number} [options.chunkSize=5*1024*1024] 分片大小（字节），默认5MB
   * @param {number} [options.concurrency=3] 并发上传数，默认3
   * @param {number} [options.retries=3] 失败重试次数，默认3
   * @param {string} [options.apiBase=''] API基础路径
   * @param {Function} [options.onProgress] 进度回调函数 (progress, stats) => {}
   * @param {Function} [options.onSuccess] 成功回调函数 (result) => {}
   * @param {Function} [options.onError] 错误回调函数 (error) => {}
   * @param {Function} [options.onStatusChange] 状态变化回调 (status, message) => {}
   */
  constructor(options = {}) {
    // 默认配置
    this.options = {
      chunkSize: 5 * 1024 * 1024, // 默认5MB
      concurrency: 3,             // 默认并发数
      retries: 3,                 // 默认重试次数
      apiBase: '',                // API基础路径
      onProgress: null,           // 进度回调
      onSuccess: null,            // 成功回调
      onError: null,              // 错误回调
      onStatusChange: null,       // 状态变化回调
      ...options
    };
    
    // 状态信息
    this.status = {
      uploading: false,           // 是否上传中
      aborted: false,             // 是否已中止
      uploadId: null,             // 上传ID
      file: null,                 // 当前上传文件
      totalChunks: 0,             // 总分片数
      uploadedChunks: 0,          // 已上传分片数
      currentSpeed: 0,            // 当前速度(KB/s)
      averageSpeed: 0,            // 平均速度(KB/s)
      remainingTime: null,        // 剩余时间(秒)
      startTime: null,            // 开始时间
      errors: [],                 // 错误列表
      message: '',                // 状态消息
    };
    
    // 队列与进度跟踪
    this.queue = [];              // 待上传分片队列
    this.activeUploads = 0;       // 当前活动上传数
    this.processedBytes = 0;      // 已处理字节数
    this.lastProgressUpdate = 0;  // 上次进度更新时间
    this.uploadedBytesSinceLastUpdate = 0; // 自上次更新以来上传的字节数(速度计算用)
    this.totalProcessingTime = 0; // 总处理时间
    this.speedHistory = [];       // 速度历史(用于计算平均速度)
    
    // 状态轮询计时器
    this.statusPollingTimer = null;
  }
  
  /**
   * 上传文件
   * @param {File} file 要上传的文件
   * @param {Object} [extraData={}] 额外的上传数据
   * @returns {Promise} 完成后的Promise
   */
  async upload(file, extraData = {}) {
    if (this.status.uploading) {
      throw new Error('上传已在进行中');
    }
    
    // 重置状态
    this.status = {
      uploading: true,
      aborted: false,
      uploadId: null,
      file: file,
      totalChunks: 0,
      uploadedChunks: 0,
      currentSpeed: 0,
      averageSpeed: 0,
      remainingTime: null,
      startTime: Date.now(),
      errors: [],
      message: '正在初始化上传...'
    };
    
    this.processedBytes = 0;
    this.lastProgressUpdate = Date.now();
    this.uploadedBytesSinceLastUpdate = 0;
    this.totalProcessingTime = 0;
    this.speedHistory = [];
    this._updateStatus('initializing', '正在初始化上传...');
    
    try {
      // 初始化上传
      const initResult = await this._initUpload(file, extraData);
      this.status.uploadId = initResult.upload_id;
      
      // 创建分片
      const chunks = this._createChunks(file, initResult.chunk_size || this.options.chunkSize);
      this.status.totalChunks = chunks.length;
      this.queue = [];
      
      // 准备上传队列
      for (let i = 0; i < chunks.length; i++) {
        this.queue.push({
          index: i,
          blob: chunks[i],
          attempts: 0,
          status: 'pending'
        });
      }
      
      this._updateStatus('uploading', `准备上传 ${chunks.length} 个分片`);
      
      // 启动状态检查轮询
      this._startStatusPolling();
      
      // 开始处理上传队列
      this._processQueue();
      
    } catch (error) {
      this._handleError(error);
      throw error;
    }
  }
  
  /**
   * 取消上传
   */
  abort() {
    this.status.aborted = true;
    this.queue = [];
    if (this.statusPollingTimer) {
      clearTimeout(this.statusPollingTimer);
      this.statusPollingTimer = null;
    }
    this._updateStatus('aborted', '上传已取消');
  }
  
  /**
   * 开始状态轮询
   * @private
   */
  _startStatusPolling() {
    // 清除可能存在的计时器
    if (this.statusPollingTimer) {
      clearTimeout(this.statusPollingTimer);
    }
    
    const pollStatus = async () => {
      // 如果上传已取消或上传ID不存在，则停止轮询
      if (this.status.aborted || !this.status.uploadId) {
        return;
      }
      
      try {
        const response = await fetch(`${this.options.apiBase}/api/upload/status?upload_id=${this.status.uploadId}`);
        if (!response.ok) {
          console.warn('获取上传状态失败:', response.status);
          this.statusPollingTimer = setTimeout(pollStatus, 2000);
          return;
        }
        
        const result = await response.json();
        
        // 更新本地状态计数
        this.status.uploadedChunks = result.chunks_completed;
        
        // 检查上传是否完成
        if (result.status === 'completed') {
          this._updateStatus('completed', '上传完成');
          
          if (this.options.onSuccess) {
            this.options.onSuccess({
              url: result.file_url,
              filename: result.filename,
              size: result.size,
              mime_type: result.mime_type
            });
          }
          
          // 清除轮询计时器
          clearTimeout(this.statusPollingTimer);
          this.statusPollingTimer = null;
          this.status.uploading = false;
          return;
        }
        
        // 检查上传是否失败
        if (result.status === 'failed') {
          this._handleError(new Error(result.error || '上传失败'));
          // 清除轮询计时器
          clearTimeout(this.statusPollingTimer);
          this.statusPollingTimer = null;
          return;
        }
        
        // 继续轮询
        this.statusPollingTimer = setTimeout(pollStatus, 2000);
        
      } catch (error) {
        console.error('轮询上传状态出错:', error);
        // 出错后继续轮询，但增加时间间隔
        this.statusPollingTimer = setTimeout(pollStatus, 3000);
      }
    };
    
    // 开始轮询（2秒后开始，给上传一些启动时间）
    this.statusPollingTimer = setTimeout(pollStatus, 2000);
  }
  
  /**
   * 初始化上传
   * @private
   * @param {File} file 要上传的文件
   * @param {Object} extraData 额外数据
   * @returns {Promise<Object>} 初始化结果
   */
  async _initUpload(file, extraData = {}) {
    const formData = {
      filename: file.name,
      size: file.size,
      type: file.type,
      total_chunks: Math.ceil(file.size / this.options.chunkSize),
      ...extraData
    };
    
    console.log('初始化上传', formData);
    
    const response = await fetch(`${this.options.apiBase}/api/upload/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      let errorMessage = `初始化上传失败: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // 忽略JSON解析错误
      }
      throw new Error(errorMessage);
    }
    
    return await response.json();
  }
  
  /**
   * 上传单个分片
   * @private
   * @param {Object} chunk 分片对象
   * @returns {Promise} 完成后的Promise
   */
  async _uploadChunk(chunk) {
    chunk.status = 'uploading';
    chunk.attempts++;
    
    try {
      const formData = new FormData();
      formData.append('upload_id', this.status.uploadId);
      formData.append('chunk_index', chunk.index);
      formData.append('total_chunks', this.status.totalChunks);
      formData.append('chunk', chunk.blob);
      
      const startTime = Date.now();
      const response = await fetch(`${this.options.apiBase}/api/upload/chunk`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        let errorMessage = `上传分片失败: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // 忽略JSON解析错误
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '上传分片失败');
      }
      
      // 更新进度信息
      chunk.status = 'completed';
      this.status.uploadedChunks++;
      
      // 更新处理字节数和时间
      const endTime = Date.now();
      const chunkSize = chunk.blob.size;
      this.processedBytes += chunkSize;
      this.uploadedBytesSinceLastUpdate += chunkSize;
      this.totalProcessingTime += (endTime - startTime);
      
      // 计算和更新速度
      this._updateProgress();
      
      return result;
      
    } catch (error) {
      console.error(`分片 ${chunk.index + 1}/${this.status.totalChunks} 上传失败:`, error);
      chunk.status = 'error';
      chunk.error = error.message;
      
      // 添加到错误列表
      this.status.errors.push({
        chunk: chunk.index,
        attempt: chunk.attempts,
        message: error.message
      });
      
      // 检查是否可以重试
      if (chunk.attempts < this.options.retries) {
        console.log(`将重试分片 ${chunk.index + 1}/${this.status.totalChunks}，尝试次数: ${chunk.attempts}`);
        chunk.status = 'pending';
        this.queue.push(chunk);
      } else {
        // 重试次数已用完
        if (!this.status.aborted) {
          this._handleError(new Error(`分片 ${chunk.index + 1} 上传失败，已重试 ${chunk.attempts} 次`));
        }
      }
      
      throw error;
    }
  }
  
  /**
   * 处理上传队列
   * @private
   */
  _processQueue() {
    // 如果已中止，不再处理
    if (this.status.aborted) {
      return;
    }
    
    // 检查是否有等待处理的分片，以及是否达到并发上限
    while (this.queue.length > 0 && this.activeUploads < this.options.concurrency) {
      const chunk = this.queue.shift();
      this.activeUploads++;
      
      // 上传分片
      this._uploadChunk(chunk)
        .catch(() => {
          // 错误已在_uploadChunk中处理
        })
        .finally(() => {
          this.activeUploads--;
          // 继续处理队列
          this._processQueue();
        });
    }
    
    // 检查是否全部完成
    if (this.queue.length === 0 && this.activeUploads === 0) {
      // 所有分片都已处理完毕
      console.log('所有分片已处理完毕，等待服务器确认');
      this._updateStatus('processing', '所有分片已上传，等待处理...');
    }
  }
  
  /**
   * 处理错误
   * @private
   * @param {Error} error 错误对象
   */
  _handleError(error) {
    this.status.uploading = false;
    
    console.error('上传错误:', error);
    
    this._updateStatus('error', error.message || '上传失败');
    
    if (this.options.onError) {
      this.options.onError(error);
    }
  }
  
  /**
   * 更新进度信息
   * @private
   */
  _updateProgress() {
    const now = Date.now();
    const elapsed = now - this.lastProgressUpdate;
    
    // 至少每500ms更新一次进度
    if (elapsed >= 500) {
      // 计算当前速度 (KB/s)
      const currentSpeed = (this.uploadedBytesSinceLastUpdate / 1024) / (elapsed / 1000);
      this.speedHistory.push(currentSpeed);
      
      // 只保留最近10次的速度记录
      if (this.speedHistory.length > 10) {
        this.speedHistory.shift();
      }
      
      // 计算平均速度
      const averageSpeed = this.speedHistory.reduce((sum, speed) => sum + speed, 0) / this.speedHistory.length;
      
      // 计算剩余时间 (秒)
      const remainingBytes = this.status.file.size - this.processedBytes;
      const remainingTime = averageSpeed > 0 ? remainingBytes / 1024 / averageSpeed : null;
      
      // 更新状态
      this.status.currentSpeed = Math.round(currentSpeed);
      this.status.averageSpeed = Math.round(averageSpeed);
      this.status.remainingTime = remainingTime !== null ? Math.ceil(remainingTime) : null;
      
      // 计算总进度百分比
      const percentage = Math.min(
        Math.round((this.processedBytes / this.status.file.size) * 100),
        99 // 最多显示99%，直到服务器确认完成
      );
      
      // 状态消息
      let message = `上传中: ${percentage}%`;
      if (this.status.remainingTime !== null) {
        message += `, 剩余时间: ${this._formatTime(this.status.remainingTime)}`;
      }
      
      // 调用进度回调
      if (this.options.onProgress) {
        this.options.onProgress(percentage, {
          processedBytes: this.processedBytes,
          totalBytes: this.status.file.size,
          uploadedChunks: this.status.uploadedChunks,
          totalChunks: this.status.totalChunks,
          currentSpeed: this.status.currentSpeed,
          averageSpeed: this.status.averageSpeed,
          remainingTime: this.status.remainingTime,
          elapsed: Math.round((now - this.status.startTime) / 1000)
        });
      }
      
      // 更新状态记录
      this.lastProgressUpdate = now;
      this.uploadedBytesSinceLastUpdate = 0;
    }
  }
  
  /**
   * 将文件分割成小块
   * @private
   * @param {File} file 要分片的文件
   * @param {number} chunkSize 分片大小
   * @returns {Array<Blob>} 分片数组
   */
  _createChunks(file, chunkSize) {
    const chunks = [];
    let start = 0;
    
    while (start < file.size) {
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      chunks.push(chunk);
      start = end;
    }
    
    return chunks;
  }
  
  /**
   * 格式化剩余时间显示
   * @private
   * @param {number} seconds 秒数
   * @returns {string} 格式化后的时间
   */
  _formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds}秒`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    } else {
      return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`;
    }
  }
  
  /**
   * 格式化文件大小
   * @private
   * @param {number} bytes 字节数
   * @returns {string} 格式化后的大小
   */
  _formatSize(bytes) {
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
   * 更新上传状态
   * @private
   * @param {string} status 状态名称
   * @param {string} message 状态消息
   */
  _updateStatus(status, message) {
    console.log(`上传状态: ${status} - ${message}`);
    this.status.message = message;
    
    if (this.options.onStatusChange) {
      this.options.onStatusChange(status, message);
    }
  }
}

// 导出给全局使用
if (typeof window !== 'undefined') {
  window.ChunkUploader = ChunkUploader;
} 
