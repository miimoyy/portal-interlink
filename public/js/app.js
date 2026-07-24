// Lines animation for login page background
function makeLines(container){
  if (!container) return;
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

// Clock updates
function updateClock(){
  const clockTime = document.getElementById('clock-time');
  const clockDate = document.getElementById('clock-date');
  if (!clockTime || !clockDate) return;
  
  const now = new Date();
  const opts = {timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false};
  const timeStr = new Intl.DateTimeFormat('en-GB', opts).format(now);
  const dateOpts = {timeZone:'Asia/Jakarta', weekday:'long', day:'numeric', month:'long', year:'numeric'};
  let dateStr = new Intl.DateTimeFormat('id-ID', dateOpts).format(now);
  clockTime.textContent = timeStr;
  clockDate.textContent = dateStr;
}

// Navigation routing helper
function navigateToPage(pageId) {
  if (!currentUser) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('dashboard-screen').style.display = 'none';
    if (window.location.hash !== '#login') {
      window.location.hash = 'login';
    }
    return;
  }

  if (!pageId || pageId === 'login') pageId = 'overview';
  
  // Check permission for account-management
  if (pageId === 'account-management' && !isAdmin()) {
    navigateToPage('overview');
    showAccountToast('Anda tidak memiliki akses ke halaman ini.', true);
    return;
  }
  
  // Set window hash if not matching
  if (window.location.hash !== '#' + pageId) {
    window.location.hash = pageId;
  }
  
  // Update subnav active class
  document.querySelectorAll('.subnav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });
  
  // Show target page, hide others
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  
  const target = document.getElementById('page-' + pageId);
  if (target) {
    target.classList.add('active');
    target.style.display = 'block';
    if (pageId === 'subaccount') renderSubAccounts();
    if (pageId === 'tickets' && typeof markTicketsAsSeen === 'function') markTicketsAsSeen();
  }

  if (typeof updateRoleBasedUI === 'function') updateRoleBasedUI();
  // Update ticket tab badge after every navigation (check happens only when NOT on tickets page)
  if (typeof updateTicketNavBadge === 'function') setTimeout(() => updateTicketNavBadge(), 50);
  window.scrollTo(0,0);
}

let _sseSource = null;
let _sseRefreshTimer = null;
let _sseNotifTimer = null;

function startSSE() {
  if (_sseSource) { _sseSource.close(); _sseSource = null; }
  const es = new EventSource('/api/events');
  _sseSource = es;

  function scheduleRefresh() {
    // Debounce 300ms for ticket refresh
    clearTimeout(_sseRefreshTimer);
    _sseRefreshTimer = setTimeout(async () => {
      if (!currentUser) return;
      try {
        await loadData();
        refreshAllActiveViews();
        updateNotificationUI();
        if (typeof updateTicketNavBadge === 'function') updateTicketNavBadge();
      } catch (e) { /* network hiccup */ }
    }, 300);
  }

  function scheduleNotifRefresh() {
    clearTimeout(_sseNotifTimer);
    _sseNotifTimer = setTimeout(async () => {
      if (!currentUser) return;
      try {
        const token = localStorage.getItem('il_auth_token') || '';
        const nRes = await fetch('/api/termination-notifications', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (nRes.ok) {
          terminationNotifications = await nRes.json();
          updateNotificationUI();
          try { updateTopbarBadges(); } catch (e) {}
        }
      } catch (e) { /* network hiccup */ }
    }, 1000);
  }

  es.addEventListener('ticket_created', scheduleRefresh);
  es.addEventListener('ticket_updated', scheduleRefresh);
  es.addEventListener('ticket_deleted', scheduleRefresh);
  es.addEventListener('device_created', scheduleRefresh);
  es.addEventListener('device_updated', scheduleRefresh);
  es.addEventListener('device_deleted', scheduleRefresh);
  es.addEventListener('client_updated', scheduleRefresh);
  es.addEventListener('rack_updated', scheduleRefresh);
  es.addEventListener('data_updated', scheduleRefresh);
  es.addEventListener('notification_updated', scheduleNotifRefresh);
  es.onerror = () => { /* EventSource auto-reconnects */ };
}

function stopSSE() {
  clearTimeout(_sseRefreshTimer);
  clearTimeout(_sseNotifTimer);
  if (_sseSource) { _sseSource.close(); _sseSource = null; }
}

// Initialize UI layout on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  // Setup Background Line Art
  const loginLines = document.getElementById('login-lines');
  const heroLines = document.getElementById('hero-lines');
  if (loginLines) makeLines(loginLines);
  if (heroLines) makeLines(heroLines);

  // Setup Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Modal overlays click closure handler
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { 
      if (e.target === ov) ov.classList.remove('show'); 
    });
  });

  // Setup subnavigation clicks
  document.querySelectorAll('.subnav-item').forEach(function(item){
    item.addEventListener('click', function(){
      navigateToPage(item.dataset.page);
    });
  });

  // Handle URL hash changes
  window.addEventListener('hashchange', () => {
    const pageId = window.location.hash.substring(1) || 'overview';
    navigateToPage(pageId);
  });

  // Check existing session
  const storedUser = localStorage.getItem('il_current_user');
  if (storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
      
      // Determine active page and navigate immediately BEFORE displaying the container
      const initialHash = window.location.hash.substring(1) || 'overview';
      navigateToPage(initialHash);
      
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('dashboard-screen').style.display = 'block';
      
      // Async data bootstrap load
      await loadData();
      
      // Apply and render initial views
      applyRoleToUI();
      renderClients();
      renderRacks();
      renderTickets();
      renderCrossConnects();
      updateProfilePage();
      updateOverviewStats();
      updateTopbarBadges();
      
      // Re-route/refresh routing after render
      navigateToPage(initialHash);

      // Start real-time event stream
      startSSE();
      
    } catch (e) {
      console.error("Session restore error:", e);
      logoutUser();
    }
  } else {
    navigateToPage('login');
  }
});