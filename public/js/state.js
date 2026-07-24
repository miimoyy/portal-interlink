const PERMISSION_MATRIX = {
  admin: { inventory_masuk: true, inventory_keluar: true, cross_connect: true, racks_edit: true, tickets_edit: true, account_management: true, sub_account: false },
  support: { inventory_masuk: true, inventory_keluar: true, cross_connect: true, racks_edit: true, tickets_edit: true, account_management: false, sub_account: false },
  client: { inventory_masuk: true, inventory_keluar: true, cross_connect: true, racks_edit: true, tickets_edit: true, account_management: false, sub_account: true },
  subclient: { inventory_masuk: true, inventory_keluar: false, cross_connect: false, racks_edit: false, tickets_edit: false, account_management: false, sub_account: false }
};

const TERMINATION_TYPE = 'Permintaan Terminate';
const TERMINATION_ACCESS_CUTOFF_DAYS = 4;

let terminationNotifications = [];
let terminationLogoutTimer = null;
const defaultClients = [];
const defaultDevices = [];
const defaultRacks = [];
const defaultTickets = [];
const defaultCrossConnects = [];
const defaultFloors = [];
let clients = [];
let devices = [];
let racks = [];
let tickets = [];
let crossConnects = [];
let floors = [];
let USERS = [];
let currentUser = null;

let currentFilter = 'all';
let currentRackFilter = 'all';
let currentRackTypeFilter = 'all';
let currentTicketTypeFilter = 'all';
let currentTicketStatusFilter = 'all';
let currentCrossConnectFilter = 'all';

let selectedClientId = null;
let selectedRackId = null;
let selectedTicketId = null;
let selectedCrossConnectId = null;

let currentDeviceTab = 'masuk';
let globalFloorFilter = 'all';

let confirmCallback = null;
let cancelCallback = null;