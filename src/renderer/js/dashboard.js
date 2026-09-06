let currentProfileId = null;
let isBotRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentProfileId = params.get('profileId');

    if (!currentProfileId) {
        alert('No se especificó un perfil.');
        window.location.href = 'index.html';
        return;
    }

    initDashboard();
});

window.addEventListener('beforeunload', () => {
    window.api.removeQRCodeListener();
    window.api.removeStatusChangeListener();
    window.api.removeBotProgressListener();
});

async function initDashboard() {
    try {
        await loadProfileData();
        await loadMessage();
        await loadDelaySettings();
        await loadQueueCount();
        await loadQueue();
        await checkBotRunningStatus();
        
        setupEventListeners();
        setupIPCListeners();
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        alert('Error al inicializar el dashboard.');
    }
}

function setupEventListeners() {
    document.getElementById('back-btn').addEventListener('click', goBack);
    document.getElementById('connect-btn').addEventListener('click', connectWhatsApp);
    document.getElementById('disconnect-btn').addEventListener('click', disconnectWhatsApp);
    document.getElementById('save-message-btn').addEventListener('click', saveMessage);
    document.getElementById('import-btn').addEventListener('click', importNumbers);
    document.getElementById('retry-errors-btn').addEventListener('click', retryErrors);
    document.getElementById('clear-queue-btn').addEventListener('click', clearQueue);
    document.getElementById('save-delay-btn').addEventListener('click', saveDelaySettings);
    document.getElementById('toggle-bot-btn').addEventListener('click', toggleBot);
}

function setupIPCListeners() {
    window.api.onQRCode(handleQRCode);
    window.api.onStatusChange(handleStatusChange);
    window.api.onBotProgress(updateBotProgress);
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
        container.innerHTML = '<p class="text-warning">⏳ Abriendo navegador y conectando sesión... (si ya vinculaste este WhatsApp, conectará automáticamente sin QR)</p>';
        await window.api.connectWhatsApp(currentProfileId);
    } catch (error) {
        console.error('Error connecting:', error);
        alert('Error al intentar conectar WhatsApp: ' + (error.message || error));
        connectBtn.disabled = false;
        connectBtn.textContent = 'Conectar WhatsApp';
        container.innerHTML = '<p class="text-danger">❌ Error al iniciar. Intenta de nuevo.</p>';
    }
}

async function disconnectWhatsApp() {
    if (confirm('¿Desconectar WhatsApp?')) {
        try {
            await window.api.disconnectWhatsApp(currentProfileId);
        } catch (error) {
            console.error('Error disconnecting:', error);
            alert('Error al desconectar.');
        }
    }
}

async function saveMessage() {
    const text = document.getElementById('message-input').value;
    try {
        await window.api.saveMessage(currentProfileId, text);
        alert('Mensaje guardado correctamente.');
    } catch (error) {
        console.error('Error saving message:', error);
        alert('Error al guardar el mensaje.');
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
        const text = await readFileAsync(file);
        numbers = parseNumbers(text);
    } else if (pasteInput.value.trim() !== '') {
        numbers = parseNumbers(pasteInput.value);
    } else {
        alert('Por favor selecciona un archivo o pega números.');
        return;
    }

    if (numbers.length === 0) {
        alert('No se encontraron números válidos.');
        return;
    }

    try {
        const result = await window.api.importNumbers(currentProfileId, numbers);
        alert(`Se importaron ${result.imported} números.`);
        fileInput.value = '';
        pasteInput.value = '';
        await loadQueueCount();
        await loadQueue();
    } catch (error) {
        console.error('Error importing numbers:', error);
        alert('Error al importar números.');
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
                statusLabel = 'Pendiente ⏳';
                statusColor = 'text-warning';
            } else if (item.status === 'error') {
                statusLabel = 'Error ❌';
                statusColor = 'text-danger';
            } else if (item.status === 'sent') {
                statusLabel = 'Enviado ✅';
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
    if (confirm('¿Estás seguro de que quieres limpiar toda la cola?')) {
        try {
            await window.api.clearQueue(currentProfileId);
            await loadQueueCount();
            await loadQueue();
            alert('Cola limpiada.');
        } catch (error) {
            console.error('Error clearing queue:', error);
            alert('Error al limpiar la cola.');
        }
    }
}

async function saveDelaySettings() {
    const settings = {
        delay_min: parseInt(document.getElementById('delay_min').value),
        delay_max: parseInt(document.getElementById('delay_max').value),
        batch_size: parseInt(document.getElementById('batch_size').value),
        batch_pause_min: parseInt(document.getElementById('batch_pause_min').value),
        batch_pause_max: parseInt(document.getElementById('batch_pause_max').value),
        daily_limit: parseInt(document.getElementById('daily_limit').value)
    };

    try {
        await window.api.updateDelaySettings(currentProfileId, settings);
        alert('Configuración guardada.');
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error al guardar configuración.');
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
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function checkBotRunningStatus() {
    try {
        const running = await window.api.isBotRunning(currentProfileId);
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
    } catch (err) {
        console.error('Error checking bot status:', err);
    }
}

async function retryErrors() {
    try {
        const count = await window.api.retryErrors(currentProfileId);
        alert(`Se reencolaron ${count} números para reintentar.`);
        await loadQueueCount();
        await loadQueue();
    } catch (error) {
        console.error('Error retrying errors:', error);
        alert('Error al reintentar números.');
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
        } else {
            await window.api.stopBot(currentProfileId);
            isBotRunning = false;
            btn.textContent = 'Encender Bot';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-success');
            document.getElementById('stat-next').textContent = 'Bot detenido por el usuario';
        }
    } catch (error) {
        console.error('Error toggling bot:', error);
        alert('Error al cambiar el estado del bot.');
    }
}

function updateBotProgress(profileId, data) {
    if (profileId != currentProfileId) return;

    if (data.sent !== undefined) document.getElementById('stat-sent').textContent = data.sent;
    if (data.pending !== undefined) document.getElementById('stat-pending').textContent = data.pending;
    if (data.errors !== undefined) document.getElementById('stat-errors').textContent = data.errors;
    if (data.currentNumber !== undefined) document.getElementById('stat-current').textContent = data.currentNumber || '-';
    if (data.nextAction) document.getElementById('stat-next').textContent = data.nextAction;

    // Sync toggle button state with bot progress lifecycle
    const btn = document.getElementById('toggle-bot-btn');
    if (data.status === 'stopped' || data.status === 'completed' || data.status === 'error') {
        isBotRunning = false;
        if (btn) {
            btn.textContent = 'Encender Bot';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-success');
        }
    } else if (data.status === 'running' || data.status === 'sending' || data.status === 'waiting' || data.status === 'batch_pause') {
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
    const container = document.getElementById('qr-container');
    container.innerHTML = `<img src="${qrDataUrl}" alt="QR Code"><p class="text-secondary mt-10">Escanea este código con WhatsApp desde tu teléfono</p>`;
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Esperando escaneo con tu teléfono...';
    }
}

async function refreshWhatsAppUI() {
    try {
        const sessionState = await window.api.getWhatsAppSessionState(currentProfileId);
        const badge = document.getElementById('status-badge');
        const container = document.getElementById('qr-container');
        const connectBtn = document.getElementById('connect-btn');
        const disconnectBtn = document.getElementById('disconnect-btn');

        if (sessionState.isConnected) {
            badge.textContent = 'Conectado';
            badge.className = 'status-badge connected';
            badge.style.backgroundColor = '';
            container.innerHTML = '<div class="text-success" style="font-size: 48px;">✓</div><p>Sesión Activa</p>';
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
        } else if (sessionState.hasSavedSession) {
            badge.textContent = 'Sesión Guardada';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '#ffb300';
            container.innerHTML = `
                <div style="font-size: 36px; margin-bottom: 8px;">📱</div>
                <p class="text-secondary">Esta cuenta ya está vinculada en tu computadora.</p>
                <p style="font-size: 13px; color: #888; margin-top: 6px;">
                    No necesitas volver a escanear QR. Puedes presionar "Conectar WhatsApp" o directamente "Encender Bot" y se reconectará automáticamente.
                </p>
            `;
            connectBtn.disabled = false;
            connectBtn.textContent = '▶ Conectar WhatsApp (Sesión Guardada)';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
        } else {
            badge.textContent = 'Desconectado';
            badge.className = 'status-badge';
            badge.style.backgroundColor = '';
            container.innerHTML = '<p class="text-secondary">Esta cuenta aún no está vinculada. Presiona "Conectar WhatsApp" para generar el código QR.</p>';
            connectBtn.disabled = false;
            connectBtn.textContent = 'Conectar WhatsApp';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
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
