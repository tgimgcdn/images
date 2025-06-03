/**
 * 全局控制台日志控制器
 * 用于控制所有页面的控制台输出
 */

// 保存原始控制台方法的引用
window.originalConsole = window.originalConsole || {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
};

// 禁用控制台输出的标志
const isDebugMode = localStorage.getItem('debugMode') === 'true' || 
                    new URLSearchParams(window.location.search).has('debug');

// 检测是否是管理员页面
const isAdminPage = window.location.pathname.includes('/admin/');

// 重写控制台方法
console.log = function(...args) {
    if (isDebugMode) {
        window.originalConsole.log.apply(console, args);
    }
};

console.info = function(...args) {
    if (isDebugMode) {
        window.originalConsole.info.apply(console, args);
    }
};

console.warn = function(...args) {
    if (isDebugMode) {
        window.originalConsole.warn.apply(console, args);
    }
};

console.debug = function(...args) {
    if (isDebugMode) {
        window.originalConsole.debug.apply(console, args);
    }
};

// 错误日志始终保留，不受调试模式影响
console.error = function(...args) {
    window.originalConsole.error.apply(console, args);
};

// 切换调试模式的函数
function toggleDebugMode() {
    const newState = !isDebugMode;
    localStorage.setItem('debugMode', newState);
    
    // 如果开启调试模式，输出消息确认
    if (newState) {
        window.originalConsole.log('调试模式已手动开启');
        document.body.classList.add('debug-mode');
    } else {
        document.body.classList.remove('debug-mode');
    }
    
    // 刷新页面以应用新的调试设置
    window.location.reload();
}

// 为管理页面添加键盘快捷键(Alt+D)
if (isAdminPage) {
    document.addEventListener('keydown', function(e) {
        // Alt+D组合键
        if (e.altKey && e.key === 'd') {
            e.preventDefault(); // 阻止默认行为
            toggleDebugMode();
        }
    });
}

// 如果开启了调试模式，添加debugger信息
if (isDebugMode) {
    window.originalConsole.log('调试模式已启用');
    // 在DOM加载后添加调试CSS类
    document.addEventListener('DOMContentLoaded', function() {
        document.body.classList.add('debug-mode');
    });
} 
