async function syncCollection(name, localArray, key = 'id') {
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    const res = await fetch(`/api/${name}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const serverArray = await res.json();
    const serverMap = new Map(serverArray.map(item => [item[key], item]));
    const localMap = new Map(localArray.map(item => [item[key], item]));

    // 1. Post new items
    for (const [id, localItem] of localMap.entries()) {
      if (!serverMap.has(id)) {
        await fetch(`/api/${name}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(localItem)
        });
      } else {
        // 2. Put updated items (compare values)
        const serverItem = serverMap.get(id);
        if (JSON.stringify(localItem) !== JSON.stringify(serverItem)) {
          await fetch(`/api/${name}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(localItem)
          });
        }
      }
    }

    // 3. Delete removed items
    for (const id of serverMap.keys()) {
      if (!localMap.has(id)) {
        await fetch(`/api/${name}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    }
  } catch (e) {
    console.error(`Error syncing collection ${name}:`, e);
  }
}

async function syncAllToBackend() {
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        clients,
        devices,
        racks,
        tickets,
        crossConnects,
        users: USERS,
        floors,
        notifications: typeof terminationNotifications !== 'undefined' ? terminationNotifications : []
      })
    });
    if (!res.ok) {
      await syncCollection('clients', clients, 'id');
      await syncCollection('devices', devices, 'id');
      await syncCollection('racks', racks, 'id');
      await syncCollection('tickets', tickets, 'id');
      await syncCollection('cross-connects', crossConnects, 'id');
      await syncCollection('users', USERS, 'email');
      await syncCollection('floors', floors, 'name');
    }
  } catch (e) {
    console.error('Error in syncAllToBackend:', e);
  }
}

async function addRackLog(rackId, logData) {
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    await fetch('/api/rack-logs', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ rackId, ...logData })
    });
  } catch (e) {
    console.error('Error saving rack log:', e);
  }
}

async function addClientLog(clientId, logData) {
  const token = localStorage.getItem('il_auth_token') || '';
  try {
    await fetch('/api/client-logs', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ clientId, ...logData })
    });
  } catch (e) {
    console.error('Error saving client log:', e);
  }
}

async function loadData(){
  const token = localStorage.getItem('il_auth_token') || '';
  try{
    const res = await fetch('/api/bootstrap', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    clients = data.clients || [];
    devices = data.devices || [];
    racks = data.racks || [];
    tickets = data.tickets || [];
    crossConnects = data.crossConnects || [];
    floors = data.floors || [];
    USERS = data.users || [];
    terminationNotifications = data.notifications || [];

    racks.forEach(rack=>{
      const floor=getRackFloor(rack);
      if(floor && !floors.some(item=>item.name===floor)) floors.push({name:floor,area:'',maxRacks:null});
      if(!rack.lantai && floor) rack.lantai=floor;
    });
    globalFloorFilter=localStorage.getItem('il_global_floor_filter')||'all';

    racks.forEach(rack => {
      if(!rack.status || rack.status === 'Normal') rack.status = 'Aktif';
      if(rack.status === 'Perhatian') rack.status = 'Proses';
      if(rack.status === 'Kritis') rack.status = 'Hold';
      if(rack.status === 'Maintenance') rack.status = 'Terminate';
      
      if(typeof rack.status === 'undefined' || rack.status === 'undefined') rack.status = 'Aktif';
      if(!rack.lokasi || rack.lokasi === 'undefined') rack.lokasi = 'Lantai 2 · Zona G';
    });

    clients.forEach(cl=>{
      if(cl.power && cl.power.toLowerCase().includes('kw')){
        cl.power = cl.power.toLowerCase().replace('kw','').trim() + ' A';
        if(cl.power.trim() === 'A') cl.power = '5 A';
      }
      if(cl.power && !cl.power.includes('A') && !isNaN(parseFloat(cl.power))){
        cl.power = parseFloat(cl.power) + ' A';
      }
    });
    racks.forEach(rk=>{
      if(rk.tipeRack === 'Open Rack') {
        rk.power = '-';
      }
      if(rk.power && rk.power.toLowerCase().includes('kw')){
        rk.power = rk.power.toLowerCase().replace('kw','').trim() + ' A';
        if(rk.power.trim() === 'A') rk.power = '10 A';
      }
      if(rk.power && !rk.power.includes('A') && !isNaN(parseFloat(rk.power))){
        rk.power = parseFloat(rk.power) + ' A';
      }
    });
  }catch(e){
    clients = defaultClients; devices = defaultDevices; racks = defaultRacks; tickets = defaultTickets; crossConnects = defaultCrossConnects; floors = defaultFloors; globalFloorFilter='all';
    console.error('Error loading data:', e);
  }
}

let _saveDataTimer = null;

function saveData(){
  devices.forEach(d => {
    if (d.ticketId) {
      const t = tickets.find(tk => tk.id === d.ticketId);
      if (t) {
        if (t.status === 'Selesai' || t.status === 'Dibatalkan') {
          d.ticketStatus = null;
          if (d.kondisi === 'Menunggu') d.kondisi = 'Baik';
        } else {
          d.ticketStatus = t.status;
        }
      }
    }
  });

  try { refreshAllActiveViews(); updateTopbarBadges(); } catch(e) {}

  clearTimeout(_saveDataTimer);
  _saveDataTimer = setTimeout(() => {
    syncAllToBackend();
  }, 200);
}