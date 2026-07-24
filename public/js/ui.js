function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
if (typeof window !== 'undefined') window.escapeHtml = escapeHtml;

function makeLines(container){

  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 1200 500"); svg.setAttribute("preserveAspectRatio","none");
  const paths = [
    {d:"M0,180 C200,100 400,260 600,190 S1000,90 1200,160", c:"#2fc2d8"},
    {d:"M0,260 C220,340 420,150 640,260 S1000,340 1200,240", c:"#ff8f4d"},
    {d:"M0,340 C240,280 460,380 680,300 S1020,220 1200,320", c:"#3b7cf0"}
  ];
  paths.forEach((p,i)=>{
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",p.d); path.setAttribute("class","line-path"); path.setAttribute("stroke",p.c); path.setAttribute("stroke-dasharray","6 10");
    path.style.animation = `dashMove ${14 + i*3}s linear infinite`; svg.appendChild(path);
  });
  container.appendChild(svg);
}

function updateClock(){
  const now = new Date();
  const opts = {timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false};
  const timeStr = new Intl.DateTimeFormat('en-GB', opts).format(now);
  const dateOpts = {timeZone:'Asia/Jakarta', weekday:'long', day:'numeric', month:'long', year:'numeric'};
  let dateStr = new Intl.DateTimeFormat('id-ID', dateOpts).format(now);
  document.getElementById('clock-time').textContent = timeStr;
  document.getElementById('clock-date').textContent = dateStr;
}

function closeModal(id){
  const el = document.getElementById(id);
  if(!el || !el.classList.contains('show')) return;
  el.classList.add('closing');
  setTimeout(() => {
    el.classList.remove('show');
    el.classList.remove('closing');
  }, 250);
}

function openTopbarModal(type){
  const modal = document.getElementById('modalTopbarInfo');
  const titleEl = document.getElementById('topbarInfoTitle');
  const bodyEl = document.getElementById('topbarInfoBody');
  if(!modal || !titleEl || !bodyEl) return;

  const card = modal.querySelector('.modal-card');
  if (card) {
    if (type === 'notifications') {
      card.style.maxWidth = '860px';
      card.style.width = '95%';
    } else {
      card.style.maxWidth = '420px';
      card.style.width = '';
    }
  }

  if(type==='contact'){
    titleEl.textContent = '📱 Kontak & Support';
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:rgba(59,124,240,0.08);border:1px solid rgba(59,124,240,0.2);border-radius:10px;padding:12px;">
          <div style="font-weight:600;color:#fff;margin-bottom:6px;">🆘 Bantuan Darurat Data Center</div>
          <div style="font-size:12.5px;color:var(--text-mid);line-height:1.5;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span>📞 Hotline NOC</span><b style="color:#fff;">+62 21-1234-5678</b></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span>✉ Email Support</span><b style="color:#fff;">support@interlink.co.id</b></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;"><span>💬 WhatsApp</span><b style="color:#fff;">+62 812-xxxx-xxxx</b></div>
          </div>
        </div>
        <div style="background:rgba(29,158,117,0.08);border:1px solid rgba(29,158,117,0.2);border-radius:10px;padding:12px;">
          <div style="font-weight:600;color:#5dcaa5;margin-bottom:4px;font-size:12px;">⏰ Jam Operasional</div>
          <div style="font-size:12px;color:var(--text-mid);">NOC 24/7 • On-site Operasional 08:00-17:00 WIB • Smart Hands 24/7</div>
        </div>
        
      </div>
    `;
  }else if(type==='notifications'){
    titleEl.textContent='🔔 Notifikasi & Aktivitas';
    if(!currentUser) return;
    let items = [];

    const dismissedSet = typeof getDismissedNotificationIds === 'function' ? getDismissedNotificationIds() : new Set();

    // 1. Termination notifications
    let tNotifs = Array.isArray(window.terminationNotifications) ? window.terminationNotifications : [];
    if (isAdmin() || isSupport()) {
      tNotifs = tNotifs.filter(n => n.roles?.includes(currentUser.role));
    } else if (isClient()) {
      tNotifs = tNotifs.filter(n => n.clientId === currentUser.clientId);
    }
    tNotifs.forEach(n => {
      const itemId = n.id || ('term_' + n.ticketId);
      if (!dismissedSet.has(itemId) && (!n.ticketId || !dismissedSet.has('ticket_' + n.ticketId))) {
        items.push({
          id: itemId,
          ticketId: n.ticketId,
          message: n.message,
          createdAt: n.createdAt || new Date().toISOString(),
          readBy: n.readBy || [],
          type: 'Terminate'
        });
      }
    });

    // 2. Tickets notifications for all roles
    let eligibleTickets = typeof tickets !== 'undefined' ? tickets : [];
    if (isClient()) {
      eligibleTickets = eligibleTickets.filter(t => t.clientId === currentUser.clientId || (currentUser.pt && (t.pt||'').toLowerCase().trim() === (currentUser.pt||'').toLowerCase().trim()) || (t.createdBy||'').toLowerCase() === (currentUser.name||'').toLowerCase());
    }

    eligibleTickets.forEach(t => {
      const itemId = 'ticket_' + t.id;
      if (dismissedSet.has(itemId)) return;

      let msg = '';
      const byApprove = t.approvedBy ? ` oleh ${t.approvedBy}` : '';
      const byComplete = t.completedBy ? ` oleh ${t.completedBy}` : '';
      if (t.status === 'Menunggu Approval') {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) dari ${t.pt||'Klien'} membutuhkan approval.`;
      } else if (t.status === 'Diproses') {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) sedang diproses tim Interlink.`;
      } else if (t.status === 'Disetujui') {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) telah disetujui${byApprove}.`;
      } else if (t.status === 'Selesai') {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) telah diselesaikan${byComplete}.`;
      } else if (t.status === 'Dibatalkan') {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) telah dibatalkan.`;
      } else {
        msg = `Tiket ${t.type} "#${t.id}" (${t.title}) - status: ${t.status}.`;
      }

      items.push({
        id: itemId,
        ticketId: t.id,
        message: msg,
        createdAt: t.createdAt || t.date || new Date().toISOString(),
        readBy: [],
        type: t.type,
        status: t.status
      });
    });

    // Deduplicate items by ticketId
    const seenTicketIds = new Set();
    const finalItems = [];
    // Sort strictly by newest timestamp first
    items.sort((a, b) => {
      const ta = typeof getTicketTimestamp === 'function' ? (getTicketTimestamp(tickets?.find(t=>t.id===a.ticketId)) || new Date(a.createdAt || 0).getTime()) : new Date(a.createdAt || 0).getTime();
      const tb = typeof getTicketTimestamp === 'function' ? (getTicketTimestamp(tickets?.find(t=>t.id===b.ticketId)) || new Date(b.createdAt || 0).getTime()) : new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
    items.forEach(it => {
      if (it.ticketId && !seenTicketIds.has(it.ticketId)) {
        seenTicketIds.add(it.ticketId);
        finalItems.push(it);
      }
    });

    window._currentModalNotifItems = finalItems;

    const markReadTime = parseInt(localStorage.getItem('il_notif_mark_read_' + (currentUser.email || 'user')) || '0', 10);
    const displayItems = finalItems.slice(0, 30);
    const safe = (value) => String(value||'').replace(/[&<>]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[char]));

    bodyEl.innerHTML = displayItems.length ? `
      <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:12px;gap:8px;">
        <button type="button" class="page-action secondary" style="height:28px;font-size:11px;padding:0 10px;border-radius:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-mid);cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="markAllNotificationsAsRead()">✓ Tandai semua dibaca</button>
        <button type="button" class="page-action secondary" style="height:28px;font-size:11px;padding:0 10px;border-radius:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="clearAllNotifications()">🗑️ Hapus Semua</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${displayItems.map(item => {
          const itemTime = new Date(item.createdAt || 0).getTime();
          const isUnread = itemTime > markReadTime;
          const bg = isUnread ? 'rgba(59,124,240,0.05)' : 'rgba(255,255,255,0.02)';
          const border = isUnread ? '1px solid rgba(59,124,240,0.22)' : '1px solid var(--border)';
          const pulseDot = isUnread ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444;margin-left:auto;flex-shrink:0;"></span>' : '';
          
          const tk = tickets.find(t=>t.id===item.ticketId);
          const tType = item.type || (tk ? tk.type : '');
          const ptName = tk && tk.pt ? tk.pt : '';
          
          let icon = '🔔';
          let accent = 'var(--text-dim)';
          if (tType === 'Masuk Barang') { icon = '📥'; accent = 'var(--blue)'; }
          else if (tType === 'Keluar Barang') { icon = '📤'; accent = 'var(--orange)'; }
          else if (tType === 'CrossConnect') { icon = '🔗'; accent = 'var(--cyan)'; }
          else if (tType === 'Terminate' || (item.message||'').includes('Terminate') || (item.message||'').includes('terminate')) { icon = '⛔'; accent = 'var(--red)'; }
          
          const hoverBg = isUnread ? 'rgba(59,124,240,0.09)' : 'rgba(255,255,255,0.05)';
          const hoverBorder = isUnread ? '1px solid rgba(59,124,240,0.35)' : '1px solid rgba(255,255,255,0.1)';
          
          return `<button type="button" class="notification-ticket-item" data-ticket-id="${safe(item.ticketId)}" onclick="openNotificationTicket('${safe(item.ticketId)}')" 
            onmouseenter="this.style.background='${hoverBg}'; this.style.borderColor='${hoverBorder}';" 
            onmouseleave="this.style.background='${bg}'; this.style.borderColor='${isUnread ? 'rgba(59,124,240,0.22)' : 'var(--border)'}';"
            style="width:100%;text-align:left;padding:14px 16px;border-radius:10px;background:${bg};border:${border};border-left:4px solid ${accent};color:inherit;cursor:pointer;transition:all 0.2s ease;display:flex;gap:14px;align-items:flex-start;">
            <div style="font-size:18px;background:rgba(255,255,255,0.04);width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,255,255,0.05);color:#fff;">${icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12.5px;color:#fff;line-height:1.5;font-weight:500;margin-bottom:6px;">${safe(item.message)}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font:10.5px var(--font-mono);color:var(--text-dim);">
                <span>📅 ${new Date(item.createdAt).toLocaleString('id-ID')} ${ptName ? `• <strong style="color:var(--text-mid);">${safe(ptName)}</strong>` : ''} • <strong style="color:var(--text-mid);">${safe(item.ticketId)}</strong></span>
                <span style="color:var(--cyan);white-space:nowrap;font-weight:600;font-size:11px;">Buka Ticket →</span>
              </div>
            </div>
            ${pulseDot}
          </button>`;
        }).join('')}
      </div>` : '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;">📭 Belum ada notifikasi atau aktivitas baru.</div>';
  }else if(type==='racks'){
    titleEl.textContent = '⚡ Info Racks';
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div class="mini-stat" style="width:100%;"><div class="ms-label">Total Rack</div><div class="ms-value">${racks.length}</div></div>
        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
          ${racks.map(r=>`<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;"><span>${r.id} - ${r.lokasi}</span><span style="color:var(--text-dim);">${r.u||'42U'}</span></div>`).join('')}
        </div>
        <button class="page-action" style="width:100%;justify-content:center;" onclick="closeModal('modalTopbarInfo'); document.querySelector('[data-page=racks]').click();">🗄 Lihat Detail Racks</button>
      </div>
    `;
  }
  modal.classList.add('show');
}

function getDismissedNotificationIds() {
  if (typeof currentUser === 'undefined' || !currentUser) return new Set();
  const key = 'il_dismissed_notifs_' + (currentUser.email || 'user');
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}

function saveDismissedNotificationIds(setObj) {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const key = 'il_dismissed_notifs_' + (currentUser.email || 'user');
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(setObj)));
  } catch (e) {}
}

function deleteNotificationItem(event, itemId, ticketId) {
  if (event) event.stopPropagation();
  const set = getDismissedNotificationIds();
  if (itemId) set.add(itemId);
  if (ticketId) set.add('ticket_' + ticketId);
  saveDismissedNotificationIds(set);

  if (typeof terminationNotifications !== 'undefined' && Array.isArray(terminationNotifications)) {
    terminationNotifications = terminationNotifications.filter(n => n.id !== itemId && n.ticketId !== ticketId);
    if (typeof saveTerminationNotifications === 'function') saveTerminationNotifications();
  }

  openTopbarModal('notifications');
  if (typeof updateNotificationUI === 'function') updateNotificationUI();
  if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
  if (typeof showToast === 'function') showToast('Notifikasi dihapus', 'info');
}

function clearAllNotifications() {
  showCustomConfirm('Hapus semua notifikasi? Data notifikasi yang dihapus tidak akan ditampilkan kembali.', () => {
    executeClearAllNotifications();
  });
}

function executeClearAllNotifications() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const set = getDismissedNotificationIds();
  const currentItems = window._currentModalNotifItems || [];
  currentItems.forEach(it => {
    if (it.id) set.add(it.id);
    if (it.ticketId) set.add('ticket_' + it.ticketId);
  });
  if (typeof tickets !== 'undefined' && Array.isArray(tickets)) {
    tickets.forEach(t => set.add('ticket_' + t.id));
  }
  if (typeof terminationNotifications !== 'undefined' && Array.isArray(terminationNotifications)) {
    terminationNotifications.forEach(n => {
      if (n.id) set.add(n.id);
      if (n.ticketId) set.add('ticket_' + n.ticketId);
    });
  }
  saveDismissedNotificationIds(set);

  markAllNotificationsAsRead();
  openTopbarModal('notifications');
  if (typeof updateNotificationUI === 'function') updateNotificationUI();
  if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
  if (typeof showToast === 'function') showToast('Semua notifikasi akun Anda berhasil dihapus', 'success');
}

function markAllNotificationsAsRead() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const key = 'il_notif_mark_read_' + (currentUser.email || 'user');
  try { localStorage.setItem(key, String(Date.now())); } catch(e) {}
  closeModal('modalTopbarInfo');
  if (typeof showToast === 'function') showToast('Semua notifikasi ditandai sudah dibaca', 'ok');
  if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
}

function openNotificationTicket(ticketId) {
  if (!ticketId) return;
  closeModal('modalTopbarInfo');
  // Navigate to tickets page and open the ticket
  const ticketsNav = document.querySelector('[data-page="tickets"]');
  if (ticketsNav) ticketsNav.click();
  setTimeout(() => {
    const tk = typeof tickets !== 'undefined' ? tickets.find(t => t.id === ticketId) : null;
    if (tk && typeof openTicketDetail === 'function') openTicketDetail(tk);
    else if (tk && typeof openClientDetail === 'function') openClientDetail(tk);
  }, 200);
}

function updateTopbarBadges(){
  // Update badge counts based on real data
  const ticketBadge = document.getElementById('pillBadgeTickets');
  if(ticketBadge){
    const openTickets = tickets.filter(t=>t.status!=='Selesai').length;
    ticketBadge.textContent = openTickets;
    ticketBadge.style.display = openTickets>0 ? 'flex' : 'none';
  }
  const rackBadge = document.getElementById('pillBadgeRacks');
  if(rackBadge){
    rackBadge.style.display = 'none';
  }
  const invBadge = document.getElementById('pillBadgeInventory');
  if(invBadge){
    const pendingDevices = devices.filter(d=>d.type==='masuk' && !d.exited).length;
    // Show count of devices that need attention? For demo show 2
    invBadge.textContent = Math.min(pendingDevices, 9);
    invBadge.style.display = pendingDevices>0 ? 'flex' : 'none';
  }
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    min-width: 320px;
    max-width: 420px;
    background: rgba(17, 24, 39, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #f9fafb;
    border-radius: 16px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    padding: 16px;
    position: relative;
    overflow: hidden;
    display: flex;
    gap: 14px;
    align-items: flex-start;
    pointer-events: auto;
    cursor: pointer;
    opacity: 0;
    transform: translateX(50px) scale(0.95);
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  
  let iconHtml = '';
  let titleText = '';
  let accentColor = '#3b82f6';
  
  if (type === 'success') {
    accentColor = '#10b981';
    titleText = 'Berhasil';
    iconHtml = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(16, 185, 129, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #10b981;
        font-weight: bold;
        flex-shrink: 0;
        font-size: 14px;
      ">✓</div>
    `;
  } else if (type === 'error' || type === 'crit') {
    accentColor = '#ef4444';
    titleText = 'Gagal';
    iconHtml = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ef4444;
        font-weight: bold;
        flex-shrink: 0;
        font-size: 14px;
      ">✕</div>
    `;
  } else if (type === 'warn') {
    accentColor = '#f59e0b';
    titleText = 'Perhatian';
    iconHtml = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f59e0b;
        font-weight: bold;
        flex-shrink: 0;
        font-size: 14px;
      ">!</div>
    `;
  } else {
    accentColor = '#3b82f6';
    titleText = 'Informasi';
    iconHtml = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.1);
        border: 1px solid rgba(59, 130, 246, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #3b82f6;
        font-family: serif;
        font-weight: bold;
        flex-shrink: 0;
        font-size: 14px;
      ">i</div>
    `;
  }
  
  toast.style.boxShadow = `0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 1px ${accentColor}`;
  
  const contentHtml = `
    ${iconHtml}
    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
      <div style="font-weight: 600; font-size: 14px; color: #f9fafb; font-family: inherit;">${titleText}</div>
      <div style="font-size: 13px; color: #9ca3af; line-height: 1.4; font-family: inherit;">${message}</div>
    </div>
  `;
  
  const progressBar = document.createElement('div');
  progressBar.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    width: 100%;
    background: ${accentColor};
    transform-origin: left;
    transition: transform 4s linear;
  `;
  
  toast.innerHTML = contentHtml;
  toast.appendChild(progressBar);
  container.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0) scale(1)';
    progressBar.style.transform = 'scaleX(0)';
  });
  
  const removeTimer = setTimeout(dismiss, 4000);
  
  toast.onclick = () => {
    clearTimeout(removeTimer);
    dismiss();
  };
  
  function dismiss() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px) scale(0.95)';
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }
}

// Override native window.alert with showToast to prevent browser alert popups
window.alert = function(msg) {
  let type = 'info';
  const lower = String(msg).toLowerCase();
  if (lower.includes('berhasil') || lower.includes('sukses') || lower.includes('simpan') || lower.includes('disetujui') || lower.includes('selesai')) {
    type = 'success';
  } else if (lower.includes('gagal') || lower.includes('maaf') || lower.includes('tidak') || lower.includes('wajib') || lower.includes('hanya') || lower.includes('habis') || lower.includes('salah') || lower.includes('error')) {
    type = 'error';
  }
  showToast(msg, type);
};

function showCustomConfirm(message, onYes, onNo = null) {
  const modal = document.getElementById('modalConfirmDialog');
  if(!modal) return;
  modal.style.setProperty('z-index', '99999', 'important');
  
  document.getElementById('confirmMessage').textContent = message;
  
  const isDelete = message.toLowerCase().includes('hapus') || message.toLowerCase().includes('cancel') || message.toLowerCase().includes('dibatalkan');
  const iconContainer = document.getElementById('confirmIconContainer');
  const iconEl = document.getElementById('confirmIcon');
  const yesBtn = document.getElementById('btnConfirmYes');
  const cancelBtn = document.getElementById('btnConfirmCancel');

  if (isDelete) {
    iconContainer.style.setProperty('background-color', '#FEE2E2', 'important');
    iconContainer.style.setProperty('border-color', '#FCA5A5', 'important');
    iconEl.textContent = '🗑️';
    yesBtn.style.setProperty('background-color', '#FEE2E2', 'important');
    yesBtn.style.setProperty('border', '1px solid #FCA5A5', 'important');
    yesBtn.style.setProperty('box-shadow', '0 2px 8px rgba(239, 68, 68, 0.15)', 'important');
  } else {
    iconContainer.style.setProperty('background-color', '#FFF3E0', 'important');
    iconContainer.style.setProperty('border-color', '#FFE0B2', 'important');
    iconEl.textContent = '⚠️';
    yesBtn.style.setProperty('background-color', '#FFE8D6', 'important');
    yesBtn.style.setProperty('border', '1px solid #FFD0B0', 'important');
    yesBtn.style.setProperty('box-shadow', '0 2px 8px rgba(249, 115, 22, 0.15)', 'important');
  }

  if (yesBtn) {
    yesBtn.onclick = function(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      yesBtn.onclick = null;
      closeCustomConfirm();
      if (typeof onYes === 'function') {
        const fn = onYes;
        onYes = null;
        fn();
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = function(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      cancelBtn.onclick = null;
      closeCustomConfirm();
      if (typeof onNo === 'function') {
        const fn = onNo;
        onNo = null;
        fn();
      }
    };
  }

  modal.classList.add('show');
  
  const card = modal.querySelector('.confirm-card');
  setTimeout(() => {
    card.style.transform = 'scale(1)';
    card.style.opacity = '1';
  }, 10);
}

function closeCustomConfirm() {
  const modal = document.getElementById('modalConfirmDialog');
  if(!modal) return;
  const card = modal.querySelector('.confirm-card');
  if (card) {
    card.style.transform = 'scale(0.9)';
    card.style.opacity = '0';
  }
  setTimeout(() => {
    modal.classList.remove('show');
  }, 200);
}

function showQuantityPrompt(deviceName, currentQty, onConfirm) {
  const modal = document.getElementById('modalQuantityPrompt');
  if (!modal) return;

  const msgEl = document.getElementById('promptQtyMessage');
  if (msgEl) {
    msgEl.textContent = `Perangkat "${deviceName}" memiliki ${currentQty} unit. Tentukan berapa unit yang ingin Anda hapus:`;
  }

  const inputEl = document.getElementById('promptQtyInput');
  if (inputEl) {
    inputEl.value = 1;
    inputEl.oninput = function() {
      this.value = this.value.replace(/[^0-9]/g, '');
      let val = parseInt(this.value) || 0;
      if (val > currentQty) this.value = currentQty;
    };
    inputEl.onblur = function() {
      let val = parseInt(this.value) || 1;
      if (val < 1) this.value = 1;
      if (val > currentQty) this.value = currentQty;
    };
  }

  const btnMinus = document.getElementById('btnQtyMinus');
  const btnPlus = document.getElementById('btnQtyPlus');

  if (btnMinus) {
    btnMinus.onclick = () => {
      let val = parseInt(inputEl.value) || 1;
      if (val > 1) inputEl.value = val - 1;
    };
  }

  if (btnPlus) {
    btnPlus.onclick = () => {
      let val = parseInt(inputEl.value) || 1;
      if (val < currentQty) inputEl.value = val + 1;
    };
  }

  const btnCancel = document.getElementById('btnPromptCancel');
  const btnYes = document.getElementById('btnPromptYes');

  if (btnCancel) {
    btnCancel.onclick = () => {
      closeCustomQuantityPrompt();
    };
  }

  if (btnYes) {
    btnYes.onclick = () => {
      const val = parseInt(inputEl.value) || 1;
      closeCustomQuantityPrompt();
      if (onConfirm) onConfirm(val);
    };
  }

  modal.classList.add('show');
  const card = modal.querySelector('.confirm-card');
  if (card) {
    setTimeout(() => {
      card.style.transform = 'scale(1)';
      card.style.opacity = '1';
    }, 10);
  }
}

function closeCustomQuantityPrompt() {
  const modal = document.getElementById('modalQuantityPrompt');
  if (!modal) return;
  const card = modal.querySelector('.confirm-card');
  if (card) {
    card.style.transform = 'scale(0.9)';
    card.style.opacity = '0';
  }
  setTimeout(() => {
    modal.classList.remove('show');
  }, 200);
}

// Clean modal confirmation handlers
document.addEventListener('DOMContentLoaded', () => {
  // Read-only init if needed
});