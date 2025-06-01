document.addEventListener('DOMContentLoaded', async () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.querySelector('.error-message');
    const recaptchaContainer = document.getElementById('recaptchaContainer');
    const recaptchaElement = document.querySelector('.g-recaptcha');

    console.log('登录页面已加载');

    // 检查是否已经登录，如果已登录则直接跳转到管理后台
    if (document.cookie.includes('session_id=')) {
        console.log('检测到已有会话，尝试直接进入管理后台');
        window.location.href = '/admin/';
        return;
    }

    // 检查是否启用了 reCAPTCHA
    try {
        const response = await fetch('/api/admin/recaptcha-config');
        const config = await response.json();
        
        if (config.enabled) {
            recaptchaContainer.style.display = 'block';
            recaptchaElement.dataset.sitekey = config.siteKey;
        }
    } catch (error) {
        console.error('加载 reCAPTCHA 配置失败:', error);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('提交登录表单');
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const recaptchaResponse = recaptchaContainer.style.display !== 'none' 
            ? grecaptcha.getResponse() 
            : null;

        // 显示加载状态
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = '登录中...';
        
        errorMessage.style.display = 'none';

        try {
            console.log('发送登录请求');
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // 确保接收和发送cookie
                body: JSON.stringify({ 
                    username, 
                    password,
                    recaptchaResponse 
                })
            });

            console.log('接收到登录响应:', response.status);
            const data = await response.json();
            console.log('响应数据:', data);

            if (response.ok) {
                // 登录成功，跳转到管理后台
                console.log('登录成功，即将跳转');
                // 等待一小段时间确保cookie已设置
                setTimeout(() => {
                    window.location.href = '/admin/';
                }, 500);
            } else {
                // 显示错误信息
                errorMessage.textContent = data.error || '登录失败';
                errorMessage.style.display = 'block';
                
                // 如果启用了 reCAPTCHA，重置验证
                if (recaptchaContainer.style.display !== 'none') {
                    grecaptcha.reset();
                }
            }
        } catch (error) {
            console.error('登录过程中出现错误:', error);
            errorMessage.textContent = '网络错误，请稍后重试';
            errorMessage.style.display = 'block';
        } finally {
            // 恢复按钮状态
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    });
}); 
