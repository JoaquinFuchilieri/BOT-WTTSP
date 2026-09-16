let currentSession = null;
let currentOperators = [];
let selectedOperatorFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
    await initSession();
    await loadAnnouncements();
    await setupAdminNavigation();
    await loadProfiles();

    // Event Listeners
    document.getElementById('add-profile-btn').addEventListener('click', showModal);
    document.getElementById('cancel-add-btn').addEventListener('click', hideModal);
    document.getElementById('confirm-add-btn').addEventListener('click', addProfile);
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const ok = await showConfirm({
                title: 'Cerrar Sesión',
                message: '¿Estás seguro de que deseas cerrar sesión en este dispositivo?',
                confirmText: 'Cerrar Sesión',
                cancelText: 'Cancelar',
                type: 'warning'
            });
            if (ok) {
                await window.api.authLogout();
            }
        });
    }

    const lockLogoutBtn = document.getElementById('lock-logout-btn');
    if (lockLogoutBtn) {
        lockLogoutBtn.addEventListener('click', async () => {
            await window.api.authLogout();
        });
    }

    // Keyboard navigation in modal
    const nameInput = document.getElementById('profile-name');
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addProfile();
        } else if (e.key === 'Escape') {
            hideModal();
        }
    });

    // Close modal when clicking dark backdrop
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') {
            hideModal();
        }
    });

    // Set up status listener
    window.api.onStatusChange((profileId, status) => {
        updateProfileStatus(profileId, status);
    });

    // Set up bot progress listener
    window.api.onBotProgress((profileId, data) => {
        updateBotCardProgress(profileId, data);
    });

    // Fleet controls
    const btnStartAll = document.getElementById('btn-start-all-bots');
    if (btnStartAll) {
        btnStartAll.addEventListener('click', startAllBots);
    }
    const btnStopAll = document.getElementById('btn-stop-all-bots');
    if (btnStopAll) {
        btnStopAll.addEventListener('click', stopAllBots);
    }

    // Help Modal
    const btnHelp = document.getElementById('btn-help');
    if (btnHelp) {
        btnHelp.addEventListener('click', openHelpModal);
    }
    const btnCloseHelp = document.getElementById('btn-close-help-modal');
    if (btnCloseHelp) {
        btnCloseHelp.addEventListener('click', closeHelpModal);
    }
    const modalHelp = document.getElementById('modal-help');
    if (modalHelp) {
        modalHelp.addEventListener('click', (e) => {
            if (e.target.id === 'modal-help') closeHelpModal();
        });
    }
    const helpSearch = document.getElementById('help-modal-search');
    if (helpSearch) {
        helpSearch.addEventListener('input', handleHelpModalSearch);
    }

    // Kill switch listener
    window.api.onAuthKill((reason) => {
        console.warn('Kill switch received from server:', reason);
        const lockScreen = document.getElementById('lock-screen');
        const lockTitle = document.getElementById('lock-title');
        const lockMessage = document.getElementById('lock-message');

        if (reason === 'company_disabled') {
            lockTitle.textContent = 'Empresa Suspendida';
            lockMessage.textContent = 'La cuenta de tu empresa fue suspendida temporalmente por administración. Comunícate con soporte.';
        } else if (reason === 'user_disabled') {
            lockTitle.textContent = 'Usuario Desactivado';
            lockMessage.textContent = 'Tu usuario ha sido desactivado por el administrador de tu empresa.';
        } else {
            lockTitle.textContent = 'Licencia Inválida';
            lockMessage.textContent = 'No fue posible validar la licencia contra el servidor central.';
        }

        lockScreen.classList.remove('hidden');
    });

    // Real-time synchronization (Web <-> Local) every 7 seconds
    syncInterval = setInterval(async () => {
        const modal = document.getElementById('modal');
        if (modal && modal.classList.contains('hidden')) {
            try {
                if (currentSession && currentSession.user && currentSession.user.role === 'admin') {
                    const users = await window.api.getUsers();
                    currentOperators = users.filter(u => u.role === 'user');
                }
                await loadProfiles();
            } catch (e) {
                // Silent catch on temporary blips
            }
        }
    }, 7000);
});

let syncInterval = null;

window.addEventListener('beforeunload', () => {
    if (syncInterval) clearInterval(syncInterval);
    window.api.removeStatusChangeListener();
    window.api.removeBotProgressListener();
});

async function initSession() {
    try {
        const session = await window.api.authGetSession();
        if (session && session.user) {
            currentSession = session;
            const display = document.getElementById('user-info-display');
            if (display) {
                const roleText = session.user.role === 'admin' ? 'Administrador' : 'Operador';
                const compSvg = (typeof getLucideSvg === 'function') ? getLucideSvg('building-2', 13) : '';
                const shieldSvg = (typeof getLucideSvg === 'function') ? getLucideSvg('shield-check', 13) : '';
                const userSvg = (typeof getLucideSvg === 'function') ? getLucideSvg('user', 13) : '';
                display.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px;">${compSvg} ${session.user.companyName || 'Empresa'}</span> <span style="opacity:0.4;"> • </span> <span style="display:inline-flex; align-items:center; gap:4px;">${shieldSvg} ${roleText}</span> <span style="opacity:0.4;"> • </span> <span style="display:inline-flex; align-items:center; gap:4px;">${userSvg} ${session.user.email}</span>`;
            }

            // Both admins and operators can create accounts (up to their assigned limits)
            const addBtn = document.getElementById('add-profile-btn');
            if (addBtn) {
                addBtn.classList.remove('hidden');
            }
        }
    } catch (err) {
        console.error('Error getting session:', err);
    }
}

async function setupAdminNavigation() {
    if (!currentSession || !currentSession.user) return;

    const navBar = document.getElementById('admin-nav-bar');
    const select = document.getElementById('operator-select');

    if (currentSession.user.role === 'admin') {
        navBar.classList.remove('hidden');

        try {
            const users = await window.api.getUsers();
            // Filter only operators (role = 'user')
            currentOperators = users.filter(u => u.role === 'user');

            select.innerHTML = '<option value="all">Todos los Operadores</option>';
            currentOperators.forEach(op => {
                const opt = document.createElement('option');
                opt.value = op.id;
                opt.textContent = `${op.email} (${op.assigned_profiles || 0} cuentas)`;
                select.appendChild(opt);
            });

            select.addEventListener('change', async (e) => {
                selectedOperatorFilter = e.target.value;
                updateOperatorBadgeInfo();
                await loadProfiles();
            });

            updateOperatorBadgeInfo();
        } catch (err) {
            console.error('Error loading operators for navigation:', err);
        }
    } else {
        navBar.classList.add('hidden');
    }
}

function updateOperatorBadgeInfo() {
    const info = document.getElementById('operator-badge-info');
    if (!info) return;

    if (selectedOperatorFilter === 'all') {
        info.textContent = `Mostrando todas las cuentas asignadas a tu empresa (${currentOperators.length} operadores).`;
    } else {
        const op = currentOperators.find(u => u.id == selectedOperatorFilter);
        info.textContent = op ? `Viendo únicamente las cuentas asignadas a ${op.email}` : '';
    }
}

let currentProfilesList = [];
let currentBotStates = {};

async function loadProfiles() {
    try {
        const filterId = (currentSession && currentSession.user.role === 'admin' && selectedOperatorFilter !== 'all')
            ? selectedOperatorFilter
            : null;

        const [profiles, botStates] = await Promise.all([
            window.api.getProfiles(filterId),
            window.api.getAllBotStates().catch(() => ({}))
        ]);

        currentProfilesList = profiles || [];
        currentBotStates = botStates || {};
        renderProfiles(currentProfilesList);
        updateFleetToolbar();
    } catch (error) {
        console.error('Error loading profiles:', error);
    }
}

function updateFleetToolbar() {
    let runningCount = 0;
    let totalPending = 0;
    for (const p of currentProfilesList) {
        if (currentBotStates[p.id] && currentBotStates[p.id].running) {
            runningCount++;
        }
        totalPending += parseInt(p.pending_count || 0, 10);
    }
    const label = document.getElementById('fleet-status-label');
    if (label) {
        label.innerHTML = `${getLucideSvg('bot', 13)} Flota de Bots: ${runningCount} de ${currentProfilesList.length} activos`;
        if (runningCount > 0) {
            label.style.borderColor = 'var(--accent-pink)';
            label.style.color = 'var(--accent-pink)';
            label.style.boxShadow = '0 0 12px var(--accent-pink-glow)';
        } else {
            label.style.borderColor = 'var(--border-hairline)';
            label.style.color = 'var(--text-secondary)';
            label.style.boxShadow = 'none';
        }
    }
    const summary = document.getElementById('fleet-queue-summary');
    if (summary) {
        summary.textContent = `Total en cola: ${totalPending} mensajes pendientes`;
    }
}

function renderProfiles(profiles) {
    const grid = document.getElementById('profiles-grid');
    grid.innerHTML = '';

    if (!Array.isArray(profiles) || profiles.length === 0) {
        const isOperator = currentSession && currentSession.user && currentSession.user.role === 'user';
        const msg = isOperator
            ? 'No tienes cuentas de WhatsApp creadas aún. Haz clic en "+ Agregar nueva cuenta" para iniciar una.'
            : 'No hay cuentas de WhatsApp que coincidan con este filtro.';
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-secondary);">
                <div style="margin-bottom: 12px; color: var(--text-tertiary); display: flex; justify-content: center;">${getLucideSvg('smartphone', 38)}</div>
                <p style="font-size: 15px; font-weight: 500;">${msg}</p>
                <p style="font-size: 13px; margin-top: 6px;">Hacé clic en <strong>+ Agregar nueva cuenta</strong> para comenzar.</p>
            </div>
        `;
        return;
    }

    profiles.forEach(profile => {
        const isConnected = profile.status === 'connected';
        const dotClass = isConnected ? 'connected' : 'disconnected';
        const statusText = isConnected ? 'Conectado' : 'Desconectado';
        const operatorTag = profile.assigned_user_email 
            ? `<div style="font-size: 11px; color: var(--accent-blue); margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;">${getLucideSvg('user', 12)} Operador: ${profile.assigned_user_email}</div>`
            : '';

        const isAdmin = currentSession && currentSession.user && currentSession.user.role === 'admin';
        const canDelete = isAdmin || (currentSession && currentSession.user && profile.assigned_user_id === currentSession.user.id);

        const botState = currentBotStates[profile.id];
        const isBotRunning = botState && botState.running;

        let botBadgeClass = 'stopped';
        let botBadgeText = `${getLucideSvg('square', 12)} Bot Inactivo`;
        if (isBotRunning) {
            const isBatchPause = botState.status === 'batch_pause';
            const isWaiting = botState.status === 'waiting';
            const isWaitingTurn = botState.status === 'waiting_turn';

            if (isBatchPause) {
                botBadgeClass = 'paused';
                botBadgeText = `${getLucideSvg('pause', 12)} Pausa de lote anti-ban`;
            } else if (isWaiting) {
                botBadgeClass = 'running';
                botBadgeText = `${getLucideSvg('clock', 12)} Esperando intervalo`;
            } else if (isWaitingTurn) {
                botBadgeClass = 'running';
                botBadgeText = `${getLucideSvg('hourglass', 12)} Esperando turno de envío`;
            } else {
                botBadgeClass = 'running';
                botBadgeText = `${getLucideSvg('send', 12)} Enviando mensajes`;
            }

            if ((isBatchPause || isWaiting) && botState.data && botState.data.resumeTimestampMs) {
                const nextNum = botState.data.nextNumber || botState.data.currentNumber || '-';
                const diff = botState.data.resumeTimestampMs - Date.now();
                if (diff > 0) {
                    const prefix = isBatchPause ? `${getLucideSvg('pause', 12)} Pausa de lote` : `${getLucideSvg('clock', 12)} Esperando`;
                    const target = nextNum && nextNum !== '-' ? ` (Próx: ${nextNum})` : '';
                    botBadgeText = `${prefix}: ${formatCountdownTime(diff)}${target}`;
                }
                setTimeout(() => {
                    setCardCountdown(profile.id, botState.data.resumeTimestampMs, nextNum, isBatchPause);
                }, 10);
            }
        }

        const pendingCount = profile.pending_count || 0;
        const sentToday = profile.sent_today || 0;
        const dailyLimit = profile.daily_limit || 200;

        const card = document.createElement('div');
        card.className = 'profile-card';
        card.id = `card-${profile.id}`;
        card.innerHTML = `
            <div class="profile-card-header">
                <div>
                    <h3>${profile.name}</h3>
                    ${operatorTag}
                </div>
                <div class="status-indicator">
                    <span class="status-dot ${dotClass}" id="dot-${profile.id}"></span>
                    <span id="status-text-${profile.id}">${statusText}</span>
                </div>
            </div>

            <div class="card-meta-row">
                <span style="display:inline-flex; align-items:center; gap:5px;">${getLucideSvg('list', 13)} <strong>${pendingCount}</strong> en cola</span>
                <span style="display:inline-flex; align-items:center; gap:5px;">${getLucideSvg('send', 13)} Hoy: <strong>${sentToday} / ${dailyLimit}</strong></span>
            </div>

            <div class="card-bot-status ${botBadgeClass}" id="bot-status-${profile.id}">
                ${botBadgeText}
            </div>

            <div class="profile-actions">
                <button id="btn-toggle-${profile.id}" 
                        class="${isBotRunning ? 'btn-danger' : 'btn-primary'}" 
                        style="padding: 7px 14px; font-size: 12px;"
                        onclick="toggleBotFromCard('${profile.id}', event)">
                    ${isBotRunning ? getLucideSvg('square', 12) + ' Detener Bot' : getLucideSvg('play', 12) + ' Iniciar Bot'}
                </button>
                <button class="btn-accent" style="padding: 7px 14px; font-size: 12px; display: inline-flex; align-items: center;" onclick="enterProfile('${profile.id}')">${getLucideSvg('settings', 12)} Configurar</button>
                ${canDelete ? `<button class="btn-secondary btn-icon-only" style="padding: 7px 10px; font-size: 12px; color: var(--accent-red); display: inline-flex; align-items: center; justify-content: center;" onclick="deleteProfile('${profile.id}')">${getLucideSvg('trash-2', 13)}</button>` : ''}
            </div>
        `;
        grid.appendChild(card);
    });
}

const cardCountdowns = new Map();
let cardCountdownInterval = null;

function formatCountdownTime(ms) {
    if (ms <= 0) return '00:00';
    const totalSec = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function ensureCardCountdownTicker() {
    if (cardCountdownInterval) return;
    cardCountdownInterval = setInterval(() => {
        const now = Date.now();
        if (cardCountdowns.size === 0) {
            clearInterval(cardCountdownInterval);
            cardCountdownInterval = null;
            return;
        }

        cardCountdowns.forEach((info, profileId) => {
            const statusEl = document.getElementById(`bot-status-${profileId}`);
            if (!statusEl) return;

            const diff = info.resumeTimestampMs - now;
            if (diff <= 0) {
                statusEl.innerHTML = `${getLucideSvg('send', 12)} Iniciando envío a ${info.nextNumber || 'contacto'}...`;
                cardCountdowns.delete(profileId);
                return;
            }

            const timeStr = formatCountdownTime(diff);
            const prefix = info.isBatchPause ? `${getLucideSvg('pause', 12)} Pausa de lote` : `${getLucideSvg('clock', 12)} Esperando`;
            const target = info.nextNumber && info.nextNumber !== '-' ? ` (Próx: ${info.nextNumber})` : '';
            statusEl.textContent = `${prefix}: ${timeStr}${target}`;
        });
    }, 1000);
}

function setCardCountdown(profileId, resumeTimestampMs, nextNumber, isBatchPause) {
    if (!resumeTimestampMs || resumeTimestampMs <= Date.now()) {
        cardCountdowns.delete(profileId);
        return;
    }
    cardCountdowns.set(profileId, {
        resumeTimestampMs,
        nextNumber: nextNumber || '-',
        isBatchPause: !!isBatchPause
    });
    ensureCardCountdownTicker();

    const statusEl = document.getElementById(`bot-status-${profileId}`);
    if (statusEl) {
        const diff = resumeTimestampMs - Date.now();
        const timeStr = formatCountdownTime(diff);
        const prefix = isBatchPause ? `${getLucideSvg('pause', 12)} Pausa de lote` : `${getLucideSvg('clock', 12)} Esperando`;
        const target = nextNumber && nextNumber !== '-' ? ` (Próx: ${nextNumber})` : '';
        statusEl.textContent = `${prefix}: ${timeStr}${target}`;
    }
}

async function toggleBotFromCard(profileId, event) {
    if (event) event.stopPropagation();
    const btn = document.getElementById(`btn-toggle-${profileId}`);
    const isRunning = currentBotStates[profileId] && currentBotStates[profileId].running;

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Procesando...';
        }

        if (isRunning) {
            cardCountdowns.delete(profileId);
            await window.api.stopBot(profileId);
            currentBotStates[profileId] = { running: false, status: 'stopped' };
        } else {
            await window.api.startBot(profileId);
            currentBotStates[profileId] = { running: true, status: 'running' };
        }
        await loadProfiles();
    } catch (err) {
        console.error('Error toggling bot from card:', err);
        await showAlert({
            title: 'Error de Control',
            message: 'Error al controlar el bot: ' + (err.message || err),
            type: 'danger'
        });
        if (btn) btn.disabled = false;
    }
}

function updateBotCardProgress(profileId, data) {
    if (!currentBotStates[profileId]) {
        currentBotStates[profileId] = {};
    }
    const isRunning = data.status === 'running' || data.status === 'sending' || data.status === 'waiting' || data.status === 'batch_pause' || data.status === 'waiting_turn';
    currentBotStates[profileId].running = isRunning;
    currentBotStates[profileId].status = data.status;
    currentBotStates[profileId].data = data;

    const statusEl = document.getElementById(`bot-status-${profileId}`);
    const btnEl = document.getElementById(`btn-toggle-${profileId}`);

    if (statusEl) {
        statusEl.className = 'card-bot-status ' + (isRunning ? (data.status === 'batch_pause' ? 'paused' : 'running') : 'stopped');
        if (data.status === 'running' || data.status === 'sending') {
            cardCountdowns.delete(profileId);
            statusEl.innerHTML = `${getLucideSvg('send', 12)} Enviando a ${data.currentNumber || 'contacto'}... (${data.sent || 0} enviados)`;
        } else if (data.status === 'waiting_turn') {
            cardCountdowns.delete(profileId);
            statusEl.innerHTML = `${getLucideSvg('hourglass', 12)} ${data.nextAction || 'Esperando turno de envío...'}`;
        } else if (data.status === 'waiting' || data.status === 'batch_pause') {
            const isBatchPause = data.status === 'batch_pause';
            const nextNum = data.nextNumber || data.currentNumber || '-';
            if (data.resumeTimestampMs) {
                setCardCountdown(profileId, data.resumeTimestampMs, nextNum, isBatchPause);
            } else {
                cardCountdowns.delete(profileId);
                statusEl.innerHTML = isBatchPause 
                    ? `${getLucideSvg('pause', 12)} ${data.nextAction || 'Pausa de lote anti-ban'}`
                    : `${getLucideSvg('clock', 12)} ${data.nextAction || 'Esperando intervalo anti-ban...'}`;
            }
        } else if (data.status === 'stopped') {
            cardCountdowns.delete(profileId);
            statusEl.innerHTML = `${getLucideSvg('square', 12)} Bot detenido: ${data.nextAction || 'Inactivo'}`;
        } else if (data.status === 'error') {
            cardCountdowns.delete(profileId);
            statusEl.innerHTML = `${getLucideSvg('alert-circle', 12)} ${data.nextAction || 'Error'}`;
        }
    }

    if (btnEl) {
        btnEl.disabled = false;
        if (isRunning) {
            btnEl.innerHTML = `${getLucideSvg('square', 12)} Detener Bot`;
            btnEl.className = 'btn-danger';
            btnEl.style.background = '';
        } else {
            btnEl.innerHTML = `${getLucideSvg('play', 12)} Iniciar Bot`;
            btnEl.className = 'btn-primary';
            btnEl.style.background = '';
        }
    }

    updateFleetToolbar();
}

async function startAllBots() {
    const ids = currentProfilesList.map(p => p.id);
    if (ids.length === 0) return;
    const ok = await showConfirm({
        title: 'Iniciar Flota de Bots',
        message: `¿Deseas iniciar los ${ids.length} bots de WhatsApp en paralelo?\nCada uno operará de forma independiente con su propia cola.`,
        confirmText: 'Iniciar Flota',
        cancelText: 'Cancelar',
        type: 'primary'
    });
    if (ok) {
        await window.api.startAllBots(ids);
        setTimeout(loadProfiles, 1500);
    }
}

async function stopAllBots() {
    const ok = await showConfirm({
        title: 'Detener Todos los Bots',
        message: '¿Estás seguro de que deseas detener todos los bots de WhatsApp activos?',
        confirmText: 'Detener Todos',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (ok) {
        await window.api.stopAllBots();
        setTimeout(loadProfiles, 500);
    }
}

function showModal() {
    const input = document.getElementById('profile-name');
    const err = document.getElementById('modal-error');
    const assignGroup = document.getElementById('profile-assign-group');
    const assignSelect = document.getElementById('profile-assigned-user');

    input.value = '';
    if (err) {
        err.textContent = '';
        err.classList.add('hidden');
    }

    if (currentSession && currentSession.user) {
        if (currentSession.user.role === 'admin') {
            if (assignGroup) assignGroup.classList.remove('hidden');
            if (assignSelect) {
                assignSelect.innerHTML = '';
                // Option 1: Admin self
                const optSelf = document.createElement('option');
                optSelf.value = currentSession.user.id;
                optSelf.textContent = `${currentSession.user.email} (Tú - Administrador)`;
                assignSelect.appendChild(optSelf);

                // Option 2+: Operators
                currentOperators.forEach(op => {
                    const opt = document.createElement('option');
                    opt.value = op.id;
                    opt.textContent = `${op.email} (Operador)`;
                    assignSelect.appendChild(opt);
                });
            }
        } else {
            if (assignGroup) assignGroup.classList.add('hidden');
        }
    }

    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
}

function hideModal() {
    document.getElementById('modal').classList.add('hidden');
}

async function addProfile() {
    const nameInput = document.getElementById('profile-name');
    const err = document.getElementById('modal-error');
    const assignSelect = document.getElementById('profile-assigned-user');
    const name = nameInput.value.trim();

    if (!name) {
        if (err) {
            err.textContent = 'Por favor, ingresa un nombre para el perfil.';
            err.classList.remove('hidden');
        }
        nameInput.focus();
        return;
    }

    let assignedUserId = null;
    if (currentSession && currentSession.user) {
        if (currentSession.user.role === 'admin') {
            assignedUserId = assignSelect ? assignSelect.value : null;
            if (!assignedUserId) {
                if (err) {
                    err.textContent = 'Debes seleccionar obligatoriamente un operador responsable.';
                    err.classList.remove('hidden');
                }
                return;
            }
        } else {
            assignedUserId = currentSession.user.id;
        }
    }

    try {
        await window.api.createProfile(name, assignedUserId);
        hideModal();
        await loadProfiles();
    } catch (error) {
        console.error('Error creating profile:', error);
        if (err) {
            let msg = error.message || String(error);
            msg = msg.replace(/^Error invoking remote method '[^']+': Error:\s*/, '').replace(/^Error:\s*/, '');
            err.textContent = msg;
            err.classList.remove('hidden');
        }
    }
}

async function deleteProfile(id) {
    const ok = await showConfirm({
        title: 'Eliminar Perfil',
        message: '¿Estás seguro de que deseas eliminar este perfil?\nEsta acción no se puede deshacer.',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (ok) {
        try {
            await window.api.deleteProfile(id);
            await loadProfiles();
        } catch (error) {
            console.error('Error deleting profile:', error);
            await showAlert({
                title: 'Error',
                message: 'Error al eliminar el perfil: ' + (error.message || error),
                type: 'danger'
            });
        }
    }
}

function enterProfile(id) {
    window.location.href = `dashboard.html?profileId=${id}`;
}

function updateProfileStatus(profileId, status) {
    const dot = document.getElementById(`dot-${profileId}`);
    const text = document.getElementById(`status-text-${profileId}`);
    
    if (dot && text) {
        const isConnected = status === 'connected';
        dot.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
        text.textContent = isConnected ? 'Conectado' : 'Desconectado';
    }
}

async function loadAnnouncements() {
    try {
        const announcements = await window.api.getAnnouncements();
        const banner = document.getElementById('announcement-banner-container');
        if (!banner) return;

        if (announcements && announcements.length > 0) {
            const active = announcements[0];
            const iconMap = {
                danger: 'alert-triangle',
                warning: 'alert-circle',
                info: 'info'
            };
            const iconName = iconMap[active.priority] || 'info';
            banner.className = `announcement-banner priority-${active.priority || 'info'}`;
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i data-lucide="${iconName}" style="width: 18px; height: 18px; flex-shrink: 0;"></i>
                    <div>
                        <span class="announcement-banner-title">${active.title}:</span>
                        <span>${active.message}</span>
                    </div>
                </div>
            `;
            banner.classList.remove('hidden');
            if (window.renderLucideIcons) window.renderLucideIcons();
        } else {
            banner.classList.add('hidden');
        }
    } catch (e) {
        console.warn('Error loading announcements in profiles:', e);
    }
}

// Explicit window bindings
window.enterProfile = enterProfile;
window.deleteProfile = deleteProfile;
window.toggleBotFromCard = toggleBotFromCard;
window.startAllBots = startAllBots;
window.stopAllBots = stopAllBots;

// ================= HELP MODAL =================
let desktopHelpManual = null;

async function openHelpModal() {
    const modal = document.getElementById('modal-help');
    const display = document.getElementById('help-modal-display');
    const title = document.getElementById('help-modal-title');
    modal.classList.remove('hidden');

    if (!desktopHelpManual) {
        display.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">Cargando manual oficial...</div>';
        try {
            const res = await window.api.getHelpManual();
            desktopHelpManual = res;
            if (title && res.title) title.textContent = res.title;
            renderDesktopHelpContent(res.content || '');
            setupDesktopHelpNavPills();
        } catch (err) {
            display.innerHTML = `<div style="color: #f87171; text-align: center; padding: 20px;">Error al cargar el manual: ${err.message}</div>`;
        }
    } else {
        renderDesktopHelpContent(desktopHelpManual.content || '');
    }
}

function closeHelpModal() {
    const modal = document.getElementById('modal-help');
    if (modal) modal.classList.add('hidden');
}

function filterManualForDesktop(md) {
    if (!md) return '';
    let res = md;
    // 1. Clean intro sentence mentioning Panel Web
    res = res.replace(/tanto\s+en\s+el\s+\*?\*?Programa\s+de\s+Escritorio\*?\*?\s+como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, 'en el **Programa de Escritorio**.');
    res = res.replace(/\s*como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, '.');
    // 2. Remove Section 3 (Panel Web) and sub-items from Table of Contents
    res = res.replace(/^\s*3\.\s*\[.*?(?:web|panel|saas).*?\].*?\n(?:\s+-\s*3\.\d+.*?\n)*/gim, '');
    // 3. Renumber Section 4 in Table of Contents to Section 3
    res = res.replace(/^\s*4\.\s*\[(.*?)\]\((#.*?)\)/gim, (match, title, anchor) => {
        const cleanTitle = title.replace(/^4\.\s*/, '3. ');
        const cleanAnchor = anchor.replace(/#4-/, '#3-');
        return `3. [${cleanTitle}](${cleanAnchor})`;
    });
    // 4. Remove Section 3 body
    res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*4\.)/gi, '');
    res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*\d+|$)/gi, '');
    // 5. Renumber Section 4 heading to Section 3
    res = res.replace(/##\s*4\.\s*/g, '## 3. ');
    // 6. Clean duplicate separators
    res = res.replace(/---\s*\n\s*---\s*\n/g, '---\n');
    return res.trim();
}

function renderDesktopHelpMarkdown(md) {
    if (!md) return '';
    const lines = md.split('\n');
    const output = [];
    let inList = false;
    let listType = null;
    let inBlockquote = false;
    let bqLines = [];

    const flushBlockquote = () => {
        if (inBlockquote) {
            output.push(`<blockquote>${bqLines.join('<br>')}</blockquote>`);
            bqLines = [];
            inBlockquote = false;
        }
    };

    const flushList = () => {
        if (inList) {
            output.push(listType === 'ol' ? '</ol>' : '</ul>');
            inList = false;
            listType = null;
        }
    };

    const formatInline = (text) => {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            .replace(/\[([^\]]+)\]\((#[^)]+)\)/g, '<a href="$2" class="manual-anchor-link">$1</a>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    };

    const slugify = (text) => {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-');
    };

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (/^---+\s*$/.test(line)) {
            flushList();
            flushBlockquote();
            output.push('<hr>');
            continue;
        }

        if (/^>\s?(.*)$/.test(line)) {
            flushList();
            inBlockquote = true;
            const match = line.match(/^>\s?(.*)$/);
            bqLines.push(formatInline(match[1]));
            continue;
        } else {
            flushBlockquote();
        }

        if (/^#\s+(.+)$/.test(line)) {
            flushList();
            const text = line.replace(/^#\s+/, '');
            output.push(`<h1 id="${slugify(text)}">${formatInline(text)}</h1>`);
            continue;
        }
        if (/^##\s+(.+)$/.test(line)) {
            flushList();
            const text = line.replace(/^##\s+/, '');
            output.push(`<h2 id="${slugify(text)}">${formatInline(text)}</h2>`);
            continue;
        }
        if (/^###\s+(.+)$/.test(line)) {
            flushList();
            const text = line.replace(/^###\s+/, '');
            output.push(`<h3 id="${slugify(text)}">${formatInline(text)}</h3>`);
            continue;
        }

        if (/^[-*]\s+(.+)$/.test(line)) {
            if (!inList || listType !== 'ul') {
                flushList();
                output.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            const itemText = line.replace(/^[-*]\s+/, '');
            output.push(`<li>${formatInline(itemText)}</li>`);
            continue;
        }

        if (/^\d+\.\s+(.+)$/.test(line)) {
            if (!inList || listType !== 'ol') {
                flushList();
                output.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            const itemText = line.replace(/^\d+\.\s+/, '');
            output.push(`<li>${formatInline(itemText)}</li>`);
            continue;
        }

        if (/^\s+[-*]\s+(.+)$/.test(line)) {
            const itemText = line.trim().replace(/^[-*]\s+/, '');
            output.push(`<li style="margin-left: 20px;">${formatInline(itemText)}</li>`);
            continue;
        }

        if (line.trim() === '') {
            flushList();
            continue;
        }

        flushList();
        output.push(`<p>${formatInline(line)}</p>`);
    }

    flushList();
    flushBlockquote();
    return output.join('\n');
}

function renderDesktopHelpContent(content) {
    const display = document.getElementById('help-modal-display');
    if (!display) return;
    const filteredContent = filterManualForDesktop(content);
    display.innerHTML = renderDesktopHelpMarkdown(filteredContent);

    display.querySelectorAll('a.manual-anchor-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').replace('#', '');
            scrollDesktopToSection(targetId);
        });
    });
}

function scrollDesktopToSection(slugOrId) {
    const display = document.getElementById('help-modal-display');
    if (!display) return;
    let target = null;
    if (slugOrId === 'anti-ban' || slugOrId.includes('anti-ban') || slugOrId.includes('buenas-practicas')) {
        target = display.querySelector('[id*="buenas-practicas"], [id*="anti-ban-para-el-operador"]');
    }
    if (!target) {
        target = display.querySelector(`[id*="${slugOrId}"]`);
    }
    if (!target) {
        const headings = display.querySelectorAll('h1, h2, h3');
        for (const h of headings) {
            const normText = (h.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if ((slugOrId === 'anti-ban' || slugOrId.includes('buenas-practicas')) && normText.includes('buenas practicas')) {
                target = h;
                break;
            }
            const normSlug = slugOrId.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (normText.includes(normSlug) || (h.id && h.id.includes(normSlug))) {
                target = h;
                break;
            }
        }
    }
    if (target) {
        const displayRect = display.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const relativeTop = targetRect.top - displayRect.top + display.scrollTop;
        display.scrollTo({ top: relativeTop, behavior: 'smooth' });
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.style.transition = 'color 0.3s ease';
        const origColor = target.style.color;
        target.style.color = '#e04d80';
        setTimeout(() => { target.style.color = origColor; }, 1200);
    }
}

function setupDesktopHelpNavPills() {
    const pills = document.querySelectorAll('#help-modal-quick-bar .help-nav-pill');
    pills.forEach(pill => {
        pill.onclick = () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const target = pill.dataset.target;
            if (target === 'all') {
                const display = document.getElementById('help-modal-display');
                if (display) display.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                scrollDesktopToSection(target);
            }
        };
    });
}

function handleHelpModalSearch() {
    const query = document.getElementById('help-modal-search').value.trim().toLowerCase();
    if (!desktopHelpManual || !desktopHelpManual.content) return;

    if (!query) {
        renderDesktopHelpContent(desktopHelpManual.content);
        return;
    }

    const display = document.getElementById('help-modal-display');
    renderDesktopHelpContent(desktopHelpManual.content);

    const walker = document.createTreeWalker(display, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement && !['SCRIPT', 'STYLE', 'CODE'].includes(node.parentElement.tagName)) {
            if (node.nodeValue.toLowerCase().includes(query)) {
                nodesToReplace.push(node);
            }
        }
    }

    let firstMatch = null;
    nodesToReplace.forEach(node => {
        const span = document.createElement('span');
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        span.innerHTML = node.nodeValue.replace(regex, '<span class="manual-highlight">$1</span>');
        if (!firstMatch) firstMatch = span.querySelector('.manual-highlight');
        node.parentElement.replaceChild(span, node);
    });

    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

window.openHelpModal = openHelpModal;
window.closeHelpModal = closeHelpModal;

