
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
// =========================================================
// SaaS Web Dashboard Controller (Hierarchical Box-in-Box)
// With Gemini Collapsible Sidebar & Apple macOS Dark Theme
// =========================================================

let token = localStorage.getItem('saas_token');
let currentUser = null;

// Context state
let activeCompanyId = null;
let activeCompanyName = '';
let activeCompanyStatus = 'active';

let companies = [];
let companyUsers = [];
let companyProfiles = [];
let companyNotes = [];

let selectedAssignUserId = null;
let editingUserId = null;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

function setupEventListeners() {
    const on = (id, event, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    };

    // Auth
    on('login-form', 'submit', handleLogin);
    on('btn-logout', 'click', handleLogout);

    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            if (viewId) switchView(viewId);
        });
    });

    // Switch company button (SuperAdmin breadcrumb)
    on('btn-switch-company', 'click', () => {
        switchView('view-companies');
    });

    // Modals
    // 1. Company Modal
    on('btn-open-create-company', 'click', () => showModal('modal-company'));
    on('modal-comp-cancel', 'click', () => hideModal('modal-company'));
    on('modal-comp-save', 'click', handleCreateCompany);

    // 2. Company Limits Modal (Gear )
    on('modal-limits-cancel', 'click', () => hideModal('modal-company-limits'));
    on('modal-limits-save', 'click', handleSaveCompanyLimits);
    on('modal-limits-delete-company', 'click', handleDeleteCompanyFromLimits);

    // 3. User Modals (Admin / Operator)
    on('btn-add-admin', 'click', () => openCreateUserModal('admin'));
    on('btn-add-operator', 'click', () => openCreateUserModal('user'));
    on('modal-user-cancel', 'click', () => hideModal('modal-user'));
    on('modal-user-save', 'click', handleSaveUser);
    on('new-user-email', 'keydown', (e) => { if (e.key === 'Enter') handleSaveUser(); });
    on('new-user-pass', 'keydown', (e) => { if (e.key === 'Enter') handleSaveUser(); });
    on('modal-user', 'click', (e) => { if (e.target.id === 'modal-user') hideModal('modal-user'); });
    on('modal-nested-profile', 'click', (e) => { if (e.target.id === 'modal-nested-profile') hideModal('modal-nested-profile'); });
    on('modal-company-limits', 'click', (e) => { if (e.target.id === 'modal-company-limits') hideModal('modal-company-limits'); });
    on('modal-company', 'click', (e) => { if (e.target.id === 'modal-company') hideModal('modal-company'); });

    // Dedicated Operator WhatsApp Quota Modal
    on('quota-modal-cancel', 'click', () => hideModal('modal-operator-whatsapp-quota'));
    on('quota-modal-save', 'click', handleSaveOperatorQuota);
    on('modal-operator-whatsapp-quota', 'click', (e) => { if (e.target.id === 'modal-operator-whatsapp-quota') hideModal('modal-operator-whatsapp-quota'); });
    on('quota-modal-input-limit', 'keydown', (e) => { if (e.key === 'Enter') handleSaveOperatorQuota(); });
    on('btn-edit-nested-quota', 'click', () => {
        if (!activeNestedOperatorId) return;
        const targetUser = Array.isArray(companyUsers) ? companyUsers.find(u => u.id === activeNestedOperatorId) : null;
        let companyMaxWA = 10;
        if (currentUser && currentUser.role === 'superadmin') {
            const comp = Array.isArray(companies) ? companies.find(c => c.id === activeCompanyId) : null;
            if (comp) companyMaxWA = comp.whatsapp_limit || 10;
        } else if (currentUser) {
            companyMaxWA = currentUser.companyWhatsappLimit || 10;
        }
        const assigned = targetUser ? (parseInt(targetUser.assigned_profiles, 10) || 0) : 0;
        const currentLimit = targetUser && targetUser.whatsapp_limit !== null && targetUser.whatsapp_limit !== undefined 
            ? targetUser.whatsapp_limit 
            : 0;
        const compMax = targetUser ? (targetUser.company_whatsapp_limit || companyMaxWA) : companyMaxWA;
        const otherQuotas = Array.isArray(companyUsers) 
            ? companyUsers.filter(x => x.id !== activeNestedOperatorId).reduce((s, x) => s + (parseInt(x.whatsapp_limit, 10) || 0), 0)
            : 0;
        const maxAvailable = Math.max(0, compMax - otherQuotas);
        openOperatorQuotaModal(activeNestedOperatorId, activeNestedOperatorEmail, currentLimit, assigned, compMax, otherQuotas, maxAvailable);
    });

    // 4. Nested Profile Modal (under Operator)
    on('btn-add-nested-profile', 'click', openAddNestedProfileModal);
    on('btn-close-nested-profiles', 'click', closeNestedOperatorProfiles);
    on('modal-nested-profile-cancel', 'click', () => hideModal('modal-nested-profile'));
    on('modal-nested-profile-save', 'click', handleCreateNestedProfile);

    // 5. Reports / Support Tickets
    on('btn-open-superadmin-tickets', 'click', () => switchView('view-reports'));
    on('btn-back-to-companies', 'click', () => switchView('view-companies'));
    on('btn-refresh-tickets', 'click', loadSuperAdminTicketsLog);
    on('modal-ticket-detail-close', 'click', () => hideModal('modal-ticket-detail'));
    on('modal-ticket-detail-delete', 'click', handleDeleteCurrentTicketFromDetail);
    on('modal-ticket-detail', 'click', (e) => { if (e.target.id === 'modal-ticket-detail') hideModal('modal-ticket-detail'); });
    on('admin-report-form', 'submit', handleAdminSubmitTicket);

    // 6. Blacklist
    on('btn-open-add-blacklist', 'click', () => showModal('modal-blacklist'));
    on('modal-blacklist-cancel', 'click', () => hideModal('modal-blacklist'));
    on('modal-blacklist-save', 'click', handleSaveBlacklistNumber);
    on('blacklist-search-input', 'input', filterBlacklistTable);

    // 7. System Announcements (SuperAdmin & Admin View)
    // 8. Centralized Proxy Pool (SuperAdmin Only)
    on('btn-open-superadmin-proxies', 'click', () => switchView('view-proxies'));
    on('btn-back-from-proxies', 'click', () => switchView('view-companies'));
    on('btn-rebalance-proxies', 'click', handleRebalanceProxies);
    on('btn-save-pool-proxies', 'click', handleBulkAddProxies);

    on('btn-open-superadmin-announcements', 'click', () => switchView('view-announcements'));
    on('btn-back-from-announcements', 'click', handleBackFromAnnouncements);
    on('btn-open-create-announcement', 'click', openCreateAnnouncementModal);
    on('modal-announcement-cancel', 'click', () => hideModal('modal-announcement'));
    on('modal-announcement-save', 'click', handleSaveAnnouncement);
    on('modal-announcement', 'click', (e) => { if (e.target.id === 'modal-announcement') hideModal('modal-announcement'); });

    // Admin Announcements View & Refresh
    on('btn-open-announcements-inbox', 'click', () => switchView('view-admin-announcements'));
    on('nav-admin-announcements', 'click', () => switchView('view-admin-announcements'));
    on('btn-refresh-admin-announcements', 'click', loadAdminAnnouncementsView);

    // 8. Audit Logs
    on('btn-refresh-audit', 'click', loadAuditLogs);
    on('audit-search-input', 'input', filterAuditTable);

    // 9. Metrics: Operators Comparison & Executive Reports
    on('btn-refresh-operators-comparison', 'click', loadOperatorsComparison);
    on('btn-apply-report-filters', 'click', loadExecutiveReport);
    on('btn-export-csv', 'click', exportReportCSV);
    on('btn-export-pdf', 'click', exportReportPDF);

    // 10. Profile Configuration Modal
    on('modal-profile-config-cancel', 'click', () => hideModal('modal-profile-config'));
    on('modal-profile-config-save', 'click', handleSaveProfileConfig);
    on('btn-modal-resume-early-warning', 'click', handleResumeEarlyWarningFromModal);

    // 11. Help Manual
    on('btn-edit-help', 'click', openEditHelpManual);
    on('btn-cancel-help', 'click', cancelEditHelpManual);
    on('btn-save-help', 'click', handleSaveHelpManual);
    on('btn-reset-help', 'click', handleResetHelpManual);
    on('btn-open-superadmin-help', 'click', () => switchView('view-help'));
    on('nav-help', 'click', () => switchView('view-help'));
    on('help-search-input', 'input', handleHelpSearch);
}

// ================= TOAST NOTIFICATION SYSTEM =================
function toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.style.cssText = `
        background: rgba(30, 30, 36, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid ${type === 'error' ? 'rgba(255, 69, 58, 0.4)' : 'rgba(48, 209, 88, 0.4)'};
        color: #fff;
        padding: 12px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-size: 13.5px;
        display: flex;
        align-items: center;
        gap: 8px;
        animation: appleFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    const iconSvg = type === 'error' 
        ? (typeof getLucideSvg === 'function' ? getLucideSvg('alert-triangle', 18) : '')
        : (typeof getLucideSvg === 'function' ? getLucideSvg('check-circle-2', 18) : '');
    el.innerHTML = `<span style="display:inline-flex; align-items:center; color:${type === 'error' ? 'var(--accent-red)' : 'var(--accent-pink)'};">${iconSvg}</span> <span>${message}</span>`;
    container.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'all 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

// ================= API HELPER =================
async function api(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };

    const res = await fetch(endpoint, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
            if (data.reason === 'company_disabled' || data.reason === 'user_disabled') {
                toast(`Acceso Denegado: ${data.error}`, 'error');
            }
        }
        throw new Error(data.error || `HTTP error ${res.status}`);
    }
    return data;
}

// ================= AUTHENTICATION =================
async function initApp() {
    if (!token) {
        showLogin();
        return;
    }

    try {
        const res = await api('/auth/me');
        currentUser = res.user;
        showAppShell();
    } catch (err) {
        console.warn('Session expired or invalid:', err);
        handleLogout();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';

    try {
        const res = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        token = res.accessToken;
        currentUser = res.user;
        localStorage.setItem('saas_token', token);
        showAppShell();
        toast(`Bienvenido, ${currentUser.email}!`);
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Ingresar al Panel';
    }
}

let metricsPollInterval = null;

function handleLogout() {
    if (metricsPollInterval) clearInterval(metricsPollInterval);
    token = null;
    currentUser = null;
    window.currentUser = null;
    localStorage.removeItem('saas_token');
    localStorage.removeItem('saas_active_view');
    localStorage.removeItem('saas_active_company_id');
    localStorage.removeItem('saas_active_company_name');
    localStorage.removeItem('saas_active_company_status');
    showLogin();
}

function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('app-section').classList.add('hidden');
}

function showAppShell() {
    window.currentUser = currentUser;
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('app-section').classList.remove('hidden');

    // Sidebar footer info
    document.getElementById('sidebar-email').textContent = currentUser.email;
    document.getElementById('sidebar-role').textContent = currentUser.role.toUpperCase();
    document.getElementById('sidebar-avatar').textContent = (currentUser.email[0] || 'U').toUpperCase();

    const savedView = localStorage.getItem('saas_active_view');

    // Load top system announcement banner
    loadActiveAnnouncementBanner();

    if (currentUser.role === 'superadmin') {
        document.getElementById('nav-companies').classList.remove('hidden');
        document.getElementById('nav-announcements').classList.remove('hidden');
        // Nav-proxies is tenant-scoped now: show if activeCompanyId exists
        if (document.getElementById('nav-proxies')) {
            if (activeCompanyId) document.getElementById('nav-proxies').classList.remove('hidden');
            else document.getElementById('nav-proxies').classList.add('hidden');
        }
        document.getElementById('nav-admins').classList.remove('hidden');
        document.getElementById('nav-operators').classList.remove('hidden');
        document.getElementById('nav-blacklist').classList.remove('hidden');
        document.getElementById('nav-audit').classList.remove('hidden');
        document.getElementById('nav-reports').classList.add('hidden');
        if (document.getElementById('nav-distribution')) document.getElementById('nav-distribution').classList.remove('hidden');
        if (document.getElementById('nav-operator-bots')) document.getElementById('nav-operator-bots').classList.add('hidden');
        if (document.getElementById('nav-admin-announcements')) document.getElementById('nav-admin-announcements').classList.add('hidden');
        if (document.getElementById('btn-open-announcements-inbox')) document.getElementById('btn-open-announcements-inbox').classList.add('hidden');

        const savedCompId = localStorage.getItem('saas_active_company_id');
        const savedCompName = localStorage.getItem('saas_active_company_name');
        const savedCompStatus = localStorage.getItem('saas_active_company_status');

        if (savedCompId && savedView && savedView !== 'view-companies' && savedView !== 'view-announcements') {
            activeCompanyId = savedCompId;
            activeCompanyName = savedCompName || 'Empresa';
            activeCompanyStatus = savedCompStatus || 'active';
            if (document.getElementById('nav-proxies')) document.getElementById('nav-proxies').classList.remove('hidden');
            updateBreadcrumb();
            switchView(savedView);
        } else if (savedView === 'view-announcements') {
            switchView('view-announcements');
        } else {
            switchView('view-companies');
        }
    } else if (currentUser.role === 'user') {
        // OPERATOR VIEW
        document.getElementById('nav-companies').classList.add('hidden');
        document.getElementById('nav-announcements').classList.add('hidden');
        if (document.getElementById('nav-proxies')) document.getElementById('nav-proxies').classList.add('hidden');
        document.getElementById('nav-admins').classList.add('hidden');
        document.getElementById('nav-operators').classList.add('hidden');
        document.getElementById('nav-blacklist').classList.add('hidden');
        document.getElementById('nav-audit').classList.add('hidden');
        document.getElementById('nav-reports').classList.add('hidden');
        document.getElementById('nav-metrics').classList.add('hidden');
        if (document.getElementById('nav-admin-announcements')) document.getElementById('nav-admin-announcements').classList.add('hidden');
        if (document.getElementById('btn-open-announcements-inbox')) document.getElementById('btn-open-announcements-inbox').classList.add('hidden');

        if (document.getElementById('nav-operator-bots')) document.getElementById('nav-operator-bots').classList.remove('hidden');
        if (document.getElementById('nav-distribution')) document.getElementById('nav-distribution').classList.remove('hidden');

        activeCompanyId = currentUser.companyId;
        activeCompanyName = currentUser.companyName || 'Mi Empresa';
        updateBreadcrumb();

        const validViews = ['view-operator-bots', 'view-distribution'];
        if (savedView && validViews.includes(savedView)) {
            switchView(savedView);
        } else {
            switchView('view-operator-bots');
        }
    } else {
        // COMPANY ADMIN
        document.getElementById('nav-companies').classList.add('hidden');
        document.getElementById('nav-announcements').classList.add('hidden');
        if (document.getElementById('nav-proxies')) document.getElementById('nav-proxies').classList.remove('hidden');
        document.getElementById('nav-admins').classList.add('hidden');
        if (document.getElementById('nav-operator-bots')) document.getElementById('nav-operator-bots').classList.add('hidden');
        document.getElementById('nav-blacklist').classList.remove('hidden');
        document.getElementById('nav-audit').classList.add('hidden'); // Exclusivo SuperAdmin
        document.getElementById('nav-reports').classList.remove('hidden');
        document.getElementById('nav-metrics').classList.remove('hidden');
        document.getElementById('nav-operators').classList.remove('hidden');
        if (document.getElementById('nav-distribution')) document.getElementById('nav-distribution').classList.remove('hidden');
        if (document.getElementById('nav-admin-announcements')) document.getElementById('nav-admin-announcements').classList.remove('hidden');
        if (document.getElementById('btn-open-announcements-inbox')) document.getElementById('btn-open-announcements-inbox').classList.remove('hidden');

        activeCompanyId = currentUser.companyId;
        activeCompanyName = currentUser.companyName || 'Mi Empresa';
        updateBreadcrumb();
        loadAdminAnnouncementsInbox();

        const validViews = ['view-metrics', 'view-proxies', 'view-distribution', 'view-blacklist', 'view-operators', 'view-reports', 'view-admin-announcements'];
        if (savedView && validViews.includes(savedView)) {
            switchView(savedView);
        } else {
            switchView('view-metrics');
        }
    }

    // Real-time automatic polling every 6 seconds to keep metrics, companies directory, and logs fresh
    if (metricsPollInterval) clearInterval(metricsPollInterval);
    metricsPollInterval = setInterval(async () => {
        const activeView = localStorage.getItem('saas_active_view');
        try {
            if (activeView === 'view-proxies' && currentUser && (currentUser.role === 'admin' || (currentUser.role === 'superadmin' && activeCompanyId))) {
                await loadProxiesPoolView();
            } else if (activeView === 'view-companies' && currentUser && currentUser.role === 'superadmin') {
                await loadCompaniesDirectory();
            } else if (activeView === 'view-metrics' && activeCompanyId && currentUser && currentUser.role !== 'user') {
                await loadCompanyMetrics();
            } else if (activeView === 'view-reports' && currentUser && currentUser.role !== 'user') {
                if (currentUser.role === 'superadmin') {
                    await loadSuperAdminTicketsLog();
                }
            } else if (activeView === 'view-operator-bots' && currentUser && currentUser.role === 'user') {
                if (typeof loadOperatorBots === 'function') await loadOperatorBots();
            }
            if (currentUser && currentUser.role === 'admin') {
                await loadAdminAnnouncementsInbox();
            }
        } catch (e) {
            // Ignore background polling errors silently
        }
    }, 6000);
}

function updateBreadcrumb(currentViewId) {
    const rootEl = document.getElementById('breadcrumb-root');
    const compEl = document.getElementById('breadcrumb-company');
    const switchBtn = document.getElementById('btn-switch-company');
    const vId = currentViewId || localStorage.getItem('saas_active_view');

    if (!currentUser) return;

    if (currentUser.role === 'superadmin') {
        if (vId === 'view-proxies') {
            rootEl.textContent = 'Empresa:';
            compEl.textContent = `${activeCompanyName || 'Empresa'} (Pool de Proxies)`;
            switchBtn.classList.remove('hidden');
        } else if (vId === 'view-reports') {
            rootEl.textContent = 'Soporte:';
            compEl.textContent = 'Reportes Globales de Técnicos / Admins';
            switchBtn.classList.remove('hidden');
        } else if (vId === 'view-announcements') {
            rootEl.textContent = 'SuperAdmin:';
            compEl.textContent = 'Anuncios Globales del Sistema';
            switchBtn.classList.remove('hidden');
        } else if (!activeCompanyId) {
            rootEl.textContent = 'Directorio:';
            compEl.textContent = 'Todas las Empresas';
            switchBtn.classList.add('hidden');
        } else {
            rootEl.textContent = 'Empresa Seleccionada:';
            compEl.textContent = activeCompanyName;
            switchBtn.classList.remove('hidden');
        }
    } else if (currentUser.role === 'user') {
        rootEl.textContent = 'Operador:';
        compEl.textContent = currentUser.email;
        switchBtn.classList.add('hidden');
    } else {
        if (vId === 'view-admin-announcements') {
            rootEl.textContent = 'Empresa:';
            compEl.textContent = 'Anuncios del Sistema';
        } else if (vId === 'view-proxies') {
            rootEl.textContent = 'Empresa:';
            compEl.textContent = `${activeCompanyName || 'Mi Empresa'} (Pool de Proxies)`;
        } else {
            rootEl.textContent = 'Empresa:';
            compEl.textContent = activeCompanyName;
        }
        switchBtn.classList.add('hidden');
    }

    const antibanBtn = document.getElementById('btn-company-antiban');
    if (antibanBtn) {
        if (currentUser.role === 'superadmin' && activeCompanyId && !['view-companies', 'view-reports', 'view-announcements', 'view-proxies'].includes(vId)) {
            antibanBtn.classList.remove('hidden');
            antibanBtn.onclick = () => openCompanyAntibanModal(activeCompanyId, activeCompanyName);
        } else {
            antibanBtn.classList.add('hidden');
        }
    }
}

function switchView(viewId) {
    const sidebar = document.getElementById('sidebar');

    // If non-superadmin tries to open audit, restrict and redirect
    if (viewId === 'view-audit' && currentUser && currentUser.role !== 'superadmin') {
        toast('Acceso restringido: Auditoría es exclusivo para SuperAdmin', 'error');
        viewId = currentUser.role === 'admin' ? 'view-metrics' : 'view-operator-bots';
    }

    // Operators cannot access proxies
    if (viewId === 'view-proxies' && currentUser && currentUser.role === 'user') {
        toast('Acceso restringido: Los operadores no configuran proxies', 'error');
        viewId = 'view-operator-bots';
    }

    // If SuperAdmin tries to open an in-company view without an active company, redirect to company directory
    const globalSuperadminViews = ['view-companies', 'view-reports', 'view-announcements'];
    if (currentUser && currentUser.role === 'superadmin' && !activeCompanyId && !globalSuperadminViews.includes(viewId)) {
        toast('Seleccioná una empresa del directorio primero', 'error');
        viewId = 'view-companies';
    }

    // Persist active view in localStorage
    localStorage.setItem('saas_active_view', viewId);
    if (activeCompanyId) {
        localStorage.setItem('saas_active_company_id', activeCompanyId);
        localStorage.setItem('saas_active_company_name', activeCompanyName);
        localStorage.setItem('saas_active_company_status', activeCompanyStatus);
    } else {
        localStorage.removeItem('saas_active_company_id');
        localStorage.removeItem('saas_active_company_name');
        localStorage.removeItem('saas_active_company_status');
    }

    // CONDITIONAL SIDEBAR:
    if (currentUser && currentUser.role === 'superadmin') {
        if (viewId === 'view-companies' || (viewId === 'view-reports' && !activeCompanyId)) {
            sidebar.classList.add('hidden');
            document.querySelector('.content-wrapper').style.marginLeft = '0';
        } else {
            sidebar.classList.remove('hidden');
            document.querySelector('.content-wrapper').style.marginLeft = 'var(--sidebar-collapsed)';
        }
    } else {
        sidebar.classList.remove('hidden');
        document.querySelector('.content-wrapper').style.marginLeft = 'var(--sidebar-collapsed)';
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });

    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.toggle('hidden', view.id !== viewId);
    });

    if (viewId === 'view-companies') {
        activeCompanyId = null;
        updateBreadcrumb();
        loadCompaniesDirectory();
    } else if (viewId === 'view-announcements') {
        updateBreadcrumb();
        loadAnnouncementsList();
    } else if (viewId === 'view-proxies') {
        updateBreadcrumb();
        loadProxiesPoolView();
    } else if (viewId === 'view-admin-announcements') {
        updateBreadcrumb();
        loadAdminAnnouncementsView();
    } else if (viewId === 'view-operator-bots') {
        updateBreadcrumb();
        if (typeof loadOperatorBots === 'function') loadOperatorBots();
    } else if (viewId === 'view-distribution') {
        updateBreadcrumb();
        if (typeof initDistributionView === 'function') initDistributionView();
    } else {
        updateBreadcrumb();
        if (viewId === 'view-metrics') {
            loadCompanyMetrics();
            loadOperatorsComparison();
            loadExecutiveReport();
        }
        if (viewId === 'view-blacklist') loadBlacklist();
        if (viewId === 'view-audit' && currentUser && currentUser.role === 'superadmin') loadAuditLogs();
        if (viewId === 'view-admins') loadUsersSection('admin');
        if (viewId === 'view-operators') loadUsersSection('user');
        if (viewId === 'view-reports') loadReportsSection();
    }
    if (window.lucide) lucide.createIcons();
}
window.switchView = switchView;

// ================= SUPERADMIN: DIRECTORIO DE EMPRESAS =================
async function loadCompaniesDirectory() {
    const grid = document.getElementById('companies-grid');
    try {
        if (grid && grid.children.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Cargando empresas...</div>';
        }
        companies = await api('/companies');
        if (grid) grid.innerHTML = '';

        if (!companies || companies.length === 0) {
            if (grid) grid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">No hay empresas registradas aún. Haz clic en "+ Nueva Empresa" para crear una.</div>';
            return;
        }

        companies.forEach(c => {
            const isSuspended = c.status === 'suspended';
            const card = document.createElement('div');
            card.className = 'company-card';
            const statusIcon = isSuspended ? getLucideSvg('pause-circle', 13) : getLucideSvg('check-circle-2', 13);
            const statusText = isSuspended ? 'Suspendida' : 'Activa';

            card.innerHTML = `
                <div>
                    <div class="company-card-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--accent-pink); display: flex; align-items: center;">${getLucideSvg('building-2', 20)}</span>
                            <h4 style="font-size: 17px; font-weight: 700;">${c.name}</h4>
                        </div>
                        <span class="status-badge ${isSuspended ? 'disconnected' : 'connected'}">
                            ${statusIcon} ${statusText}
                        </span>
                    </div>

                    <div class="company-meta-pills">
                        <div class="company-meta-row">
                            <span style="display: flex; align-items: center; gap: 6px;">${getLucideSvg('users', 14)} Operadores:</span>
                            <strong>${c.user_count} / ${c.user_limit}</strong>
                        </div>
                        <div class="company-meta-row">
                            <span style="display: flex; align-items: center; gap: 6px;">${getLucideSvg('bot', 14)} WhatsApps Habilitados:</span>
                            <strong>${c.profile_count} / ${c.whatsapp_limit || 10}</strong>
                        </div>
                        <div class="company-meta-row">
                            <span style="display: flex; align-items: center; gap: 6px;">${getLucideSvg('bar-chart-2', 14)} Total Mensajes:</span>
                            <strong>${c.total_sent}</strong>
                        </div>
                    </div>
                </div>

                <div class="company-card-actions">
                    <button class="btn-primary" style="width: 100%; justify-content: center; padding: 10px 16px; font-size: 13px;" onclick="enterCompanyManagement('${c.id}', '${c.name.replace(/'/g, "\\'")}', '${c.status}')">
                        ${getLucideSvg('arrow-right', 14)} Entrar a Gestionar
                    </button>
                    <div style="display: flex; gap: 8px;">
                        <button title="Ver y Gestionar Operadores de la Empresa" class="btn-secondary" style="flex: 1; justify-content: center; padding: 7px 10px; font-size: 12px;" onclick="enterCompanyOperators('${c.id}', '${c.name.replace(/'/g, "\\'")}', '${c.status}')">
                            ${getLucideSvg('users', 13)} Operadores
                        </button>
                        <button title="Pool de Proxies Exclusivo de la Empresa" class="btn-secondary" style="flex: 1; justify-content: center; padding: 7px 10px; font-size: 12px; color: var(--accent-pink); border-color: rgba(224, 77, 128, 0.35);" onclick="enterCompanyProxies('${c.id}', '${c.name.replace(/'/g, "\\'")}', '${c.status}')">
                            ${getLucideSvg('server', 13)} Proxies
                        </button>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button title="Configuración de Límites" class="btn-secondary" style="flex: 1; justify-content: center; padding: 7px 10px; font-size: 12px;" onclick="openCompanyLimitsModal('${c.id}', '${c.name.replace(/'/g, "\\'")}', ${c.user_limit || 5}, ${c.whatsapp_limit || 10})">
                            ${getLucideSvg('sliders', 13)} Límites
                        </button>
                        <button title="Configuración de Cooldown y Anti-Ban" class="btn-secondary" style="flex: 1; justify-content: center; padding: 7px 10px; font-size: 12px;" onclick="openCompanyAntibanModal('${c.id}', '${c.name.replace(/'/g, "\\'")}')">
                            ${getLucideSvg('shield-alert', 13)} Anti-Ban
                        </button>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="${isSuspended ? 'btn-success' : 'btn-danger'}" style="flex: 1; justify-content: center; padding: 7px 10px; font-size: 12px;" onclick="toggleCompanyStatus('${c.id}', '${c.status}')">
                            ${isSuspended ? getLucideSvg('play', 13) + ' Activar' : getLucideSvg('pause', 13) + ' Suspender'}
                        </button>
                    </div>
                    <button class="btn-secondary" style="padding: 6px 10px; font-size: 11px; opacity: 0.75; justify-content: center;" onclick="resetCompanyDefaults('${c.id}', '${c.name.replace(/'/g, "\\'")}')">
                        ${getLucideSvg('rotate-ccw', 12)} Base Defaults
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });
        if (typeof refreshIcons === 'function') refreshIcons();
    } catch (err) {
        console.error('Error loading companies:', err);
        if (grid) grid.innerHTML = `<div style="color:var(--accent-red); padding:20px;">Error al cargar empresas: ${err.message}</div>`;
        toast(`Error al cargar empresas: ${err.message}`, 'error');
    }
}

function openCompanyLimitsModal(companyId, companyName, currentLimit, currentWhatsappLimit) {
    document.getElementById('limits-company-id').value = companyId;
    document.getElementById('limits-company-name').textContent = `Empresa: ${companyName}`;
    document.getElementById('limits-user-limit').value = currentLimit;
    const waInput = document.getElementById('limits-whatsapp-limit');
    if (waInput) waInput.value = currentWhatsappLimit !== undefined ? currentWhatsappLimit : 10;
    showModal('modal-company-limits');
}

async function handleSaveCompanyLimits() {
    const id = document.getElementById('limits-company-id').value;
    const userLimit = document.getElementById('limits-user-limit').value;
    const waInput = document.getElementById('limits-whatsapp-limit');
    const whatsappLimit = waInput ? waInput.value : null;

    if (!userLimit || !whatsappLimit) {
        return toast('Completá ambos límites', 'error');
    }

    try {
        const body = { 
            userLimit: parseInt(userLimit, 10),
            whatsappLimit: parseInt(whatsappLimit, 10)
        };
        await api(`/companies/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
        hideModal('modal-company-limits');
        toast('Límites actualizados exitosamente');
        await loadCompaniesDirectory();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleDeleteCompanyFromLimits() {
    const id = document.getElementById('limits-company-id').value;
    const name = document.getElementById('limits-company-name').textContent.replace('Empresa: ', '');
    if (!id) return;

    const confirm1 = await showConfirm({
        title: 'Eliminar Empresa',
        message: `¿Estás COMPLETAMENTE SEGURO de eliminar la empresa "${name}"?\n\nEsta acción ejecutará una eliminación en cascada de TODOS sus datos (administradores, operadores, cuentas de WhatsApp, métricas y reportes).`,
        confirmText: 'Continuar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!confirm1) return;

    const confirm2 = await showConfirm({
        title: 'Confirmación Final',
        message: `Confirmación definitiva: Se borrará TODO de "${name}". ¿Proceder con el borrado en cascada?`,
        confirmText: 'Borrar Definitivamente',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!confirm2) return;

    try {
        const res = await api(`/companies/${id}`, { method: 'DELETE' });
        hideModal('modal-company-limits');
        toast(res.message || `Empresa ${name} eliminada exitosamente`);
        await loadCompaniesDirectory();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function resetCompanyDefaults(companyId, companyName) {
    const ok = await showConfirm({
        title: 'Restablecer Empresa',
        message: `¿Restablecer la empresa "${companyName}" y todas sus cuentas a las configuraciones y límites de base?`,
        confirmText: 'Restablecer',
        cancelText: 'Cancelar',
        type: 'warning'
    });
    if (!ok) return;

    try {
        await api(`/companies/${companyId}/reset-defaults`, { method: 'POST' });
        toast(`Empresa ${companyName} restablecida a configuraciones de base`);
        await loadCompaniesDirectory();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function enterCompanyManagement(companyId, companyName, status) {
    activeCompanyId = companyId;
    activeCompanyName = companyName;
    activeCompanyStatus = status;
    updateBreadcrumb();
    switchView('view-metrics');
    toast(`Gestionando empresa: ${companyName}`);
}

function enterCompanyOperators(companyId, companyName, status) {
    activeCompanyId = companyId;
    activeCompanyName = companyName;
    activeCompanyStatus = status;
    updateBreadcrumb();
    switchView('view-operators');
    toast(`Gestionando operadores de: ${companyName}`);
}
window.enterCompanyOperators = enterCompanyOperators;

function enterCompanyProxies(companyId, companyName, status) {
    activeCompanyId = companyId;
    activeCompanyName = companyName;
    activeCompanyStatus = status;
    updateBreadcrumb();
    switchView('view-proxies');
    toast(`Gestionando pool de proxies de: ${companyName}`);
}
window.enterCompanyProxies = enterCompanyProxies;

function returnFromProxiesView() {
    if (currentUser && currentUser.role === 'superadmin') {
        switchView('view-companies');
    } else {
        switchView('view-metrics');
    }
}
window.returnFromProxiesView = returnFromProxiesView;

async function openCompanyAntibanModal(companyId, companyName) {
    const cid = companyId || activeCompanyId;
    const cname = companyName || activeCompanyName || 'Empresa';
    if (!cid) return toast('Selecciona una empresa primero', 'warning');

    document.getElementById('antiban-company-id').value = cid;
    document.getElementById('antiban-company-name').textContent = `Empresa: ${cname}`;
    const errEl = document.getElementById('antiban-modal-error');
    if (errEl) errEl.classList.add('hidden');

    try {
        const data = await api(`/companies/${cid}/antiban`);
        document.getElementById('antiban-delay-min').value = data.delay_min !== undefined ? data.delay_min : 115;
        document.getElementById('antiban-delay-max').value = data.delay_max !== undefined ? data.delay_max : 145;
        document.getElementById('antiban-batch-size').value = data.batch_size !== undefined ? data.batch_size : 15;
        document.getElementById('antiban-pause-min').value = data.batch_pause_min !== undefined ? data.batch_pause_min : 25;
        document.getElementById('antiban-pause-max').value = data.batch_pause_max !== undefined ? data.batch_pause_max : 30;
        document.getElementById('antiban-daily-limit').value = data.daily_limit !== undefined ? data.daily_limit : 200;
        document.getElementById('antiban-apply-existing').checked = false;
        showModal('modal-company-antiban');
    } catch (err) {
        toast(`Error al cargar configuración anti-ban: ${err.message}`, 'error');
    }
}
window.openCompanyAntibanModal = openCompanyAntibanModal;

async function handleSaveCompanyAntiban() {
    const id = document.getElementById('antiban-company-id').value;
    const delay_min = document.getElementById('antiban-delay-min').value;
    const delay_max = document.getElementById('antiban-delay-max').value;
    const batch_size = document.getElementById('antiban-batch-size').value;
    const batch_pause_min = document.getElementById('antiban-pause-min').value;
    const batch_pause_max = document.getElementById('antiban-pause-max').value;
    const daily_limit = document.getElementById('antiban-daily-limit').value;
    const applyToProfiles = document.getElementById('antiban-apply-existing').checked;
    const errEl = document.getElementById('antiban-modal-error');

    if (!delay_min || !delay_max || !batch_size || !batch_pause_min || !batch_pause_max || !daily_limit) {
        if (errEl) {
            errEl.textContent = 'Por favor completa todos los campos de configuración';
            errEl.classList.remove('hidden');
        }
        return;
    }

    const dMin = parseInt(delay_min, 10);
    const dMax = parseInt(delay_max, 10);
    if (dMin > dMax) {
        if (errEl) {
            errEl.textContent = 'La demora mínima no puede ser mayor que la demora máxima';
            errEl.classList.remove('hidden');
        }
        return;
    }

    const bpMin = parseInt(batch_pause_min, 10);
    const bpMax = parseInt(batch_pause_max, 10);
    if (bpMin > bpMax) {
        if (errEl) {
            errEl.textContent = 'La pausa mínima no puede ser mayor que la pausa máxima';
            errEl.classList.remove('hidden');
        }
        return;
    }

    try {
        const res = await api(`/companies/${id}/antiban`, {
            method: 'PUT',
            body: JSON.stringify({
                delay_min: dMin,
                delay_max: dMax,
                batch_size: parseInt(batch_size, 10),
                batch_pause_min: bpMin,
                batch_pause_max: bpMax,
                daily_limit: parseInt(daily_limit, 10),
                applyToProfiles
            })
        });
        hideModal('modal-company-antiban');
        toast(res.message || 'Configuración anti-ban guardada correctamente', 'success');
    } catch (err) {
        if (errEl) {
            errEl.textContent = err.message;
            errEl.classList.remove('hidden');
        } else {
            toast(err.message, 'error');
        }
    }
}
window.handleSaveCompanyAntiban = handleSaveCompanyAntiban;

async function handleCreateCompany() {
    const name = document.getElementById('new-comp-name').value.trim();
    const adminEmail = document.getElementById('new-comp-email').value.trim();
    const adminPassword = document.getElementById('new-comp-pass').value;
    const userLimit = document.getElementById('new-comp-limit').value;
    const waInput = document.getElementById('new-comp-whatsapp-limit');
    const whatsappLimit = waInput ? waInput.value : 10;
    const errorEl = document.getElementById('modal-comp-error');

    if (!name || !adminEmail || !adminPassword) return toast('Completá todos los campos obligatorios', 'error');

    // Strict email check
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(adminEmail)) {
        errorEl.textContent = 'El correo electrónico debe tener un formato válido (ej: admin@empresa.com)';
        errorEl.classList.remove('hidden');
        return;
    }

    errorEl.classList.add('hidden');

    try {
        await api('/companies', {
            method: 'POST',
            body: JSON.stringify({ 
                name, 
                adminEmail, 
                adminPassword, 
                userLimit: parseInt(userLimit, 10) || 5, 
                whatsappLimit: parseInt(whatsappLimit, 10) || 10 
            })
        });
        hideModal('modal-company');
        document.getElementById('new-comp-name').value = '';
        document.getElementById('new-comp-email').value = '';
        document.getElementById('new-comp-pass').value = '';
        toast('Empresa creada exitosamente');
        await loadCompaniesDirectory();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
}

async function toggleCompanyStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const action = newStatus === 'suspended' ? 'SUSPENDER (Kill Switch)' : 'REACTIVAR';
    const ok = await showConfirm({
        title: `${action === 'suspender' ? 'Suspender' : 'Activar'} Empresa`,
        message: `¿Estás seguro de que deseas ${action} esta empresa?`,
        confirmText: action === 'suspender' ? 'Suspender' : 'Activar',
        cancelText: 'Cancelar',
        type: action === 'suspender' ? 'danger' : 'primary'
    });
    if (!ok) return;

    try {
        await api(`/companies/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        toast(`Empresa ${newStatus === 'active' ? 'reactivada' : 'suspendida'}`);
        if (activeCompanyId === id) activeCompanyStatus = newStatus;
        if (!activeCompanyId) await loadCompaniesDirectory();
        else await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= COMPANY METRICS =================
async function loadCompanyMetrics() {
    if (!activeCompanyId) return;
    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        const data = await api(`/stats/company${queryParam}`);

        document.getElementById('m-sent-today').textContent = data.totalSentToday;
        document.getElementById('m-total-sent').textContent = data.totalAllTimeSent;
        document.getElementById('m-pending').textContent = data.totalPending;
        
        const connEl = document.getElementById('m-profiles-connected');
        const totalEl = document.getElementById('m-profiles-total');
        if (connEl) connEl.textContent = data.connectedProfiles || 0;
        if (totalEl) totalEl.textContent = data.totalProfiles || 0;

        const badge = document.getElementById('tenant-status-badge');
        if (badge) {
            badge.className = `badge ${activeCompanyStatus === 'suspended' ? 'suspended' : 'active'}`;
            badge.textContent = activeCompanyStatus === 'suspended' ? 'Suspendida (Kill Switch)' : 'Activa';
        }

        const overviewEl = document.getElementById('tenant-overview-text');
        if (overviewEl) {
            overviewEl.textContent = 
                `Empresa: ${activeCompanyName}. Todos los apartados en la barra lateral muestran exclusivamente los datos y operaciones de este tenant.`;
        }
    } catch (err) {
        console.error('Error loading metrics:', err);
    }
}

// ================= USERS & OPERATORS (SEPARATED) =================
async function loadUsersSection(targetRole) {
    if (!activeCompanyId) return;
    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        companyUsers = await api(`/users${queryParam}`);

        if (targetRole === 'admin') {
            const admins = companyUsers.filter(u => u.role === 'admin');
            const tbody = document.getElementById('admins-table-body');
            tbody.innerHTML = '';
            admins.forEach(a => {
                const tr = document.createElement('tr');
                const adminLimit = a.whatsapp_limit !== null && a.whatsapp_limit !== undefined ? a.whatsapp_limit : (a.company_max_profiles || 2);
                const assignedCount = parseInt(a.assigned_profiles, 10) || 0;
                const aCompMax = a.company_whatsapp_limit || 10;
                const otherQuotas = companyUsers.filter(x => x.id !== a.id).reduce((s, x) => s + (parseInt(x.whatsapp_limit, 10) || 0), 0);
                const maxAvailable = Math.max(0, aCompMax - otherQuotas);
                const quotaWidget = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge" style="background: rgba(224, 77, 128, 0.15); color: var(--accent-pink); border: 1px solid rgba(224, 77, 128, 0.3); font-weight: 700; font-size: 11.5px; padding: 4px 8px;">
                            ${adminLimit} WhatsApps
                        </span>
                        <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px; border-color: rgba(224, 77, 128, 0.4); color: var(--accent-pink); display: inline-flex; align-items: center; gap: 4px;" title="Asignar cupo de cuentas a este administrador" onclick="openOperatorQuotaModal('${a.id}', '${a.email.replace(/'/g, "\\'")}', ${adminLimit}, ${assignedCount}, ${aCompMax}, ${otherQuotas}, ${maxAvailable})">
                            ${getLucideSvg('sliders', 12)} Asignar Cupo
                        </button>
                    </div>
                `;
                tr.innerHTML = `
                    <td><strong>${a.email}</strong></td>
                    <td><span class="badge connected">Administrador</span></td>
                    <td><span class="badge ${a.status === 'active' ? 'active' : 'disabled'}">${a.status}</span></td>
                    <td>${quotaWidget}</td>
                    <td>
                        <button class="btn-primary" style="padding: 4px 10px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 4px;" title="Cuentas: ${assignedCount} de ${adminLimit}" onclick="openNestedOperatorProfiles('${a.id}', '${a.email.replace(/'/g, "\\'")}', '${a.role}')">
                            ${getLucideSvg('smartphone', 12)} Ver cuentas (${assignedCount} / ${adminLimit})
                        </button>
                    </td>
                    <td>${new Date(a.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="openEditUserModal('${a.id}', '${a.email.replace(/'/g, "\\'")}', '${a.role}')">Editar Credenciales</button>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Reiniciar configuraciones de base de este usuario" onclick="resetUserDefaults('${a.id}', '${a.email.replace(/'/g, "\\'")}')">${getLucideSvg('rotate-ccw', 12)} Reset Base</button>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="toggleUserStatus('${a.id}', '${a.status}')">${a.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                        <button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteUser('${a.id}')">Eliminar</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        if (targetRole === 'user') {
            const admins = companyUsers.filter(u => u.role === 'admin');
            const operators = companyUsers.filter(u => u.role === 'user');
            const tbody = document.getElementById('operators-table-body');
            tbody.innerHTML = '';

            let companyMaxWA = 10;
            if (currentUser && currentUser.role === 'superadmin') {
                const comp = Array.isArray(companies) ? companies.find(c => c.id === activeCompanyId) : null;
                if (comp) companyMaxWA = comp.whatsapp_limit || 10;
            } else if (currentUser) {
                companyMaxWA = currentUser.companyWhatsappLimit || 10;
            }

            const totalAllocatedWA = companyUsers.reduce((sum, user) => sum + (parseInt(user.whatsapp_limit, 10) || 0), 0);
            const freeQuotaWA = Math.max(0, companyMaxWA - totalAllocatedWA);

            let quotaText = `Operadores: ${operators.length}`;
            if (currentUser.role === 'superadmin') {
                const comp = companies.find(c => c.id === activeCompanyId);
                if (comp && comp.user_limit) {
                    quotaText = `Operadores: ${operators.length} / ${comp.user_limit} máx`;
                }
            } else if (currentUser.userLimit) {
                quotaText = `Operadores: ${operators.length} / ${currentUser.userLimit} máx`;
            }
            if (admins.length > 0) {
                quotaText += ` • Admins: ${admins.length}`;
            }
            quotaText += ` • <span style="color: var(--accent-pink); font-weight: 600;">Cupos WhatsApp: ${totalAllocatedWA} / ${companyMaxWA} asignados (${freeQuotaWA} disponibles)</span>`;
            document.getElementById('operators-quota-text').innerHTML = quotaText;

            // List admins first, then operators
            const displayUsers = [...admins, ...operators];

            if (displayUsers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding: 18px;">No hay usuarios ni operadores registrados en la empresa.</td></tr>';
                return;
            }

            displayUsers.forEach(u => {
                const isAdmin = u.role === 'admin';
                const isSelf = currentUser && currentUser.id === u.id;
                const tr = document.createElement('tr');

                const roleBadge = isAdmin 
                    ? `<span class="badge connected" style="display:inline-flex; align-items:center; gap:4px; font-weight:600;">${getLucideSvg('shield-check', 12)} Administrador</span>`
                    : `<span class="badge" style="background:rgba(255,255,255,0.08); color:var(--text-secondary); display:inline-flex; align-items:center; gap:4px;">${getLucideSvg('user', 12)} Operador</span>`;

                const assignedCount = parseInt(u.assigned_profiles, 10) || 0;
                const opLimit = u.whatsapp_limit !== null && u.whatsapp_limit !== undefined ? u.whatsapp_limit : 0;
                const uCompMax = u.company_whatsapp_limit || companyMaxWA;
                const otherQuotas = companyUsers.filter(x => x.id !== u.id).reduce((s, x) => s + (parseInt(x.whatsapp_limit, 10) || 0), 0);
                const maxAvailable = Math.max(0, uCompMax - otherQuotas);

                const quotaWidget = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge" style="background: rgba(224, 77, 128, 0.15); color: var(--accent-pink); border: 1px solid rgba(224, 77, 128, 0.3); font-weight: 700; font-size: 11.5px; padding: 4px 8px;">
                            ${opLimit} WhatsApps
                        </span>
                        <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px; border-color: rgba(224, 77, 128, 0.4); color: var(--accent-pink); display: inline-flex; align-items: center; gap: 4px;" title="Asignar cupo de cuentas a este operador" onclick="openOperatorQuotaModal('${u.id}', '${u.email.replace(/'/g, "\\'")}', ${opLimit}, ${assignedCount}, ${uCompMax}, ${otherQuotas}, ${maxAvailable})">
                            ${getLucideSvg('sliders', 12)} Asignar Cupo
                        </button>
                    </div>
                `;

                const waButton = `
                    <button class="btn-primary" style="padding: 4px 10px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px;" title="Cupo: ${assignedCount} de ${opLimit} cuentas" onclick="openNestedOperatorProfiles('${u.id}', '${u.email.replace(/'/g, "\\'")}', '${u.role}')">
                        ${getLucideSvg('smartphone', 13)} Ver cuentas (${assignedCount} / ${opLimit})
                    </button>
                `;

                let actionButtons = `
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="openEditUserModal('${u.id}', '${u.email.replace(/'/g, "\\'")}', '${u.role}')">Editar Credenciales</button>
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Reiniciar configuraciones de base de este usuario" onclick="resetUserDefaults('${u.id}', '${u.email.replace(/'/g, "\\'")}')">${getLucideSvg('rotate-ccw', 12)} Reset Base</button>
                `;

                if (isSelf && currentUser.role === 'admin') {
                    // Admin cannot deactivate or delete their own active session
                    actionButtons += `
                        <button class="btn-secondary" disabled style="opacity:0.4; padding: 4px 8px; font-size: 11px; margin-right: 4px;" title="Tu sesión activa">(Tú)</button>
                    `;
                } else if (isAdmin && currentUser.role === 'admin') {
                    // Another admin inside the company: company admin cannot delete other admins
                } else {
                    actionButtons += `
                        <button class="${u.status === 'active' ? 'btn-danger' : 'btn-success'}" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="toggleUserStatus('${u.id}', '${u.status}')">${u.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                        <button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteUser('${u.id}')">Eliminar</button>
                    `;
                }

                tr.innerHTML = `
                    <td>
                        <strong>${u.email}</strong>
                        ${isSelf ? '<span style="font-size: 11px; color: var(--accent-pink); font-weight: 500; margin-left: 4px;">(Tú)</span>' : ''}
                    </td>
                    <td>${roleBadge}</td>
                    <td><span class="badge ${u.status === 'active' ? 'active' : 'disabled'}">${u.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
                    <td>${quotaWidget}</td>
                    <td>${waButton}</td>
                    <td>${actionButtons}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

// Reset individual user configurations to default
async function resetUserDefaults(userId, userEmail) {
    const ok = await showConfirm({
        title: 'Restablecer Valores',
        message: `¿Restablecer las cuentas y configuraciones del usuario ${userEmail} a los valores de base?`,
        confirmText: 'Restablecer',
        cancelText: 'Cancelar',
        type: 'warning'
    });
    if (!ok) return;
    try {
        await api(`/users/${userId}/reset-defaults`, { method: 'POST' });
        toast(`Configuraciones de base restablecidas para ${userEmail}`);
        await loadUsersSection('admin');
        await loadUsersSection('user');
        if (activeNestedOperatorId === userId) {
            await loadNestedOperatorProfiles();
        }
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= ANIDADO: GESTIÓN DE CUENTAS WA POR OPERADOR O ADMIN =================
let activeNestedOperatorId = null;
let activeNestedOperatorEmail = '';
let activeNestedOperatorRole = 'user';

async function openNestedOperatorProfiles(operatorId, operatorEmail, operatorRole = 'user') {
    activeNestedOperatorId = operatorId;
    activeNestedOperatorEmail = operatorEmail;
    activeNestedOperatorRole = operatorRole;

    const currentView = localStorage.getItem('saas_active_view');
    if (currentView !== 'view-operators') {
        switchView('view-operators');
    }

    const panel = document.getElementById('nested-operator-profiles-panel');
    const roleLabel = operatorRole === 'admin' ? 'Administrador' : 'Operador';
    document.getElementById('nested-operator-title').textContent = `Cuentas de WhatsApp de: ${operatorEmail} (${roleLabel})`;
    
    const addBtn = document.getElementById('btn-add-nested-profile');
    if (addBtn) {
        addBtn.innerHTML = `${getLucideSvg('plus-circle', 14)} Agregar Cuenta a este ${roleLabel}`;
    }

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    await loadNestedOperatorProfiles();
}

function closeNestedOperatorProfiles() {
    activeNestedOperatorId = null;
    activeNestedOperatorEmail = '';
    activeNestedOperatorRole = 'user';
    document.getElementById('nested-operator-profiles-panel').classList.add('hidden');
}

async function loadNestedOperatorProfiles() {
    if (!activeNestedOperatorId) return;

    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        const allProfiles = await api(`/profiles${queryParam}`);
        const operatorProfiles = allProfiles.filter(p => p.assigned_user_id === activeNestedOperatorId);

        // Get individual limit for this operator or admin
        const targetOp = Array.isArray(companyUsers) ? companyUsers.find(u => u.id === activeNestedOperatorId) : null;
        let maxAllowed = 2;
        if (targetOp && targetOp.whatsapp_limit !== null && targetOp.whatsapp_limit !== undefined) {
            maxAllowed = targetOp.whatsapp_limit;
        } else if (currentUser && currentUser.role === 'superadmin') {
            const comp = companies.find(c => c.id === activeCompanyId);
            if (comp) maxAllowed = comp.max_profiles_per_operator || 2;
        } else if (currentUser && currentUser.maxProfilesPerOperator) {
            maxAllowed = currentUser.maxProfilesPerOperator;
        }

        const roleLabel = activeNestedOperatorRole === 'admin' ? 'administrador' : 'operador';
        document.getElementById('nested-operator-quota').textContent = 
            `Cuentas activas: ${operatorProfiles.length} / ${maxAllowed} máx permitidas para este ${roleLabel}.`;

        const tbody = document.getElementById('nested-profiles-table-body');
        tbody.innerHTML = '';

        if (operatorProfiles.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding: 18px;">Este ${roleLabel} no tiene cuentas de WhatsApp asignadas aún. Hacé clic en "+ Agregar Cuenta a este ${activeNestedOperatorRole === 'admin' ? 'Administrador' : 'Operador'}" para crear una.</td></tr>`;
            return;
        }

        operatorProfiles.forEach(p => {
            const isConnected = p.status === 'connected';
            const isEarlyWarning = p.is_paused_early_warning;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong>${p.name}</strong>
                        ${isEarlyWarning ? '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; font-size: 10px; border: 1px solid rgba(239, 68, 68, 0.4);">Pausado (>15% fallos)</span>' : ''}
                    </div>
                </td>
                <td><span class="badge ${isConnected ? 'active' : 'disabled'}">${isConnected ? 'Conectado' : 'Desconectado'}</span></td>
                <td>${p.sent_today || 0}</td>
                <td>${p.daily_limit || 200}</td>
                <td>
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 4px; ${!isConnected ? 'opacity: 0.55; cursor: not-allowed;' : ''}" title="${isConnected ? 'Cargar números a este bot' : 'Primero debe conectarse para poder cargarle números'}" onclick="${isConnected ? `openBotQueueModal('${p.id}', '${p.name.replace(/'/g, "\\'")}')` : `toast('No se pueden cargar números a una cuenta desconectada. Primero debe vincularse por QR.', 'warning')`}">
                        ${getLucideSvg('upload', 12)} Cargar Números
                    </button>
                    ${currentUser && currentUser.role === 'superadmin' ? `
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 4px;" onclick="openProfileConfigModal('${p.id}')">
                        ${getLucideSvg('sliders', 12)} Ajustes
                    </button>` : ''}
                    <button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteProfile('${p.id}')">Eliminar Cuenta</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading operator profiles:', err);
    }
}

function openAddNestedProfileModal() {
    if (!activeNestedOperatorId) return toast('Seleccioná un operador o administrador primero', 'error');

    // Check if operator already reached individual quota
    const targetOp = Array.isArray(companyUsers) ? companyUsers.find(u => u.id === activeNestedOperatorId) : null;
    let maxAllowed = 2;
    if (targetOp && targetOp.whatsapp_limit !== null && targetOp.whatsapp_limit !== undefined) {
        maxAllowed = targetOp.whatsapp_limit;
    } else if (currentUser && currentUser.maxProfilesPerOperator) {
        maxAllowed = currentUser.maxProfilesPerOperator;
    }

    const currentCount = targetOp ? (targetOp.assigned_profiles || 0) : 0;
    if (currentCount >= maxAllowed && (!currentUser || currentUser.role !== 'superadmin')) {
        return toast(`Este operador ya alcanzó su límite máximo de cuentas (${currentCount} / ${maxAllowed}). Puedes ampliar su cupo editando al usuario.`, 'warning');
    }

    const roleLabel = activeNestedOperatorRole === 'admin' ? 'administrador' : 'operador';
    document.getElementById('nested-profile-operator-label').textContent = `Creando cuenta para el ${roleLabel}: ${activeNestedOperatorEmail}`;
    document.getElementById('new-nested-profile-name').value = '';
    document.getElementById('new-nested-profile-message').value = '';
    const newCatEl = document.getElementById('new-nested-profile-category');
    if (newCatEl) newCatEl.value = 'Movistar';
    showModal('modal-nested-profile');
}

async function handleCreateNestedProfile() {
    const name = document.getElementById('new-nested-profile-name').value.trim();
    const message = document.getElementById('new-nested-profile-message').value.trim();
    const categoryEl = document.getElementById('new-nested-profile-category');
    const category = categoryEl ? categoryEl.value : 'Movistar';

    if (!name) return toast('Ingresá un nombre descriptivo para la cuenta', 'error');

    try {
        const body = {
            name,
            message,
            category,
            assigned_user_id: activeNestedOperatorId
        };
        if (currentUser.role === 'superadmin' && activeCompanyId) {
            body.companyId = activeCompanyId;
        }

        await api('/profiles', {
            method: 'POST',
            body: JSON.stringify(body)
        });

        hideModal('modal-nested-profile');
        toast('Cuenta de WhatsApp creada exitosamente');
        await loadNestedOperatorProfiles();
        await loadUsersSection('user');
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= MODAL DE USUARIO Y VALIDACIÓN DE CORREO =================
function openCreateUserModal(defaultRole = 'user') {
    editingUserId = null;
    const titleEl = document.getElementById('modal-user-title');
    if (titleEl) titleEl.textContent = defaultRole === 'admin' ? 'Nuevo Administrador' : 'Nuevo Operador';

    const idInput = document.getElementById('edit-user-id');
    if (idInput) idInput.value = '';

    const emailInput = document.getElementById('new-user-email');
    if (emailInput) emailInput.value = '';

    const passInput = document.getElementById('new-user-pass');
    if (passInput) passInput.value = '';

    const roleSelect = document.getElementById('new-user-role');
    if (roleSelect) roleSelect.value = defaultRole;

    // If company admin is logged in, restrict role selection strictly to 'user'
    const roleGroup = document.getElementById('user-role-group');
    if (roleGroup) {
        if (!currentUser || currentUser.role !== 'superadmin') {
            roleGroup.style.display = 'none';
            if (roleSelect) roleSelect.value = 'user';
        } else {
            roleGroup.style.display = 'block';
        }
    }

    const hint = document.getElementById('pass-hint');
    if (hint) hint.textContent = '(obligatorio)';

    const errorEl = document.getElementById('modal-user-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    const saveBtn = document.getElementById('modal-user-save');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = defaultRole === 'admin' ? 'Crear Administrador' : 'Crear Operador';
    }

    showModal('modal-user');
    setTimeout(() => {
        if (emailInput) emailInput.focus();
    }, 60);
}

function openEditUserModal(userId, fallbackEmail, fallbackRole) {
    editingUserId = userId;
    const user = Array.isArray(companyUsers) ? companyUsers.find(u => u.id === userId) : null;
    const currentEmail = user ? user.email : (fallbackEmail || '');
    const currentRole = user ? user.role : (fallbackRole || 'user');

    const titleEl = document.getElementById('modal-user-title');
    if (titleEl) titleEl.textContent = currentRole === 'admin' ? 'Editar Credenciales (Administrador)' : 'Editar Credenciales (Operador)';

    const idInput = document.getElementById('edit-user-id');
    if (idInput) idInput.value = userId;

    const emailInput = document.getElementById('new-user-email');
    if (emailInput) emailInput.value = currentEmail;

    const passInput = document.getElementById('new-user-pass');
    if (passInput) passInput.value = '';

    const roleSelect = document.getElementById('new-user-role');
    if (roleSelect) roleSelect.value = currentRole;

    const roleGroup = document.getElementById('user-role-group');
    if (roleGroup) {
        if (!currentUser || currentUser.role !== 'superadmin') {
            roleGroup.style.display = 'none';
        } else {
            roleGroup.style.display = 'block';
        }
    }

    const hint = document.getElementById('pass-hint');
    if (hint) hint.textContent = '(dejar en blanco para conservar la actual)';

    const errorEl = document.getElementById('modal-user-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    const saveBtn = document.getElementById('modal-user-save');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar';
    }

    showModal('modal-user');
    setTimeout(() => {
        if (passInput) passInput.focus();
    }, 60);
}

async function handleSaveUser() {
    const emailInput = document.getElementById('new-user-email');
    const passInput = document.getElementById('new-user-pass');
    const roleSelect = document.getElementById('new-user-role');
    const errorEl = document.getElementById('modal-user-error');
    const saveBtn = document.getElementById('modal-user-save');
    const idInput = document.getElementById('edit-user-id');

    const email = emailInput ? emailInput.value.trim() : '';
    const password = passInput ? passInput.value : '';
    const role = roleSelect ? roleSelect.value : 'user';
    const targetUserId = editingUserId || (idInput ? idInput.value : null);

    if (!email) return toast('Completá el correo electrónico', 'error');
    if (!targetUserId && !password) return toast('Ingresá una contraseña para el nuevo usuario', 'error');

    // Strict Email Regex Validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        const msg = 'Formato de correo inválido (ej: usuario@empresa.com)';
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        }
        toast(msg, 'error');
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Guardando...';
        }

        if (targetUserId) {
            const body = { email };
            if (currentUser && currentUser.role === 'superadmin') {
                body.role = role;
            }
            if (password && password.trim() !== '') {
                body.password = password;
            }
            await api(`/users/${targetUserId}`, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
            toast('Credenciales actualizadas exitosamente', 'success');
        } else {
            const body = { email, password, role };
            if (currentUser && currentUser.role === 'superadmin') {
                body.companyId = activeCompanyId;
            }
            await api('/users', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            toast('Usuario creado exitosamente', 'success');
        }

        hideModal('modal-user');
        editingUserId = null;
        if (idInput) idInput.value = '';
        
        await loadUsersSection('user');
        if (currentUser && currentUser.role === 'superadmin') {
            await loadUsersSection('admin');
        }
        if (activeNestedOperatorId) {
            await loadNestedOperatorProfiles();
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = err.message || 'Error al guardar usuario';
            errorEl.classList.remove('hidden');
        }
        toast(err.message || 'Error al guardar usuario', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = targetUserId ? 'Guardar Credenciales' : 'Guardar';
        }
    }
}

// --- Gestión de Cupo Individual de WhatsApp a Operadores ---
let quotaTargetUserId = null;
let quotaTargetCompanyMax = 10;
let quotaTargetAssignedCount = 0;
let quotaTargetOtherQuotas = 0;
let quotaTargetMaxAvailable = 10;

function openOperatorQuotaModal(userId, userEmail, currentLimit, assignedCount = 0, companyMax = 10, otherQuotas = null, maxAvailable = null) {
    quotaTargetUserId = userId;
    quotaTargetCompanyMax = parseInt(companyMax, 10) || 10;
    quotaTargetAssignedCount = parseInt(assignedCount, 10) || 0;

    if (otherQuotas === null || otherQuotas === undefined) {
        if (Array.isArray(companyUsers)) {
            quotaTargetOtherQuotas = companyUsers
                .filter(u => u.id !== userId)
                .reduce((s, u) => s + (parseInt(u.whatsapp_limit, 10) || 0), 0);
        } else {
            quotaTargetOtherQuotas = 0;
        }
    } else {
        quotaTargetOtherQuotas = parseInt(otherQuotas, 10) || 0;
    }

    if (maxAvailable === null || maxAvailable === undefined) {
        quotaTargetMaxAvailable = Math.max(0, quotaTargetCompanyMax - quotaTargetOtherQuotas);
    } else {
        quotaTargetMaxAvailable = parseInt(maxAvailable, 10);
    }

    const emailEl = document.getElementById('quota-modal-user-email');
    const compTotalEl = document.getElementById('quota-modal-company-total');
    const otherQuotasEl = document.getElementById('quota-modal-other-quotas');
    const userCreatedEl = document.getElementById('quota-modal-user-created');
    const currentLimitEl = document.getElementById('quota-modal-current-limit');
    const maxAvailEl = document.getElementById('quota-modal-max-available');
    const inputEl = document.getElementById('quota-modal-input-limit');
    const hintEl = document.getElementById('quota-modal-hint');
    const errEl = document.getElementById('quota-modal-error');
    const idEl = document.getElementById('quota-modal-user-id');

    if (idEl) idEl.value = userId;
    if (emailEl) emailEl.textContent = userEmail || 'Operador';
    if (compTotalEl) compTotalEl.textContent = `${quotaTargetCompanyMax} WhatsApps`;
    if (otherQuotasEl) otherQuotasEl.textContent = `${quotaTargetOtherQuotas} WhatsApps`;
    if (userCreatedEl) userCreatedEl.textContent = `${quotaTargetAssignedCount} WhatsApps`;
    
    const parsedCurrentLimit = (currentLimit !== null && currentLimit !== undefined) ? parseInt(currentLimit, 10) : quotaTargetAssignedCount;
    if (currentLimitEl) currentLimitEl.textContent = `${parsedCurrentLimit} WhatsApps`;
    if (maxAvailEl) maxAvailEl.textContent = `${quotaTargetMaxAvailable} WhatsApps`;

    if (inputEl) {
        inputEl.min = quotaTargetAssignedCount;
        inputEl.max = quotaTargetMaxAvailable;
        inputEl.value = parsedCurrentLimit;
    }
    if (hintEl) {
        hintEl.textContent = `Permitido: ${quotaTargetAssignedCount} a ${quotaTargetMaxAvailable}`;
    }
    if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
    }

    showModal('modal-operator-whatsapp-quota');
    setTimeout(() => {
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    }, 100);
}

async function handleSaveOperatorQuota() {
    if (!quotaTargetUserId) return;

    const inputEl = document.getElementById('quota-modal-input-limit');
    const errEl = document.getElementById('quota-modal-error');
    const saveBtn = document.getElementById('quota-modal-save');

    const newLimit = parseInt(inputEl ? inputEl.value : '', 10);

    if (isNaN(newLimit) || newLimit < 0) {
        const msg = 'Ingresa un número entero válido (mayor o igual a 0)';
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        return toast(msg, 'error');
    }

    if (newLimit < quotaTargetAssignedCount) {
        const msg = `El cupo no puede ser menor a las cuentas que ya tiene creadas (${quotaTargetAssignedCount}). Primero debes eliminar o desvincular cuentas de este operador.`;
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        return toast(msg, 'error');
    }

    if (newLimit > quotaTargetMaxAvailable) {
        const msg = `No puedes asignar ${newLimit} cupos. El máximo disponible para este operador es ${quotaTargetMaxAvailable}, ya que los demás operadores tienen asignados ${quotaTargetOtherQuotas} de los ${quotaTargetCompanyMax} cupos totales de la empresa. Libera cupos de otros operadores para aumentarlo.`;
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        return toast(msg, 'error');
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Guardando...`;
            if (window.lucide) lucide.createIcons();
        }

        await api(`/users/${quotaTargetUserId}`, {
            method: 'PATCH',
            body: JSON.stringify({ whatsapp_limit: newLimit })
        });

        toast(`Cupo de WhatsApp actualizado a ${newLimit} cuentas`, 'success');
        hideModal('modal-operator-whatsapp-quota');

        await loadUsersSection('user');
        if (currentUser && currentUser.role === 'superadmin') {
            await loadUsersSection('admin');
        }
        if (activeNestedOperatorId && activeNestedOperatorId === quotaTargetUserId) {
            await loadNestedOperatorProfiles();
        }
    } catch (err) {
        const msg = err.message || 'Error al actualizar el cupo';
        if (errEl) {
            errEl.textContent = msg;
            errEl.classList.remove('hidden');
        }
        toast(msg, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i data-lucide="check"></i> Guardar Cupo`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

async function toggleUserStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
        await api(`/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        toast(`Usuario ${newStatus === 'active' ? 'activado' : 'desactivado'}`);
        await loadUsersSection('admin');
        await loadUsersSection('user');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteUser(id) {
    const ok = await showConfirm({
        title: 'Eliminar Usuario',
        message: '¿Estás seguro de que deseas eliminar este usuario de forma permanente?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api(`/users/${id}`, { method: 'DELETE' });
        toast('Usuario eliminado');
        await loadUsersSection('admin');
        await loadUsersSection('user');
    } catch (err) {
        toast(err.message, 'error');
    }
}

// --- Asignar cuentas WA a operador ---
async function openAssignModal(userId, userEmail) {
    selectedAssignUserId = userId;
    document.getElementById('modal-assign-user-name').textContent = `Operador: ${userEmail}`;
    const list = document.getElementById('modal-assign-list');
    list.innerHTML = '';

    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        const profiles = await api(`/profiles${queryParam}`);

        if (profiles.length === 0) {
            list.innerHTML = '<div style="color:var(--text-secondary); padding:10px;">Esta empresa no tiene cuentas de WhatsApp creadas aún.</div>';
        } else {
            profiles.forEach(p => {
                const isAssigned = p.assigned_user_id === userId;
                const item = document.createElement('label');
                item.style.cssText = 'display: flex; align-items: center; gap: 10px; font-size: 13.5px; cursor: pointer; padding: 8px 10px; background: rgba(0,0,0,0.3); border-radius: 8px;';
                item.innerHTML = `
                    <input type="checkbox" value="${p.id}" ${isAssigned ? 'checked' : ''} style="width: 18px; height: 18px;">
                    <span><strong>${p.name}</strong> <small style="color: var(--text-secondary);">(${p.status})</small></span>
                `;
                list.appendChild(item);
            });
        }

        showModal('modal-assign');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleSaveAssignment() {
    if (!selectedAssignUserId) return;
    const checkboxes = document.querySelectorAll('#modal-assign-list input[type="checkbox"]');

    try {
        for (const cb of checkboxes) {
            const profileId = cb.value;
            const shouldAssign = cb.checked;
            const newAssignedId = shouldAssign ? selectedAssignUserId : null;

            await api(`/profiles/${profileId}/config`, {
                method: 'PATCH',
                body: JSON.stringify({ assigned_user_id: newAssignedId })
            });
        }
        hideModal('modal-assign');
        toast('Cuentas asignadas correctamente al operador');
        await loadUsersSection('user');
        await loadProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= CUENTAS DE WHATSAPP =================
async function loadProfiles() {
    if (!activeCompanyId) return;
    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        companyProfiles = await api(`/profiles${queryParam}`);
        const tbody = document.getElementById('profiles-table-body');
        const select = document.getElementById('queue-profile-select');
        tbody.innerHTML = '';
        select.innerHTML = '';

        if (companyProfiles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No hay cuentas de WhatsApp creadas en esta empresa.</td></tr>';
            return;
        }

        companyProfiles.forEach(p => {
            const isConnected = p.status === 'connected';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${p.name}</strong></td>
                <td><span class="badge ${isConnected ? 'connected' : 'disconnected'}">${isConnected ? 'Conectado' : 'Desconectado'}</span></td>
                <td>${p.assigned_user_email || '<span style="color:var(--text-secondary);">Todos los operadores</span>'}</td>
                <td>${p.sent_today}</td>
                <td>${p.daily_limit}</td>
                <td>
                    <button class="btn-danger" style="padding: 4px 10px; font-size: 11px;" onclick="deleteProfile('${p.id}')">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);

            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.pending_count || 0} pendientes)`;
            select.appendChild(opt);
        });

        if (companyProfiles.length > 0) loadQueueData();
    } catch (err) {
        console.error('Error loading profiles:', err);
    }
}

async function openAddProfileModal() {
    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        const users = await api(`/users${queryParam}`);
        const select = document.getElementById('new-profile-user');
        select.innerHTML = '<option value="">(Sin asignar - Visible para todos)</option>';
        users.forEach(u => {
            if (u.status === 'active') {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.email} (${u.role})`;
                select.appendChild(opt);
            }
        });
    } catch (e) {}

    showModal('modal-profile');
}

async function handleCreateProfile() {
    const name = document.getElementById('new-profile-name').value.trim();
    const message = document.getElementById('new-profile-message').value.trim();
    const assigned_user_id = document.getElementById('new-profile-user').value || null;

    if (!name) return toast('Ingresá un nombre para la cuenta', 'error');

    try {
        const body = { name, message, assigned_user_id };
        if (currentUser.role === 'superadmin') body.companyId = activeCompanyId;

        await api('/profiles', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        hideModal('modal-profile');
        document.getElementById('new-profile-name').value = '';
        document.getElementById('new-profile-message').value = '';
        toast('Cuenta de WhatsApp creada');
        await loadProfiles();
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteProfile(id) {
    const ok = await showConfirm({
        title: 'Eliminar Cuenta WhatsApp',
        message: '¿Estás seguro de que deseas eliminar esta cuenta de WhatsApp y sus colas asociadas?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api(`/profiles/${id}`, { method: 'DELETE' });
        toast('Cuenta eliminada');
        await loadProfiles();
        if (activeNestedOperatorId) {
            await loadNestedOperatorProfiles();
            await loadUsersSection('user');
        }
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= COLA Y ENVÍOS =================
async function loadQueueData() {
    const profileId = document.getElementById('queue-profile-select').value;
    const tbody = document.getElementById('queue-table-body');
    if (!profileId) return;

    try {
        const queue = await api(`/profiles/${profileId}/queue`);
        tbody.innerHTML = '';

        if (queue.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No hay números en la cola de esta cuenta.</td></tr>';
            return;
        }

        queue.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td><strong>${item.phone_number}</strong></td>
                <td><span class="badge ${item.status}">${item.status}</span></td>
                <td>${new Date(item.created_at).toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading queue:', err);
    }
}

async function handleQueueImport() {
    const profileId = document.getElementById('queue-profile-select').value;
    const text = document.getElementById('queue-numbers-paste').value.trim();
    if (!profileId) return toast('Seleccioná una cuenta primero', 'error');
    if (!text) return toast('Pegá al menos un número telefónico', 'error');

    const numbers = text.split(/[\r\n,]+/).map(n => n.trim()).filter(Boolean);

    try {
        const res = await api(`/profiles/${profileId}/queue/import`, {
            method: 'POST',
            body: JSON.stringify({ numbers })
        });
        toast(`Carga exitosa: ${res.imported} números importados en la cola.`);
        document.getElementById('queue-numbers-paste').value = '';
        await loadQueueData();
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function handleFileInput(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        document.getElementById('queue-numbers-paste').value = event.target.result;
        toast('Archivo cargado en el área de texto');
    };
    reader.readAsText(file);
}

async function handleQueueRetry() {
    const profileId = document.getElementById('queue-profile-select').value;
    if (!profileId) return;
    try {
        const res = await api(`/profiles/${profileId}/queue/retry-errors`, { method: 'POST' });
        toast(`Reintentando: ${res.retried} números reestablecidos a pendientes.`);
        await loadQueueData();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleQueueClear() {
    const profileId = document.getElementById('queue-profile-select').value;
    if (!profileId) return;
    const ok = await showConfirm({
        title: 'Vaciar Cola de Envíos',
        message: '¿Estás seguro de que deseas vaciar los números pendientes de esta cola?',
        confirmText: 'Vaciar Cola',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api(`/profiles/${profileId}/queue`, { method: 'DELETE' });
        toast('Cola vaciada');
        await loadQueueData();
        await loadCompanyMetrics();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= SECCIÓN DE REPORTES DE SOPORTE =================
async function loadReportsSection() {
    const superadminView = document.getElementById('reports-superadmin-view');
    const adminView = document.getElementById('reports-admin-view');

    if (currentUser.role === 'superadmin') {
        superadminView.classList.remove('hidden');
        adminView.classList.add('hidden');
        await loadSuperAdminTicketsLog();
    } else {
        superadminView.classList.add('hidden');
        adminView.classList.remove('hidden');
        // Admin only sees clean write/submit form, no history
        document.getElementById('admin-report-form').reset();
    }
}

let currentDetailTicketId = null;

// SuperAdmin Read-Only Log: [Nombre de la Empresa] - [Nombre del Admin que reportó] - [Hora]
async function loadSuperAdminTicketsLog() {
    try {
        const tickets = await api('/companies/reports/all');
        const container = document.getElementById('tickets-log-list');
        container.innerHTML = '';

        if (!tickets || tickets.length === 0) {
            container.innerHTML = '<div style="color:var(--text-secondary); padding:16px;">No hay reportes ni incidencias registradas en el sistema.</div>';
            return;
        }

        tickets.forEach(t => {
            const dateStr = new Date(t.created_at).toLocaleString();
            const logItem = document.createElement('div');
            logItem.style.cssText = `
                background: rgba(28, 28, 34, 0.8);
                border: 1px solid var(--border-hairline);
                border-radius: 12px;
                padding: 14px 18px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                transition: all 0.2s ease;
                gap: 12px;
            `;
            logItem.onmouseover = () => { logItem.style.borderColor = 'var(--accent-blue)'; };
            logItem.onmouseout = () => { logItem.style.borderColor = 'var(--border-hairline)'; };

            logItem.innerHTML = `
                <div style="flex: 1;">
                    <div style="font-size: 14px; font-weight: 600;">
                        [${t.company_name}] - [${t.author_email}] - [${dateStr}]
                    </div>
                    <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
                        Asunto: <strong style="color: var(--text-primary);">${t.title}</strong>
                        ${t.attachment_name ? ` • <span style="display:inline-flex; align-items:center; gap:4px; color:var(--accent-blue);">${getLucideSvg('paperclip', 13)} ${t.attachment_name}</span>` : ''}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 12px;">Ver Detalle →</button>
                    <button class="btn-danger" style="padding: 6px 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;" onclick="event.stopPropagation(); deleteSupportTicket('${t.id}')">
                        ${getLucideSvg('trash-2', 13)} Borrar
                    </button>
                </div>
            `;

            logItem.addEventListener('click', () => openTicketDetailModal(t));
            container.appendChild(logItem);
        });
    } catch (err) {
        console.error('Error loading tickets log:', err);
    }
}

function openTicketDetailModal(ticket) {
    currentDetailTicketId = ticket.id;
    document.getElementById('ticket-detail-title').textContent = ticket.title;
    document.getElementById('ticket-detail-meta').textContent = 
        `Empresa: ${ticket.company_name} • Remitente: ${ticket.author_email} • Fecha: ${new Date(ticket.created_at).toLocaleString()}`;
    document.getElementById('ticket-detail-content').textContent = ticket.content;

    const attachBox = document.getElementById('ticket-detail-attachment-box');
    const attachLink = document.getElementById('ticket-detail-attachment-link');
    const attachName = document.getElementById('ticket-detail-attachment-name');

    if (ticket.attachment_path) {
        attachBox.classList.remove('hidden');
        attachLink.href = ticket.attachment_path;
        attachName.textContent = ticket.attachment_name || 'Archivo';
    } else {
        attachBox.classList.add('hidden');
    }

    showModal('modal-ticket-detail');
}

async function handleDeleteCurrentTicketFromDetail() {
    if (!currentDetailTicketId) return;
    await deleteSupportTicket(currentDetailTicketId);
}

async function deleteSupportTicket(ticketId) {
    const ok = await showConfirm({
        title: 'Borrar Queja de Soporte',
        message: '¿Estás seguro de que deseas borrar este reporte de soporte? Esta acción eliminará permanentemente la queja.',
        confirmText: 'Borrar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;

    try {
        await api(`/companies/reports/${ticketId}`, { method: 'DELETE' });
        toast('Queja de soporte eliminada');
        hideModal('modal-ticket-detail');
        currentDetailTicketId = null;
        await loadSuperAdminTicketsLog();
    } catch (err) {
        toast('Error al borrar la queja: ' + err.message, 'error');
    }
}
window.deleteSupportTicket = deleteSupportTicket;

// Admin Submit Ticket Form (Multipart Form Data with .png / .pdf validation)
async function handleAdminSubmitTicket(e) {
    e.preventDefault();
    const title = document.getElementById('ticket-title').value.trim();
    const content = document.getElementById('ticket-content').value.trim();
    const fileInput = document.getElementById('ticket-attachment');
    const submitBtn = document.getElementById('btn-submit-ticket');

    if (!title || !content) return toast('Completá el título y la descripción del problema', 'error');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['png', 'pdf'].includes(ext)) {
            return toast('Solo se permiten archivos con extensión .png o .pdf', 'error');
        }
        formData.append('attachment', file);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
        const targetCompanyId = activeCompanyId || (currentUser && currentUser.companyId);
        if (!targetCompanyId) {
            throw new Error('No se pudo identificar la empresa emisora del reporte.');
        }

        const res = await fetch(`/companies/${targetCompanyId}/tickets`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al enviar reporte');

        toast('Enviado exitosamente');
        document.getElementById('admin-report-form').reset();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar Reporte al Soporte';
    }
}

async function loadReports() {
    if (!activeCompanyId) return;
    try {
        const queryParam = currentUser.role === 'superadmin' ? `?companyId=${activeCompanyId}` : '';
        const reports = await api(`/stats/reports${queryParam}`);
        const tbody = document.getElementById('reports-table-body');
        tbody.innerHTML = '';

        if (reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No hay registros de envíos aún en esta empresa.</td></tr>';
            return;
        }

        reports.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(r.sent_at).toLocaleString()}</td>
                <td>${r.profile_name}</td>
                <td><strong>${r.phone_number}</strong></td>
                <td><span class="badge ${r.result}">${r.result}</span></td>
                <td style="font-size: 12px; color: var(--text-secondary);">${r.error_message || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading reports:', err);
    }
}

async function exportReportsCSV() {
    if (!activeCompanyId) return;
    try {
        const queryParam = currentUser.role === 'superadmin' ? `&companyId=${activeCompanyId}` : '';
        const reports = await api(`/stats/reports?limit=5000${queryParam}`);
        if (reports.length === 0) return toast('No hay registros para exportar', 'error');

        let csv = 'Fecha,Cuenta,Telefono,Resultado,DetalleError\n';
        reports.forEach(r => {
            const date = `"${new Date(r.sent_at).toISOString()}"`;
            const profile = `"${(r.profile_name || '').replace(/"/g, '""')}"`;
            const phone = `"${r.phone_number}"`;
            const result = `"${r.result}"`;
            const error = `"${(r.error_message || '').replace(/"/g, '""')}"`;
            csv += `${date},${profile},${phone},${result},${error}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `reporte_${activeCompanyName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        toast('Reporte CSV descargado');
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= SYSTEM ANNOUNCEMENT BANNER =================
async function loadActiveAnnouncementBanner() {
    const bannerEl = document.getElementById('web-announcement-banner');
    if (!bannerEl) return;
    try {
        const announcements = await api('/announcements/active');
        if (!announcements || announcements.length === 0) {
            bannerEl.classList.add('hidden');
            bannerEl.innerHTML = '';
            return;
        }

        const active = announcements[0];
        const priorityClass = `priority-${active.priority || 'info'}`;
        const iconName = active.priority === 'danger' ? 'alert-triangle' : (active.priority === 'warning' ? 'alert-circle' : 'info');

        bannerEl.className = `announcement-banner ${priorityClass}`;
        bannerEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                ${getLucideSvg(iconName, 18)}
                <div>
                    <span class="announcement-banner-title">${active.title}:</span>
                    <span>${active.message}</span>
                </div>
            </div>
            <button onclick="document.getElementById('web-announcement-banner').classList.add('hidden')" style="background:none; border:none; color:inherit; cursor:pointer; padding:4px;">
                ${getLucideSvg('x', 14)}
            </button>
        `;
        bannerEl.classList.remove('hidden');
    } catch (err) {
        console.warn('Could not load active announcements banner:', err.message);
    }
}

// ================= SYSTEM ANNOUNCEMENTS (SUPERADMIN) =================
let selectedAnnouncementIds = new Set();

function updateAnnouncementSelection() {
    const checkboxes = document.querySelectorAll('.announcement-select-checkbox');
    const selectAllCheckbox = document.getElementById('select-all-announcements');
    const deleteBtn = document.getElementById('btn-delete-selected-announcements');
    const countSpan = document.getElementById('selected-announcements-count');

    selectedAnnouncementIds.clear();
    let allChecked = checkboxes.length > 0;

    checkboxes.forEach(cb => {
        const tr = cb.closest('tr');
        if (cb.checked) {
            selectedAnnouncementIds.add(cb.dataset.id);
            if (tr) tr.classList.add('selected-row');
        } else {
            allChecked = false;
            if (tr) tr.classList.remove('selected-row');
        }
    });

    if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked && checkboxes.length > 0;
        selectAllCheckbox.indeterminate = !allChecked && selectedAnnouncementIds.size > 0;
    }

    if (deleteBtn && countSpan) {
        countSpan.textContent = selectedAnnouncementIds.size;
        if (selectedAnnouncementIds.size > 0) {
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.style.display = 'none';
            deleteBtn.classList.add('hidden');
        }
    }
}
window.updateAnnouncementSelection = updateAnnouncementSelection;

function toggleSelectAllAnnouncements(checked) {
    const checkboxes = document.querySelectorAll('.announcement-select-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const tr = cb.closest('tr');
        if (tr) tr.classList.toggle('selected-row', checked);
    });
    updateAnnouncementSelection();
}
window.toggleSelectAllAnnouncements = toggleSelectAllAnnouncements;

async function deleteSelectedAnnouncements() {
    const ids = Array.from(selectedAnnouncementIds);
    if (ids.length === 0) return;

    const count = ids.length;
    const ok = await showConfirm({
        title: 'Eliminar Anuncios Seleccionados',
        message: `¿Estás seguro de que deseas eliminar los ${count} anuncio${count > 1 ? 's' : ''} seleccionado${count > 1 ? 's' : ''}? Esta acción es permanente y no se puede deshacer.`,
        confirmText: `Eliminar ${count} anuncio${count > 1 ? 's' : ''}`,
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;

    try {
        const res = await api('/announcements/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
        toast(res.message || `${count} anuncio(s) eliminado(s) exitosamente`);
        selectedAnnouncementIds.clear();
        await loadAnnouncementsList();
        await loadActiveAnnouncementBanner();
    } catch (err) {
        toast(err.message, 'error');
    }
}
window.deleteSelectedAnnouncements = deleteSelectedAnnouncements;

async function loadAnnouncementsList() {
    const tbody = document.getElementById('announcements-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding: 18px;">Cargando anuncios del sistema...</td></tr>';

    selectedAnnouncementIds.clear();
    const selectAllCheckbox = document.getElementById('select-all-announcements');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
    const deleteBtn = document.getElementById('btn-delete-selected-announcements');
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
        deleteBtn.classList.add('hidden');
    }

    try {
        const announcements = await api('/announcements');
        tbody.innerHTML = '';

        if (!announcements || announcements.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding: 18px;">No hay anuncios creados en el sistema.</td></tr>';
            return;
        }

        announcements.forEach(a => {
            const tr = document.createElement('tr');
            const priorityBadge = `<span class="badge" style="${a.priority === 'danger' ? 'background:rgba(239,68,68,0.2); color:#f87171;' : (a.priority === 'warning' ? 'background:rgba(245,158,11,0.2); color:#fbbf24;' : 'background:rgba(59,130,246,0.2); color:#93c5fd;')}">${a.priority.toUpperCase()}</span>`;
            const statusBadge = a.is_active 
                ? '<span class="badge active">Activo</span>' 
                : '<span class="badge disabled">Inactivo</span>';
            const created = new Date(a.created_at).toLocaleString();

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="announcement-select-checkbox" data-id="${a.id}" onchange="updateAnnouncementSelection()" style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--accent-pink, #e04d80);">
                </td>
                <td><strong>${a.title}</strong></td>
                <td style="max-width: 320px; font-size: 12.5px; color: var(--text-secondary);">${a.message}</td>
                <td>${priorityBadge}</td>
                <td>${statusBadge}</td>
                <td style="font-size: 12px; color: var(--text-secondary);">${created}</td>
                <td>
                    <button class="${a.is_active ? 'btn-secondary' : 'btn-success'}" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="toggleAnnouncementStatus('${a.id}', ${!a.is_active})">
                        ${a.is_active ? 'Pausar' : 'Activar'}
                    </button>
                    <button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteAnnouncement('${a.id}')">
                        Eliminar
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#f87171; padding: 18px;">Error al cargar anuncios: ${err.message}</td></tr>`;
    }
}

function handleBackFromAnnouncements() {
    if (currentUser && currentUser.role === 'superadmin') {
        switchView('view-companies');
    } else if (activeCompanyId) {
        switchView('view-metrics');
    } else {
        switchView('view-companies');
    }
}
window.handleBackFromAnnouncements = handleBackFromAnnouncements;

function openCreateAnnouncementModal() {
    try {
        const titleInput = document.getElementById('new-announcement-title');
        const msgInput = document.getElementById('new-announcement-message');
        const priorityInput = document.getElementById('new-announcement-priority');
        if (titleInput) titleInput.value = '';
        if (msgInput) msgInput.value = '';
        if (priorityInput) priorityInput.value = 'info';
        
        const modal = document.getElementById('modal-announcement');
        if (modal) {
            modal.classList.remove('hidden');
        } else {
            showModal('modal-announcement');
        }
        if (titleInput) setTimeout(() => titleInput.focus(), 50);
    } catch (err) {
        console.error('Error in openCreateAnnouncementModal:', err);
        const modal = document.getElementById('modal-announcement');
        if (modal) modal.classList.remove('hidden');
    }
}
window.openCreateAnnouncementModal = openCreateAnnouncementModal;

let isSavingAnnouncement = false;

async function handleSaveAnnouncement() {
    if (isSavingAnnouncement) return;

    const titleInput = document.getElementById('new-announcement-title');
    const msgInput = document.getElementById('new-announcement-message');
    const priorityInput = document.getElementById('new-announcement-priority');
    const saveBtn = document.getElementById('modal-announcement-save');

    const title = titleInput ? titleInput.value.trim() : '';
    const message = msgInput ? msgInput.value.trim() : '';
    const priority = priorityInput ? priorityInput.value : 'info';

    if (!title || !message) return toast('Completá el título y el mensaje del anuncio', 'error');

    isSavingAnnouncement = true;
    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Publicando...';
        }
        await api('/announcements', {
            method: 'POST',
            body: JSON.stringify({ title, message, priority })
        });
        toast('Anuncio publicado exitosamente');
        hideModal('modal-announcement');
        if (titleInput) titleInput.value = '';
        if (msgInput) msgInput.value = '';
        await loadAnnouncementsList();
        await loadActiveAnnouncementBanner();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        isSavingAnnouncement = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Publicar Anuncio';
        }
    }
}

async function toggleAnnouncementStatus(id, newStatus) {
    try {
        await api(`/announcements/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: newStatus })
        });
        toast(`Anuncio ${newStatus ? 'activado' : 'pausado'} exitosamente`);
        await loadAnnouncementsList();
        await loadActiveAnnouncementBanner();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteAnnouncement(id) {
    const ok = await showConfirm({
        title: 'Eliminar Anuncio',
        message: '¿Estás seguro de que deseas eliminar este anuncio del sistema?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;

    try {
        await api(`/announcements/${id}`, { method: 'DELETE' });
        toast('Anuncio eliminado');
        await loadAnnouncementsList();
        await loadActiveAnnouncementBanner();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= BANDEJA DE ANUNCIOS / VISTA ADMIN DE EMPRESA =================
let cachedInboxAnnouncements = [];
let selectedInboxAnnouncementId = null;

function getReadAnnouncementsSet() {
    try {
        const key = `bot_read_announcements_${currentUser ? currentUser.id : 'guest'}`;
        const stored = localStorage.getItem(key);
        return new Set(stored ? JSON.parse(stored) : []);
    } catch (e) {
        return new Set();
    }
}

function markAnnouncementAsRead(id) {
    try {
        const readSet = getReadAnnouncementsSet();
        readSet.add(id);
        const key = `bot_read_announcements_${currentUser ? currentUser.id : 'guest'}`;
        localStorage.setItem(key, JSON.stringify(Array.from(readSet)));
        updateInboxBadges();
    } catch (e) {
        console.error('Error marking announcement as read:', e);
    }
}

function updateInboxBadges() {
    const readSet = getReadAnnouncementsSet();
    const unreadCount = cachedInboxAnnouncements.filter(a => !readSet.has(a.id)).length;

    // Apple-style notification dots (no numbers, sleek red notification indicator)
    const topDot = document.getElementById('top-announcements-dot');
    const navDot = document.getElementById('nav-announcements-dot');

    if (topDot) {
        if (unreadCount > 0) {
            topDot.classList.remove('hidden');
        } else {
            topDot.classList.add('hidden');
        }
    }

    if (navDot) {
        if (unreadCount > 0) {
            navDot.classList.remove('hidden');
        } else {
            navDot.classList.add('hidden');
        }
    }
}

async function loadAdminAnnouncementsInbox() {
    try {
        const announcements = await api('/announcements/inbox');
        cachedInboxAnnouncements = Array.isArray(announcements) ? announcements : [];
        updateInboxBadges();
    } catch (err) {
        console.warn('Could not load inbox announcements:', err.message);
    }
}

async function loadAdminAnnouncementsView() {
    const listContainer = document.getElementById('admin-announcements-list');
    const readerContainer = document.getElementById('admin-announcement-reader');
    if (!listContainer) return;

    listContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 30px 10px; font-size: 13px;">Cargando anuncios...</div>';

    try {
        const announcements = await api('/announcements/inbox');
        cachedInboxAnnouncements = Array.isArray(announcements) ? announcements : [];
        updateInboxBadges();

        if (cachedInboxAnnouncements.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 40px 10px;">
                    <i data-lucide="inbox" style="width: 38px; height: 38px; opacity: 0.3; margin-bottom: 8px;"></i>
                    <p style="margin: 0; font-size: 13px;">No hay avisos del sistema en este momento.</p>
                </div>
            `;
            if (readerContainer) {
                readerContainer.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); margin: auto; padding: 20px;">
                        <i data-lucide="message-square" style="width: 44px; height: 44px; opacity: 0.3; margin-bottom: 12px;"></i>
                        <p style="font-size: 14px; margin: 0;">No hay comunicados seleccionados.</p>
                    </div>
                `;
            }
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        renderAdminAnnouncementsList();

        const target = cachedInboxAnnouncements.find(a => a.id === selectedInboxAnnouncementId) || cachedInboxAnnouncements[0];
        selectAdminAnnouncement(target);

    } catch (err) {
        listContainer.innerHTML = `<div style="color: #f87171; padding: 20px; text-align: center;">Error al cargar avisos: ${err.message}</div>`;
    }
}
window.loadAdminAnnouncementsView = loadAdminAnnouncementsView;

function renderAdminAnnouncementsList() {
    const listContainer = document.getElementById('admin-announcements-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const readSet = getReadAnnouncementsSet();

    cachedInboxAnnouncements.forEach(a => {
        const isRead = readSet.has(a.id);
        const isSelected = a.id === selectedInboxAnnouncementId;
        const priorityColor = a.priority === 'danger' ? '#ef4444' : (a.priority === 'warning' ? '#f59e0b' : '#3b82f6');
        const createdDate = new Date(a.created_at);
        const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        const card = document.createElement('div');
        card.className = `announcement-card ${isSelected ? 'active' : ''}`;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 7px; overflow: hidden; padding-right: 6px;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${priorityColor}; flex-shrink: 0; box-shadow: 0 0 6px ${priorityColor};"></span>
                    <strong class="announcement-card-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px;">
                        ${a.title}
                    </strong>
                </div>
                <span style="font-size: 11px; color: var(--text-secondary); flex-shrink: 0;">${dateStr}</span>
            </div>
            <div class="announcement-card-preview">
                ${a.message}
            </div>
            <div class="announcement-card-meta">
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary);">
                    <i data-lucide="shield-check" style="width: 12px; height: 12px; color: var(--accent-pink);"></i> SuperAdmin
                </span>
                ${!isRead ? `
                    <span class="apple-notification-dot" style="position: static; display: inline-block; margin-left: auto;"></span>
                ` : '<span style="font-size: 10.5px; color: #64748b;">Leído</span>'}
            </div>
        `;

        card.onclick = () => {
            selectAdminAnnouncement(a);
        };

        listContainer.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
}

function selectAdminAnnouncement(announcement) {
    if (!announcement) return;
    selectedInboxAnnouncementId = announcement.id;
    markAnnouncementAsRead(announcement.id);
    renderAdminAnnouncementsList();

    const reader = document.getElementById('admin-announcement-reader');
    if (!reader) return;

    const priorityBadge = `<span class="badge" style="${announcement.priority === 'danger' ? 'background:rgba(239,68,68,0.2); color:#f87171;' : (announcement.priority === 'warning' ? 'background:rgba(245,158,11,0.2); color:#fbbf24;' : 'background:rgba(59,130,246,0.2); color:#93c5fd;')}">${(announcement.priority || 'info').toUpperCase()}</span>`;
    const fullDate = new Date(announcement.created_at).toLocaleString(undefined, { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    reader.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-hairline);">
            <div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    ${priorityBadge}
                    <span style="font-size: 12px; color: var(--accent-pink); display: inline-flex; align-items: center; gap: 5px; font-weight: 600;">
                        <i data-lucide="shield-check" style="width: 14px; height: 14px;"></i> Comunicado Oficial
                    </span>
                </div>
                <h2 style="font-size: 20px; font-weight: 700; margin: 0; color: var(--text-primary); letter-spacing: -0.01em;">${announcement.title}</h2>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">
                    <i data-lucide="clock" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 3px;"></i>
                    Publicado el ${fullDate}
                </div>
            </div>
        </div>

        <div style="background: rgba(0, 0, 0, 0.22); border: 1px solid var(--border-hairline); border-radius: 14px; padding: 22px 24px; font-size: 14px; line-height: 1.65; color: var(--text-primary); white-space: pre-wrap; flex-grow: 1;">
            ${announcement.message}
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
}

function openAnnouncementsInboxModal() {
    switchView('view-admin-announcements');
}
window.openAnnouncementsInboxModal = openAnnouncementsInboxModal;

// ================= BLACKLIST / LISTA DE EXCLUSIÓN =================
let blacklistData = [];

async function loadBlacklist() {
    const tbody = document.getElementById('blacklist-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary); padding: 18px;">Cargando lista de exclusión...</td></tr>';

    try {
        const queryParam = currentUser.role === 'superadmin' && activeCompanyId ? `?companyId=${activeCompanyId}` : '';
        blacklistData = await api(`/blacklist${queryParam}`);
        renderBlacklistTable(blacklistData);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f87171; padding: 18px;">Error al cargar blacklist: ${err.message}</td></tr>`;
    }
}

function renderBlacklistTable(list) {
    const tbody = document.getElementById('blacklist-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary); padding: 18px;">No hay números en la lista de exclusión.</td></tr>';
        return;
    }

    list.forEach(item => {
        const tr = document.createElement('tr');
        const date = new Date(item.created_at).toLocaleDateString();
        tr.innerHTML = `
            <td><strong style="font-family: monospace; color: var(--accent-pink);">${item.phone_number}</strong></td>
            <td style="color: var(--text-secondary); font-size: 12.5px;">${item.reason || 'Sin motivo especificado'}</td>
            <td style="font-size: 12px; color: var(--text-secondary);">${date}</td>
            <td>
                <button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteBlacklistNumber('${item.id}', '${item.phone_number}')">
                    Desbloquear
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterBlacklistTable() {
    const q = (document.getElementById('blacklist-search-input').value || '').toLowerCase().trim();
    if (!q) {
        renderBlacklistTable(blacklistData);
        return;
    }
    const filtered = blacklistData.filter(b => 
        (b.phone_number && b.phone_number.toLowerCase().includes(q)) ||
        (b.reason && b.reason.toLowerCase().includes(q))
    );
    renderBlacklistTable(filtered);
}

async function handleSaveBlacklistNumber() {
    const phone = document.getElementById('new-blacklist-phone').value.trim();
    const reason = document.getElementById('new-blacklist-reason').value.trim();

    if (!phone) return toast('Ingresá el número de teléfono a bloquear', 'error');

    try {
        const body = { phoneNumber: phone, reason };
        if (currentUser.role === 'superadmin') {
            body.companyId = activeCompanyId;
        }
        await api('/blacklist', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        toast('Número agregado a la lista de exclusión');
        hideModal('modal-blacklist');
        document.getElementById('new-blacklist-phone').value = '';
        document.getElementById('new-blacklist-reason').value = '';
        await loadBlacklist();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteBlacklistNumber(id, phone) {
    const ok = await showConfirm({
        title: 'Desbloquear Número',
        message: `¿Remover el número ${phone} de la lista de exclusión? Podrá volver a recibir mensajes.`,
        confirmText: 'Desbloquear',
        cancelText: 'Cancelar',
        type: 'warning'
    });
    if (!ok) return;

    try {
        await api(`/blacklist/${id}`, { method: 'DELETE' });
        toast('Número removido de la blacklist');
        await loadBlacklist();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= AUDIT LOGS =================
let auditLogsData = [];

async function loadAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding: 18px;">Cargando registro de auditoría...</td></tr>';

    try {
        const queryParam = currentUser.role === 'superadmin' && activeCompanyId ? `?companyId=${activeCompanyId}` : '';
        auditLogsData = await api(`/audit-logs${queryParam}`);
        renderAuditTable(auditLogsData);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#f87171; padding: 18px;">Error al cargar auditoría: ${err.message}</td></tr>`;
    }
}

function renderAuditTable(logs) {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding: 18px;">No hay registros de auditoría disponibles.</td></tr>';
        return;
    }

    logs.forEach(log => {
        // SuperAdmin is strictly invisible to all company admins
        if (currentUser && currentUser.role !== 'superadmin') {
            if ((log.user_email && log.user_email.toLowerCase().includes('superadmin')) || 
                (log.action && log.action.toLowerCase().includes('superadmin'))) {
                return;
            }
        }

        const tr = document.createElement('tr');
        const date = new Date(log.created_at).toLocaleString();
        
        let actionClass = '';
        if (log.action.includes('DELETE') || log.action.includes('EARLY_WARNING') || log.action.includes('DANGER')) {
            actionClass = 'action-danger';
        } else if (log.action.includes('RESET') || log.action.includes('UPDATE')) {
            actionClass = 'action-warning';
        } else {
            actionClass = 'action-success';
        }

        let detailStr = '';
        if (typeof log.details === 'object' && log.details !== null) {
            detailStr = Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' | ');
        } else {
            detailStr = String(log.details || '-');
        }

        tr.innerHTML = `
            <td style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">${date}</td>
            <td><strong>${log.user_email || 'Sistema'}</strong></td>
            <td><span class="badge-audit ${actionClass}">${log.action}</span></td>
            <td style="font-family: monospace; font-size: 11.5px; color: var(--text-secondary);">${log.ip_address || '127.0.0.1'}</td>
            <td style="font-size: 12px; color: var(--text-secondary); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${detailStr.replace(/"/g, '&quot;')}">${detailStr}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAuditTable() {
    const q = (document.getElementById('audit-search-input').value || '').toLowerCase().trim();
    if (!q) {
        renderAuditTable(auditLogsData);
        return;
    }
    const filtered = auditLogsData.filter(log => {
        const actionMatch = log.action && log.action.toLowerCase().includes(q);
        const emailMatch = log.user_email && log.user_email.toLowerCase().includes(q);
        const ipMatch = log.ip_address && log.ip_address.toLowerCase().includes(q);
        const detailsMatch = log.details && JSON.stringify(log.details).toLowerCase().includes(q);
        return actionMatch || emailMatch || ipMatch || detailsMatch;
    });
    renderAuditTable(filtered);
}

// ================= OPERATORS COMPARISON =================
async function loadOperatorsComparison() {
    const tbody = document.getElementById('operators-comparison-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding: 18px;">Cargando métricas de operadores...</td></tr>';

    try {
        const queryParam = currentUser.role === 'superadmin' && activeCompanyId ? `?companyId=${activeCompanyId}` : '';
        const allStats = await api(`/stats/operators-comparison${queryParam}`);
        tbody.innerHTML = '';

        // Show operators and admins of this company, never superadmin
        const operators = (allStats || []).filter(op => 
            (op.role === 'user' || op.role === 'admin') && 
            op.role !== 'superadmin' && 
            !op.operatorEmail.toLowerCase().includes('superadmin')
        );

        if (operators.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding: 18px;">No hay operadores ni administradores con actividad en la empresa.</td></tr>';
            return;
        }

        operators.forEach(op => {
            const tr = document.createElement('tr');
            const rate = op.deliverabilityRate;
            const rateColor = rate >= 90 ? '#4ade80' : (rate >= 75 ? '#fbbf24' : '#f87171');
            const lastAct = op.lastActivity ? new Date(op.lastActivity).toLocaleTimeString() : 'Sin actividad';

            const isAdmin = op.role === 'admin';
            const roleBadge = isAdmin
                ? `<span class="badge connected" style="margin-left: 6px; font-size: 10px;">Admin</span>`
                : `<span class="badge ${op.status === 'active' ? 'active' : 'disabled'}" style="margin-left: 6px; font-size: 10px;">${op.status}</span>`;

            tr.innerHTML = `
                <td>
                    <strong>${op.operatorEmail}</strong>
                    ${roleBadge}
                </td>
                <td>${op.connectedProfilesCount} / ${op.profilesCount}</td>
                <td><strong style="color: #4ade80;">${op.sentToday}</strong></td>
                <td>${op.totalSent}</td>
                <td><span style="color: ${op.totalErrors > 0 ? '#f87171' : 'var(--text-secondary)'}; font-weight: ${op.totalErrors > 0 ? '700' : 'normal'};">${op.totalErrors}</span></td>
                <td>${op.totalPending}</td>
                <td><strong style="color: ${rateColor};">${rate}%</strong></td>
                <td style="font-size: 12px; color: var(--text-secondary);">${lastAct}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171; padding: 18px;">Error al cargar comparativa: ${err.message}</td></tr>`;
    }
}

// ================= EXECUTIVE REPORTS & EXPORT =================
let currentFilteredReports = [];

async function loadExecutiveReport() {
    const tbody = document.getElementById('report-rows-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding: 18px;">Cargando registros...</td></tr>';

    try {
        // Populate operator filter dropdown if empty
        const opSelect = document.getElementById('report-filter-operator');
        if (opSelect && opSelect.options.length <= 1) {
            const queryParam = currentUser.role === 'superadmin' && activeCompanyId ? `?companyId=${activeCompanyId}` : '';
            const users = await api(`/users${queryParam}`);
            const ops = (users || []).filter(u => (u.role === 'user' || u.role === 'admin') && u.role !== 'superadmin' && !u.email.toLowerCase().includes('superadmin'));
            ops.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = `${o.email} (${o.role === 'admin' ? 'Admin' : 'Operador'})`;
                opSelect.appendChild(opt);
            });
        }

        const start = document.getElementById('report-filter-start').value;
        const end = document.getElementById('report-filter-end').value;
        const operatorId = document.getElementById('report-filter-operator').value;
        const result = document.getElementById('report-filter-result').value;

        const params = new URLSearchParams();
        if (currentUser.role === 'superadmin' && activeCompanyId) params.append('companyId', activeCompanyId);
        if (start) params.append('startDate', start);
        if (end) params.append('endDate', end);
        if (operatorId) params.append('operatorId', operatorId);
        if (result) params.append('result', result);
        params.append('limit', '500');

        const reportsRes = await api(`/stats/reports?${params.toString()}`);
        const rows = (reportsRes && reportsRes.rows) ? reportsRes.rows : (Array.isArray(reportsRes) ? reportsRes : []);
        currentFilteredReports = rows;

        const summary = (reportsRes && reportsRes.summary) ? reportsRes.summary : {};
        const total = summary.total !== undefined ? summary.total : currentFilteredReports.length;
        const sentCount = summary.sent !== undefined ? summary.sent : currentFilteredReports.filter(r => r.result === 'sent').length;
        const errorCount = summary.errors !== undefined ? summary.errors : currentFilteredReports.filter(r => r.result === 'error').length;
        const rate = summary.deliverabilityRate !== undefined ? summary.deliverabilityRate : (total > 0 ? Math.round((sentCount / total) * 100) : 100);

        document.getElementById('report-sum-total').textContent = total;
        document.getElementById('report-sum-sent').textContent = sentCount;
        document.getElementById('report-sum-errors').textContent = errorCount;
        document.getElementById('report-sum-rate').textContent = `${rate}%`;

        tbody.innerHTML = '';
        if (currentFilteredReports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding: 18px;">No se encontraron registros en el rango seleccionado.</td></tr>';
            return;
        }

        currentFilteredReports.slice(0, 100).forEach(r => {
            const tr = document.createElement('tr');
            const date = new Date(r.sent_at).toLocaleString();
            tr.innerHTML = `
                <td style="font-size: 12px; color: var(--text-secondary);">${date}</td>
                <td><strong>${r.profile_name || 'Cuenta WA'}</strong></td>
                <td>${r.operator_email || '-'}</td>
                <td style="font-family: monospace;">${r.phone_number}</td>
                <td><span class="badge ${r.result}">${r.result === 'sent' ? 'Enviado' : 'Error'}</span></td>
                <td style="font-size: 12px; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${(r.error_message || '').replace(/"/g, '&quot;')}">${r.error_message || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#f87171; padding: 18px;">Error al cargar reporte: ${err.message}</td></tr>`;
    }
}

function exportReportCSV() {
    if (!currentFilteredReports || currentFilteredReports.length === 0) {
        return toast('No hay datos filtrados para exportar', 'error');
    }

    let csv = 'Fecha,Cuenta WhatsApp,Operador,Telefono,Resultado,Detalle Error\n';
    currentFilteredReports.forEach(r => {
        const date = `"${new Date(r.sent_at).toISOString()}"`;
        const profile = `"${(r.profile_name || '').replace(/"/g, '""')}"`;
        const operator = `"${(r.operator_email || '').replace(/"/g, '""')}"`;
        const phone = `"${r.phone_number}"`;
        const result = `"${r.result}"`;
        const error = `"${(r.error_message || '').replace(/"/g, '""')}"`;
        csv += `${date},${profile},${operator},${phone},${result},${error}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `reporte_ejecutivo_${(activeCompanyName || 'empresa').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast('Reporte CSV exportado exitosamente');
}

function exportReportPDF() {
    if (!currentFilteredReports || currentFilteredReports.length === 0) {
        return toast('No hay datos filtrados para imprimir', 'error');
    }
    window.print();
}

// ================= PROFILE CONFIG MODAL =================
async function openProfileConfigModal(profileId) {
    if (!currentUser || currentUser.role !== 'superadmin') {
        return toast('Acceso restringido: Solo el SuperAdmin puede configurar parámetros y límites de la cuenta', 'error');
    }
    try {
        const p = await api(`/profiles/${profileId}`);
        if (!p) return toast('No se encontró el perfil', 'error');

        document.getElementById('profile-config-id').value = p.id;
        document.getElementById('profile-config-title').innerHTML = `
            ${getLucideSvg('sliders', 18)} Ajustes de Cuenta: ${p.name}
        `;
        document.getElementById('profile-config-subtitle').textContent = `Línea asignada al operador. Configurá parámetros anti-baneo y límites.`;

        // Early warning banner
        const ewBanner = document.getElementById('modal-profile-early-warning');
        const ewText = document.getElementById('modal-early-warning-text');
        if (p.is_paused_early_warning) {
            ewBanner.classList.remove('hidden');
            ewText.textContent = p.early_warning_reason || 'Tasa de errores superior al 15% en los últimos envíos. Cola detenida por seguridad.';
        } else {
            ewBanner.classList.add('hidden');
        }

        // Base delays & limits
        const catSelect = document.getElementById('cfg-category');
        if (catSelect) catSelect.value = p.category || 'Movistar';

        document.getElementById('cfg-daily-limit').value = p.daily_limit || 200;
        document.getElementById('cfg-batch-size').value = p.batch_size || 15;

        // Work schedule
        document.getElementById('cfg-work-schedule-enabled').checked = !!p.work_schedule_enabled;
        document.getElementById('cfg-work-schedule-start').value = p.work_schedule_start || '09:00';
        document.getElementById('cfg-work-schedule-end').value = p.work_schedule_end || '18:00';

        // Warmup mode
        document.getElementById('cfg-warmup-enabled').checked = !!p.warmup_enabled;
        document.getElementById('cfg-warmup-day').value = p.warmup_day || 1;
        document.getElementById('cfg-warmup-increment').value = p.warmup_daily_increment || 15;
        document.getElementById('cfg-warmup-max').value = p.warmup_max_limit || 200;

        // Auto-assigned Proxy status
        const proxyBadge = document.getElementById('cfg-proxy-status-badge');
        if (proxyBadge) {
            if (p.proxy_url) {
                let display = p.proxy_url;
                try {
                    const u = new URL(p.proxy_url.startsWith('http') || p.proxy_url.startsWith('socks5') ? p.proxy_url : 'http://' + p.proxy_url);
                    display = u.protocol + '//' + u.host;
                } catch(e) {}
                proxyBadge.className = 'status-badge status-connected';
                proxyBadge.textContent = 'Asignada por Pool: ' + display;
            } else {
                proxyBadge.className = 'status-badge status-warning';
                proxyBadge.textContent = 'Sin proxy (Conexión Directa por VPS)';
            }
        }

        showModal('modal-profile-config');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleSaveProfileConfig() {
    if (!currentUser || currentUser.role !== 'superadmin') {
        return toast('Acceso restringido: Solo el SuperAdmin puede modificar parámetros y límites de la cuenta', 'error');
    }
    const profileId = document.getElementById('profile-config-id').value;
    if (!profileId) return;

    const catSelect = document.getElementById('cfg-category');
    const category = catSelect ? catSelect.value : 'Movistar';

    const daily_limit = parseInt(document.getElementById('cfg-daily-limit').value, 10) || 200;
    const batch_size = parseInt(document.getElementById('cfg-batch-size').value, 10) || 15;
    const work_schedule_enabled = document.getElementById('cfg-work-schedule-enabled').checked;
    const work_schedule_start = document.getElementById('cfg-work-schedule-start').value || '09:00';
    const work_schedule_end = document.getElementById('cfg-work-schedule-end').value || '18:00';
    const warmup_enabled = document.getElementById('cfg-warmup-enabled').checked;
    const warmup_day = parseInt(document.getElementById('cfg-warmup-day').value, 10) || 1;
    const warmup_daily_increment = parseInt(document.getElementById('cfg-warmup-increment').value, 10) || 15;
    const warmup_max_limit = parseInt(document.getElementById('cfg-warmup-max').value, 10) || 200;

    try {
        await api(`/profiles/${profileId}/config`, {
            method: 'PATCH',
            body: JSON.stringify({
                category,
                daily_limit,
                batch_size,
                work_schedule_enabled,
                work_schedule_start,
                work_schedule_end,
                warmup_enabled,
                warmup_day,
                warmup_daily_increment,
                warmup_max_limit
            })
        });
        toast('Configuración guardada exitosamente');
        hideModal('modal-profile-config');
        await loadNestedOperatorProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleResumeEarlyWarningFromModal() {
    const profileId = document.getElementById('profile-config-id').value;
    if (!profileId) return;

    try {
        await api(`/profiles/${profileId}/queue/early-warning/resume`, { method: 'POST' });
        document.getElementById('modal-profile-early-warning').classList.add('hidden');
        toast('Cola reanudada y alerta temprana reiniciada con éxito');
        await loadNestedOperatorProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ================= MODAL HELPERS =================
function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// Global scope bindings for inline HTML onclicks
window.enterCompanyManagement = enterCompanyManagement;
window.toggleCompanyStatus = toggleCompanyStatus;
window.openCompanyLimitsModal = openCompanyLimitsModal;
window.resetCompanyDefaults = resetCompanyDefaults;
window.openCreateUserModal = openCreateUserModal;
window.openEditUserModal = openEditUserModal;
window.toggleUserStatus = toggleUserStatus;
window.deleteUser = deleteUser;
window.resetUserDefaults = resetUserDefaults;
window.openNestedOperatorProfiles = openNestedOperatorProfiles;
window.deleteProfile = deleteProfile;
window.openProfileConfigModal = openProfileConfigModal;
window.handleSaveProfileConfig = handleSaveProfileConfig;
window.handleResumeEarlyWarningFromModal = handleResumeEarlyWarningFromModal;
window.toggleAnnouncementStatus = toggleAnnouncementStatus;
window.deleteAnnouncement = deleteAnnouncement;
window.openCreateAnnouncementModal = openCreateAnnouncementModal;
window.handleSaveAnnouncement = handleSaveAnnouncement;
window.loadAdminAnnouncementsView = loadAdminAnnouncementsView;
window.selectAdminAnnouncement = selectAdminAnnouncement;
window.handleBackFromAnnouncements = handleBackFromAnnouncements;
window.openAnnouncementsInboxModal = openAnnouncementsInboxModal;
window.deleteSupportTicket = deleteSupportTicket;
window.showModal = showModal;
window.hideModal = hideModal;
window.switchView = switchView;
window.deleteBlacklistNumber = deleteBlacklistNumber;
window.loadAuditLogs = loadAuditLogs;
window.loadOperatorsComparison = loadOperatorsComparison;
window.loadExecutiveReport = loadExecutiveReport;
window.exportReportCSV = exportReportCSV;
window.exportReportPDF = exportReportPDF;
window.updateAnnouncementSelection = updateAnnouncementSelection;
window.toggleSelectAllAnnouncements = toggleSelectAllAnnouncements;
window.deleteSelectedAnnouncements = deleteSelectedAnnouncements;

// ================= HELP MANUAL & DOCUMENTATION =================
let currentHelpManual = null;

async function loadHelpManual() {
    const display = document.getElementById('help-content-display');
    const editBtn = document.getElementById('btn-edit-help');
    const resetBtn = document.getElementById('btn-reset-help');
    const metaUpdated = document.getElementById('help-meta-updated');
    const titleDisplay = document.getElementById('help-view-title-display');

    // SuperAdmin controls visibility
    const isSuperAdmin = currentUser && currentUser.role === 'superadmin';
    if (editBtn) editBtn.classList.toggle('hidden', !isSuperAdmin);
    if (resetBtn) resetBtn.classList.toggle('hidden', !isSuperAdmin);

    // Ensure read container is visible and edit container is hidden
    document.getElementById('help-read-container').classList.remove('hidden');
    document.getElementById('help-edit-container').classList.add('hidden');

    try {
        const res = await api('/help');
        currentHelpManual = res;
        
        if (titleDisplay) titleDisplay.textContent = res.title || 'Manual Integral de Uso y Operación';
        if (metaUpdated && res.updated_at) {
            const dateStr = new Date(res.updated_at).toLocaleString();
            metaUpdated.textContent = `Última actualización: ${dateStr}${res.updated_by_email ? ` por ${res.updated_by_email}` : ''}`;
        }

        renderHelpManualContent(res.content || '');
        setupHelpNavPills();
    } catch (err) {
        if (display) display.innerHTML = `<div style="color:#f87171; padding:20px; text-align:center;">Error al cargar el manual: ${err.message}</div>`;
    }
}

function renderMarkdown(md) {
    if (!md) return '';
    
    // Normalize lines
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

        // Horizontal rule
        if (/^---+\s*$/.test(line)) {
            flushList();
            flushBlockquote();
            output.push('<hr>');
            continue;
        }

        // Blockquote
        if (/^>\s?(.*)$/.test(line)) {
            flushList();
            inBlockquote = true;
            const match = line.match(/^>\s?(.*)$/);
            bqLines.push(formatInline(match[1]));
            continue;
        } else {
            flushBlockquote();
        }

        // Headings
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

        // Unordered list
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

        // Ordered list
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

        // Sublist (indent with 2-4 spaces)
        if (/^\s+[-*]\s+(.+)$/.test(line)) {
            const itemText = line.trim().replace(/^[-*]\s+/, '');
            output.push(`<li style="margin-left: 20px;">${formatInline(itemText)}</li>`);
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            flushList();
            continue;
        }

        // Standard paragraph
        flushList();
        output.push(`<p>${formatInline(line)}</p>`);
    }

    flushList();
    flushBlockquote();

    return output.join('\n');
}

function renderHelpManualContent(content) {
    const display = document.getElementById('help-content-display');
    if (!display) return;
    display.innerHTML = renderMarkdown(content);

    // Wire up internal anchor links to smooth-scroll
    display.querySelectorAll('a.manual-anchor-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').replace('#', '');
            scrollToSection(targetId);
        });
    });
}

function scrollToSection(slugOrId) {
    const display = document.getElementById('help-content-display');
    if (!display) return;
    
    // Find heading element matching id or starting with slug
    let target = document.getElementById(slugOrId);
    if (!target) {
        if (slugOrId === 'anti-ban' || slugOrId.includes('anti-ban') || slugOrId.includes('buenas-practicas')) {
            target = display.querySelector('[id*="buenas-practicas"], [id*="anti-ban-para-el-operador"]');
        }
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

function setupHelpNavPills() {
    const pills = document.querySelectorAll('.help-nav-pill');
    pills.forEach(pill => {
        pill.onclick = () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const target = pill.dataset.target;
            if (target === 'all') {
                const display = document.getElementById('help-content-display');
                if (display) display.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                scrollToSection(target);
            }
        };
    });
}

function handleHelpSearch() {
    const query = document.getElementById('help-search-input').value.trim().toLowerCase();
    if (!currentHelpManual || !currentHelpManual.content) return;

    if (!query) {
        renderHelpManualContent(currentHelpManual.content);
        return;
    }

    const display = document.getElementById('help-content-display');
    renderHelpManualContent(currentHelpManual.content);

    // Highlight matches in display
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

function openEditHelpManual() {
    if (!currentUser || currentUser.role !== 'superadmin') return;
    if (!currentHelpManual) return;

    document.getElementById('help-read-container').classList.add('hidden');
    document.getElementById('help-edit-container').classList.remove('hidden');
    document.getElementById('btn-edit-help').classList.add('hidden');

    document.getElementById('help-edit-title').value = currentHelpManual.title || '';
    document.getElementById('help-edit-content').value = currentHelpManual.content || '';
    document.getElementById('help-edit-content').focus();
}

function cancelEditHelpManual() {
    document.getElementById('help-edit-container').classList.add('hidden');
    document.getElementById('help-read-container').classList.remove('hidden');
    const editBtn = document.getElementById('btn-edit-help');
    if (editBtn && currentUser && currentUser.role === 'superadmin') {
        editBtn.classList.remove('hidden');
    }
}

async function handleSaveHelpManual() {
    const title = document.getElementById('help-edit-title').value.trim();
    const content = document.getElementById('help-edit-content').value.trim();

    if (!content) {
        toast('El contenido del manual no puede estar vacío', 'error');
        return;
    }

    try {
        const res = await api('/help', {
            method: 'PUT',
            body: JSON.stringify({ title, content })
        });

        toast('Manual de ayuda actualizado y guardado correctamente');
        cancelEditHelpManual();
        await loadHelpManual();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleResetHelpManual() {
    if (!confirm('¿Estás seguro de que deseas restaurar el manual a su versión predeterminada de fábrica? Se perderán las modificaciones personalizadas.')) {
        return;
    }

    try {
        await api('/help/reset', { method: 'POST' });
        toast('Manual restaurado a la versión predeterminada de fábrica');
        await loadHelpManual();
    } catch (err) {
        toast(err.message, 'error');
    }
}

window.loadHelpManual = loadHelpManual;
window.renderMarkdown = renderMarkdown;
window.openEditHelpManual = openEditHelpManual;
window.cancelEditHelpManual = cancelEditHelpManual;
window.handleSaveHelpManual = handleSaveHelpManual;
window.handleResetHelpManual = handleResetHelpManual;



// ================= ISOLATED COMPANY PROXY POOL (COMPANY ADMIN & SUPERADMIN) =================
function getProxiesTargetCompanyId() {
    if (!currentUser) return null;
    if (currentUser.role === 'superadmin') {
        return activeCompanyId;
    }
    return currentUser.companyId;
}

async function loadProxiesPoolView() {
    if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return toast('Acceso restringido: Solo Administradores pueden gestionar el Pool de Proxies', 'error');
    }

    const targetCompanyId = getProxiesTargetCompanyId();
    if (!targetCompanyId) {
        toast('Selecciona una empresa del directorio primero', 'warning');
        if (currentUser.role === 'superadmin') switchView('view-companies');
        return;
    }

    // Update company title label in the proxies view header
    const titleEl = document.getElementById('proxies-company-title');
    if (titleEl) {
        titleEl.textContent = activeCompanyName || (currentUser.role === 'admin' ? (currentUser.companyName || 'Mi Empresa') : 'Empresa');
    }

    try {
        const query = currentUser.role === 'superadmin' ? `?companyId=${encodeURIComponent(targetCompanyId)}` : '';
        const data = await api(`/admin/proxies${query}`);
        if (!data) return;

        const stats = data.stats || {};
        const statProxies = document.getElementById('stat-pool-total-proxies');
        const statCap = document.getElementById('stat-pool-total-capacity');
        const statAssigned = document.getElementById('stat-pool-assigned-accounts');
        const statDirect = document.getElementById('stat-pool-direct-vps');

        if (statProxies) statProxies.textContent = stats.totalProxies || 0;
        if (statCap) statCap.textContent = stats.totalCapacity || 0;
        if (statAssigned) statAssigned.textContent = stats.assignedToProxies || 0;
        if (statDirect) statDirect.textContent = (stats.directVpsCount !== undefined ? stats.directVpsCount : stats.directVps) || 0;

        // Render Proxies Table
        const proxiesTbody = document.getElementById('pool-proxies-table-body');
        if (proxiesTbody) {
            if (!data.proxies || data.proxies.length === 0) {
                proxiesTbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; color: var(--text-tertiary); padding: 28px;">
                            No hay proxies cargados en esta empresa. Todas sus cuentas de WhatsApp se conectan automáticamente usando la IP directa de la VPS.
                        </td>
                    </tr>
                `;
            } else {
                proxiesTbody.innerHTML = data.proxies.map((p, idx) => {
                    const ratio = p.assigned_count >= p.max_capacity ? 'badge-danger' : (p.assigned_count > 0 ? 'badge-success' : 'badge-neutral');
                    return `
                        <tr>
                            <td style="font-weight: 600; color: var(--text-secondary);">${idx + 1}</td>
                            <td><span style="font-family: monospace; font-weight: 600; color: #60a5fa;">${escapeHtml(p.label || p.host)}</span></td>
                            <td><span class="badge" style="text-transform: uppercase; font-size: 11px;">${escapeHtml((p.protocol || 'http').replace(':', ''))}</span></td>
                            <td><code style="font-size: 11.5px; color: var(--text-secondary); background: rgba(0,0,0,0.25); padding: 2px 6px; border-radius: 4px;">${escapeHtml(p.maskedUrl || p.masked_url)}</code></td>
                            <td>
                                <span class="badge ${ratio}" style="font-size: 11.5px;">
                                    ${p.assigned_count} / ${p.max_capacity} WhatsApps
                                </span>
                            </td>
                            <td style="color: var(--text-secondary); font-size: 12px;">Máx ${p.max_capacity} cuentas</td>
                            <td>
                                <button class="btn-secondary" style="padding: 4px 10px; font-size: 11.5px; color: #f87171; border-color: rgba(239,68,68,0.3); display: inline-flex; align-items: center; gap: 4px;" onclick="handleDeleteProxy('${p.id}')">
                                    <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Eliminar
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // Render Assignments Table
        const assignTbody = document.getElementById('pool-assignments-table-body');
        if (assignTbody) {
            if (!data.assignments || data.assignments.length === 0) {
                assignTbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: var(--text-tertiary); padding: 28px;">
                            No hay cuentas de WhatsApp configuradas en esta empresa.
                        </td>
                    </tr>
                `;
            } else {
                assignTbody.innerHTML = data.assignments.map(a => {
                    const isConnected = a.status === 'connected' || a.is_connected;
                    const statusBadge = isConnected
                        ? `<span class="status-badge status-connected"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Conectado</span>`
                        : `<span class="status-badge status-disconnected"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> Desconectado</span>`;
                    
                    const isPool = !a.isDirect || a.assigned_via_pool;
                    const ipBadge = isPool
                        ? `<span class="status-badge status-connected" style="display: inline-flex; align-items: center; gap: 4px; font-family: monospace; font-size: 11.5px;"><i data-lucide="shield-check" style="width:13px;height:13px;"></i> ${escapeHtml(a.assignedDisplay || a.proxy_display)}</span>`
                        : `<span class="status-badge status-warning" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px;"><i data-lucide="server" style="width:13px;height:13px;"></i> Directo VPS</span>`;

                    return `
                        <tr>
                            <td>
                                <strong style="color: var(--text-primary); font-size: 13px;">${escapeHtml(a.name || a.profile_name)}</strong>
                            </td>
                            <td style="color: var(--text-secondary); font-size: 12.5px;">${escapeHtml(a.companyName || a.company_name || 'Sin Empresa')}</td>
                            <td style="color: var(--text-secondary); font-size: 12.5px;">${escapeHtml(a.operatorEmail || a.operator_email || 'Sin Asignar')}</td>
                            <td>${statusBadge}</td>
                            <td>${ipBadge}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        toast('Error al cargar el pool de proxies: ' + (err.message || err), 'error');
    }
}

async function handleBulkAddProxies() {
    if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return toast('Acceso restringido: Solo Administradores pueden agregar proxies', 'error');
    }

    const targetCompanyId = getProxiesTargetCompanyId();
    if (!targetCompanyId) {
        return toast('No hay una empresa seleccionada', 'warning');
    }

    const input = document.getElementById('pool-proxies-input');
    const text = input ? input.value.trim() : '';

    if (!text) {
        return toast('Ingresá al menos una línea de proxy para cargar al pool', 'warning');
    }

    const btn = document.getElementById('btn-save-pool-proxies');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Procesando...`;
    }

    try {
        const res = await api('/admin/proxies/bulk', {
            method: 'POST',
            body: JSON.stringify({ text, companyId: targetCompanyId })
        });

        toast(res.message || 'Proxies cargados y asignados exitosamente');
        if (input) input.value = '';
        await loadProxiesPoolView();
    } catch (err) {
        toast(err.message || 'Error al agregar proxies', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="plus-circle"></i> Cargar y Asignar Automáticamente`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

async function handleDeleteProxy(proxyId) {
    if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return toast('Acceso restringido: Solo Administradores pueden eliminar proxies', 'error');
    }

    const targetCompanyId = getProxiesTargetCompanyId();
    if (!targetCompanyId) {
        return toast('No hay una empresa seleccionada', 'warning');
    }

    const ok = await showConfirm({
        title: 'Eliminar Proxy del Pool',
        message: '¿Estás seguro de eliminar este proxy? Las cuentas de WhatsApp de esta empresa que lo usaban se rebalancearán automáticamente a las IPs restantes de la empresa o volverán a la conexión directa por VPS.',
        confirmText: 'Eliminar Proxy',
        cancelText: 'Cancelar',
        type: 'danger'
    });

    if (!ok) return;

    try {
        const query = currentUser.role === 'superadmin' ? `?companyId=${encodeURIComponent(targetCompanyId)}` : '';
        const res = await api(`/admin/proxies/${proxyId}${query}`, {
            method: 'DELETE'
        });

        toast(res.message || 'Proxy eliminado y cuentas rebalanceadas');
        await loadProxiesPoolView();
    } catch (err) {
        toast(err.message || 'Error al eliminar el proxy', 'error');
    }
}

async function handleRebalanceProxies() {
    if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return toast('Acceso restringido: Solo Administradores pueden rebalancear proxies', 'error');
    }

    const targetCompanyId = getProxiesTargetCompanyId();
    if (!targetCompanyId) {
        return toast('No hay una empresa seleccionada', 'warning');
    }

    const btn = document.getElementById('btn-rebalance-proxies');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Rebalanceando...`;
    }

    try {
        const res = await api('/admin/proxies/rebalance', {
            method: 'POST',
            body: JSON.stringify({ companyId: targetCompanyId })
        });

        toast(res.message || 'Cuentas rebalanceadas exitosamente');
        await loadProxiesPoolView();
    } catch (err) {
        toast(err.message || 'Error al rebalancear el pool', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="refresh-cw"></i> Rebalancear Asignaciones`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

window.loadProxiesPoolView = loadProxiesPoolView;
window.handleBulkAddProxies = handleBulkAddProxies;
window.handleDeleteProxy = handleDeleteProxy;
window.handleRebalanceProxies = handleRebalanceProxies;
window.openOperatorQuotaModal = openOperatorQuotaModal;
window.handleSaveOperatorQuota = handleSaveOperatorQuota;
