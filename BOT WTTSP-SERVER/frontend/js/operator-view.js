/**
 * F-Dispatch — Operator View Controller
 * Gestor de cuentas de WhatsApp, escaneo de QR web y control de bot para operadores.
 */

let operatorBots = [];
let activeQrProfileId = null;
let qrPollInterval = null;
let operatorWs = null;

async function loadOperatorBots() {
    const grid = document.getElementById('operator-bots-grid');
    const countBadge = document.getElementById('operator-bots-count-badge');
    const noBotsEl = document.getElementById('operator-no-bots');

    if (!grid) return;

    try {
        operatorBots = await api('/profiles');
        
        const myLimit = (window.currentUser && window.currentUser.whatsappLimit !== undefined && window.currentUser.whatsappLimit !== null)
            ? window.currentUser.whatsappLimit
            : ((window.currentUser && window.currentUser.maxProfilesPerOperator) || 2);

        if (countBadge) {
            countBadge.textContent = `${operatorBots.length} / ${myLimit} Cuentas asignadas`;
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
        const hasPhone = Boolean(bot.phone_number && bot.phone_number.trim() !== '');

        let badgeHtml = '';
        if (isConnected) {
            badgeHtml = `<span class="bot-badge bot-badge-connected" id="bot-badge-${bot.id}"><i data-lucide="check-circle-2" style="width:14px; height:14px;"></i> Conectado</span>`;
        } else {
            badgeHtml = `<span class="bot-badge bot-badge-disconnected" id="bot-badge-${bot.id}"><i data-lucide="x-circle" style="width:14px; height:14px;"></i> Desconectado</span>`;
        }

        const phoneDisplay = hasPhone
            ? `<span style="font-size:12px; color:var(--text-secondary); font-family:monospace;">+${escapeHtml(bot.phone_number)}</span>`
            : '<span style="font-size:11.5px; color:var(--text-tertiary);">Sin número vinculado</span>';

        const isBotOn = Boolean(bot.is_active_bot);

        // Connection Action Buttons
        let connectionButtonsHtml = '';
        if (isConnected) {
            connectionButtonsHtml = `
                <button class="btn-secondary" onclick="disconnectBot('${bot.id}')" style="flex:1; padding:8px; font-size:12px;" title="Pausar conexión temporalmente">
                    <i data-lucide="pause" style="width:13px; height:13px;"></i> Pausar
                </button>
                <button class="btn-secondary" onclick="unlinkBot('${bot.id}', '${escapeHtml(bot.name)}')" style="color:#f87171; border-color:rgba(239,68,68,0.3); padding:8px; font-size:12px; display:inline-flex; align-items:center; gap:5px;" title="Cerrar sesión y cambiar de número">
                    <i data-lucide="log-out" style="width:13px; height:13px;"></i> Desvincular
                </button>
            `;
        } else if (hasPhone) {
            // Phone registered previously but currently disconnected
            connectionButtonsHtml = `
                <button class="btn-primary" onclick="connectBot('${bot.id}', '${escapeHtml(bot.name)}')" style="flex:1; padding:8px; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <i data-lucide="refresh-cw" style="width:14px; height:14px;"></i> Reconectar
                </button>
                <button class="btn-secondary" onclick="unlinkBot('${bot.id}', '${escapeHtml(bot.name)}')" style="color:#f87171; border-color:rgba(239,68,68,0.3); padding:8px; font-size:12px; display:inline-flex; align-items:center; gap:5px;" title="Desvincular para vincular un número diferente">
                    <i data-lucide="log-out" style="width:13px; height:13px;"></i> Cambiar Número
                </button>
            `;
        } else {
            // Completely unlinked, needs initial QR scan
            connectionButtonsHtml = `
                <button class="btn-primary" onclick="connectBot('${bot.id}', '${escapeHtml(bot.name)}')" style="flex:1; padding:8px; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <i data-lucide="qr-code" style="width:14px; height:14px;"></i> Vincular WhatsApp (QR)
                </button>
            `;
        }

        card.innerHTML = `
            <div>
                <div class="bot-card-header">
                    <div style="flex:1; min-width:0;">
                        <div class="bot-card-title">
                            <span id="bot-name-${bot.id}">${escapeHtml(bot.name)}</span>
                            <button onclick="editBotName('${bot.id}', '${escapeHtml(bot.name)}')" title="Cambiar nombre" style="background:none; border:none; color:var(--text-tertiary); cursor:pointer; padding:2px;">
                                <i data-lucide="edit-3" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; margin-top:3px;">
                            <span class="bot-card-subtitle" id="bot-phone-${bot.id}" style="margin:0;">${phoneDisplay}</span>
                            <span class="badge" style="background: rgba(233,69,96,0.15); color: var(--accent-pink); border: 1px solid rgba(233,69,96,0.3); font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 600;">
                                ${escapeHtml(bot.category || 'Movistar')}
                            </span>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${badgeHtml}
                        <button onclick="deleteBotInstance('${bot.id}', '${escapeHtml(bot.name)}')" title="Eliminar instancia de bot" class="btn-danger" style="padding: 5px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); cursor: pointer; transition: all 0.2s;">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
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

                <!-- Configuration Buttons: Automatic Message & Load Numbers -->
                <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
                    <button class="btn-secondary" onclick="openMessageModal('${bot.id}', '${escapeHtml(bot.name)}')" style="width: 100%; padding: 9px 14px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-hairline); border-radius: 10px; cursor: pointer;">
                        <i data-lucide="message-square" style="width: 15px; height: 15px; color: var(--accent-pink);"></i>
                        <strong style="color: var(--text-primary);">Mensaje Automático</strong>
                    </button>
                    <button class="btn-secondary" onclick="openBotQueueModal('${bot.id}', '${escapeHtml(bot.name)}')" style="width: 100%; padding: 9px 14px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(224, 77, 128, 0.07); border: 1px solid rgba(224, 77, 128, 0.3); border-radius: 10px; cursor: pointer;" title="Cargar números de teléfono para que este bot les envíe mensajes">
                        <i data-lucide="upload" style="width: 15px; height: 15px; color: var(--accent-pink);"></i>
                        <strong style="color: #fff;">Cargar Números</strong>
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
                    ${connectionButtonsHtml}
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
            closeQrModal();
            await loadOperatorBots();
            return;
        }

        if (res.qr) {
            if (imgEl) imgEl.src = res.qr;
            if (loader) loader.classList.add('hidden');
            if (imgWrapper) imgWrapper.classList.remove('hidden');
            if (statusEl) statusEl.textContent = 'Apunta tu cámara de WhatsApp al código QR...';
        }

        startQrPolling(profileId);
    } catch (err) {
        console.error('[OperatorView] Connect error:', err);
        toast(`Error al iniciar WhatsApp: ${err.message}`, 'error');
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
}

function startQrPolling(profileId) {
    stopQrPolling();
    qrPollInterval = setInterval(async () => {
        if (!activeQrProfileId || activeQrProfileId !== profileId) {
            stopQrPolling();
            return;
        }

        try {
            const data = await api(`/profiles/${profileId}`);
            const isConnected = data.live_status === 'connected' || data.status === 'connected';

            if (isConnected) {
                stopQrPolling();
                closeQrModal();
                toast('¡WhatsApp vinculado y conectado exitosamente!', 'success');
                await loadOperatorBots();
                return;
            }

            if (data.qr) {
                const imgEl = document.getElementById('qr-modal-img');
                const loader = document.getElementById('qr-modal-loader');
                const imgWrapper = document.getElementById('qr-modal-img-wrapper');
                const statusEl = document.getElementById('qr-modal-status');

                if (imgEl && imgEl.src !== data.qr) {
                    imgEl.src = data.qr;
                }
                if (loader) loader.classList.add('hidden');
                if (imgWrapper) imgWrapper.classList.remove('hidden');
                if (statusEl) statusEl.textContent = 'Apunta tu cámara de WhatsApp al código QR...';
            }
        } catch (e) {
            // Silent catch during poll
        }
    }, 2000);
}

function stopQrPolling() {
    if (qrPollInterval) {
        clearInterval(qrPollInterval);
        qrPollInterval = null;
    }
}

function closeQrModal() {
    stopQrPolling();
    activeQrProfileId = null;
    const modal = document.getElementById('modal-qr');
    if (modal) modal.classList.add('hidden');
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
 * Unlink and clear session permanently so the operator can change their number
 */
async function unlinkBot(profileId, profileName) {
    const confirmText = profileName ? `"${profileName}"` : 'este WhatsApp';
    const confirmed = await window.showConfirm({
        title: '¿Desvincular WhatsApp?',
        message: `¿Estás seguro de que deseas desvincular ${confirmText}? Se cerrará la sesión actual en el teléfono y podrás vincular un nuevo número escaneando el código QR.`,
        confirmText: 'Desvincular Cuenta',
        cancelText: 'Cancelar',
        type: 'warning'
    });

    if (!confirmed) return;

    try {
        await api(`/profiles/${profileId}/unlink`, { method: 'POST' });
        toast('Cuenta desvinculada exitosamente. Ahora puedes vincular un nuevo número.', 'success');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al desvincular: ${err.message}`, 'error');
    }
}

/**
 * Delete bot instance permanently
 */
async function deleteBotInstance(profileId, profileName) {
    const confirmText = profileName ? `"${profileName}"` : 'esta instancia';
    const confirmed = await window.showConfirm({
        title: '¿Eliminar Instancia de Bot?',
        message: `¿Estás seguro de que deseas eliminar permanentemente ${confirmText}? Se perderán su configuración y la cola de contactos asignada a esta instancia.`,
        confirmText: 'Eliminar Instancia',
        cancelText: 'Cancelar',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        await api(`/profiles/${profileId}`, { method: 'DELETE' });
        toast('Instancia de bot eliminada exitosamente', 'success');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al eliminar la instancia: ${err.message}`, 'error');
    }
}

/**
 * Operator Create Bot Modal Handlers
 */
function openCreateOperatorBotModal() {
    const myLimit = (window.currentUser && window.currentUser.whatsappLimit !== undefined && window.currentUser.whatsappLimit !== null)
        ? window.currentUser.whatsappLimit
        : ((window.currentUser && window.currentUser.maxProfilesPerOperator) || 2);

    if (operatorBots.length >= myLimit) {
        return toast(`Has alcanzado tu límite máximo de ${myLimit} cuentas de WhatsApp asignadas. Solicita una ampliación a tu administrador.`, 'warning');
    }

    const modal = document.getElementById('modal-create-operator-bot');
    const nameInput = document.getElementById('operator-bot-name');
    const msgInput = document.getElementById('operator-bot-message');
    const catInput = document.getElementById('operator-bot-category');

    if (nameInput) nameInput.value = '';
    if (msgInput) msgInput.value = '';
    if (catInput) catInput.value = 'Movistar';

    if (modal) modal.classList.remove('hidden');
    if (nameInput) setTimeout(() => nameInput.focus(), 50);
    if (window.lucide) lucide.createIcons();
}

function closeCreateOperatorBotModal() {
    const modal = document.getElementById('modal-create-operator-bot');
    if (modal) modal.classList.add('hidden');
}

async function handleCreateOperatorBot() {
    const myLimit = (window.currentUser && window.currentUser.whatsappLimit !== undefined && window.currentUser.whatsappLimit !== null)
        ? window.currentUser.whatsappLimit
        : ((window.currentUser && window.currentUser.maxProfilesPerOperator) || 2);

    if (operatorBots.length >= myLimit) {
        return toast(`Has alcanzado tu límite máximo de ${myLimit} cuentas de WhatsApp permitidas.`, 'warning');
    }

    const nameInput = document.getElementById('operator-bot-name');
    const msgInput = document.getElementById('operator-bot-message');
    const catInput = document.getElementById('operator-bot-category');
    const name = nameInput ? nameInput.value.trim() : '';
    const message = msgInput ? msgInput.value.trim() : '';
    const category = catInput ? catInput.value : 'Movistar';

    if (!name) {
        return toast('Por favor ingresa un nombre para la cuenta', 'warning');
    }

    const btn = document.getElementById('btn-save-operator-bot');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Creando...';
    }

    try {
        await api('/profiles', {
            method: 'POST',
            body: JSON.stringify({ name, message, category })
        });

        toast('Instancia de WhatsApp creada exitosamente', 'success');
        closeCreateOperatorBotModal();
        await loadOperatorBots();
    } catch (err) {
        toast(err.message || 'Error al crear la instancia', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="plus-circle" style="width: 15px; height: 15px;"></i> Crear Instancia';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * Toggle Bot Engine ON/OFF
 */
async function toggleBotState(profileId) {
    const bot = operatorBots.find(b => b.id === profileId);
    if (!bot) return;

    const isConnected = bot.live_status === 'connected' || bot.status === 'connected';

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
    const newName = await window.showPrompt({
        title: 'Cambiar Nombre de Cuenta',
        message: 'Ingresa el nuevo nombre identificador para esta cuenta de WhatsApp:',
        defaultValue: currentName || '',
        placeholder: 'Ej: WhatsApp Ventas 01',
        confirmText: 'Guardar Nombre',
        cancelText: 'Cancelar',
        type: 'edit'
    });

    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
        toast('El nombre no puede estar vacío', 'warning');
        return;
    }
    if (trimmed === currentName) return;

    try {
        await api(`/profiles/${profileId}/config`, {
            method: 'PATCH',
            body: JSON.stringify({ name: trimmed })
        });
        toast('Nombre actualizado exitosamente', 'success');
        await loadOperatorBots();
    } catch (err) {
        toast(`Error al renombrar: ${err.message}`, 'error');
    }
}

/**
 * Real-time WebSocket connection for operators
 */
function initOperatorWebSocket() {
    if (operatorWs && (operatorWs.readyState === WebSocket.OPEN || operatorWs.readyState === WebSocket.CONNECTING)) {
        return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
        operatorWs = new WebSocket(wsUrl);

        operatorWs.onopen = () => {
            operatorWs.send(JSON.stringify({ type: 'auth', token }));
        };

        operatorWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'wa:qr' && data.profileId === activeQrProfileId) {
                    const imgEl = document.getElementById('qr-modal-img');
                    const loader = document.getElementById('qr-modal-loader');
                    const imgWrapper = document.getElementById('qr-modal-img-wrapper');
                    const statusEl = document.getElementById('qr-modal-status');
                    if (imgEl && data.qr) {
                        imgEl.src = data.qr;
                        if (loader) loader.classList.add('hidden');
                        if (imgWrapper) imgWrapper.classList.remove('hidden');
                        if (statusEl) statusEl.textContent = 'Apunta tu cámara de WhatsApp al código QR...';
                    }
                } else if (data.type === 'wa:status') {
                    if (data.profileId === activeQrProfileId && data.status === 'connected') {
                        closeQrModal();
                        toast('¡WhatsApp vinculado y conectado!', 'success');
                    }
                    loadOperatorBots();
                } else if (data.type === 'bot:progress') {
                    const sentEl = document.getElementById(`bot-sent-${data.profileId}`);
                    const pendEl = document.getElementById(`bot-pending-${data.profileId}`);
                    const errEl = document.getElementById(`bot-errors-${data.profileId}`);
                    const stEl = document.getElementById(`bot-status-text-${data.profileId}`);
                    if (sentEl && data.sentToday !== undefined) sentEl.textContent = data.sentToday;
                    if (pendEl && data.pendingCount !== undefined) pendEl.textContent = data.pendingCount;
                    if (errEl && data.errorCount !== undefined) errEl.textContent = data.errorCount;
                    if (stEl && data.statusText) stEl.textContent = data.statusText;
                }
            } catch (e) {
                console.error('[OperatorView WS] Message parse error:', e);
            }
        };

        operatorWs.onclose = () => {
            setTimeout(initOperatorWebSocket, 5000);
        };
    } catch (e) {
        console.warn('[OperatorView] WS initialization ignored:', e);
    }
}

// Modal listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('modal-qr-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeQrModal);
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

    initOperatorWebSocket();

    const queueModal = document.getElementById('modal-bot-queue');
    if (queueModal) {
        queueModal.addEventListener('click', (e) => {
            if (e.target.id === 'modal-bot-queue') closeBotQueueModal();
        });
    }
});

/**
 * Bot Queue Management Modal
 */
let activeQueueBotId = null;

async function openBotQueueModal(profileId, profileName) {
    activeQueueBotId = profileId;
    const bot = Array.isArray(operatorBots) ? operatorBots.find(b => b.id === profileId) : null;
    
    const modal = document.getElementById('modal-bot-queue');
    const titleEl = document.getElementById('modal-bot-queue-title');
    const badgeEl = document.getElementById('modal-bot-queue-badge');
    const subtitleEl = document.getElementById('modal-bot-queue-subtitle');
    const profileIdInput = document.getElementById('modal-bot-queue-profile-id');
    const textarea = document.getElementById('modal-bot-queue-textarea');
    const fileInput = document.getElementById('modal-bot-queue-file');
    const countEl = document.getElementById('modal-bot-queue-parsed-count');

    const name = profileName || (bot ? bot.name : 'WhatsApp');
    const phone = bot && bot.phone_number ? `+${bot.phone_number}` : 'Sin número vinculado';

    if (titleEl) {
        titleEl.innerHTML = `<i data-lucide="upload-cloud" style="color: var(--accent-pink);"></i> Cargar Números: ${escapeHtml(name)}`;
    }
    if (badgeEl) {
        badgeEl.textContent = phone;
    }
    if (subtitleEl) {
        subtitleEl.textContent = `Los números que cargues aquí serán contactados exclusivamente por este bot (${escapeHtml(name)}) con su mensaje asignado.`;
    }
    if (profileIdInput) {
        profileIdInput.value = profileId;
    }
    if (textarea) {
        textarea.value = '';
    }
    if (fileInput) {
        fileInput.value = '';
    }
    if (countEl) {
        countEl.textContent = '0 números detectados';
        countEl.style.color = 'var(--text-tertiary)';
    }

    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();

    await loadBotQueueData(profileId);
}

function closeBotQueueModal() {
    activeQueueBotId = null;
    const modal = document.getElementById('modal-bot-queue');
    if (modal) modal.classList.add('hidden');
}

async function loadBotQueueData(profileId) {
    if (!profileId) return;

    const statPending = document.getElementById('modal-bot-queue-stat-pending');
    const statSent = document.getElementById('modal-bot-queue-stat-sent');
    const statErrors = document.getElementById('modal-bot-queue-stat-errors');
    const tbody = document.getElementById('modal-bot-queue-tbody');

    try {
        const queue = await api(`/profiles/${profileId}/queue`);
        
        let pending = 0;
        let sent = 0;
        let errors = 0;

        if (Array.isArray(queue)) {
            queue.forEach(item => {
                if (item.status === 'pending') pending++;
                else if (item.status === 'sent') sent++;
                else if (item.status === 'error') errors++;
            });
        }

        const bot = Array.isArray(operatorBots) ? operatorBots.find(b => b.id === profileId) : null;
        if (bot) {
            bot.pending_count = pending;
            bot.error_count = errors;
        }

        if (statPending) statPending.textContent = pending;
        if (statSent) statSent.textContent = bot ? (bot.sent_today || 0) : sent;
        if (statErrors) statErrors.textContent = errors;

        // Update card stats in background
        const cardPending = document.getElementById(`bot-pending-${profileId}`);
        const cardErrors = document.getElementById(`bot-errors-${profileId}`);
        if (cardPending) cardPending.textContent = pending;
        if (cardErrors) cardErrors.textContent = errors;

        if (tbody) {
            tbody.innerHTML = '';
            if (!queue || queue.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 16px;">No hay números en la cola de este WhatsApp todavía.</td></tr>';
                return;
            }

            queue.slice(0, 100).forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
                
                let badgeClass = 'active';
                let label = 'Pendiente';
                if (item.status === 'sent') {
                    badgeClass = 'btn-success';
                    label = 'Enviado';
                } else if (item.status === 'error') {
                    badgeClass = 'disabled';
                    label = 'Error';
                } else if (item.status === 'sending') {
                    badgeClass = 'btn-primary';
                    label = 'Enviando...';
                }

                const dateStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

                tr.innerHTML = `
                    <td style="padding: 6px 10px; color: var(--text-tertiary);">${index + 1}</td>
                    <td style="padding: 6px 10px; font-family: monospace; font-weight: 600;">${escapeHtml(item.phone_number)}</td>
                    <td style="padding: 6px 10px;"><span class="badge ${badgeClass}" style="font-size: 10.5px; padding: 2px 8px;">${label}</span></td>
                    <td style="padding: 6px 10px; color: var(--text-secondary);">${dateStr}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('[OperatorView] Error loading bot queue:', err);
    }
}

function parseNumbersFromText(text) {
    if (!text || typeof text !== 'string') return [];
    return text.split(/[\r\n,;]+/)
        .map(n => n.replace(/[^\d+]/g, '').trim())
        .filter(n => {
            const digits = n.replace('+', '');
            return digits.length >= 7 && digits.length <= 16;
        });
}

function handleBotQueueTextareaChange() {
    const textarea = document.getElementById('modal-bot-queue-textarea');
    const countEl = document.getElementById('modal-bot-queue-parsed-count');
    if (!textarea || !countEl) return;

    const numbers = parseNumbersFromText(textarea.value);
    const uniqueNumbers = Array.from(new Set(numbers));

    if (uniqueNumbers.length > 0) {
        countEl.textContent = `${uniqueNumbers.length} números válidos detectados`;
        countEl.style.color = 'var(--accent-pink)';
    } else {
        countEl.textContent = '0 números detectados';
        countEl.style.color = 'var(--text-tertiary)';
    }
}

function handleBotQueueFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const textarea = document.getElementById('modal-bot-queue-textarea');
        if (textarea) {
            const existing = textarea.value.trim();
            textarea.value = existing ? `${existing}\n${event.target.result}` : event.target.result;
            handleBotQueueTextareaChange();
        }
        toast('Archivo cargado en el campo de texto', 'info');
    };
    reader.onerror = () => {
        toast('Error al leer el archivo seleccionado', 'error');
    };
    reader.readAsText(file);
}

async function handleSaveBotQueue() {
    if (!activeQueueBotId) return;

    const textarea = document.getElementById('modal-bot-queue-textarea');
    const text = textarea ? textarea.value : '';
    const numbers = parseNumbersFromText(text);
    const uniqueNumbers = Array.from(new Set(numbers));

    if (uniqueNumbers.length === 0) {
        return toast('Ingresá o pegá al menos un número telefónico válido (ej: +54911...)', 'warning');
    }

    const saveBtn = document.getElementById('modal-bot-queue-save');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Importando...';
    }

    try {
        const res = await api(`/profiles/${activeQueueBotId}/queue/import`, {
            method: 'POST',
            body: JSON.stringify({ numbers: uniqueNumbers })
        });

        let msg = `¡Carga exitosa! ${res.imported} números cargados para este bot.`;
        if (res.skippedBlacklist && res.skippedBlacklist > 0) {
            msg += ` (${res.skippedBlacklist} omitidos por Lista de Exclusión).`;
        }
        toast(msg, 'success');

        if (textarea) textarea.value = '';
        handleBotQueueTextareaChange();

        await loadBotQueueData(activeQueueBotId);
        await loadOperatorBots();
    } catch (err) {
        toast(err.message || 'Error al importar números a este bot', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="upload" style="width: 14px; height: 14px;"></i> Cargar Números a este Bot';
            if (window.lucide) lucide.createIcons();
        }
    }
}

async function handleClearBotQueue() {
    if (!activeQueueBotId) return;

    const confirmed = await window.showConfirm({
        title: '¿Vaciar Cola Pendiente?',
        message: '¿Estás seguro de que deseas eliminar todos los números pendientes de este bot? Los números ya enviados se conservarán en el historial.',
        confirmText: 'Vaciar Cola',
        cancelText: 'Cancelar',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        const res = await api(`/profiles/${activeQueueBotId}/queue?status=pending`, { method: 'DELETE' });
        toast(`Se eliminaron ${res.deleted || 0} números pendientes de este bot`, 'info');
        await loadBotQueueData(activeQueueBotId);
        await loadOperatorBots();
    } catch (err) {
        toast(err.message || 'Error al vaciar cola', 'error');
    }
}

async function handleRetryBotQueueErrors() {
    if (!activeQueueBotId) return;

    try {
        const res = await api(`/profiles/${activeQueueBotId}/queue/retry-errors`, { method: 'POST' });
        toast(`${res.retried || 0} números con error fueron devueltos a pendientes`, 'success');
        await loadBotQueueData(activeQueueBotId);
        await loadOperatorBots();
    } catch (err) {
        toast(err.message || 'Error al reintentar números', 'error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function refreshBotQueueModal() {
    if (activeQueueBotId) loadBotQueueData(activeQueueBotId);
}

// Global window exposure for inline onclick handlers
window.loadOperatorBots = loadOperatorBots;
window.renderOperatorBots = renderOperatorBots;
window.connectBot = connectBot;
window.disconnectBot = disconnectBot;
window.unlinkBot = unlinkBot;
window.deleteBotInstance = deleteBotInstance;
window.openCreateOperatorBotModal = openCreateOperatorBotModal;
window.closeCreateOperatorBotModal = closeCreateOperatorBotModal;
window.handleCreateOperatorBot = handleCreateOperatorBot;
window.toggleBotState = toggleBotState;
window.saveModalBotMessage = saveModalBotMessage;
window.openMessageModal = openMessageModal;
window.openBotQueueModal = openBotQueueModal;
window.closeBotQueueModal = closeBotQueueModal;
window.handleSaveBotQueue = handleSaveBotQueue;
window.handleClearBotQueue = handleClearBotQueue;
window.handleRetryBotQueueErrors = handleRetryBotQueueErrors;
window.handleBotQueueTextareaChange = handleBotQueueTextareaChange;
window.handleBotQueueFileChange = handleBotQueueFileChange;
window.refreshBotQueueModal = refreshBotQueueModal;
window.editBotName = editBotName;
window.closeQrModal = closeQrModal;
window.initOperatorWebSocket = initOperatorWebSocket;
