document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();

    // Event Listeners
    document.getElementById('add-profile-btn').addEventListener('click', showModal);
    document.getElementById('cancel-add-btn').addEventListener('click', hideModal);
    document.getElementById('confirm-add-btn').addEventListener('click', addProfile);

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
});

window.addEventListener('beforeunload', () => {
    window.api.removeStatusChangeListener();
});

async function loadProfiles() {
    try {
        const profiles = await window.api.getProfiles();
        renderProfiles(profiles);
    } catch (error) {
        console.error('Error loading profiles:', error);
        alert('Error al cargar perfiles.');
    }
}

function renderProfiles(profiles) {
    const grid = document.getElementById('profiles-grid');
    grid.innerHTML = '';

    profiles.forEach(profile => {
        const isConnected = profile.status === 'connected';
        const dotClass = isConnected ? 'connected' : 'disconnected';
        const statusText = isConnected ? 'Conectado' : 'Desconectado';

        const card = document.createElement('div');
        card.className = 'profile-card';
        card.innerHTML = `
            <div class="profile-card-header">
                <h3>${profile.name}</h3>
                <div class="status-indicator">
                    <span class="status-dot ${dotClass}" id="dot-${profile.id}"></span>
                    <span id="status-text-${profile.id}">${statusText}</span>
                </div>
            </div>
            <div class="profile-actions">
                <button class="btn-accent" onclick="enterProfile('${profile.id}')">Entrar</button>
                <button class="btn-danger" onclick="deleteProfile('${profile.id}')">Eliminar</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function showModal() {
    const input = document.getElementById('profile-name');
    const err = document.getElementById('modal-error');
    input.value = '';
    if (err) {
        err.textContent = '';
        err.classList.add('hidden');
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
    const name = nameInput.value.trim();

    if (!name) {
        if (err) {
            err.textContent = 'Por favor, ingresa un nombre para el perfil.';
            err.classList.remove('hidden');
        }
        nameInput.focus();
        return;
    }

    try {
        await window.api.createProfile(name);
        hideModal();
        await loadProfiles();
    } catch (error) {
        console.error('Error creating profile:', error);
        if (err) {
            err.textContent = 'Error al crear el perfil: ' + (error.message || error);
            err.classList.remove('hidden');
        }
    }
}

async function deleteProfile(id) {
    if (confirm('¿Estás seguro de que deseas eliminar este perfil? Esto no se puede deshacer.')) {
        try {
            await window.api.deleteProfile(id);
            loadProfiles();
        } catch (error) {
            console.error('Error deleting profile:', error);
            alert('Error al eliminar el perfil.');
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

// Explicit window bindings
window.enterProfile = enterProfile;
window.deleteProfile = deleteProfile;

