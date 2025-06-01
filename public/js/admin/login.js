document.addEventListener('DOMContentLoaded', async () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.querySelector('.error-message');
    const recaptchaContainer = document.getElementById('recaptchaContainer');
    const recaptchaElement = document.querySelector('.g-recaptcha');

    // 检查是否启用了 reCAPTCHA
    try {
        const response = await fetch('/api/admin/recaptcha-config');
        const config = await response.json();
        
        if (config.enabled) {
            recaptchaContainer.style.display = 'block';
            recaptchaElement.dataset.sitekey = config.siteKey;
        }
    } catch (error) {
        console.error('Failed to load reCAPTCHA config:', error);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const recaptchaResponse = recaptchaContainer.style.display !== 'none' 
            ? grecaptcha.getResponse() 
            : null;

        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    username, 
                    password,
                    recaptchaResponse 
                })
            });

            const data = await response.json();

            if (response.ok) {
                // 登录成功，跳转到管理后台
                window.location.href = '/admin/';
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
            errorMessage.textContent = '网络错误，请稍后重试';
            errorMessage.style.display = 'block';
        }
    });
}); 