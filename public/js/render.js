function createTerminationEligibleAt(requestedAt=Date.now()){
  return new Date(new Date(requestedAt).getTime() + TERMINATION_ACCESS_CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function getTerminationEligibleAt(ticket){
  const eligible = ticket?.terminateEligibleAt ? new Date(ticket.terminateEligibleAt) : null;
  return eligible && !Number.isNaN(eligible.getTime()) ? eligible : new Date();
}

function formatTerminationDate(value){
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}

function getTerminationRemainingDays(ticket){
  return Math.max(0, Math.ceil((getTerminationEligibleAt(ticket).getTime() - Date.now()) / (24*60*60*1000)));
}

function isTerminationFullyApproved(ticket){ return !!(ticket?.adminApprovedAt && ticket?.supportApprovedAt); }

function getTerminationApprovalLabel(ticket){
  const admin = ticket?.adminApprovedAt ? 'Admin ✓' : 'Admin menunggu';
  const support = ticket?.supportApprovedAt ? 'Support ✓' : 'Support menunggu';
  return `${admin} • ${support}`;
}

function isTerminationAccessExpired(client){
  if(!client?.terminationApprovedAt || !client?.terminateAccessEndsAt) return false;
  const cutoff = new Date(client.terminateAccessEndsAt).getTime();
  return !Number.isNaN(cutoff) && Date.now() >= cutoff;
}

function getTerminationAccessRemainingHours(client){
  if(!client?.terminateAccessEndsAt) return 0;
  return Math.max(0,Math.ceil((new Date(client.terminateAccessEndsAt).getTime()-Date.now())/(60*60*1000)));
}

function enforceTerminationAccessCutoff(client){
  if(!isTerminationAccessExpired(client) || client.status==='Terminate') return false;
  const now = new Date().toISOString();
  client.status='Terminate';
  client.berhentiAt=now;
  client.terminatedAt=now;
  client.suspendAt=null;
  client.ket=`${client.ket||''}${client.ket?' | ':''}Akses portal ditutup pada hari ke-4 setelah terminate disetujui.`;
  return true;
}

function loadTerminationNotifications(){
  // Loaded via bootstrap in loadData
}

async function saveTerminationNotifications(){
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    await fetch('/api/termination-notifications/bulk', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(terminationNotifications)
    });
  } catch (e) {
    console.error('Error saving termination notifications:', e);
  }
}

function addTerminationNotification(event,ticket){
  const cutoff=formatTerminationDate(ticket.terminateEligibleAt);
  const messages={
    submitted:`${ticket.pt||'Client'} mengajukan Permintaan Terminate. Menunggu persetujuan Admin dan Support.`,
    adminApproved:`Admin menyetujui terminate ${ticket.pt||'Client'}. Menunggu persetujuan Support.`,
    supportApproved:`Support menyetujui terminate ${ticket.pt||'Client'}. Menunggu persetujuan Admin.`,
    fullyApproved:`Terminate ${ticket.pt||'Client'} disetujui Admin dan Support. Akses portal ditutup mulai ${cutoff}.`,
    accessClosed:`Akses portal ${ticket.pt||'Client'} telah ditutup sesuai jadwal terminate.`
  };
  terminationNotifications.unshift({
    id:`NTF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    event, ticketId:ticket.id, clientId:ticket.clientId, roles:['admin','support'],
    message:messages[event]||'Pembaruan permintaan terminate.', createdAt:new Date().toISOString(), readBy:[]
  });
  saveTerminationNotifications();
  updateNotificationUI();
}

function addNotification(ticket, message){
  if(ticket) ticket.updatedTime = Date.now();
  terminationNotifications.unshift({
    id:`NTF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    ticketId:ticket?ticket.id:null, clientId:ticket?ticket.clientId:null,
    roles:['admin','support','client'],
    message:message, createdAt:new Date().toISOString(), readBy:[]
  });
  if(terminationNotifications.length > 100){
    terminationNotifications = terminationNotifications.slice(0, 100);
  }
  saveTerminationNotifications();
  updateNotificationUI();
  if(typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
}

function updateNotificationUI(){
  const button=document.getElementById('notificationBtn');
  const badge=document.getElementById('notificationBadge');
  if(!button || !badge || !currentUser) return;
  
  button.style.display='inline-flex';
  
  const markReadTime = parseInt(localStorage.getItem('il_notif_mark_read_' + (currentUser.email || 'user')) || '0', 10);
  const dismissedSet = typeof getDismissedNotificationIds === 'function' ? getDismissedNotificationIds() : new Set();
  let unread = 0;
  
  if (isAdmin() || isSupport()) {
    if (markReadTime === 0) {
      unread += tickets.filter(t => !dismissedSet.has('ticket_' + t.id) && (t.status === 'Menunggu Approval' || t.status === 'Baru')).length;
    } else {
      unread += tickets.filter(t =>
        !dismissedSet.has('ticket_' + t.id) &&
        (t.status === 'Menunggu Approval' || t.status === 'Baru') &&
        getTicketTimestamp(t) > markReadTime
      ).length;
    }
  } else if (isClient()) {
    const eligibleTickets = tickets.filter(t =>
      !dismissedSet.has('ticket_' + t.id) &&
      (t.clientId === currentUser.clientId ||
      (currentUser.pt && (t.pt||'').toLowerCase().trim() === (currentUser.pt||'').toLowerCase().trim()) ||
      (t.createdBy||'').toLowerCase() === (currentUser.name||'').toLowerCase())
    );
    if (markReadTime === 0) {
      unread += eligibleTickets.filter(t => t.status !== 'Dibatalkan').length;
    } else {
      unread += eligibleTickets.filter(t => getTicketTimestamp(t) > markReadTime).length;
    }
  }

  if (typeof terminationNotifications !== 'undefined' && Array.isArray(terminationNotifications)) {
    const userRole = currentUser.role;
    const userIdOrRole = currentUser.id || currentUser.email || currentUser.role;
    const unreadNotifs = terminationNotifications.filter(n => {
      if (dismissedSet.has(n.id) || (n.ticketId && dismissedSet.has('ticket_' + n.ticketId))) return false;
      if (isClient() && n.clientId && n.clientId !== currentUser.clientId) return false;
      const readBy = Array.isArray(n.readBy) ? n.readBy : [];
      const isRead = readBy.includes(userIdOrRole) || readBy.includes(userRole);
      const notifTime = n.createdAt ? new Date(n.createdAt).getTime() : 0;
      return !isRead && (markReadTime === 0 || notifTime > markReadTime);
    }).length;
    unread += unreadNotifs;
  }
  
  badge.textContent=unread>99?'99+':unread;
  badge.style.display=unread?'block':'none';
}

function markAllNotificationsAsRead(){
  if(!currentUser) return;
  // Save timestamp so all items before this time are considered "read"
  const key = 'il_notif_mark_read_' + (currentUser.email || 'user');
  try { localStorage.setItem(key, String(Date.now())); } catch(e) {}
  // Also mark termination notifications in readBy array
  const role = currentUser.role;
  const userIdOrRole = currentUser.id || currentUser.email || currentUser.role;
  let items = isAdmin() || isSupport()
    ? terminationNotifications
    : terminationNotifications.filter(item => item.clientId === currentUser.clientId);
  items.forEach(item => {
    item.readBy = Array.isArray(item.readBy) ? item.readBy : [];
    if (!item.readBy.includes(userIdOrRole)) item.readBy.push(userIdOrRole);
    if (!item.readBy.includes(role)) item.readBy.push(role);
  });
  saveTerminationNotifications();
  // Close modal and update badges
  if (typeof closeModal === 'function') closeModal('modalTopbarInfo');
  updateNotificationUI();
  if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
  if (typeof showToast === 'function') showToast('Semua notifikasi ditandai sudah dibaca', 'ok');
}

function approveTerminationTicket(ticket){
  const role=isAdmin()?'admin':isSupport()?'support':'';
  if(!role){ alert('Hanya Admin atau Support yang dapat menyetujui terminate.'); return; }
  const key=`${role}ApprovedAt`;
  if(ticket[key]){ alert(`${role==='admin'?'Admin':'Support'} sudah menyetujui permintaan terminate ini.`); return; }
  showCustomConfirm(`Setujui permintaan terminate ${ticket.id} sebagai ${role==='admin'?'Admin':'Support'}?`, () => {
    const now=new Date().toISOString();
    ticket[key]=now;
    ticket[`${role}ApprovedBy`]=currentUser.email;
    addTerminationNotification(role==='admin'?'adminApproved':'supportApproved',ticket);
    if(isTerminationFullyApproved(ticket)){
      ticket.status='Disetujui';
      ticket.fullyApprovedAt=now;
      const client=clients.find(c=>c.id===ticket.clientId);
      if(client){
        client.terminationApprovedAt=now;
        client.terminateAccessEndsAt=ticket.terminateEligibleAt;
        client.terminationTicketId=ticket.id;
        if(enforceTerminationAccessCutoff(client)) addTerminationNotification('accessClosed',ticket);
      }
      addTerminationNotification('fullyApproved',ticket);
    }else{
      ticket.status='Menunggu Approval';
    }
    saveData(); renderTickets(); renderClients(); updateNotificationUI();
    alert(`Tiket ${ticket.id} berhasil disetujui.`);
  });
}

function getClientDataForCurrentUser(){
  if(!isClient() && !isSubclient()) return null;
  return clients.find(cl=>cl.id===currentUser.clientId) || clients.find(cl=>cl.pt===currentUser.pt) || null;
}

function isClientSuspended(){
  const cl = getClientDataForCurrentUser();
  return cl && cl.status==='Suspend';
}

function isClientHold(){
  const cl = getClientDataForCurrentUser();
  return cl && cl.status==='Hold';
}

function isClientJatuhTempo(){
  const cl = getClientDataForCurrentUser();
  return cl && cl.status==='Jatuh tempo';
}

function isClientBerhenti(){
  const cl = getClientDataForCurrentUser();
  return cl && cl.status==='Terminate';
}

function isClientBlocked24h(){
  const cl = getClientDataForCurrentUser();
  if(!cl) return false;
  if(cl.status!=='Terminate') return false;
  if(!cl.berhentiAt) return false;
  try{
    const berhentiTime = new Date(cl.berhentiAt).getTime();
    const now = Date.now();
    return (now - berhentiTime) > (24*60*60*1000);
  }catch(e){ return false; }
}

function getTerminationRemainingMs(){
  const cl = getClientDataForCurrentUser();
  if(!cl) return 0;
  const baseTime = cl.berhentiAt || cl.terminatedAt || cl.terminateAccessEndsAt;
  if(!baseTime) return 0;
  try{
    const baseTs = new Date(baseTime).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Math.max(0, (baseTs + sevenDaysMs) - Date.now());
  }catch(e){ return 0; }
}

function getBerhentiRemainingHours(){
  return Math.ceil(getTerminationRemainingMs() / (60*60*1000));
}

function formatCountdownMs(ms){
  if(ms <= 0) return { days:0, hours:0, minutes:0, seconds:0, label:'00h 00m 00d' };
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  return { days, hours, minutes, seconds, label: `${days}h ${pad(hours)}j ${pad(minutes)}m ${pad(seconds)}d` };
}

function getDefaultBeratGlobal(kategori){
  const map = {
    'Server': 20,
    'Storage': 25,
    'Switch': 5,
    'Router': 5,
    'Firewall': 6,
    'Patch Panel': 2,
    'Kabel Fiber': 1,
    'Modul / Transceiver': 0.5,
    'OTB': 3,
    'UPS / PDU': 15,
    'Lainnya': 5
  };
  return map[kategori] || 5;
}

function getDeviceBerat(d){
  if(!d) return 0;
  if(d.berat && !isNaN(parseFloat(d.berat))){
    return parseFloat(d.berat);
  }
  return getDefaultBeratGlobal(d.kategori);
}

function formatBeratDisplay(kg){
  const b = parseFloat(kg);
  if(isNaN(b) || b <= 0) return '0 Kg';
  if(b < 1){
    const g = parseFloat((b * 1000).toFixed(2));
    return `${g} Gram`;
  }
  return b % 1 === 0 ? `${b} Kg` : `${parseFloat(b.toFixed(2))} Kg`;
}

function parseBeratInput(inputId, unitSelectId){
  const raw = document.getElementById(inputId)?.value;
  if(!raw) return 0;
  // Replace comma with dot for Indonesian locale decimal format (e.g. "20,3" -> "20.3")
  const cleanedStr = String(raw).trim().replace(',', '.');
  const num = parseFloat(cleanedStr.replace(/[^0-9.]/g, ''));
  if(isNaN(num) || num <= 0) return 0;

  const unitElem = unitSelectId ? document.getElementById(unitSelectId) : null;
  const unit = unitElem ? unitElem.value : 'kg';
  return unit === 'gram' ? (num / 1000) : num;
}

function setBeratInput(inputId, unitSelectId, weightInKg){
  const elem = document.getElementById(inputId);
  const unitElem = unitSelectId ? document.getElementById(unitSelectId) : null;
  if(!elem) return;
  const b = parseFloat(weightInKg);
  if(isNaN(b) || b <= 0){
    elem.value = '';
    if(unitElem) unitElem.value = 'kg';
    return;
  }
  if(b < 1){
    const g = parseFloat((b * 1000).toFixed(2));
    elem.value = g;
    if(unitElem) unitElem.value = 'gram';
  } else {
    elem.value = b % 1 === 0 ? b : parseFloat(b.toFixed(2));
    if(unitElem) unitElem.value = 'kg';
  }
}

function formatSNList(snStr, jumlah){
  if(!snStr) return ['-'];
  let parts = snStr.split(/[\n,;]+/).map(s=>s.trim()).filter(s=>s.length>0).map(s=>s.replace(/^-+\s*/, '').trim()).filter(s=>s);
  return parts;
}

function renderSNCell(snStr, jumlah){
  const list = formatSNList(snStr, jumlah);
  // Sesuai request: SN pertama juga pakai -
  return list.map(sn=>{
    return '<span style="color:var(--text-dim);">-</span> ' + escapeHtml(sn);
  }).join('<br>');
}


function updateOverviewStats(){
  const rackEl = document.getElementById('statRackAktif');
  const rackSub = document.getElementById('statRackSub');
  const tiketEl = document.getElementById('statTiket');
  const tiketSub = document.getElementById('statTiketSub');
  const xcEl = document.getElementById('statXC');
  const xcSub = document.getElementById('statXCSub');

  if(!rackEl) return;

  if(isClient()){
    // Hitung berapa rack yang disewa client ini
    // Client bisa punya multiple entries dengan PT sama atau clientId sama
    const clientEntries = clients.filter(cl=> cl.id===currentUser.clientId || cl.pt===currentUser.pt);
    // Hitung distinct rack dari lokasi
    const distinctRacks = new Set();
    clientEntries.forEach(cl=>{
      const loc = (cl.lokasi||'').toLowerCase();
      if(loc.includes('keluar dari')) return; // skip yang sudah keluar
      // Cari rack yang match
      racks.forEach(r=>{
        if(loc.includes(r.id.toLowerCase())){
          distinctRacks.add(r.id);
        }
      });
      // Jika lokasi tidak match rack ID persis, tapi ada string rack, tetap hitung lokasi sebagai 1 rack
      if(distinctRacks.size===0 && loc){
        // Jika client punya lokasi tapi tidak match rack list, anggap 1 rack sewa
        distinctRacks.add(loc);
      }
    });
    const rackCount = distinctRacks.size || clientEntries.length || 1;

    // Rack aktif = jumlah rack sewa
    rackEl.innerHTML = `${rackCount}<span style="font-size:14px;color:var(--text-dim);"> Rack</span>`;
    if(rackSub) rackSub.textContent = `Total rack disewa oleh ${currentUser.pt}`;

    // Tiket terbuka milik client
    const clientTickets = tickets.filter(t=> t.clientId===currentUser.clientId);
    const openTickets = clientTickets.filter(t=> t.status!=='Selesai');
    const highPrio = openTickets.filter(t=> t.priority==='Prioritas tinggi').length;
    if(tiketEl) tiketEl.textContent = openTickets.length;
    if(tiketSub) tiketSub.textContent = `${highPrio} prioritas tinggi • Total ${clientTickets.length} tiket`;

    // CrossConnect aktif milik client
    const clientXC = crossConnects.filter(xc=> xc.clientId===currentUser.clientId);
    const activeXC = clientXC.filter(xc=> xc.status==='Aktif');
    if(xcEl) xcEl.textContent = activeXC.length;
    if(xcSub) xcSub.textContent = `Dari ${clientXC.length} total koneksi`;

  }else{
    // Admin & Support: hitung real dari data
    const totalRacks = racks.length;
    const activeRacks = racks.filter(r=> r.status!=='Offline').length;
    if(rackEl) rackEl.innerHTML = `${activeRacks}<span style="font-size:14px;color:var(--text-dim);">/${totalRacks}</span>`;
    if(rackSub) rackSub.textContent = `${activeRacks} rack operasional`;

    const openTicketsAll = tickets.filter(t=> t.status!=='Selesai');
    const highAll = openTicketsAll.filter(t=> t.priority==='Prioritas tinggi').length;
    if(tiketEl) tiketEl.textContent = openTicketsAll.length;
    if(tiketSub) tiketSub.textContent = `${highAll} prioritas tinggi`;

    const activeXCAll = crossConnects.filter(xc=> xc.status==='Aktif');
    if(xcEl) xcEl.textContent = activeXCAll.length || crossConnects.length;
    if(xcSub) xcSub.textContent = `+${crossConnects.filter(xc=> xc.status==='Dalam proses').length} dalam proses`;
  }
}

function openTopNavPage(page){
  // The top navigation is a dashboard shortcut. Home and Dashboard both return
  // to Overview; Contact opens the existing support dialog instead of pointing
  // at pages that do not exist in this file.
  document.querySelectorAll('.nav-links a').forEach(a=>a.classList.remove('active'));
  if(page==='contact'){
    openTopbarModal('contact');
    document.getElementById('navContact')?.classList.add('active');
    return;
  }

  document.getElementById(page==='home' ? 'navHome' : 'navDashboard')?.classList.add('active');
  document.querySelectorAll('.page').forEach(p=>{
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const overview = document.getElementById('page-overview');
  if(overview){
    overview.classList.add('active');
    overview.style.display = 'block';
  }
  document.querySelectorAll('.subnav-item').forEach(i=>i.classList.toggle('active', i.dataset.page==='overview'));
  window.scrollTo(0,0);
}

function applyRoleToUI(){
  if(!currentUser) return;
  
  const clDataUI = (isClient() || isSubclient()) ? clients.find(cl=>cl.id===currentUser.clientId) : null;
  let isHold = false;
  if (clDataUI) {
     if (clDataUI.status === 'Hold') {
        isHold = true;
     } else if (clDataUI.lokasi) {
        const rData = racks.find(r => r.id === clDataUI.lokasi || clDataUI.lokasi.includes(r.id));
        if (rData && rData.status === 'Hold') isHold = true;
     }
  }

  // Custom injections for Sub-Account
  const accNav = document.getElementById('accountManagementNav');
  if(accNav) accNav.style.display = checkPermission(currentUser.role, 'account_management') ? 'flex' : 'none';

  const subAccNav = document.getElementById('subAccountNav');
  if(subAccNav) {
     const isMainClient = (currentUser.role === 'client');
     const clData = isMainClient ? clients.find(cl=>cl.id===currentUser.clientId) : null;
     const hasPermission = isMainClient && currentUser.accountType === 'reseller';
     subAccNav.style.display = hasPermission ? 'flex' : 'none';
  }

  const crossConnectNav = document.querySelector('[data-page="crossconnect"]');
  if(crossConnectNav) crossConnectNav.style.display = checkPermission(currentUser.role, 'cross_connect') ? 'flex' : 'none';

  const tkCrossConnectChip = document.querySelector('button[data-tfilter="CrossConnect"]');
  if(tkCrossConnectChip) tkCrossConnectChip.style.display = (checkPermission(currentUser.role, 'cross_connect') && !isHold) ? 'inline-block' : 'none';

  const tkCrossConnectClientSelect = document.querySelector('#ticketTypeClientSelect option[value="CrossConnect"]');
  if(tkCrossConnectClientSelect) tkCrossConnectClientSelect.style.display = (checkPermission(currentUser.role, 'cross_connect') && !isHold) ? 'block' : 'none';

  const tkCrossConnectOption = document.querySelector('option[value="CrossConnect"]');
  if(tkCrossConnectOption) {
    if(checkPermission(currentUser.role, 'cross_connect') && !isHold) {
       tkCrossConnectOption.style.display = '';
       tkCrossConnectOption.disabled = false;
       tkCrossConnectOption.hidden = false;
    } else {
       tkCrossConnectOption.style.display = 'none';
       tkCrossConnectOption.disabled = true;
       tkCrossConnectOption.hidden = true;
       if(tkCrossConnectOption.parentNode) tkCrossConnectOption.parentNode.removeChild(tkCrossConnectOption);
    }
  }
  
  const btnAddKeluar = document.getElementById('btnAddKeluar');
  const btnAddDevice = document.getElementById('btnAddDevice');

  if(isAdmin() || isSupport()) {
    if(btnAddKeluar) btnAddKeluar.style.display = 'none';
    if(btnAddDevice) btnAddDevice.style.display = 'none';
  } else {
    // Determine client status
    const clStatus = clDataUI ? clDataUI.status : null;
    const isSuspend = clStatus === 'Suspend';
    const isTerminate = clStatus === 'Terminate' || clStatus === 'Terminated';
    // btnAddDevice (Masuk Barang): hidden for Suspend and Terminate
    if(btnAddDevice){
      const showMasuk = !isSuspend && !isTerminate && checkPermission(currentUser.role, 'inventory_masuk');
      btnAddDevice.style.display = showMasuk ? 'inline-block' : 'none';
    }
    // btnAddKeluar (Keluar Barang): only Aktif can use it
    if(btnAddKeluar){
      const showKeluar = !isSuspend && !isTerminate && !isHold && checkPermission(currentUser.role, 'inventory_keluar');
      btnAddKeluar.style.display = showKeluar ? 'inline-block' : 'none';
    }
  }

  const tkKeluarOption = document.querySelector('option[value="Keluar Barang"]');
  if(tkKeluarOption) {
    if(checkPermission(currentUser.role, 'inventory_keluar') && !isHold) {
       tkKeluarOption.style.display = '';
       tkKeluarOption.disabled = false;
       tkKeluarOption.hidden = false;
    } else {
       tkKeluarOption.style.display = 'none';
       tkKeluarOption.disabled = true;
       tkKeluarOption.hidden = true;
       if(tkKeluarOption.parentNode) tkKeluarOption.parentNode.removeChild(tkKeluarOption);
    }
  }


  // Topbar user info
  const topRight = document.querySelector('.topbar-right');
  if(topRight){
    let badgeColor = 'var(--orange)';
    if(currentUser.role==='support') badgeColor = '#5dcaa5';
    if(currentUser.role==='client') badgeColor = '#85b7eb';
    if(currentUser.role==='subclient') badgeColor = '#b585eb';
    let roleText = currentUser.role;
    if (currentUser.role === 'subclient') roleText = 'Sub-Account of ' + (currentUser.parentEmail || currentUser.pt);

    const existingBadge = document.getElementById('roleBadgeTop');
    if(existingBadge) existingBadge.remove();
    const badge = document.createElement('div');
    badge.id = 'roleBadgeTop';
    badge.innerHTML = `<div class="topbar-user-badge" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);padding:4px 10px;border-radius:20px;font-size:11px;"><div style="width:28px;height:28px;border-radius:50%;background:${badgeColor};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-family:var(--font-display);">${currentUser.avatar||currentUser.name.substring(0,2).toUpperCase()}</div><div class="topbar-user-text"><div style="font-weight:600;color:#fff;line-height:1;">${currentUser.name}</div><div style="font-size:9.5px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;">${roleText} ${currentUser.pt? '• '+currentUser.pt:''}</div></div></div>`;
    topRight.insertBefore(badge, topRight.firstChild);
  }

  // Show/hide actions based on role
  const adminOnlyBtns = document.querySelectorAll('[data-role-admin]');
  adminOnlyBtns.forEach(el=>{
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Hanya Admin yang bisa tambah rack
  const hideForClient = isClient();
  document.querySelectorAll('.page-action').forEach(btn=>{
    const text = btn.textContent.toLowerCase();
    if(text.includes('tambah rack') || text.includes('tambah lantai')){
      btn.style.display = isAdmin() ? '' : 'none';
    }else if(hideForClient && (text.includes('tambah klien') || text.includes('export'))){
      btn.style.display = 'none';
    }
    if(isSupport() && text.includes('tambah klien')){
      btn.style.display = 'none';
    }
  });

  // Technical rack editing is Admin only; Deletion is Admin/Support; Support can still open the PT manager.
  const btnEditRack = document.getElementById('btnEditRackDetail');
  if(btnEditRack) btnEditRack.style.display = isAdmin() ? '' : 'none';
  const btnDelRack = document.getElementById('btnDeleteRackDetail');
  if(btnDelRack) btnDelRack.style.display = (isAdmin() || isSupport()) ? '' : 'none';
  const canManageRack = isAdmin() || isSupport();
  const btnAddFloor = document.getElementById('btnAddFloor');
  if(btnAddFloor) btnAddFloor.style.setProperty('display', canManageRack ? 'inline-flex' : 'none', 'important');
  const btnAddRack = document.getElementById('btnAddRack');
  if(btnAddRack) btnAddRack.style.setProperty('display', canManageRack ? 'inline-flex' : 'none', 'important');
  const managePTBtn = document.getElementById('btnKelolaPTDetail');
  if(managePTBtn) managePTBtn.style.display = canManageRack ? '' : 'none';

  // Update overview stats per role (rack aktif = jumlah rack sewa client)
  updateOverviewStats();
  updateNotificationUI();

  // Adjust overview stats for client - WELCOME INTERLINK
  if(isClient()){
    const overview = document.getElementById('page-overview');
    if(overview){
      let banner = document.getElementById('clientBanner');
      if(!banner){
        banner = document.createElement('div');
        banner.id = 'clientBanner';
        banner.style.cssText = 'margin:22px 32px 0;background:linear-gradient(135deg, rgba(59,124,240,0.12), rgba(47,194,216,0.08));border:1px solid rgba(59,124,240,0.28);border-radius:14px;padding:18px 20px;display:flex;gap:14px;align-items:flex-start;backdrop-filter:blur(10px);';
        banner.innerHTML = `<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg, var(--blue), var(--cyan));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;flex-shrink:0;">👋</div><div><div style="font-weight:700;color:#fff;font-size:15px;font-family:var(--font-display);margin-bottom:4px;">Welcome to Interlink Data Center, ${currentUser.name}!</div><div style="font-size:12px;color:var(--text-mid);line-height:1.6;">Senang melihat Anda kembali, <b style="color:#fff;">${currentUser.pt}</b>! 🚀<br>Portal client ini dirancang khusus untuk memudahkan Anda memantau <b style="color:#8cb1ee;">perangkat aktif</b>, <b style="color:#5dcaa5;">status rack ${clients.find(cl=>cl.id===currentUser.clientId)?.lokasi||''}</b>, dan <b style="color:#ffb07a;">riwayat tiket</b> secara realtime & transparan. Semua data difilter otomatis hanya untuk PT Anda — aman, cepat, dan terpusat dalam satu dashboard Tier-III terpercaya di Jakarta.<br><span style="font-size:11px;color:var(--text-dim);margin-top:6px;display:block;">💡 Butuh bantuan? Silakan buat tiket CrossConnect, Masuk atau Keluar Barang melalui menu Tickets. Tim support kami siap 24/7!</span></div></div>`;
        const hero = overview.querySelector('.hero');
        if(hero) hero.parentNode.insertBefore(banner, hero.nextSibling);
      }else{
        // Update existing banner content
        banner.innerHTML = `<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg, var(--blue), var(--cyan));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;flex-shrink:0;">👋</div><div><div style="font-weight:700;color:#fff;font-size:15px;font-family:var(--font-display);margin-bottom:4px;">Welcome to Interlink Data Center, ${currentUser.name}!</div><div style="font-size:12px;color:var(--text-mid);line-height:1.6;">Senang melihat Anda kembali, <b style="color:#fff;">${currentUser.pt}</b>! 🚀<br>Portal client ini dirancang khusus untuk memudahkan Anda memantau <b style="color:#8cb1ee;">perangkat aktif</b>, <b style="color:#5dcaa5;">status rack ${clients.find(cl=>cl.id===currentUser.clientId)?.lokasi||''}</b>, dan <b style="color:#ffb07a;">riwayat tiket</b> secara realtime & transparan. Semua data difilter otomatis hanya untuk PT Anda — aman, cepat, dan terpusat dalam satu dashboard Tier-III terpercaya di Jakarta.<br><span style="font-size:11px;color:var(--text-dim);margin-top:6px;display:block;">💡 Butuh bantuan? Silakan buat tiket CrossConnect, Masuk atau Keluar Barang melalui menu Tickets. Tim support kami siap 24/7!</span></div></div>`;
      }
    }
    // Hapus tombol Submit a Ticket di hero untuk client
    const heroCta = document.querySelector('#page-overview .hero-cta');
    if(heroCta) heroCta.style.display = 'inline-flex';
  }else{
    const banner = document.getElementById('clientBanner');
    if(banner) banner.remove();
    const heroCta = document.querySelector('#page-overview .hero-cta');
    if(heroCta) heroCta.style.display = 'inline-flex';
  }

  if(isSupport()){
    let banner = document.getElementById('supportBanner');
    if(!banner){
      banner = document.createElement('div');
      banner.id = 'supportBanner';
      banner.style.cssText = 'margin:20px 32px 0;background:rgba(29,158,117,0.1);border:1px solid rgba(29,158,117,0.25);border-radius:10px;padding:12px 16px;display:flex;gap:10px;align-items:center;';
      banner.innerHTML = `<div style="width:36px;height:36px;border-radius:8px;background:#1d9e75;display:flex;align-items:center;justify-content:center;color:#fff;">🛠️</div><div><div style="font-weight:600;color:#fff;font-size:13px;">Mode Support - ${currentUser.name}</div><div style="font-size:11.5px;color:var(--text-mid);">Anda bisa kelola tiket CrossConnect & Barang, lihat inventory, tapi tidak bisa hapus client/rack.</div></div>`;
      const hero = document.querySelector('#page-overview .hero');
      if(hero) hero.parentNode.insertBefore(banner, hero.nextSibling);
    }
  }else{
    const banner = document.getElementById('supportBanner');
    if(banner) banner.remove();
  }

  // Inventory status is shown as one dropdown for every role.
  const invFilterChips = document.querySelector('#page-inventory .filter-chips');
  const invStatusDropdown = document.getElementById('clientStatusFilter');
  if(invFilterChips) invFilterChips.style.display='none';
  if(invStatusDropdown){ invStatusDropdown.style.display=''; invStatusDropdown.value=currentFilter; }

  // "Semua" is intentionally hidden for Admin/Support to simplify their
  // status filters. Client keeps it; Admin/Support can click an active status
  // filter again to return to the complete list.
  const allRackFilterChip = document.querySelector('[data-rfilter="all"]');
  if(allRackFilterChip){
    allRackFilterChip.style.display = (isAdmin() || isSupport()) ? 'none' : '';
  }

  // Floor/status controls are operational filters for Admin and Support only.
  // Client already sees its own rack(s), so the controls are removed entirely.
  const rackFloorControl = document.getElementById('rackFloorFilter');
  const rackStatusControl = document.getElementById('rackStatusFilter');
  const rackResetControl = document.querySelector('.rack-reset-filter');
  const rackDescription = document.querySelector('#page-racks .page-header p');
  const rackSearch = document.getElementById('rackSearch');
  if(isClient()){
    if(rackFloorControl) rackFloorControl.style.display='none';
    if(rackStatusControl) rackStatusControl.style.display='none';
    if(rackResetControl) rackResetControl.style.display='none';
    currentRackFilter='all';
    if(globalFloorFilter!=='all'){
      globalFloorFilter='all';
      localStorage.setItem('il_global_floor_filter','all');
    }
    if(rackDescription) rackDescription.textContent = 'Ringkasan rack yang Anda sewa. Klik card untuk melihat detail rack.';
    if(rackSearch) rackSearch.placeholder = 'Cari rack Anda...';
  }else{
    if(rackFloorControl) rackFloorControl.style.display='';
    if(rackStatusControl) rackStatusControl.style.display='none';
    if(rackResetControl) rackResetControl.style.display='';
    if(rackDescription) rackDescription.textContent = 'Status kapasitas dan kondisi tiap rack di lantai fasilitas. Klik card untuk detail, tambah, edit, hapus.';
    if(rackSearch) rackSearch.placeholder = 'Cari ID rack, lokasi...';
  }
  populateFloorControls();
  updateGlobalFloorIndicators();

  // Ticket filters use unified dropdowns for every role.
  const ticketTypeChips = document.getElementById('ticketTypeChips');
  const ticketStatusChips = document.getElementById('ticketStatusChips');
  const ticketClientDropdowns = document.getElementById('ticketClientDropdowns');
  const ticketDropdownFilters = document.getElementById('ticketDropdownFilters');
  if(ticketTypeChips) ticketTypeChips.style.display='none';
  if(ticketStatusChips) ticketStatusChips.style.display='none';
  if(ticketClientDropdowns) ticketClientDropdowns.style.display='none';
  if(ticketDropdownFilters){
    ticketDropdownFilters.style.display='flex';
    document.getElementById('ticketTypeFilterSelect').value=currentTicketTypeFilter;
    document.getElementById('ticketStatusFilterSelect').value=currentTicketStatusFilter;
  }


  // === HOLD LOGIC: client hold tidak bisa crossconnect & keluar barang, hanya bisa masuk barang ===
  if(isClientHold()){
    let holdOverlay = document.getElementById('holdOverlayBanner');
    if(!holdOverlay){
      holdOverlay = document.createElement('div');
      holdOverlay.id = 'holdOverlayBanner';
      holdOverlay.style.cssText = 'position:fixed;top:64px;left:0;right:0;z-index:998;background:rgba(217,119,6,0.95);color:#fff;padding:10px 20px;text-align:center;font-size:13px;font-weight:600;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      holdOverlay.innerHTML = `⚠️ STATUS HOLD - ${currentUser.pt} - Akun Anda sedang ditangguhkan (Hold). Anda hanya diperbolehkan membuat tiket "Masuk Barang". Akses "CrossConnect" dan "Keluar Barang" dinonaktifkan. <button onclick="this.parentElement.style.display='none'" style="margin-left:12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Tutup [X]</button>`;
      document.body.appendChild(holdOverlay);
    }
    holdOverlay.style.display = 'block';
  }else{
    const holdOverlay = document.getElementById('holdOverlayBanner');
    if(holdOverlay) holdOverlay.style.display = 'none';
  }

  // === SUSPEND LOGIC: client tidak bisa klik tombol apapun, hanya melihat ===
  if(isClientSuspended()){
    // Buat overlay banner suspend permanen di atas
    let suspendOverlay = document.getElementById('suspendOverlayBanner');
    if(!suspendOverlay){
      suspendOverlay = document.createElement('div');
      suspendOverlay.id = 'suspendOverlayBanner';
      suspendOverlay.style.cssText = 'position:fixed;top:64px;left:0;right:0;z-index:999;background:rgba(226,75,74,0.95);color:#fff;padding:10px 20px;text-align:center;font-size:13px;font-weight:600;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      suspendOverlay.innerHTML = `⛔ AKUN SUSPEND - ${currentUser.pt} - Anda hanya bisa MELIHAT data, tidak bisa klik tombol apapun. Ditentukan oleh Admin. Hubungi support@interlink.co.id <button onclick="this.parentElement.style.display='none'" style="margin-left:12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Tutup [X]</button>`;
      document.body.appendChild(suspendOverlay);
    }
    suspendOverlay.style.display = 'block';

    // Disable semua tombol aksi di page-body
    setTimeout(()=>{
      document.querySelectorAll('.page-body .page-action, .page-body .action-icon, .page-body .chip, .device-tabs .device-tab, .inventory-toolbar .chip').forEach(btn=>{
        // Jangan disable chip filter Semua? Biar bisa lihat, tapi disable add/edit
        const text = (btn.textContent||'').toLowerCase();
        if(text.includes('tambah') || text.includes('catat') || text.includes('ajukan') || text.includes('submit') || btn.classList.contains('action-icon')){
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.35';
          btn.title = 'Akun Suspend - tidak bisa klik (hanya Admin bisa reaktivasi)';
        }
      });
      // Disable klik pada card rack dan client row (hanya view, tapi tidak bisa aksi)
      document.querySelectorAll('.rack-card, .clickable-pt').forEach(el=>{
        // Biarkan klik untuk lihat detail masih boleh? Requirement bilang tidak bisa klik tombol apapun hanya melihat, jadi detail masih boleh lihat?
        // Untuk strict, kita biarkan detail masih bisa dilihat, tapi tombol di dalam detail sudah di-disable
      });
    }, 300);
  }else{
    const suspendOverlay = document.getElementById('suspendOverlayBanner');
    if(suspendOverlay) suspendOverlay.style.display = 'none';
    // Re-enable buttons
    document.querySelectorAll('.page-body .page-action, .page-body .action-icon, .page-body .chip').forEach(btn=>{
      btn.style.pointerEvents = '';
      btn.style.opacity = '';
    });
  }

  // Terminate yang sudah mendapat dua persetujuan: client masih dapat melihat
  // portal sampai hari ke-4 sejak request, lalu otomatis keluar dan diblokir.
  if(isClient()){
    const terminateClient=getClientDataForCurrentUser();
    let terminateBanner=document.getElementById('terminationApprovedBanner');
    if(terminateClient?.terminationApprovedAt && terminateClient?.terminateAccessEndsAt){
      if(enforceTerminationAccessCutoff(terminateClient)){
        const ticket=tickets.find(item=>item.id===terminateClient.terminationTicketId);
        if(ticket) addTerminationNotification('accessClosed',ticket);
        saveData();
      }
      if(isTerminationAccessExpired(terminateClient)){
        if(terminateBanner) terminateBanner.remove();
        setTimeout(()=>{ alert('⛔ Akses portal ditutup pada hari ke-4 setelah Permintaan Terminate disetujui Admin dan Support.'); logoutUser(); },300);
      }else{
        if(!terminateBanner){
          terminateBanner=document.createElement('div');
          terminateBanner.id='terminationApprovedBanner';
          terminateBanner.style.cssText='position:fixed;top:64px;left:0;right:0;z-index:997;background:rgba(226,75,74,0.94);color:#fff;padding:10px 20px;text-align:center;font-size:12.5px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.28);';
          document.body.appendChild(terminateBanner);
        }
        const hours=getTerminationAccessRemainingHours(terminateClient);
        terminateBanner.textContent=`⛔ TERMINATE DISETUJUI ADMIN & SUPPORT — Akses ${currentUser.pt} ditutup dalam sekitar ${hours} jam (${formatTerminationDate(terminateClient.terminateAccessEndsAt)}).`;
        terminateBanner.style.display='block';
        if(terminationLogoutTimer) clearTimeout(terminationLogoutTimer);
        const wait=Math.max(0,new Date(terminateClient.terminateAccessEndsAt).getTime()-Date.now());
        terminationLogoutTimer=setTimeout(()=>{ alert('⛔ Masa akses terminate berakhir. Anda akan logout.'); logoutUser(); },Math.min(wait,2147483647));
      }
    }else if(terminateBanner){
      terminateBanner.remove();
    }
  }

  // Terminate warning: countdown mundur 7 hari live timer
  if(isClientBerhenti()){
    const remainingMs = getTerminationRemainingMs();
    const cl = getClientDataForCurrentUser();
    const baseTime = cl && (cl.berhentiAt || cl.terminatedAt || cl.terminateAccessEndsAt);
    const berhentiAt = baseTime ? new Date(baseTime).toLocaleString('id-ID') : '-';

    let berhentiBanner = document.getElementById('berhentiBanner');
    if(!berhentiBanner){
      berhentiBanner = document.createElement('div');
      berhentiBanner.id = 'berhentiBanner';
      berhentiBanner.style.cssText = 'position:fixed;top:64px;left:0;right:0;z-index:998;background:linear-gradient(90deg,rgba(185,28,28,0.97),rgba(220,38,38,0.97));border-bottom:2px solid #f87171;color:#fff;padding:0;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
      berhentiBanner.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap;justify-content:center;width:100%;">
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;">
            <span style="font-size:18px;">⛔</span>
            <span>AKUN TERMINATE — <b id="berhentiPtName"></b></span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:rgba(255,255,255,0.75);">
            <span>Mulai:</span>
            <span id="berhentiSinceDate" style="font-weight:600;color:#fca5a5;"></span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:12px;color:rgba(255,255,255,0.7);margin-right:6px;">Akses ditutup dalam:</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:4px 10px;text-align:center;min-width:44px;">
                <div id="berhentiCountDays" style="font-size:20px;font-weight:700;line-height:1;font-family:monospace;">0</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px;letter-spacing:0.5px;">HARI</div>
              </div>
              <span style="font-size:16px;font-weight:700;opacity:0.6;">:</span>
              <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:4px 10px;text-align:center;min-width:44px;">
                <div id="berhentiCountHours" style="font-size:20px;font-weight:700;line-height:1;font-family:monospace;">00</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px;letter-spacing:0.5px;">JAM</div>
              </div>
              <span style="font-size:16px;font-weight:700;opacity:0.6;">:</span>
              <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:4px 10px;text-align:center;min-width:44px;">
                <div id="berhentiCountMinutes" style="font-size:20px;font-weight:700;line-height:1;font-family:monospace;">00</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px;letter-spacing:0.5px;">MENIT</div>
              </div>
              <span style="font-size:16px;font-weight:700;opacity:0.6;">:</span>
              <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:4px 10px;text-align:center;min-width:44px;">
                <div id="berhentiCountSeconds" style="font-size:20px;font-weight:700;line-height:1;font-family:monospace;">00</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px;letter-spacing:0.5px;">DETIK</div>
              </div>
            </div>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.65);">Setelah itu akses portal ditutup permanen. Hubungi <b>Admin</b>.</div>
          <button onclick="this.parentElement.parentElement.style.display='none'" style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">✕</button>
        </div>`;
      document.body.appendChild(berhentiBanner);

      // Start live countdown interval
      if(!window._berhentiCountdownInterval){
        window._berhentiCountdownInterval = setInterval(()=>{
          const msLeft = getTerminationRemainingMs();
          const cd = formatCountdownMs(msLeft);
          const pad = n => String(n).padStart(2, '0');
          const dEl = document.getElementById('berhentiCountDays');
          const hEl = document.getElementById('berhentiCountHours');
          const mEl = document.getElementById('berhentiCountMinutes');
          const sEl = document.getElementById('berhentiCountSeconds');
          if(dEl) dEl.textContent = cd.days;
          if(hEl) hEl.textContent = pad(cd.hours);
          if(mEl) mEl.textContent = pad(cd.minutes);
          if(sEl) sEl.textContent = pad(cd.seconds);
          if(msLeft <= 0){
            clearInterval(window._berhentiCountdownInterval);
            window._berhentiCountdownInterval = null;
            setTimeout(()=>{ alert('⛔ Waktu 7 hari sejak Terminate habis. Akun Anda tidak bisa akses portal lagi.'); logoutUser(); }, 500);
          }
        }, 1000);
      }
    }

    // Update metadata fields
    const ptEl = document.getElementById('berhentiPtName');
    const sinceEl = document.getElementById('berhentiSinceDate');
    if(ptEl) ptEl.textContent = currentUser.pt;
    if(sinceEl) sinceEl.textContent = berhentiAt;

    // Force initial update
    const cd = formatCountdownMs(remainingMs);
    const pad = n => String(n).padStart(2, '0');
    const dEl = document.getElementById('berhentiCountDays');
    const hEl = document.getElementById('berhentiCountHours');
    const mEl = document.getElementById('berhentiCountMinutes');
    const sEl = document.getElementById('berhentiCountSeconds');
    if(dEl) dEl.textContent = cd.days;
    if(hEl) hEl.textContent = pad(cd.hours);
    if(mEl) mEl.textContent = pad(cd.minutes);
    if(sEl) sEl.textContent = pad(cd.seconds);

    berhentiBanner.style.display = remainingMs > 0 ? 'flex' : 'none';
    if(remainingMs <= 0){
      setTimeout(()=>{
        alert('⛔ Waktu 7 hari sejak Terminate habis. Akun Anda tidak bisa akses portal lagi.');
        logoutUser();
      }, 1000);
    }
  }else{
    const berhentiBanner = document.getElementById('berhentiBanner');
    if(berhentiBanner) berhentiBanner.style.display = 'none';
    if(window._berhentiCountdownInterval){
      clearInterval(window._berhentiCountdownInterval);
      window._berhentiCountdownInterval = null;
    }
  }

  try{ updateRackExcelButtonVisibility(); }catch(e){}
}

function getRackFloor(rack){
  if(!rack) return '';
  if(rack.lantai) return rack.lantai;
  const match=String(rack.lokasi||'').match(/Lantai\s*\d+/i);
  return match ? match[0].replace(/\s+/g,' ').replace(/lantai/i,'Lantai') : '';
}

function getRackFromReference(reference){
  const text=String(reference||'').toLowerCase();
  return racks.find(rack=>text.includes(String(rack.id||'').toLowerCase())) || null;
}

function matchesGlobalFloorByRack(rack){
  return globalFloorFilter==='all' || getRackFloor(rack)===globalFloorFilter;
}

function clientMatchesGlobalFloor(client){
  if(globalFloorFilter==='all') return true;
  const rack=getRackFromReference(client?.lokasi);
  return rack ? getRackFloor(rack)===globalFloorFilter : String(client?.lokasi||'').includes(globalFloorFilter);
}

function ticketMatchesGlobalFloor(ticket){
  if(globalFloorFilter==='all') return true;
  const refs=[ticket?.rack,ticket?.titikA,ticket?.titikB,ticket?.devPos];
  const related=refs.map(getRackFromReference).filter(Boolean);
  const clientRack=getRackFromReference(clients.find(c=>c.id===ticket?.clientId)?.lokasi);
  if(clientRack) related.push(clientRack);
  return related.some(rack=>getRackFloor(rack)===globalFloorFilter);
}

function crossConnectMatchesGlobalFloor(connection){
  if(globalFloorFilter==='all') return true;
  const refs=[connection?.titikA,connection?.titikB];
  const related=refs.map(getRackFromReference).filter(Boolean);
  const clientRack=getRackFromReference(clients.find(c=>c.id===connection?.clientId)?.lokasi);
  if(clientRack) related.push(clientRack);
  return related.some(rack=>getRackFloor(rack)===globalFloorFilter);
}

function populateFloorControls(){
  const names=[...new Set(floors.map(f=>f.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const filter=document.getElementById('rackFloorFilter');
  if(filter){
    filter.innerHTML='<option value="all">-</option>'+names.map(name=>`<option value="${escapeAccountHtml(name)}">${escapeAccountHtml(name)}</option>`).join('');
    filter.value=names.includes(globalFloorFilter)?globalFloorFilter:'all';
  }
  const rackFloor=document.getElementById('r_info_floor');
  if(rackFloor){
    const selected=rackFloor.value;
    rackFloor.innerHTML='<option value="">-- Pilih Lantai --</option>'+names.map(name=>`<option value="${escapeAccountHtml(name)}">${escapeAccountHtml(name)}</option>`).join('');
    rackFloor.value=names.includes(selected)?selected:'';
  }
}

function updateGlobalFloorIndicators(){
  const ids=['inventoryFloorFilterIndicator','ticketsFloorFilterIndicator','crossconnectFloorFilterIndicator'];
  ids.forEach(id=>{
    const indicator=document.getElementById(id);
    if(!indicator) return;
    if(globalFloorFilter==='all'){indicator.style.display='none';indicator.innerHTML='';}
    else{indicator.style.display='inline-flex';indicator.innerHTML=`Filter: ${escapeAccountHtml(globalFloorFilter)} <button type="button" onclick="clearGlobalFloorFilter()">×</button>`;}
  });
}

function setGlobalFloorFilter(floor){
  globalFloorFilter=floor||'all';
  localStorage.setItem('il_global_floor_filter',globalFloorFilter);
  populateFloorControls();
  renderRacks(); renderClients(); renderTickets(); renderCrossConnects();
  if(selectedClientId && !clientMatchesGlobalFloor(clients.find(c=>c.id===selectedClientId))) closeClientDetail();
  updateGlobalFloorIndicators();
}

function clearGlobalFloorFilter(){ setGlobalFloorFilter('all'); }

function resetRackFilters(){
  const searchInput = document.getElementById('rackSearch');
  if(searchInput) searchInput.value = '';
  const statusFilter = document.getElementById('rackStatusFilter');
  if(statusFilter) statusFilter.value = 'all';
  const typeFilter = document.getElementById('rackTypeFilter');
  if(typeFilter) typeFilter.value = 'all';
  currentRackFilter = 'all';
  currentRackTypeFilter = 'all';
  setGlobalFloorFilter('all');
}

function openFloorModal(){
  if(!isAdmin()){alert('Hanya Admin yang bisa menambah lantai.');return;}
  document.getElementById('fl_name').value='';document.getElementById('fl_area').value='';document.getElementById('fl_capacity').value='';
  document.getElementById('fl_name_error').textContent='';
  const msg=document.getElementById('floorFormMessage');msg.style.display='none';msg.textContent='';
  document.getElementById('modalFloor').classList.add('show');
}

async function saveFloor(){
  if(!isAdmin()){alert('Hanya Admin yang bisa menambah lantai.');return;}
  const name=document.getElementById('fl_name').value.trim().replace(/\s+/g,' ');
  const area=document.getElementById('fl_area').value.trim();
  const capacity=parseInt(document.getElementById('fl_capacity').value)||null;
  const error=document.getElementById('fl_name_error');error.textContent='';
  if(!name){error.textContent='Nama lantai wajib diisi.';return;}
  if(floors.some(f=>f.name.toLowerCase()===name.toLowerCase())){error.textContent='Nama lantai sudah terdaftar.';return;}
  
  const newFloor = {name, area, maxRacks:capacity};
  floors.push(newFloor);
  
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    await fetch('/api/floors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(newFloor)
    });
  } catch(e) {
    console.error('Error posting floor:', e);
  }

  saveData();
  closeModal('modalFloor');
  setGlobalFloorFilter(name);
  if(typeof showAccountToast==='function') showAccountToast(`Lantai "${name}" berhasil ditambahkan.`);
}

function setClientFilter(f){
  currentFilter = f;
  const clientStatusDropdown=document.getElementById('clientStatusFilter');
  if(clientStatusDropdown) clientStatusDropdown.value=f;
  document.querySelectorAll('.chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.filter===f);
  });
  renderClients();
}

function renderClients(){
  updateGlobalFloorIndicators();
  const thClientAksi = document.getElementById('thClientAksi');
  if (thClientAksi) thClientAksi.style.setProperty('display', isClient() ? 'none' : 'table-cell', 'important');
  const tbody = document.getElementById('clientTableBody');
  if(!tbody) return;
  const q = (document.getElementById('clientSearch')?.value||'').toLowerCase();
  let baseClients = clients.filter(clientMatchesGlobalFloor);
  // ROLE FILTER: client hanya lihat client sendiri
  if(isClient()){
    baseClients = clients.filter(cl=> cl.id===currentUser.clientId);
  }
  const filtered = baseClients.filter(c=>{
    const matchQ = !q || (c.pt.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.layanan.toLowerCase().includes(q) || c.lokasi.toLowerCase().includes(q));
    const matchF = currentFilter==='all' || c.status===currentFilter;
    return matchQ && matchF;
  });
  document.getElementById('clientCountInfo').textContent = `${filtered.length} Klien`;
  const btnAddClient = document.getElementById('btnAddClient');
  if (btnAddClient) btnAddClient.style.display = isClient() ? 'none' : 'inline-flex';
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) btnExportData.style.display = isClient() ? 'none' : 'inline-flex';

  tbody.innerHTML = '';
  if(filtered.length===0){
    const colSpan = isClient() ? 9 : 10;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:32px;color:var(--text-dim);">Tidak ada klien ditemukan</td></tr>`;
    return;
  }
  let clientsHtml = '';
  filtered.forEach(c=>{
    const masukCount = devices.filter(d=>d.clientId===c.id && d.type==='masuk' && !d.exited).length;
    const keluarCount = devices.filter(d=>d.clientId===c.id && d.type==='keluar').length;
    const aktifCount = devices.filter(d=>d.clientId===c.id && d.type==='masuk' && !d.exited).reduce((a,b)=>a+b.jumlah,0);
    let badgeClass='ok';
    if(c.status==='Jatuh tempo') badgeClass='warn';
    if(c.status==='Suspend') badgeClass='crit';
    if(c.status==='Terminate') badgeClass='crit';
    if(c.status==='Prospek') badgeClass='info';
    clientsHtml += `
      <tr style="cursor:pointer;" onclick="openClientDetail('${escapeHtml(c.id)}')">
        <td class="item-name">${escapeHtml(c.id)}</td>
        <td><span class="clickable-pt" style="color:#fff;font-weight:600;">${escapeHtml(c.pt)}</span></td>
        <td>${escapeHtml(c.layanan)}</td>
        <td>${c.layanan === 'Colocation - Per U' ? (c.u ? 'U: ' + escapeHtml(c.u) : '-') : (escapeHtml(c.power) || '-')}</td>
        <td>${escapeHtml(c.lokasi)} <span style="font-size:10px;color:var(--text-dim);">(${getRackFloor(getRackFromReference(c.lokasi))||'-'})</span></td>
        <td><span class="badge cyan">${masukCount} item</span></td>
        <td><span class="badge info">${keluarCount} item</span></td>
        <td><span class="item-name">${aktifCount} unit</span></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(c.status)}</span></td>
        ${isClient() ? '' : `
          <td onclick="event.stopPropagation();">
            <div style="display:flex;gap:6px;">
              ${isAdmin() ? `<button class="action-icon" title="Edit Klien" onclick="openAddClientModal('${escapeHtml(c.id)}')">✏️</button>` : `<button class="action-icon" title="Lihat Perangkat" onclick="openClientDetail('${escapeHtml(c.id)}')">👁</button>`}
              <button class="action-icon" title="Tambah Masuk" onclick="quickAddDevice('${escapeHtml(c.id)}','masuk')">📥</button>
              <button class="action-icon" title="Tambah Keluar" onclick="quickAddDevice('${escapeHtml(c.id)}','keluar')">📤</button>
              ${isAdmin() ? `<button class="action-icon danger" title="Hapus Klien" onclick="deleteClient('${escapeHtml(c.id)}')">🗑</button>` : ''}
            </div>
          </td>
        `}
      </tr>`;
  });
  tbody.innerHTML = clientsHtml;
}

function openClientDetail(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  if(isClient() && client.id!==currentUser.clientId){
    alert('Akun Client hanya dapat melihat data miliknya sendiri.');
    return;
  }
  selectedClientId = clientId;
  document.getElementById('inventory-list-view').style.display='none';
  const detailView = document.getElementById('inventory-detail-view');
  detailView.classList.add('show');
  detailView.style.display='block';

  // Tombol kembali tetap tampil untuk semua role termasuk client (biar bisa balik)
  const backBtn = detailView.querySelector('.detail-back');
  if(backBtn){
    backBtn.style.display = '';
    // Untuk client, ubah text jadi lebih jelas
    if(isClient()){
      backBtn.textContent = '‹ Kembali';
      backBtn.title = 'Kembali ke daftar';
    }else{
      backBtn.textContent = '‹ Kembali ke Daftar Klien';
    }
  }

  const masuk = devices.filter(d=>d.clientId===clientId && d.type==='masuk' && !d.exited);
  const keluar = devices.filter(d=>d.clientId===clientId && d.type==='keluar');
  const semuaMasuk = devices.filter(d=>d.clientId===clientId && d.type==='masuk');
  
  const masukUnits = masuk.reduce((a,b)=>a+(parseInt(b.jumlah)||1), 0);
  const keluarUnits = keluar.reduce((a,b)=>a+(parseInt(b.jumlah)||1), 0);
  const semuaMasukUnits = semuaMasuk.reduce((a,b)=>a+(parseInt(b.jumlah)||1), 0);

  const semuaMasukBerat = semuaMasuk.reduce((a,b)=>a + (getDeviceBerat(b) * (parseInt(b.jumlah)||1)), 0);
  const keluarBerat = keluar.reduce((a,b)=>a + (getDeviceBerat(b) * (parseInt(b.jumlah)||1)), 0);
  const aktifBerat = masuk.reduce((a,b)=>a + (getDeviceBerat(b) * (parseInt(b.jumlah)||1)), 0);
  const aktifUnits = masukUnits;

  // Badge class untuk status termasuk Terminate
  let statusBadgeClass='ok';
  if(client.status==='Jatuh tempo') statusBadgeClass='warn';
  if(client.status==='Suspend' || client.status==='Terminate') statusBadgeClass='crit';
  if(client.status==='Prospek') statusBadgeClass='info';

  // Format PIC badges
  const picsList = String(client.pic||'').split(/[\r\n]+/).map(p=>p.trim()).filter(Boolean);
  const picsHtml = picsList.length > 0
    ? picsList.map(p => `
        <span class="pic-badge-pill" style="display:inline-flex; align-items:center; gap:6px; background:rgba(30, 41, 59, 0.85); border:1px solid rgba(255, 255, 255, 0.12); border-radius:18px; padding:3px 10px 3px 6px; font-size:12px; color:var(--text); font-weight:500; box-shadow:0 1px 3px rgba(0,0,0,0.2); transition:all 0.2s ease;">
          <span style="background:rgba(59,130,246,0.25); color:#60a5fa; width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0;">👤</span>
          <span>${escapeHtml(p)}</span>
        </span>
      `).join('')
    : `<span style="font-size:12px; color:var(--text-dim);">-</span>`;

  const clientMaxBerat = (client.maxBerat && !isNaN(parseFloat(client.maxBerat)) && parseFloat(client.maxBerat) > 0) ? parseFloat(client.maxBerat) : 173;

  document.getElementById('clientHeaderCard').innerHTML = `
    <div class="client-info" style="flex:1;">
      <h3 style="margin:0 0 6px;">${escapeHtml(client.pt)} <span class="badge ${statusBadgeClass}">${escapeHtml(client.status)}</span></h3>
      ${(() => {
        if(client.status !== 'Terminate') return '';
        const baseTime = client.berhentiAt || client.terminatedAt || client.terminateAccessEndsAt;
        if(!baseTime) return `<div style="margin-top:8px;background:rgba(226,75,74,0.12);border:1px solid rgba(226,75,74,0.3);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#f09595;">⛔ Akun BERHENTI LANGGANAN - Ditentukan oleh Admin. Akses terbatas. Hubungi Admin untuk reaktivasi.</div>`;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const baseTs = new Date(baseTime).getTime();
        const deadlineTs = baseTs + sevenDaysMs;
        const msLeft = Math.max(0, deadlineTs - Date.now());
        const uid = 'cd_' + client.id.replace(/[^a-zA-Z0-9]/g,'_');
        const deadlineStr = new Date(deadlineTs).toLocaleString('id-ID');
        const pad = n => String(n).padStart(2,'0');
        const totalSec = Math.floor(msLeft / 1000);
        const initD = Math.floor(totalSec / 86400);
        const initH = Math.floor((totalSec % 86400) / 3600);
        const initM = Math.floor((totalSec % 3600) / 60);
        const initS = totalSec % 60;
        setTimeout(() => {
          if(window['_cdInterval_' + uid]) { clearInterval(window['_cdInterval_' + uid]); }
          window['_cdInterval_' + uid] = setInterval(() => {
            const rem = Math.max(0, deadlineTs - Date.now());
            const sec = Math.floor(rem / 1000);
            const dEl = document.getElementById(uid + '_d');
            const hEl = document.getElementById(uid + '_h');
            const mEl = document.getElementById(uid + '_m');
            const sEl = document.getElementById(uid + '_s');
            if(!dEl) { clearInterval(window['_cdInterval_' + uid]); return; }
            const p = n => String(n).padStart(2,'0');
            dEl.textContent = Math.floor(sec / 86400);
            hEl.textContent = p(Math.floor((sec % 86400) / 3600));
            mEl.textContent = p(Math.floor((sec % 3600) / 60));
            sEl.textContent = p(sec % 60);
            if(rem <= 0) { clearInterval(window['_cdInterval_' + uid]); }
          }, 1000);
        }, 0);
        return `<div style="margin-top:10px;background:rgba(185,28,28,0.14);border:1px solid rgba(226,75,74,0.35);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#f87171;">⛔ AKUN TERMINATE</div>
          <div style="font-size:11px;color:rgba(248,113,113,0.8);">Akses otomatis ditutup pada: <b style="color:#fca5a5;">${deadlineStr}</b></div>
          <div style="display:flex;align-items:center;gap:4px;margin-left:auto;">
            <span style="font-size:11px;color:rgba(255,255,255,0.5);margin-right:4px;">Sisa:</span>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(226,75,74,0.3);border-radius:6px;padding:3px 8px;text-align:center;min-width:36px;">
              <div id="${uid}_d" style="font-size:16px;font-weight:700;line-height:1;font-family:monospace;color:#f87171;">${initD}</div>
              <div style="font-size:8px;color:rgba(255,255,255,0.45);margin-top:1px;">HARI</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:rgba(248,113,113,0.5);">:</span>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(226,75,74,0.3);border-radius:6px;padding:3px 8px;text-align:center;min-width:36px;">
              <div id="${uid}_h" style="font-size:16px;font-weight:700;line-height:1;font-family:monospace;color:#f87171;">${pad(initH)}</div>
              <div style="font-size:8px;color:rgba(255,255,255,0.45);margin-top:1px;">JAM</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:rgba(248,113,113,0.5);">:</span>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(226,75,74,0.3);border-radius:6px;padding:3px 8px;text-align:center;min-width:36px;">
              <div id="${uid}_m" style="font-size:16px;font-weight:700;line-height:1;font-family:monospace;color:#f87171;">${pad(initM)}</div>
              <div style="font-size:8px;color:rgba(255,255,255,0.45);margin-top:1px;">MENIT</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:rgba(248,113,113,0.5);">:</span>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(226,75,74,0.3);border-radius:6px;padding:3px 8px;text-align:center;min-width:36px;">
              <div id="${uid}_s" style="font-size:16px;font-weight:700;line-height:1;font-family:monospace;color:#f87171;">${pad(initS)}</div>
              <div style="font-size:8px;color:rgba(255,255,255,0.45);margin-top:1px;">DETIK</div>
            </div>
          </div>
        </div>`;
      })()}
      ${client.status==='Suspend' ? `<div style="margin-top:8px;background:rgba(226,75,74,0.12);border:1px solid rgba(226,75,74,0.3);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#f09595;">⚠ Akun SUSPEND - Ditentukan oleh Admin. Segera hubungi Admin.</div>` : ''}
      ${client.status==='Jatuh tempo' ? `<div style="margin-top:8px;background:rgba(186,117,23,0.12);border:1px solid rgba(186,117,23,0.3);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#ef9f27;">⏰ Akun JATUH TEMPO - Mohon segera lakukan pembayaran. Ditentukan oleh Admin.</div>` : ''}
      <div class="client-sub">
        <span>🆔 ${escapeHtml(client.id)}</span>
        <span>📍 ${escapeHtml(client.lokasi)} • ${escapeHtml(client.layanan)}</span>
        <span>${client.layanan === 'Colocation - Per U' ? '📏 ' + (escapeHtml(client.u) || '-') : '⚡ ' + (escapeHtml(client.power) || '-')}</span>
        <span>✉ ${escapeHtml(client.email||'-')}</span>
      </div>

      <div class="client-pic-section" style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="font-size:12px; font-weight:600; color:var(--text-dim); display:inline-flex; align-items:center; gap:4px; flex-shrink:0;">👥 Kontak PIC:</span>
        <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          ${picsHtml}
        </div>
      </div>
      ${isAdmin() ? `
        <div style="margin-top:10px;">
          <button type="button" class="page-action secondary" style="height:32px;font-size:11.5px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;" onclick="openAddClientModal('${escapeAccountHtml(client.id)}')">
            ✏️ Edit Client
          </button>
        </div>
      ` : ''}
    </div>
    <div class="client-stats">
      <div class="mini-stat"><div class="ms-label">Perangkat Masuk</div><div class="ms-value cyan">${semuaMasukUnits}</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">${semuaMasukBerat.toFixed(1)} Kg</div></div>
      <div class="mini-stat"><div class="ms-label">Perangkat Keluar</div><div class="ms-value orange">${keluarUnits}</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">${keluarBerat.toFixed(1)} Kg</div></div>
      <div class="mini-stat"><div class="ms-label">Aktif di DC</div><div class="ms-value ${aktifBerat > clientMaxBerat ? 'crit' : 'green'}">${aktifUnits} unit ${aktifBerat > clientMaxBerat ? '⚠️' : ''}</div><div style="font-size:10px;color:${aktifBerat > clientMaxBerat ? '#e24b4a' : '#5dcaa5'};margin-top:4px;font-weight:600;">${aktifBerat.toFixed(1)} Kg / ${clientMaxBerat} Kg</div></div>
    </div>
  `;
  document.getElementById('countMasuk').textContent = semuaMasukUnits;
  document.getElementById('countKeluar').textContent = keluarUnits;

  switchDeviceTab(currentDeviceTab);
}

function closeClientDetail(){
  selectedClientId=null;
  document.getElementById('inventory-detail-view').style.display='none';
  document.getElementById('inventory-detail-view').classList.remove('show');
  document.getElementById('inventory-list-view').style.display='block';
  renderClients();
}

function switchDeviceTab(tab){
  currentDeviceTab = tab;
  document.querySelectorAll('.device-tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab===tab);
  });
  const btnAdd = document.getElementById('btnAddDevice');
  const btnKeluarPick = document.getElementById('btnAddKeluar');
  btnAdd.onclick = ()=>quickAddDevice(selectedClientId, currentDeviceTab);
  if(tab==='masuk'){
    btnAdd.innerHTML=canManageInventory()?'+ Tambah Perangkat Masuk':'🎫 Ajukan Perangkat Masuk';
    btnAdd.style.background='var(--blue)';
    if(btnKeluarPick) btnKeluarPick.style.display='none';
  }else{
    btnAdd.innerHTML=canManageInventory()?'+ Catat Perangkat Keluar Manual':'🎫 Ajukan Perangkat Keluar';
    btnAdd.style.background='var(--orange)';
    if(btnKeluarPick){
      // Untuk client, tombol + Catat Keluar dihapus (harus via tiket)
      if(isClient()){
        btnKeluarPick.style.display='none';
      }else{
        btnKeluarPick.style.display='inline-flex';
      }
    }
  }
  renderDevices();
}

function renderDevices(){
  if(!selectedClientId) return;
  const tbody = document.getElementById('deviceTableBody');
  const thead = document.getElementById('deviceTableHead');
  const search = document.getElementById('deviceSearch').value.toLowerCase();
  const katFilter = document.getElementById('deviceKategoriFilter').value;
  let list = devices.filter(d=>d.clientId===selectedClientId && d.type===currentDeviceTab);
  if(currentDeviceTab==='masuk'){
    list = list.filter(d=>!d.exited);
  }
  list = list.filter(d=>{
    const matchSearch = !search || (d.nama.toLowerCase().includes(search) || d.sn.toLowerCase().includes(search) || d.kategori.toLowerCase().includes(search) || d.rackPos.toLowerCase().includes(search));
    const matchKat = katFilter==='all' || d.kategori===katFilter;
    return matchSearch && matchKat;
  });

  if(currentDeviceTab==='masuk'){
    thead.innerHTML = '<tr><th>Nama Perangkat</th><th>Kategori</th><th>SN / Asset</th><th>Rack Position</th><th>Berat</th><th>Kondisi</th><th>Tgl Masuk</th><th>Keterangan</th><th>Aksi</th></tr>';
  }else{
    thead.innerHTML = '<tr><th>Nama Perangkat</th><th>Kategori</th><th>SN</th><th>Berat</th><th>Tgl Masuk Awal</th><th>Tgl Keluar</th><th>Alasan</th><th>Kondisi</th><th>Aksi</th></tr>';
  }

  const btnAdd = document.getElementById('btnAddDevice');
  const btnKeluar = document.getElementById('btnAddKeluar');
  
  if(isAdmin() || isSupport()) {
    if(btnAdd) btnAdd.style.display = 'none';
    if(btnKeluar) btnKeluar.style.display = 'none';
  } else {
    const clDataDev = (isClient() || isSubclient()) ? clients.find(cl => cl.id === currentUser.clientId) : null;
    const clSt = clDataDev ? clDataDev.status : null;
    const isSusp = clSt === 'Suspend';
    const isTerm = clSt === 'Terminate' || clSt === 'Terminated';
    const isHoldSt = clSt === 'Hold' || isHold;
    if(btnAdd){
      const perm = currentDeviceTab === 'keluar' ? 'inventory_keluar' : 'inventory_masuk';
      const allowKeluar = !isSusp && !isTerm && !isHoldSt && checkPermission(currentUser.role, 'inventory_keluar');
      const allowMasuk  = !isSusp && !isTerm && checkPermission(currentUser.role, 'inventory_masuk');
      btnAdd.style.display = ((currentDeviceTab === 'keluar' ? allowKeluar : allowMasuk)) ? 'inline-block' : 'none';
    }
    if(btnKeluar) btnKeluar.style.display = 'none'; // client uses ticket only
  }

  const emptyState = document.getElementById('deviceEmptyState');
  const tableWrap = document.getElementById('deviceTableWrap');

  if(list.length===0){
    tableWrap.style.display='none';
    emptyState.style.display='block';
    document.getElementById('emptyTitle').textContent = currentDeviceTab==='masuk' ? 'Belum ada perangkat masuk' : 'Belum ada perangkat keluar';
    document.getElementById('emptyDesc').textContent = currentDeviceTab==='masuk' ? 'Tambahkan perangkat yang baru masuk ke data center untuk klien ini beserta tanggal masuknya.' : 'Catat perangkat yang keluar dari data center.';
    const emptyBtn = emptyState.querySelector('button');
    if(emptyBtn) {
      const perm = currentDeviceTab === 'keluar' ? 'inventory_keluar' : 'inventory_masuk';
      emptyBtn.style.display = (checkPermission(currentUser.role, perm) || canManageInventory()) ? 'block' : 'none';
    }
    return;
  }else{
    tableWrap.style.display='block';
    emptyState.style.display='none';
  }

  tbody.innerHTML='';
  let invHtml = '';
  list.forEach(function(d){
    const tglMasukFmt = d.tglMasuk ? new Date(d.tglMasuk).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '-';
    if(currentDeviceTab==='masuk'){
      const ticketBadge = d.ticketStatus==='Diproses' ? '<span class="badge warn" style="margin-left:6px;">DIPROSES</span>' : d.ticketStatus==='Menunggu Approval' ? '<span class="badge info" style="margin-left:6px;">MENUNGGU</span>' : d.ticketStatus==='Disetujui' ? '<span class="badge info" style="margin-left:6px;">DISETUJUI</span>' : '';
      const beratPerUnit = getDeviceBerat(d);
      invHtml += '<tr><td class="item-name">' + escapeHtml(d.nama) + ' ' + ticketBadge + (d.exited?'<span class="badge crit" style="margin-left:6px;">Sudah Keluar</span>':'') + '</td><td><span class="device-type-badge in">' + escapeHtml(d.kategori) + '</span></td><td style="font-family:var(--font-mono);font-size:12px;line-height:1.5;">' + renderSNCell(d.sn, d.jumlah) + '</td><td>' + escapeHtml(d.rackPos||'-') + '</td><td style="font-family:var(--font-mono);text-align:center;">' + formatBeratDisplay(beratPerUnit) + '</td><td><span class="badge ' + (d.kondisi==='Baik'||d.kondisi==='Baru'?'ok':d.kondisi==='Rusak'?'crit':d.kondisi==='Menunggu'?'info':'warn') + '">' + escapeHtml(d.kondisi) + '</span></td><td style="font-family:var(--font-mono);white-space:nowrap;">' + tglMasukFmt + '</td><td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(d.ket||'-') + ' ' + (d.ticketId? '<span style="font-family:var(--font-mono);font-size:10px;color:var(--cyan);">• '+escapeHtml(d.ticketId)+'</span>':'') + '</td><td><div style="display:flex;gap:6px;flex-wrap:nowrap;">' + (checkPermission(currentUser.role, 'inventory_keluar') ? '<button class="action-icon" title="Keluarkan via Tiket" onclick="markExit(\'' + d.id + '\')">📤</button>' : '') + '' + (canManageInventory() ? '<button class="action-icon" title="Edit" onclick="editDevice(\''+d.id+'\')">✏️</button><button class="action-icon danger" title="Hapus" onclick="deleteDevice(\''+d.id+'\')">🗑</button>' : '<span style="font-size:10px;color:var(--text-dim);padding:6px;white-space:nowrap;">Ticket required</span>') + '</div></td></tr>';
    }else{
      const tglKeluarFmt = d.tglKeluar ? new Date(d.tglKeluar).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '-';
      const beratKeluarPerUnit = getDeviceBerat(d);
      invHtml += '<tr><td class="item-name">' + escapeHtml(d.nama) + '</td><td><span class="device-type-badge out">' + escapeHtml(d.kategori) + '</span></td><td style="font-family:var(--font-mono);font-size:12px;line-height:1.5;">' + renderSNCell(d.sn, d.jumlah) + '</td><td style="font-family:var(--font-mono);text-align:center;">' + formatBeratDisplay(beratKeluarPerUnit) + '</td><td style="font-family:var(--font-mono);white-space:nowrap;">' + tglMasukFmt + '</td><td style="font-family:var(--font-mono);white-space:nowrap;font-weight:600;color:var(--orange);">' + tglKeluarFmt + '</td><td>' + escapeHtml(d.alasan||'-') + '</td><td><span class="badge ' + (d.kondisi==='Baik'||d.kondisi==='Baru'?'ok':d.kondisi==='Rusak'?'crit':'warn') + '">' + escapeHtml(d.kondisi) + '</span></td><td><div style="display:flex;gap:6px;">' + (canManageInventory() ? '<button class="action-icon" title="Edit" onclick="editDevice(\''+d.id+'\')">✏️</button><button class="action-icon danger" title="Hapus" onclick="deleteDevice(\''+d.id+'\')">🗑</button>' : '<span style="font-size:10px;color:var(--text-dim);padding:6px;">Ticket required</span>') + '</div></td></tr>';
    }
  });
  tbody.innerHTML = invHtml;
}

function openNotificationTicket(ticketId){
  closeModal('modalTopbarInfo');
  
  // Mark as read when clicked/opened
  const notif = terminationNotifications.find(n => n.ticketId === ticketId);
  if(notif && currentUser){
    const userIdOrRole = currentUser.id || currentUser.email || currentUser.role;
    notif.readBy = Array.isArray(notif.readBy) ? notif.readBy : [];
    if(!notif.readBy.includes(userIdOrRole)) notif.readBy.push(userIdOrRole);
    if(!notif.readBy.includes(currentUser.role)) notif.readBy.push(currentUser.role);
    saveTerminationNotifications();
    updateNotificationUI();
  }

  const ticket=tickets.find(item=>item.id===ticketId);
  document.querySelector('[data-page=tickets]')?.click();
  // Clear staff filters so the notified ticket is always visible.
  currentTicketTypeFilter='all';
  currentTicketStatusFilter='all';
  document.querySelectorAll('[data-tfilter]').forEach(chip=>chip.classList.toggle('active',chip.dataset.tfilter==='all'));
  document.querySelectorAll('[data-tstatus]').forEach(chip=>chip.classList.toggle('active',chip.dataset.tstatus==='all'));
  renderTickets();
  setTimeout(()=>{
    const card=[...document.querySelectorAll('#ticketList .ticket-card')].find(element=>element.textContent.includes('#'+ticketId));
    if(card){
      card.classList.add('notification-ticket-target');
      if(typeof card.scrollIntoView==='function') card.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>card.classList.remove('notification-ticket-target'),3600);
    }else if(!ticket){
      alert(`Ticket ${ticketId} sudah tidak tersedia.`);
    }
  },80);
}

function renderPicInputs(picString) {
  const container = document.getElementById('picInputsContainer');
  if (!container) {
    const fallback = document.getElementById('c_pic');
    if (fallback) fallback.value = picString || '';
    return;
  }
  container.innerHTML = '';
  const pics = (picString || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  if (pics.length === 0) {
    pics.push('');
  }
  pics.forEach((val, idx) => {
    addPicRow(val, idx === 0);
  });
  updatePicRemoveButtons();
}

function addPicRow(initialVal = '', isFirst = false) {
  const container = document.getElementById('picInputsContainer');
  if (!container) return;

  const rowCount = container.querySelectorAll('.pic-input-row').length;
  const shouldBeFirst = isFirst || rowCount === 0;

  const row = document.createElement('div');
  row.className = 'pic-input-row';
  row.style.cssText = 'display:flex; gap:8px; align-items:center;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input pic-field';
  if (shouldBeFirst) {
    input.id = 'c_pic';
  }
  input.placeholder = 'Nama & No HP PIC (mis: Budi - 081234567890)';
  input.value = initialVal;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-pic';
  removeBtn.title = 'Hapus PIC';
  removeBtn.innerHTML = '✕';
  removeBtn.style.cssText = 'background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:6px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; flex-shrink:0; transition:all 0.2s ease;';
  removeBtn.onclick = function() { removePicRow(this); };

  row.appendChild(input);
  row.appendChild(removeBtn);
  container.appendChild(row);

  updatePicRemoveButtons();

  if (initialVal === '' && !shouldBeFirst) {
    input.focus();
  }
}

function removePicRow(btn) {
  const container = document.getElementById('picInputsContainer');
  if (!container) return;

  const row = btn.closest('.pic-input-row');
  if (row) {
    row.remove();
  }

  const rows = container.querySelectorAll('.pic-input-row');
  if (rows.length === 0) {
    addPicRow('', true);
  } else {
    const firstInput = rows[0].querySelector('.pic-field');
    if (firstInput && firstInput.id !== 'c_pic') {
      firstInput.id = 'c_pic';
    }
  }

  updatePicRemoveButtons();
}

function updatePicRemoveButtons() {
  const container = document.getElementById('picInputsContainer');
  if (!container) return;
  const rows = container.querySelectorAll('.pic-input-row');
  rows.forEach(r => {
    const btn = r.querySelector('.btn-remove-pic');
    if (btn) {
      btn.style.display = rows.length > 1 ? 'flex' : 'none';
    }
  });
}

function getPicValue() {
  const container = document.getElementById('picInputsContainer');
  if (!container) {
    const fallback = document.getElementById('c_pic');
    return fallback ? fallback.value.trim() : '';
  }
  const inputs = container.querySelectorAll('.pic-field');
  const values = [];
  inputs.forEach(inp => {
    const v = inp.value.trim();
    if (v) values.push(v);
  });
  return values.join('\n');
}

function openAddClientModal(editId=null){
  if(isClient()){
    alert('Maaf, akun Client tidak bisa tambah/edit Client. Status hanya bisa diatur oleh Admin.');
    return;
  }
  if(isSupport() && editId){
    // Support boleh edit tapi tidak boleh ubah status - akan di-disable
  }
  const modal = document.getElementById('modalClient');
  // reset or fill
  if(editId){
    const c = clients.find(x=>x.id===editId);
    if(!c) return;
    document.getElementById('c_id').value = c.id;
    document.getElementById('c_id').disabled = true;
    document.getElementById('c_pt').value = c.pt;
    document.getElementById('c_layanan').value = c.layanan||'Colocation Full Rack';
    document.getElementById('c_power').value = c.power||'';
    let uDari = '';
    let uSampai = '';
    if (c.u) {
      const match = c.u.match(/U(\d+)(?:\s*-\s*U(\d+))?/i);
      if (match) {
        uDari = match[1] || '';
        uSampai = match[2] || match[1] || '';
      } else {
        const parts = c.u.replace(/[^0-9-]/g, '').split('-').filter(Boolean);
        if (parts && parts.length >= 2) {
          uDari = parts[0];
          uSampai = parts[1];
        } else if (parts && parts.length === 1) {
          uDari = parts[0];
          uSampai = parts[0];
        }
      }
    }
    document.getElementById('c_u_dari').value = uDari;
    document.getElementById('c_u_sampai').value = uSampai;
    onClientLayananChange();
    document.getElementById('c_lokasi').value = c.lokasi;
    document.getElementById('c_status').value = c.status;
    renderPicInputs(c.pic||'');
    document.getElementById('c_email').value = c.email||'';
    document.getElementById('c_telp').value = c.telp||'';
    document.getElementById('c_max_berat').value = c.maxBerat || 173;
    document.getElementById('c_ket').value = c.ket||'';
    modal.dataset.editing = editId;
  }else{
    if(!isAdmin()){
      alert('Hanya Admin yang bisa tambah Client baru. Status akan ditentukan oleh Admin.');
      return;
    }
    document.getElementById('c_id').value = `RCK-${String.fromCharCode(65+Math.floor(Math.random()*6))}${Math.floor(Math.random()*20).toString().padStart(2,'0')}-${String(clients.length+1).padStart(2,'0')}`;
    document.getElementById('c_id').disabled = false;
    document.getElementById('c_pt').value = '';
    document.getElementById('c_lokasi').value = '';
    document.getElementById('c_power').value = '';
    document.getElementById('c_u_dari').value = '';
    document.getElementById('c_u_sampai').value = '';
    onClientLayananChange();
    renderPicInputs('');
    document.getElementById('c_email').value = '';
    document.getElementById('c_telp').value = '';
    document.getElementById('c_max_berat').value = 173;
    document.getElementById('c_ket').value = '';
    document.getElementById('c_status').value = 'Aktif';
    document.getElementById('c_layanan').value = 'Colocation Full Rack';
    modal.dataset.editing = '';
  }
  
  populateClientFloorRackSelectors();

  // Admin only untuk status
  const statusEl = document.getElementById('c_status');
  const statusNote = document.getElementById('c_status_admin_note');
  if(statusEl){
    if(!isAdmin()){
      statusEl.disabled = true;
      statusEl.style.opacity = '0.6';
      if(statusNote) statusNote.style.display = 'block';
    }else{
      statusEl.disabled = false;
      statusEl.style.opacity = '1';
      if(statusNote) statusNote.style.display = 'none';
    }
  }
  modal.classList.add('show');
}

function populateClientFloorRackSelectors() {
  const floorSelect = document.getElementById('c_floor_select');
  const rackSelect = document.getElementById('c_rack_select');
  if (!floorSelect || !rackSelect) return;

  const floorNames = [...new Set(floors.map(f=>f.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  floorSelect.innerHTML = '<option value="">-- Pilih Lantai --</option>' + floorNames.map(f => `<option value="${escapeAccountHtml(f)}">${escapeAccountHtml(f)}</option>`).join('');

  onClientFloorChange();
}

function onClientFloorChange() {
  const floorSelect = document.getElementById('c_floor_select');
  const rackSelect = document.getElementById('c_rack_select');
  const lokasiInput = document.getElementById('c_lokasi');
  if (!floorSelect || !rackSelect) return;

  const selectedFloor = floorSelect.value;
  let matchingRacks = racks;
  if (selectedFloor) {
    matchingRacks = racks.filter(r => (r.lantai||'').toLowerCase().trim() === selectedFloor.toLowerCase().trim() || (r.lokasi||'').toLowerCase().includes(selectedFloor.toLowerCase().trim()));
  }

  rackSelect.innerHTML = '<option value="">-- Pilih Rack (Opsional) --</option>' + matchingRacks.map(r => `<option value="${escapeAccountHtml(r.id)}">${escapeAccountHtml(r.id)} (${escapeAccountHtml(r.lantai || r.lokasi || 'Rack')})</option>`).join('');

  if (selectedFloor && !rackSelect.value && lokasiInput && !lokasiInput.value) {
    lokasiInput.value = selectedFloor;
  }
}

function onClientRackChange() {
  const floorSelect = document.getElementById('c_floor_select');
  const rackSelect = document.getElementById('c_rack_select');
  const lokasiInput = document.getElementById('c_lokasi');
  if (!rackSelect || !lokasiInput) return;

  const selectedRackId = rackSelect.value;
  if (selectedRackId) {
    const r = racks.find(x => x.id === selectedRackId);
    if (r) {
      const rackFloorName = r.lantai || r.lokasi || '';
      lokasiInput.value = r.id + (rackFloorName ? ` (${rackFloorName})` : '');
      if (r.lantai && floorSelect) {
        floorSelect.value = r.lantai;
      }
    }
  }
}

function saveClient(){
  const editing = document.getElementById('modalClient').dataset.editing;
  // Admin can add clients and change account status. Support may update an
  // existing client's contact/service data, but never its access status.
  if(!isAdmin() && !(isSupport() && editing)){
    alert('Hanya Admin yang bisa tambah Client. Support hanya bisa mengubah data Client yang sudah ada.');
    return;
  }

  const id = document.getElementById('c_id').value.trim();
  const pt = document.getElementById('c_pt').value.trim();
  if(!id || !pt){ alert('ID dan Nama PT wajib diisi'); return; }

  const oldIndex = editing ? clients.findIndex(c=>c.id===editing) : -1;
  const oldClient = oldIndex >= 0 ? clients[oldIndex] : null;
  if(editing && !oldClient){ alert('Client yang akan diubah tidak ditemukan'); return; }

  const status = isAdmin() ? document.getElementById('c_status').value : oldClient.status;
  const nowIso = new Date().toISOString();
  const service = document.getElementById('c_layanan').value;
  if(service === 'Colocation - Per U') {
    const uDari = document.getElementById('c_u_dari').value.trim();
    const uSampai = document.getElementById('c_u_sampai').value.trim();
    if(!uDari || !uSampai) {
      alert('U Dari dan U Sampai wajib diisi untuk layanan Colocation - Per U.');
      return;
    }
    if(parseInt(uDari) > parseInt(uSampai)) {
      alert('Nilai U Dari tidak boleh lebih besar dari U Sampai.');
      return;
    }
  }

  let finalPower = document.getElementById('c_power').value || '5 A';
  let uVal = '';
  if (service === 'Colocation - Per U') {
    finalPower = '-';
    const uDari = document.getElementById('c_u_dari').value.trim();
    const uSampai = document.getElementById('c_u_sampai').value.trim();
    if (uDari && uSampai) {
      uVal = `U${uDari} - U${uSampai}`;
    } else if (uDari) {
      uVal = `U${uDari}`;
    }
  }

  const data = {
    id,
    pt,
    layanan: service,
    power: finalPower,
    u: uVal,
    lokasi: document.getElementById('c_lokasi').value,
    status,
    pic: getPicValue(),
    email: document.getElementById('c_email').value,
    telp: document.getElementById('c_telp').value,
    maxBerat: parseFloat(document.getElementById('c_max_berat').value) || 173,
    ket: document.getElementById('c_ket').value,
    berhentiAt: status==='Terminate'
      ? (oldClient?.status==='Terminate' && oldClient.berhentiAt ? oldClient.berhentiAt : nowIso)
      : null,
    suspendAt: status==='Suspend'
      ? (oldClient?.status==='Suspend' && oldClient.suspendAt ? oldClient.suspendAt : nowIso)
      : null
  };

  if(editing){
    clients[oldIndex] = data;
  }else{
    if(clients.some(c=>c.id===id)){ alert('ID sudah dipakai, ganti ID lain'); return; }
    clients.push(data);
  }

  // Record only the actual transition to stopped service; saving a contact
  // update must not reset the 24-hour access countdown.
  if(status==='Terminate' && oldClient?.status!=='Terminate'){
    addClientLog(id, {tgl:nowIso.slice(0,10), status, by:currentUser?currentUser.email:'admin', at:nowIso});
  }

  saveData();
  renderClients();
  closeModal('modalClient');
  if(selectedClientId===id || editing){ openClientDetail(id); }
}

function deleteClient(id){
  if(!isAdmin()){
    alert('Hanya Admin yang bisa hapus Client. Status Terminate juga hanya bisa ditentukan Admin.');
    return;
  }
  showCustomConfirm(`Hapus klien ${id} beserta semua perangkatnya?`, () => {
    clients = clients.filter(c=>c.id!==id);
    devices = devices.filter(d=>d.clientId!==id);

    const token = localStorage.getItem('il_auth_token') || '';
    fetch(`/api/clients/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(e => console.error('Error deleting client from server:', e));

    saveData();
    renderClients();
    if(selectedClientId===id) closeClientDetail();
    if(typeof showAccountToast === 'function') showAccountToast('Klien berhasil dihapus.');
    else alert('Klien berhasil dihapus.');
  });
}

function quickAddDevice(clientId=selectedClientId, type=currentDeviceTab){
  const client = clients.find(c=>c.id===clientId);
  if(!client){ alert('Klien tidak ditemukan'); return; }

  if(!canManageInventory()){
    const ticketType = type==='keluar' ? 'Keluar Barang' : 'Masuk Barang';
    openTicketModalWithType(ticketType);
    setTimeout(()=>{
      const pt = document.getElementById('tk_pt');
      const rack = document.getElementById('tk_rack');
      if(pt) pt.value = client.id;
      if(rack) rack.value = racks.find(r=>(client.lokasi||'').includes(r.id))?.id || '';
      if(ticketType==='Masuk Barang'){
        document.getElementById('tk_title').value = `Masuk Barang - ${client.pt}`;
        document.getElementById('tk_dev_pos').value = client.lokasi||'';
      }else{
        document.getElementById('tk_title').value = `Keluar Barang - ${client.pt}`;
      }
    }, 150);
    return;
  }

  openClientDetail(clientId);
  setTimeout(()=>openAddDeviceModal(type), 150);
}

function openAddDeviceModal(type){
  if(!canManageInventory()){ alert('Perubahan inventory harus diajukan melalui tiket.'); return; }
  if(!selectedClientId){ alert('Pilih klien dulu bro!'); return; }
  currentDeviceTab = type;
  const modal = document.getElementById('modalDevice');
  const client = clients.find(c=>c.id===selectedClientId);
  document.getElementById('modalDeviceClientName').textContent = `${client.pt} • ${client.id}`;
  const title = document.getElementById('modalDeviceTitle');
  const badge = document.getElementById('modalDeviceTypeBadge');
  const btnSave = document.getElementById('btnSaveDevice');
  const tglMasukField = document.getElementById('fieldTglMasuk');
  const tglKeluarField = document.getElementById('fieldTglKeluar');
  const alasanField = document.getElementById('fieldAlasan');
  const pickerWrap = document.getElementById('keluarPickerWrap');

  // reset
  document.getElementById('d_nama').value=''; document.getElementById('d_sn').value=''; document.getElementById('d_jumlah').value=1;
  generateRackPosDropdown(client.lokasi, 'd_rackpos_input_container', 'd_rackpos', 'Misal: Rack A-04 U12'); document.getElementById('d_ket').value=''; document.getElementById('d_alasan').value=''; setBeratInput('d_berat', 'd_berat_unit', 0);
  document.getElementById('d_tglMasuk').valueAsDate = new Date();
  document.getElementById('d_tglKeluar').valueAsDate = new Date();
  document.getElementById('d_pickFromMasuk').innerHTML='<option value="">-- Input Manual / Pilih Perangkat Masuk --</option>';
  modal.dataset.editing='';

  if(type==='masuk'){
    title.textContent='📥 Tambah Perangkat Masuk';
    badge.textContent='MASUK'; badge.className='device-type-badge in';
    btnSave.textContent='💾 Simpan Masuk'; btnSave.className='btn-modal-primary';
    tglMasukField.style.display='block'; tglKeluarField.style.display='none'; alasanField.style.display='none'; pickerWrap.style.display='none';
  }else{
    title.textContent='📤 Catat Perangkat Keluar';
    badge.textContent='KELUAR'; badge.className='device-type-badge out';
    btnSave.textContent='💾 Simpan Keluar'; btnSave.className='btn-modal-primary orange';
    tglMasukField.style.display='block'; tglKeluarField.style.display='block'; alasanField.style.display='block'; pickerWrap.style.display='block';
    // populate picker
    const masukList = devices.filter(d=>d.clientId===selectedClientId && d.type==='masuk' && !d.exited);
    masukList.forEach(d=>{
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.nama} • ${d.sn||'No SN'} • ${d.jumlah} unit • Masuk: ${d.tglMasuk}`;
      document.getElementById('d_pickFromMasuk').appendChild(opt);
    });
  }
  modal.classList.add('show');
}

function fillFromExistingDevice(){
  const selId = document.getElementById('d_pickFromMasuk').value;
  if(!selId) return;
  const d = devices.find(x=>x.id===selId);
  if(!d) return;
  const client = clients.find(c=>c.id===selectedClientId);
  document.getElementById('d_nama').value = d.nama;
  document.getElementById('d_kategori').value = d.kategori;
  document.getElementById('d_sn').value = d.sn;
  document.getElementById('d_jumlah').value = d.jumlah;
  generateRackPosDropdown(client ? client.lokasi : '', 'd_rackpos_input_container', 'd_rackpos', 'Misal: Rack A-04 U12');
  setTimeout(() => { if(document.getElementById('d_rackpos')) document.getElementById('d_rackpos').value = d.rackPos; }, 50);
  document.getElementById('d_kondisi').value = d.kondisi;
  setBeratInput('d_berat', 'd_berat_unit', d.berat);
  document.getElementById('d_tglMasuk').value = d.tglMasuk;
  document.getElementById('d_ket').value = d.ket;
}

function saveDevice(){
  if(!canManageInventory()){ alert('Hanya Admin yang bisa menyimpan perubahan inventory langsung.'); return; }
  const client = clients.find(c=>c.id===selectedClientId);
  if(!client) return;
  const nama = document.getElementById('d_nama').value.trim();
  if(!nama){ alert('Nama perangkat wajib'); return; }
  const data = {
    id: document.getElementById('modalDevice').dataset.editing || `DEV-${Date.now().toString().slice(-6)}`,
    clientId: selectedClientId,
    nama,
    kategori: document.getElementById('d_kategori').value,
    sn: document.getElementById('d_sn').value.trim(),
    jumlah: parseInt(document.getElementById('d_jumlah').value)||1,
    rackPos: document.getElementById('d_rackpos').value.trim(),
    kondisi: document.getElementById('d_kondisi').value,
    berat: parseBeratInput('d_berat', 'd_berat_unit'),
    tglMasuk: document.getElementById('d_tglMasuk').value || new Date().toISOString().slice(0,10),
    tglKeluar: document.getElementById('d_tglKeluar').value || null,
    type: currentDeviceTab,
    alasan: document.getElementById('d_alasan').value.trim(),
    ket: document.getElementById('d_ket').value.trim(),
    exited:false
  };

  if(currentDeviceTab==='keluar' && !data.tglKeluar){ alert('Tanggal keluar wajib diisi'); return; }

  // handle edit
  const editingId = document.getElementById('modalDevice').dataset.editing;
  if(editingId){
    const idx = devices.findIndex(x=>x.id===editingId);
    if(idx>=0) devices[idx]=data;
  }else{
    // if picking from existing and type keluar, optionally mark original as exited
    const pickId = document.getElementById('d_pickFromMasuk').value;
    if(currentDeviceTab==='keluar' && pickId){
      const origIdx = devices.findIndex(x=>x.id===pickId);
      if(origIdx>=0){
        const origDev = devices[origIdx];
        const currentQty = parseInt(origDev.jumlah) || 1;
        const outQty = Math.min(parseInt(data.jumlah) || 1, currentQty);

        const snList = formatSNList(origDev.sn, currentQty);
        let finalOutSn = data.sn ? data.sn.trim() : '';
        let remainingSnList = [...snList];

        if(snList.length > 0 && snList[0] !== '-'){
          if(finalOutSn && remainingSnList.includes(finalOutSn)){
            remainingSnList = remainingSnList.filter(s => s !== finalOutSn);
          } else if(snList.length >= outQty){
            finalOutSn = snList.slice(0, outQty).join(', ');
            remainingSnList = snList.slice(outQty);
          }
        }

        if(outQty < currentQty){
          origDev.jumlah = currentQty - outQty;
          if(snList.length > 0 && snList[0] !== '-'){
            origDev.sn = remainingSnList.join(', ');
          }
        } else {
          origDev.exited = true;
        }
        origDev.tglKeluarActual = data.tglKeluar;
        data.jumlah = outQty;
        data.sn = finalOutSn || data.sn || origDev.sn || '-';
      }
    }
    devices.push(data);
  }

  saveData();
  closeModal('modalDevice');
  // refresh detail
  openClientDetail(selectedClientId);
  // ensure tab stays
  switchDeviceTab(currentDeviceTab);
}

function deleteDevice(id){
  if(!canManageInventory()){
    alert('Hanya Admin yang bisa menghapus perangkat langsung. Gunakan tiket untuk request perubahan.');
    return;
  }
  const d = devices.find(x=>x.id===id);
  if(!d) return;

  const currentQty = parseInt(d.jumlah) || 1;
  if(currentQty > 1){
    showQuantityPrompt(d.nama, currentQty, (qtyToDelete) => {
      if(isNaN(qtyToDelete) || qtyToDelete <= 0) return;
      if(qtyToDelete < currentQty){
        d.jumlah = currentQty - qtyToDelete;
        saveData();
        renderDevices();
        renderClients();
        if(selectedClientId) openClientDetail(selectedClientId);
        alert(`${qtyToDelete} unit "${d.nama}" berhasil dihapus. Sisa di inventory: ${d.jumlah} unit.`);
      } else {
        devices = devices.filter(x=>x.id!==id);
        saveData();
        renderDevices();
        renderClients();
        if(selectedClientId) openClientDetail(selectedClientId);
        alert(`Perangkat "${d.nama}" (${currentQty} unit) berhasil dihapus sepenuhnya.`);
      }
    });
  } else {
    showCustomConfirm(`Hapus perangkat "${d.nama}"?`, () => {
      devices = devices.filter(x=>x.id!==id);
      saveData();
      renderDevices();
      renderClients();
      if(selectedClientId) openClientDetail(selectedClientId);
      alert('Perangkat berhasil dihapus.');
    });
  }
}

function editDevice(id){
  if(!canManageInventory()){
    alert('Hanya Admin yang bisa mengubah perangkat langsung. Gunakan tiket untuk request perubahan.');
    return;
  }
  const d = devices.find(x=>x.id===id);
  if(!d) return;
  openAddDeviceModal(d.type);
  document.getElementById('modalDevice').dataset.editing = id;
  document.getElementById('d_nama').value = d.nama;
  document.getElementById('d_kategori').value = d.kategori;
  document.getElementById('d_sn').value = d.sn;
  document.getElementById('d_jumlah').value = d.jumlah;
  const client = clients.find(c=>c.id===d.clientId);
  const tRacks = client ? client.lokasi.split(',').map(s=>s.trim()) : [d.rackPos];
  let matchedRack = tRacks.length > 0 ? tRacks[0] : '';
  if(d.rackPos) {
      const parts = d.rackPos.split(' ');
      if(parts.length > 1) {
          matchedRack = parts[0] + ' ' + parts[1]; // e.g. "Rack A-04"
      }
  }
  generateRackPosDropdown(matchedRack, 'd_rackpos_input_container', 'd_rackpos', 'Misal: Rack A-04 U12');
  setTimeout(() => { if(document.getElementById('d_rackpos')) document.getElementById('d_rackpos').value = d.rackPos; }, 50);
  document.getElementById('d_kondisi').value = d.kondisi;
  setBeratInput('d_berat', 'd_berat_unit', d.berat);
  document.getElementById('d_tglMasuk').value = d.tglMasuk;
  document.getElementById('d_tglKeluar').value = d.tglKeluar || '';
  document.getElementById('d_alasan').value = d.alasan||'';
  document.getElementById('d_ket').value = d.ket||'';
}

function markExit(masukId){
  const d = devices.find(x=>x.id===masukId);
  if(!d) return;
  const currentQty = parseInt(d.jumlah) || 1;
  const confirmMsg = currentQty > 1
    ? `Keluarkan perangkat "${d.nama}" (tersedia ${currentQty} unit)? Anda dapat menentukan jumlah unit yang keluar di form tiket.`
    : `Keluarkan perangkat "${d.nama}" dari DC? Akan diarahkan ke Tiket Keluar Barang.`;

  showCustomConfirm(confirmMsg, () => {
    openTicketModalWithType('Keluar Barang');
    setTimeout(()=>{
      const cl = clients.find(c=>c.id===d.clientId);
      document.getElementById('tk_dev_existing').value = d.id;
      document.getElementById('tk_out_name').value = d.nama;
      if(document.getElementById('tk_out_qty')) {
        document.getElementById('tk_out_qty').value = 1;
        document.getElementById('tk_out_qty').max = currentQty;
      }
      document.getElementById('tk_out_sn').value = d.sn||'';
      document.getElementById('tk_title').value = `Keluar Barang - ${d.nama} - ${cl?cl.pt:''}`;
      document.getElementById('tk_desc').value = `Permintaan keluar barang:\n- Perangkat: ${d.nama}\n- SN: ${d.sn||'-'}\n- Total Tersedia: ${currentQty} unit\n- Rack: ${d.rackPos||''}\n- Client: ${cl?cl.pt+' ('+cl.id+')':''}\n- Tgl Masuk Awal: ${d.tglMasuk}\n\nAlasan keluar / tujuan:\n`;
      if(cl){
        document.getElementById('tk_pt').value = cl.id;
        document.getElementById('tk_rack').value = cl.lokasi?.split(' ')[0]+' '+ (cl.lokasi?.split(' ')[1]||'') || d.rackPos || '';
      }
    }, 300);
  });
}

function processDeviceExitForTicket(t){
  if(!t || t.type !== 'Keluar Barang' || !t.clientId) return;
  if(devices.some(d => d.ticketId === t.id && d.type === 'keluar')) return;

  let dev = null;
  if(t.devExistingId) dev = devices.find(d => d.id === t.devExistingId);
  if(!dev && t.outName){
    dev = devices.find(d => d.clientId === t.clientId && d.nama.toLowerCase().includes((t.outName||'').toLowerCase()) && d.type === 'masuk' && !d.exited);
  }

  const requestedOutQty = Math.max(1, parseInt(t.outQty) || 1);

  if(dev){
    const currentJumlah = parseInt(dev.jumlah) || 1;
    const actualOutQty = Math.min(requestedOutQty, currentJumlah);

    const snList = formatSNList(dev.sn, currentJumlah);
    let finalOutSn = t.outSn ? t.outSn.trim() : '';
    let remainingSnList = [...snList];

    if(snList.length > 0 && snList[0] !== '-'){
      if(finalOutSn && remainingSnList.includes(finalOutSn)){
        remainingSnList = remainingSnList.filter(s => s !== finalOutSn);
      } else if(snList.length >= actualOutQty){
        finalOutSn = snList.slice(0, actualOutQty).join(', ');
        remainingSnList = snList.slice(actualOutQty);
      }
    }

    if(actualOutQty < currentJumlah){
      dev.jumlah = currentJumlah - actualOutQty;
      if(snList.length > 0 && snList[0] !== '-'){
        dev.sn = remainingSnList.join(', ');
      }
      if(dev.ticketStatus) dev.ticketStatus = null;
    } else {
      dev.exited = true;
      if(dev.ticketStatus) dev.ticketStatus = null;
    }

    const outDev = {
      id: `DEV-${Date.now().toString().slice(-5)}-OUT`,
      clientId: t.clientId,
      nama: t.outName || dev.nama,
      kategori: dev.kategori,
      sn: finalOutSn || t.outSn || dev.sn || '-',
      jumlah: actualOutQty,
      rackPos: dev.rackPos,
      kondisi: dev.kondisi,
      tglMasuk: dev.tglMasuk,
      tglKeluar: t.outTgl || t.date,
      type: 'keluar',
      alasan: t.outReason || t.desc || '',
      ket: `Dari tiket ${t.id}: ${t.title}`,
      exited: false,
      ticketId: t.id,
      ticketStatus: t.status
    };
    devices.push(outDev);
  } else {
    const outDev = {
      id: `DEV-${Date.now().toString().slice(-5)}-OUT`,
      clientId: t.clientId,
      nama: t.outName || t.title,
      kategori: 'Lainnya',
      sn: t.outSn || '-',
      jumlah: requestedOutQty,
      rackPos: t.rack || '',
      kondisi: 'Baik',
      tglMasuk: t.date,
      tglKeluar: t.outTgl || t.date,
      type: 'keluar',
      alasan: t.outReason || t.desc || '',
      ket: `Dari tiket ${t.id}: ${t.title}`,
      exited: false,
      ticketId: t.id,
      ticketStatus: t.status
    };
    devices.push(outDev);
  }
}

function setRackFilter(f){
  // Admin/Support do not display the "Semua" chip. Clicking an already
  // selected status a second time resets the list to all racks.
  if((isAdmin() || isSupport()) && f===currentRackFilter && f!=='all'){
    f = 'all';
  }
  currentRackFilter = f;
  const statusDropdown=document.getElementById('rackStatusFilter');
  if(statusDropdown) statusDropdown.value=f;
  document.querySelectorAll('[data-rfilter]').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.rfilter===f);
  });
  renderRacks();
}

function calculateRackUtil(r) {
  if (!r) return 0;
  const maxU = parseInt(String(r.u).replace(/\D/g, '')) || 42;
  const activeDevices = devices.filter(d => {
    const rId = String(r.id).toLowerCase();
    const pos = (d.rackPos || '').toLowerCase();
    const clLoc = (clients.find(c => c.id === d.clientId)?.lokasi || '').toLowerCase();
    return (pos.includes(rId) || clLoc.includes(rId)) && d.type === 'masuk' && !d.exited;
  });
  const usedUnits = activeDevices.reduce((sum, d) => sum + (parseInt(d.jumlah) || 1), 0);
  return Math.min(100, Math.round((usedUnits / maxU) * 100));
}

function renderRacks(){
  const grid = document.getElementById('rackGrid');
  if(!grid) return;
  const q = (document.getElementById('rackSearch')?.value||'').toLowerCase();
  populateFloorControls();
  const statusSelect=document.getElementById('rackStatusFilter');
  if(statusSelect) statusSelect.value=currentRackFilter;
  let baseRacks = racks.filter(matchesGlobalFloorByRack);
  if(isClient()){
    const client = clients.find(cl=>cl.id===currentUser.clientId);
    if(client){
      const loc = (client.lokasi||'').toLowerCase();
      // Jika lokasi mengandung "keluar dari", berarti sudah tidak punya rack aktif
      const isKeluar = loc.startsWith('keluar dari') || loc.includes('keluar dari');
      if(isKeluar){
        baseRacks = []; // tidak ada rack aktif
      }else{
        baseRacks = racks.filter(r=>{
          if(!matchesGlobalFloorByRack(r)) return false;
          const rackIdLower = r.id.toLowerCase();
          // Cocokkan exact atau loc mengandung rackId (contoh loc "Rack A-04" mengandung "rack a-04")
          // Jangan pakai cek kata "Rack" saja karena itu match semua
          return loc === rackIdLower || loc.includes(rackIdLower) || rackIdLower === loc;
        });
      }
    }else{
      baseRacks = [];
    }
  }
  let filtered = baseRacks.filter(r=>{
    const matchQ = !q || r.id.toLowerCase().includes(q) || r.lokasi.toLowerCase().includes(q) || r.status.toLowerCase().includes(q);
    const normalizedStatus = String(r.status||'').toLowerCase();
    
    // Exact match for the new statuses
    const matchF = currentRackFilter==='all'
      || (currentRackFilter==='Aktif' && !['offline','proses','maintenance','hold','terminate'].includes(normalizedStatus))
      || (currentRackFilter==='Proses' && ['proses','maintenance'].includes(normalizedStatus))
      || (currentRackFilter==='Hold' && normalizedStatus==='hold')
      || (currentRackFilter==='Terminate' && normalizedStatus==='terminate');
    
    const normalizedType = String(r.tipeRack||'Close Rack');
    const matchType = typeof currentRackTypeFilter !== 'undefined' ? (currentRackTypeFilter==='all' || normalizedType === currentRackTypeFilter) : true;
    return matchQ && matchF && matchType;
  });
  
  // Jika dropown Lantai dan Status berada pada pilihan "-" (all), jangan tampilkan rack sama sekali (hanya jika admin/support dan filter kosong)
  if(!isClient() && globalFloorFilter === 'all' && currentRackFilter === 'all' && (typeof currentRackTypeFilter === 'undefined' || currentRackTypeFilter === 'all') && !q) {
    filtered = []; // Kosongkan daftar jika tidak ada filter yang dipilih
  }
  document.getElementById('rackCountInfo').textContent = `${filtered.length} Rack`;

  // Hide add floor and add rack buttons for Client (Admin & Support allowed)
  const canManageRack = isAdmin() || isSupport();
  const addFloorBtn = document.getElementById('btnAddFloor');
  if (addFloorBtn) addFloorBtn.style.setProperty('display', canManageRack ? 'inline-flex' : 'none', 'important');
  const addRackBtn = document.getElementById('btnAddRack');
  if (addRackBtn) addRackBtn.style.setProperty('display', canManageRack ? 'inline-flex' : 'none', 'important');
  // Update big display for client - hanya nampilin banyaknya rack seperti gambar Utilitas 78%
  const bigDisplay = document.getElementById('clientRackBigDisplay');
  const bigNumber = document.getElementById('clientRackBigNumber');
  const bigSub = document.getElementById('clientRackBigSub');
  const utilBig = document.getElementById('clientRackUtilBig');
  const utilNumber = document.getElementById('clientRackUtilNumber');
  if(bigDisplay){
    if(isClient()){
      bigDisplay.style.display = 'block';
      if(bigNumber) bigNumber.textContent = filtered.length;
      if(bigSub) bigSub.textContent = (currentUser.pt||'Anda') + ' • ringkasan rack aktif';
      // Hitung rata-rata beban total rack secara dinamis berdasarkan perangkat yang terpasang
      if(filtered.length>0){
        const totalUtils = filtered.map(r=>calculateRackUtil(r));
        const avgUtil = Math.round(totalUtils.reduce((a,b)=>a+b, 0) / filtered.length);
        if(utilBig){
          utilBig.style.display = 'flex';
          if(utilNumber) utilNumber.textContent = avgUtil + '%';
        }
      }else{
        if(utilBig) utilBig.style.display = 'none';
      }
    }else{
      bigDisplay.style.display = 'none';
    }
  }

  grid.innerHTML='';
  if(filtered.length===0){
    if(isClient()){
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-dim);border:1px dashed var(--border-hi);border-radius:12px;background:rgba(59,124,240,0.04);">
        <div style="font-size:32px;margin-bottom:12px;">🏢</div>
        <div style="font-weight:600;color:#fff;margin-bottom:6px;">Tidak ada Rack Aktif untuk ${currentUser.pt||'Anda'}</div>
        <div style="font-size:12px;max-width:420px;margin:0 auto;line-height:1.5;">Rack Anda saat ini: <b style="color:var(--text-mid);">${clients.find(cl=>cl.id===currentUser.clientId)?.lokasi||'Tidak ada / sudah keluar'}</b><br>Jika baru keluar atau pindah, hubungi Admin atau buat tiket CrossConnect untuk request rack baru.</div>
        <button class="page-action" style="margin:16px auto 0;" onclick="openTicketModalWithType('CrossConnect')">🎫 Ajukan Rack Baru (Tiket)</button>
      </div>`;
    }else{
      if(globalFloorFilter === 'all' && currentRackFilter === 'all' && (typeof currentRackTypeFilter === 'undefined' || currentRackTypeFilter === 'all') && !q) {
        if(Array.isArray(floors) && floors.length > 0) {
          grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-dim);border:1px dashed var(--border-hi);border-radius:12px;background:rgba(255,255,255,0.02);">
            <div style="font-size:36px;margin-bottom:12px;">🏢</div>
            <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:6px;">Tersedia ${floors.length} Lantai Terdaftar</div>
            <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:20px;">Silakan pilih lantai untuk melihat rack, atau klik "+ Tambah rack" untuk menambahkan rack baru.</div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:14px;">
              ${canManageRack ? `<button type="button" class="page-action" style="font-size:13px;padding:10px 20px;" onclick="openRackInfoModal()">+ Tambah Rack Baru</button>` : ''}
              <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                ${floors.map(f => `<button type="button" class="page-action secondary" style="font-size:12px;" onclick="setGlobalFloorFilter('${escapeAccountHtml(f.name)}')">🏢 ${escapeAccountHtml(f.name)}</button>`).join('')}
              </div>
            </div>
          </div>`;
        } else {
          grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-dim);border:1px dashed var(--border-hi);border-radius:12px;background:rgba(255,255,255,0.02);">
            <div style="font-size:36px;margin-bottom:12px;">🏢</div>
            <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:6px;">Belum Ada Lantai Terdaftar</div>
            <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:20px;">Klik tombol "+ Tambah Lantai" di kanan atas untuk membuat lantai pertama.</div>
            <button type="button" class="page-action" style="margin:0 auto;display:inline-flex;" onclick="openFloorModal()">+ Tambah Lantai Pertama</button>
          </div>`;
        }
      } else {
        const selectedFloorName = globalFloorFilter !== 'all' ? globalFloorFilter : '';
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-dim);border:1px dashed var(--border-hi);border-radius:12px;background:rgba(59,124,240,0.03);">
          <div style="font-size:36px;margin-bottom:12px;">🏢</div>
          <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:6px;">${selectedFloorName ? `Lantai "${escapeAccountHtml(selectedFloorName)}" Belum Memiliki Rack` : 'Tidak ada rack yang cocok dengan filter'}</div>
          <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:20px;">${selectedFloorName ? 'Lantai ini sudah terdaftar. Klik "+ Tambah rack" untuk menempatkan rack di lantai ini.' : 'Coba ubah kriteria pencarian atau filter status.'}</div>
          ${canManageRack ? `<button type="button" class="page-action" style="margin:0 auto;display:inline-flex;" onclick="openRackInfoModal()">+ Tambah Rack Pertama</button>` : ''}
        </div>`;
      }
    }
    return;
  }
  filtered.forEach(r=>{
    const relatedClients = clients.filter(c=>{
      const loc = (c.lokasi||'').toLowerCase();
      return loc.includes(r.id.toLowerCase());
    });
    const clientCount = relatedClients.length;
    const deviceCount = devices.filter(d=>{
      return (d.rackPos||'').toLowerCase().includes(r.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(r.id.toLowerCase());
    }).filter(d=>d.type==='masuk' && !d.exited).reduce((a,b)=>a+(parseInt(b.jumlah)||1), 0);
    let badgeClass='ok'; let fillClass='';
    if(r.status==='Proses'){ badgeClass='warn'; fillClass='warn'; }
    if(r.status==='Hold'){ badgeClass='crit'; fillClass='crit'; }
    if(r.status==='Terminate'){ badgeClass='info'; fillClass='warn'; }
    const computedUtil = calculateRackUtil(r);
    r.util = computedUtil;
    if(r.util>=90) fillClass='crit';
    else if(r.util>=75 && fillClass==='') fillClass='warn';

    let ptHtml='';
    if(clientCount===0){
      ptHtml = `<span class="rack-pt-badge empty">Belum ada PT / kosong</span>`;
    }else{
      ptHtml = relatedClients.slice(0,3).map(c=>`<span class="rack-pt-badge" title="${c.pt} - ${c.id}">🏢 ${c.pt}</span>`).join('');
      if(clientCount>3) ptHtml += `<span class="rack-pt-more">+${clientCount-3} PT lain</span>`;
    }

    grid.innerHTML += `
      <div class="rack-card" onclick="openRackDetail('${r.id}')">
        <div class="rack-card-top"><div><div class="rack-id">${r.id}</div><div class="rack-loc">${r.lokasi} • ${r.u||'42U'} ${(r.tipeRack === 'Open Rack' || !r.power || r.power === '-') ? '' : '• ' + r.power} • ${r.tipeRack||'Close Rack'} ${r.tipeRack==='Open Rack' && r.otb ? '('+r.otb+')' : ''}</div></div></div>
        <div class="rack-pt-list">${ptHtml}</div>
        <div class="rack-meta"><span>${clientCount} klien • ${deviceCount} perangkat aktif</span></div>
        <div class="rack-card-actions">
          ${isAdmin() ? `<button class="action-icon" onclick="event.stopPropagation();openRackInfoModal('${r.id}')" title="Edit Rack (Admin Only)">✏️</button>` : ``}
          ${isSupport() ? `<button class="action-icon" onclick="event.stopPropagation();openAddRackModal('${r.id}')" title="Kelola PT (Support)">🏢</button>` : ``}
          ${(isAdmin() || isSupport()) ? `<button class="action-icon danger" onclick="event.stopPropagation();deleteRack('${r.id}')" title="Hapus">🗑</button>` : ``}
          <button class="action-icon" onclick="event.stopPropagation();openRackDetail('${r.id}')" title="Detail">👁</button>
          ${isClient() ? `<span style="font-size:10px;color:var(--text-dim);margin-left:6px;">Client View</span>` : ``}
        </div>
      </div>`;
  });
}

function openRackDetail(rackId){
  const rack = racks.find(r=>r.id===rackId);
  if(!rack) return;
  if(isClient()){
    const ownClient = getClientDataForCurrentUser();
    if(!ownClient || !(ownClient.lokasi||'').toLowerCase().includes(rack.id.toLowerCase())){
      alert('Akun Client hanya dapat melihat rack yang disewa.');
      return;
    }
  }
  selectedRackId = rackId;
  document.getElementById('racks-list-view').style.display='none';
  const detailView = document.getElementById('racks-detail-view');
  detailView.style.display='block';
  detailView.classList.add('show');

  // Enforce button visibility in Rack Detail View for Client (Admin & Support only)
  const btnEditRack = document.getElementById('btnEditRackDetail');
  if (btnEditRack) btnEditRack.style.setProperty('display', isClient() ? 'none' : (isAdmin() ? 'inline-flex' : 'none'), 'important');
  const btnKelolaPT = document.getElementById('btnKelolaPTDetail');
  if (btnKelolaPT) btnKelolaPT.style.setProperty('display', isClient() ? 'none' : ((isAdmin() || isSupport()) ? 'inline-flex' : 'none'), 'important');
  const btnDeleteRack = document.getElementById('btnDeleteRackDetail');
  if (btnDeleteRack) btnDeleteRack.style.setProperty('display', isClient() ? 'none' : (isAdmin() ? 'inline-flex' : 'none'), 'important');

  let badgeClass='ok';
  if(rack.status==='Proses') badgeClass='warn';
  if(rack.status==='Hold') badgeClass='crit';
  if(rack.status==='Terminate') badgeClass='info';

  const relatedClientsInRack = clients.filter(c=> {
    if(!c.lokasi) return false;
    const locLower = (c.lokasi || '').toLowerCase();
    const rackIdLower = rack.id.toLowerCase();
    return locLower.includes(rackIdLower);
  });
  
  // Ambil semua record PT yang terkait dengan PT yang ada di rack ini
  // Jadi kalau PT Nusantara ada di Rack A-04 dan Rack A-09, kedua record-nya akan tampil di sini
  const ptNamesInRack = [...new Set(relatedClientsInRack.map(c => c.pt))];
  const relatedClients = clients.filter(c => ptNamesInRack.includes(c.pt));

  let actualDeviceCount = devices.filter(d=> ((d.rackPos||'').toLowerCase().includes(rack.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(rack.id.toLowerCase())) && d.type==='masuk' && !d.exited).reduce((a,b)=>a+(parseInt(b.jumlah)||1), 0);
  document.getElementById('rackHeaderCard').innerHTML = `
    <div class="client-info">
      <h3>🗄️ ${rack.id}</h3>
      <div class="client-sub">
        <span>📍 ${rack.lokasi}</span>
        ${(rack.tipeRack === 'Open Rack' || !rack.power || rack.power === '-') ? '' : '<span>⚡ ' + rack.power + '</span>'}
        <span>📏 ${rack.u||'42U'}</span>
      </div>
      <div style="margin-top:8px;font-size:12.5px;color:var(--text-mid);">${rack.ket||'Tidak ada keterangan'}</div>
    </div>
    <div class="client-stats">
      <div class="mini-stat"><div class="ms-label">Klien</div><div class="ms-value">${clients.filter(c => [...new Set(relatedClients.map(x=>x.pt))].includes(c.pt)).length}</div></div>
      <div class="mini-stat"><div class="ms-label">Device Aktif</div><div class="ms-value green">${actualDeviceCount}</div></div>
    </div>
  `;
  document.getElementById('rackDeviceCount').textContent = actualDeviceCount;

  // Populate client table

  const rcBody = document.getElementById('rackClientTable');
  if(rcBody) {
    rcBody.innerHTML='';
        if(relatedClients.length===0){
      rcBody.innerHTML='<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-dim);">Belum ada klien di rack ini</td></tr>';
    }else{
      let _html = '';
      
      relatedClients.forEach(c => {
        let bc = 'ok';
        if (c.status === 'Jatuh tempo') bc = 'warn';
        if (c.status === 'Suspend' || c.status === 'Hold' || c.status === 'Terminate') bc = 'crit';

        const rackLocations = (c.lokasi || '').split(',').map(s => s.trim()).filter(Boolean);
        const locsToRender = rackLocations.length > 0 ? rackLocations : [c.lokasi || '-'];

        locsToRender.forEach(rId => {
          let foundR = racks.find(x => x.id.toLowerCase().trim() === rId.toLowerCase().trim());
          if (!foundR && rId) {
            foundR = racks.find(x => rId.toLowerCase().includes(x.id.toLowerCase()));
          }

          let lantaiDisplay = rId || '-';
          if (foundR && foundR.lantai && !rId.toLowerCase().includes('lantai')) {
            lantaiDisplay = `${foundR.id} (${foundR.lantai})`;
          }

          _html += `<tr>
            <td class="item-name">${escapeAccountHtml(c.id)}</td>
            <td>
              <span class="clickable-pt" style="color:#fff;font-weight:600;" onclick="document.querySelector('[data-page=inventory]').click(); setTimeout(()=>openClientDetail('${escapeAccountHtml(c.id)}'),300)">${escapeAccountHtml(c.pt)}</span>
            </td>
            <td><span style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-mid);">${escapeAccountHtml(lantaiDisplay)}</span></td>
            <td>${escapeAccountHtml(c.layanan)}</td>
            <td><span class="badge ${bc}">${escapeAccountHtml(c.status)}</span></td>
          </tr>`;
        });
      });
      rcBody.innerHTML = _html;
    }
    const rClientCount = document.getElementById('rackClientCount');
    if(rClientCount) {
      const ptNamesInRack = [...new Set(relatedClients.map(x => x.pt))];
      rClientCount.textContent = clients.filter(x => ptNamesInRack.includes(x.pt)).length;
    }
  }

  // Populate device table
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const relatedTicketsRequest = tickets.filter(t=>{
    const matchRack = (t.rack||'').toLowerCase().includes(rack.id.toLowerCase()) || t.titikA?.toLowerCase().includes(rack.id.toLowerCase()) || t.titikB?.toLowerCase().includes(rack.id.toLowerCase());
    const isMasukKeluar = t.type==='Masuk Barang' || t.type==='Keluar Barang';
    const isDalamProses = t.status!=='Selesai';
    return matchRack && isMasukKeluar && isDalamProses;
  });

  const relatedDevicesRequest = devices.filter(d=>{
    const inRack = (d.rackPos||'').toLowerCase().includes(rack.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(rack.id.toLowerCase());
    return inRack && d.ticketStatus && (d.ticketStatus==='Diproses' || d.ticketStatus==='Menunggu Approval' || d.ticketStatus==='Disetujui');
  });

  const activeDevicesInRack = devices.filter(d=> ((d.rackPos||'').toLowerCase().includes(rack.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(rack.id.toLowerCase())) && d.type==='masuk' && !d.exited);
  
  const rdBody = document.getElementById('rackDeviceTable');
  if(rdBody) {
    rdBody.innerHTML='';
        if(activeDevicesInRack.length===0){
      rdBody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-dim);">Belum ada perangkat yang masuk/aktif di rack ini.</td></tr>';
    }else{
      let _html2 = '';
      activeDevicesInRack.forEach(d=>{
        const cl = clients.find(c=>c.id===d.clientId);
        const tgl = d.tglMasuk ? new Date(d.tglMasuk).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '-';
        let condBadge = 'ok'; if(d.kondisi==='Rusak') condBadge='crit'; if(d.kondisi==='Menunggu') condBadge='info';
        _html2 += `<tr><td><span class="device-type-badge in">${d.kategori||'-'}</span></td><td class="item-name">${d.nama}</td><td>${cl?cl.pt:'-'}</td><td style="font-family:var(--font-mono);font-size:11px;">${d.sn||'-'}</td><td>${d.jumlah}</td><td><span class="badge ${condBadge}">${d.kondisi||'Baik'}</span></td><td style="font-family:var(--font-mono);">${tgl}</td></tr>`;
      });
      rdBody.innerHTML = _html2;
    }
  }

  // No 3: History - Jika status sudah Selesai maka pindah ke history No 3 dan hilang setelah 1 minggu, tapi tidak hilang di data
  const historyDevicesAll = devices.filter(d=>{
    const inRack = (d.rackPos||'').toLowerCase().includes(rack.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(rack.id.toLowerCase());
    return inRack && d.type==='keluar';
  });

  const historyTicketsAll = tickets.filter(t=>{
    const matchRack = (t.rack||'').toLowerCase().includes(rack.id.toLowerCase()) || t.titikA?.toLowerCase().includes(rack.id.toLowerCase()) || t.titikB?.toLowerCase().includes(rack.id.toLowerCase());
    return matchRack && t.status==='Selesai' && t.type==='Keluar Barang';
  });

  // Filter history yang masih dalam 1 minggu (7 hari)
  const historyFiltered = [];
  historyDevicesAll.forEach(d=>{
    try{
      const tglKeluar = d.tglKeluar ? new Date(d.tglKeluar) : null;
      if(!tglKeluar || tglKeluar >= oneWeekAgo){
        historyFiltered.push({type:'device', data:d});
      }
    }catch(e){
      historyFiltered.push({type:'device', data:d});
    }
  });
  historyTicketsAll.forEach(t=>{
    try{
      const tgl = t.date ? new Date(t.date) : null;
      if(!tgl || tgl >= oneWeekAgo){
        historyFiltered.push({type:'ticket', data:t});
      }
    }catch(e){
      historyFiltered.push({type:'ticket', data:t});
    }
  });

  const rhBody = document.getElementById('rackHistoryTable');
  rhBody.innerHTML='';
  if(historyFiltered.length===0){
    rhBody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-dim);">Tidak ada riwayat dalam 1 minggu terakhir. Riwayat yang lebih lama tetap ada di data tapi tidak tampil di history (auto hilang setelah 1 minggu).</td></tr>';
  }else{
    historyFiltered.forEach(item=>{
      if(item.type==='device'){
        const d = item.data;
        const cl = clients.find(c=>c.id===d.clientId);
        const tm = d.tglMasuk? new Date(d.tglMasuk).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}):'-';
        const tk = d.tglKeluar? new Date(d.tglKeluar).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'-';
        let ageInfo = '';
        try{
          const diffDays = Math.floor((new Date() - new Date(d.tglKeluar)) / (1000*60*60*24));
          if(diffDays>=0) ageInfo = ` <span style="font-size:10px;color:var(--text-dim);">(${diffDays} hari lalu - akan hilang dalam ${7-diffDays} hari)</span>`;
        }catch(e){}
        rhBody.innerHTML+=`<tr><td class="item-name">${d.nama}</td><td>${cl?cl.pt:'-'}</td><td style="font-family:var(--font-mono);">${tm}</td><td style="font-family:var(--font-mono);color:var(--orange);font-weight:600;">${tk}${ageInfo}</td><td>${d.alasan||'-'}</td></tr>`;
      }else{
        const t = item.data;
        const cl = clients.find(c=>c.id===t.clientId) || {pt: t.pt||'-'};
        const tgl = t.date ? new Date(t.date).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '-';
        let ageInfo = '';
        try{
          const diffDays = Math.floor((new Date() - new Date(t.date)) / (1000*60*60*24));
          if(diffDays>=0) ageInfo = ` <span style="font-size:10px;color:var(--text-dim);">(${diffDays} hari lalu)</span>`;
        }catch(e){}
        rhBody.innerHTML+=`<tr><td class="item-name">${t.outName||t.title} <span class="badge ok" style="margin-left:4px;">Selesai</span></td><td>${cl?cl.pt:t.pt||'-'}</td><td style="font-family:var(--font-mono);">${t.outTgl||t.date||''}</td><td style="font-family:var(--font-mono);color:#5dcaa5;font-weight:600;">${tgl}${ageInfo}</td><td>${t.outReason||t.title||'Keluar Barang'}</td></tr>`;
      }
    });
  }
  // Update count history
  const historyCountEl = document.querySelector('#crossconnect-detail-view #rackHistoryTable') ? null : null;
}

function closeRackDetail(){
  selectedRackId=null;
  document.getElementById('racks-detail-view').style.display='none';
  document.getElementById('racks-list-view').style.display='block';
  renderRacks();
}

function exportRackActiveToExcel(){
  if(isClient()){
    alert('Maaf, export Excel Surat Barang hanya untuk Admin & Support.');
    return;
  }
  if(!selectedRackId){
    alert('Pilih rack terlebih dahulu');
    return;
  }
  const rack = racks.find(r=>r.id===selectedRackId);
  if(!rack) return;

  const relatedDevices = devices.filter(d=>{
    const inRack = (d.rackPos||'').toLowerCase().includes(rack.id.toLowerCase()) || (clients.find(c=>c.id===d.clientId)?.lokasi||'').toLowerCase().includes(rack.id.toLowerCase());
    return inRack && d.type==='masuk' && !d.exited;
  });

  if(relatedDevices.length===0){
    alert('Tidak ada perangkat aktif di rack ini untuk di-export');
    return;
  }

  function getDefaultBerat(kategori){
    const map = {
      'Server': 20,
      'Storage': 25,
      'Switch': 5,
      'Router': 5,
      'Firewall': 6,
      'Patch Panel': 2,
      'Kabel Fiber': 1,
      'Modul / Transceiver': 0.5,
      'OTB': 3,
      'UPS / PDU': 15,
      'Lainnya': 5
    };
    return map[kategori] || 5;
  }

  const now = new Date();
  const tglExport = now.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const safeRackId = rack.id.replace(/[^a-zA-Z0-9]/g, '_');

  let totalBeratKeseluruhan = 0;
  relatedDevices.forEach(d=>{
    const beratPerUnit = d.berat ? parseFloat(d.berat) : getDefaultBerat(d.kategori);
    const totalBerat = beratPerUnit * (d.jumlah||1);
    totalBeratKeseluruhan += totalBerat;
  });

  const kapasitasGedung = 173;
  const sisaKapasitas = kapasitasGedung - totalBeratKeseluruhan;
  const persenTerpakai = ((totalBeratKeseluruhan / kapasitasGedung)*100).toFixed(1);
  const persenSisa = (100 - parseFloat(persenTerpakai)).toFixed(1);
  let statusKapasitas = 'Aman';
  let statusClass = 'capacity-ok';
  if(totalBeratKeseluruhan > kapasitasGedung){
    statusKapasitas = 'OVERLOAD - Melebihi Kapasitas!';
    statusClass = 'capacity-over';
  }else if(totalBeratKeseluruhan > (kapasitasGedung*0.8)){
    statusKapasitas = 'Hampir Penuh';
    statusClass = 'capacity-warning';
  }

  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><meta name=ProgId content=Excel.Sheet><style>table{border-collapse:collapse;} td, th{border:1px solid #B0B0B0; padding:8px; font-family:Calibri, Arial; font-size:11pt;} .title{font-size:14pt; font-weight:bold; background:#0f1e34; color:#FFFFFF; text-align:center;} .header{background:#203764; color:#FFFFFF; font-weight:bold; text-align:center;} .subheader{background:#D6E4F0; font-weight:bold;} .odd{background:#FFFFFF;} .even{background:#F2F2F2;} .weight-col{background:#FFF2CC; font-weight:bold;} .total-row{background:#E2EFDA; font-weight:bold; font-size:12pt;} .capacity-ok{background:#C6EFCE; color:#006100;} .capacity-warning{background:#FFEB9C; color:#9C6500;} .capacity-over{background:#FFC7CE; color:#9C0006;}</style></head><body><table>';
  html += '<tr><td colspan="14" class="title">SURAT MASUK BARANG INTERLINK DATA CENTER</td></tr>';
  html += '<tr><td colspan="14" style="background:#E7E6E6; font-weight:bold; text-align:center;">Rack: ' + rack.id + ' - ' + rack.lokasi + '</td></tr>';
  html += '<tr><td colspan="7" class="subheader">Tanggal Export: ' + tglExport + '</td><td colspan="7" class="subheader">Total Perangkat: ' + relatedDevices.length + ' item | Total Berat: ' + totalBeratKeseluruhan.toFixed(1) + ' Kg</td></tr>';
  html += '<tr><td colspan="14"></td></tr>';
  html += '<tr><th class="header">No</th><th class="header">Nama Perangkat</th><th class="header">Kategori</th><th class="header">SN / Asset Tag</th><th class="header">Jumlah</th><th class="header">Rack Position</th><th class="header">Klien / PT</th><th class="header">ID Klien</th><th class="header">Layanan</th><th class="header">Daya (A)</th><th class="header">Tgl Masuk</th><th class="header" style="background:#BF8F00; color:#FFFFFF;">Berat Perangkat (Kg)</th><th class="header" style="background:#BF8F00; color:#FFFFFF;">Total Berat (Kg)</th><th class="header">Keperluan</th></tr>';

  relatedDevices.forEach(function(d, idx){
    const cl = clients.find(function(c){ return c.id===d.clientId; });
    const beratPerUnit = d.berat ? parseFloat(d.berat) : getDefaultBerat(d.kategori);
    const totalBerat = beratPerUnit * (d.jumlah||1);
    const rowClass = idx % 2 === 0 ? 'odd' : 'even';
    html += '<tr class="' + rowClass + '"><td style="text-align:center;">' + (idx+1) + '</td><td>' + (d.nama||'') + '</td><td>' + (d.kategori||'') + '</td><td style="mso-number-format:\"@\";">' + (d.sn||'') + '</td><td style="text-align:center;">' + (d.jumlah||1) + '</td><td>' + (d.rackPos||'') + '</td><td>' + (cl?cl.pt:'') + '</td><td style="mso-number-format:\"@\";">' + (cl?cl.id:'') + '</td><td>' + (cl?cl.layanan:'') + '</td><td>' + (cl?(cl.layanan === 'Colocation - Per U' ? (cl.u || '') : cl.power):'') + '</td><td>' + (d.tglMasuk||'') + '</td><td class="weight-col" style="text-align:center;">' + beratPerUnit.toFixed(1) + '</td><td class="weight-col" style="text-align:center; font-weight:bold;">' + totalBerat.toFixed(1) + '</td><td>Pengajuan Masuk Barang</td></tr>';
  });

  html += '<tr><td colspan="14"></td></tr>';
  html += '<tr class="total-row"><td colspan="11" style="text-align:right; font-weight:bold; background:#E2EFDA;">TOTAL BERAT KESELURUHAN</td><td style="text-align:center; background:#E2EFDA;"></td><td style="text-align:center; background:#E2EFDA; font-size:13pt; font-weight:bold;">' + totalBeratKeseluruhan.toFixed(1) + ' Kg</td><td style="background:#E2EFDA;"></td></tr>';
  html += '<tr><td colspan="11" style="text-align:right; font-weight:bold;">KAPASITAS GEDUNG (Maks)</td><td colspan="2" style="text-align:center; font-weight:bold; background:#D9E1F2;">' + kapasitasGedung + ' Kg</td><td></td></tr>';
  html += '<tr><td colspan="11" style="text-align:right; font-weight:bold;">SISA KAPASITAS</td><td colspan="2" style="text-align:center; font-weight:bold;" class="' + (sisaKapasitas<0 ? 'capacity-over' : sisaKapasitas < 50 ? 'capacity-warning' : 'capacity-ok') + '">' + sisaKapasitas.toFixed(1) + ' Kg (' + persenSisa + '%)</td><td></td></tr>';
  html += '<tr><td colspan="11" style="text-align:right; font-weight:bold;">STATUS KAPASITAS</td><td colspan="2" style="text-align:center; font-weight:bold;" class="' + statusClass + '">' + statusKapasitas + ' (' + persenTerpakai + '% terpakai)</td><td></td></tr>';
  html += '</table></bo'+'dy></ht'+'ml>';

  const blob = new Blob(['\uFEFF' + html], {type: 'application/vnd.ms-excel;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Surat_Barang_BERAT_' + safeRackId + '_' + now.toISOString().slice(0,10) + '.xls';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getDefaultBerat(kategori){
    const map = {
      'Server': 20,
      'Storage': 25,
      'Switch': 5,
      'Router': 5,
      'Firewall': 6,
      'Patch Panel': 2,
      'Kabel Fiber': 1,
      'Modul / Transceiver': 0.5,
      'OTB': 3,
      'UPS / PDU': 15,
      'Lainnya': 5
    };
    return map[kategori] || 5;
  }

function updateRackExcelButtonVisibility(){
  const btn = document.getElementById('btnExportRackExcel');
  if(!btn) return;
  if(isClient()){
    btn.style.display = 'none';
  }else{
    btn.style.display = isAdmin() || isSupport() ? 'inline-flex' : 'none';
  }
}

function editCurrentRack(){
  if(isClient()){
    alert('Akun Client tidak bisa edit Rack. Buat tiket untuk request perubahan.');
    return;
  }
  if(selectedRackId) openRackInfoModal(selectedRackId);
}

function deleteCurrentRack(){
  if(!isAdmin() && !isSupport()){
    alert('Hanya Admin dan Support yang bisa hapus Rack.');
    return;
  }
  if(selectedRackId) deleteRack(selectedRackId);
}

function switchRackTab(tab){
  document.getElementById('rackTabInfo').style.display = tab==='info' ? 'block' : 'none';
  document.getElementById('rackTabPT').style.display = tab==='pt' ? 'block' : 'none';
  document.getElementById('rackTabBtnInfo').style.background = tab==='info' ? 'var(--blue)' : 'transparent';
  document.getElementById('rackTabBtnInfo').style.color = tab==='info' ? '#fff' : 'var(--text-mid)';
  document.getElementById('rackTabBtnPT').style.background = tab==='pt' ? 'var(--orange)' : 'transparent';
  document.getElementById('rackTabBtnPT').style.color = tab==='pt' ? '#fff' : 'var(--text-mid)';
}

function onRackAksiJenisChange(){
  const jenis = document.getElementById('r_aksi_jenis')?.value;
  const groupRackBaru = document.getElementById('r_group_rack_baru');
  if(groupRackBaru){
    groupRackBaru.style.display = (jenis==='ganti_nama') ? 'none' : 'block';
  }
}

function onPTBaruLayananChange() {
  const service = document.getElementById('r_pt_baru_layanan').value;
  const powerGroup = document.getElementById('r_pt_baru_power_group');
  const uDariGroup = document.getElementById('r_pt_baru_u_dari_group');
  const uSampaiGroup = document.getElementById('r_pt_baru_u_sampai_group');
  const powerInput = document.getElementById('r_pt_baru_power');
  
  if (service === 'Colocation - Per U') {
    if (powerGroup) powerGroup.style.display = 'none';
    if (uDariGroup) uDariGroup.style.display = 'block';
    if (uSampaiGroup) uSampaiGroup.style.display = 'block';
    if (powerInput) powerInput.value = '';
  } else {
    if (powerGroup) powerGroup.style.display = 'block';
    if (uDariGroup) uDariGroup.style.display = 'none';
    if (uSampaiGroup) uSampaiGroup.style.display = 'none';
  }
}

function onClientLayananChange() {
  const service = document.getElementById('c_layanan').value;
  const powerGroup = document.getElementById('c_power_group');
  const uDariGroup = document.getElementById('c_u_dari_group');
  const uSampaiGroup = document.getElementById('c_u_sampai_group');
  const powerInput = document.getElementById('c_power');
  
  if (service === 'Colocation - Per U') {
    if (powerGroup) powerGroup.style.display = 'none';
    if (uDariGroup) uDariGroup.style.display = 'block';
    if (uSampaiGroup) uSampaiGroup.style.display = 'block';
    if (powerInput) powerInput.value = '';
  } else {
    if (powerGroup) powerGroup.style.display = 'block';
    if (uDariGroup) uDariGroup.style.display = 'none';
    if (uSampaiGroup) uSampaiGroup.style.display = 'none';
  }
}

function toggleRackOtb() {
  const type = document.getElementById('ri_tipeRack').value;
  const otbGroup = document.getElementById('ri_otb_group');
  const powerGroup = document.getElementById('ri_power_group');
  const powerInput = document.getElementById('r_info_power');
  
  if (otbGroup) {
    otbGroup.style.display = type === 'Open Rack' ? 'block' : 'none';
  }
  if (powerGroup) {
    powerGroup.style.display = type === 'Open Rack' ? 'none' : 'block';
  }
  if (type === 'Open Rack' && powerInput) {
    powerInput.value = '';
  }
}

function openRackInfoModal(editId=null){
  try{
    if(!isAdmin() && !isSupport()){
      alert('Maaf, hanya akun Admin dan Support yang bisa tambah/edit Rack. Client tidak bisa.');
      return;
    }
    const modal = document.getElementById('modalRackInfo');
    if(!modal){ alert('Modal Rack Info tidak ditemukan'); return; }
    populateFloorControls();
    if(editId){
      const r = racks.find(x=>x.id===editId);
      if(!r){ alert('Rack tidak ditemukan'); return; }
      document.getElementById('r_info_id').value = r.id;
      document.getElementById('r_info_id').disabled = true;
      document.getElementById('r_info_lokasi').value = r.lokasi;
      document.getElementById('r_info_floor').value = getRackFloor(r);
      document.getElementById('r_info_status').value = r.status;
      document.getElementById('r_info_util').value = r.util;
      document.getElementById('r_info_temp').value = r.temp;
      document.getElementById('r_info_power').value = r.power||'';
      document.getElementById('r_info_u').value = r.u||'';
      document.getElementById('ri_tipeRack').value = r.tipeRack||'Close Rack';
      document.getElementById('ri_otb').value = r.otb||'';
      toggleRackOtb();
      document.getElementById('r_info_ket').value = r.ket||'';
      modal.dataset.editing = editId;
    }else{
      const newId = 'Rack ' + String.fromCharCode(65+Math.floor(Math.random()*6)) + '-' + String(racks.length+10).padStart(2,'0');
      document.getElementById('r_info_id').value = newId;
      document.getElementById('r_info_id').disabled = false;
      document.getElementById('r_info_lokasi').value = '';
      document.getElementById('ri_tipeRack').value = 'Close Rack';
      document.getElementById('ri_otb').value = '';
      toggleRackOtb();
      document.getElementById('r_info_floor').value = floors[0]?.name||'';
      document.getElementById('r_info_status').value = 'Aktif';
      document.getElementById('r_info_util').value = 50;
      document.getElementById('r_info_temp').value = 22;
      document.getElementById('r_info_power').value = '10 A';
      document.getElementById('r_info_u').value = '42U';
      document.getElementById('r_info_ket').value = '';
      modal.dataset.editing = '';
    }
    modal.classList.add('show');
  }catch(e){
    console.error(e);
    alert('Error buka modal Rack Info: '+e.message);
  }
}

function saveRackInfo(){
  try{
    if(!isAdmin() && !isSupport()){ alert('Hanya Admin dan Support yang bisa simpan Rack.'); return; }
    const id = document.getElementById('r_info_id').value.trim();
    const lokasi = document.getElementById('r_info_lokasi').value.trim();
    const lantai = document.getElementById('r_info_floor').value;
    if(!id || !lokasi || !lantai){ alert('ID Rack, Lantai, dan Lokasi wajib diisi'); return; }
    const data = {
      id,
      lokasi,
      lantai,
      status: document.getElementById('r_info_status').value,
      util: parseInt(document.getElementById('r_info_util').value)||0,
      temp: parseInt(document.getElementById('r_info_temp').value)||22,
      power: document.getElementById('ri_tipeRack').value === 'Open Rack' ? '-' : document.getElementById('r_info_power').value.trim(),
      u: document.getElementById('r_info_u').value.trim(),
      ket: document.getElementById('r_info_ket').value.trim(),
      tipeRack: document.getElementById('ri_tipeRack').value,
      otb: document.getElementById('ri_tipeRack').value === 'Open Rack' ? document.getElementById('ri_otb').value.trim() : '',
    };
    const editing = document.getElementById('modalRackInfo').dataset.editing;
    if(editing){
      const idx = racks.findIndex(r=>r.id===editing);
      if(idx>=0) racks[idx]=data;
      if(editing!==id){
        clients.forEach(c=>{
          if((c.lokasi||'').toLowerCase()===editing.toLowerCase()){
            c.lokasi = id;
          }
        });
      }
    }else{
      if(racks.some(r=>r.id===id)){ alert('ID Rack sudah ada'); return; }
      racks.push(data);
    }
    saveData();
    closeModal('modalRackInfo');
    renderRacks();
    if(selectedRackId===id || editing){
      openRackDetail(id);
    }
  }catch(e){
    alert('Error simpan Rack Info: '+e.message);
  }
}

function saveRackPTManagement(){
  if(!isAdmin() && !isSupport()){
    alert('Hanya Admin atau Support yang bisa mengelola PT di rack.');
    return;
  }
  try{
    const modal = document.getElementById('modalRack');
    const targetRackId = modal.dataset.targetRack || document.getElementById('rackModalTargetId').textContent;
    const selectedRacks = Array.from(document.querySelectorAll('#r_rack_multi_select input:checked')).map(input=>input.value);
    const rackList = selectedRacks.length ? selectedRacks : (targetRackId ? [targetRackId] : []);
    const ptName = document.getElementById('r_pt_baru_nama').value.trim();
    const requestedId = document.getElementById('r_pt_baru_id').value.trim();
    const service = document.getElementById('r_pt_baru_layanan').value;
    if(service === 'Colocation - Per U') {
      const uDari = document.getElementById('r_pt_baru_u_dari').value.trim();
      const uSampai = document.getElementById('r_pt_baru_u_sampai').value.trim();
      if(!uDari || !uSampai) {
        alert('U Dari dan U Sampai wajib diisi untuk layanan Colocation - Per U.');
        return;
      }
      if(parseInt(uDari) > parseInt(uSampai)) {
        alert('Nilai U Dari tidak boleh lebih besar dari U Sampai.');
        return;
      }
    }
    const power = document.getElementById('r_pt_baru_power').value.trim() || '5 A';
    const customLocation = document.getElementById('r_pt_lokasi_custom').value.trim();
    const note = document.getElementById('r_pt_keterangan').value.trim();
    const action = document.getElementById('r_aksi_jenis').value;
    const oldClientId = document.getElementById('r_pt_lama_select').value;
    const newName = document.getElementById('r_pt_baru_ganti_nama').value.trim();
    const moveRackId = document.getElementById('r_rack_baru_pindah').value;
    const date = document.getElementById('r_pt_tgl').value || new Date().toISOString().slice(0,10);
    const actionNote = document.getElementById('r_pt_catatan').value.trim();
    let changed=false;

    if(ptName){
      if(!rackList.length){ alert('Pilih minimal satu rack untuk PT baru.'); return; }
      const clientId = requestedId || `RCK-${targetRackId.replace(/[^A-Z0-9]/gi,'').slice(0,4)}-${Date.now().toString().slice(-5)}`;
      if(clients.some(c=>c.id===clientId)){ alert('ID Klien sudah digunakan.'); return; }
      
        // No merge. Always create new ID for each rack.
        rackList.forEach((rackId, index) => {
          let singleClientId = requestedId;
          if(rackList.length > 1 || !requestedId) {
            singleClientId = `RCK-${rackId.replace(/[^A-Z0-9]/gi,'').slice(0,4)}-${Date.now().toString().slice(-5)}` + (rackList.length > 1 ? `-${index}` : '');
          }
          if(!clients.some(c=>c.id===singleClientId)){
            let finalPower = power;
            let uVal = '';
            if(service === 'Colocation - Per U') {
              finalPower = '-';
              const uDari = document.getElementById('r_pt_baru_u_dari').value.trim();
              const uSampai = document.getElementById('r_pt_baru_u_sampai').value.trim();
              if(uDari && uSampai) {
                uVal = `U${uDari} - U${uSampai}`;
              } else if(uDari) {
                uVal = `U${uDari}`;
              }
            }
            clients.push({id:singleClientId, pt:ptName, layanan:service, power:finalPower, u:uVal, lokasi:customLocation || rackId, status:'Aktif', pic:'', email:'', telp:'', ket:note});
            addRackLog(rackId, {tgl:date, type:'tambah_baru', ptId:singleClientId, catatan:`Tambah ${ptName} di ${rackId}`, at:new Date().toISOString()});
            changed=true;
          }
        });
    }

    if(oldClientId){
      const oldClient = clients.find(c=>c.id===oldClientId);
      if(!oldClient){ alert('PT lama tidak ditemukan.'); return; }
      const oldLocation = oldClient.lokasi;
      if(action==='ganti_nama'){
        if(!newName){ alert('Nama PT baru wajib diisi.'); return; }
        oldClient.pt = newName;
      }else if(action==='pindah_rack'){
        if(!moveRackId){ alert('Pilih rack tujuan.'); return; }
        oldClient.lokasi = moveRackId;
      }else{
        if(!newName || !moveRackId){ alert('Nama PT baru dan rack tujuan wajib diisi.'); return; }
        oldClient.pt = newName;
        oldClient.lokasi = moveRackId;
      }
      addRackLog(targetRackId, {tgl:date, type:action, ptId:oldClient.id, catatan:`${oldLocation} → ${oldClient.lokasi}; PT: ${oldClient.pt}${actionNote?' — '+actionNote:''}`, at:new Date().toISOString()});
      changed=true;
    }

    if(!changed){ alert('Isi data PT baru atau pilih PT lama untuk dipindah/diganti.'); return; }
    saveData();
    closeModal('modalRack');
    renderRacks();
    renderClients();
    if(selectedRackId) openRackDetail(selectedRackId);
  }catch(e){
    console.error(e);
    alert('Error simpan PT: '+e.message);
  }
}

async function openAddRackModal(editId=null){
  if(!isAdmin() && !isSupport()){
    alert('Hanya Admin atau Support yang bisa mengelola PT di rack.');
    return;
  }
  const modal = document.getElementById('modalRack');
  const targetRack = racks.find(r=>r.id===(editId || selectedRackId)) || racks[0];
  if(!modal || !targetRack){ alert('Rack tidak ditemukan'); return; }

  document.getElementById('rackModalTargetId').textContent = targetRack.id;
  document.getElementById('rackModalCurrentRackInfo').textContent = targetRack.id;
  document.getElementById('r_pt_baru_nama').value='';
  document.getElementById('r_pt_baru_id').value='';
  document.getElementById('r_pt_baru_layanan').value='Colocation Full Rack';
  document.getElementById('r_pt_baru_power').value='';
  document.getElementById('r_pt_baru_u_dari').value='';
  document.getElementById('r_pt_baru_u_sampai').value='';
  onPTBaruLayananChange();
  document.getElementById('r_pt_jumlah_rack').value=1;
  document.getElementById('r_pt_lokasi_custom').value='';
  document.getElementById('r_pt_keterangan').value='';
  document.getElementById('r_pt_baru_ganti_nama').value='';
  document.getElementById('r_pt_catatan').value='';
  document.getElementById('r_pt_tgl').value = new Date().toISOString().slice(0,10);
  document.getElementById('r_aksi_jenis').value='ganti_nama';
  onRackAksiJenisChange();

  const related = clients.filter(c=>(c.lokasi||'').toLowerCase().includes(targetRack.id.toLowerCase()));
  const currentPTDiv = document.getElementById('rackModalCurrentPTs');
  currentPTDiv.innerHTML = related.length
    ? related.map(c=>`<span class="rack-pt-badge">${c.pt} (${c.id})</span>`).join('')
    : '<span style="font-size:11px;color:var(--text-dim);">Belum ada PT di rack ini</span>';

  // Populate dropdown lantai
  const modalFloorFilter = document.getElementById('r_rack_filter_lantai');
  const floorNames = [...new Set(floors.map(f=>f.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  modalFloorFilter.innerHTML = '<option value="all">-- Semua Lantai --</option>' + floorNames.map(n=> `<option value="${n}">${n}</option>`).join('');
  modalFloorFilter.value = 'all';
  document.getElementById('r_rack_filter_tipe').value = 'all';

  window.renderRackMultiSelect = function() {
    const multi = document.getElementById('r_rack_multi_select');
    const fLantai = document.getElementById('r_rack_filter_lantai').value;
    const fTipe = document.getElementById('r_rack_filter_tipe').value;
    
    // Save currently checked racks before re-rendering
    const currentChecked = Array.from(multi.querySelectorAll('input:checked')).map(i=>i.value);
    // Add the targetRack if it's the first time
    if(currentChecked.length === 0 && document.getElementById('r_pt_baru_nama').value === '') currentChecked.push(targetRack.id);

    const filtered = racks.filter(r => {
      const matchLantai = fLantai === 'all' || getRackFloor(r) === fLantai;
      const matchTipe = fTipe === 'all' || (r.tipeRack || 'Close Rack') === fTipe;
      return matchLantai && matchTipe;
    });

    multi.innerHTML = filtered.map(r=> {
      const isChecked = currentChecked.includes(r.id);
      return `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-mid);padding:4px;"><input type="checkbox" value="${r.id}" ${isChecked?'checked':''} style="accent-color:var(--blue);" onchange="updateSelectedInfo()"> ${r.id} ${r.tipeRack==='Open Rack'?'(Open)':''}</label>`;
    }).join('');
    
    updateSelectedInfo();
  };

  window.updateSelectedInfo = function() { 
    const multi = document.getElementById('r_rack_multi_select');
    const selectedInfo = document.getElementById('rackModalJumlahRackInfo');
    if(selectedInfo && multi) {
       selectedInfo.textContent = multi.querySelectorAll('input:checked').length || 1; 
     }
  };

  renderRackMultiSelect();

  const moveSelect = document.getElementById('r_rack_baru_pindah');
  moveSelect.innerHTML = '<option value="">-- Pilih Rack Tujuan --</option>' + racks
    .filter(r=>r.id!==targetRack.id)
    .map(r=>`<option value="${r.id}">${r.id} - ${r.lokasi}</option>`).join('');
  const oldSelect = document.getElementById('r_pt_lama_select');
  oldSelect.innerHTML = '<option value="">-- Pilih PT yang akan diganti/dipindah --</option>' + related
    .map(c=>`<option value="${c.id}">${c.pt} - ${c.id}</option>`).join('');
  oldSelect.onchange = ()=>{
    const selected = clients.find(c=>c.id===oldSelect.value);
    document.getElementById('r_pt_lama').value = selected?.lokasi || '';
  };
  document.getElementById('r_pt_lama').value='';

  const historyWrap = document.getElementById('rackPergantianHistoryWrap');
  const history = document.getElementById('rackPergantianHistory');
  let logs=[];
  try {
    const token = localStorage.getItem('il_auth_token') || '';
    const res = await fetch(`/api/rack-logs?rackId=${encodeURIComponent(targetRack.id)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    logs = await res.json();
  } catch(e){ logs=[]; }
  historyWrap.style.display = logs.length ? 'block' : 'none';
  history.innerHTML = logs.length ? logs.slice().reverse().map(log=>`<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${log.tgl||'-'}</b> • ${log.catatan||'-'}</div>`).join('') : '';

  modal.dataset.targetRack = targetRack.id;
  modal.classList.add('show');
  switchRackTab('info');
}

function saveRack(){
  if(isClient()){ alert('Client tidak bisa simpan Rack.'); return; }
  const id = document.getElementById('r_id').value.trim();
  const lokasi = document.getElementById('r_lokasi').value.trim();
  if(!id || !lokasi){ alert('ID Rack dan Lokasi wajib diisi'); return; }
  const data = {
    id,
    lokasi,
    status: document.getElementById('r_status').value,
    util: parseInt(document.getElementById('r_util').value)||0,
    temp: parseInt(document.getElementById('r_temp').value)||22,
    power: document.getElementById('r_power').value.trim(),
    u: document.getElementById('r_u').value.trim(),
    ket: document.getElementById('r_ket').value.trim(),
  };
  const editing = document.getElementById('modalRack').dataset.editing;

  // === NEW: Handle Tambah PT Baru KETIK MANUAL ===
  const ptBaruNama = document.getElementById('r_pt_baru_nama').value.trim();
  const ptBaruIdInput = document.getElementById('r_pt_baru_id').value.trim();
  const ptBaruLayanan = document.getElementById('r_pt_baru_layanan').value;
  const ptBaruPower = document.getElementById('r_pt_baru_power').value.trim() || '5 A';

  const ptTgl = document.getElementById('r_pt_tgl').value || new Date().toISOString().slice(0,10);
  const ptLamaSelectId = document.getElementById('r_pt_lama_select').value;
  const ptLamaName = document.getElementById('r_pt_lama').value;
  const ptBaruGantiNama = document.getElementById('r_pt_baru_ganti_nama').value.trim();
  const ptCatatan = document.getElementById('r_pt_catatan').value.trim();

  let logsToSave = [];
  let newClientsCreated = 0;

  // 1. Tambah PT Baru (ketik) langsung ke rack ini
  if(ptBaruNama){
    let newId = ptBaruIdInput;
    if(!newId){
      const prefix = ptBaruNama.split(' ').map(w=>w[0]).join('').substring(0,3).toUpperCase() || 'NEW';
      newId = `RCK-${id.replace(/[^A-Z0-9]/gi,'').substring(0,3).toUpperCase()}-${Date.now().toString().slice(-4)}`;
    }
    if(!clients.some(c=>c.id===newId || c.pt.toLowerCase()===ptBaruNama.toLowerCase())){
      let finalPower = ptBaruPower;
      let uVal = '';
      if(ptBaruLayanan === 'Colocation - Per U') {
        finalPower = '-';
        const uDari = document.getElementById('r_pt_baru_u_dari').value.trim();
        const uSampai = document.getElementById('r_pt_baru_u_sampai').value.trim();
        if(uDari && uSampai) {
          uVal = `U${uDari} - U${uSampai}`;
        } else if(uDari) {
          uVal = `U${uDari}`;
        }
      }
      const newClient = {
        id: newId,
        pt: ptBaruNama,
        layanan: ptBaruLayanan,
        power: finalPower,
        u: uVal,
        lokasi: id,
        status: 'Aktif',
        pic: '',
        email: '',
        telp: '',
        ket: `Ditambahkan dari Rack ${id} pada ${ptTgl}. ${ptCatatan}`.trim()
      };
      clients.push(newClient);
      newClientsCreated++;
      logsToSave.push({
        tgl: ptTgl,
        ptLama: ptLamaName || '(Rack kosong)',
        ptBaru: ptBaruNama,
        ptId: newId,
        catatan: `Tambah PT Baru: ${ptBaruNama} (${newId}) ke ${id}. ${ptCatatan}`,
        oldLokasi: '',
        newLokasi: id,
        type: 'tambah_baru',
        at: new Date().toISOString()
      });
    }else{
      alert(`PT dengan nama "${ptBaruNama}" atau ID "${newId}" sudah ada di Inventory`);
    }
  }

  // 2. Pergantian PT: PT Lama (PILIH) -> PT Baru (KETIK MANUAL)
  if(ptLamaSelectId && ptBaruGantiNama){
    const oldClientIdx = clients.findIndex(c=>c.id===ptLamaSelectId);
    if(oldClientIdx>=0){
      const oldClient = clients[oldClientIdx];
      const oldLokasi = oldClient.lokasi;

      // Buat PT baru sebagai pengganti (ketik manual)
      let gantiNewId = `RCK-${id.replace(/[^A-Z0-9]/gi,'').substring(0,3).toUpperCase()}-${Date.now().toString().slice(-4)}-G`;
      // cek jika PT baru dengan nama sama sudah ada
      let existingNew = clients.find(c=>c.pt.toLowerCase()===ptBaruGantiNama.toLowerCase());
      if(existingNew){
        // kalau sudah ada, pindahkan saja lokasinya ke rack ini
        existingNew.lokasi = id;
        logsToSave.push({
          tgl: ptTgl,
          ptLama: oldClient.pt,
          ptBaru: existingNew.pt,
          ptId: existingNew.id,
          catatan: `Pergantian: ${oldClient.pt} keluar dari ${id}, diganti ${existingNew.pt} (existing). ${ptCatatan}`,
          oldLokasi: oldLokasi,
          newLokasi: id,
          type: 'ganti_existing',
          at: new Date().toISOString()
        });
      }else{
        const newGantiClient = {
          id: gantiNewId,
          pt: ptBaruGantiNama,
          layanan: oldClient.layanan || 'Colocation Full Rack',
          power: oldClient.power || '5 A',
          lokasi: id,
          status: 'Aktif',
          pic: '',
          email: '',
          telp: '',
          ket: `Menggantikan ${oldClient.pt} di ${id} pada ${ptTgl}. ${ptCatatan}`.trim()
        };
        clients.push(newGantiClient);
        newClientsCreated++;
        logsToSave.push({
          tgl: ptTgl,
          ptLama: oldClient.pt,
          ptBaru: ptBaruGantiNama,
          ptId: gantiNewId,
          catatan: `Pergantian PT: ${oldClient.pt} → ${ptBaruGantiNama} di ${id}. ${ptCatatan}`,
          oldLokasi: oldLokasi,
          newLokasi: id,
          type: 'pergantian',
          at: new Date().toISOString()
        });
      }

      // Update PT Lama: tandai keluar dari rack ini (pindahkan ke history atau kosongkan)
      // Kita set lokasinya jadi "Keluar dari <id>" agar tidak lagi terhitung di rack ini, tapi tetap ada di inventory untuk history
      clients[oldClientIdx].lokasi = `Keluar dari ${id} (${ptTgl})`;
      clients[oldClientIdx].ket = (clients[oldClientIdx].ket||'') + ` | Keluar dari ${id} pada ${ptTgl}, digantikan ${ptBaruGantiNama}. ${ptCatatan}`;

      // Log juga di rack lama jika berbeda
      if(oldLokasi && oldLokasi!==id && racks.some(r=>r.id===oldLokasi)){
        addRackLog(oldLokasi, {
          tgl: ptTgl,
          ptLama: oldClient.pt,
          ptBaru: '(Pindah/Keluar ke '+id+')',
          ptId: ptLamaSelectId,
          catatan: `Keluar dari ${oldLokasi} → ${id}, diganti ${ptBaruGantiNama}. ${ptCatatan}`,
          oldLokasi: oldLokasi,
          newLokasi: id,
          type: 'keluar',
          at: new Date().toISOString()
        });
      }
    }
  } else if(ptBaruGantiNama && !ptLamaSelectId){
    // Jika hanya ketik PT baru di kolom pergantian tanpa pilih lama (misal rack kosong diganti)
    let gantiId = `RCK-${id.replace(/[^A-Z0-9]/gi,'').substring(0,3).toUpperCase()}-${Date.now().toString().slice(-4)}-B`;
    if(!clients.some(c=>c.pt.toLowerCase()===ptBaruGantiNama.toLowerCase())){
      const newC = {
        id: gantiId,
        pt: ptBaruGantiNama,
        layanan: 'Colocation Full Rack',
        power: '5 A',
        lokasi: id,
        status: 'Aktif',
        pic: '', email: '', telp: '',
        ket: `Ditambahkan via pergantian di ${id} pada ${ptTgl}. ${ptCatatan}`.trim()
      };
      clients.push(newC);
      newClientsCreated++;
      logsToSave.push({
        tgl: ptTgl,
        ptLama: ptLamaName || '(Kosong)',
        ptBaru: ptBaruGantiNama,
        ptId: gantiId,
        catatan: `PT Baru via pergantian: ${ptBaruGantiNama} masuk ke ${id}. ${ptCatatan}`,
        oldLokasi: '',
        newLokasi: id,
        type: 'pergantian_baru',
        at: new Date().toISOString()
      });
    }
  } else if(!ptBaruNama && !ptBaruGantiNama && ptCatatan){
    // hanya catatan
    logsToSave.push({
      tgl: ptTgl,
      ptLama: ptLamaName || '-',
      ptBaru: '(Catatan)',
      ptId: '',
      catatan: ptCatatan,
      oldLokasi: id,
      newLokasi: id,
      type: 'catatan',
      at: new Date().toISOString()
    });
  }

  // Simpan logs untuk rack ini
  if(logsToSave.length>0){
    logsToSave.forEach(log => {
      addRackLog(id, log);
    });
  }

  // Simpan data rack
  if(editing){
    const idx = racks.findIndex(r=>r.id===editing);
    if(idx>=0) racks[idx]=data;
    if(editing!==id){
      clients.forEach(c=>{
        if((c.lokasi||'').toLowerCase()===editing.toLowerCase()){
          c.lokasi = id;
        }
      });
    }
  }else{
    if(racks.some(r=>r.id===id)){ alert('ID Rack sudah ada, ganti ID lain'); return; }
    racks.push(data);
  }

  saveData();
  closeModal('modalRack');
  renderRacks();
  renderClients();
  if(newClientsCreated>0){
    // optional toast bisa pakai alert ringan
    console.log(`${newClientsCreated} PT baru dibuat`);
  }
  if(selectedRackId===id || editing){
    openRackDetail(id);
  }
}

function deleteRack(id){
  if(!isAdmin() && !isSupport()){
    alert('Hanya Admin dan Support yang bisa menghapus Rack.');
    return;
  }
  showCustomConfirm(`Hapus ${id}? Klien di rack ini tidak terhapus, hanya rack-nya saja.`, () => {
    racks = racks.filter(r=>r.id!==id);
    saveData();
    renderRacks();
    if(selectedRackId===id) closeRackDetail();
    alert(`Rack ${id} berhasil dihapus.`);
  });
}

function setCrossConnectFilter(status){
  currentCrossConnectFilter = status;
  document.querySelectorAll('[data-xcfilter]').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.xcfilter===status);
  });
  renderCrossConnects();
}

function renderCrossConnects(){
  const thXcAksi = document.getElementById('thXcAksi');
  if (thXcAksi) thXcAksi.style.setProperty('display', isClient() ? 'none' : 'table-cell', 'important');
  const btnExportXC = document.getElementById('btnExportCrossConnectPdf');
  if (btnExportXC) btnExportXC.style.display = isClient() ? 'none' : 'inline-flex';
  const tbody = document.getElementById('xcTableBody');
  if(!tbody) return;
  if(isSubclient()) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-dim);">Akses Ditolak. Sub-Account tidak memiliki akses ke CrossConnect.</td></tr>'; return; }
  const q = (document.getElementById('xcSearch')?.value||'').toLowerCase();
  let baseXC = crossConnects;
  if(isClient()){
    baseXC = crossConnects.filter(xc=> xc.clientId===currentUser.clientId || (xc.pt||'').toLowerCase()=== (currentUser.pt||'').toLowerCase() );
  }
  baseXC = baseXC.filter(crossConnectMatchesGlobalFloor);
  updateGlobalFloorIndicators();
  let filtered = baseXC.filter(xc=>{
    const matchQ = !q || xc.id.toLowerCase().includes(q) || (xc.reqId||'').toLowerCase().includes(q) || xc.titikA.toLowerCase().includes(q) || xc.titikB.toLowerCase().includes(q) || (xc.pt||'').toLowerCase().includes(q) || (xc.status||'').toLowerCase().includes(q);
    const matchF = currentCrossConnectFilter==='all' || xc.status===currentCrossConnectFilter;
    return matchQ && matchF;
  });
  const countEl = document.getElementById('xcCountInfo');
  if(countEl) countEl.textContent = `${filtered.length} Koneksi`;
  tbody.innerHTML='';
  if(filtered.length===0){
    const colSpan = isClient() ? 7 : 8;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:32px;color:var(--text-dim);">Belum ada CrossConnect. Buat Ticket CrossConnect melalui menu Tickets.</td></tr>`;
    return;
  }
  let xcHtml = '';
  filtered.sort((a,b)=> new Date(b.date)-new Date(a.date)).forEach(xc=>{
    let badgeClass='ok';
    if(xc.status==='Dalam proses') badgeClass='warn';
    if(xc.status==='Nonaktif' || xc.status==='Dibatalkan') badgeClass='crit';
    if(xc.status==='Menunggu') badgeClass='info';
    xcHtml += `
      <tr style="cursor:pointer;" onclick="openCrossConnectDetail('${escapeHtml(xc.id)}')">
        <td class="item-name">${escapeHtml(xc.id)}<br><span style="font-size:10px;font-family:var(--font-mono);color:var(--cyan);">${escapeHtml(xc.reqId||'')}</span><br><span style="font-size:10px;font-family:var(--font-mono);color:var(--orange);">${xc.kodeLabel?'🏷️ '+escapeHtml(xc.kodeLabel):''}</span></td>
        <td><span style="color:#fff;font-weight:500;">${escapeHtml(xc.pt||'-')}</span><br><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(xc.clientId||'')}</span></td>
        <td>${escapeHtml(xc.titikA||'-')}</td>
        <td>${escapeHtml(xc.titikB||'-')}</td>
        <td style="font-family:var(--font-mono);">${escapeHtml(xc.cableLen||'-')}</td>
        <td><span class="badge info" style="font-size:10px;">${escapeHtml(xc.connType||'-')}</span></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(xc.status)}</span></td>
        ${isClient() ? '' : `
          <td onclick="event.stopPropagation();">
            <div style="display:flex;gap:6px;">
              ${isAdmin() ? `
              <button class="action-icon" title="Edit" onclick="editCrossConnect('${xc.id}')">✏️</button>
              <button class="action-icon danger" title="Hapus" onclick="deleteCrossConnect('${xc.id}')">🗑</button>` : (isSupport() && xc.status!=='Dibatalkan' ? `
              <button class="action-icon" title="Edit" onclick="editCrossConnect('${xc.id}')">✏️</button>
              <button class="action-icon danger" title="Cancel koneksi" onclick="cancelCrossConnect('${xc.id}')">✕</button>` : ``)}
            </div>
          </td>
        `}
      </tr>`;
  });
  tbody.innerHTML = xcHtml;
}

function openCrossConnectDetail(xcId){
  const xc = crossConnects.find(x=>x.id===xcId);
  if(!xc) return;
  if(isClient() && xc.clientId!==currentUser.clientId && (xc.pt||'').toLowerCase()!==(currentUser.pt||'').toLowerCase()){
    alert('Akun Client hanya dapat melihat koneksinya sendiri.');
    return;
  }
  selectedCrossConnectId = xcId;
  document.getElementById('crossconnect-list-view').style.display='none';
  const detailView = document.getElementById('crossconnect-detail-view');
  detailView.style.display='block';
  let badgeClass='ok'; if(xc.status==='Dalam proses') badgeClass='warn'; if(xc.status==='Nonaktif' || xc.status==='Dibatalkan') badgeClass='crit';
  document.getElementById('xcHeaderCard').innerHTML = `
    <div class="client-info">
      <h3>🔗 ${xc.id} <span class="badge ${badgeClass}">${xc.status}</span> <span style="font-family:var(--font-mono);font-size:11px;background:rgba(47,194,216,0.12);padding:4px 8px;border-radius:6px;color:var(--cyan);border:1px solid rgba(47,194,216,0.25);">${xc.reqId||'No REQ'}</span></h3>
      <div class="client-sub">
        <span>🏢 ${xc.pt||'-'}</span>
        <span>📍 ${xc.titikA||'-'} → ${xc.titikB||'-'}</span>
        <span>📏 ${xc.cableLen||'-'}</span>
        <span>🔌 ${xc.connType||'-'}</span>
        <span>📅 ${xc.date||'-'}</span>
      </div>
      <div style="margin-top:8px;font-size:12.5px;color:var(--text-mid);">${xc.desc||'Tidak ada deskripsi'}</div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        ${(isClient() || (isSupport() && xc.status==='Dibatalkan')) ? '' : `<button id="btnEditCrossConnectDetail" class="page-action secondary" style="height:36px;font-size:12px;" onclick="editCrossConnect('${xc.id}')">✏️ Edit Koneksi</button>`}
        ${isClient() ? `<span style="font-size:11px;color:var(--text-dim);padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;">👤 Client View - Hanya Lihat</span>` : ''}
      </div>
    </div>
    <div class="client-stats">
      <div class="mini-stat"><div class="ms-label">Status</div><div class="ms-value ${xc.status==='Aktif'?'':'orange'}">${xc.status}</div></div>
      <div class="mini-stat"><div class="ms-label">Panjang Kabel</div><div class="ms-value cyan">${xc.cableLen||'-'}</div></div>
      <div class="mini-stat"><div class="ms-label">Jenis</div><div class="ms-value" style="font-size:14px;">${xc.connType||'-'}</div></div>
    </div>
  `;

  const titleEl = document.getElementById('xcDetailTitle');
  if(titleEl) titleEl.textContent = '🔗 Detail Koneksi';

  document.getElementById('xcDetailInfo').innerHTML = `
    <div class="profile-fields" style="border-top:none;padding-top:0;">
      <div class="profile-row"><span class="k">ID Koneksi</span><span class="v">${xc.id}</span></div>
      <div class="profile-row"><span class="k">ID Request (Auto)</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);">${xc.reqId||'-'}</span></div>
      <div class="profile-row"><span class="k">PT / Client</span><span class="v">${xc.pt||'-'} (${xc.clientId||''})</span></div>
      <div class="profile-row"><span class="k">Titik A</span><span class="v">${xc.titikA||'-'}</span></div>
      <div class="profile-row"><span class="k">Titik B</span><span class="v">${xc.titikB||'-'}</span></div>
      <div class="profile-row"><span class="k">Panjang Kabel</span><span class="v">${xc.cableLen||'-'}</span></div>
      <div class="profile-row"><span class="k">Jenis Koneksi</span><span class="v">${xc.connType||'-'}</span></div>
      <div class="profile-row"><span class="k">Tanggal</span><span class="v">${xc.date||'-'}</span></div>
      <div class="profile-row"><span class="k">Deskripsi</span><span class="v" style="max-width:200px;text-align:right;">${xc.desc||'-'}</span></div>
    </div>
  `;

  // related tickets (matches reqId, clientId, titikA, titikB, or ticket title)
  const relatedTickets = tickets.filter(t=> (xc.reqId && t.reqId===xc.reqId) || (t.clientId && t.clientId===xc.clientId) || (t.titikA && t.titikA===xc.titikA) || (t.titikB && t.titikB===xc.titikB) || t.title.toLowerCase().includes(xc.id.toLowerCase()) );
  document.getElementById('xcTicketCount').textContent = relatedTickets.length;
  const relDiv = document.getElementById('xcRelatedTickets');
  relDiv.innerHTML='';
  if(relatedTickets.length===0){
    relDiv.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:12px;">Belum ada tiket terkait. Buat tiket baru dengan Titik A/B yang sama.</div>';
  }else{
    relatedTickets.forEach(t=>{
      let sc='info'; if(t.status==='Selesai') sc='ok'; else if(t.status==='Diproses') sc='info'; else sc='warn';
      relDiv.innerHTML+=`<div class="ticket-card" style="padding:12px 14px;cursor:pointer;" onclick="syncConnectionDetailWithTicket('${t.id}')"><div><div class="ticket-id">#${t.id} ${t.reqId?'<span style=\'color:var(--cyan);\'>• '+t.reqId+'</span>':''}</div><div class="ticket-title" style="font-size:12.5px;">[${t.type||'Tiket'}] ${t.title}</div><div class="ticket-meta">${t.pt||''} ${t.titikA ? '• ' + t.titikA + ' → ' + t.titikB : ''} ${t.cableLen?'• 📏 '+t.cableLen:''}</div></div><div class="ticket-right"><span class="badge ${sc}" style="font-size:10px;">${t.status}</span></div></div>`;
    });
  }
}

function syncConnectionDetailWithTicket(ticketId) {
  const t = tickets.find(x => x.id === ticketId);
  if (!t) return;

  // 1. Update Title Header (#xcDetailTitle)
  const titleEl = document.getElementById('xcDetailTitle');
  if (titleEl) {
    titleEl.textContent = `🔗 Detail ${t.type || 'Koneksi'}`;
  }

  // 2. Update Edit Button (#btnEditCrossConnectDetail)
  const editBtn = document.getElementById('btnEditCrossConnectDetail');
  if (editBtn) {
    const editLabel = t.type === 'Permintaan Terminate' ? 'Edit Terminate' : `Edit ${t.type || 'Koneksi'}`;
    editBtn.textContent = `✏️ ${editLabel}`;
    editBtn.onclick = () => {
      if (isClient()) {
        alert('Maaf, akun Client hanya bisa lihat. Edit hanya untuk Admin & Support.');
        return;
      }
      openTicketModal(t.id);
    };
  }

  // 3. Update Detail Info (#xcDetailInfo) based on ticket type
  const xcInfo = document.getElementById('xcDetailInfo');
  if (!xcInfo) return;

  function ticketStatusColor(status) {
    if (status === 'Selesai') return '#5dcaa5';       /* badge.ok */
    if (status === 'Disetujui') return '#ef9f27';     /* badge.warn */
    if (status === 'Dibatalkan') return '#f09595';    /* badge.crit */
    if (status === 'Menunggu Approval' || status === 'Baru') return '#ef9f27'; /* badge.warn */
    if (status === 'Diproses') return '#7de0ec';      /* badge.cyan */
    return '#aebbd1';
  }
  let fieldsHtml = '';
  if (t.type === 'Masuk Barang' || t.type === 'Keluar Barang') {
    fieldsHtml = `
      <div class="profile-row"><span class="k">Tipe Tiket</span><span class="v" style="color:var(--cyan);font-weight:600;">${escapeHtml(t.type)}</span></div>
      <div class="profile-row"><span class="k">ID Tiket</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);font-weight:600;">#${t.id}</span></div>
      <div class="profile-row"><span class="k">ID Request (Auto)</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);">${escapeHtml(t.reqId || '-')}</span></div>
      <div class="profile-row"><span class="k">PT / Client</span><span class="v">${escapeHtml(t.pt || '-')} (${escapeHtml(t.clientId || '')})</span></div>
      <div class="profile-row"><span class="k">Nama Perangkat</span><span class="v">${escapeHtml(t.devName || t.nama || t.title || '-')}</span></div>
      <div class="profile-row"><span class="k">Kategori</span><span class="v">${escapeHtml(t.devCategory || t.kategori || '-')}</span></div>
      <div class="profile-row"><span class="k">Serial Number (SN)</span><span class="v" style="font-family:var(--font-mono);">${escapeHtml(t.sn || '-')}</span></div>
      <div class="profile-row"><span class="k">Jumlah Unit</span><span class="v">${escapeHtml(t.qty || t.jumlah || 1)} unit</span></div>
      <div class="profile-row"><span class="k">Lokasi Rack</span><span class="v">${escapeHtml(t.rackPos || t.lokasi || '-')}</span></div>
      <div class="profile-row"><span class="k">Status Tiket</span><span class="v" style="color:${ticketStatusColor(t.status)};font-weight:600;">${escapeHtml(t.status || '-')}</span></div>
      <div class="profile-row"><span class="k">Tanggal Tiket</span><span class="v">${escapeHtml(t.createdAt || t.date || '-')}</span></div>
      ${t.approvedBy ? `<div class="profile-row"><span class="k">Disetujui oleh</span><span class="v" style="color:#ff8f4d;font-weight:600;">${escapeHtml(t.approvedBy)}</span></div>` : ''}
      ${t.completedBy ? `<div class="profile-row"><span class="k">Diselesaikan oleh</span><span class="v" style="color:#1d9e75;font-weight:600;">${escapeHtml(t.completedBy)}</span></div>` : ''}
      <div class="profile-row"><span class="k">Keterangan / Alasan</span><span class="v" style="max-width:200px;text-align:right;">${escapeHtml(t.notes || t.alasan || t.desc || '-')}</span></div>
    `;
  } else if (t.type === 'Permintaan Terminate') {
    fieldsHtml = `
      <div class="profile-row"><span class="k">Tipe Tiket</span><span class="v" style="color:var(--orange);font-weight:600;">${escapeHtml(t.type)}</span></div>
      <div class="profile-row"><span class="k">ID Tiket</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);font-weight:600;">#${t.id}</span></div>
      <div class="profile-row"><span class="k">ID Request (Auto)</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);">${escapeHtml(t.reqId || '-')}</span></div>
      <div class="profile-row"><span class="k">PT / Client</span><span class="v">${escapeHtml(t.pt || '-')} (${escapeHtml(t.clientId || '')})</span></div>
      <div class="profile-row"><span class="k">Rack Diberhentikan</span><span class="v">${escapeHtml(t.rackId || t.lokasi || '-')}</span></div>
      <div class="profile-row"><span class="k">Status Tiket</span><span class="v" style="color:${ticketStatusColor(t.status)};font-weight:600;">${escapeHtml(t.status || '-')}</span></div>
      <div class="profile-row"><span class="k">Tanggal Pengajuan</span><span class="v">${escapeHtml(t.createdAt || t.date || '-')}</span></div>
      ${t.approvedBy ? `<div class="profile-row"><span class="k">Disetujui oleh</span><span class="v" style="color:#ff8f4d;font-weight:600;">${escapeHtml(t.approvedBy)}</span></div>` : ''}
      ${t.completedBy ? `<div class="profile-row"><span class="k">Diselesaikan oleh</span><span class="v" style="color:#1d9e75;font-weight:600;">${escapeHtml(t.completedBy)}</span></div>` : ''}
      <div class="profile-row"><span class="k">Alasan Terminate</span><span class="v" style="max-width:200px;text-align:right;">${escapeHtml(t.notes || t.alasan || '-')}</span></div>
    `;
  } else {
    fieldsHtml = `
      <div class="profile-row"><span class="k">Tipe Tiket</span><span class="v" style="color:var(--cyan);font-weight:600;">CrossConnect</span></div>
      <div class="profile-row"><span class="k">ID Tiket</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);font-weight:600;">#${t.id}</span></div>
      <div class="profile-row"><span class="k">ID Request (Auto)</span><span class="v" style="color:var(--cyan);font-family:var(--font-mono);">${escapeHtml(t.reqId || '-')}</span></div>
      <div class="profile-row"><span class="k">PT / Client</span><span class="v">${escapeHtml(t.pt || '-')} (${escapeHtml(t.clientId || '')})</span></div>
      <div class="profile-row"><span class="k">Titik A</span><span class="v">${escapeHtml(t.titikA || '-')}</span></div>
      <div class="profile-row"><span class="k">Titik B</span><span class="v">${escapeHtml(t.titikB || '-')}</span></div>
      <div class="profile-row"><span class="k">Panjang Kabel</span><span class="v">${escapeHtml(t.cableLen || '-')}</span></div>
      <div class="profile-row"><span class="k">Jenis Koneksi</span><span class="v">${escapeHtml(t.connType || '-')}</span></div>
      <div class="profile-row"><span class="k">Status Tiket</span><span class="v" style="color:${ticketStatusColor(t.status)};font-weight:600;">${escapeHtml(t.status || '-')}</span></div>
      <div class="profile-row"><span class="k">Tanggal</span><span class="v">${escapeHtml(t.createdAt || t.date || '-')}</span></div>
      ${t.approvedBy ? `<div class="profile-row"><span class="k">Disetujui oleh</span><span class="v" style="color:#ff8f4d;font-weight:600;">${escapeHtml(t.approvedBy)}</span></div>` : ''}
      ${t.completedBy ? `<div class="profile-row"><span class="k">Diselesaikan oleh</span><span class="v" style="color:#1d9e75;font-weight:600;">${escapeHtml(t.completedBy)}</span></div>` : ''}
      <div class="profile-row"><span class="k">Deskripsi / Judul</span><span class="v" style="max-width:200px;text-align:right;">${escapeHtml(t.notes || t.title || '-')}</span></div>
    `;
  }

  xcInfo.innerHTML = `
    <div class="profile-fields" style="border-top:none;padding-top:0;background:rgba(59,124,240,0.06);border:1px solid rgba(59,124,240,0.2);border-radius:8px;padding:12px;">
      <div style="font-size:11px;font-weight:600;color:var(--cyan);margin-bottom:8px;">📌 DETAIL TIKET DISINKRONKAN DENGAN #${t.id} (${t.type})</div>
      ${fieldsHtml}
    </div>
  `;

  showToast(`Detail disinkronkan dengan Tiket #${t.id} (${t.type})`, 'info');
}

function closeCrossConnectDetail(){
  selectedCrossConnectId=null;
  document.getElementById('crossconnect-detail-view').style.display='none';
  document.getElementById('crossconnect-list-view').style.display='block';
  renderCrossConnects();
}

function editCrossConnect(xcId){
  if(isClient()){
    alert('Maaf, akun Client hanya bisa lihat. Edit hanya untuk Admin & Support.');
    return;
  }
  const xc = crossConnects.find(x=>x.id===xcId);
  if(!xc) return;
  // buka modal tiket dengan data dari xc untuk edit, atau buat tiket baru
  // untuk simpel, buka tiket modal dengan prefill dan juga edit xc langsung via prompt? Kita buat modal edit sederhana dengan prompt atau buka ticket modal untuk koneksi
  // Di sini kita akan edit crossconnect langsung via modal ticket yang sudah ada dengan tipe CrossConnect
  // Cari tiket terkait dengan reqId
  let relatedTicket = null;
  if(xc.reqId){
    relatedTicket = tickets.find(t=>t.reqId===xc.reqId && t.type==='CrossConnect');
  }
  if(relatedTicket){
    openTicketModal(relatedTicket.id);
  }else{
    // jika tidak ada tiket, buka modal untuk buat tiket baru dari data xc
    openTicketModalWithType('CrossConnect');
    setTimeout(()=>{
      document.getElementById('tk_titikA').value = xc.titikA||'';
      document.getElementById('tk_titikB').value = xc.titikB||'';
      document.getElementById('tk_cable_len').value = xc.cableLen||'';
      document.getElementById('tk_conn_type').value = xc.connType||'Single Mode Fiber';
      document.getElementById('tk_req_id').value = xc.reqId||'';
      document.getElementById('tk_title').value = `Edit Koneksi ${xc.id} - ${xc.titikA} ke ${xc.titikB}`;
      const ptOpt = Array.from(document.getElementById('tk_pt').options).find(o=>o.textContent.includes(xc.pt||''));
      if(ptOpt) document.getElementById('tk_pt').value = ptOpt.value;
    }, 200);
  }
}

function cancelCrossConnect(id){
  if(!isSupport()){
    alert('Hanya Support yang bisa membatalkan koneksi dari daftar ini.');
    return;
  }
  const connection=crossConnects.find(item=>item.id===id);
  if(!connection || connection.status==='Dibatalkan') return;
  showCustomConfirm(`Cancel koneksi ${id}? Data koneksi tetap tersimpan sebagai riwayat.`, () => {
    connection.status='Dibatalkan';
    connection.cancelledAt=new Date().toISOString();
    connection.cancelledBy=currentUser?.email||'support';
    saveData();
    renderCrossConnects();
    if(selectedCrossConnectId===id) openCrossConnectDetail(id);
    alert(`Koneksi ${id} berhasil dibatalkan.`);
  });
}

function deleteCrossConnect(id){
  if(isClient()){
    alert('Maaf, akun Client hanya bisa lihat. Hapus hanya untuk Admin.');
    return;
  }
  if(!isAdmin()){
    alert('Hanya Admin yang bisa hapus CrossConnect.');
    return;
  }
  showCustomConfirm(`Hapus koneksi ${id}?`, () => {
    crossConnects = crossConnects.filter(x=>x.id!==id);
    saveData();
    renderCrossConnects();
    if(selectedCrossConnectId===id) closeCrossConnectDetail();
    alert(`Koneksi ${id} berhasil dihapus.`);
  });
}

function pdfSafeText(value){
  const normalized=String(value ?? '').normalize('NFD');
  let ascii='';
  for(const char of normalized){
    const code=char.charCodeAt(0);
    ascii += code>=32 && code<=126 ? char : ' ';
  }
  return ascii.trim().replace(/ +/g,' ');
}

function pdfEscape(value){
  return pdfSafeText(value).split('\\').join('\\\\').split('(').join('\\(').split(')').join('\\)');
}

function pdfTruncate(value, max){
  const text = pdfSafeText(value);
  return text.length>max ? text.slice(0,Math.max(1,max-3))+'...' : text;
}

function pdfColor(color){ return color.join(' '); }

function createStaffPdfReport(title, subtitle){
  const width=842, height=595, left=38, right=804, bottom=42;
  const pages=[];
  const text=(page,x,y,size,value,color=[0.08,0.13,0.21])=>{
    page.commands.push(`${pdfColor(color)} rg BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`);
  };
  const rect=(page,x,y,w,h,color)=>page.commands.push(`${pdfColor(color)} rg ${x} ${y} ${w} ${h} re f`);
  const line=(page,x1,y1,x2,y2,color=[0.80,0.84,0.90],widthLine=.45)=>page.commands.push(`${pdfColor(color)} RG ${widthLine} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const newPage=()=>{
    const page={commands:[],y:508};
    rect(page,0,0,width,height,[1,1,1]);
    rect(page,0,540,width,55,[0.045,0.105,0.19]);
    text(page,left,569,17,title,[1,1,1]);
    text(page,left,552,8.5,subtitle,[0.76,0.86,0.96]);
    pages.push(page);
    return page;
  };
  newPage();
  const current=()=>pages[pages.length-1];
  const addText=(value,size=9,color=[0.17,0.23,0.31])=>{
    let page=current();
    if(page.y<bottom+25){ newPage(); page=current(); }
    text(page,left,page.y,size,value,color); page.y-=size+12;
  };
  const addSection=(value)=>{
    let page=current();
    if(page.y<bottom+100){ newPage(); page=current(); }
    rect(page,left,page.y-18,766,24,[0.92,0.95,0.99]);
    text(page,left+8,page.y-10,11,value,[0.045,0.105,0.19]);
    page.y-=34;
  };
  const addTable=(columns,rows)=>{
    const totalWidth=columns.reduce((sum,column)=>sum+column.width,0);
    const drawHeader=()=>{
      let page=current();
      rect(page,left,page.y-4,totalWidth,18,[0.08,0.18,0.34]);
      let x=left;
      columns.forEach(column=>{ text(page,x+4,page.y+2,column.headerSize||column.size||7.2,column.label,[1,1,1]); x+=column.width; });
      page.y-=22;
    };
    let page = current();
    if(page.y<bottom+40){ newPage(); page=current(); }
    drawHeader();
    rows.forEach((row,index)=>{
      let page=current();
      if(page.y<bottom+22){ newPage(); drawHeader(); page=current(); }
      if(index%2===0) rect(page,left,page.y-3,totalWidth,17,[0.965,0.975,0.99]);
      let x=left;
      columns.forEach(column=>{
        const max=Math.max(5,Math.floor((column.width-8)/(column.size||7.2)/.52));
        text(page,x+4,page.y+2,column.size||7.2,pdfTruncate(row[column.key]||'',max),[0.10,0.15,0.22]);
        x+=column.width;
      });
      line(page,left,page.y-4,left+totalWidth,page.y-4,[0.86,0.89,0.93],.3);
      page.y-=18;
    });
    current().y-=24;
  };
  const finish=(filename)=>{
    pages.forEach((page,index)=>{
      line(page,left,30,right,30,[0.78,0.82,0.88],.45);
      text(page,left,18,7.5,'Interlink Data Center - Dokumen Operasional',[0.36,0.42,0.50]);
      text(page,right-58,18,7.5,`Halaman ${index+1}/${pages.length}`,[0.36,0.42,0.50]);
    });
    const contents=pages.map(page=>page.commands.join('\n'));
    const pageNumbers=pages.map((_,index)=>4+index*2);
    const contentNumbers=pages.map((_,index)=>5+index*2);
    const objects=[];
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[2]=`<< /Type /Pages /Kids [${pageNumbers.map(number=>number+' 0 R').join(' ')}] /Count ${pages.length} >>`;
    objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    pages.forEach((_,index)=>{
      objects[pageNumbers[index]]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumbers[index]} 0 R >>`;
      objects[contentNumbers[index]]=`<< /Length ${contents[index].length} >>\nstream\n${contents[index]}\nendstream`;
    });
    let pdf='%PDF-1.4\n% Interlink PDF\n';
    const offsets=[0];
    for(let index=1;index<objects.length;index++){
      offsets[index]=pdf.length;
      pdf+=`${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xref=pdf.length;
    pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let index=1;index<objects.length;index++) pdf+=`${String(offsets[index]).padStart(10,'0')} 00000 n \n`;
    pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const blob=new Blob([pdf],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url; anchor.download=filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return {addText,addSection,addTable,finish};
}

function staffExportAllowed(){
  if(isAdmin() || isSupport()) return true;
  alert('Export PDF hanya tersedia untuk Admin dan Support.');
  return false;
}

function exportCrossConnects(){
  if(!staffExportAllowed()) return;
  const now=new Date();
  const report=createStaffPdfReport('LAPORAN CROSSCONNECT','Ringkasan koneksi data center - diekspor '+now.toLocaleString('id-ID'));
  const total=crossConnects.length;
  const active=crossConnects.filter(item=>item.status==='Aktif').length;
  const processing=crossConnects.filter(item=>item.status==='Dalam proses').length;
  const inactive=crossConnects.filter(item=>item.status==='Nonaktif').length;
  report.addText(`Total koneksi: ${total}   |   Aktif: ${active}   |   Dalam proses: ${processing}   |   Nonaktif: ${inactive}`,9.5,[0.05,0.18,0.34]);
  report.addSection('DAFTAR KONEKSI');
  report.addTable([
    {key:'id',label:'ID / REQ',width:94},{key:'pt',label:'PT / CLIENT',width:180},
    {key:'titikA',label:'TITIK A',width:110},{key:'titikB',label:'TITIK B',width:115},
    {key:'cableLen',label:'KABEL',width:62},{key:'connType',label:'JENIS',width:125},{key:'status',label:'STATUS',width:80}
  ],crossConnects.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(item=>({
    id:`${item.id}${item.reqId?' / '+item.reqId:''}`,pt:item.pt||'-',titikA:item.titikA||'-',titikB:item.titikB||'-',
    cableLen:item.cableLen||'-',connType:item.connType||'-',status:item.status||'-'
  })));
  report.finish(`interlink-crossconnect-${now.toISOString().slice(0,10)}.pdf`);
}

function updateTitikAFromRack() {
  const rackSelect = document.getElementById('tk_rack');
  const ptSelect = document.getElementById('tk_pt');
  const titikAInput = document.getElementById('tk_titikA');
  if (!titikAInput) return;

  let currentRackId = (rackSelect && rackSelect.value) ? rackSelect.value : (typeof selectedRackId !== 'undefined' && selectedRackId ? selectedRackId : '');

  // 1. Get PT Name
  let ptName = '';
  if (ptSelect && ptSelect.value) {
    const cl = typeof clients !== 'undefined' ? clients.find(c => c.id === ptSelect.value) : null;
    if (cl && cl.pt) ptName = cl.pt;
  }
  if (!ptName && ptSelect && ptSelect.selectedIndex > 0) {
    const optText = ptSelect.options[ptSelect.selectedIndex].text;
    if (optText) ptName = optText.split('•')[0].trim();
  }
  if (!ptName && currentRackId && typeof clients !== 'undefined') {
    const cl = clients.find(c => (c.lokasi||'').toLowerCase().includes(currentRackId.toLowerCase()));
    if (cl && cl.pt) {
      ptName = cl.pt;
      if (ptSelect && !ptSelect.value) ptSelect.value = cl.id;
    }
  }
  if (!ptName && typeof isClient === 'function' && isClient()) {
    const cl = typeof getClientDataForCurrentUser === 'function' ? getClientDataForCurrentUser() : null;
    if (cl && cl.pt) ptName = cl.pt;
  }

  // Helper to extract floor name cleanly (e.g. "Rack A - Lantai 2 - Interlink" -> "Lantai 2")
  function extractFloorName(str) {
    if (!str) return '';
    const match = str.match(/Lantai\s*\d+/i);
    if (match) return match[0];
    if (str.includes('-')) return str.split('-')[0].trim();
    return str.trim();
  }

  // 2. Get Floor Name
  let floorName = '';
  if (currentRackId && typeof racks !== 'undefined') {
    const rObj = racks.find(r => r.id.toLowerCase() === currentRackId.toLowerCase());
    if (rObj) {
      floorName = rObj.lantai || extractFloorName(rObj.lokasi);
    }
  }
  if (!floorName && ptSelect && ptSelect.value && typeof clients !== 'undefined') {
    const cl = clients.find(c => c.id === ptSelect.value);
    if (cl && cl.lokasi) {
      floorName = extractFloorName(cl.lokasi);
    }
  }

  // 3. Format Titik A: "Nama PT (Lantai)"
  if (ptName && floorName) {
    titikAInput.value = `${ptName} (${floorName})`;
  } else if (ptName) {
    titikAInput.value = ptName;
  } else if (floorName) {
    titikAInput.value = floorName;
  } else if (currentRackId) {
    titikAInput.value = currentRackId;
  }

  if (typeof generateKodeLabel === 'function') generateKodeLabel();
}

function onTitikBRackChange() {
  const selectB = document.getElementById('tk_titikB');
  const selectPtTujuan = document.getElementById('tk_pt_tujuan');
  if (!selectB) return;

  const rackId = selectB.value;
  if (rackId && selectPtTujuan && typeof clients !== 'undefined') {
    const matchingClient = clients.find(c => (c.lokasi||'').toLowerCase().includes(rackId.toLowerCase()));
    if (matchingClient && matchingClient.pt) {
      selectPtTujuan.value = matchingClient.pt;
    }
  }
  if (typeof generateKodeLabel === 'function') generateKodeLabel();
}

function onPtTujuanSelectChange() {
  const selectB = document.getElementById('tk_titikB');
  const selectPtTujuan = document.getElementById('tk_pt_tujuan');
  if (!selectPtTujuan) return;

  const ptName = selectPtTujuan.value;
  if (ptName && selectB && typeof clients !== 'undefined' && typeof racks !== 'undefined') {
    const matchingClient = clients.find(c => c.pt.toLowerCase() === ptName.toLowerCase());
    if (matchingClient && matchingClient.lokasi) {
      const foundRack = racks.find(r => matchingClient.lokasi.toLowerCase().includes(r.id.toLowerCase()));
      if (foundRack) {
        selectB.value = foundRack.id;
      }
    }
  }
  if (typeof generateKodeLabel === 'function') generateKodeLabel();
}

function populateTitikBDropdown(selectedTitikB = '') {
  const selectB = document.getElementById('tk_titikB');
  if (!selectB || selectB.tagName !== 'SELECT') return;

  let html = `<option value="">-- Pilih Lantai Tujuan --</option>`;
  
  if (typeof floors !== 'undefined' && Array.isArray(floors) && floors.length > 0) {
    floors.forEach(f => {
      if (!f.name) return;
      const label = `${f.name}${f.area ? ' - ' + f.area : ''}`;
      html += `<option value="${escapeAccountHtml(f.name)}">📍 ${escapeAccountHtml(label)}</option>`;
    });
  }

  selectB.innerHTML = html;

  if (selectedTitikB) {
    const exists = Array.from(selectB.options).some(o => o.value === selectedTitikB);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = selectedTitikB;
      opt.textContent = selectedTitikB;
      selectB.appendChild(opt);
    }
    selectB.value = selectedTitikB;
  }
}

function openTicketModalWithType(type){
  const clData = (isClient() || isSubclient()) ? clients.find(cl => cl.id === currentUser.clientId) : null;
  if (clData) {
    if (clData.status === 'Suspend') {
      showToast('Akun PT Anda berstatus SUSPEND. Anda hanya dapat melihat data (tidak dapat mengajukan tiket).', 'error');
      return;
    }
    if (clData.status === 'Terminate' || clData.status === 'Terminated') {
      showToast('Akun PT Anda telah ditutup (Terminate). Tidak dapat mengajukan tiket.', 'error');
      return;
    }
    if ((clData.status === 'Hold') && type !== 'Masuk Barang') {
      showToast('Akun PT Anda berstatus HOLD. Hanya diperbolehkan mengajukan tiket Masuk Barang.', 'error');
      return;
    }
  }

  const selectedRackIdVal = document.getElementById('tk_rack') ? document.getElementById('tk_rack').value : (typeof selectedRackId !== 'undefined' ? selectedRackId : '');
  const rObj = selectedRackIdVal ? racks.find(r => r.id.toLowerCase() === selectedRackIdVal.toLowerCase()) : null;
  if (rObj && rObj.status === 'Hold' && type !== 'Masuk Barang') {
    showToast(`Rack ${rObj.id} sedang berstatus HOLD. Hanya diperbolehkan mengajukan tiket Masuk Barang.`, 'error');
    return;
  }

  openTicketModal();
  setTimeout(()=>{
    document.getElementById('tk_type').value = type;
    onTicketTypeChange();
    if(type==='CrossConnect' && !document.getElementById('tk_req_id').value){
      const now = new Date();
      const ymd = now.toISOString().slice(0,10).replace(/-/g,'');
      const rand = Math.random().toString(36).substring(2,6).toUpperCase();
      document.getElementById('tk_req_id').value = `REQ-${ymd}-${rand}`;
    }
  }, 100);
}

function toggleOtbFields() {
  const connType = document.getElementById('tk_conn_type');
  if(!connType) return;
  const isOtb = connType.value.toLowerCase().includes('otb');
  const gOtb = document.getElementById('tk_group_otb');
  const gPort = document.getElementById('tk_group_port');
  if(gOtb) gOtb.style.display = isOtb ? 'block' : 'none';
  if(gPort) gPort.style.display = isOtb ? 'block' : 'none';
}

function generateKodeLabel() {
  const type = document.getElementById('tk_type').value;
  const labelInput = document.getElementById('tk_kode_label');
  if(!labelInput) return;
  if(type !== 'CrossConnect') {
    labelInput.value = '';
    return;
  }

  // Parse Rack A
  let rackAStr = document.getElementById('tk_titikA').value.trim();
  if(!rackAStr) {
    const rackId = document.getElementById('tk_rack').value;
    if(rackId) {
      const rObj = racks.find(r=>r.id===rackId);
      if(rObj) rackAStr = rObj.id;
    }
  }

  // Parse Rack B
  let rackBStr = document.getElementById('tk_titikB').value.trim();
  
  function extractRackCode(str) {
    if(!str) return '';
    const match = str.match(/Rack\s*([A-Za-z0-9\-]+)/i);
    if(match) {
      return 'R' + match[1].replace(/-/g, '').toUpperCase();
    }
    return str.substring(0, 4).toUpperCase().replace(/\s/g,'');
  }

  const codeA = extractRackCode(rackAStr) || 'RXXX';
  const codeB = extractRackCode(rackBStr) || 'RXXX';

  const baseLabel = `${codeA}-${codeB}`;
  
  // Hitung jumlah koneksi spesifik untuk titik A dan B ini
  let count = 0;
  crossConnects.forEach(xc => {
    if(xc.kodeLabel && xc.kodeLabel.includes(baseLabel)) count++;
  });
  tickets.forEach(t => {
    if(t.type === 'CrossConnect' && t.kodeLabel && t.kodeLabel.includes(baseLabel) && t.status !== 'Selesai' && t.status !== 'Dibatalkan') {
      count++;
    }
  });

  const modal = document.getElementById('modalTicket');
  const editingId = modal.dataset.editing;
  if(editingId) {
    const existing = tickets.find(t=>t.id===editingId);
    if(existing && existing.kodeLabel && existing.kodeLabel.includes(baseLabel)) {
       labelInput.value = existing.kodeLabel;
       return;
    }
  }

  // Generate Year (2 digit)
  const tkDateInput = document.getElementById('tk_date');
  const ticketDate = tkDateInput ? tkDateInput.value : '';
  const dateObj = ticketDate ? new Date(ticketDate) : new Date();
  const year2 = String(dateObj.getFullYear()).slice(-2); // e.g. 2026 -> "26"

  // Generate Request Count (2 digit) - mulai dari 00 untuk yang pertama
  const reqCountStr = String(count).padStart(2, '0'); // e.g. 0 -> "00"

  // Generate Port (2 digit)
  const portInput = document.getElementById('tk_port_num');
  let portStr = '01';
  if(portInput && portInput.value) {
     const pMatch = portInput.value.match(/\d+/);
     if(pMatch) {
         portStr = String(pMatch[0]).padStart(2, '0');
     }
  }

  // Combine to form e.g. 260301
  const sequenceStr = `${year2}${reqCountStr}${portStr}`;
  
  labelInput.value = `${baseLabel} / ${sequenceStr}`;
}

function extractRackCode(str) {
    if(!str) return '';
    const match = str.match(/Rack\s*([A-Za-z0-9\-]+)/i);
    if(match) {
      return 'R' + match[1].replace(/-/g, '').toUpperCase();
    }
    return str.substring(0, 4).toUpperCase().replace(/\s/g,'');
  }

function generateRackPosDropdown(rackId, containerId, selectId, placeholder) {
  const container = document.getElementById(containerId);
  if(!container) return;
  const rack = racks.find(r => r.id === rackId || r.lokasi === rackId || (r.id && rackId && r.id.toLowerCase() === rackId.toLowerCase()));
  
  const isTicket = selectId === 'tk_dev_pos';
  const posGroup = document.getElementById(isTicket ? 'tk_group_pos' : 'd_group_pos');
  const beratGroup = document.getElementById(isTicket ? 'tk_group_berat' : 'd_group_berat');

  if(rack && rack.tipeRack === 'Open Rack') {
     if(posGroup) posGroup.style.display = 'block';
     if(beratGroup && isTicket) beratGroup.style.display = 'none';
     container.innerHTML = `<input id="${selectId}" class="form-input" placeholder="${placeholder}">`;
     if(rack) document.getElementById(selectId).value = rack.id;
  } else {
     // For Close Rack or undefined, change U position to Berat Perangkat (Hide U, Show Berat)
     if(posGroup) posGroup.style.display = 'none';
     if(beratGroup) beratGroup.style.display = 'block';
     container.innerHTML = `<input id="${selectId}" type="hidden" value="${rack ? rack.id : ''}">`;
  }
}

function toggleTkOpenRack() {
  const t = document.getElementById('tk_tipe_rack').value;
  const fg = document.getElementById('tk_open_floor_group');
  const ug = document.getElementById('tk_open_u_group');
  if(t === 'Open Rack') {
    fg.style.display = 'block';
    ug.style.display = 'block';
    const floorNames = [...new Set(floors.map(f=>f.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const floorSel = document.getElementById('tk_open_floor');
    if(floorSel.options.length <= 1) {
      floorSel.innerHTML = '<option value="">-- Pilih Lantai --</option>' + floorNames.map(n=> `<option value="${n}">${n}</option>`).join('');
    }
    const uSel = document.getElementById('tk_open_u');
    if(uSel.options.length <= 1) {
      let uOpts = '<option value="">-- Pilih U --</option>';
      for(let i=1; i<=46; i++) uOpts += `<option value="${i}U">${i}U</option>`;
      uSel.innerHTML = uOpts;
    }
  } else {
    fg.style.display = 'none';
    ug.style.display = 'none';
    document.getElementById('tk_open_floor').value = '';
    document.getElementById('tk_open_u').value = '';
  }
}

function toggleTkOpenRackB() {
  const t = document.getElementById('tk_tipe_titikB').value;
  const fg = document.getElementById('tk_open_floor_groupB');
  const ug = document.getElementById('tk_open_u_groupB');
  if(t === 'Open Rack') {
    fg.style.display = 'block';
    ug.style.display = 'block';
    const floorNames = [...new Set(floors.map(f=>f.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const floorSel = document.getElementById('tk_open_floorB');
    if(floorSel.options.length <= 1) {
      floorSel.innerHTML = '<option value="">-- Pilih Lantai --</option>' + floorNames.map(n=> `<option value="${n}">${n}</option>`).join('');
    }
    const uSel = document.getElementById('tk_open_uB');
    if(uSel.options.length <= 1) {
      let uOpts = '<option value="">-- Pilih U --</option>';
      for(let i=1; i<=46; i++) uOpts += `<option value="${i}U">${i}U</option>`;
      uSel.innerHTML = uOpts;
    }
  } else {
    fg.style.display = 'none';
    ug.style.display = 'none';
    document.getElementById('tk_open_floorB').value = '';
    document.getElementById('tk_open_uB').value = '';
  }
}

function updateTicketExportButtonLabel(){
  const button=document.getElementById('btnExportTicketsPdf');
  if(!button) return;
  const typeLabel=currentTicketTypeFilter==='all' ? 'Semua' : currentTicketTypeFilter.replace('Permintaan ','');
  const statusLabel=currentTicketStatusFilter==='all' ? '' : ` • ${currentTicketStatusFilter}`;
  button.textContent=`📄 Export PDF: ${typeLabel}${statusLabel}`;
  button.title=`Export PDF sesuai filter aktif: ${typeLabel}${statusLabel}`;
}

function setTicketFilter(type){
  currentTicketTypeFilter = type;
  const typeDropdown=document.getElementById('ticketTypeFilterSelect');
  if(typeDropdown) typeDropdown.value=type;
  document.querySelectorAll('[data-tfilter]').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.tfilter===type);
  });
  updateTicketExportButtonLabel();
  renderTickets();
}

function setTicketStatusFilter(status){
  // Support does not display "Semua Status". Click the active status again
  // to clear that status filter and return to all tickets.
  if(isSupport() && status===currentTicketStatusFilter && status!=='all'){
    status = 'all';
  }
  currentTicketStatusFilter = status;
  const statusDropdown=document.getElementById('ticketStatusFilterSelect');
  if(statusDropdown) statusDropdown.value=status;
  document.querySelectorAll('[data-tstatus]').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.tstatus===status);
  });
  updateTicketExportButtonLabel();
  renderTickets();
}

function renderTickets(){
  const btnExportTickets = document.getElementById('btnExportTicketsPdf');
  if (btnExportTickets) btnExportTickets.style.display = isClient() ? 'none' : 'inline-flex';
  updateTicketExportButtonLabel();
  updateTicketNavBadge();
  const container = document.getElementById('ticketList');
  const empty = document.getElementById('ticketEmpty');
  if(!container) return;
  const q = (document.getElementById('ticketSearch')?.value||'').toLowerCase();
  let baseTickets = tickets;
  if(isSubclient()) {
    baseTickets = baseTickets.filter(t => t.type !== 'CrossConnect');
  }
  if(isClient()){
    baseTickets = tickets.filter(t=> t.clientId===currentUser.clientId || (t.pt||'').toLowerCase().trim() === (currentUser.pt||'').toLowerCase().trim());
  }
  baseTickets = baseTickets.filter(ticketMatchesGlobalFloor);
  updateGlobalFloorIndicators();
  let filtered = baseTickets.filter(t=>{
    const matchQ = !q || t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || (t.pt||'').toLowerCase().includes(q) || (t.rack||'').toLowerCase().includes(q) || (t.desc||'').toLowerCase().includes(q);
    const matchType = currentTicketTypeFilter==='all' || t.type===currentTicketTypeFilter;
    const matchStatus = currentTicketStatusFilter==='all' || t.status===currentTicketStatusFilter;
    return matchQ && matchType && matchStatus;
  });
  const countEl = document.getElementById('ticketCountInfo');
  if(countEl) countEl.textContent = `${filtered.length} Tiket`;
  if(filtered.length===0){
    container.style.display='none';
    empty.style.display='block';
    return;
  }
  function getTicketStatusRank(status) {
    if (['Menunggu Approval', 'Diproses', 'Pending', 'Baru'].includes(status)) return 0;
    if (status === 'Disetujui') return 1;
    if (['Selesai', 'Dibatalkan'].includes(status)) return 2;
    return 1;
  }

  let ticketsHtml = '';
  filtered.sort((a, b) => {
    // 1. Status Rank: Active / Needs Approval at the VERY TOP (0), then Disetujui (1), then Selesai / Dibatalkan (2)
    const rankA = getTicketStatusRank(a.status);
    const rankB = getTicketStatusRank(b.status);
    if (rankA !== rankB) return rankA - rankB;

    // 2. CreatedAt ISO timestamp comparison (newest time first)
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;

    // 3. Array Insertion Index (newest created ticket in memory/array first)
    const idxA = tickets.indexOf(a);
    const idxB = tickets.indexOf(b);
    return idxB - idxA;
  }).forEach(t=>{
    let typeBadge='', typeIcon='';
    if(t.type==='CrossConnect'){ typeBadge='info'; typeIcon='🔗'; }
    if(t.type==='Masuk Barang'){ typeBadge='cyan'; typeIcon='📥'; }
    if(t.type==='Keluar Barang'){ typeBadge='warn'; typeIcon='📤'; }
    if(t.type===TERMINATION_TYPE){ typeBadge='crit'; typeIcon='⛔'; }
    let prioClass='ok'; if(t.priority==='Prioritas tinggi') prioClass='crit'; else if(t.priority==='Prioritas sedang') prioClass='warn';
    let statusClass='info'; if(t.status==='Selesai') statusClass='ok'; else if(t.status==='Diproses') statusClass='cyan'; else if(t.status==='Dibatalkan') statusClass='crit'; else if(t.status==='Disetujui') statusClass='warn'; else statusClass='warn';
    let extraInfo='';
    if(t.type==='CrossConnect'){
      extraInfo = `${t.titikA||t.rack||'-'} → ${t.titikB||'-'} • ${t.connType||'-'}${t.cableLen ? ' • 📏 '+t.cableLen : ''}${(t.type==='CrossConnect' && t.reqId) ? ' • 🆔 '+t.reqId : ''}`;
    }else if(t.type==='Masuk Barang'){
      extraInfo = `${t.devName||'-'} • ${t.devQty||1} unit • ${t.devTglMasuk||t.date||'-'} • ${t.rack||'-'}`;
    }else if(t.type==='Keluar Barang'){
      extraInfo = `${t.outName||'-'} • ${t.outTgl||'-'} • ${t.outReason||'-'}`;
    }else if(t.type===TERMINATION_TYPE){
      const cutoff=formatTerminationDate(t.terminateEligibleAt);
      extraInfo = `⛔ Terminate • ${isTerminationFullyApproved(t) ? 'Disetujui lengkap • akses ditutup '+cutoff : getTerminationApprovalLabel(t)+' • cutoff '+cutoff}`;
    }
    ticketsHtml += `
      <div class="ticket-card ${t.type===TERMINATION_TYPE ? 'termination-ticket' : ''}" onclick="openTicketModal('${t.id}')" style="cursor:pointer;padding:18px 22px;">
        <div style="flex:1;min-width:280px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="ticket-id" style="font-size:14px!important;">#${t.id}</span>
            ${t.type==='CrossConnect' && t.reqId ? `<span style="font-size:11px;font-family:var(--font-mono);background:rgba(59,124,240,0.14);padding:3px 8px;border-radius:5px;color:#8cb1ee;border:1px solid rgba(59,124,240,0.25);font-weight:600;">${t.reqId}</span>` : ''}
            <span class="badge ${typeBadge} ${t.type===TERMINATION_TYPE ? 'termination-badge' : ''}" style="font-size:11.5px!important;padding:4px 10px!important;">${typeIcon} ${t.type}</span>
            <span class="badge ${prioClass}" style="font-size:11px!important;padding:3px 8px!important;">${t.priority}</span>
          </div>
          <div class="ticket-title" style="margin-top:8px;font-size:16px!important;">${escapeHtml(t.title)}</div>
          <div class="ticket-meta" style="font-size:13.5px!important;margin-top:6px;">🏢 <b style="color:#fff;">${escapeHtml(t.pt||'-')}</b> • 📍 ${escapeHtml(t.rack||'-')} • ${extraInfo}</div>
          ${t.desc ? `<div class="ticket-meta" style="margin-top:6px;color:var(--text-mid);font-size:13px!important;">${escapeHtml((t.desc||'').substring(0,140))}${(t.desc||'').length>140?'...':''}</div>` : ''}
          
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:11.5px;font-family:var(--font-mono);background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:10px;color:var(--text-mid);">📅 ${escapeHtml(t.date||'-')}</span>
            ${t.createdBy ? `<span style="font-size:11.5px;font-family:var(--font-mono);background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:10px;color:var(--text-mid);">Dibuat oleh: <b>${escapeHtml(t.createdBy)}</b></span>` : ''}
            ${t.autoCreate?'<span style="font-size:11.5px;font-family:var(--font-mono);background:rgba(47,194,216,0.12);padding:3px 10px;border-radius:10px;color:var(--cyan);border:1px solid rgba(47,194,216,0.25);font-weight:600;">⚡ Auto Inventory</span>':''}
          </div>

        </div>
        <div class="ticket-right ${isSupport() ? `support-ticket-actions ${['Selesai','Dibatalkan'].includes(t.status) ? 'status-only' : ''}` : ''}" style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;justify-content:center;">
          ${isClient() ? `<div style="font-size:11px;color:var(--text-dim);text-align:right;">Edit & Approve hanya Admin/Support</div>` : ``}
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="badge ${statusClass}" style="font-size:12.5px!important;padding:5px 12px!important;font-weight:600!important;">${t.status}</span>
            ${isClient() ? `<span style="font-size:11px;color:var(--text-dim);padding:6px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;">👤 Detail Klien</span>` : (
              ['Selesai','Dibatalkan'].includes(t.status) ? `` : `
              ${t.type===TERMINATION_TYPE && (isSupport() ? t.supportApprovedAt : t.adminApprovedAt) ? `` : `<button class="action-icon" style="${(t.status === 'Diproses' || t.status === 'Menunggu Approval') ? 'background:rgba(29,158,117,0.18)!important;border-color:rgba(29,158,117,0.48)!important;color:#5dcaa5;' : ''}" title="${t.status==='Disetujui'?'Selesaikan Tiket':'Approve Tiket'}" onclick="event.stopPropagation(); quickCompleteTicket('${t.id}')">✅</button>`}
              <button class="action-icon" title="Edit Tiket" onclick="event.stopPropagation(); openTicketModal('${t.id}')">✏️</button>
              `
            )}
            ${['Selesai','Dibatalkan'].includes(t.status) ? 
              (isAdmin() ? `<button class="action-icon danger" title="Hapus" onclick="event.stopPropagation(); deleteTicket('${t.id}')">🗑</button>` : ``) 
              : 
              (!isClient() ? (isAdmin() ? `<button class="action-icon danger" title="Hapus" onclick="event.stopPropagation(); deleteTicket('${t.id}')">🗑</button>` : `<button class="action-icon danger" title="Cancel tiket" onclick="event.stopPropagation(); cancelTicket('${t.id}')">✕</button>`) : ``)
            }
          </div>
          ${(t.approvedBy || t.completedBy) ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;margin-top:4px;">
            ${t.approvedBy ? `<span style="font-size:11px;font-family:var(--font-mono);color:#5dcaa5;font-weight:600;">Disetujui: ${t.approvedBy}</span>` : ''}
            ${t.completedBy ? `<span style="font-size:11px;font-family:var(--font-mono);color:#8cb1ee;font-weight:600;">Selesai: ${t.completedBy}</span>` : ''}
          </div>` : ''}
        </div>
      </div>`;
  });
  container.innerHTML = ticketsHtml;
}

function onTicketTypeChange(){
  const type = document.getElementById('tk_type').value;
  const isTermination = type===TERMINATION_TYPE;
  document.getElementById('tk_fields_cross').style.display = type==='CrossConnect' ? 'grid' : 'none';
  const groupTitle = document.getElementById('tk_group_title');
  if(groupTitle) groupTitle.style.display = type === 'CrossConnect' ? 'block' : 'none';
  document.getElementById('tk_fields_masuk').style.display = type==='Masuk Barang' ? 'grid' : 'none';
  document.getElementById('tk_fields_keluar').style.display = type==='Keluar Barang' ? 'grid' : 'none';
  
  const posLabel = document.getElementById('tk_pos_label');
  if(posLabel) posLabel.textContent = type === 'Masuk Barang' ? 'Berat Perangkat (Kg)' : 'U Position / Rack Pos';

  generateKodeLabel();
  const terminateFields = document.getElementById('tk_fields_terminate');
  if(terminateFields) terminateFields.style.display = isTermination ? 'block' : 'none';
  const autoWrapper = document.getElementById('tk_auto_wrapper');
  if(autoWrapper) autoWrapper.style.display = isTermination ? 'none' : 'block';
  if(isTermination){
    document.getElementById('tk_auto_create').checked = false;
    const estimate = document.getElementById('tk_terminate_estimate');
    const eligibleAt = estimate.dataset.eligibleAt || createTerminationEligibleAt();
    estimate.dataset.eligibleAt = eligibleAt;
    estimate.textContent = formatTerminationDate(eligibleAt) + ' (hari ke-4)';
    if(isClient()){
      document.getElementById('tk_status').value = 'Menunggu Approval';
      const title = document.getElementById('tk_title');
      if(!title.value.trim()) title.value = `Permintaan Terminate - ${currentUser.pt||'Layanan Client'}`;
    }
  }
  const reqWrap = document.getElementById('tk_req_wrapper');
  if(reqWrap){
    if(type==='CrossConnect'){
      reqWrap.style.display = 'flex';
      const reqInput = document.getElementById('tk_req_id');
      if(!reqInput.value){
        const now = new Date();
        const ymd = now.toISOString().slice(0,10).replace(/-/g,'');
        const rand = Math.random().toString(36).substring(2,6).toUpperCase();
        reqInput.value = `REQ-${ymd}-${rand}`;
      }
    }else{
      reqWrap.style.display = 'none';
    }
  }
}

function checkCurrentHoldStatus() {
  // Hanya cek status hold pada level client/PT
  let selectedPtId = '';
  if (isClient() || isSubclient()) {
    selectedPtId = currentUser.clientId;
  } else {
    const ptSelect = document.getElementById('tk_pt');
    if (ptSelect) selectedPtId = ptSelect.value;
  }
  if (selectedPtId) {
    const clData = clients.find(cl=>cl.id===selectedPtId);
    if (clData && clData.status === 'Hold') {
      return true;
    }
  }
  return false;
}

function updateTkTypeOptionsForHold() {
  const tkType = document.getElementById('tk_type');
  if(!tkType) return;
  const currentVal = tkType.value;
  const modal = document.getElementById('modalTicket');
  const isEditing = modal && modal.dataset.editing;

  // Get client status
  const clDataUI = (isClient() || isSubclient()) ? clients.find(cl => cl.id === currentUser.clientId) : null;
  const clStatus = clDataUI ? clDataUI.status : null;

  // Check rack hold
  const selectedRackIdVal = document.getElementById('tk_rack') ? document.getElementById('tk_rack').value : (typeof selectedRackId !== 'undefined' ? selectedRackId : '');
  const rObj = selectedRackIdVal ? racks.find(r => r.id.toLowerCase() === selectedRackIdVal.toLowerCase()) : null;
  const isRackHold = rObj && rObj.status === 'Hold';

  // For non-client roles: show all options
  if (!isClient() && !isSubclient()) {
    tkType.innerHTML = `<option value="CrossConnect">🔗 CrossConnect</option>
      <option value="Masuk Barang">📥 Masuk Barang</option>
      <option value="Keluar Barang">📤 Keluar Barang</option>
      <option value="Permintaan Terminate" data-client-only>⛔ Permintaan Terminate</option>`;
    if(Array.from(tkType.options).some(o => o.value === currentVal)) tkType.value = currentVal;
    else tkType.value = tkType.options[0].value;
    onTicketTypeChange();
    return;
  }

  // Client / Subclient: only Masuk Barang + Keluar Barang, filtered by status
  const isHoldStatus = clStatus === 'Hold' || isRackHold || isSubclient();
  if(isHoldStatus && !isEditing) {
    tkType.innerHTML = `<option value="Masuk Barang">📥 Masuk Barang</option>`;
    tkType.value = 'Masuk Barang';
  } else if(!isEditing) {
    tkType.innerHTML = `<option value="Masuk Barang">📥 Masuk Barang</option>
      <option value="Keluar Barang">📤 Keluar Barang</option>`;
    if(Array.from(tkType.options).some(o => o.value === currentVal)) tkType.value = currentVal;
    else tkType.value = 'Masuk Barang';
  }

  onTicketTypeChange();
}

function openTicketModal(editId=null){
  const modal = document.getElementById('modalTicket');
  modal.dataset.editing = editId || '';
  const tkType = document.getElementById('tk_type');
  
  // Enable form inputs and show Simpan button by default
  const modalInputs = modal.querySelectorAll('.form-input, input, select, textarea');
  modalInputs.forEach(el => {
    if (el.id !== 'tk_req_id' && el.id !== 'tk_kode_label') {
      el.disabled = false;
    }
  });
  const saveBtn = modal.querySelector('.btn-modal-primary');
  if (saveBtn) saveBtn.style.display = '';

  const clDataUI = (isClient() || isSubclient()) ? clients.find(cl=>cl.id===currentUser.clientId) : null;
  const isHold = clDataUI && clDataUI.status === 'Hold';

  // Dynamic dropdown rebuilding based on role and Hold status
  updateTkTypeOptionsForHold();
  
  const ptSelect = document.getElementById('tk_pt');
  const rackSelect = document.getElementById('tk_rack');
  ptSelect.onchange = function() {
    updateTitikAFromRack();
    generateKodeLabel();
    updateTkTypeOptionsForHold();
  };
  rackSelect.onchange = function() { 
    updateTitikAFromRack();
    generateKodeLabel(); 
    generateRackPosDropdown(this.value, 'tk_dev_pos_container', 'tk_dev_pos', 'Rack A-04 U10-U12'); 
    updateTkTypeOptionsForHold();
  };
  const devExistingSelect = document.getElementById('tk_dev_existing');
  const ticketBeingEdited = editId ? tickets.find(t=>t.id===editId) : null;
  const ownClient = isClient() ? getClientDataForCurrentUser() : null;
  const selectableClients = isClient() ? (ownClient ? [ownClient] : []) : clients;
  const selectableRacks = isClient() && ownClient
    ? racks.filter(r=>(ownClient.lokasi||'').toLowerCase().includes(r.id.toLowerCase()))
    : racks;

  ptSelect.innerHTML = '<option value="">-- Pilih PT --</option>';
  selectableClients.forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.pt} • ${c.id} (${c.lokasi||'-'})`;
    ptSelect.appendChild(opt);
  });
  rackSelect.innerHTML = '<option value="">-- Pilih Rack --</option>';
  selectableRacks.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.id} - ${r.lokasi}`;
    rackSelect.appendChild(opt);
  });
  populateTitikBDropdown(ticketBeingEdited ? ticketBeingEdited.titikB : '', ticketBeingEdited ? ticketBeingEdited.ptTujuan : '');
  devExistingSelect.innerHTML = '<option value="">-- Ketik manual / pilih perangkat aktif --</option>';
  const activeDevs = devices.filter(d=>d.type==='masuk' && !d.exited && (!isClient() || d.clientId===ownClient?.id));
  activeDevs.forEach(d=>{
    const cl = clients.find(c=>c.id===d.clientId);
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.nama} • ${d.sn||'No SN'} • (${d.jumlah||1} unit) • ${cl?cl.pt:'-'} • ${d.rackPos||cl?.lokasi||''}`;
    devExistingSelect.appendChild(opt);
  });
  devExistingSelect.onchange = function() {
    const selId = this.value;
    if(!selId) return;
    const dev = devices.find(d=>d.id===selId);
    if(!dev) return;
    document.getElementById('tk_out_name').value = dev.nama;
    document.getElementById('tk_out_sn').value = dev.sn || '';
    if(document.getElementById('tk_out_qty')) {
      const devQty = parseInt(dev.jumlah) || 1;
      document.getElementById('tk_out_qty').value = 1;
      document.getElementById('tk_out_qty').max = devQty;
    }
  };

  document.getElementById('tk_date').valueAsDate = new Date();
  const dMasuk = document.getElementById('tk_dev_tglMasuk');
  if(dMasuk) dMasuk.valueAsDate = new Date();
  const dKeluar = document.getElementById('tk_out_tgl');
  if(dKeluar) dKeluar.valueAsDate = new Date();
  document.getElementById('tk_auto_create').checked = true;

  if(editId){
    const t = tickets.find(x=>x.id===editId);
    if(!t) return;
    if(isClient()){
      alert('Maaf, akun Client tidak bisa edit tiket. Hanya Admin & Support yang bisa edit & approve selesai. Anda hanya bisa lihat detail tiket.');
      // Disable inputs and hide save button for read-only view
      modalInputs.forEach(el => {
        el.disabled = true;
      });
      if (saveBtn) saveBtn.style.display = 'none';
    }
    document.getElementById('tk_req_id').value = t.reqId || t.id;
    document.getElementById('tk_type').value = t.type;
    document.getElementById('tk_priority').value = t.priority;
    document.getElementById('tk_status').value = t.status;
    document.getElementById('tk_date').value = t.date||new Date().toISOString().slice(0,10);
    document.getElementById('tk_title').value = t.title;
    document.getElementById('tk_pt').value = t.clientId||'';
    document.getElementById('tk_rack').value = t.rack||'';
    const labelInput = document.getElementById('tk_kode_label');
    if(labelInput) labelInput.value = t.kodeLabel || '';
    document.getElementById('tk_desc').value = t.desc||'';
    document.getElementById('tk_auto_create').checked = t.autoCreate||false;
    document.getElementById('tk_titikA').value = t.titikA||t.rack||'';
    document.getElementById('tk_titikB').value = t.titikB||'';
    document.getElementById('tk_tipe_rack').value = t.tipeRackRequest || 'Close Rack';
    toggleTkOpenRack();
    if(document.getElementById('tk_tipe_titikB')) {
       document.getElementById('tk_tipe_titikB').value = t.tipeRackRequestB || 'Close Rack';
       toggleTkOpenRackB();
    }
    setTimeout(() => {
      if(t.tipeRackRequest === 'Open Rack') {
         document.getElementById('tk_open_floor').value = t.openRackFloor || '';
         document.getElementById('tk_open_u').value = t.openRackU || '';
      }
      if(t.tipeRackRequestB === 'Open Rack' && document.getElementById('tk_tipe_titikB')) {
         document.getElementById('tk_open_floorB').value = t.openRackFloorB || '';
         document.getElementById('tk_open_uB').value = t.openRackUB || '';
      }
    }, 50);
    document.getElementById('tk_conn_type').value = t.connType||'Single Mode Fiber';
    if(document.getElementById('tk_pt_tujuan')) document.getElementById('tk_pt_tujuan').value = t.ptTujuan || '';
    if(document.getElementById('tk_otb_num')) document.getElementById('tk_otb_num').value = t.otbNum || '';
    if(document.getElementById('tk_port_num')) document.getElementById('tk_port_num').value = t.portNum || '';
    toggleOtbFields();
    document.getElementById('tk_cable_len').value = t.cableLen||'';
    document.getElementById('tk_dev_name').value = t.devName||'';
    document.getElementById('tk_dev_cat').value = t.devCat||'Server';
    document.getElementById('tk_dev_qty').value = t.devQty||1;
    document.getElementById('tk_dev_sn').value = t.devSn||'';
    setBeratInput('tk_dev_berat', 'tk_dev_berat_unit', t.devBerat);
    document.getElementById('tk_dev_tglMasuk').value = t.devTglMasuk||t.date||'';
    generateRackPosDropdown(t.rack || t.clientId, 'tk_dev_pos_container', 'tk_dev_pos', 'Rack A-04 U10-U12');
    setTimeout(() => { if(document.getElementById('tk_dev_pos')) document.getElementById('tk_dev_pos').value = t.devPos||t.rack||''; }, 50);
    document.getElementById('tk_dev_existing').value = t.devExistingId||'';
    document.getElementById('tk_out_name').value = t.outName||'';
    if(document.getElementById('tk_out_qty')) document.getElementById('tk_out_qty').value = t.outQty||1;
    document.getElementById('tk_out_sn').value = t.outSn||'';
    document.getElementById('tk_out_tgl').value = t.outTgl||'';
    document.getElementById('tk_out_reason').value = t.outReason||'';
    document.getElementById('tk_terminate_estimate').dataset.eligibleAt = t.terminateEligibleAt||'';
    modal.dataset.editing = editId;

    // Populate approval info
    const approvalInfo = document.getElementById('tk_approval_info');
    const approvedByWrap = document.getElementById('tk_approved_by_wrap');
    const completedByWrap = document.getElementById('tk_completed_by_wrap');
    const approvedByVal = document.getElementById('tk_approved_by_val');
    const completedByVal = document.getElementById('tk_completed_by_val');

    if(t.approvedBy || t.completedBy) {
      if(approvalInfo) approvalInfo.style.display = 'block';
      if(t.approvedBy) {
        if(approvedByWrap) approvedByWrap.style.display = 'block';
        if(approvedByVal) approvedByVal.textContent = t.approvedBy;
      } else {
        if(approvedByWrap) approvedByWrap.style.display = 'none';
      }
      if(t.completedBy) {
        if(completedByWrap) completedByWrap.style.display = 'block';
        if(completedByVal) completedByVal.textContent = t.completedBy;
      } else {
        if(completedByWrap) completedByWrap.style.display = 'none';
      }
    } else {
      if(approvalInfo) approvalInfo.style.display = 'none';
    }
  }else{
    const now = new Date();
    const ymd = now.toISOString().slice(0,10).replace(/-/g,'');
    const rand = Math.random().toString(36).substring(2,6).toUpperCase();
    const autoReqId = `REQ-${ymd}-${rand}`;
    document.getElementById('tk_req_id').value = autoReqId;
    
    // Ensure type matches available options
    const tkTypeEl = document.getElementById('tk_type');
    if(tkTypeEl && tkTypeEl.options.length > 0) {
      if(!Array.from(tkTypeEl.options).some(o=>o.value === 'CrossConnect')) {
         tkTypeEl.value = tkTypeEl.options[0].value;
      } else {
         tkTypeEl.value = 'CrossConnect';
      }
    }

    document.getElementById('tk_priority').value = 'Prioritas sedang';
    document.getElementById('tk_status').value = 'Diproses';
    document.getElementById('tk_title').value = '';
    
    if(typeof selectedRackId !== 'undefined' && selectedRackId) {
      document.getElementById('tk_rack').value = selectedRackId;
      const cl = (typeof clients !== 'undefined') ? clients.find(c => (c.lokasi||'').toLowerCase().includes(selectedRackId.toLowerCase())) : null;
      if (cl && document.getElementById('tk_pt')) {
        document.getElementById('tk_pt').value = cl.id;
      }
    } else if (isClient()) {
      const ownClient = getClientDataForCurrentUser();
      if (ownClient && document.getElementById('tk_pt')) {
        document.getElementById('tk_pt').value = ownClient.id;
        if (ownClient.lokasi && document.getElementById('tk_rack')) {
          const rFound = racks.find(r => ownClient.lokasi.toLowerCase().includes(r.id.toLowerCase()));
          if (rFound) document.getElementById('tk_rack').value = rFound.id;
        }
      }
    } else {
      if (document.getElementById('tk_pt') && document.getElementById('tk_pt').options.length > 1) {
        document.getElementById('tk_pt').selectedIndex = 1;
        const selectedPtId = document.getElementById('tk_pt').value;
        const cl = clients.find(c => c.id === selectedPtId);
        if (cl && cl.lokasi && document.getElementById('tk_rack')) {
          const rFound = racks.find(r => cl.lokasi.toLowerCase().includes(r.id.toLowerCase()));
          if (rFound) document.getElementById('tk_rack').value = rFound.id;
        }
      }
    }
    updateTitikAFromRack();
    document.getElementById('tk_desc').value = '';
    document.getElementById('tk_titikB').value = '';
    if(document.getElementById('tk_pt_tujuan')) document.getElementById('tk_pt_tujuan').value = '';
    document.getElementById('tk_tipe_rack').value = 'Close Rack';
    toggleTkOpenRack();
    if(document.getElementById('tk_tipe_titikB')) {
       document.getElementById('tk_tipe_titikB').value = 'Close Rack';
       toggleTkOpenRackB();
    }
    document.getElementById('tk_cable_len').value = '';
    document.getElementById('tk_dev_name').value = '';
    document.getElementById('tk_dev_sn').value = '';
    setBeratInput('tk_dev_berat', 'tk_dev_berat_unit', 0);
    document.getElementById('tk_out_name').value = '';
    if(document.getElementById('tk_out_qty')) document.getElementById('tk_out_qty').value = 1;
    document.getElementById('tk_out_sn').value = '';
    document.getElementById('tk_out_reason').value = '';
    document.getElementById('tk_terminate_estimate').dataset.eligibleAt = '';
    modal.dataset.editing = '';
    generateRackPosDropdown('', 'tk_dev_pos_container', 'tk_dev_pos', 'Rack A-04 U10-U12');

    // Hide approval info for new tickets
    const approvalInfo = document.getElementById('tk_approval_info');
    if(approvalInfo) approvalInfo.style.display = 'none';
  }

  onTicketTypeChange();

  devExistingSelect.onchange = function(){
    const devId = this.value;
    if(!devId) return;
    const d = devices.find(x=>x.id===devId);
    if(d){
      document.getElementById('tk_out_name').value = d.nama;
      document.getElementById('tk_out_sn').value = d.sn||'';
      const cl = clients.find(c=>c.id===d.clientId);
      if(cl){
        document.getElementById('tk_pt').value = cl.id;
        document.getElementById('tk_rack').value = d.rackPos?.split(' ')[0]+' '+ (d.rackPos?.split(' ')[1]||'') || cl.lokasi || '';
      }
    }
  };

  ptSelect.onchange = function(){
    const clientId = this.value;
    if(clientId){
      const c = clients.find(x=>x.id===clientId);
      updateTkTypeOptionsForHold();
      if(c && c.lokasi){
        document.getElementById('tk_rack').value = racks.find(r=> c.lokasi.includes(r.id))?.id || c.lokasi;
        updateTitikAFromRack();
        generateRackPosDropdown(document.getElementById('tk_rack').value || c.lokasi, 'tk_dev_pos_container', 'tk_dev_pos', 'Rack A-04 U10-U12');
        generateKodeLabel();
      }
    }
  };
  generateKodeLabel();

  const statusSelect = document.getElementById('tk_status');
  statusSelect.disabled = isClient();
  if(isClient() && !editId){
    if(!ownClient){
      alert('Profil Client tidak ditemukan. Hubungi Admin.');
      return;
    }
    ptSelect.value = ownClient.id;
    const ownRack = selectableRacks[0];
    if (ownRack) rackSelect.value = ownRack.id;
    updateTitikAFromRack();
    generateRackPosDropdown(ownRack?.id || ownClient.lokasi || '', 'tk_dev_pos_container', 'tk_dev_pos', 'Rack A-04 U10-U12');
    setTimeout(() => { if(document.getElementById('tk_dev_pos')) document.getElementById('tk_dev_pos').value = ownRack?.id || ownClient.lokasi || ''; }, 50);
    statusSelect.value = 'Menunggu Approval';
  }

  // Populate Tiket Terkait section in modalTicket if editId exists
  const relatedSection = document.getElementById('tk_related_section');
  const relatedList = document.getElementById('tk_related_list');
  const relatedCount = document.getElementById('tk_related_count');
  if (editId && relatedSection && relatedList) {
    const currentT = tickets.find(x => x.id === editId);
    if (currentT) {
      const rels = tickets.filter(x => x.id !== editId && (
        (currentT.reqId && x.reqId === currentT.reqId) ||
        (currentT.clientId && x.clientId === currentT.clientId) ||
        (currentT.rack && x.rack === currentT.rack)
      ));
      if (rels.length > 0) {
        relatedSection.style.display = 'block';
        if (relatedCount) relatedCount.textContent = rels.length;
        let relHtml = '';
        rels.forEach(rt => {
          let sc = 'info';
          if (rt.status === 'Selesai') sc = 'ok';
          else if (rt.status === 'Diproses') sc = 'cyan';
          else if (rt.status === 'Dibatalkan') sc = 'crit';
          else sc = 'warn';
          relHtml += `
            <div class="ticket-card" style="padding:10px 12px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;" onclick="openTicketModal('${rt.id}')">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <span style="font-weight:600;font-size:12px;color:var(--cyan);">#${rt.id}</span>
                  <span style="font-size:12px;color:#fff;margin-left:6px;">[${rt.type}] ${rt.title}</span>
                  <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${rt.pt||''} ${rt.rack ? '• ' + rt.rack : ''} • ${rt.date||''}</div>
                </div>
                <span class="badge ${sc}" style="font-size:10px;">${rt.status}</span>
              </div>
            </div>`;
        });
        relatedList.innerHTML = relHtml;
      } else {
        relatedSection.style.display = 'none';
      }
    } else {
      relatedSection.style.display = 'none';
    }
  } else if (relatedSection) {
    relatedSection.style.display = 'none';
  }

  modal.classList.add('show');
}

function saveTicket(){
  const type = document.getElementById('tk_type').value;
  let title = document.getElementById('tk_title').value.trim();
  const ptSelect = document.getElementById('tk_pt');
  let ptNameRaw = ptSelect.options[ptSelect.selectedIndex]?.textContent || '';
  let ptName = ptNameRaw.split(' • ')[0] || ptSelect.value;
  const ownClient = isClient() ? getClientDataForCurrentUser() : null;
  if(isClient()){
    ptName = ownClient ? ownClient.pt : '';
  }
  
  if(type !== 'CrossConnect') {
    let subInfo = '';
    if(type === 'Masuk Barang') subInfo = document.getElementById('tk_dev_name').value.trim();
    if(type === 'Keluar Barang') subInfo = document.getElementById('tk_out_name').value.trim();
    if(type === TERMINATION_TYPE) subInfo = ptName;
    title = `${type} - ${subInfo}`;
  }
  if(!title && type === 'CrossConnect'){ alert('Judul tiket wajib diisi'); return; }
  
  let ptId = ptSelect.value;
  if(isClient()){
    if(!ownClient){ alert('Profil Client tidak ditemukan. Hubungi Admin.'); return; }
    ptId = ownClient.id;
  }
  const editing = document.getElementById('modalTicket').dataset.editing;
  const existingTicket = editing ? tickets.find(t=>t.id===editing) : null;
  const staffName = currentUser ? currentUser.name : 'Staf';
  let approvedBy = existingTicket?.approvedBy || null;
  let completedBy = existingTicket?.completedBy || null;
  const newStatus = type===TERMINATION_TYPE ? (existingTicket?.status || 'Menunggu Approval') : (isClient() ? 'Menunggu Approval' : document.getElementById('tk_status').value);

  if (existingTicket && existingTicket.status !== newStatus) {
    if (newStatus === 'Disetujui' && !approvedBy) {
      approvedBy = staffName;
    }
    if (newStatus === 'Selesai' && !completedBy) {
      completedBy = staffName;
    }
  }

  if(type===TERMINATION_TYPE && !isClient() && !editing){
    alert('Permintaan Terminate hanya dapat diajukan oleh akun Client.');
    return;
  }
  const selectedClientData = clients.find(c=>c.id===ptId);
  const rackSelectVal = document.getElementById('tk_rack')?.value;
  const rackIdForSave = rackSelectVal || (selectedClientData ? selectedClientData.lokasi : '');
  const saveRack = racks.find(r => r.id === rackIdForSave || (rackIdForSave && rackIdForSave.includes(r.id)));
  const isRackHold = !!(saveRack && saveRack.status === 'Hold');
  if(selectedClientData) {
    if(selectedClientData.status === 'Suspend') {
      alert('Akun PT Anda berstatus SUSPEND. Anda hanya dapat melihat data (tidak dapat mengajukan/mengubah tiket).');
      return;
    }
    if(selectedClientData.status === 'Terminate' || selectedClientData.status === 'Terminated') {
      alert('Akun PT Anda telah ditutup (Terminated). Tidak dapat mengajukan/mengubah tiket.');
      return;
    }
  }
  if(isSubclient() && type !== 'Masuk Barang') {
    alert('Sub-Account hanya diperbolehkan mengajukan tiket Masuk Barang.');
    return;
  }
  if(isRackHold && type !== 'Masuk Barang') {
    alert(`Rack ${saveRack ? saveRack.id : ''} sedang berstatus HOLD. Hanya diperbolehkan mengajukan tiket Masuk Barang.`);
    return;
  }
  const terminateRequestedAt = type===TERMINATION_TYPE
    ? (existingTicket?.terminateRequestedAt || new Date().toISOString())
    : null;
  const terminateEligibleAt = type===TERMINATION_TYPE
    ? (existingTicket?.terminateEligibleAt || document.getElementById('tk_terminate_estimate').dataset.eligibleAt || createTerminationEligibleAt(terminateRequestedAt))
    : null;
  const data = {
    id: document.getElementById('modalTicket').dataset.editing || `TCK-${Date.now().toString().slice(-4)}`,
    type,
    title,
    priority: document.getElementById('tk_priority').value,
    status: newStatus,
    reqId: type==='CrossConnect' ? (document.getElementById('tk_req_id').value.trim() || `REQ-${Date.now().toString().slice(-6)}`) : '',
    kodeLabel: type==='CrossConnect' ? (document.getElementById('tk_kode_label')?document.getElementById('tk_kode_label').value.trim() : '') : '',
    ptTujuan: document.getElementById('tk_pt_tujuan') ? document.getElementById('tk_pt_tujuan').value.trim() : '',
    otbNum: document.getElementById('tk_otb_num') ? document.getElementById('tk_otb_num').value.trim() : '',
    portNum: document.getElementById('tk_port_num') ? document.getElementById('tk_port_num').value.trim() : '',
    date: document.getElementById('tk_date').value || new Date().toISOString().slice(0,10),
    createdBy: existingTicket?.createdBy || (currentUser ? currentUser.name : 'Sistem'),
    approvedBy: approvedBy,
    completedBy: completedBy,
    pt: ptName || '',
    clientId: ptId,
    rack: document.getElementById('tk_rack').value,
    desc: document.getElementById('tk_desc').value.trim(),
    autoCreate: type===TERMINATION_TYPE ? false : document.getElementById('tk_auto_create').checked,
    terminateRequestedAt,
    terminateEligibleAt,
    adminApprovedAt: type===TERMINATION_TYPE ? (existingTicket?.adminApprovedAt || null) : null,
    adminApprovedBy: type===TERMINATION_TYPE ? (existingTicket?.adminApprovedBy || null) : null,
    supportApprovedAt: type===TERMINATION_TYPE ? (existingTicket?.supportApprovedAt || null) : null,
    supportApprovedBy: type===TERMINATION_TYPE ? (existingTicket?.supportApprovedBy || null) : null,
    fullyApprovedAt: type===TERMINATION_TYPE ? (existingTicket?.fullyApprovedAt || null) : null,
    titikA: document.getElementById('tk_titikA').value.trim(),
    tipeRackRequest: document.getElementById('tk_tipe_rack') ? document.getElementById('tk_tipe_rack').value : '',
    openRackFloor: document.getElementById('tk_open_floor') ? document.getElementById('tk_open_floor').value : '',
    openRackU: document.getElementById('tk_open_u') ? document.getElementById('tk_open_u').value : '',
    tipeRackRequestB: document.getElementById('tk_tipe_titikB') ? document.getElementById('tk_tipe_titikB').value : '',
    openRackFloorB: document.getElementById('tk_open_floorB') ? document.getElementById('tk_open_floorB').value : '',
    openRackUB: document.getElementById('tk_open_uB') ? document.getElementById('tk_open_uB').value : '',
    titikB: document.getElementById('tk_titikB').value.trim(),
    cableLen: document.getElementById('tk_cable_len').value.trim(),
    connType: document.getElementById('tk_conn_type').value,
    devName: document.getElementById('tk_dev_name').value.trim(),
    devCat: document.getElementById('tk_dev_cat').value,
    devQty: parseInt(document.getElementById('tk_dev_qty').value)||1,
    devSn: document.getElementById('tk_dev_sn').value.trim(),
    devBerat: parseBeratInput('tk_dev_berat', 'tk_dev_berat_unit'),
    devTglMasuk: document.getElementById('tk_dev_tglMasuk').value,
    devPos: document.getElementById('tk_dev_pos').value.trim(),
    devExistingId: document.getElementById('tk_dev_existing').value,
    outName: document.getElementById('tk_out_name').value.trim(),
    outQty: parseInt(document.getElementById('tk_out_qty')?.value) || 1,
    outSn: document.getElementById('tk_out_sn').value.trim(),
    outTgl: document.getElementById('tk_out_tgl').value,
    outReason: document.getElementById('tk_out_reason').value.trim(),
    updatedTime: Date.now()
  };
  if(type==='Masuk Barang' && !data.devName){ alert('Nama perangkat wajib untuk tiket masuk barang'); return; }
  if(type==='Keluar Barang' && !data.outName){ alert('Nama perangkat keluar wajib diisi'); return; }
  if(editing){
    if(isClient()){
      alert('Maaf, akun Client tidak bisa edit tiket. Hanya Admin & Support yang bisa edit & approve.');
      return;
    }
    const idx = tickets.findIndex(t=>t.id===editing);
    if(idx>=0) tickets[idx]=data;

    // Status change notifications
    if(existingTicket && existingTicket.status !== data.status){
      const staffName = currentUser ? currentUser.name : 'Staf';
      if(data.status === 'Disetujui'){
        addNotification(data, `Tiket #${data.id} (${data.type}) telah disetujui oleh ${staffName}.`);
      }else if(data.status === 'Selesai'){
        addNotification(data, `Tiket #${data.id} (${data.type}) telah diselesaikan oleh ${staffName}.`);
      }else if(data.status === 'Dibatalkan'){
        addNotification(data, `Tiket #${data.id} (${data.type}) telah dibatalkan oleh ${staffName}.`);
      }else{
        addNotification(data, `Status tiket #${data.id} (${data.type}) diubah menjadi "${data.status}" oleh ${staffName}.`);
      }
    }
  }else{
    // Client boleh buat tiket baru
    tickets.push(data);
    if(data.type!==TERMINATION_TYPE){
      addNotification(data, `Tiket baru #${data.id} (${data.type}) dibuat oleh ${data.createdBy}: ${data.title}`);
    }
  }

  if(data.type===TERMINATION_TYPE && !editing){
    addTerminationNotification('submitted',data);
  }

  // Auto create untuk semua status jika autoCreate dicentang - sesuai request baru:
  // Masuk Barang: walau Diproses, data perangkat sudah masuk ke data perangkat, hanya status Diproses masih ada, ketika Selesai status Diproses hilang
  if(data.autoCreate || data.type==='CrossConnect'){
    if(data.type==='CrossConnect' && data.status==='Selesai'){
      const existingXC = crossConnects.find(xc=> xc.reqId===data.reqId || (xc.titikA===data.titikA && xc.titikB===data.titikB));
      if(!existingXC){
        const newXC = {
          id: `XC-${Date.now().toString().slice(-4)}`,
          reqId: data.reqId,
          pt: data.pt,
          clientId: data.clientId,
          titikA: data.titikA,
          titikB: data.titikB,
          cableLen: data.cableLen,
          connType: data.connType,
          status: 'Aktif',
          date: data.date,
          desc: data.desc,
          kodeLabel: data.kodeLabel || ''
        };
        crossConnects.push(newXC);
      }else{
        existingXC.status = 'Aktif';
        existingXC.cableLen = data.cableLen || existingXC.cableLen;
        existingXC.connType = data.connType || existingXC.connType;
        existingXC.pt = data.pt || existingXC.pt;
      }
    }
    if(data.type==='Masuk Barang' && data.clientId){
      // Cek apakah sudah ada device dari tiket ini
      let existingDev = devices.find(d=> d.ticketId===data.id);
      if(!existingDev){
        // Buat device baru walau status masih Diproses
        const newDev = {
          id: `DEV-${Date.now().toString().slice(-5)}`,
          clientId: data.clientId,
          nama: data.devName,
          kategori: data.devCat,
          sn: data.devSn,
          jumlah: data.devQty,
          rackPos: data.devPos || data.rack,
          kondisi: data.status==='Diproses' ? 'Menunggu' : 'Baru',
          tglMasuk: data.devTglMasuk || data.date,
          tglKeluar: null,
          type: 'masuk',
          alasan: '',
          ket: `Dari tiket ${data.id}: ${data.title}`,
          exited: false,
          ticketId: data.id,
          ticketStatus: data.status
        };
        devices.push(newDev);
      }else{
        // Update device existing dengan status tiket terbaru
        existingDev.nama = data.devName || existingDev.nama;
        existingDev.kategori = data.devCat || existingDev.kategori;
        existingDev.sn = data.devSn || existingDev.sn;
        existingDev.jumlah = data.devQty || existingDev.jumlah;
        existingDev.rackPos = data.devPos || data.rack || existingDev.rackPos;
        existingDev.tglMasuk = data.devTglMasuk || existingDev.tglMasuk;
        existingDev.ticketStatus = data.status;
        existingDev.ket = `Dari tiket ${data.id}: ${data.title}`;
        if(data.status==='Selesai'){
          existingDev.kondisi = 'Baru';
          // Hapus status diproses
          existingDev.ticketStatus = null;
        }else{
          existingDev.kondisi = 'Menunggu';
        }
      }
    }else if(data.type==='Keluar Barang' && data.clientId && data.status==='Selesai'){
      processDeviceExitForTicket(data);
    }
  }

  saveData();
  closeModal('modalTicket');
  renderTickets();
  renderClients();
  renderRacks();
  alert('Tiket berhasil disimpan.');
}

function cancelTicket(id){
  if(!isSupport()){
    alert('Hanya Support yang bisa membatalkan tiket dari daftar ini.');
    return;
  }
  const ticket = tickets.find(t=>t.id===id);
  if(!ticket || ['Selesai','Dibatalkan'].includes(ticket.status)) return;
  showCustomConfirm(`Cancel tiket ${id}? Tiket tidak dapat diselesaikan setelah dibatalkan.`, () => {
    ticket.status = 'Dibatalkan';
    ticket.cancelledAt = new Date().toISOString();
    ticket.cancelledBy = currentUser?.name || currentUser?.email || 'Support';
    addNotification(ticket, `Tiket #${ticket.id} (${ticket.type}) telah dibatalkan oleh ${ticket.cancelledBy}.`);
    // Remove any pending inventory placeholder created from a cancelled incoming request.
    devices = devices.filter(device=>!(device.ticketId===id && device.ticketStatus));
    saveData();
    renderTickets();
    renderClients();
    renderRacks();
    renderDevices();
    alert(`Tiket ${id} berhasil dibatalkan.`);
  });
}

function deleteTicket(id){
  if(!isAdmin()){
    alert('Hanya Admin yang bisa menghapus tiket. Support menggunakan aksi Cancel.');
    return;
  }
  if(!tickets.some(t=>t.id===id)) return;
  showCustomConfirm(`Hapus tiket ${id}?`, () => {
    tickets = tickets.filter(t=>t.id!==id);
    saveData();
    renderTickets();
    alert(`Tiket ${id} berhasil dihapus.`);
  });
}

function quickCompleteTicket(id){
  if(isClient()){
    alert('Maaf, hanya Admin & Support yang bisa approve/selesaikan tiket.');
    return;
  }
  const t = tickets.find(x=>x.id===id);
  if(!t) return;
  if(t.status==='Dibatalkan' || t.status==='Selesai'){
    return;
  }
  if(t.type===TERMINATION_TYPE){
    approveTerminationTicket(t);
    return;
  }

  // 2-step process
  if(t.status === 'Diproses' || t.status === 'Menunggu Approval') {
    showCustomConfirm(`Approve tiket ${id}? Status tiket akan berubah menjadi "Disetujui".`, () => {
      t.status = 'Disetujui';
      t.updatedTime = Date.now();
      t.approvedBy = currentUser ? currentUser.name : 'Admin';
      addNotification(t, `Tiket #${t.id} (${t.type}) telah disetujui oleh ${t.approvedBy}.`);
      saveData();
      renderTickets();
      if(typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
      showToast(`Tiket ${id} berhasil disetujui.`, 'success');
    });
    return;
  }

  if(t.status === 'Disetujui') {
    showCustomConfirm(`Tandai tiket ${id} sebagai Selesai? ${t.autoCreate?'Akan mengupdate inventory secara otomatis.':''}`, () => {
      t.status = 'Selesai';
      t.updatedTime = Date.now();
      t.completedBy = currentUser ? currentUser.name : 'Admin';
      addNotification(t, `Tiket #${t.id} (${t.type}) telah diselesaikan oleh ${t.completedBy}.`);
      
      if(t.type==='CrossConnect'){
        const existingXC = crossConnects.find(xc=> xc.reqId===t.reqId || (xc.titikA===t.titikA && xc.titikB===t.titikB));
        if(!existingXC){
          const newXC = {
            id: `XC-${Date.now().toString().slice(-4)}`,
            reqId: t.reqId,
            pt: t.pt,
            clientId: t.clientId,
            titikA: t.titikA,
            titikB: t.titikB,
            cableLen: t.cableLen,
            connType: t.connType,
            status: 'Aktif',
            date: t.date,
            desc: t.desc,
            kodeLabel: t.kodeLabel || ''
          };
          crossConnects.push(newXC);
        }else{
          existingXC.status = 'Aktif';
        }
      } else if(t.type==='Masuk Barang' && t.clientId){
        let existingDev = devices.find(d=> d.ticketId===t.id);
        if(existingDev){
          existingDev.ticketStatus = null;
          if(existingDev.kondisi === 'Menunggu') existingDev.kondisi = 'Baik';
          existingDev.ket = `Dari tiket ${t.id}: ${t.title} [Selesai]`;
        } else {
          const newDev = {
            id: `DEV-${Date.now().toString().slice(-5)}`,
            clientId: t.clientId,
            nama: t.devName,
            kategori: t.devCat||'Server',
            sn: t.devSn||'',
            jumlah: parseInt(t.devQty)||1,
            rackPos: t.devPos || t.rack || '',
            berat: parseFloat(t.devBerat) || 0,
            kondisi: 'Baik',
            tglMasuk: t.devTglMasuk || t.date || new Date().toISOString().slice(0,10),
            tglKeluar: null,
            ket: `Dari tiket ${t.id}: ${t.title}`,
            type: 'masuk',
            alasan: '',
            exited: false,
            ticketId: t.id,
            ticketStatus: null
          };
          devices.push(newDev);
        }
      } else if(t.type==='Keluar Barang' && t.clientId){
        processDeviceExitForTicket(t);
      }

      saveData();
      renderTickets();
      if(typeof renderClients === 'function') renderClients();
      if(typeof renderRacks === 'function') renderRacks();
      if(typeof renderCrossConnects === 'function') renderCrossConnects();
      if(typeof renderDevices === 'function') renderDevices();
      if(typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
      alert(`Tiket ${id} berhasil diselesaikan.`);
    });
    return;
  }
}

function exportTicketsPdf(){
  if(!staffExportAllowed()) return;
  const query=(document.getElementById('ticketSearch')?.value||'').trim().toLowerCase();
  const filtered=tickets.filter(ticket=>{
    const matchQuery=!query || ticket.id.toLowerCase().includes(query) || ticket.title.toLowerCase().includes(query) || (ticket.pt||'').toLowerCase().includes(query) || (ticket.rack||'').toLowerCase().includes(query) || (ticket.desc||'').toLowerCase().includes(query);
    const matchType=currentTicketTypeFilter==='all' || ticket.type===currentTicketTypeFilter;
    const matchStatus=currentTicketStatusFilter==='all' || ticket.status===currentTicketStatusFilter;
    return matchQuery && matchType && matchStatus;
  });
  const now=new Date();
  const typeLabel=currentTicketTypeFilter==='all' ? 'Semua jenis permintaan' : currentTicketTypeFilter;
  const statusLabel=currentTicketStatusFilter==='all' ? 'Semua status' : currentTicketStatusFilter;
  const report=createStaffPdfReport('LAPORAN PERMINTAAN CLIENT',`Dokumen ringkas untuk dibaca cepat | Diekspor ${now.toLocaleString('id-ID')}`);
  report.addSection('RINGKASAN LAPORAN');
  report.addText(`Jenis permintaan yang ditampilkan : ${typeLabel}`,10,[0.05,0.18,0.34]);
  report.addText(`Status yang ditampilkan           : ${statusLabel}`,10,[0.05,0.18,0.34]);
  report.addText(`Jumlah permintaan                 : ${filtered.length}${query ? ' | Kata kunci: '+query : ''}`,10,[0.05,0.18,0.34]);
  report.addText('Cara membaca: setiap baris adalah satu permintaan client. Status menjelaskan apakah permintaan masih diproses, sudah selesai, disetujui, atau dibatalkan.',8.5,[0.24,0.30,0.38]);
  report.addSection('DAFTAR PERMINTAAN');
  report.addTable([
    {key:'id',label:'NOMOR TICKET',width:85,size:8.2},{key:'type',label:'JENIS PERMINTAAN',width:115,size:8.2},
    {key:'clientRack',label:'PERUSAHAAN / RACK',width:150,size:8.2},{key:'summary',label:'RINGKASAN PERMINTAAN',width:220,size:8.2},
    {key:'statusPriority',label:'STATUS / PRIORITAS',width:120,size:8.2},{key:'date',label:'TGL DIAJUKAN',width:76,size:8.2}
  ],(filtered.length?filtered:[{id:'-',type:'-',clientRack:'-',summary:'Tidak ada permintaan yang sesuai dengan filter.',statusPriority:'-',date:'-'}]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(ticket=>{
    const terminationSummary=ticket.type===TERMINATION_TYPE
      ? `Terminate layanan. ${isTerminationFullyApproved(ticket) ? 'Disetujui lengkap; akses ditutup '+formatTerminationDate(ticket.terminateEligibleAt) : getTerminationApprovalLabel(ticket)}`
      : (ticket.title||'-');
    return {
      id:`${ticket.id}${ticket.reqId?' / '+ticket.reqId:''}`,
      type:ticket.type||'-',
      clientRack:`${ticket.pt||'-'} / ${ticket.rack||'-'}`,
      summary:terminationSummary,
      statusPriority:`${ticket.status||'-'} / ${(ticket.priority||'-').replace('Prioritas ','')}`,
      date:ticket.date||'-'
    };
  }));
  const suffix=(currentTicketTypeFilter==='all'?'semua':currentTicketTypeFilter.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
  report.finish(`interlink-laporan-permintaan-${suffix}-${now.toISOString().slice(0,10)}.pdf`);
}

function exportData(){
  if(!staffExportAllowed()) return;
  const now=new Date();
  const report=createStaffPdfReport('LAPORAN INVENTORY','Perangkat dan status inventory - diekspor '+now.toLocaleString('id-ID'));
  report.addText(`Total klien: ${clients.length}   |   Total entri perangkat: ${devices.length}`,9.5,[0.05,0.18,0.34]);
  clients.slice().sort((a,b)=>a.pt.localeCompare(b.pt)).forEach(client=>{
    report.addSection(`${client.pt}  |  ${client.id}`);
    const powerOrU = client.layanan === 'Colocation - Per U' ? `U Range: ${client.u||'-'}` : `Daya: ${client.power||'-'}`;
    report.addText(`Layanan: ${client.layanan||'-'}   |   Lokasi: ${client.lokasi||'-'}   |   Status: ${client.status||'-'}   |   ${powerOrU}`, 8.2, [0.18, 0.24, 0.32]);
    const related=devices.filter(device=>device.clientId===client.id);
    report.addTable([
      {key:'type',label:'TIPE',width:50},{key:'nama',label:'PERANGKAT',width:200},{key:'kategori',label:'KATEGORI',width:85},
      {key:'sn',label:'SN / ASSET',width:115},{key:'jumlah',label:'JML',width:34},{key:'rackPos',label:'RACK POS',width:104},
      {key:'tglMasuk',label:'MASUK',width:60},{key:'tglKeluar',label:'KELUAR',width:60},{key:'kondisi',label:'KONDISI',width:58}
    ],(related.length?related:[{type:'-',nama:'Belum ada perangkat tercatat',kategori:'-',sn:'-',jumlah:'-',rackPos:'-',tglMasuk:'-',tglKeluar:'-',kondisi:'-'}]).map(device=>({
      type:device.type==='masuk'?'Masuk':device.type==='keluar'?'Keluar':device.type||'-',nama:device.nama||'-',kategori:device.kategori||'-',
      sn:device.sn||'-',jumlah:String(device.jumlah||'-'),rackPos:device.rackPos||'-',tglMasuk:device.tglMasuk||'-',tglKeluar:device.tglKeluar||'-',kondisi:device.kondisi||'-'
    })));
  });
  report.finish(`interlink-inventory-${now.toISOString().slice(0,10)}.pdf`);
}

function markTicketsAsSeen() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const userKey = 'il_last_seen_ticket_time_' + (currentUser.email || 'user');
  const now = Date.now();
  try {
    localStorage.setItem(userKey, String(now));
  } catch (e) {}
  const badge = document.getElementById('ticketNavBadge');
  if (badge) {
    badge.textContent = '0';
    badge.style.setProperty('display', 'none', 'important');
  }
}

function getTicketTimestamp(t) {
  if (!t) return 0;
  if (t.updatedTime && !isNaN(t.updatedTime)) return Number(t.updatedTime);
  if (t.createdAt) {
    const time = new Date(t.createdAt).getTime();
    if (!isNaN(time) && time > 0) return time;
  }
  if (t.date) {
    const time = new Date(t.date).getTime();
    if (!isNaN(time) && time > 0) return time;
  }
  return 0;
}

function updateTicketNavBadge() {
  const badge = document.getElementById('ticketNavBadge');
  if (!badge) return;
  if (typeof currentUser === 'undefined' || !currentUser) {
    badge.style.setProperty('display', 'none', 'important');
    return;
  }

  // If user is currently on the tickets page, hide subnav badge
  const isCurrentlyOnTicketsPage = window.location.hash === '#tickets' || document.getElementById('page-tickets')?.classList.contains('active');
  if (isCurrentlyOnTicketsPage) {
    badge.style.setProperty('display', 'none', 'important');
    return;
  }

  let eligibleTickets = typeof tickets !== 'undefined' ? tickets : [];
  if (typeof isClient === 'function' && isClient()) {
    eligibleTickets = eligibleTickets.filter(t => 
      t.clientId === currentUser.clientId || 
      (currentUser.pt && (t.pt||'').toLowerCase().trim() === (currentUser.pt||'').toLowerCase().trim()) || 
      (t.createdBy||'').toLowerCase().trim() === (currentUser.name||'').toLowerCase().trim()
    );
  }

  let pendingCount = 0;

  if (typeof isAdmin === 'function' && (isAdmin() || isSupport())) {
    // Admin / Support: count all tickets waiting for approval/action
    pendingCount = eligibleTickets.filter(t => t.status === 'Menunggu Approval' || t.status === 'Baru').length;
  } else {
    // Client: count active tickets requiring attention / in progress / approved
    pendingCount = eligibleTickets.filter(t => t.status === 'Menunggu Approval' || t.status === 'Diproses' || t.status === 'Disetujui').length;
  }

  if (pendingCount > 0) {
    badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
    badge.style.setProperty('display', 'inline-block', 'important');
  } else {
    badge.style.setProperty('display', 'none', 'important');
  }
}

function updateRoleBasedUI() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const hideForClient = isClient();

  // 1. Racks tab: + Tambah Lantai and + Tambah rack (Admin & Support only, hide for Client)
  const addFloorBtn = document.getElementById('btnAddFloor');
  if (addFloorBtn) addFloorBtn.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');
  const addRackBtn = document.getElementById('btnAddRack');
  if (addRackBtn) addRackBtn.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');

  // 2. Rack Detail: Edit Rack, Kelola PT, Hapus, Export Excel
  const btnEditRack = document.getElementById('btnEditRackDetail');
  if (btnEditRack) btnEditRack.style.setProperty('display', hideForClient ? 'none' : (isAdmin() ? 'inline-flex' : 'none'), 'important');
  const btnKelolaPT = document.getElementById('btnKelolaPTDetail');
  if (btnKelolaPT) btnKelolaPT.style.setProperty('display', hideForClient ? 'none' : ((isAdmin() || isSupport()) ? 'inline-flex' : 'none'), 'important');
  const btnDeleteRack = document.getElementById('btnDeleteRackDetail');
  if (btnDeleteRack) btnDeleteRack.style.setProperty('display', hideForClient ? 'none' : (isAdmin() ? 'inline-flex' : 'none'), 'important');
  const btnExportRackExcel = document.getElementById('btnExportRackExcel');
  if (btnExportRackExcel) btnExportRackExcel.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');

  // 3. Inventory tab: + Tambah Klien Baru and Export PDF
  const btnAddClient = document.getElementById('btnAddClient');
  if (btnAddClient) btnAddClient.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) btnExportData.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');

  // 4. Client Detail / Devices Toolbar: + Tambah Perangkat Masuk and + Catat Keluar
  const btnAddDevice = document.getElementById('btnAddDevice');
  if (btnAddDevice) btnAddDevice.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');
  const btnAddKeluar = document.getElementById('btnAddKeluar');
  if (btnAddKeluar) btnAddKeluar.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');

  // 5. Tickets tab: Export PDF
  const btnExportTickets = document.getElementById('btnExportTicketsPdf');
  if (btnExportTickets) btnExportTickets.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');

  // 6. CrossConnect tab: Export PDF and Edit Koneksi
  const btnExportXC = document.getElementById('btnExportCrossConnectPdf');
  if (btnExportXC) btnExportXC.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');
  const btnEditXC = document.getElementById('btnEditCrossConnectDetail');
  if (btnEditXC) btnEditXC.style.setProperty('display', hideForClient ? 'none' : 'inline-flex', 'important');
  // 7. Hide AKSI column headers for Client in Inventory and CrossConnect tables
  const thClientAksi = document.getElementById('thClientAksi');
  if (thClientAksi) thClientAksi.style.setProperty('display', hideForClient ? 'none' : 'table-cell', 'important');
  const thXcAksi = document.getElementById('thXcAksi');
  if (thXcAksi) thXcAksi.style.setProperty('display', hideForClient ? 'none' : 'table-cell', 'important');

  // 8. Client action restrictions based on client status (Suspend / Terminated)
  if (isClient() || isSubclient()) {
    const ownClient = clients.find(c => c.id === currentUser.clientId);
    const btnSubmitTicket = document.getElementById('btnSubmitTicket');
    if (ownClient) {
      const clSt = ownClient.status;
      const isSuspOrTerm = clSt === 'Suspend' || clSt === 'Terminate' || clSt === 'Terminated';
      if (btnSubmitTicket) btnSubmitTicket.style.setProperty('display', isSuspOrTerm ? 'none' : 'inline-flex', 'important');
      // Also enforce action buttons in device toolbar based on status
      const devBtnAdd = document.getElementById('btnAddDevice');
      const devBtnKeluar = document.getElementById('btnAddKeluar');
      const isHoldSt = clSt === 'Hold';
      if(devBtnAdd) devBtnAdd.style.setProperty('display', isSuspOrTerm ? 'none' : 'inline-flex', 'important');
      if(devBtnKeluar) devBtnKeluar.style.setProperty('display', (isSuspOrTerm || isHoldSt) ? 'none' : 'inline-flex', 'important');
    }
  }
}

function refreshAllActiveViews() {
  updateRoleBasedUI();
  if (typeof renderClients === 'function') renderClients();
  if (typeof renderRacks === 'function') renderRacks();
  if (typeof renderTickets === 'function') renderTickets();
  if (typeof renderCrossConnects === 'function') renderCrossConnects();
  if (typeof renderAccountManagement === 'function') renderAccountManagement();
  if (typeof selectedClientId !== 'undefined' && selectedClientId && typeof openClientDetail === 'function' && document.getElementById('inventory-detail-view')?.style.display !== 'none') {
    openClientDetail(selectedClientId);
    if (typeof switchDeviceTab === 'function') switchDeviceTab(currentDeviceTab);
  }
  if (typeof selectedRackId !== 'undefined' && selectedRackId && typeof openRackDetail === 'function' && document.getElementById('rack-detail-view')?.style.display !== 'none') {
    openRackDetail(selectedRackId);
  }
  if (typeof selectedCrossConnectId !== 'undefined' && selectedCrossConnectId && typeof openCrossConnectDetail === 'function' && document.getElementById('crossconnect-detail-view')?.style.display !== 'none') {
    openCrossConnectDetail(selectedCrossConnectId);
  }
  if (typeof updateOverviewStats === 'function') updateOverviewStats();
  if (typeof updateNotificationUI === 'function') updateNotificationUI();
  if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
}