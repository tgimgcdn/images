/**
 * ChunkUploader - 分片上传工具
 * 支持：
 * 1. 分片上传大型文件
 * 2. 自动重试
 * 3. 并发控制
 * 4. 进度跟踪
 * 5. 状态跟踪
 * 6. 内存优化
 */
class ChunkUploader {
  /**
   * 创建上传器
   * @param {Object} options - 选项
   * @param {number} [options.chunkSize=2*1024*1024] - 分片大小（默认2MB）
   * @param {number} [options.maxRetries=3] - 最大重试次数
   * @param {number} [options.maxConcurrent=3] - 最大并发上传数
   * @param {Function} [options.onProgress] - 进度回调
   * @param {Function} [options.onSuccess] - 成功回调
   * @param {Function} [options.onError] - 错误回调
   * @param {Function} [options.onStatusChange] - 状态变化回调
   */
  constructor(options = {}) {
    // 配置参数
    this.chunkSize = options.chunkSize || 2 * 1024 * 1024; // 默认2MB
    this.maxRetries = options.maxRetries || 3;
    this.maxConcurrent = options.maxConcurrent || 3;
    
    // 回调函数
    this.onProgressCallback = options.onProgress;
    this.onSuccessCallback = options.onSuccess;
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    
    // 内部状态
    this.chunks = [];
    this.uploadId = null;
    this.isUploading = false;
    this.isAborted = false;
    this.totalLoaded = 0;
    this.totalSize = 0;
    this.totalChunks = 0;
    this.completedChunks = 0;
    this.startTime = null;
    this.activeUploads = 0;
    this.retries = {};
    this.statusPollingInterval = null;
    this.status = 'idle';
    this.file = null;
    
    // 绑定方法
    this._processQueue = this._processQueue.bind(this);
  }

  /**
   * 上传文件
   * @param {File} file - 要上传的文件
   * @param {Object} [extraData={}] - 额外的数据
   * @returns {Promise<Object>} - 上传结果
   */
  async upload(file, extraData = {}) {
    if (this.isUploading) {
      throw new Error('上传已在进行中，请等待完成或取消');
    }
    
    // 重置状态
    this.file = file;
    this.isUploading = true;
    this.isAborted = false;
    this.totalLoaded = 0;
    this.totalSize = file.size;
    this.startTime = Date.now();
    this.chunks = [];
    
    // 计算分片数量
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.completedChunks = 0;
    
    // 更新状态
    this._updateStatus('initializing', '正在初始化上传...');
    
    try {
      // 初始化上传
      const initResult = await this._initUpload(file, extraData);
      this.uploadId = initResult.upload_id;
      
      // 如果服务器建议使用不同的分片大小，调整分片大小
      if (initResult.chunk_size && initResult.chunk_size > 0) {
        this.chunkSize = initResult.chunk_size;
        this.totalChunks = Math.ceil(file.size / this.chunkSize);
      }
      
      // 更新状态
      this._updateStatus('uploading', '正在上传文件分片...');
      
      // 开始上传分片
      this._updateProgress();
      
      // 启动队列处理
      await this._processQueue();
      
      // 如果上传被中止，返回中止结果
      if (this.isAborted) {
        this._updateStatus('aborted', '上传已取消');
        return { success: false, error: '上传已取消' };
      }
      
      // 开始轮询状态
      const result = await this._startStatusPolling();
      return result;
    } catch (error) {
      this._handleError(error);
      throw error;
    } finally {
      // 重置上传状态
      this.isUploading = false;
      
      // 清理状态轮询
      if (this.statusPollingInterval) {
        clearInterval(this.statusPollingInterval);
        this.statusPollingInterval = null;
      }
    }
  }

  /**
   * 取消上传
   */
  abort() {
    if (!this.isUploading) return;
    
    this.isAborted = true;
    this.isUploading = false;
    this._updateStatus('aborting', '正在取消上传...');
    
    // 清理轮询
    if (this.statusPollingInterval) {
      clearInterval(this.statusPollingInterval);
      this.statusPollingInterval = null;
    }
  }

  /**
   * 启动状态轮询
   * @returns {Promise<Object>} - 上传结果
   */
  _startStatusPolling() {
    this._updateStatus('processing', '所有分片上传完成，等待服务器处理...');
    
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      const pollStatus = async () => {
        try {
          const response = await fetch(`/api/upload/status?upload_id=${this.uploadId}`);
          if (!response.ok) {
            throw new Error(`查询状态失败: ${response.status}`);
          }
          
          const result = await response.json();
          
          if (!result.success) {
            this._updateStatus('error', `处理失败: ${result.error || '未知错误'}`);
            clearInterval(this.statusPollingInterval);
            return reject(new Error(result.error || '处理失败'));
          }
          
          // 更新进度
          this.completedChunks = result.chunks_completed || this.completedChunks;
          this._updateProgress();
          
          // 检查状态
          if (result.status === 'completed') {
            clearInterval(this.statusPollingInterval);
            this._updateStatus('completed', '上传完成');
            resolve({
              success: true,
              file: {
                name: result.filename,
                url: result.file_url,
                size: result.size,
                type: result.mime_type
              }
            });
          } else if (result.status === 'failed') {
            clearInterval(this.statusPollingInterval);
            this._updateStatus('error', `处理失败: ${result.error || '未知错误'}`);
            reject(new Error(result.error || '处理失败'));
          } else if (attempts > 60) {
            // 1分钟超时
            clearInterval(this.statusPollingInterval);
            this._updateStatus('error', '处理超时');
            reject(new Error('处理超时'));
          }
        } catch (error) {
          console.error('查询上传状态出错:', error);
          
          if (attempts > 10) {
            clearInterval(this.statusPollingInterval);
            this._updateStatus('error', `查询状态失败: ${error.message}`);
            reject(error);
          }
        }
        
        attempts++;
      };
      
      // 立即第一次查询
      pollStatus().catch(reject);
      
      // 设置轮询间隔（每秒一次）
      this.statusPollingInterval = setInterval(pollStatus, 1000);
    });
  }

  /**
   * 初始化上传
   * @param {File} file - 要上传的文件
   * @param {Object} extraData - 额外的数据
   * @returns {Promise<Object>} - 初始化结果
   */
  async _initUpload(file, extraData = {}) {
    try {
      const response = await fetch('/api/upload/init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          type: file.type,
          total_chunks: this.totalChunks,
          ...extraData
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `服务器错误 (${response.status})`);
      }
      
      return await response.json();
    } catch (error) {
      this._updateStatus('error', `初始化上传失败: ${error.message}`);
      throw new Error(`初始化上传失败: ${error.message}`);
    }
  }

  /**
   * 上传单个分片
   * @param {number} chunkIndex - 分片索引
   * @returns {Promise<Object>} - 上传结果
   */
  async _uploadChunk(chunkIndex) {
    if (this.isAborted) {
      return { success: false, aborted: true };
    }
    
    try {
      // 只在需要上传时才创建分片，减少内存占用
      const start = chunkIndex * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.totalSize);
      const chunk = this.file.slice(start, end);
      
      const formData = new FormData();
      formData.append('upload_id', this.uploadId);
      formData.append('chunk_index', chunkIndex);
      formData.append('total_chunks', this.totalChunks);
      formData.append('chunk', chunk, `chunk-${chunkIndex}`);
      
      const response = await fetch('/api/upload/chunk', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        let errorMessage = `服务器错误 (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // 如果响应不是JSON，使用默认错误消息
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '上传分片失败');
      }
      
      // 更新已加载的大小
      const chunkSize = end - start;
      this.totalLoaded += chunkSize;
      this.completedChunks++;
      
      return result;
    } catch (error) {
      // 处理重试逻辑
      this.retries[chunkIndex] = (this.retries[chunkIndex] || 0) + 1;
      
      if (this.retries[chunkIndex] <= this.maxRetries) {
        console.warn(`分片 ${chunkIndex + 1}/${this.totalChunks} 上传失败，尝试重试 ${this.retries[chunkIndex]}/${this.maxRetries}`, error);
        
        // 等待短暂时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retries[chunkIndex]));
        
        // 递归重试
        return this._uploadChunk(chunkIndex);
      }
      
      // 超出重试次数，报告错误
      this._updateStatus('error', `分片 ${chunkIndex + 1} 上传失败: ${error.message}`);
      throw new Error(`分片 ${chunkIndex + 1}/${this.totalChunks} 上传失败: ${error.message}`);
    }
  }

  /**
   * 处理上传队列
   * @returns {Promise<void>}
   */
  async _processQueue() {
    if (this.isAborted) return;

    const pendingChunks = [];
    
    // 创建一个包含所有分片索引的数组
    for (let i = 0; i < this.totalChunks; i++) {
      pendingChunks.push(i);
    }
    
    // 使用Promise.all并发上传分片，但控制最大并发数
    const uploadPromises = [];
    let currentIndex = 0;

    const uploadNext = async () => {
      if (this.isAborted) return;
      
      if (currentIndex < this.totalChunks) {
        const chunkIndex = pendingChunks[currentIndex++];
        this.activeUploads++;
        
        try {
          await this._uploadChunk(chunkIndex);
        } catch (error) {
          console.error(`分片 ${chunkIndex + 1} 上传失败:`, error);
        } finally {
          this.activeUploads--;
          
          // 更新进度
          this._updateProgress();
          
          // 递归上传下一个
          return uploadNext();
        }
      }
    };
    
    // 启动初始的并发上传
    for (let i = 0; i < this.maxConcurrent; i++) {
      uploadPromises.push(uploadNext());
    }
    
    // 等待所有上传完成
    await Promise.all(uploadPromises);
    
    // 如果所有分片都上传完成，更新状态
    if (this.completedChunks >= this.totalChunks) {
      this._updateStatus('processing', '所有分片上传完成，处理中...');
    }
  }

  /**
   * 处理错误
   * @param {Error} error - 错误对象
   */
  _handleError(error) {
    console.error('上传错误:', error);
    
    this._updateStatus('error', `上传失败: ${error.message}`);
    
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  /**
   * 更新上传进度
   */
  _updateProgress() {
    if (!this.onProgressCallback) return;
    
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000;
    const percentage = this.totalSize > 0 
      ? Math.min(Math.round((this.completedChunks / this.totalChunks) * 100), 100) 
      : 0;
    
    // 计算估计剩余时间
    let estimatedTotal = elapsed * (100 / (percentage || 1));
    let estimatedRemaining = Math.max(0, estimatedTotal - elapsed);
    
    // 如果还没有任何进度，不显示估计时间
    if (percentage === 0) {
      estimatedRemaining = 0;
    }
    
    // 计算上传速度 (bytes/second)
    const speed = elapsed > 0 ? (this.totalLoaded / elapsed) : 0;
    
    // 构建进度对象
    const progressData = {
      percentage,
      loaded: this.totalLoaded,
      total: this.totalSize,
      elapsed: this._formatTime(elapsed),
      remaining: this._formatTime(estimatedRemaining),
      speed: this._formatSize(speed) + '/s',
      chunksCompleted: this.completedChunks,
      totalChunks: this.totalChunks
    };
    
    // 调用回调
    this.onProgressCallback(progressData);
  }

  /**
   * 格式化时间
   * @param {number} seconds - 秒数
   * @returns {string} - 格式化后的时间
   */
  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
      return '计算中...';
    }
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    if (mins === 0) {
      return `${secs}秒`;
    } else {
      return `${mins}分${secs.toString().padStart(2, '0')}秒`;
    }
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} - 格式化后的大小
   */
  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 更新上传状态
   * @param {string} status - 状态名称
   * @param {string} message - 状态消息
   */
  _updateStatus(status, message) {
    this.status = status;
    
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({ status, message });
    }
  }
}

// 导出给全局使用
if (typeof window !== 'undefined') {
  window.ChunkUploader = ChunkUploader;
} 
