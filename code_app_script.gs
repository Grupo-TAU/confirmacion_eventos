/**
 * RSVP – Confirmación de asistencia
 * API en Apps Script + Google Sheets. El formulario (index.html) vive en Netlify.
 *
 * Endpoints (URL /exec de la implementación):
 *   GET  ?action=evento&e=<id>  →  { ok, evento }
 *   POST  (text/plain con JSON) →  { ok, ... }  registra o actualiza una confirmación
 *
 * Hojas:
 *   Eventos         → un evento por fila (multi-evento: ?e=<id> en el link del formulario)
 *   Confirmaciones  → una fila por celular y evento (deduplicación por celular normalizado, E.164)
 *   Resumen         → totales por evento (fórmulas)
 */

const CONFIG = {
  TZ: 'America/Montevideo',
  HOJA_EVENTOS: 'Eventos',
  HOJA_CONF: 'Confirmaciones',
  HOJA_RESUMEN: 'Resumen',
  MAX_ACOMP_DEFAULT: 5,
  COLOR_DEFAULT: '#0f766e',
};

const COLS_EVENTOS = ['id', 'nombre', 'descripcion', 'fecha', 'hora', 'lugar',
  'fecha_limite', 'max_acompanantes', 'activo', 'color'];

// 'telefono' (antes 'email') va al final para no mover las columnas que ya existen.
const COLS_CONF = ['id', 'evento_id', 'nombre_apellido', 'asiste', 'acompanantes',
  'total_personas', 'creado', 'actualizado', 'clave', 'ediciones', 'telefono'];

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/** Error cuyo mensaje se le muestra tal cual al invitado. */
class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; }
}

/* ───────────────────────── Menú y setup ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RSVP')
    .addItem('Inicializar planilla', 'setup')
    .addItem('Ver links de eventos', 'mostrarLinks')
    .addToUi();
}

/** Crea hojas y encabezados, evento de ejemplo y resumen. Idempotente: se puede correr de nuevo. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());

  const ev = getOrCreateSheet_(ss, CONFIG.HOJA_EVENTOS, COLS_EVENTOS);
  ev.getRange('E:E').setNumberFormat('@');               // hora como texto
  ev.getRange('D2:D').setNumberFormat('dd/mm/yyyy');
  ev.getRange('G2:G').setNumberFormat('dd/mm/yyyy HH:mm');
  ev.getRange('I2:I').insertCheckboxes();
  if (ev.getLastRow() === 1) {
    ev.appendRow(['evento2026', 'Nombre del evento', 'Texto breve de invitación.',
      new Date(2026, 11, 12), '20:00', 'Dirección del lugar',
      new Date(2026, 11, 5, 23, 59), 3, true, CONFIG.COLOR_DEFAULT]);
  }

  const conf = getOrCreateSheet_(ss, CONFIG.HOJA_CONF, COLS_CONF);
  // Migración: el encabezado K1 pasó de 'email' a 'telefono' (si falta, getOrCreateSheet_ ya lo creó).
  const colTel = COLS_CONF.indexOf('telefono') + 1;
  const encTel = conf.getRange(1, colTel);
  if (String(encTel.getValue()).trim().toLowerCase() === 'email') {
    encTel.setValue('telefono').setFontWeight('bold');
  }
  conf.getRange('G2:H').setNumberFormat('dd/mm/yyyy HH:mm');
  conf.getRange(1, colTel, conf.getMaxRows(), 1).setNumberFormat('@');   // teléfono como texto
  conf.hideColumns(COLS_CONF.indexOf('clave') + 1);

  let res = ss.getSheetByName(CONFIG.HOJA_RESUMEN);
  if (!res) res = ss.insertSheet(CONFIG.HOJA_RESUMEN);
  res.clear();
  res.getRange('A1').setFormula(
    "=QUERY(Confirmaciones!A1:K, \"select B, count(C), sum(E), sum(F) where D = 'Sí' " +
    "group by B label B 'Evento', count(C) 'Confirmados', sum(E) 'Acompañantes', " +
    "sum(F) 'Total personas'\", 1)");
  res.getRange('F1').setFormula(
    "=QUERY(Confirmaciones!A1:K, \"select B, count(C) where D = 'No' " +
    "group by B label B 'Evento', count(C) 'No asisten'\", 1)");
  res.getRange('A1:I1').setFontWeight('bold');

  SpreadsheetApp.getActive().toast('Planilla lista. Completá la hoja Eventos.', 'RSVP', 6);
}

/**
 * Muestra los links del formulario (el de Netlify).
 * Requiere la propiedad del script SITE_URL, por ejemplo https://confirma-dom.netlify.app
 */
function mostrarLinks() {
  const base = (PropertiesService.getScriptProperties().getProperty('SITE_URL') || '').trim().replace(/\/+$/, '');
  if (!base) {
    SpreadsheetApp.getUi().alert(
      'Falta la propiedad SITE_URL.\n\nApps Script → Configuración del proyecto → Propiedades del script → ' +
      'Agregar propiedad: SITE_URL = la URL de tu sitio en Netlify (sin barra final).');
    return;
  }
  const filas = leerEventos_().map(e =>
    `<p><b>${esc_(e.nombre)}</b> (${esc_(e.id)})<br>` +
    `<input style="width:100%" onclick="this.select()" value="${esc_(base + '/?e=' + encodeURIComponent(e.id))}"></p>`
  ).join('');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(`<div style="font-family:sans-serif">${filas}</div>`).setWidth(520).setHeight(320),
    'Links de eventos');
}

/* ───────────────────────── API ───────────────────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'evento') {
      return json_({ ok: true, evento: p.e ? getEventoPublico_(String(p.e).trim()) : null });
    }
    return json_({ ok: true, servicio: 'rsvp', mensaje: 'API activa' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'No se pudo cargar el evento.' });
  }
}

function doPost(e) {
  try {
    let body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (x) {
      throw new UserError('Datos inválidos.');
    }
    return json_(registrar(body));
  } catch (err) {
    if (err instanceof UserError) return json_({ ok: false, error: err.message });
    console.error(err);
    return json_({ ok: false, error: 'No se pudo guardar. Probá de nuevo en unos segundos.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * @param {{eventoId:string, nombre:string, telefono:string, asiste:boolean, acompanantes:number, website?:string}} p
 */
function registrar(p) {
  if (!p || typeof p !== 'object') throw new UserError('Datos inválidos.');
  if (p.website) return { ok: true, actualizado: false, nombre: '', asiste: 'Sí', acompanantes: 0 }; // honeypot

  const ev = getEventoPublico_(String(p.eventoId || '').trim());
  if (!ev) throw new UserError('Evento no encontrado.');
  if (!ev.abierto) throw new UserError('La confirmación para este evento ya está cerrada.');

  const nombre = limpiarNombre_(p.nombre);
  if (nombre.length < 5 || nombre.split(' ').length < 2) {
    throw new UserError('Ingresá tu nombre y apellido.');
  }

  const telefono = normalizarTelefono_(p.telefono);
  if (telefono === '') throw new UserError('Ingresá tu celular.');
  if (telefono === null) throw new UserError('Ingresá un celular válido, por ejemplo 099 123 456.');

  const asiste = p.asiste === false ? 'No' : 'Sí';
  const acomp = asiste === 'Sí' ? Number(p.acompanantes) : 0;
  if (!Number.isInteger(acomp) || acomp < 0 || acomp > ev.maxAcomp) {
    throw new UserError(`La cantidad de acompañantes debe estar entre 0 y ${ev.maxAcomp}.`);
  }
  const total = asiste === 'Sí' ? 1 + acomp : 0;
  const clave = ev.id + '|' + telefono;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hoja_(CONFIG.HOJA_CONF);
    const ahora = new Date();
    const col = n => COLS_CONF.indexOf(n) + 1;

    let fila = null;
    if (sh.getLastRow() > 1) {
      const hit = sh.getRange(2, col('clave'), sh.getLastRow() - 1, 1)
        .createTextFinder(clave).matchEntireCell(true).findNext();
      if (hit) fila = hit.getRow();
    }

    if (fila) {
      const ediciones = Number(sh.getRange(fila, col('ediciones')).getValue()) || 0;
      sh.getRange(fila, col('nombre_apellido'), 1, 4).setValues([[nombre, asiste, acomp, total]]);
      sh.getRange(fila, col('actualizado')).setValue(ahora);
      sh.getRange(fila, col('ediciones')).setValue(ediciones + 1);
    } else {
      // El teléfono se escribe aparte, ya con formato texto: si va en appendRow,
      // Sheets convierte "+598…" en número y se pierde el "+".
      sh.appendRow([Utilities.getUuid(), ev.id, nombre, asiste, acomp, total,
        ahora, ahora, clave, 0, '']);
      sh.getRange(sh.getLastRow(), col('telefono')).setNumberFormat('@').setValue(telefono);
    }
    return { ok: true, actualizado: !!fila, nombre: nombre, asiste: asiste, acompanantes: acomp };
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── Datos ───────────────────────── */

function leerEventos_() {
  const sh = hoja_(CONFIG.HOJA_EVENTOS);
  const vals = sh.getDataRange().getValues();
  const head = vals.shift().map(String);
  return vals
    .filter(r => String(r[0]).trim())
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Devuelve solo lo que el cliente necesita ver, ya formateado. */
function getEventoPublico_(id) {
  const e = leerEventos_().find(x => String(x.id).trim() === id);
  if (!e) return null;

  let limite = e.fecha_limite instanceof Date ? new Date(e.fecha_limite) : null;
  if (limite && limite.getHours() === 0 && limite.getMinutes() === 0) {
    limite.setHours(23, 59, 59);                         // solo fecha → fin del día
  }
  const activo = e.activo === true || String(e.activo).toUpperCase() === 'TRUE';
  const max = parseInt(e.max_acompanantes, 10);

  return {
    id: String(e.id).trim(),
    nombre: String(e.nombre || ''),
    descripcion: String(e.descripcion || ''),
    fechaTxt: e.fecha instanceof Date ? fechaLarga_(e.fecha) : String(e.fecha || ''),
    hora: e.hora instanceof Date ? Utilities.formatDate(e.hora, CONFIG.TZ, 'HH:mm') : String(e.hora || ''),
    lugar: String(e.lugar || ''),
    limiteTxt: limite ? fechaLarga_(limite) : '',
    maxAcomp: Number.isInteger(max) && max >= 0 ? max : CONFIG.MAX_ACOMP_DEFAULT,
    abierto: activo && (!limite || new Date() <= limite),
    color: /^#[0-9a-f]{6}$/i.test(String(e.color).trim()) ? String(e.color).trim() : CONFIG.COLOR_DEFAULT,
  };
}

/* ───────────────────────── Utilidades ───────────────────────── */

function hoja_(nombre) {
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(nombre);
  if (!sh) throw new Error(`Falta la hoja "${nombre}". Ejecutá setup().`);
  return sh;
}

/** Crea la hoja si no existe y completa los encabezados que falten (sin tocar los que ya están). */
function getOrCreateSheet_(ss, nombre, headers) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  headers.forEach((h, i) => {
    const celda = sh.getRange(1, i + 1);
    if (!String(celda.getValue()).trim()) celda.setValue(h).setFontWeight('bold');
  });
  sh.setFrozenRows(1);
  return sh;
}

/** Solo letras, espacios, apóstrofes, puntos y guiones; capitaliza. Evita inyección de fórmulas. */
function limpiarNombre_(s) {
  return String(s || '')
    .replace(/[^\p{L}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-'.]+/, '')
    .slice(0, 80)
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());
}

/**
 * Normaliza un celular a E.164 (+598…).
 * Devuelve '' si está vacío, null si es inválido y, si no, el número como "+<dígitos>".
 * Solo se aceptan dígitos, espacios, "+", "(", ")", "." y "-"; el "+" solo al comienzo.
 */
function normalizarTelefono_(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (!/^[\d\s+().-]+$/.test(s) || s.lastIndexOf('+') > 0) return null;

  let d = s.replace(/\D/g, '');
  let internacional = s.charAt(0) === '+';
  if (!internacional && d.startsWith('00')) { d = d.slice(2); internacional = true; }

  if (internacional) {
    // "+598 099 123 456": el 0 sobrante del formato local no va con el código de país.
    if (/^5980\d{8}$/.test(d)) d = '598' + d.slice(4);
    return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null;
  }
  if (/^09\d{7}$/.test(d)) return '+598' + d.slice(1);   // 099 123 456
  if (/^9\d{7}$/.test(d)) return '+598' + d;             // 99 123 456
  if (/^598\d{8}$/.test(d)) return '+' + d;              // 598 99 123 456
  return null;                                           // sin código de país: no se puede inferir
}

function fechaLarga_(d) {
  const [y, m, day, dow] = Utilities.formatDate(d, CONFIG.TZ, 'yyyy,M,d,u').split(',').map(Number);
  return `${DIAS[dow % 7]} ${day} de ${MESES[m - 1]}`;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
