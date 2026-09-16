document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-msg');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMsg.classList.add('hidden');
        errorMsg.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando...';

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        try {
            const res = await window.api.authLogin(email, password);
            if (res && res.accessToken) {
                window.location.href = 'index.html';
            } else {
                throw new Error('Respuesta inválida del servidor');
            }
        } catch (err) {
            console.error('Login error:', err);
            let cleanMsg = err.message || 'Error al iniciar sesión';
            cleanMsg = cleanMsg.replace(/^Error invoking remote method '[^']+': Error:\s*/, '').replace(/^Error:\s*/, '');
            errorMsg.textContent = cleanMsg;
            errorMsg.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ingresar';
        }
    });
});
