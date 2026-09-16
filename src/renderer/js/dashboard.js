let currentProfileId = null;
let isBotRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentProfileId = params.get('profileId');

    if (!currentProfileId) {
        showAlert({ title: 'Perfil No Encontrado', message: 'No se especificó un perfil para gestionar.', type: 'danger' }).then(() => {
            window.location.href = 'index.html';
        });
        return;
    }

    initDashboard();
});

window.addEventListener('beforeunload', () => {
    clearCountdown();
    window.api.removeQRCodeListener();
    window.api.removeStatusChangeListener();
    window.api.removeBotProgressListener();
});

async function initDashboard() {
    try {
        await loadProfileData();
        await loadAnnouncements();
        await loadMessage();
        await loadDelaySettings();
        await loadQueueCount();
        await loadQueue();
        await checkBotRunningStatus();
        
        setupEventListeners();
        setupIPCListeners();
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        await showAlert({ title: 'Error de Carga', message: 'Ocurrió un error al inicializar el dashboard.', type: 'danger' });
    }
}

function setupEventListeners() {
    document.getElementById('back-btn').addEventListener('click', goBack);
    document.getElementById('connect-btn').addEventListener('click', connectWhatsApp);
    document.getElementById('disconnect-btn').addEventListener('click', disconnectWhatsApp);
    const unlinkBtn = document.getElementById('unlink-btn');
    if (unlinkBtn) unlinkBtn.addEventListener('click', unlinkWhatsApp);
    document.getElementById('save-message-btn').addEventListener('click', saveMessage);
    document.getElementById('import-btn').addEventListener('click', importNumbers);
    document.getElementById('retry-errors-btn').addEventListener('click', retryErrors);
    document.getElementById('clear-queue-btn').addEventListener('click', clearQueue);
    document.getElementById('save-delay-btn').addEventListener('click', saveDelaySettings);
    document.getElementById('toggle-bot-btn').addEventListener('click', toggleBot);

    // Early Warning resume button
    const resumeEarlyWarningBtn = document.getElementById('btn-resume-early-warning');
    if (resumeEarlyWarningBtn) {
        resumeEarlyWarningBtn.addEventListener('click', resumeEarlyWarning);
    }

    // Work Schedule & Warmup switches interactive toggle
    const workScheduleToggle = document.getElementById('work_schedule_enabled');
    if (workScheduleToggle) {
        workScheduleToggle.addEventListener('change', (e) => {
            updateScheduleUiState(e.target.checked);
        });
    }

    const warmupToggle = document.getElementById('warmup_enabled');
    if (warmupToggle) {
        warmupToggle.addEventListener('change', (e) => {
            updateWarmupUiState(e.target.checked);
        });
    }

    // Warm-up real-time calculator preview
    const updateWarmupPreview = () => {
        const day = parseInt(document.getElementById('warmup_day').value) || 1;
        const inc = parseInt(document.getElementById('warmup_daily_increment').value) || 15;
        const max = parseInt(document.getElementById('warmup_max_limit').value) || 200;
        const effective = Math.min(max, day * inc);
        const previewEl = document.getElementById('warmup-effective-preview');
        if (previewEl) {
            previewEl.textContent = `${effective} mensajes`;
        }
    };

    ['warmup_day', 'warmup_daily_increment', 'warmup_max_limit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateWarmupPreview);
    });

    const refreshQueueBtn = document.getElementById('refresh-queue-btn');
    if (refreshQueueBtn) {
        refreshQueueBtn.addEventListener('click', async () => {
            await loadQueueCount();
            await loadQueue();
            await loadDelaySettings();
        });
    }

    // Note: Free typing & pasting in numbers-paste is allowed.
    // Numbers are cleanly sanitized and formatted on submit by parseNumbers().

    // Sidebar tab switching
    document.querySelectorAll('.dash-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.dataset.tab;
            if (!targetTab) return;

            document.querySelectorAll('.dash-nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.toggle('hidden', pane.id !== targetTab);
            });

            if (targetTab === 'tab-help') {
                loadDashboardHelpManual();
            }
        });
    });

    const searchHelp = document.getElementById('dash-help-search');
    if (searchHelp) {
        searchHelp.addEventListener('input', handleDashHelpSearch);
    }
}

function setupIPCListeners() {
    window.api.onQRCode(handleQRCode);
    window.api.onStatusChange(handleStatusChange);
    window.api.onBotProgress(updateBotProgress);
    if (window.api.onAuthKill) {
        window.api.onAuthKill(async (reason) => {
            await showAlert({
                title: 'Sesión Terminada',
                message: 'Sesión terminada por el servidor central: ' + (reason === 'company_disabled' ? 'Empresa suspendida.' : 'Cuenta desactivada.'),
                type: 'warning'
            });
            window.location.href = 'login.html';
        });
    }
}

async function loadProfileData() {
    const profiles = await window.api.getProfiles();
    const profile = profiles.find(p => p.id == currentProfileId);
    
    if (profile) {
        document.getElementById('profile-name-display').textContent = profile.name;
    }
    await refreshWhatsAppUI();
}

async function connectWhatsApp() {
    const connectBtn = document.getElementById('connect-btn');
    const container = document.getElementById('qr-container');
    try {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Iniciando conexión...';
        container.innerHTML = `<p class="text-warning" style="display:inline-flex; align-items:center; gap:6px;">${getLucideSvg('loader-2', 16, 'spin')} Abriendo navegador y conectando sesión... (si ya vinculaste este WhatsApp, conectará automáticamente sin QR)</p>`;
        await window.api.connectWhatsApp(currentProfileId);
        await refreshWhatsAppUI();
    } catch (error) {
        console.error('Error connecting:', error);
        await showAlert({
            title: 'Error de Conexión',
            message: 'Error al intentar conectar WhatsApp: ' + (error.message || error),
            type: 'danger'
        });
        connectBtn.disabled = false;
        connectBtn.textContent = 'Conectar WhatsApp';
        container.innerHTML = `<p class="text-danger" style="display:inline-flex; align-items:center; gap:6px;">${getLucideSvg('alert-triangle', 16)} Error al iniciar. Intenta de nuevo.</p>`;
    }
}

async function disconnectWhatsApp() {
    const ok = await showConfirm({
        title: 'Desconectar WhatsApp',
        message: '¿Deseas desconectar la sesión activa de WhatsApp?',
        confirmText: 'Desconectar',
        cancelText: 'Cancelar',
        type: 'warning'
    });
    if (ok) {
        try {
            await window.api.disconnectWhatsApp(currentProfileId);
            await refreshWhatsAppUI();
        } catch (error) {
            console.error('Error disconnecting:', error);
            await showAlert({
                title: 'Error',
                message: 'Error al desconectar: ' + (error.message || error),
                type: 'danger'
            });
        }
    }
}

async function unlinkWhatsApp() {
    const ok = await showConfirm({
        title: 'Desvincular WhatsApp',
        message: '¿Seguro que deseas desvincular este WhatsApp?\n\nSe eliminará por completo la sesión guardada en esta computadora y se generará un código QR nuevo inmediatamente.',
        confirmText: 'Desvincular Cuenta',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    const container = document.getElementById('qr-container');
    const connectBtn = document.getElementById('connect-btn');
    const unlinkBtn = document.getElementById('unlink-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const badge = document.getElementById('status-badge');

    try {
        if (unlinkBtn) unlinkBtn.classList.add('hidden');
        if (disconnectBtn) disconnectBtn.classList.add('hidden');
        if (connectBtn) {
            connectBtn.classList.remove('hidden');
            connectBtn.disabled = true;
            connectBtn.textContent = 'Limpiando sesión...';
        }
        if (badge) {
            badge.textContent = 'Desvinculando...';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '#e94560';
        }

        container.innerHTML = `
            <div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--accent-pink);">${getLucideSvg('loader-2', 36, 'spin')}</div>
            <p class="text-warning" style="font-size: 15px; font-weight: 600;">Desvinculando cuenta y eliminando credenciales...</p>
            <p class="text-secondary" style="font-size: 13px; margin-top: 6px;">
                Borrando la sesión anterior del disco para iniciar de cero.
            </p>
        `;

        // 1. Unlink session completely (kills browser and deletes disk folder)
        await window.api.unlinkWhatsApp(currentProfileId);

        // 2. Refresh UI to clean disconnected state
        await refreshWhatsAppUI();

        await showAlert({
            title: 'Cuenta Desvinculada',
            message: 'Cuenta desvinculada exitosamente.\n\nAhora podés hacer clic en "Conectar WhatsApp" para generar y escanear el nuevo código QR.',
            type: 'success'
        });
    } catch (err) {
        console.error('Error unlinking WhatsApp:', err);
        await showAlert({
            title: 'Error al Desvincular',
            message: 'Error al desvincular la cuenta: ' + (err.message || err),
            type: 'danger'
        });
        await refreshWhatsAppUI();
    }
}

async function saveMessage() {
    const text = document.getElementById('message-input').value;
    try {
        await window.api.saveMessage(currentProfileId, text);
        await showAlert({
            title: 'Mensaje Guardado',
            message: 'El mensaje automático fue guardado correctamente.',
            type: 'success'
        });
    } catch (error) {
        console.error('Error saving message:', error);
        await showAlert({
            title: 'Error al Guardar',
            message: 'Ocurrió un error al guardar el mensaje automático.',
            type: 'danger'
        });
    }
}

async function loadMessage() {
    try {
        const text = await window.api.getMessage(currentProfileId);
        document.getElementById('message-input').value = text || '';
    } catch (error) {
        console.error('Error loading message:', error);
    }
}

async function importNumbers() {
    const fileInput = document.getElementById('file-input');
    const pasteInput = document.getElementById('numbers-paste');
    let numbers = [];

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        try {
            if (ext === 'pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const text = await window.api.parsePdf(arrayBuffer);
                numbers = parseNumbers(text);
            } else {
                const text = await readFileAsync(file);
                numbers = parseNumbers(text);
            }
        } catch (err) {
            console.error('Error parsing file:', err);
            await showAlert({
                title: 'Error de Lectura',
                message: 'Error al leer el archivo: ' + (err.message || err),
                type: 'danger'
            });
            return;
        }
    } else if (pasteInput.value.trim() !== '') {
        numbers = parseNumbers(pasteInput.value);
    } else {
        await showAlert({
            title: 'Datos Faltantes',
            message: 'Por favor seleccioná un archivo (.txt o .pdf) o pegá números de teléfono en el campo.',
            type: 'warning'
        });
        return;
    }

    if (numbers.length === 0) {
        await showAlert({
            title: 'Sin Números Válidos',
            message: 'No se encontraron números telefónicos válidos en el archivo o texto ingresado.',
            type: 'warning'
        });
        return;
    }

    try {
        const result = await window.api.importNumbers(currentProfileId, numbers);
        await showAlert({
            title: 'Importación Exitosa',
            message: `Se importaron ${result.imported} números correctamente a la cola.`,
            type: 'success'
        });
        fileInput.value = '';
        pasteInput.value = '';
        await loadQueueCount();
        await loadQueue();
    } catch (error) {
        console.error('Error importing numbers:', error);
        await showAlert({
            title: 'Error de Importación',
            message: 'Ocurrió un error al importar los números a la cola.',
            type: 'danger'
        });
    }
}

function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsText(file);
    });
}

function parseNumbers(text) {
    return text.split('\n')
        .map(line => line.replace(/[^\d+]/g, ''))
        .filter(line => line.length > 0);
}

async function loadQueue() {
    try {
        const queue = await window.api.getQueueNumbers(currentProfileId);
        const tbody = document.getElementById('queue-tbody');
        tbody.innerHTML = '';
        
        const displayLimit = 100;
        const displayQueue = queue.slice(0, displayLimit);
        
        displayQueue.forEach((item, index) => {
            const tr = document.createElement('tr');
            let statusLabel = item.status;
            let statusColor = '';
            if (item.status === 'pending') {
                statusLabel = `${getLucideSvg('clock', 12)} Pendiente`;
                statusColor = 'text-warning';
            } else if (item.status === 'error') {
                statusLabel = `${getLucideSvg('alert-circle', 12)} Error`;
                statusColor = 'text-danger';
            } else if (item.status === 'sent') {
                statusLabel = `${getLucideSvg('check-circle-2', 12)} Enviado`;
                statusColor = 'text-success';
            }

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.phone_number}</td>
                <td class="${statusColor}">${statusLabel}</td>
            `;
            tbody.appendChild(tr);
        });

        const moreNote = document.getElementById('queue-more-note');
        if (queue.length > displayLimit) {
            moreNote.textContent = `... y ${queue.length - displayLimit} más.`;
            moreNote.classList.remove('hidden');
        } else {
            moreNote.classList.add('hidden');
        }

        // Show upcoming number if bot is not actively running
        if (!isBotRunning) {
            const firstPending = queue.find(item => item.status === 'pending');
            const nextNumberEl = document.getElementById('stat-next-number');
            if (nextNumberEl) {
                nextNumberEl.textContent = firstPending ? firstPending.phone_number : '-';
            }
        }
    } catch (error) {
        console.error('Error loading queue:', error);
    }
}

async function loadQueueCount() {
    try {
        const count = await window.api.getQueueCount(currentProfileId);
        document.getElementById('stat-pending').textContent = count.pending || 0;
        document.getElementById('stat-sent').textContent = count.sent || 0;
        document.getElementById('stat-errors').textContent = count.error || 0;
    } catch (error) {
        console.error('Error loading queue count:', error);
    }
}

async function clearQueue() {
    const ok = await showConfirm({
        title: 'Limpiar Cola de Envíos',
        message: '¿Estás seguro de que deseas vaciar toda la cola de mensajes?\nEsta acción no se puede deshacer.',
        confirmText: 'Limpiar Cola',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (ok) {
        try {
            await window.api.clearQueue(currentProfileId);
            await loadQueueCount();
            await loadQueue();
            await showAlert({
                title: 'Cola Limpiada',
                message: 'Todos los números en cola fueron eliminados exitosamente.',
                type: 'info'
            });
        } catch (error) {
            console.error('Error clearing queue:', error);
            await showAlert({
                title: 'Error',
                message: 'Error al limpiar la cola.',
                type: 'danger'
            });
        }
    }
}

async function saveDelaySettings() {
    const selectedDays = Array.from(document.querySelectorAll('.schedule-day:checked')).map(cb => cb.value).join(',');

    const settings = {
        delay_min: parseInt(document.getElementById('delay_min').value) || 115,
        delay_max: parseInt(document.getElementById('delay_max').value) || 145,
        batch_size: parseInt(document.getElementById('batch_size').value) || 15,
        batch_pause_min: parseInt(document.getElementById('batch_pause_min').value) || 25,
        batch_pause_max: parseInt(document.getElementById('batch_pause_max').value) || 30,
        daily_limit: parseInt(document.getElementById('daily_limit').value) || 200,
        // Work Schedule
        work_schedule_enabled: document.getElementById('work_schedule_enabled').checked,
        work_schedule_start: document.getElementById('work_schedule_start').value || '09:00',
        work_schedule_end: document.getElementById('work_schedule_end').value || '18:00',
        work_schedule_days: selectedDays || '1,2,3,4,5',
        // Warmup Mode
        warmup_enabled: document.getElementById('warmup_enabled').checked,
        warmup_day: parseInt(document.getElementById('warmup_day').value) || 1,
        warmup_daily_increment: parseInt(document.getElementById('warmup_daily_increment').value) || 15,
        warmup_max_limit: parseInt(document.getElementById('warmup_max_limit').value) || 200
    };

    try {
        await window.api.updateDelaySettings(currentProfileId, settings);
        await showAlert({
            title: 'Configuración Guardada',
            message: 'Se guardaron los parámetros de retardos, horario laboral y modo calentamiento con éxito.',
            type: 'success'
        });
    } catch (error) {
        console.error('Error saving settings:', error);
        await showAlert({
            title: 'Error',
            message: 'Error al guardar configuración: ' + (error.message || error),
            type: 'danger'
        });
    }
}

async function loadDelaySettings() {
    try {
        const settings = await window.api.getDelaySettings(currentProfileId);
        if (settings) {
            document.getElementById('delay_min').value = settings.delay_min || 115;
            document.getElementById('delay_max').value = settings.delay_max || 145;
            document.getElementById('batch_size').value = settings.batch_size || 15;
            document.getElementById('batch_pause_min').value = settings.batch_pause_min || 25;
            document.getElementById('batch_pause_max').value = settings.batch_pause_max || 30;
            document.getElementById('daily_limit').value = settings.daily_limit || 200;

            // Work Schedule
            const scheduleCheckbox = document.getElementById('work_schedule_enabled');
            const isScheduleOn = !!settings.work_schedule_enabled;
            if (scheduleCheckbox) scheduleCheckbox.checked = isScheduleOn;
            updateScheduleUiState(isScheduleOn);

            const schedStart = document.getElementById('work_schedule_start');
            if (schedStart) schedStart.value = settings.work_schedule_start || '09:00';
            const schedEnd = document.getElementById('work_schedule_end');
            if (schedEnd) schedEnd.value = settings.work_schedule_end || '18:00';

            const activeDays = (settings.work_schedule_days || '1,2,3,4,5').split(',');
            document.querySelectorAll('.schedule-day').forEach(cb => {
                cb.checked = activeDays.includes(cb.value);
            });

            // Warmup Mode
            const warmupCheckbox = document.getElementById('warmup_enabled');
            const isWarmupOn = !!settings.warmup_enabled;
            if (warmupCheckbox) warmupCheckbox.checked = isWarmupOn;
            updateWarmupUiState(isWarmupOn);

            const warmupDay = document.getElementById('warmup_day');
            if (warmupDay) warmupDay.value = settings.warmup_day || 1;
            const warmupInc = document.getElementById('warmup_daily_increment');
            if (warmupInc) warmupInc.value = settings.warmup_daily_increment || 15;
            const warmupMax = document.getElementById('warmup_max_limit');
            if (warmupMax) warmupMax.value = settings.warmup_max_limit || 200;

            const effective = Math.min(settings.warmup_max_limit || 200, (settings.warmup_day || 1) * (settings.warmup_daily_increment || 15));
            const previewEl = document.getElementById('warmup-effective-preview');
            if (previewEl) previewEl.textContent = `${effective} mensajes`;

            // Early Warning status
            updateEarlyWarningBanner(settings.is_paused_early_warning, settings.early_warning_reason);
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function updateScheduleUiState(isEnabled) {
    const panel = document.getElementById('schedule-inputs-panel');
    const badge = document.getElementById('schedule-status-badge');
    const desc = document.getElementById('schedule-switch-desc');

    if (isEnabled) {
        if (panel) panel.classList.remove('subpanel-disabled');
        if (badge) {
            badge.textContent = 'ACTIVO (RESTRINGIDO)';
            badge.className = 'status-badge connected';
        }
        if (desc) desc.textContent = 'Envíos permitidos solo dentro de los días y horas indicados abajo.';
    } else {
        if (panel) panel.classList.add('subpanel-disabled');
        if (badge) {
            badge.textContent = 'DESACTIVADO (24/7)';
            badge.className = 'status-badge';
        }
        if (desc) desc.textContent = 'El bot operará libremente las 24 horas sin pausas por horario.';
    }
}

function updateWarmupUiState(isEnabled) {
    const panel = document.getElementById('warmup-inputs-panel');
    const badge = document.getElementById('warmup-status-badge');
    const desc = document.getElementById('warmup-switch-desc');

    if (isEnabled) {
        if (panel) panel.classList.remove('subpanel-disabled');
        if (badge) {
            badge.textContent = 'ACTIVO';
            badge.className = 'status-badge connected';
        }
        if (desc) desc.textContent = 'Escalando cuota diaria gradualmente según el día actual.';
    } else {
        if (panel) panel.classList.add('subpanel-disabled');
        if (badge) {
            badge.textContent = 'DESACTIVADO';
            badge.className = 'status-badge';
        }
        if (desc) desc.textContent = 'Aplica el límite diario base sin escalamiento por días.';
    }
}

function updateEarlyWarningBanner(isPaused, reason) {
    const banner = document.getElementById('dash-early-warning-banner');
    if (!banner) return;
    if (isPaused) {
        const msgEl = document.getElementById('early-warning-msg');
        if (msgEl) msgEl.textContent = reason || 'Alta tasa de fallos detectada. La cola fue pausada para proteger la cuenta.';
        banner.classList.remove('hidden');
        if (window.renderLucideIcons) window.renderLucideIcons();
    } else {
        banner.classList.add('hidden');
    }
}

async function resumeEarlyWarning() {
    try {
        const ok = await showConfirm({
            title: 'Reanudar Cola',
            message: '¿Verificaste la lista de contactos y deseas levantar la pausa de seguridad?',
            confirmText: 'Reanudar Cola',
            cancelText: 'Cancelar',
            type: 'warning'
        });
        if (!ok) return;

        await window.api.resumeEarlyWarning(currentProfileId);
        updateEarlyWarningBanner(false);
        await showAlert({
            title: 'Cola Reanudada',
            message: 'La alerta temprana ha sido reseteada. Podés encender el bot nuevamente cuando gustes.',
            type: 'success'
        });
    } catch (err) {
        await showAlert({
            title: 'Error',
            message: 'No se pudo reanudar: ' + (err.message || err),
            type: 'danger'
        });
    }
}

async function loadAnnouncements() {
    try {
        const announcements = await window.api.getAnnouncements();
        const banner = document.getElementById('dash-announcement-banner');
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
        console.warn('Error loading announcements:', e);
    }
}

async function checkBotRunningStatus() {
    try {
        const [running, allStates] = await Promise.all([
            window.api.isBotRunning(currentProfileId),
            window.api.getAllBotStates().catch(() => ({}))
        ]);
        isBotRunning = !!running;
        const btn = document.getElementById('toggle-bot-btn');
        if (btn) {
            if (isBotRunning) {
                btn.textContent = 'Apagar Bot';
                btn.classList.remove('btn-success');
                btn.classList.add('btn-danger');
            } else {
                btn.textContent = 'Encender Bot';
                btn.classList.remove('btn-danger');
                btn.classList.add('btn-success');
            }
        }

        // If bot is active, restore stats and countdown immediately
        const state = allStates ? allStates[currentProfileId] : null;
        if (state && state.data) {
            updateBotProgress(currentProfileId, {
                status: state.status,
                ...state.data
            });
        }
    } catch (err) {
        console.error('Error checking bot status:', err);
    }
}

async function retryErrors() {
    try {
        const count = await window.api.retryErrors(currentProfileId);
        await showAlert({
            title: 'Reintento de Envíos',
            message: `Se reencolaron ${count} números con error para reintentar su envío.`,
            type: 'success'
        });
        await loadQueueCount();
        await loadQueue();
    } catch (error) {
        console.error('Error retrying errors:', error);
        await showAlert({
            title: 'Error al Reintentar',
            message: 'Ocurrió un error al intentar reencolar los números con error.',
            type: 'danger'
        });
    }
}

let countdownInterval = null;

function startCountdown(resumeTimestampMs, nextNumber, actionPrefix) {
    clearCountdown();

    const countdownEl = document.getElementById('stat-countdown');
    const nextActionEl = document.getElementById('stat-next');
    const nextNumberEl = document.getElementById('stat-next-number');

    if (nextNumber && nextNumberEl) {
        nextNumberEl.textContent = nextNumber;
    }

    function tick() {
        const remainingMs = resumeTimestampMs - Date.now();
        if (remainingMs <= 0) {
            if (countdownEl) countdownEl.textContent = '00:00';
            if (nextActionEl) nextActionEl.textContent = `Iniciando envío a ${nextNumber || 'contacto'}...`;
            clearCountdown();
            return;
        }

        const totalSec = Math.ceil(remainingMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const timeFormatted = hours > 0
            ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
            : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (countdownEl) {
            countdownEl.textContent = timeFormatted;
        }

        if (nextActionEl) {
            const prefix = actionPrefix || 'Esperando intervalo';
            const target = nextNumber && nextNumber !== '-' ? ` para ${nextNumber}` : '';
            nextActionEl.textContent = `${prefix}: ${timeFormatted} restantes${target}`;
        }
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
}

function clearCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    const countdownEl = document.getElementById('stat-countdown');
    if (countdownEl) {
        countdownEl.textContent = '-';
    }
}

async function toggleBot() {
    const btn = document.getElementById('toggle-bot-btn');
    try {
        if (!isBotRunning) {
            await window.api.startBot(currentProfileId);
            isBotRunning = true;
            btn.textContent = 'Apagar Bot';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-danger');
            document.getElementById('stat-next').textContent = 'Iniciando bot...';
        } else {
            clearCountdown();
            await window.api.stopBot(currentProfileId);
            isBotRunning = false;
            btn.textContent = 'Encender Bot';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-success');
            document.getElementById('stat-next').textContent = 'Bot detenido por el usuario';
        }
    } catch (error) {
        console.error('Error toggling bot:', error);
        await showAlert({
            title: 'Error de Control',
            message: 'Error al cambiar el estado del bot: ' + (error.message || error),
            type: 'danger'
        });
    }
}

function updateBotProgress(profileId, data) {
    if (profileId != currentProfileId) return;

    if (data.sent !== undefined) document.getElementById('stat-sent').textContent = data.sent;
    if (data.pending !== undefined) document.getElementById('stat-pending').textContent = data.pending;
    if (data.errors !== undefined) document.getElementById('stat-errors').textContent = data.errors;

    // Siguiente número
    const nextNum = data.nextNumber || data.currentNumber;
    if (nextNum !== undefined) {
        const nextNumEl = document.getElementById('stat-next-number');
        if (nextNumEl) nextNumEl.textContent = nextNum || '-';
    }

    // Handle countdown and actions
    if (data.status === 'waiting' || data.status === 'batch_pause') {
        const prefix = data.status === 'batch_pause' ? 'Pausa de lote' : 'Esperando intervalo';
        if (data.resumeTimestampMs) {
            startCountdown(data.resumeTimestampMs, nextNum, prefix);
        } else {
            if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;
        }
    } else if (data.status === 'waiting_turn') {
        clearCountdown();
        const countdownEl = document.getElementById('stat-countdown');
        if (countdownEl) countdownEl.textContent = 'En turno...';
        if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;
    } else if (data.status === 'sending') {
        clearCountdown();
        const countdownEl = document.getElementById('stat-countdown');
        if (countdownEl) countdownEl.textContent = 'Enviando...';
        if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;
    } else if (data.status === 'stopped' || data.status === 'completed' || data.status === 'error') {
        clearCountdown();
        if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;
    } else {
        // running / starting
        clearCountdown();
        if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;
    }

    // Sync toggle button state with bot progress lifecycle
    const btn = document.getElementById('toggle-bot-btn');
    if (data.status === 'stopped' || data.status === 'completed' || data.status === 'error') {
        isBotRunning = false;
        if (btn) {
            btn.textContent = 'Encender Bot';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-success');
        }
    } else if (data.status === 'running' || data.status === 'sending' || data.status === 'waiting' || data.status === 'batch_pause' || data.status === 'waiting_turn') {
        isBotRunning = true;
        if (btn) {
            btn.textContent = 'Apagar Bot';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-danger');
        }
    }
    
    // Periodically reload queue to reflect changes
    loadQueue();
    loadQueueCount();
}

function handleQRCode(profileId, qrDataUrl) {
    if (profileId != currentProfileId) return;
    const badge = document.getElementById('status-badge');
    if (badge) {
        badge.textContent = 'Escaneando QR';
        badge.className = 'status-badge';
        badge.style.backgroundColor = '#ff9800';
    }
    const container = document.getElementById('qr-container');
    container.innerHTML = `<img src="${qrDataUrl}" alt="QR Code"><p class="text-secondary mt-10">Escanea este código con WhatsApp desde tu teléfono</p>`;
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Esperando escaneo con tu teléfono...';
        connectBtn.classList.remove('hidden');
    }
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.classList.remove('hidden');
        disconnectBtn.textContent = 'Cancelar';
    }
    const unlinkBtn = document.getElementById('unlink-btn');
    if (unlinkBtn) {
        unlinkBtn.classList.add('hidden');
    }
}

async function refreshWhatsAppUI() {
    try {
        const sessionState = await window.api.getWhatsAppSessionState(currentProfileId);
        const badge = document.getElementById('status-badge');
        const container = document.getElementById('qr-container');
        const connectBtn = document.getElementById('connect-btn');
        const disconnectBtn = document.getElementById('disconnect-btn');
        const unlinkBtn = document.getElementById('unlink-btn');

        if (sessionState.isConnected || sessionState.status === 'connected') {
            badge.textContent = 'Conectado';
            badge.className = 'status-badge connected';
            badge.style.backgroundColor = '';
            container.innerHTML = `<div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--accent-pink);">${getLucideSvg('check-circle-2', 48, 'icon-glow')}</div><p style="font-size: 16px; font-weight: 600; margin-top: 8px;">Sesión Activa y Conectada</p><p class="text-secondary" style="font-size: 13px;">Esta cuenta está lista para enviar mensajes.</p>`;
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
            disconnectBtn.textContent = 'Pausar Conexión';
            if (unlinkBtn) {
                unlinkBtn.classList.remove('hidden');
                unlinkBtn.disabled = false;
            }
        } else if (sessionState.status === 'waiting_qr' || (container.querySelector('img') && sessionState.status === 'initializing')) {
            badge.textContent = 'Escaneando QR';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '#ff9800';
            if (sessionState.qrDataUrl && !container.querySelector('img')) {
                container.innerHTML = `<img src="${sessionState.qrDataUrl}" alt="QR Code"><p class="text-secondary mt-10">Escanea este código con WhatsApp desde tu teléfono</p>`;
            }
            connectBtn.disabled = true;
            connectBtn.textContent = 'Esperando escaneo con tu teléfono...';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.remove('hidden');
            disconnectBtn.textContent = 'Cancelar';
            if (unlinkBtn) unlinkBtn.classList.add('hidden');
        } else if (sessionState.status === 'authenticated') {
            badge.textContent = 'Conectando...';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '#29b6f6';
            container.innerHTML = `
                <div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--accent-pink);">${getLucideSvg('loader-2', 36, 'spin')}</div>
                <p class="text-warning" style="font-size: 15px; font-weight: 500;">Autenticado correctamente, sincronizando chats...</p>
                <p style="font-size: 13px; color: #888; margin-top: 6px;">
                    Cargando WhatsApp en segundo plano. Aguarda unos instantes.
                </p>
            `;
            connectBtn.disabled = true;
            connectBtn.textContent = 'Conectando...';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            if (unlinkBtn) {
                unlinkBtn.classList.remove('hidden');
                unlinkBtn.disabled = false;
            }
        } else if (sessionState.status === 'initializing') {
            if (sessionState.hasSavedSession) {
                badge.textContent = 'Conectando...';
                badge.className = 'status-badge';
                badge.style.backgroundColor = '#29b6f6';
                container.innerHTML = `
                    <div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--accent-pink);">${getLucideSvg('loader-2', 36, 'spin')}</div>
                    <p class="text-warning" style="font-size: 15px; font-weight: 500;">Conectando WhatsApp con tu sesión guardada...</p>
                    <p style="font-size: 13px; color: #888; margin-top: 6px;">
                        Cargando chats y sincronizando en segundo plano. Aguarda unos segundos.
                    </p>
                `;
            } else {
                badge.textContent = 'Iniciando...';
                badge.className = 'status-badge';
                badge.style.backgroundColor = '#ff9800';
                container.innerHTML = `
                    <div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--accent-pink);">${getLucideSvg('loader-2', 36, 'spin')}</div>
                    <p class="text-warning" style="font-size: 15px; font-weight: 500;">Generando nuevo código QR...</p>
                    <p style="font-size: 13px; color: #888; margin-top: 6px;">
                        Abriendo navegador limpio sin recordar ninguna cuenta. El QR aparecerá en instantes.
                    </p>
                `;
            }
            connectBtn.disabled = true;
            connectBtn.textContent = 'Iniciando...';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            if (unlinkBtn) unlinkBtn.classList.add('hidden');
        } else if (sessionState.hasSavedSession) {
            badge.textContent = 'Sesión Guardada';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '#ffb300';
            container.innerHTML = `
                <div style="display:flex; justify-content:center; margin-bottom:12px; color:var(--text-tertiary);">${getLucideSvg('smartphone', 36)}</div>
                <p style="font-size: 15px; font-weight: 600; color: var(--text-primary);">Esta cuenta ya está vinculada en tu computadora.</p>
                <p style="font-size: 13px; color: #aaa; margin-top: 6px; max-width: 480px; margin-left: auto; margin-right: auto;">
                    No necesitas volver a escanear QR. Presiona <strong>Conectar WhatsApp</strong> o <strong>Encender Bot</strong> para levantar la conexión.
                </p>
            `;
            connectBtn.disabled = false;
            connectBtn.innerHTML = `${getLucideSvg('play', 14)} Conectar WhatsApp (Sesión Guardada)`;
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            if (unlinkBtn) {
                unlinkBtn.classList.remove('hidden');
                unlinkBtn.disabled = false;
            }
        } else {
            badge.textContent = 'Desconectado';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '';
            container.innerHTML = '<p class="text-secondary">Esta cuenta no tiene ninguna sesión guardada. Presiona "Conectar WhatsApp" para generar el código QR.</p>';
            connectBtn.disabled = false;
            connectBtn.textContent = 'Conectar WhatsApp (Generar QR)';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            if (unlinkBtn) unlinkBtn.classList.add('hidden');
        }
    } catch (err) {
        console.error('Error refreshing WhatsApp UI:', err);
    }
}

function handleStatusChange(profileId, status) {
    if (profileId != currentProfileId) return;
    refreshWhatsAppUI();
}

function goBack() {
    window.location.href = 'index.html';
}

// ================= DASHBOARD HELP MANUAL =================
let dashHelpManual = null;

async function loadDashboardHelpManual() {
    const display = document.getElementById('dash-help-display');
    const title = document.getElementById('dash-help-title');
    if (!display) return;

    if (!dashHelpManual) {
        display.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">Cargando manual oficial...</div>';
        try {
            const res = await window.api.getHelpManual();
            dashHelpManual = res;
            if (title && res.title) title.textContent = res.title;
            renderDashHelpContent(res.content || '');
            setupDashHelpNavPills();
        } catch (err) {
            display.innerHTML = `<div style="color: #f87171; text-align: center; padding: 20px;">Error al cargar el manual: ${err.message}</div>`;
        }
    } else {
        renderDashHelpContent(dashHelpManual.content || '');
    }
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

function renderDashHelpMarkdown(md) {
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

function renderDashHelpContent(content) {
    const display = document.getElementById('dash-help-display');
    if (!display) return;
    const filteredContent = filterManualForDesktop(content);
    display.innerHTML = renderDashHelpMarkdown(filteredContent);

    display.querySelectorAll('a.manual-anchor-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').replace('#', '');
            scrollDashHelpToSection(targetId);
        });
    });
}

function scrollDashHelpToSection(slugOrId) {
    const display = document.getElementById('dash-help-display');
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

function setupDashHelpNavPills() {
    const pills = document.querySelectorAll('#dash-help-quick-bar .help-nav-pill');
    pills.forEach(pill => {
        pill.onclick = () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const target = pill.dataset.target;
            if (target === 'all') {
                const display = document.getElementById('dash-help-display');
                if (display) display.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                scrollDashHelpToSection(target);
            }
        };
    });
}

function handleDashHelpSearch() {
    const query = document.getElementById('dash-help-search').value.trim().toLowerCase();
    if (!dashHelpManual || !dashHelpManual.content) return;

    if (!query) {
        renderDashHelpContent(dashHelpManual.content);
        return;
    }

    const display = document.getElementById('dash-help-display');
    renderDashHelpContent(dashHelpManual.content);

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

window.loadDashboardHelpManual = loadDashboardHelpManual;

