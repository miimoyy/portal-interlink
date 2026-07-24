const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const db = new Database(path.join(__dirname, 'data.db'));


// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS floors (
  name TEXT PRIMARY KEY,
  area TEXT,
  maxRacks INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  pt TEXT,
  layanan TEXT,
  power TEXT,
  lokasi TEXT,
  status TEXT,
  pic TEXT,
  email TEXT,
  telp TEXT,
  ket TEXT,
  u TEXT,
  terminateAccessEndsAt TEXT,
  terminationApprovedAt TEXT,
  accountType TEXT,
  allowSubAccount INTEGER,
  berhentiAt TEXT,
  terminatedAt TEXT,
  suspendAt TEXT,
  terminationTicketId TEXT,
  maxBerat REAL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  clientId TEXT,
  nama TEXT,
  kategori TEXT,
  sn TEXT,
  jumlah INTEGER,
  rackPos TEXT,
  kondisi TEXT,
  berat REAL,
  tglMasuk TEXT,
  tglKeluar TEXT,
  type TEXT,
  alasan TEXT,
  ket TEXT,
  exited INTEGER,
  ticketId TEXT,
  ticketStatus TEXT,
  devExistingId TEXT,
  outName TEXT,
  outSn TEXT,
  outTgl TEXT,
  outReason TEXT,
  devBerat REAL,
  devTglMasuk TEXT,
  devPos TEXT
);

CREATE TABLE IF NOT EXISTS racks (
  id TEXT PRIMARY KEY,
  lokasi TEXT,
  status TEXT,
  util INTEGER,
  temp INTEGER,
  power TEXT,
  u TEXT,
  ket TEXT,
  lantai TEXT,
  tipeRack TEXT,
  otbNum TEXT,
  portNum TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  reqId TEXT,
  type TEXT,
  title TEXT,
  desc TEXT,
  pt TEXT,
  clientId TEXT,
  rack TEXT,
  titikA TEXT,
  titikB TEXT,
  cableLen TEXT,
  connType TEXT,
  priority TEXT,
  status TEXT,
  date TEXT,
  autoCreate INTEGER,
  createdBy TEXT,
  approvedBy TEXT,
  completedBy TEXT,
  devName TEXT,
  devCat TEXT,
  devQty INTEGER,
  devTglMasuk TEXT,
  devPos TEXT,
  devSn TEXT,
  outName TEXT,
  outSn TEXT,
  outTgl TEXT,
  outReason TEXT,
  devBerat REAL,
  devExistingId TEXT,
  adminApprovedAt TEXT,
  supportApprovedAt TEXT,
  terminateEligibleAt TEXT,
  updatedTime REAL
);

CREATE TABLE IF NOT EXISTS cross_connects (
  id TEXT PRIMARY KEY,
  reqId TEXT,
  pt TEXT,
  clientId TEXT,
  titikA TEXT,
  titikB TEXT,
  cableLen TEXT,
  connType TEXT,
  status TEXT,
  date TEXT,
  desc TEXT
);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  password TEXT,
  name TEXT,
  role TEXT,
  avatar TEXT,
  pt TEXT,
  clientId TEXT,
  accountType TEXT,
  allowSubAccount INTEGER,
  parentEmail TEXT
);

CREATE TABLE IF NOT EXISTS termination_notifications (
  id TEXT PRIMARY KEY,
  event TEXT,
  ticketId TEXT,
  clientId TEXT,
  roles TEXT,
  message TEXT,
  createdAt TEXT,
  readBy TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  email TEXT,
  role TEXT,
  clientId TEXT,
  pt TEXT,
  expiresAt INTEGER
);

CREATE TABLE IF NOT EXISTS rack_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rackId TEXT,
  tgl TEXT,
  type TEXT,
  ptId TEXT,
  catatan TEXT,
  at TEXT,
  ptLama TEXT,
  ptBaru TEXT,
  oldLokasi TEXT,
  newLokasi TEXT,
  status TEXT,
  by TEXT
);

CREATE TABLE IF NOT EXISTS client_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId TEXT,
  tgl TEXT,
  status TEXT,
  by TEXT,
  at TEXT
);
`);

try { db.exec("ALTER TABLE clients ADD COLUMN maxBerat REAL;"); } catch(e){}
try { db.exec("ALTER TABLE tickets ADD COLUMN updatedTime REAL;"); } catch(e){}

// Seed default data if users table is empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  console.log('Seeding default data...');
  
  // Seed Floors
  const seedFloors = [
    {name:'Lantai 2', area:'Zona A dan Zona B', maxRacks:24},
    {name:'Lantai 3', area:'Zona C', maxRacks:18}
  ];
  const insertFloor = db.prepare('INSERT INTO floors (name, area, maxRacks) VALUES (@name, @area, @maxRacks)');
  for (const f of seedFloors) {
    insertFloor.run(f);
  }

  // Seed Clients
  const seedClients = [
    {id:"RCK-A04-01", pt:"PT Nusantara Digital Solusi", layanan:"Colocation Full Rack", power:"5 A", lokasi:"Rack A-04", status:"Hold", pic:"Budi Santoso", email:"it@nusadigi.co.id", telp:"+62 811-1111-0001", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-A09-03", pt:"PT Nusantara Digital Solusi", layanan:"Colocation Full Rack", power:"5 A", lokasi:"Rack A-09", status:"Aktif", pic:"Budi Santoso", email:"it@nusadigi.co.id", telp:"+62 811-1111-0001", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-A09-02", pt:"PT Mitra Cipta Teknologi", layanan:"Colocation Half Rack", power:"3 A", lokasi:"Rack A-09", status:"Aktif", pic:"Siti Rahayu", email:"ops@mitracipta.co.id", telp:"+62 812-2222-0002", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-B02-01", pt:"PT Bumi Cloud Nusantara", layanan:"Dedicated Server", power:"2 A", lokasi:"Rack B-02", status:"Jatuh tempo", pic:"Agus Prasetyo", email:"noc@bumicloud.id", telp:"+62 813-3333-0003", ket:"Menunggak 1 bulan", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-B11-03", pt:"PT Garuda Media Cipta", layanan:"Colocation Full Rack", power:"6 A", lokasi:"Rack B-11", status:"Suspend", pic:"Rina Wati", email:"infra@garudamedia.co.id", telp:"+62 814-4444-0004", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-C05-01", pt:"PT Sinergi Data Prima", layanan:"Cloud Hosting", power:"4 A", lokasi:"Rack C-05", status:"Aktif", pic:"Hendro K", email:"support@sinergidata.co.id", telp:"+62 815-5555-0005", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-C14-02", pt:"PT Andalan Infra Teknologi", layanan:"Colocation Quarter Rack", power:"1.5 A", lokasi:"Rack C-14", status:"Aktif", pic:"Dewi Lestari", email:"net@andalaninfra.id", telp:"+62 816-6666-0006", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-F01-01", pt:"PT Fibernet", layanan:"Colocation Half Rack", power:"3 A", lokasi:"Rack F-01", status:"Aktif", pic:"Fajar Fibernet", email:"ops@fibernet.id", telp:"+62 817-7777-0007", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-G01-01", pt:"PT Heavy Compute Indonesia", layanan:"Colocation Full Rack", lokasi:"Rack G-01", u:"42U", power:"10 A", status:"Aktif", pic:"", email:"", telp:"", ket:"", terminateAccessEndsAt:null, terminationApprovedAt:null, accountType:"pribadi", allowSubAccount:0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-H01-01", pt:"PT Reseller Network Global", layanan:"Colocation 2 Racks", lokasi:"Rack H-01", u:"42U", power:"15 A", status:"Aktif", pic:"", email:"", telp:"", ket:"", terminateAccessEndsAt:null, terminationApprovedAt:null, accountType:"reseller", allowSubAccount:1, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null},
    {id:"RCK-H01-02", pt:"PT Reseller Network Global", layanan:"Colocation Full Rack", power:"10 A", lokasi:"Rack H-02", status:"Aktif", pic:"Budi Reseller", email:"ops@global.net", telp:"+62 812-0000-0000", ket:"", u: "", terminateAccessEndsAt: null, terminationApprovedAt: null, accountType: "pribadi", allowSubAccount: 0, berhentiAt: null, terminatedAt: null, suspendAt: null, terminationTicketId: null}
  ];
  const insertClient = db.prepare(`
    INSERT INTO clients (
      id, pt, layanan, power, lokasi, status, pic, email, telp, ket, u,
      terminateAccessEndsAt, terminationApprovedAt, accountType, allowSubAccount,
      berhentiAt, terminatedAt, suspendAt, terminationTicketId
    ) VALUES (
      @id, @pt, @layanan, @power, @lokasi, @status, @pic, @email, @telp, @ket, @u,
      @terminateAccessEndsAt, @terminationApprovedAt, @accountType, @allowSubAccount,
      @berhentiAt, @terminatedAt, @suspendAt, @terminationTicketId
    )
  `);
  for (const c of seedClients) {
    insertClient.run(c);
  }

  // Seed Devices
  const seedDevices = [
    {id:"DEV-1001", clientId:"RCK-A04-01", nama:"Dell PowerEdge R740", kategori:"Server", sn:"SN-DL740-001", jumlah:2, rackPos:"Rack A-04 U10-U12", kondisi:"Baik", berat:20, tglMasuk:"2024-11-12", tglKeluar:null, type:"masuk", alasan:"", ket:"2x host virtualization", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1002", clientId:"RCK-A04-01", nama:"Cisco Nexus 9K", kategori:"Switch", sn:"SN-CIS-9K-88", jumlah:1, rackPos:"Rack A-04 U01", kondisi:"Baik", berat:5, tglMasuk:"2024-11-12", tglKeluar:null, type:"masuk", alasan:"", ket:"Core switch", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1003", clientId:"RCK-A04-01", nama:"Patch Panel 48P", kategori:"Patch Panel", sn:"PP-48-01", jumlah:1, rackPos:"Rack A-04 U02", kondisi:"Baru", berat:null, tglMasuk:"2025-01-05", tglKeluar:"2025-06-20", type:"keluar", alasan:"Upgrade ke 96P", ket:"Diambil client", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1004", clientId:"RCK-A09-02", nama:"HPE ProLiant DL380", kategori:"Server", sn:"HPE-DL380-22", jumlah:1, rackPos:"Rack A-09 U15", kondisi:"Baik", berat:null, tglMasuk:"2024-12-03", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1005A", clientId:"RCK-A09-02", nama:"Fiber Optic 10G LR (Port 1)", kategori:"Modul / Transceiver", sn:"SFP-10G-12-01", jumlah:1, rackPos:"Rack A-09", kondisi:"Baru", berat:null, tglMasuk:"2024-12-03", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1005B", clientId:"RCK-A09-02", nama:"Fiber Optic 10G LR (Port 2)", kategori:"Modul / Transceiver", sn:"SFP-10G-12-02", jumlah:1, rackPos:"Rack A-09", kondisi:"Baru", berat:null, tglMasuk:"2024-12-03", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1005C", clientId:"RCK-A09-02", nama:"Fiber Optic 10G LR (Port 3)", kategori:"Modul / Transceiver", sn:"SFP-10G-12-03", jumlah:1, rackPos:"Rack A-09", kondisi:"Baru", berat:null, tglMasuk:"2024-12-03", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1005D", clientId:"RCK-A09-02", nama:"Fiber Optic 10G LR (Port 4)", kategori:"Modul / Transceiver", sn:"SFP-10G-12-04", jumlah:1, rackPos:"Rack A-09", kondisi:"Baru", berat:null, tglMasuk:"2024-12-03", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1006", clientId:"RCK-B02-01", nama:"Supermicro Storage", kategori:"Storage", sn:"SM-ST-001", jumlah:1, rackPos:"Rack B-02 U20-U24", kondisi:"Baik", berat:null, tglMasuk:"2024-10-20", tglKeluar:"2025-03-15", type:"keluar", alasan:"End of contract - return", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-1007", clientId:"RCK-C05-01", nama:"FortiGate 100F", kategori:"Firewall", sn:"FG100F-9981", jumlah:1, rackPos:"Rack C-05 U01", kondisi:"Baik", berat:null, tglMasuk:"2025-02-11", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-9001", clientId:"RCK-G01-01", nama:"Supermicro 4U Storage Server", kategori:"Server", sn:"SM-9000-A", jumlah:5, rackPos:"Rack G-01 U01-U20", kondisi:"Baik", berat:30, tglMasuk:"2025-01-01", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null},
    {id:"DEV-9002", clientId:"RCK-G01-01", nama:"Supermicro 4U Storage Server", kategori:"Server", sn:"SM-9000-B", jumlah:5, rackPos:"Rack G-01 U21-U40", kondisi:"Baik", berat:30, tglMasuk:"2025-01-01", tglKeluar:null, type:"masuk", alasan:"", ket:"", exited:0, ticketId:null, ticketStatus:null, devExistingId:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devTglMasuk:null, devPos:null}
  ];
  const insertDevice = db.prepare(`
    INSERT INTO devices (
      id, clientId, nama, kategori, sn, jumlah, rackPos, kondisi, berat,
      tglMasuk, tglKeluar, type, alasan, ket, exited, ticketId, ticketStatus,
      devExistingId, outName, outSn, outTgl, outReason, devBerat, devTglMasuk, devPos
    ) VALUES (
      @id, @clientId, @nama, @kategori, @sn, @jumlah, @rackPos, @kondisi, @berat,
      @tglMasuk, @tglKeluar, @type, @alasan, @ket, @exited, @ticketId, @ticketStatus,
      @devExistingId, @outName, @outSn, @outTgl, @outReason, @devBerat, @devTglMasuk, @devPos
    )
  `);
  for (const d of seedDevices) {
    insertDevice.run(d);
  }

  // Seed Racks
  const seedRacks = [
    {id:"Rack A-04", lokasi:"Lantai 2 · Zona A", status:"Aktif", util:78, temp:22, power:"10 A", u:"42U", ket:"Rack utama client enterprise", lantai:"Lantai 2", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack A-09", lokasi:"Lantai 2 · Zona A", status:"Proses", util:92, temp:27, power:"8 A", u:"42U", ket:"Perlu monitoring kondisi rack", lantai:"Lantai 2", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack B-02", lokasi:"Lantai 2 · Zona B", status:"Aktif", util:54, temp:21, power:"10 A", u:"42U", ket:"", lantai:"Lantai 2", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack B-11", lokasi:"Lantai 2 · Zona B", status:"Hold", util:98, temp:31, power:"12 A", u:"47U", ket:"Perlu pemeriksaan kondisi rack", lantai:"Lantai 2", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack C-05", lokasi:"Lantai 3 · Zona C", status:"Aktif", util:63, temp:22, power:"8 A", u:"42U", ket:"", lantai:"Lantai 3", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack C-14", lokasi:"Lantai 3 · Zona C", status:"Aktif", util:45, temp:20, power:"6 A", u:"42U", ket:"Rack kosong cukup banyak", lantai:"Lantai 3", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack G-01", lokasi:"Lantai 2 · Zona G", status:"Aktif", util:95, temp:28, power:"20 A", u:"42U", ket:"Client with heavy DB storage", lantai:"Lantai 2", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack H-01", lokasi:"Lantai 3 · Zona H", status:"Aktif", util:50, temp:22, power:"30 A", u:"42U", ket:"Reseller Main Rack", lantai:"Lantai 3", tipeRack: "Close Rack", otbNum: null, portNum: null},
    {id:"Rack H-02", lokasi:"Lantai 3 · Zona H", status:"Aktif", util:40, temp:21, power:"30 A", u:"42U", ket:"Reseller Secondary Rack", lantai:"Lantai 3", tipeRack: "Close Rack", otbNum: null, portNum: null}
  ];
  const insertRack = db.prepare(`
    INSERT INTO racks (
      id, lokasi, status, util, temp, power, u, ket, lantai, tipeRack, otbNum, portNum
    ) VALUES (
      @id, @lokasi, @status, @util, @temp, @power, @u, @ket, @lantai, @tipeRack, @otbNum, @portNum
    )
  `);
  for (const r of seedRacks) {
    insertRack.run(r);
  }

  // Seed Tickets
  const seedTickets = [
    {id:"TCK-2211", reqId:"REQ-20250512-AB12", type:"CrossConnect", title:"Permintaan CrossConnect Rack A-04 ke ISP Biznet 10G", desc:"Butuh koneksi SMF dari Rack A-04 ke Meet-Me Room Biznet untuk client PT Nusantara.", pt:"PT Nusantara Digital Solusi", clientId:"RCK-A04-01", rack:"Rack A-04", titikA:"Rack A-04", titikB:"ISP Biznet - MMR", cableLen:"45 meter", connType:"Single Mode Fiber", priority:"Prioritas tinggi", status:"Selesai", date:"2025-05-12", autoCreate:0, createdBy:"Budi Nusantara", approvedBy:"Sari Support", completedBy:"Andi Ramadhan", devName:null, devCat:null, devQty:null, devTglMasuk:null, devPos:null, devSn:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devExistingId:null, adminApprovedAt:null, supportApprovedAt:null, terminateEligibleAt:null},
    {id:"TCK-2210", type:"Masuk Barang", title:"Masuk Barang - Dell R750 untuk PT Mitra Cipta", desc:"2 Unit Dell PowerEdge R750 + 1 Switch Cisco C9300 akan masuk minggu depan. Mohon siapkan U space di Rack A-09.", pt:"PT Mitra Cipta Teknologi", clientId:"RCK-A09-02", rack:"Rack A-09", devName:"Dell PowerEdge R750", devCat:"Server", devQty:2, devTglMasuk:"2025-05-20", priority:"Prioritas sedang", status:"Disetujui", date:"2025-05-11", autoCreate:1, createdBy:"Siti Mitra", approvedBy:"Sari Support", completedBy:null, devPos:null, devSn:null, outName:null, outSn:null, outTgl:null, outReason:null, devBerat:null, devExistingId:null, adminApprovedAt:null, supportApprovedAt:null, terminateEligibleAt:null}
  ];
  const insertTicket = db.prepare(`
    INSERT INTO tickets (
      id, reqId, type, title, desc, pt, clientId, rack, titikA, titikB, cableLen, connType,
      priority, status, date, autoCreate, createdBy, approvedBy, completedBy,
      devName, devCat, devQty, devTglMasuk, devPos, devSn, outName, outSn, outTgl,
      outReason, devBerat, devExistingId, adminApprovedAt, supportApprovedAt, terminateEligibleAt
    ) VALUES (
      @id, @reqId, @type, @title, @desc, @pt, @clientId, @rack, @titikA, @titikB, @cableLen, @connType,
      @priority, @status, @date, @autoCreate, @createdBy, @approvedBy, @completedBy,
      @devName, @devCat, @devQty, @devTglMasuk, @devPos, @devSn, @outName, @outSn, @outTgl,
      @outReason, @devBerat, @devExistingId, @adminApprovedAt, @supportApprovedAt, @terminateEligibleAt
    )
  `);
  const ticketCols = [
    'id', 'reqId', 'type', 'title', 'desc', 'pt', 'clientId', 'rack', 'titikA', 'titikB',
    'cableLen', 'connType', 'priority', 'status', 'date', 'autoCreate', 'createdBy',
    'approvedBy', 'completedBy', 'devName', 'devCat', 'devQty', 'devTglMasuk', 'devPos',
    'devSn', 'outName', 'outSn', 'outTgl', 'outReason', 'devBerat', 'devExistingId',
    'adminApprovedAt', 'supportApprovedAt', 'terminateEligibleAt'
  ];
  for (const t of seedTickets) {
    const bound = {};
    ticketCols.forEach(col => {
      bound[col] = t[col] !== undefined ? t[col] : null;
    });
    insertTicket.run(bound);
  }

  // Seed CrossConnects
  const seedCrossConnects = [
    {id:"XC-1042", reqId:"REQ-20250512-AB12", pt:"PT Nusantara Digital Solusi", clientId:"RCK-A04-01", titikA:"Rack A-04", titikB:"ISP Telkomsel", cableLen:"45 meter", connType:"Single Mode Fiber", status:"Aktif", date:"2025-05-12", desc:"Koneksi utama ke Telkomsel"},
    {id:"XC-1041", reqId:"", pt:"PT Bumi Cloud Nusantara", clientId:"RCK-B02-01", titikA:"Rack B-02", titikB:"Rack C-05", cableLen:"12 meter", connType:"CAT6 UTP", status:"Aktif", date:"2025-05-10", desc:"Interkoneksi internal"},
    {id:"XC-1039", reqId:"", pt:"PT Mitra Cipta Teknologi", clientId:"RCK-A09-02", titikA:"Rack A-09", titikB:"ISP Biznet", cableLen:"60 meter", connType:"Single Mode Fiber", status:"Aktif", date:"2025-05-08", desc:"Koneksi ke Biznet"},
    {id:"XC-1035", reqId:"REQ-20250510-XX01", pt:"PT Garuda Media Cipta", clientId:"RCK-B11-03", titikA:"Rack B-11", titikB:"ISP Iconpln", cableLen:"30 meter", connType:"OTB Fiber", status:"Dalam proses", date:"2025-05-11", desc:"Menunggu patching di MMR"},
    {id:"XC-1028", reqId:"", pt:"PT Andalan Infra Teknologi", clientId:"RCK-C14-02", titikA:"Rack C-14", titikB:"Rack A-04", cableLen:"25 meter", connType:"Cross Connect Internal", status:"Aktif", date:"2025-05-05", desc:"Koneksi antar zona"}
  ];
  const insertCrossConnect = db.prepare(`
    INSERT INTO cross_connects (
      id, reqId, pt, clientId, titikA, titikB, cableLen, connType, status, date, desc
    ) VALUES (
      @id, @reqId, @pt, @clientId, @titikA, @titikB, @cableLen, @connType, @status, @date, @desc
    )
  `);
  for (const xc of seedCrossConnects) {
    insertCrossConnect.run(xc);
  }

  // Seed Users
  const seedUsers = [
    {email:"admin@interlink.co.id", password:"admin123", name:"Andi Ramadhan", role:"admin", avatar:"AR", pt:"INTERLINK Admin", clientId: null, accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"support@interlink.co.id", password:"support123", name:"Sari Support", role:"support", avatar:"SS", pt:"Support Team", clientId: null, accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"ruly@abs.net.id", password:"rulyabs8", name:"ruly", role:"support", avatar:"RU", pt:"Support Team", clientId: null, accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"admin@fibernet.id", password:"fibernet8", name:"Admin Fibernet", role:"admin", avatar:"AF", pt:"PT Fibernet", clientId: null, accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.fibernet@pt.com", password:"fibernet8", name:"Fajar Fibernet", role:"client", avatar:"FF", clientId:"RCK-F01-01", pt:"PT Fibernet", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.nusantara@pt.com", password:"client123", name:"Budi Nusantara", role:"client", avatar:"BN", clientId:"RCK-A04-01", pt:"PT Nusantara Digital Solusi", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.mitra@pt.com", password:"client123", name:"Siti Mitra", role:"client", avatar:"SM", clientId:"RCK-A09-02", pt:"PT Mitra Cipta Teknologi", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.bumi@pt.com", password:"client123", name:"Agus Bumi", role:"client", avatar:"AB", clientId:"RCK-B02-01", pt:"PT Bumi Cloud Nusantara", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.garuda@pt.com", password:"client123", name:"Rina Garuda", role:"client", avatar:"RG", clientId:"RCK-B11-03", pt:"PT Garuda Media Cipta", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"client.sinergi@pt.com", password:"client123", name:"Hendro Sinergi", role:"client", avatar:"HS", clientId:"RCK-C05-01", pt:"PT Sinergi Data Prima", accountType: null, allowSubAccount: 0, parentEmail: null},
    {email:"admin.reseller@global.net", password:"reseller123", name:"Admin Reseller", role:"client", avatar:"AR", clientId:"RCK-H01-01", pt:"PT Reseller Network Global", accountType:"reseller", allowSubAccount:1, parentEmail: null},
    {email:"heavy.compute@pt.com", password:"client123", name:"Heavy Compute", role:"client", avatar:"HC", clientId:"RCK-G01-01", pt:"PT Heavy Compute Indonesia", accountType: null, allowSubAccount: 0, parentEmail: null}
  ];
  const insertUser = db.prepare(`
    INSERT INTO users (
      email, password, name, role, avatar, pt, clientId, accountType, allowSubAccount, parentEmail
    ) VALUES (
      @email, @password, @name, @role, @avatar, @pt, @clientId, @accountType, @allowSubAccount, @parentEmail
    )
  `);
  for (const u of seedUsers) {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    insertUser.run({ ...u, password: hashedPassword });
  }
}

// Auto-migrate any existing plain-text passwords in SQLite database to bcrypt hashes
try {
  const existingUsers = db.prepare('SELECT email, password FROM users').all();
  const updatePassStmt = db.prepare('UPDATE users SET password = ? WHERE email = ?');
  for (const u of existingUsers) {
    if (u.password && !u.password.startsWith('$2b$') && !u.password.startsWith('$2a$')) {
      const hashed = bcrypt.hashSync(u.password, 10);
      updatePassStmt.run(hashed, u.email);
    }
  }
} catch (e) {
  console.error('Password migration error:', e);
}

module.exports = db;


