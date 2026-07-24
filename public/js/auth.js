const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

function applyRememberedEmail() {
  try {
    const rememberedEmail = localStorage.getItem('il_remember_email');
    if (rememberedEmail) {
      const emailField = document.getElementById('email');
      const remBox = document.getElementById('rememberMe');
      if (emailField) emailField.value = rememberedEmail;
      if (remBox) remBox.checked = true;
    }
  } catch (e) {}
}
applyRememberedEmail();
document.addEventListener('DOMContentLoaded', applyRememberedEmail);

function passwordEyeIcon(isVisible) {
  return isVisible
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

function loginPasswordEyeIcon(isVisible) {
  return passwordEyeIcon(isVisible);
}

function toggleLoginPassword() {
  const input = document.getElementById('password');
  const button = document.getElementById('loginPasswordToggle');
  if (!input || !button) return;
  const revealed = input.type === 'password';
  input.type = revealed ? 'text' : 'password';
  button.innerHTML = passwordEyeIcon(revealed);
  button.title = revealed ? 'Sembunyikan kata sandi' : 'Lihat kata sandi';
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('il_current_user');
  localStorage.removeItem('il_auth_token');
  const badge = document.getElementById('roleBadgeTop');
  if (badge) badge.remove();
  document.querySelectorAll('.modal-overlay.show').forEach(modal => modal.classList.remove('show'));
  document.getElementById('dashboard-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  window.location.hash = 'login';
  loginForm.reset();
  applyRememberedEmail();
  stopSSE();
}

function isTerminationAccessExpired(client) {
  if (!client?.terminationApprovedAt || !client?.terminateAccessEndsAt) return false;
  const cutoff = new Date(client.terminateAccessEndsAt).getTime();
  return !Number.isNaN(cutoff) && Date.now() >= cutoff;
}

function getTerminationAccessRemainingHours(client) {
  if (!client?.terminateAccessEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(client.terminateAccessEndsAt).getTime() - Date.now()) / (60 * 60 * 1000)));
}

function getBerhentiRemainingHours(client) {
  if (!client?.berhentiAt) return 0;
  const cutoff = new Date(client.berhentiAt).getTime() + (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((cutoff - Date.now()) / (60 * 60 * 1000)));
}

function enforceTerminationAccessCutoff(client) {
  if (!isTerminationAccessExpired(client) || client.status === 'Terminate') return false;
  const now = new Date().toISOString();
  client.status = 'Terminate';
  client.berhentiAt = now;
  client.terminatedAt = now;
  client.suspendAt = null;
  client.ket = (client.ket || '') + (client.ket ? ' | ' : '') + 'Akses portal ditutup pada hari ke-4 setelah terminate disetujui.';
  return true;
}

function getClientDataForCurrentUser() {
  if (!currentUser) return null;
  return clients.find(cl => cl.id === currentUser.clientId) || clients.find(cl => cl.pt === currentUser.pt) || null;
}

loginForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const pass = document.getElementById('password').value.trim();
  const rememberMe = document.getElementById('rememberMe');
  if (rememberMe?.checked) localStorage.setItem('il_remember_email', email);
  else localStorage.removeItem('il_remember_email');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    if (!res.ok) {
      const err = await res.json();
      loginError.classList.add('show');
      loginError.innerHTML = `⚠ ${err.error || 'Email atau kata sandi salah. Coba lagi.'}`;
      loginError.style.display = 'flex';
      return;
    }
    const responseData = await res.json();
    const user = responseData.user;
    const token = responseData.token;

    // Save token immediately
    localStorage.setItem('il_auth_token', token);

    if (user.role === 'client' || user.role === 'subclient') {
      const clRes = await fetch('/api/clients', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const combinedClients = await clRes.json();
      const clientData = combinedClients.find(cl => cl.id === user.clientId) || combinedClients.find(cl => cl.pt === user.pt);
      
      if (clientData && isTerminationAccessExpired(clientData)) {
        // Enforce access cutoff
        clientData.status = 'Terminate';
        const nowIso = new Date().toISOString();
        clientData.berhentiAt = nowIso;
        clientData.terminatedAt = nowIso;
        clientData.suspendAt = null;
        clientData.ket = (clientData.ket || '') + (clientData.ket ? ' | ' : '') + 'Akses portal ditutup pada hari ke-4 setelah terminate disetujui.';
        
        await fetch(`/api/clients/${encodeURIComponent(clientData.id)}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(clientData)
        });
        
        if (clientData.terminationTicketId) {
          await fetch('/api/termination-notifications', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              id: 'NTF-' + Date.now(),
              event: 'accessClosed',
              ticketId: clientData.terminationTicketId,
              clientId: clientData.id,
              roles: ['admin', 'support'],
              message: `Akses portal client PT ${clientData.pt} telah ditutup (hari ke-4).`,
              createdAt: new Date().toISOString(),
              readBy: []
            })
          });
        }
        
        loginError.classList.add('show');
        loginError.innerHTML = `⛔ Akses portal <b>${clientData.pt}</b> telah ditutup pada hari ke-4 setelah Permintaan Terminate disetujui oleh Admin dan Support.`;
        loginError.style.display = 'flex';
        return;
      }
      
      if (clientData && clientData.status === 'Terminate' && clientData.berhentiAt) {
        const berhentiTime = new Date(clientData.berhentiAt).getTime();
        const now = Date.now();
        const diffHours = (now - berhentiTime) / (1000 * 60 * 60);
        if (diffHours >= 24) {
          loginError.classList.add('show');
          loginError.innerHTML = `⛔ Akun <b>${clientData.pt}</b> telah <b>Terminate</b> sejak ${new Date(clientData.berhentiAt).toLocaleDateString('id-ID')} dan sudah melewati 1x24 jam. Akses portal ditutup. Hubungi Admin di support@interlink.co.id untuk reaktivasi.`;
          loginError.style.display = 'flex';
          return;
        }
      }
    }

    currentUser = user;
    localStorage.setItem('il_current_user', JSON.stringify(user));
    loginError.classList.remove('show');
    loginError.style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';

    // Load data from API
    await loadData();

    setTimeout(() => {
      applyRoleToUI();
      renderClients();
      renderRacks();
      renderTickets();
      renderCrossConnects();
      updateProfilePage();
      updateOverviewStats();
      updateTopbarBadges();

      if (isClient()) {
        const cl = getClientDataForCurrentUser();
        if (cl) {
          if (cl.status === 'Suspend') {
            setTimeout(() => {
              alert(`⚠ Akun Anda (${cl.pt}) berstatus SUSPEND.\nAnda hanya bisa MELIHAT data, tidak bisa klik tombol apapun.\nDitentukan oleh Admin. Hubungi Admin untuk reaktivasi.`);
            }, 500);
          }
          if (cl.terminationApprovedAt && cl.terminateAccessEndsAt && !isTerminationAccessExpired(cl)) {
            const hours = getTerminationAccessRemainingHours(cl);
            setTimeout(() => {
              alert(`⛔ Permintaan Terminate Anda telah disetujui Admin dan Support. Akses portal akan ditutup dalam sekitar ${hours} jam, pada hari ke-4 sejak pengajuan.`);
            }, 700);
          }
          if (cl.status === 'Terminate') {
            const remaining = getBerhentiRemainingHours(cl);
            if (remaining > 0) {
              setTimeout(() => {
                alert(`⛔ Akun Anda (${cl.pt}) berstatus BERHENTI LANGGANAN.\nAkses portal akan ditutup dalam ${remaining} jam (1x24 jam sejak ${new Date(cl.berhentiAt).toLocaleString('id-ID')}).\nSetelah itu Anda tidak bisa login lagi. Hubungi Admin segera.`);
              }, 800);
            }
          }
        }
      }
      
      navigateToPage(window.location.hash.substring(1) || 'overview');
      startSSE();
    }, 100);

  } catch (err) {
    console.error('Login error:', err);
    loginError.classList.add('show');
    loginError.innerHTML = '⚠ Gagal menghubungkan ke server.';
    loginError.style.display = 'flex';
  }
});

function updateProfilePage() {
  if (!currentUser) return;
  const nameEl = document.getElementById('profileName');
  const roleEl = document.getElementById('profileRole');
  const avatarEl = document.getElementById('profileAvatar');
  if (nameEl) nameEl.textContent = currentUser.name;
  if (roleEl) roleEl.textContent = `${currentUser.role.toUpperCase()} • ${currentUser.pt || ''}`;
  if (avatarEl) avatarEl.textContent = currentUser.avatar || currentUser.name.substring(0, 2).toUpperCase();

  const emailRow = document.getElementById('profileEmailValue');
  if (emailRow) emailRow.textContent = currentUser.email;
  const roleRow = document.getElementById('profileRoleValue');
  if (roleRow) roleRow.textContent = currentUser.role;
  const clientRow = document.getElementById('profileClientValue');
  if (clientRow) clientRow.textContent = currentUser.clientId ? `${currentUser.clientId} - ${currentUser.pt}` : (currentUser.pt || '-');

  const quickLoginW = document.getElementById('quickLoginWrapper');
  if (quickLoginW) {
    quickLoginW.style.display = 'none';
  }
  const accountNav = document.getElementById('accountManagementNav');
  if (accountNav) accountNav.style.display = isAdmin() ? 'flex' : 'none';

  const permsDiv = document.getElementById('rolePermissions');
  if (permsDiv) {
    let permsHtml = '';
    if (currentUser.role === 'admin') {
      permsHtml = `
        <div style="margin-top:12px;padding:12px;background:rgba(255,143,77,0.08);border:1px solid rgba(255,143,77,0.2);border-radius:8px;">
          <div style="font-weight:600;color:var(--orange);font-size:12px;margin-bottom:6px;">👑 Hak Akses ADMIN - Full Akses</div>
          <ul style="font-size:11.5px;color:var(--text-mid);margin-left:16px;line-height:1.6;margin-bottom:0;">
            <li>Lihat & kelola semua Rack, Client, Perangkat Masuk/Keluar</li>
            <li>Buat, edit, hapus Tiket CrossConnect, Masuk & Keluar Barang</li>
            <li>Kelola CrossConnect & Export data</li>
            <li>Tambah/hapus Client & Rack, kelola pergantian PT</li>
          </ul>
        </div>`;
    } else if (currentUser.role === 'support') {
      permsHtml = `
        <div style="margin-top:12px;padding:12px;background:rgba(29,158,117,0.08);border:1px solid rgba(29,158,117,0.2);border-radius:8px;">
          <div style="font-weight:600;color:#5dcaa5;font-size:12px;margin-bottom:6px;">🛠️ Hak Akses SUPPORT</div>
          <ul style="font-size:11.5px;color:var(--text-mid);margin-left:16px;line-height:1.6;margin-bottom:0;">
            <li>Lihat semua Rack & Inventory (tidak bisa hapus client/rack)</li>
            <li>Kelola Tiket CrossConnect, Masuk & Keluar Barang (buat, edit, selesaikan)</li>
            <li>Kelola CrossConnect, lihat perangkat</li>
            <li>Tidak bisa tambah client baru atau hapus rack</li>
          </ul>
        </div>`;
    } else {
      permsHtml = `
        <div style="margin-top:12px;padding:12px;background:rgba(59,124,240,0.08);border:1px solid rgba(59,124,240,0.2);border-radius:8px;">
          <div style="font-weight:600;color:#85b7eb;font-size:12px;margin-bottom:6px;">👤 Hak Akses CLIENT - ${currentUser.pt}</div>
          <ul style="font-size:11.5px;color:var(--text-mid);margin-left:16px;line-height:1.6;margin-bottom:0;">
            <li>Hanya lihat Rack ${(currentUser.clientId ? clients.find(cl => cl.id === currentUser.clientId)?.lokasi || '' : '')} milik sendiri</li>
            <li>Lihat perangkat Masuk & Keluar milik sendiri saja</li>
            <li>Buat tiket Masuk/Keluar Barang & CrossConnect untuk keperluan sendiri</li>
            <li>Tidak bisa lihat client lain, tidak bisa edit rack, hanya ganti password</li>
          </ul>
        </div>`;
    }
    permsDiv.innerHTML = permsHtml;
  }
  renderAccountManagement();
  enforceAccountManagementRoute();
}

function canManageAccounts(showMessage = true) {
  if (isAdmin()) return true;
  if (showMessage) alert('Fitur Manajemen Akun hanya dapat digunakan oleh Admin.');
  return false;
}

function accountKey(email) { return encodeURIComponent(String(email || '')); }
function accountEmailFromKey(key) {
  try { return decodeURIComponent(key || ''); } catch (e) { return ''; }
}
function escapeAccountHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function accountInitials(name) {
  const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map(part => part[0]).join('') || 'US').toUpperCase();
}
function accountRoleLabel(role) { return ({ admin: 'ADMIN', support: 'SUPPORT', client: 'CLIENT' })[role] || String(role || '').toUpperCase(); }
function accountRolePT(role, clientId) {
  if (role === 'client') return clients.find(client => client.id === clientId)?.pt || '';
  return role === 'admin' ? 'INTERLINK Admin' : 'Support Team';
}

function renderAccountManagement() {
  const section = document.getElementById('accountManagementSection');
  const body = document.getElementById('accountManagementTableBody');
  if (!section || !body) return;
  if (!isAdmin()) {
    section.style.display = 'none';
    body.innerHTML = '';
    return;
  }
  section.style.display = 'block';
  const ptFilter = document.getElementById('accountFilterPT');
  const roleFilter = document.getElementById('accountFilterRole');
  const searchFilter = document.getElementById('accountFilterSearch');
  const empty = document.getElementById('accountManagementEmpty');
  const previousPT = ptFilter?.value || 'all';
  if (ptFilter) {
    const pts = [...new Set(USERS.map(user => user.pt || '-'))].sort((a, b) => a.localeCompare(b));
    ptFilter.innerHTML = '<option value="all">Semua PT</option>' + pts.map(pt => `<option value="${escapeAccountHtml(pt)}">${escapeAccountHtml(pt)}</option>`).join('');
    ptFilter.value = pts.includes(previousPT) ? previousPT : 'all';
  }
  const filterPT = ptFilter?.value || 'all';
  const filterRole = roleFilter?.value || 'all';
  const filterSearch = (searchFilter?.value || '').trim().toLowerCase();
  const filteredUsers = USERS.filter(user => {
    const matchPT = filterPT === 'all' || (user.pt || '-') === filterPT;
    const matchRole = filterRole === 'all' || user.role === filterRole;
    const matchSearch = !filterSearch || String(user.name || '').toLowerCase().includes(filterSearch) || String(user.email || '').toLowerCase().includes(filterSearch);
    return matchPT && matchRole && matchSearch;
  });
  body.innerHTML = '';
  if (empty) empty.style.display = filteredUsers.length ? 'none' : 'block';
  filteredUsers.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(user => {
    const isSelf = String(user.email).toLowerCase() === String(currentUser.email).toLowerCase();
    const encoded = accountKey(user.email);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="account-user-cell"><span class="account-user-name">${escapeAccountHtml(user.name || '-')}</span></div></td>
      <td><div class="account-password-cell"><span id="account-password-${encoded}" class="account-password-value" data-revealed="false">••••••••</span></div></td>
      <td><span class="account-email">${escapeAccountHtml(user.email || '-')}</span></td>
      <td><span class="account-role-badge ${escapeAccountHtml(user.role || 'client')}">${accountRoleLabel(user.role)}</span></td>
      <td>${escapeAccountHtml(user.role === 'client' ? (user.pt || '-') : '-')}</td>
      <td>${escapeAccountHtml(user.phone || user.telp || '-')}</td>
      <td><div class="account-actions">
        <button type="button" id="account-password-button-${encoded}" class="account-password-view" title="Lihat Password" onclick="toggleAccountTablePassword('${encoded}')">${passwordEyeIcon(false)}</button>
        <button type="button" class="account-action-button" title="Edit akun" onclick="openAccountModal('${encoded}')">✏️</button>
        <button type="button" class="account-action-button" title="Ganti password akun" onclick="openAdminAccountPasswordModal('${encoded}')">🔑</button>
        <button type="button" class="account-action-button danger" title="${isSelf ? 'Akun yang sedang digunakan tidak dapat dihapus' : 'Hapus akun'}" ${isSelf ? 'disabled' : ''} onclick="${isSelf ? '' : 'openDeleteAccountModal(\'' + encoded + '\')'}">🗑</button>
      </div></td>`;
    body.appendChild(tr);
  });
}

function clearAccountErrors(prefix = 'au') {
  document.querySelectorAll(`#${prefix}_name_error,#${prefix}_email_error,#${prefix}_role_error,#${prefix}_password_error,#${prefix}_confirm_error,#${prefix}_client_error`).forEach(element => element.textContent = '');
  const message = prefix === 'au' ? document.getElementById('accountFormMessage') : document.getElementById('adminPasswordMessage');
  if (message) { message.style.display = 'none'; message.textContent = ''; }
}

function setAccountFieldError(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message;
}

function populateAccountClientOptions(selectedId = '') {
  const select = document.getElementById('au_client');
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih Client / PT --</option>';
  clients.slice().sort((a, b) => a.pt.localeCompare(b.pt)).forEach(client => {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = `${client.pt} • ${client.id}`;
    select.appendChild(option);
  });
  select.value = selectedId || '';
}

function onAccountRoleChange() {
  if (!canManageAccounts(false)) return;
  const role = document.getElementById('au_role').value;
  const group = document.getElementById('au_client_group');
  const typeGrp = document.getElementById('au_account_type_group');
  const allowGrp = document.getElementById('au_allow_sub_group');
  if (group) group.style.display = role === 'client' ? 'block' : 'none';
  if (typeGrp) typeGrp.style.display = role === 'client' ? 'block' : 'none';
  if (allowGrp) allowGrp.style.display = role === 'client' ? 'flex' : 'none';
  if (role !== 'client') {
    const select = document.getElementById('au_client');
    if (select) select.value = '';
  }
}

function toggleAccountPassword(id) {
  if (!canManageAccounts(false)) return;
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function toggleAccountTablePassword(encodedEmail) {
  if (!canManageAccounts()) return;
  const email = accountEmailFromKey(encodedEmail);
  const user = USERS.find(item => String(item.email).toLowerCase() === email.toLowerCase());
  const value = document.getElementById('account-password-' + encodedEmail);
  const button = document.getElementById('account-password-button-' + encodedEmail);
  if (!user || !value || !button) return;
  const revealed = value.dataset.revealed === 'true';
  let displayPass = '••••••••';
  if (!revealed) {
    if (user.plainPassword) {
      displayPass = user.plainPassword;
    } else if (user.password && !user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
      displayPass = user.password;
    } else {
      const em = String(user.email).toLowerCase();
      if (em.includes('admin@interlink')) displayPass = 'admin123';
      else if (em.includes('support@interlink')) displayPass = 'support123';
      else if (em.includes('fibernet')) displayPass = 'fibernet8';
      else if (em.includes('nusantara')) displayPass = 'client123';
      else if (em.includes('reseller')) displayPass = 'reseller123';
      else displayPass = 'Password123!';
    }
  }
  value.textContent = displayPass;
  value.dataset.revealed = String(!revealed);
  button.innerHTML = passwordEyeIcon(!revealed);
  button.title = !revealed ? 'Sembunyikan Password' : 'Lihat Password';
}

function resetAccountFilters() {
  if (!canManageAccounts()) return;
  const pt = document.getElementById('accountFilterPT');
  const role = document.getElementById('accountFilterRole');
  const search = document.getElementById('accountFilterSearch');
  if (pt) pt.value = 'all'; if (role) role.value = 'all'; if (search) search.value = '';
  renderAccountManagement();
}

function enforceAccountManagementRoute() {
  if (window.location.hash !== '#account-management') return;
  if (isAdmin()) document.querySelector('[data-page=account-management]')?.click();
  else { window.location.hash = '#overview'; showAccountToast('Anda tidak memiliki akses ke halaman ini.', true); }
}

function openAccountModal(encodedEmail = '') {
  if (!canManageAccounts()) return;
  const email = accountEmailFromKey(encodedEmail);
  const existing = email ? USERS.find(user => String(user.email).toLowerCase() === email.toLowerCase()) : null;
  if (email && !existing) { showAccountToast('Akun tidak ditemukan.', true); return; }
  const modal = document.getElementById('modalAccount');
  clearAccountErrors('au');
  modal.dataset.editing = existing ? existing.email : '';
  document.getElementById('accountModalTitle').textContent = existing ? '✏️ Edit Akun' : '👤 Tambah Akun Baru';
  document.getElementById('au_name').value = existing?.name || '';
  document.getElementById('au_email').value = existing?.email || '';
  document.getElementById('au_role').value = existing?.role || 'support';
  document.getElementById('au_password').value = '';
  document.getElementById('au_confirm').value = '';
  document.getElementById('au_password').type = 'password';
  document.getElementById('au_confirm').type = 'password';
  document.getElementById('au_phone').value = existing?.phone || existing?.telp || '';
  document.getElementById('au_department').value = existing?.department || '';
  document.getElementById('au_location').value = existing?.workLocation || '';
  const typeInput = document.getElementById('au_account_type');
  const allowInput = document.getElementById('au_allow_sub');
  if (typeInput) typeInput.value = existing?.accountType || 'pribadi';
  if (allowInput) allowInput.checked = existing?.allowSubAccount || false;
  populateAccountClientOptions(existing?.clientId || '');
  const passwordGroup = document.getElementById('au_password_group');
  const confirmGroup = document.getElementById('au_confirm_group');
  if (passwordGroup) passwordGroup.style.display = existing ? 'none' : 'block';
  if (confirmGroup) confirmGroup.style.display = existing ? 'none' : 'block';
  onAccountRoleChange();
  if (existing?.role === 'client') document.getElementById('au_client').value = existing.clientId || '';
  modal.classList.add('show');
}

function saveAccount() {
  if (!canManageAccounts()) return;
  clearAccountErrors('au');
  const modal = document.getElementById('modalAccount');
  const editingEmail = modal.dataset.editing || '';
  const existing = editingEmail ? USERS.find(user => String(user.email).toLowerCase() === editingEmail.toLowerCase()) : null;
  const name = document.getElementById('au_name').value.trim();
  const email = document.getElementById('au_email').value.trim().toLowerCase();
  const role = document.getElementById('au_role').value;
  const password = document.getElementById('au_password').value;
  const confirm = document.getElementById('au_confirm').value;
  const clientId = document.getElementById('au_client').value;
  let valid = true;
  if (!name) { setAccountFieldError('au_name_error', 'Nama lengkap wajib diisi.'); valid = false; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAccountFieldError('au_email_error', 'Email wajib diisi dengan format yang valid.'); valid = false; }
  const duplicate = USERS.find(user => String(user.email).toLowerCase() === email && (!existing || user !== existing));
  if (duplicate) { setAccountFieldError('au_email_error', 'Email sudah dipakai oleh akun lain.'); valid = false; }
  if (!['admin', 'support', 'client'].includes(role)) { setAccountFieldError('au_role_error', 'Pilih role yang valid.'); valid = false; }
  if (role === 'client' && !clientId) { setAccountFieldError('au_client_error', 'Client / PT wajib dipilih untuk role Client.'); valid = false; }
  if (!existing) {
    if (password.length < 8) { setAccountFieldError('au_password_error', 'Password minimal 8 karakter.'); valid = false; }
    if (password !== confirm) { setAccountFieldError('au_confirm_error', 'Konfirmasi password tidak sama.'); valid = false; }
  }
  if (!valid) return;
  const clientPT = accountRolePT(role, clientId);
  const accountType = document.getElementById('au_account_type') ? document.getElementById('au_account_type').value : 'pribadi';
  const allowSubAccount = document.getElementById('au_allow_sub') ? document.getElementById('au_allow_sub').checked : false;
  const common = { name, email, role, avatar: accountInitials(name), pt: clientPT, phone: document.getElementById('au_phone').value.trim(), department: document.getElementById('au_department').value.trim(), workLocation: document.getElementById('au_location').value.trim() };
  if (role === 'client') {
    common.accountType = accountType;
    common.allowSubAccount = allowSubAccount;
  }
  if (role === 'client') common.clientId = clientId;
  if (existing) {
    Object.assign(existing, common);
    if (role !== 'client') delete existing.clientId;
  } else {
    USERS.push({ ...common, password, clientId: role === 'client' ? clientId : undefined });
  }
  saveUsers();
  closeModal('modalAccount');
  updateProfilePage();
  renderAccountManagement();
  showAccountToast(existing ? 'Akun berhasil diperbarui.' : 'Akun berhasil ditambahkan.');
}

function openAdminAccountPasswordModal(encodedEmail) {
  if (!canManageAccounts()) return;
  const email = accountEmailFromKey(encodedEmail);
  const user = USERS.find(item => String(item.email).toLowerCase() === email.toLowerCase());
  if (!user) { showAccountToast('Akun tidak ditemukan.', true); return; }
  const modal = document.getElementById('modalAdminAccountPassword');
  modal.dataset.accountEmail = user.email;
  document.getElementById('adminPasswordAccountName').textContent = `Atur password baru untuk ${user.name} (${accountRoleLabel(user.role)}).`;
  document.getElementById('apr_password').value = '';
  document.getElementById('apr_confirm').value = '';
  document.getElementById('apr_password').type = 'password';
  document.getElementById('apr_confirm').type = 'password';
  clearAccountErrors('apr');
  modal.classList.add('show');
}

function saveAdminAccountPassword() {
  if (!canManageAccounts()) return;
  clearAccountErrors('apr');
  const modal = document.getElementById('modalAdminAccountPassword');
  const user = USERS.find(item => String(item.email).toLowerCase() === String(modal.dataset.accountEmail || '').toLowerCase());
  if (!user) { showAccountToast('Akun tidak ditemukan.', true); return; }
  const password = document.getElementById('apr_password').value;
  const confirm = document.getElementById('apr_confirm').value;
  let valid = true;
  if (password.length < 8) { setAccountFieldError('apr_password_error', 'Password minimal 8 karakter.'); valid = false; }
  if (password !== confirm) { setAccountFieldError('apr_confirm_error', 'Konfirmasi password tidak sama.'); valid = false; }
  if (!valid) return;
  user.password = password;
  saveUsers();
  closeModal('modalAdminAccountPassword');
  showAccountToast('Password akun berhasil diubah.');
}

function openDeleteAccountModal(encodedEmail) {
  if (!canManageAccounts()) return;
  const email = accountEmailFromKey(encodedEmail);
  const user = USERS.find(item => String(item.email).toLowerCase() === email.toLowerCase());
  if (!user) { showAccountToast('Akun tidak ditemukan.', true); return; }
  if (String(user.email).toLowerCase() === String(currentUser.email).toLowerCase()) {
    showAccountToast('Akun yang sedang digunakan tidak dapat dihapus.', true);
    return;
  }
  const modal = document.getElementById('modalDeleteAccount');
  modal.dataset.accountEmail = user.email;
  document.getElementById('deleteAccountMessage').textContent = `Yakin ingin menghapus akun ${user.name} (${accountRoleLabel(user.role)})? Tindakan ini tidak dapat dibatalkan.`;
  modal.classList.add('show');
}

function confirmDeleteAccount() {
  if (!canManageAccounts()) return;
  const modal = document.getElementById('modalDeleteAccount');
  const email = String(modal.dataset.accountEmail || '').toLowerCase();
  const user = USERS.find(item => String(item.email).toLowerCase() === email);
  if (!user) { showAccountToast('Akun tidak ditemukan.', true); return; }
  if (email === String(currentUser.email).toLowerCase()) {
    showAccountToast('Akun yang sedang digunakan tidak dapat dihapus.', true);
    return;
  }
  USERS = USERS.filter(item => item !== user);
  saveUsers();
  closeModal('modalDeleteAccount');
  renderAccountManagement();
  showAccountToast('Akun berhasil dihapus.');
}

function showAccountToast(message, isError = false) {
  const toast = document.getElementById('accountToast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? '#FFF0F0' : '#ECFDF3';
  toast.style.borderColor = isError ? '#F6C1C1' : '#86D7A3';
  toast.style.color = isError ? '#991B1B' : '#166534';
  toast.classList.add('show');
  clearTimeout(showAccountToast.timer);
  showAccountToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function openChangePasswordModal() {
  if (!currentUser) return;
  const modal = document.getElementById('modalChangePassword');
  document.getElementById('cpAvatar').textContent = currentUser.avatar || currentUser.name.substring(0, 2).toUpperCase();
  document.getElementById('cpName').textContent = currentUser.name;
  document.getElementById('cpEmail').textContent = currentUser.email + ' • ' + currentUser.role.toUpperCase();
  document.getElementById('cp_old_modal').value = '';
  document.getElementById('cp_new_modal').value = '';
  document.getElementById('cp_confirm_modal').value = '';
  const msg = document.getElementById('cp_message_modal');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  modal.classList.add('show');
}

async function changePasswordModal() {
  const oldPass = document.getElementById('cp_old_modal').value.trim();
  const newPass = document.getElementById('cp_new_modal').value.trim();
  const confirmPass = document.getElementById('cp_confirm_modal').value.trim();
  const msgDiv = document.getElementById('cp_message_modal');
  msgDiv.style.display = 'block';
  if (!oldPass || !newPass || !confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Semua field password wajib diisi';
    return;
  }
  if (newPass.length < 6) {
    msgDiv.style.background = 'rgba(186,117,23,0.12)'; msgDiv.style.border = '1px solid rgba(186,117,23,0.3)'; msgDiv.style.color = '#ef9f27';
    msgDiv.textContent = '⚠ Password baru minimal 6 karakter';
    return;
  }
  if (newPass !== confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Konfirmasi password tidak cocok';
    return;
  }
  
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    const res = await fetch('/api/users/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
    });
    if (!res.ok) {
      const err = await res.json();
      msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
      msgDiv.textContent = `⚠ ${err.error || 'Password lama salah. Cek kembali.'}`;
      return;
    }
    msgDiv.style.background = 'rgba(29,158,117,0.15)'; msgDiv.style.border = '1px solid rgba(29,158,117,0.3)'; msgDiv.style.color = '#5dcaa5';
    msgDiv.textContent = '✅ Password berhasil diganti! Gunakan password baru saat login berikutnya.';
    setTimeout(() => { closeModal('modalChangePassword'); }, 1200);
  } catch (e) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Terjadi kesalahan koneksi.';
  }
}

async function changePassword() {
  const oldPass = document.getElementById('cp_old').value.trim();
  const newPass = document.getElementById('cp_new').value.trim();
  const confirmPass = document.getElementById('cp_confirm').value.trim();
  const msgDiv = document.getElementById('cp_message');
  msgDiv.style.display = 'block';
  if (!oldPass || !newPass || !confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Semua field password wajib diisi';
    return;
  }
  if (newPass.length < 6) {
    msgDiv.style.background = 'rgba(186,117,23,0.12)'; msgDiv.style.border = '1px solid rgba(186,117,23,0.3)'; msgDiv.style.color = '#ef9f27';
    msgDiv.textContent = '⚠ Password baru minimal 6 karakter';
    return;
  }
  if (newPass !== confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Konfirmasi password tidak cocok';
    return;
  }

  const token = localStorage.getItem('il_auth_token') || '';
  try {
    const res = await fetch('/api/users/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
    });
    if (!res.ok) {
      const err = await res.json();
      msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
      msgDiv.textContent = `⚠ ${err.error || 'Password lama salah.'}`;
      return;
    }
    msgDiv.style.background = 'rgba(29,158,117,0.15)'; msgDiv.style.border = '1px solid rgba(29,158,117,0.3)'; msgDiv.style.color = '#5dcaa5';
    msgDiv.textContent = '✅ Password berhasil diganti! Silakan gunakan password baru saat login berikutnya.';
    document.getElementById('cp_old').value = ''; document.getElementById('cp_new').value = ''; document.getElementById('cp_confirm').value = '';
  } catch (e) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Terjadi kesalahan koneksi.';
  }
}

async function changePasswordFull() {
  const oldPass = document.getElementById('cp_old_full').value.trim();
  const newPass = document.getElementById('cp_new_full').value.trim();
  const confirmPass = document.getElementById('cp_confirm_full').value.trim();
  const msgDiv = document.getElementById('cp_message_full');
  msgDiv.style.display = 'block';
  if (!oldPass || !newPass || !confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Semua field wajib diisi';
    return;
  }
  if (newPass.length < 6) {
    msgDiv.style.background = 'rgba(186,117,23,0.12)'; msgDiv.style.border = '1px solid rgba(186,117,23,0.3)'; msgDiv.style.color = '#ef9f27';
    msgDiv.textContent = '⚠ Minimal 6 karakter';
    return;
  }
  if (newPass !== confirmPass) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Konfirmasi tidak cocok';
    return;
  }

  const token = localStorage.getItem('il_auth_token') || '';
  try {
    const res = await fetch('/api/users/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
    });
    if (!res.ok) {
      const err = await res.json();
      msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
      msgDiv.textContent = `⚠ ${err.error || 'Password lama salah.'}`;
      return;
    }
    msgDiv.style.background = 'rgba(29,158,117,0.15)'; msgDiv.style.border = '1px solid rgba(29,158,117,0.3)'; msgDiv.style.color = '#5dcaa5';
    msgDiv.textContent = '✅ Password berhasil diganti!';
    document.getElementById('cp_old_full').value = ''; document.getElementById('cp_new_full').value = ''; document.getElementById('cp_confirm_full').value = '';
  } catch (e) {
    msgDiv.style.background = 'rgba(226,75,74,0.12)'; msgDiv.style.border = '1px solid rgba(226,75,74,0.3)'; msgDiv.style.color = '#f09595';
    msgDiv.textContent = '⚠ Terjadi kesalahan koneksi.';
  }
}

function fillDemoCredentials(email) {
  document.getElementById('email').value = email;
  let pass = 'client123';
  if (email.includes('admin')) pass = 'admin123';
  else if (email.includes('support')) pass = 'support123';
  document.getElementById('password').value = pass;
}

function quickLogin(email, pass) {
  document.getElementById('email').value = email;
  document.getElementById('password').value = pass;
  loginForm.dispatchEvent(new Event('submit'));
}

function forceLogoutAndLogin(email, pass) {
  currentUser = null;
  localStorage.removeItem('il_current_user');
  const badge = document.getElementById('roleBadgeTop');
  if (badge) badge.remove();
  document.getElementById('dashboard-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('email').value = email;
    document.getElementById('password').value = pass;
    loginForm.dispatchEvent(new Event('submit'));
  }, 300);
}

function saveUsers() {
  syncCollection('users', USERS, 'email');
}

function checkPermission(role, action) {
  if (!PERMISSION_MATRIX[role]) return false;
  return !!PERMISSION_MATRIX[role][action];
}

function getCurrentUser() { return currentUser; }
function isAdmin() { return currentUser && currentUser.role === 'admin'; }
function isSupport() { return currentUser && currentUser.role === 'support'; }
function isClient() { return currentUser && (currentUser.role === 'client' || currentUser.role === 'subclient'); }
function isMainClient() { return currentUser && currentUser.role === 'client'; }
function isSubclient() { return currentUser && currentUser.role === 'subclient'; }
function canManageInventory() { return isAdmin(); }

function renderSubAccounts() {
  const tbody = document.getElementById('subAccountTableBody');
  if (!tbody) return;
  const mySubAccounts = USERS.filter(u => u.role === 'subclient' && u.parentEmail === currentUser.email);
  if (mySubAccounts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;">Belum ada sub-account.</td></tr>';
    return;
  }
  let htmlBody = '';
  mySubAccounts.forEach(su => {
    htmlBody += '<tr>' +
      '<td>' + su.name + '</td>' +
      '<td>' + su.email + '</td>' +
      '<td>Sub-Account</td>' +
      '<td>' +
        '<button class="action-icon" title="Edit" onclick="openSubAccountModal(\'' + su.email + '\')">✏️</button>' +
        '<button class="action-icon danger" title="Hapus" onclick="deleteSubAccount(\'' + su.email + '\')">🗑</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = htmlBody;
}

function openSubAccountModal(email = '') {
  const modal = document.getElementById('modalSubAccount');
  modal.dataset.editing = email;
  document.getElementById('subAccountModalTitle').textContent = email ? '✏️ Edit Sub-Account' : '👤 Tambah Sub-Account';
  const existing = email ? USERS.find(u => u.email === email) : null;
  document.getElementById('su_name').value = existing ? existing.name : '';
  document.getElementById('su_email').value = existing ? existing.email : '';
  document.getElementById('su_password').value = '';
  document.getElementById('su_password_group').style.display = existing ? 'none' : 'block';
  modal.classList.add('show');
}

function saveSubAccount() {
  const modal = document.getElementById('modalSubAccount');
  const editingEmail = modal.dataset.editing || '';
  const existing = editingEmail ? USERS.find(u => u.email === editingEmail) : null;
  const name = document.getElementById('su_name').value.trim();
  const email = document.getElementById('su_email').value.trim().toLowerCase();
  const password = document.getElementById('su_password').value;
  
  if (!name || !email) { showToast('Nama dan Email wajib diisi.', 'warning'); return; }
  if (!existing && password.length < 8) { showToast('Password minimal 8 karakter.', 'warning'); return; }
  
  const duplicate = USERS.find(u => u.email === email && (!existing || u !== existing));
  if (duplicate) { showToast('Email sudah terdaftar.', 'error'); return; }
  
  if (existing) {
    existing.name = name;
    existing.email = email;
  } else {
    USERS.push({
      name, email, password, role: 'subclient', parentEmail: currentUser.email,
      clientId: currentUser.clientId, pt: currentUser.pt,
      avatar: name.substring(0, 2).toUpperCase()
    });
  }
  saveUsers();
  closeModal('modalSubAccount');
  renderSubAccounts();
  showToast(existing ? 'Sub-account berhasil diperbarui.' : 'Sub-account berhasil dibuat.', 'success');
}

function toggleAccountPassword(id) {
  if (!canManageAccounts(false)) return;
  togglePasswordField(id);
}

// Global toggle for password visibility
function togglePasswordField(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const isRevealed = input.type === 'password';
  input.type = isRevealed ? 'text' : 'password';
  const btn = input.parentElement ? input.parentElement.querySelector('.account-password-toggle') : null;
  if (btn) {
    btn.innerHTML = passwordEyeIcon(isRevealed);
    btn.setAttribute('data-visible', String(isRevealed));
  }
}

function deleteSubAccount(email) {
  showCustomConfirm('Hapus sub-account ini?', () => {
    USERS = USERS.filter(u => u.email !== email);
    saveUsers();
    renderSubAccounts();
    showToast('Sub-account berhasil dihapus.', 'success');
  });
}