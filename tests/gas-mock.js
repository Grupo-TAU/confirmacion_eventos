// Mocks de Google Apps Script/Sheets: los usan los tests del backend y la vista previa local.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'code_app_script.gs'), 'utf8');

/* ───────── Mocks ───────── */

class MockSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();     // "r,c" -> valor
    this.formats = new Map();   // "r,c" -> formato
    this.hidden = [];
    this.maxRows = 1000;
  }
  _key(r, c) { return r + ',' + c; }
  _get(r, c) { const v = this.cells.get(this._key(r, c)); return v === undefined ? '' : v; }
  _set(r, c, v) {
    // Simula Sheets: sin formato texto, "+59899123456" o "59899123456" se vuelve número.
    if (typeof v === 'string' && this.formats.get(this._key(r, c)) !== '@' && /^\+?\d+$/.test(v)) v = Number(v);
    this.cells.set(this._key(r, c), v);
  }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  setFrozenRows() {}
  clear() {}
  hideColumns(c) { this.hidden.push(c); }
  appendRow(arr) {
    const r = this.getLastRow() + 1;
    arr.forEach((v, i) => this._set(r, i + 1, v));
  }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {                       // notación A1 mínima: "E:E", "G2:H", "I2:I", "A1"
      const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
      const col = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const c1 = col(m[1]), r1 = +m[2] || 1, c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? +m[4] : (m[3] ? this.maxRows : r1);
      return new MockRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new MockRange(this, a, b, c || 1, d || 1);
  }
}

class MockRange {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getRow() { return this.r; }
  getValue() { return this.sh._get(this.r, this.c); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sh._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValue(v) { this.sh._set(this.r, this.c, v); return this; }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => this.sh._set(this.r + i, this.c + j, v))); return this; }
  setNumberFormat(f) {
    const limite = Math.min(this.nr, 50);              // basta para los tests (evita iterar 1000 filas)
    for (let i = 0; i < limite; i++) for (let j = 0; j < this.nc; j++) this.sh.formats.set(this.sh._key(this.r + i, this.c + j), f);
    this.sh.colFormats = this.sh.colFormats || {};
    for (let j = 0; j < this.nc; j++) this.sh.colFormats[this.c + j] = f;
    return this;
  }
  setFontWeight() { return this; }
  insertCheckboxes() { return this; }
  setFormula() { return this; }
  getNumberFormat() { return this.sh.formats.get(this.sh._key(this.r, this.c)) || ''; }
  createTextFinder(text) {
    const self = this;
    let entire = false;
    return {
      matchEntireCell(b) { entire = b; return this; },
      findNext() {
        for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) {
          const v = String(self.sh._get(self.r + i, self.c + j));
          if (entire ? v === text : v.includes(text)) return new MockRange(self.sh, self.r + i, self.c + j, 1, 1);
        }
        return null;
      },
    };
  }
}

function crearEntorno({ evento } = {}) {
  const hojas = {};
  const ss = {
    getId: () => 'SS1',
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = new MockSheet(n)),
  };
  const props = {};
  const lockLog = { waits: 0, releases: 0 };

  const sandbox = {
    console, Date,   // misma clase Date que los tests (instanceof entre realms)
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      getActive: () => ({ toast() {} }),
      getUi: () => ({}),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { lockLog.waits++; }, releaseLock() { lockLog.releases++; } }) },
    Utilities: {
      getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })(),
      formatDate: (d, tz, fmt) => {
        if (fmt === 'HH:mm') return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getDay() || 7].join(',');
      },
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;globalThis.__api = { setup, registrar, doPost, doGet, normalizarTelefono_, limpiarNombre_, COLS_CONF, UserError };', sandbox);
  const api = sandbox.__api;

  api.setup();
  const ev = hojas.Eventos;
  // Reemplaza el evento de ejemplo por uno controlado por el test.
  const base = Object.assign({
    id: 'ev1', nombre: 'Fiesta', descripcion: '', fecha: new Date(2030, 0, 10), hora: '20:00', lugar: 'X',
    fecha_limite: new Date(2099, 0, 1, 23, 59), max_acompanantes: 3, activo: true, color: '#0f766e',
  }, evento);
  ['id', 'nombre', 'descripcion', 'fecha', 'hora', 'lugar', 'fecha_limite', 'max_acompanantes', 'activo', 'color']
    .forEach((k, i) => ev.cells.set(ev._key(2, i + 1), base[k]));

  const conf = hojas.Confirmaciones;
  const col = n => api.COLS_CONF.indexOf(n) + 1;
  const filas = () => {
    const out = [];
    for (let r = 2; r <= conf.getLastRow(); r++) out.push(Object.fromEntries(api.COLS_CONF.map(c => [c, conf._get(r, col(c))])));
    return out;
  };
  return { api, hojas, conf, col, filas, lockLog, sandbox };
}

module.exports = { crearEntorno, MockSheet, MockRange };
