/**
 * In-App Custom Modal Dialogs (Apple Glass & Cyber-Rose Aesthetic)
 * Replaces native browser popups (window.confirm / window.alert / window.prompt)
 */

(function () {
    const icons = {
        danger: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        warning: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        info: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
        question: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        success: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`
    };

    function escapeDialogHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function createOverlay() {
        const existing = document.getElementById('app-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'app-dialog-overlay';
        overlay.className = 'app-dialog-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }

    window.showConfirm = function (opts) {
        return new Promise((resolve) => {
            const {
                title = '¿Estás seguro?',
                message = '',
                confirmText = 'Confirmar',
                cancelText = 'Cancelar',
                type = 'danger' // 'danger' | 'warning' | 'info' | 'primary'
            } = typeof opts === 'string' ? { message: opts } : (opts || {});

            const overlay = createOverlay();
            const iconSvg = icons[type] || icons.question;
            const confirmBtnClass = type === 'danger' ? 'btn-dialog-danger' : (type === 'warning' ? 'btn-dialog-warning' : 'btn-primary');

            overlay.innerHTML = `
                <div class="app-dialog-box dialog-${type}" role="dialog" aria-modal="true">
                    <div class="app-dialog-icon-wrap">${iconSvg}</div>
                    <div class="app-dialog-title">${title}</div>
                    <div class="app-dialog-message">${message}</div>
                    <div class="app-dialog-actions">
                        <button type="button" class="btn-secondary" id="app-dialog-cancel">${cancelText}</button>
                        <button type="button" class="${confirmBtnClass}" id="app-dialog-confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                const confirmBtn = document.getElementById('app-dialog-confirm');
                if (confirmBtn) confirmBtn.focus();
            });

            function cleanup(result) {
                overlay.classList.remove('active');
                document.removeEventListener('keydown', handleKey);
                setTimeout(() => {
                    overlay.remove();
                    resolve(result);
                }, 220);
            }

            function handleKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(false);
                } else if (e.key === 'Enter') {
                    if (document.activeElement && document.activeElement.id === 'app-dialog-cancel') {
                        cleanup(false);
                    } else {
                        cleanup(true);
                    }
                }
            }

            document.addEventListener('keydown', handleKey);

            document.getElementById('app-dialog-cancel').onclick = () => cleanup(false);
            document.getElementById('app-dialog-confirm').onclick = () => cleanup(true);
            overlay.onclick = (e) => {
                if (e.target === overlay) cleanup(false);
            };
        });
    };

    window.showAlert = function (opts) {
        return new Promise((resolve) => {
            const {
                title = 'Notificación',
                message = '',
                confirmText = 'Entendido',
                type = 'info'
            } = typeof opts === 'string' ? { message: opts } : (opts || {});

            const overlay = createOverlay();
            const iconSvg = icons[type] || icons.info;
            const confirmBtnClass = type === 'danger' ? 'btn-dialog-danger' : 'btn-primary';

            overlay.innerHTML = `
                <div class="app-dialog-box dialog-${type}" role="dialog" aria-modal="true">
                    <div class="app-dialog-icon-wrap">${iconSvg}</div>
                    <div class="app-dialog-title">${title}</div>
                    <div class="app-dialog-message">${message}</div>
                    <div class="app-dialog-actions">
                        <button type="button" class="${confirmBtnClass}" id="app-dialog-confirm" style="min-width: 140px;">${confirmText}</button>
                    </div>
                </div>
            `;

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                const confirmBtn = document.getElementById('app-dialog-confirm');
                if (confirmBtn) confirmBtn.focus();
            });

            function cleanup() {
                overlay.classList.remove('active');
                document.removeEventListener('keydown', handleKey);
                setTimeout(() => {
                    overlay.remove();
                    resolve();
                }, 220);
            }

            function handleKey(e) {
                if (e.key === 'Escape' || e.key === 'Enter') {
                    e.preventDefault();
                    cleanup();
                }
            }

            document.addEventListener('keydown', handleKey);
            document.getElementById('app-dialog-confirm').onclick = () => cleanup();
            overlay.onclick = (e) => {
                if (e.target === overlay) cleanup();
            };
        });
    };

    window.showPrompt = function (opts) {
        return new Promise((resolve) => {
            const {
                title = 'Ingresar valor',
                message = '',
                defaultValue = '',
                placeholder = 'Escribe aquí...',
                confirmText = 'Guardar',
                cancelText = 'Cancelar',
                type = 'edit' // 'edit' | 'primary' | 'warning'
            } = typeof opts === 'string' ? { message: opts } : (opts || {});

            const overlay = createOverlay();
            const iconSvg = icons[type] || icons.edit;
            const confirmBtnClass = type === 'danger' ? 'btn-dialog-danger' : (type === 'warning' ? 'btn-dialog-warning' : 'btn-primary');

            overlay.innerHTML = `
                <div class="app-dialog-box dialog-${type}" role="dialog" aria-modal="true" style="max-width: 440px;">
                    <div class="app-dialog-icon-wrap">${iconSvg}</div>
                    <div class="app-dialog-title">${title}</div>
                    ${message ? `<div class="app-dialog-message" style="margin-bottom: 16px;">${message}</div>` : ''}
                    <div style="margin-bottom: 22px; text-align: left;">
                        <input type="text" id="app-dialog-prompt-input" value="${escapeDialogHtml(defaultValue)}" placeholder="${escapeDialogHtml(placeholder)}" style="width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(224, 77, 128, 0.35); border-radius: 12px; padding: 12px 14px; font-size: 14px; color: var(--text-primary); outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='var(--accent-pink)'; this.style.boxShadow='0 0 14px rgba(224, 77, 128, 0.3)';" onblur="this.style.borderColor='rgba(224, 77, 128, 0.35)'; this.style.boxShadow='none';">
                    </div>
                    <div class="app-dialog-actions">
                        <button type="button" class="btn-secondary" id="app-dialog-cancel">${cancelText}</button>
                        <button type="button" class="${confirmBtnClass}" id="app-dialog-confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                const inputEl = document.getElementById('app-dialog-prompt-input');
                if (inputEl) {
                    inputEl.focus();
                    inputEl.select();
                }
            });

            function cleanup(value) {
                overlay.classList.remove('active');
                document.removeEventListener('keydown', handleKey);
                setTimeout(() => {
                    overlay.remove();
                    resolve(value);
                }, 220);
            }

            function handleKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const inputEl = document.getElementById('app-dialog-prompt-input');
                    cleanup(inputEl ? inputEl.value : null);
                }
            }

            document.addEventListener('keydown', handleKey);

            document.getElementById('app-dialog-cancel').onclick = () => cleanup(null);
            document.getElementById('app-dialog-confirm').onclick = () => {
                const inputEl = document.getElementById('app-dialog-prompt-input');
                cleanup(inputEl ? inputEl.value : null);
            };
            overlay.onclick = (e) => {
                if (e.target === overlay) cleanup(null);
            };
        });
    };
})();
