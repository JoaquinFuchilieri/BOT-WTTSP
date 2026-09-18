/**
 * F-Dispatch — Distribution View Controller
 * Gestor de carga masiva de bases de datos de números y reparto automático entre bots.
 */

let distributionPreviewData = null;
let distributionInitialized = false;

function initDistributionView() {
    const fileInput = document.getElementById('distribution-file-input');
    const dropZone = document.getElementById('distribution-drop-zone');
    const previewBtn = document.getElementById('btn-preview-distribution');
    const executeBtn = document.getElementById('btn-execute-distribution');
    const textArea = document.getElementById('distribution-text-input');

    if (!fileInput || !previewBtn) return;
    if (distributionInitialized) return;
    distributionInitialized = true;

    // File input change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        readFileContent(file);
    });

    // Drag & Drop handlers
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent-pink)';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '';
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                readFileContent(e.dataTransfer.files[0]);
            }
        });
    }

    // Preview button
    previewBtn.addEventListener('click', async () => {
        const text = textArea ? textArea.value.trim() : '';
        if (!text) {
            toast('Pega o sube una lista de números telefónicos primero', 'error');
            return;
        }

        previewBtn.disabled = true;
        previewBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Analizando...';

        try {
            const data = await api('/distribution/preview', {
                method: 'POST',
                body: JSON.stringify({ numbersRaw: text })
            });

            distributionPreviewData = data;
            renderDistributionPreview(data);
            toast(`Se detectaron ${data.totalClean} números válidos`, 'success');
        } catch (err) {
            console.error('[DistributionView] Preview error:', err);
            toast(`Error: ${err.message}`, 'error');
        } finally {
            previewBtn.disabled = false;
            previewBtn.innerHTML = '<i data-lucide="scan"></i> Analizar Números y Previsualizar Reparto';
            if (window.lucide) lucide.createIcons();
        }
    });

    // Execute button
    if (executeBtn) {
        executeBtn.addEventListener('click', async () => {
            const text = textArea ? textArea.value.trim() : '';
            if (!text || !distributionPreviewData) {
                toast('Primero debes analizar la lista de números', 'error');
                return;
            }

            if (!confirm(`¿Confirmas la distribución de ${distributionPreviewData.totalClean} números entre los bots de la empresa?`)) {
                return;
            }

            executeBtn.disabled = true;
            executeBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Distribuyendo en colas...';

            try {
                const res = await api('/distribution/execute', {
                    method: 'POST',
                    body: JSON.stringify({ numbersRaw: text })
                });

                toast(res.message || 'Números distribuidos con éxito', 'success');

                // Reset inputs and preview
                if (textArea) textArea.value = '';
                if (fileInput) fileInput.value = '';
                distributionPreviewData = null;

                const placeholder = document.getElementById('distribution-preview-placeholder');
                const results = document.getElementById('distribution-preview-results');
                if (placeholder) placeholder.classList.remove('hidden');
                if (results) results.classList.add('hidden');
            } catch (err) {
                console.error('[DistributionView] Execute error:', err);
                toast(`Error al distribuir: ${err.message}`, 'error');
            } finally {
                executeBtn.disabled = false;
                executeBtn.innerHTML = '<i data-lucide="check-circle-2"></i> Confirmar y Cargar en Colas de los Bots';
                if (window.lucide) lucide.createIcons();
            }
        });
    }
}

function readFileContent(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const textArea = document.getElementById('distribution-text-input');
        if (textArea) textArea.value = text;
        toast(`Archivo cargado (${file.name})`, 'info');
    };
    reader.onerror = () => {
        toast('Error al leer el archivo seleccionado', 'error');
    };
    reader.readAsText(file);
}

function renderDistributionPreview(data) {
    const placeholder = document.getElementById('distribution-preview-placeholder');
    const results = document.getElementById('distribution-preview-results');
    const statValid = document.getElementById('dist-stat-valid');
    const statBlacklist = document.getElementById('dist-stat-blacklisted');
    const statBots = document.getElementById('dist-stat-bots');
    const tableBody = document.getElementById('distribution-table-body');

    if (placeholder) placeholder.classList.add('hidden');
    if (results) results.classList.remove('hidden');

    if (statValid) statValid.textContent = data.totalClean.toLocaleString();
    if (statBlacklist) statBlacklist.textContent = data.blacklistedExcluded.toLocaleString();
    if (statBots) statBots.textContent = data.candidateBotsCount;

    if (tableBody) {
        tableBody.innerHTML = '';

        if (!data.distribution || data.distribution.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="padding:14px; text-align:center; color:var(--text-secondary);">No hay bots disponibles para recibir números.</td></tr>';
            return;
        }

        data.distribution.forEach(d => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-hairline)';

            const isConnected = d.status === 'connected';
            const statusDot = isConnected 
                ? '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#4ade80; margin-right:6px;"></span>' 
                : '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f87171; margin-right:6px;"></span>';

            tr.innerHTML = `
                <td style="padding: 10px 12px; font-weight: 600; color: var(--text-primary);">
                    ${statusDot} ${escapeHtml(d.name)}
                </td>
                <td style="padding: 10px 12px; color: var(--text-secondary);">
                    ${escapeHtml(d.operatorEmail)}
                </td>
                <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #4ade80;">
                    ${d.assignedCount.toLocaleString()} contactos
                </td>
            `;

            tableBody.appendChild(tr);
        });
    }
}

window.initDistributionView = initDistributionView;
