/**
 * F-Dispatch — Operator View Controller
 * Gestor de cuentas de WhatsApp, escaneo de QR web y control de bot para operadores.
 */

let operatorBots = [];
let activeQrProfileId = null;

async function loadOperatorBots() {
    const grid = document.getElementById('operator-bots-grid');
    const countBadge = document.getElementById('operator-bots-count-badge');
    const noBotsEl = document.getElementById('operator-no-bots');

    if (!grid) return;

    try {
        operatorBots = await api('/profiles');
        
        if (countBadge) {
            countBadge.textContent = `${operatorBots.length} Cuentas asignadas`;
        }

        if (!operatorBots || operatorBots.length === 0) {
            grid.innerHTML = '';
            if (noBotsEl) noBotsEl.classList.remove('hidden');
            return;
        }

        if (noBotsEl) noBotsEl.classList.add('hidden');
        renderOperatorBots(operatorBots);
    } catch (err) {
        console.error('[OperatorView] Error loading operator bots:', err);
        toast('Error al cargar cuentas de WhatsApp', 'error');
    }
}

function renderOperatorBots(bots) {
    const grid = document.getElementById('operator-bots-grid');
    if (!grid) return;

    grid.innerHTML = '';

    bots.forEach(bot => {
        const card = document.createElement('div');
        card.className = 'bot-card';
        card.id = `bot-card-${bot.id}`;

        const isConnected = bot.live_status === 'connected' || bot.status === 'connected';
        const isConnecting = bot.live_status === 'connecting' || bot.live_status === 'qr';

        let badgeHtml = '';
        if (isConnected) {
            badgeHtml = `<span class="bot-badge bot-badge-connected" id="bot-badge-${bot.id}"><i data-lucide="check-circle-2" style="width:14px; height:14px;"></i> Conectado</span>`;
        } else if (isConnecting) {
            badgeHtml = `<span class="bot-badge bot-badge-connecting" id="bot-badge-${bot.id}"><i data-lucide="loader-2" class="spin" style="width:14px; height:14px;"></i> Conectando</span>`;
        } else {
            badgeHtml = `<span class="bot-badge bot-badge-disconnected" id="bot-badge-${bot.id}"><i data-lucide="x-circle" style="width:14px; height:14px;"></i> Desconectado</span>`;
        }

        const phoneDisplay = bot.phone_number ? `<span style="font-size:12px; color:var(--text-secondary); font-family:monospace;">+${bot.phone_number}</span>` : '<span style="font-size:11.5px; color:var(--text-tertiary);">Sin número vinculado</span>';

        const isBotOn = Boolean(bot.is_active_bot);

        card.innerHTML = `
            <div>
                <div class="bot-card-header">
                    <div>
                        <div class="bot-card-title">
                            <span id="bot-name-${bot.id}">${escapeHtml(bot.name)}</span>
                            <button onclick="editBotName('${bot.id}', '${escapeHtml(bot.name)}')" title="Cambiar nombre" style="background:none; border:none; color:var(--text-tertiary); cursor:pointer; padding:2px;">
                                <i data-lucide="edit-3" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                        <div class="bot-card-subtitle" id="bot-phone-${bot.id}">${phoneDisplay}</div>
                    </div>
                    <div>${badgeHtml}</div>
                </div>

                <!-- Stats summary -->
                <div class="bot-stats-row">
                    <div>
                        <div class="bot-stat-num" id="bot-sent-${bot.id}" style="color:#4ade80;">${bot.sent_today || 0}</div>
                        <div class="bot-stat-label">Enviados Hoy</div>
                    </div>
                    <div>
                        <div class="bot-stat-num" id="bot-pending-${bot.id}" style="color:var(--accent-pink);">${bot.pending_count || 0}</div>
                        <div class="bot-stat-label">En Cola</div>
                    </div>
                    <div>
                        <div class="bot-stat-num" id="bot-errors-${bot.id}" style="color:#f87171;">${bot.error_count || 0}</div>
                        <div class="bot-stat-label">Errores</div>
                    </div>
                </div>

                <!-- Message Configuration Button -->
                <div style="margin-bottom: 14px;">
                    <button class="btn-secondary" onclick="openMessageModal('${bot.id}', '${escapeHtml(bot.name)}')" style="width: 100%; padding: 10px 14px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-hairline); border-radius: 10px; cursor: pointer;">
                        <i data-lucide="message-square" style="width: 15px; height: 15px; color: var(--accent-pink);"></i>
                        <strong style="color: var(--text-primary);">Mensaje Automático</strong>
                    </button>
                </div>

                <!-- Bot Sending Status / Countdown -->
                <div id="bot-status-text-${bot.id}" style="font-size:12px; color:var(--text-secondary); min-height:18px; margin-bottom:8px; font-style:italic;">
                    ${isBotOn ? 'Bot activo. Procesando colas...' : 'Bot en pausa.'}
                </div>
            </div>

            <div>
                <!-- Bot Toggle Button -->
                <button id="bot-toggle-btn-${bot.id}" class="bot-toggle-btn ${isBotOn ? 'bot-toggle-on' : (isConnected ? 'bot-toggle-off' : 'bot-toggle-disabled')}" onclick="toggleBotState('${bot.id}')" ${!isConnected && !isBotOn ? 'style="opacity: 0.55; cursor: not-allowed;" title="Primero debes conectar WhatsApp con el código QR"' : ''}>
                    <i data-lucide="${isBotOn ? 'pause-circle' : (isConnected ? 'play-circle' : 'alert-circle')}" style="width:18px; height:18px;"></i>
                    <span>${isBotOn ? 'Bot Encendido (Pausar)' : (isConnected ? 'Encender Bot' : 'Conectar WhatsApp para Encender')}</span>
                </button>

                <!-- Connection Actions -->
                <div style="display:flex; gap:8px; margin-top:10px;">
                    ${!isConnected ? `
                        <button class="btn-primary" onclick="connectBot('${bot.id}', '${escapeHtml(bot.name)}')" style="flex:1; padding:8px; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px;">
                            <i data-lucide="qr-code" style="width:14px; height:14px;"></i> Conectar WhatsApp
                        </button>
                    ` : `
                        <button class="btn-secondary" onclick="disconnectBot('${bot.id}')" style="flex:1; padding:8px; font-size:12px;">
                            Pausar Conexión
                        </button>
                        <button class="btn-secondary" onclick="unlinkBot('${bot.id}')" style="color:#f87171; border-color:rgba(239,68,68,0.3); padding:8px; font-size:12px;" title="Cerrar sesión en WhatsApp">
                            <i data-lucide="log-out" style="width:13px; height:13px;"></i> Desvincular
                        </button>
                    `}
                </div>
            </div>
        `;

        grid.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

/**
 * Open QR modal and trigger Baileys connection
 */
async function connectBot(profileId, profileName) {
    activeQrProfileId = profileId;
    
    const modal = document.getElementById('modal-qr');
    const nameEl = document.getElementById('qr-modal-profile-name');
    const loader = document.getElementById('qr-modal-loader');
    const imgWrapper = document.getElementById('qr-modal-img-wrapper');
    const imgEl = document.getElementById('qr-modal-img');
    const statusEl = document.getElementById('qr-modal-status');

    if (nameEl) nameEl.textContent = profileName || 'Cuenta de WhatsApp';
    if (loader) loader.classList.remove('hidden');
    if (imgWrapper) imgWrapper.classList.add('hidden');
    if (imgEl) imgEl.src = '';
    if (statusEl) statusEl.textContent = 'Iniciando conexión con WhatsApp...';

    if (modal) modal.classList.remove('hidden');

    try {
        const res = await api(`/profiles/${profileId}/connect`, { method: 'POST' });
        
        if (res.status === 'connected') {
            toast('Esta cuenta ya se encuentra conectada', 'info');
            if (modal) modal.classList.add('hidden');
            await loadOperatorBots();
            return;
        }

        if (res.qr) {
            // QR already available
            if (imgEl) imgEl.src = res.qr;
            if (loader) loader.classList.add('hidden');
            if (imgWrapper) imgWrapper.classList.remove('hidden');
            if (statusEl) statusEl.textContent = 'Apunta tu cámara de WhatsApp al código QR...';
        }
    } catch (err) {
        console.error('[OperatorView] Connect error:', err);
        toast(`Error al iniciar WhatsApp: ${err.message}`, 'error');
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
}

/**
 * Disconnect session gracefully
 */
async function disconnectBot(profileId) {
    try {
        await api(`/profiles/${profileId}/disconnect`, { method: 'POST' });
        toast('WhatsApp desconectado', 'info');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al desconectar: ${err.message}`, 'error');
    }
}

/**
 * Unlink and clear session permanently
 */
async function unlinkBot(profileId) {
    if (!confirm('¿Estás seguro de que deseas desvincular este WhatsApp? Se cerrará la sesión y deberás volver a escanear el QR.')) {
        return;
    }

    try {
        await api(`/profiles/${profileId}/unlink`, { method: 'POST' });
        toast('Cuenta desvinculada exitosamente', 'success');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al desvincular: ${err.message}`, 'error');
    }
}

/**
 * Toggle Bot Engine ON/OFF
 */
async function toggleBotState(profileId) {
    const bot = operatorBots.find(b => b.id === profileId);
    if (!bot) return;

    const isConnected = bot.live_status === 'connected' || bot.status === 'connected';

    // Disallow turning bot ON if WhatsApp is not connected
    if (!bot.is_active_bot && !isConnected) {
        toast('No puedes encender el bot: primero debes conectar y vincular WhatsApp con el código QR', 'error');
        return;
    }

    const newAction = bot.is_active_bot ? 'stop' : 'start';

    try {
        await api(`/profiles/${profileId}/toggle-bot`, {
            method: 'POST',
            body: JSON.stringify({ action: newAction })
        });

        bot.is_active_bot = !bot.is_active_bot;

        const btn = document.getElementById(`bot-toggle-btn-${profileId}`);
        const statusText = document.getElementById(`bot-status-text-${profileId}`);

        if (btn) {
            btn.className = `bot-toggle-btn ${bot.is_active_bot ? 'bot-toggle-on' : (isConnected ? 'bot-toggle-off' : 'bot-toggle-disabled')}`;
            btn.innerHTML = `
                <i data-lucide="${bot.is_active_bot ? 'pause-circle' : (isConnected ? 'play-circle' : 'alert-circle')}" style="width:18px; height:18px;"></i>
                <span>${bot.is_active_bot ? 'Bot Encendido (Pausar)' : (isConnected ? 'Encender Bot' : 'Conectar WhatsApp para Encender')}</span>
            `;
            if (!bot.is_active_bot && !isConnected) {
                btn.style.opacity = '0.55';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.style.opacity = '';
                btn.style.cursor = '';
            }
        }

        if (statusText) {
            statusText.textContent = bot.is_active_bot ? 'Bot encendido. Procesando colas...' : 'Bot en pausa.';
        }

        if (window.lucide) lucide.createIcons();
        toast(bot.is_active_bot ? 'Bot encendido' : 'Bot pausado', 'info');
    } catch (err) {
        toast(`Error al cambiar estado del bot: ${err.message}`, 'error');
    }
}

/**
 * Message Modal Management
 */
let currentMessageBotId = null;

function openMessageModal(profileId, profileName) {
    currentMessageBotId = profileId;
    const bot = operatorBots.find(b => b.id === profileId);
    if (!bot) return;

    const modal = document.getElementById('modal-bot-message');
    const titleEl = document.getElementById('modal-bot-message-title');
    const textarea = document.getElementById('modal-bot-message-textarea');
    const charCount = document.getElementById('modal-bot-message-char-count');

    if (titleEl) {
        titleEl.innerHTML = `<i data-lucide="message-square" style="color: var(--accent-pink);"></i> Mensaje Automático: ${escapeHtml(profileName || bot.name)}`;
    }

    if (textarea) {
        textarea.value = bot.message || '';
        if (charCount) {
            charCount.textContent = `${textarea.value.length} caracteres`;
        }
    }

    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

async function saveModalBotMessage() {
    if (!currentMessageBotId) return;

    const textarea = document.getElementById('modal-bot-message-textarea');
    const message = textarea ? textarea.value : '';
    const modal = document.getElementById('modal-bot-message');
    const saveBtn = document.getElementById('modal-bot-message-save');

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Guardando...';
    }

    try {
        await api(`/profiles/${currentMessageBotId}/config`, {
            method: 'PATCH',
            body: JSON.stringify({ message })
        });

        const bot = operatorBots.find(b => b.id === currentMessageBotId);
        if (bot) {
            bot.message = message;
        }



        if (modal) modal.classList.add('hidden');
        toast('Mensaje guardado exitosamente', 'success');
        currentMessageBotId = null;
    } catch (err) {
        toast(`Error al guardar mensaje: ${err.message}`, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Guardar Mensaje';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Edit descriptive name
 */
async function editBotName(profileId, currentName) {
    const newName = prompt('Ingresa el nuevo nombre para este WhatsApp:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    try {
        await api(`/profiles/${profileId}/config`, {
            method: 'PATCH',
            body: JSON.stringify({ name: newName.trim() })
        });
        toast('Nombre actualizado', 'success');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al renombrar: ${err.message}`, 'error');
    }
}

// Modal listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('modal-qr-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('modal-qr');
            if (modal) modal.classList.add('hidden');
            activeQrProfileId = null;
        });
    }

    const msgCancel = document.getElementById('modal-bot-message-cancel');
    if (msgCancel) {
        msgCancel.addEventListener('click', () => {
            const modal = document.getElementById('modal-bot-message');
            if (modal) modal.classList.add('hidden');
            currentMessageBotId = null;
        });
    }

    const msgSave = document.getElementById('modal-bot-message-save');
    if (msgSave) {
        msgSave.addEventListener('click', saveModalBotMessage);
    }

    const msgTextarea = document.getElementById('modal-bot-message-textarea');
    if (msgTextarea) {
        msgTextarea.addEventListener('input', () => {
            const charCount = document.getElementById('modal-bot-message-char-count');
            if (charCount) charCount.textContent = `${msgTextarea.value.length} caracteres`;
        });
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Global window exposure for inline onclick handlers
window.loadOperatorBots = loadOperatorBots;
window.renderOperatorBots = renderOperatorBots;
window.connectBot = connectBot;
window.disconnectBot = disconnectBot;
window.unlinkBot = unlinkBot;
window.toggleBotState = toggleBotState;
window.saveModalBotMessage = saveModalBotMessage;
window.openMessageModal = openMessageModal;
window.editBotName = editBotName;

