document.addEventListener('DOMContentLoaded', async () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.querySelector('.error-message');
    const recaptchaContainer = document.getElementById('recaptchaContainer');
    const recaptchaElement = document.querySelector('.g-recaptcha');

    console.log('登录页面已加载');
    console.log('当前Cookie:', document.cookie);

    // 检查是否已经登录，如果已登录则直接跳转到管理后台
    if (document.cookie.includes('session_id=')) {
        console.log('检测到已有会话，尝试直接进入管理后台');
        window.location.href = '/admin/';
        return;
    }

    // 检查是否启用了 reCAPTCHA
    let recaptchaEnabled = false;
    try {
        const response = await fetch('/api/admin/recaptcha-config');
        if (response.ok) {
            const config = await response.json();
            
            if (config.enabled && config.siteKey) {
                recaptchaEnabled = true;
                recaptchaContainer.style.display = 'block';
                recaptchaElement.setAttribute('data-sitekey', config.siteKey);
                console.log('reCAPTCHA已启用，站点密钥:', config.siteKey);
            } else {
                console.log('reCAPTCHA未启用或配置不完整');
            }
        } else {
            console.log('无法获取reCAPTCHA配置，API响应:', response.status);
        }
    } catch (error) {
        console.error('加载 reCAPTCHA 配置失败:', error);
    }
    
    if (!recaptchaEnabled) {
        console.log('reCAPTCHA未启用，跳过验证');
        recaptchaContainer.style.display = 'none';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('提交登录表单');
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        console.log('登录信息:', {
            username: username,
            passwordLength: password.length
        });
        
        // 只在reCAPTCHA启用且可见时才获取响应
        const recaptchaResponse = recaptchaEnabled && recaptchaContainer.style.display !== 'none' 
            ? (window.grecaptcha ? grecaptcha.getResponse() : null)
            : null;

        // 显示加载状态
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = '登录中...';
        
        errorMessage.style.display = 'none';

        try {
            console.log('正在发送登录请求...');
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

            console.log('接收到登录响应状态码:', response.status);
            const data = await response.json();
            console.log('登录响应:', data);

            if (response.ok && data.success) {
                // 登录成功，记录会话ID和用户信息
                console.log('登录成功!');
                console.log('服务器返回的会话ID:', data.sessionId);
                console.log('登录后的Cookie:', document.cookie);
                
                // 如果cookie没有正确设置，手动设置它
                if (!document.cookie.includes('session_id=')) {
                    console.log('尝试手动设置cookie');
                    document.cookie = `session_id=${data.sessionId}; path=/`;
                    console.log('手动设置后的Cookie:', document.cookie);
                }

                // 等待一小段时间确保cookie已设置，然后跳转
                setTimeout(() => {
                    console.log('跳转前的Cookie:', document.cookie);
                    window.location.href = '/admin/';
                }, 1000);
            } else {
                // 显示错误信息
                console.log('登录失败:', data.error || '未知错误');
                errorMessage.textContent = data.error || '登录失败';
                errorMessage.style.display = 'block';
                
                // 提醒用户正确的默认密码
                if (data.error === '用户名或密码错误' && username === 'admin') {
                    console.log('提示：默认管理员密码是 admin123');
                    errorMessage.textContent += '，默认管理员密码是 admin123';
                }
                
                // 如果启用了 reCAPTCHA，重置验证
                if (recaptchaEnabled && window.grecaptcha) {
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
