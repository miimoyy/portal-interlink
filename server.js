const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// TODO: Batasi origin CORS ke domain spesifik sebelum deploy ke lingkungan publik/produksi
app.use(cors());

app.use(express.json({ limit: '1mb' }));

function sanitizeInputString(val, maxLength = 500) {
  if (val === null || val === undefined) return null;
  return String(val).trim().substring(0, maxLength);
}


// Serve public directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route redirects to dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'interlink-dashboard.html'));
});

// In-memory Session Store (token -> user)
const sessions = new Map();

// SSE: set of active response objects
const sseClients = new Set();

function sseEmit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (e) { sseClients.delete(client); }
  }
}

// SSE endpoint – no auth required so browser EventSource can connect easily
// We rely on the fact that all data pushed is non-sensitive (IDs + event type only)
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // Send a heartbeat so the browser doesn't time out the connection
  res.write(': heartbeat\n\n');
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); }
  }, 20000);
  sseClients.add(res);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
});

// Helper: map sqlite row to JSON (converts booleans and parsed JSON fields)
function mapClient(row) {
  if (!row) return null;
  return {
    ...row,
    allowSubAccount: !!row.allowSubAccount
  };
}

function mapDevice(row) {
  if (!row) return null;
  return {
    ...row,
    exited: !!row.exited
  };
}

function mapRack(row) {
  if (!row) return null;
  return {
    ...row
  };
}

function mapTicket(row) {
  if (!row) return null;
  return {
    ...row,
    autoCreate: !!row.autoCreate,
    updatedTime: row.updatedTime ? Number(row.updatedTime) : (row.date ? new Date(row.date).getTime() : Date.now())
  };
}

function mapCrossConnect(row) {
  if (!row) return null;
  return {
    ...row
  };
}

function mapUser(row, reqUserEmail = null) {
  if (!row) return null;
  const copy = { ...row };
  delete copy.password;
  copy.allowSubAccount = !!row.allowSubAccount;
  return copy;
}

function mapNotification(row) {
  if (!row) return null;
  let roles = [];
  let readBy = [];
  try { roles = row.roles ? JSON.parse(row.roles) : []; } catch (e) {}
  try { readBy = row.readBy ? JSON.parse(row.readBy) : []; } catch (e) {}
  return {
    ...row,
    roles,
    readBy
  };
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam TTL

function cleanupExpiredSessions() {
  try {
    db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(Date.now());
  } catch (e) {}
}
cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak ditemukan.' });
  }
  
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) {
    return res.status(403).json({ error: 'Sesi kedaluwarsa atau tidak valid.' });
  }

  if (Date.now() >= session.expiresAt) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(403).json({ error: 'Sesi telah kedaluwarsa. Silakan login kembali.' });
  }
  
  req.user = session;
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Silakan coba lagi setelah 15 menit.' }
});

// -------------------------------------------------------------
// AUTHENTICATION
// -------------------------------------------------------------
app.post('/api/auth/login', authLimiter, async (req, res) => {

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password harus diisi.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  if (user && (await bcrypt.compare(password, user.password))) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    
    db.prepare(`
      INSERT OR REPLACE INTO sessions (token, email, role, clientId, pt, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(token, user.email, user.role, user.clientId || '', user.pt || '', expiresAt);

    const loggedInUser = mapUser(user);
    delete loggedInUser.password;
    return res.json({
      user: loggedInUser,
      token
    });
  }
  return res.status(401).json({ error: 'Email atau password salah.' });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ success: true });
});


// -------------------------------------------------------------
// BOOTSTRAP ENDPOINT (Bulk load with multi-tenant filtering)
// -------------------------------------------------------------
app.get('/api/bootstrap', authenticate, (req, res) => {
  const { role, clientId, email } = req.user;

  if (role === 'admin' || role === 'support') {
    const clients = db.prepare('SELECT * FROM clients').all().map(mapClient);
    const devices = db.prepare('SELECT * FROM devices').all().map(mapDevice);
    const racks = db.prepare('SELECT * FROM racks').all().map(mapRack);
    const tickets = db.prepare('SELECT * FROM tickets').all().map(mapTicket);
    const crossConnects = db.prepare('SELECT * FROM cross_connects').all().map(mapCrossConnect);
    const floors = db.prepare('SELECT * FROM floors').all();
    const users = db.prepare('SELECT * FROM users').all().map(row => mapUser(row, email));
    const notifications = db.prepare('SELECT * FROM termination_notifications ORDER BY createdAt DESC').all().map(mapNotification);

    return res.json({
      clients,
      devices,
      racks,
      tickets,
      crossConnects,
      floors,
      users,
      notifications
    });
  } else {
    const targetClientId = clientId || '';
    
    const clients = db.prepare('SELECT * FROM clients WHERE id = ?').all(targetClientId).map(mapClient);
    const devices = db.prepare('SELECT * FROM devices WHERE clientId = ?').all(targetClientId).map(mapDevice);
    const racks = db.prepare('SELECT * FROM racks').all().map(mapRack);
    const tickets = db.prepare('SELECT * FROM tickets WHERE clientId = ?').all(targetClientId).map(mapTicket);
    const crossConnects = db.prepare('SELECT * FROM cross_connects WHERE clientId = ?').all(targetClientId).map(mapCrossConnect);
    const floors = db.prepare('SELECT * FROM floors').all();
    
    // Only return user themselves and their sub-accounts
    const users = db.prepare('SELECT * FROM users WHERE clientId = ? OR email = ? OR parentEmail = ?').all(targetClientId, email, email).map(row => mapUser(row, email));
    
    // Only return notifications for their clientId or matching target role
    const notifications = db.prepare('SELECT * FROM termination_notifications WHERE clientId = ? OR roles LIKE ? ORDER BY createdAt DESC').all(targetClientId, '%"client"%').map(mapNotification);

    return res.json({
      clients,
      devices,
      racks,
      tickets,
      crossConnects,
      floors,
      users,
      notifications
    });
  }
});

// -------------------------------------------------------------
// CLIENTS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/clients', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  if (role === 'admin' || role === 'support') {
    const rows = db.prepare('SELECT * FROM clients').all().map(mapClient);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM clients WHERE id = ?').all(clientId).map(mapClient);
    res.json(rows);
  }
});

app.post('/api/clients', authenticate, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'support') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const c = req.body;
  const insert = db.prepare(`
    INSERT INTO clients (
      id, pt, layanan, power, lokasi, status, pic, email, telp, ket, u,
      terminateAccessEndsAt, terminationApprovedAt, accountType, allowSubAccount,
      berhentiAt, terminatedAt, suspendAt, terminationTicketId, maxBerat
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    c.id, c.pt, c.layanan, c.power, c.lokasi, c.status, c.pic, c.email, c.telp, c.ket, c.u,
    c.terminateAccessEndsAt, c.terminationApprovedAt, c.accountType, c.allowSubAccount ? 1 : 0,
    c.berhentiAt, c.terminatedAt, c.suspendAt, c.terminationTicketId, c.maxBerat ? parseFloat(c.maxBerat) : null
  );
  sseEmit('client_updated', { id: c.id });
  res.status(201).json({ success: true, client: c });
});

app.put('/api/clients/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;
  if (role !== 'admin' && role !== 'support' && id !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const c = req.body;
  const update = db.prepare(`
    UPDATE clients SET
      pt = ?, layanan = ?, power = ?, lokasi = ?, status = ?, pic = ?, email = ?, telp = ?, ket = ?, u = ?,
      terminateAccessEndsAt = ?, terminationApprovedAt = ?, accountType = ?, allowSubAccount = ?,
      berhentiAt = ?, terminatedAt = ?, suspendAt = ?, terminationTicketId = ?, maxBerat = ?
    WHERE id = ?
  `);
  update.run(
    c.pt, c.layanan, c.power, c.lokasi, c.status, c.pic, c.email, c.telp, c.ket, c.u,
    c.terminateAccessEndsAt, c.terminationApprovedAt, c.accountType, c.allowSubAccount ? 1 : 0,
    c.berhentiAt, c.terminatedAt, c.suspendAt, c.terminationTicketId, c.maxBerat ? parseFloat(c.maxBerat) : null,
    id
  );
  sseEmit('client_updated', { id });
  res.json({ success: true });
});

app.delete('/api/clients/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { id } = req.params;
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  sseEmit('client_updated', { id });
  res.json({ success: true });
});

// -------------------------------------------------------------
// DEVICES ENDPOINTS
// -------------------------------------------------------------
app.get('/api/devices', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  if (role === 'admin' || role === 'support') {
    const rows = db.prepare('SELECT * FROM devices').all().map(mapDevice);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM devices WHERE clientId = ?').all(clientId).map(mapDevice);
    res.json(rows);
  }
});

app.post('/api/devices', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const d = req.body;
  if (role !== 'admin' && role !== 'support') {
    d.clientId = clientId;
  }
  const insert = db.prepare(`
    INSERT INTO devices (
      id, clientId, nama, kategori, sn, jumlah, rackPos, kondisi, berat,
      tglMasuk, tglKeluar, type, alasan, ket, exited, ticketId, ticketStatus,
      devExistingId, outName, outSn, outTgl, outReason, devBerat, devTglMasuk, devPos
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    d.id, d.clientId, d.nama, d.kategori, d.sn, d.jumlah, d.rackPos, d.kondisi, d.berat,
    d.tglMasuk, d.tglKeluar, d.type, d.alasan, d.ket, d.exited ? 1 : 0, d.ticketId, d.ticketStatus,
    d.devExistingId, d.outName, d.outSn, d.outTgl, d.outReason, d.devBerat, d.devTglMasuk, d.devPos
  );
  sseEmit('device_updated', { id: d.id });
  res.status(201).json({ success: true, device: d });
});

app.put('/api/devices/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;
  const d = req.body;

  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });

  if (role !== 'admin' && role !== 'support') {
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
    d.clientId = clientId;
  }


  const update = db.prepare(`
    UPDATE devices SET
      clientId = ?, nama = ?, kategori = ?, sn = ?, jumlah = ?, rackPos = ?, kondisi = ?, berat = ?,
      tglMasuk = ?, tglKeluar = ?, type = ?, alasan = ?, ket = ?, exited = ?, ticketId = ?, ticketStatus = ?,
      devExistingId = ?, outName = ?, outSn = ?, outTgl = ?, outReason = ?, devBerat = ?, devTglMasuk = ?, devPos = ?
    WHERE id = ?
  `);
  update.run(
    d.clientId, d.nama, d.kategori, d.sn, d.jumlah, d.rackPos, d.kondisi, d.berat,
    d.tglMasuk, d.tglKeluar, d.type, d.alasan, d.ket, d.exited ? 1 : 0, d.ticketId, d.ticketStatus,
    d.devExistingId, d.outName, d.outSn, d.outTgl, d.outReason, d.devBerat, d.devTglMasuk, d.devPos,
    id
  );
  sseEmit('device_updated', { id });
  res.json({ success: true });
});

app.delete('/api/devices/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;

  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });

  if (role !== 'admin' && role !== 'support' && existing.clientId !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }

  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  sseEmit('device_deleted', { id });
  res.json({ success: true });
});

// -------------------------------------------------------------
// RACKS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/racks', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM racks').all().map(mapRack);
  res.json(rows);
});

app.post('/api/racks', authenticate, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'support') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const r = req.body;
  const insert = db.prepare(`
    INSERT INTO racks (
      id, lokasi, status, util, temp, power, u, ket, lantai, tipeRack, otbNum, portNum
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    r.id, r.lokasi, r.status, r.util, r.temp, r.power, r.u, r.ket, r.lantai, r.tipeRack, r.otbNum, r.portNum
  );
  res.status(201).json({ success: true, rack: r });
});

app.put('/api/racks/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'support') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { id } = req.params;
  const r = req.body;
  const update = db.prepare(`
    UPDATE racks SET
      lokasi = ?, status = ?, util = ?, temp = ?, power = ?, u = ?, ket = ?, lantai = ?, tipeRack = ?, otbNum = ?, portNum = ?
    WHERE id = ?
  `);
  update.run(
    r.lokasi, r.status, r.util, r.temp, r.power, r.u, r.ket, r.lantai, r.tipeRack, r.otbNum, r.portNum,
    id
  );
  res.json({ success: true });
});

app.delete('/api/racks/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { id } = req.params;
  db.prepare('DELETE FROM racks WHERE id = ?').run(id);
  res.json({ success: true });
});

// -------------------------------------------------------------
// TICKETS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/tickets', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  if (role === 'admin' || role === 'support') {
    const rows = db.prepare('SELECT * FROM tickets').all().map(mapTicket);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM tickets WHERE clientId = ?').all(clientId).map(mapTicket);
    res.json(rows);
  }
});

app.post('/api/tickets', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const t = req.body;
  if (role !== 'admin' && role !== 'support') {
    t.clientId = clientId;
  }
  const nowTs = Date.now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tickets (
      id, reqId, type, title, desc, pt, clientId, rack, titikA, titikB, cableLen, connType,
      priority, status, date, autoCreate, createdBy, approvedBy, completedBy,
      devName, devCat, devQty, devTglMasuk, devPos, devSn, outName, outSn, outTgl,
      outReason, devBerat, devExistingId, adminApprovedAt, supportApprovedAt, terminateEligibleAt, updatedTime
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    t.id, t.reqId, t.type, t.title, t.desc, t.pt, t.clientId, t.rack, t.titikA, t.titikB, t.cableLen, t.connType,
    t.priority, t.status, t.date, t.autoCreate ? 1 : 0, t.createdBy, t.approvedBy, t.completedBy,
    t.devName, t.devCat, t.devQty, t.devTglMasuk, t.devPos, t.devSn, t.outName, t.outSn, t.outTgl,
    t.outReason, t.devBerat, t.devExistingId, t.adminApprovedAt, t.supportApprovedAt, t.terminateEligibleAt,
    t.updatedTime ? Number(t.updatedTime) : nowTs
  );
  sseEmit('ticket_created', { id: t.id, clientId: t.clientId });
  res.status(201).json({ success: true, ticket: t });
});

app.put('/api/tickets/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;
  const t = req.body;

  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Tiket tidak ditemukan.' });

  if (role !== 'admin' && role !== 'support') {
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
    t.clientId = clientId;
  }

  const nowTs = Date.now();
  const update = db.prepare(`
    UPDATE tickets SET
      reqId = ?, type = ?, title = ?, desc = ?, pt = ?, clientId = ?, rack = ?, titikA = ?, titikB = ?, cableLen = ?, connType = ?,
      priority = ?, status = ?, date = ?, autoCreate = ?, createdBy = ?, approvedBy = ?, completedBy = ?,
      devName = ?, devCat = ?, devQty = ?, devTglMasuk = ?, devPos = ?, devSn = ?, outName = ?, outSn = ?, outTgl = ?,
      outReason = ?, devBerat = ?, devExistingId = ?, adminApprovedAt = ?, supportApprovedAt = ?, terminateEligibleAt = ?, updatedTime = ?
    WHERE id = ?
  `);
  update.run(
    t.reqId, t.type, t.title, t.desc, t.pt, t.clientId, t.rack, t.titikA, t.titikB, t.cableLen, t.connType,
    t.priority, t.status, t.date, t.autoCreate ? 1 : 0, t.createdBy, t.approvedBy, t.completedBy,
    t.devName, t.devCat, t.devQty, t.devTglMasuk, t.devPos, t.devSn, t.outName, t.outSn, t.outTgl,
    t.outReason, t.devBerat, t.devExistingId, t.adminApprovedAt, t.supportApprovedAt, t.terminateEligibleAt,
    nowTs,
    id
  );
  sseEmit('ticket_updated', { id });
  res.json({ success: true });
});

app.delete('/api/tickets/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { id } = req.params;
  db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
  sseEmit('ticket_deleted', { id });
  res.json({ success: true });
});

app.post('/api/sync', authenticate, (req, res) => {
  const { clients: syncClients, devices: syncDevices, racks: syncRacks, tickets: syncTickets, crossConnects: syncXC, floors: syncFloors } = req.body || {};

  try {
    const syncTx = db.transaction(() => {
      if (Array.isArray(syncTickets)) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO tickets (
            id, reqId, type, title, desc, pt, clientId, rack, titikA, titikB, cableLen, connType,
            priority, status, date, autoCreate, createdBy, approvedBy, completedBy,
            devName, devCat, devQty, devTglMasuk, devPos, devSn, outName, outSn, outTgl,
            outReason, devBerat, devExistingId, adminApprovedAt, supportApprovedAt, terminateEligibleAt, updatedTime
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncTickets.forEach(t => {
          if (!t.id) return;
          stmt.run(
            t.id, t.reqId||'', t.type||'', t.title||'', t.desc||'', t.pt||'', t.clientId||'', t.rack||'', t.titikA||'', t.titikB||'', t.cableLen||'', t.connType||'',
            t.priority||'', t.status||'', t.date||'', t.autoCreate ? 1 : 0, t.createdBy||'', t.approvedBy||'', t.completedBy||'',
            t.devName||'', t.devCat||'', t.devQty||1, t.devTglMasuk||'', t.devPos||'', t.devSn||'', t.outName||'', t.outSn||'', t.outTgl||'',
            t.outReason||'', t.devBerat||null, t.devExistingId||'', t.adminApprovedAt||null, t.supportApprovedAt||null, t.terminateEligibleAt||null,
            t.updatedTime ? Number(t.updatedTime) : Date.now()
          );
        });
      }

      if (Array.isArray(syncClients)) {
        const ids = syncClients.map(c => c.id).filter(Boolean);
        if (ids.length > 0) {
          db.prepare(`DELETE FROM clients WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
        } else {
          db.prepare(`DELETE FROM clients`).run();
        }
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO clients (
            id, pt, layanan, power, lokasi, status, pic, email, telp, ket, u,
            terminateAccessEndsAt, terminationApprovedAt, accountType, allowSubAccount,
            berhentiAt, terminatedAt, suspendAt, terminationTicketId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncClients.forEach(c => {
          if (!c.id) return;
          stmt.run(
            c.id, c.pt||'', c.layanan||'', c.power||'', c.lokasi||'', c.status||'', c.pic||'', c.email||'', c.telp||c.phone||'', c.ket||'', c.u||'',
            c.terminateAccessEndsAt||null, c.terminationApprovedAt||null, c.accountType||'Client', c.allowSubAccount ? 1 : 0,
            c.berhentiAt||null, c.terminatedAt||null, c.suspendAt||null, c.terminationTicketId||null
          );
        });
      }

      if (Array.isArray(syncDevices)) {
        const ids = syncDevices.map(d => d.id).filter(Boolean);
        if (ids.length > 0) {
          db.prepare(`DELETE FROM devices WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
        } else {
          db.prepare(`DELETE FROM devices`).run();
        }
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO devices (
            id, clientId, nama, kategori, sn, jumlah, rackPos, kondisi, berat,
            tglMasuk, tglKeluar, type, alasan, ket, exited, ticketId, ticketStatus,
            devExistingId, outName, outSn, outTgl, outReason, devBerat, devTglMasuk, devPos
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncDevices.forEach(d => {
          if (!d.id) return;
          stmt.run(
            d.id, d.clientId||'', d.nama||'', d.kategori||'', d.sn||'', d.jumlah||1, d.rackPos||'', d.kondisi||'', d.berat||null,
            d.tglMasuk||'', d.tglKeluar||'', d.type||'masuk', d.alasan||d.exitReason||'', d.ket||'', d.exited ? 1 : 0, d.ticketId||'', d.ticketStatus||'',
            d.devExistingId||'', d.outName||'', d.outSn||'', d.outTgl||'', d.outReason||'', d.devBerat||null, d.devTglMasuk||'', d.devPos||''
          );
        });
      }

      if (Array.isArray(syncRacks)) {
        const ids = syncRacks.map(r => r.id).filter(Boolean);
        if (ids.length > 0) {
          db.prepare(`DELETE FROM racks WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
        } else {
          db.prepare(`DELETE FROM racks`).run();
        }
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO racks (id, lokasi, status, u, power, ket, lantai, tipeRack)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncRacks.forEach(r => {
          if (!r.id) return;
          stmt.run(r.id, r.lokasi||'', r.status||'Aktif', r.u||'42U', r.power||'', r.ket||'', r.lantai||'', r.tipeRack||'Close Rack');
        });
      }

      if (Array.isArray(syncXC)) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO cross_connects (id, reqId, pt, clientId, titikA, titikB, cableLen, connType, status, date, desc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncXC.forEach((x, index) => {
          const xcId = x.id || (`XC-${Date.now()}-${index}`);
          stmt.run(xcId, x.reqId||'', x.pt||'', x.clientId||'', x.titikA||'', x.titikB||'', x.cableLen||'', x.connType||'', x.status||'', x.date||'', x.desc||'');
        });
      }

      if (Array.isArray(syncFloors)) {
        const names = syncFloors.map(f => f.name).filter(Boolean);
        if (names.length > 0) {
          db.prepare(`DELETE FROM floors WHERE name NOT IN (${names.map(() => '?').join(',')})`).run(...names);
        } else {
          db.prepare(`DELETE FROM floors`).run();
        }
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO floors (name, area, maxRacks)
          VALUES (?, ?, ?)
        `);
        syncFloors.forEach(f => {
          if (!f.name) return;
          stmt.run(f.name, f.area||'', f.maxRacks||null);
        });
      }

      const { users: syncUsers, notifications: syncNotifications } = req.body || {};
      if (Array.isArray(syncUsers)) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO users (email, password, name, role, avatar, pt, clientId, accountType, allowSubAccount, parentEmail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        syncUsers.forEach(u => {
          if (!u.email) return;
          const existing = db.prepare('SELECT password FROM users WHERE LOWER(email) = LOWER(?)').get(u.email);
          const pass = existing ? existing.password : (u.password ? bcrypt.hashSync(u.password, 10) : bcrypt.hashSync('client123', 10));
          stmt.run(
            u.email, pass, u.name||'', u.role||'client', u.avatar||'US', u.pt||'', u.clientId||'', u.accountType||null, u.allowSubAccount ? 1 : 0, u.parentEmail||null
          );
        });
      }

      if (Array.isArray(syncNotifications)) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO termination_notifications (id, ticketId, clientId, roles, readBy, message, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        syncNotifications.forEach(n => {
          if (!n.id) return;
          const rolesJson = JSON.stringify(Array.isArray(n.roles) ? n.roles : []);
          const readByJson = JSON.stringify(Array.isArray(n.readBy) ? n.readBy : []);
          stmt.run(
            n.id, n.ticketId||'', n.clientId||'', rolesJson, readByJson, n.message||'', n.createdAt||new Date().toISOString()
          );
        });
      }
    });

    syncTx();
    sseEmit('data_updated', {});
    sseEmit('ticket_updated', {});
    res.json({ success: true });
  } catch (e) {
    console.error('Error in /api/sync:', e);
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// CROSS CONNECTS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/cross-connects', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  if (role === 'admin' || role === 'support') {
    const rows = db.prepare('SELECT * FROM cross_connects').all().map(mapCrossConnect);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM cross_connects WHERE clientId = ?').all(clientId).map(mapCrossConnect);
    res.json(rows);
  }
});

app.post('/api/cross-connects', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const xc = req.body;
  if (role !== 'admin' && role !== 'support') {
    xc.clientId = clientId;
  }
  const insert = db.prepare(`
    INSERT INTO cross_connects (
      id, reqId, pt, clientId, titikA, titikB, cableLen, connType, status, date, desc
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    xc.id, xc.reqId, xc.pt, xc.clientId, xc.titikA, xc.titikB, xc.cableLen, xc.connType, xc.status, xc.date, xc.desc
  );
  res.status(201).json({ success: true, crossConnect: xc });
});

app.put('/api/cross-connects/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;
  const xc = req.body;

  const existing = db.prepare('SELECT * FROM cross_connects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Koneksi tidak ditemukan.' });

  if (role !== 'admin' && role !== 'support') {
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
    xc.clientId = clientId;
  }


  const update = db.prepare(`
    UPDATE cross_connects SET
      reqId = ?, pt = ?, clientId = ?, titikA = ?, titikB = ?, cableLen = ?, connType = ?, status = ?, date = ?, desc = ?
    WHERE id = ?
  `);
  update.run(
    xc.reqId, xc.pt, xc.clientId, xc.titikA, xc.titikB, xc.cableLen, xc.connType, xc.status, xc.date, xc.desc,
    id
  );
  res.json({ success: true });
});

app.delete('/api/cross-connects/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { id } = req.params;
  db.prepare('DELETE FROM cross_connects WHERE id = ?').run(id);
  res.json({ success: true });
});

// -------------------------------------------------------------
// USERS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/users', authenticate, (req, res) => {
  const { role, clientId, email } = req.user;
  if (role === 'admin') {
    const rows = db.prepare('SELECT * FROM users').all().map(row => mapUser(row, email));
    res.json(rows);
  } else if (role === 'client') {
    const rows = db.prepare('SELECT * FROM users WHERE clientId = ? OR email = ? OR parentEmail = ?').all(clientId, email, email).map(row => mapUser(row, email));
    res.json(rows);
  } else {
    res.status(403).json({ error: 'Akses ditolak.' });
  }
});

app.post('/api/users/change-password', authenticate, authLimiter, async (req, res) => {

  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Password lama dan baru harus diisi.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(req.user.email);
  if (!user) {
    return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  }
  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    return res.status(400).json({ error: 'Password lama salah.' });
  }
  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE LOWER(email) = LOWER(?)').run(hashedNewPassword, req.user.email);
  res.json({ success: true });
});

app.post('/api/users', authenticate, async (req, res) => {
  const { role, clientId, email } = req.user;
  const u = req.body;
  if (role !== 'admin') {
    if (role === 'client') {
      u.clientId = clientId;
      u.role = 'client';
      u.parentEmail = email;
    } else {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
  }
  const hashedPassword = await bcrypt.hash(u.password, 10);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (
      email, password, name, role, avatar, pt, clientId, accountType, allowSubAccount, parentEmail
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    u.email, hashedPassword, u.name, u.role, u.avatar, u.pt, u.clientId, u.accountType, u.allowSubAccount ? 1 : 0, u.parentEmail
  );
  res.status(201).json({ success: true, user: u });
});

app.put('/api/users/:email', authenticate, async (req, res) => {
  const { email: targetEmail } = req.params;
  const { role, clientId, email } = req.user;
  const u = req.body;

  const existing = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(targetEmail);
  if (!existing) return res.status(404).json({ error: 'User tidak ditemukan.' });

  if (role !== 'admin') {
    const isSelf = String(existing.email).toLowerCase() === String(email).toLowerCase();
    const isSub = String(existing.parentEmail).toLowerCase() === String(email).toLowerCase();
    if (!isSelf && !isSub) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
    u.clientId = existing.clientId;
    u.role = existing.role;
    u.parentEmail = existing.parentEmail;
  }

  let passToSave = u.password;
  if (passToSave && !passToSave.startsWith('$2b$') && !passToSave.startsWith('$2a$')) {
    passToSave = await bcrypt.hash(passToSave, 10);
  } else if (!passToSave) {
    passToSave = existing.password;
  }

  const update = db.prepare(`
    UPDATE users SET
      password = ?, name = ?, role = ?, avatar = ?, pt = ?, clientId = ?, accountType = ?, allowSubAccount = ?, parentEmail = ?
    WHERE LOWER(email) = LOWER(?)
  `);
  update.run(
    passToSave, u.name, u.role, u.avatar, u.pt, u.clientId, u.accountType, u.allowSubAccount ? 1 : 0, u.parentEmail,
    targetEmail
  );
  res.json({ success: true });
});


app.delete('/api/users/:email', authenticate, (req, res) => {
  const { email: targetEmail } = req.params;
  const { role, email } = req.user;

  const existing = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(targetEmail);
  if (!existing) return res.status(404).json({ error: 'User tidak ditemukan.' });

  if (role !== 'admin') {
    const isSub = String(existing.parentEmail).toLowerCase() === String(email).toLowerCase();
    if (!isSub) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }
  }

  db.prepare('DELETE FROM users WHERE LOWER(email) = LOWER(?)').run(targetEmail);
  res.json({ success: true });
});

// -------------------------------------------------------------
// FLOORS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/floors', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM floors').all();
  res.json(rows);
});

app.post('/api/floors', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const f = req.body;
  if (!f || !f.name) {
    return res.status(400).json({ error: 'Nama lantai wajib diisi.' });
  }
  const insert = db.prepare(`
    INSERT OR REPLACE INTO floors (name, area, maxRacks) VALUES (?, ?, ?)
  `);
  insert.run(f.name, f.area||'', f.maxRacks||null);
  sseEmit('data_updated', {});
  res.status(201).json({ success: true, floor: f });
});

app.put('/api/floors/:name', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { name } = req.params;
  const f = req.body;
  const update = db.prepare(`
    UPDATE floors SET area = ?, maxRacks = ? WHERE name = ?
  `);
  update.run(f.area, f.maxRacks, name);
  res.json({ success: true });
});

app.delete('/api/floors/:name', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const { name } = req.params;
  db.prepare('DELETE FROM floors WHERE name = ?').run(name);
  res.json({ success: true });
});

// -------------------------------------------------------------
// TERMINATION NOTIFICATIONS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/termination-notifications', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  if (role === 'admin' || role === 'support') {
    const rows = db.prepare('SELECT * FROM termination_notifications ORDER BY createdAt DESC').all().map(mapNotification);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM termination_notifications WHERE clientId = ? OR roles LIKE ? ORDER BY createdAt DESC').all(clientId, '%"client"%').map(mapNotification);
    res.json(rows);
  }
});

app.post('/api/termination-notifications', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const n = req.body;
  if (role !== 'admin' && role !== 'support' && n.clientId !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const insert = db.prepare(`
    INSERT INTO termination_notifications (
      id, event, ticketId, clientId, roles, message, createdAt, readBy
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    n.id, n.event, n.ticketId, n.clientId, JSON.stringify(n.roles || []), n.message, n.createdAt, JSON.stringify(n.readBy || [])
  );
  res.status(201).json({ success: true, notification: n });
});

app.put('/api/termination-notifications/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, clientId } = req.user;
  const n = req.body;

  const existing = db.prepare('SELECT * FROM termination_notifications WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });

  if (role !== 'admin' && role !== 'support' && existing.clientId !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }

  const update = db.prepare(`
    UPDATE termination_notifications SET
      event = ?, ticketId = ?, clientId = ?, roles = ?, message = ?, createdAt = ?, readBy = ?
    WHERE id = ?
  `);
  update.run(
    n.event, n.ticketId, n.clientId, JSON.stringify(n.roles || []), n.message, n.createdAt, JSON.stringify(n.readBy || []),
    id
  );
  res.json({ success: true });
});

app.put('/api/termination-notifications/bulk', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const notifications = req.body;
  if (!Array.isArray(notifications)) return res.status(400).json({ error: 'Data tidak valid.' });
  
  const insertOrUpdate = db.transaction((items) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO termination_notifications (
        id, event, ticketId, clientId, roles, message, createdAt, readBy
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    for (const n of items) {
      if (role !== 'admin' && role !== 'support' && n.clientId !== clientId) {
        throw new Error('Forbidden');
      }
      insert.run(
        n.id, n.event, n.ticketId, n.clientId, JSON.stringify(n.roles || []), n.message, n.createdAt, JSON.stringify(n.readBy || [])
      );
    }
  });
  
  try {
    insertOrUpdate(notifications);
    sseEmit('notification_updated', {});
    res.json({ success: true });
  } catch (e) {
    if (e.message === 'Forbidden') {
      res.status(403).json({ error: 'Akses ditolak.' });
    } else {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// -------------------------------------------------------------
// RACK LOGS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/rack-logs', authenticate, (req, res) => {
  const { rackId } = req.query;
  const { role, clientId } = req.user;
  
  let rows;
  if (role === 'admin' || role === 'support') {
    if (rackId) {
      rows = db.prepare('SELECT * FROM rack_logs WHERE rackId = ? ORDER BY at DESC').all(rackId);
    } else {
      rows = db.prepare('SELECT * FROM rack_logs ORDER BY at DESC').all();
    }
  } else {
    // Clients can only see logs of racks they rent
    const clientRacks = db.prepare('SELECT id FROM racks WHERE locations LIKE ? OR id IN (SELECT lokasi FROM clients WHERE id = ?)').all(`%${clientId}%`, clientId).map(r => r.id);
    if (rackId) {
      if (!clientRacks.includes(rackId)) {
        return res.json([]);
      }
      rows = db.prepare('SELECT * FROM rack_logs WHERE rackId = ? ORDER BY at DESC').all(rackId);
    } else {
      if (clientRacks.length === 0) return res.json([]);
      const placeholders = clientRacks.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM rack_logs WHERE rackId IN (${placeholders}) ORDER BY at DESC`).all(...clientRacks);
    }
  }
  res.json(rows);
});

app.post('/api/rack-logs', authenticate, (req, res) => {
  const { role } = req.user;
  if (role !== 'admin' && role !== 'support') {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const l = req.body;
  const insert = db.prepare(`
    INSERT INTO rack_logs (
      rackId, tgl, type, ptId, catatan, at, ptLama, ptBaru, oldLokasi, newLokasi, status, by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    l.rackId, l.tgl, l.type, l.ptId, l.catatan, l.at, l.ptLama, l.ptBaru, l.oldLokasi, l.newLokasi, l.status, l.by
  );
  res.status(201).json({ success: true, log: l });
});

// -------------------------------------------------------------
// CLIENT LOGS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/client-logs', authenticate, (req, res) => {
  const { clientId } = req.query;
  const { role, clientId: userClientId } = req.user;

  if (role !== 'admin' && role !== 'support' && clientId !== userClientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }

  let rows;
  if (clientId) {
    rows = db.prepare('SELECT * FROM client_logs WHERE clientId = ? ORDER BY at DESC').all(clientId);
  } else {
    rows = db.prepare('SELECT * FROM client_logs ORDER BY at DESC').all();
  }
  res.json(rows);
});

app.post('/api/client-logs', authenticate, (req, res) => {
  const { role, clientId } = req.user;
  const l = req.body;
  if (role !== 'admin' && role !== 'support' && l.clientId !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  const insert = db.prepare(`
    INSERT INTO client_logs (
      clientId, tgl, status, by, at
    ) VALUES (
      ?, ?, ?, ?, ?
    )
  `);
  insert.run(
    l.clientId, l.tgl, l.status, l.by, l.at
  );
  res.status(201).json({ success: true, log: l });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
