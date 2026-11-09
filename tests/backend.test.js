// Tests del backend (code_app_script.gs) con mocks de los servicios de Google.
// Ejecutar:  node --test tests/backend.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { crearEntorno } = require('./gas-mock');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'code_app_script.gs'), 'utf8');

const datos = (o = {}) => Object.assign({
  eventoId: 'ev1', nombre: 'ana rodriguez', telefono: '099 123 456', asiste: true, acompanantes: 1,
}, o);

const msg = fn => { try { fn(); } catch (e) { return e; } assert.fail('Se esperaba un error'); };

/* ───────── normalizarTelefono_ ───────── */

test('normalizarTelefono_: vacío', () => {
  const { api } = crearEntorno();
  for (const v of ['', '   ', null, undefined]) assert.equal(api.normalizarTelefono_(v), '');
});

test('normalizarTelefono_: inválidos', () => {
  const { api } = crearEntorno();
  for (const v of ['123', 'abc', '099-12', '09912345', '0991234567', '12345678', '99 123 45', '+12', '+598 99 123 45a',
    '099 123 456 #', '099+123456', '++59899123456', '+0123456789', '+1234567890123456', '5989912345', '598 099 123 456']) {
    assert.equal(api.normalizarTelefono_(v), null, 'debería ser inválido: ' + v);
  }
});

test('normalizarTelefono_: todos los formatos uruguayos dan el mismo valor', () => {
  const { api } = crearEntorno();
  for (const v of ['099123456', '099 123 456', '+598 99 123 456', '00598 99123456', '99123456', '+598 099 123 456',
    '(099) 123-456', '099.123.456', '598 99 123 456', '59899123456', '  +598-99-123-456 ']) {
    assert.equal(api.normalizarTelefono_(v), '+59899123456', 'formato: ' + v);
  }
});

test('normalizarTelefono_: números internacionales', () => {
  const { api } = crearEntorno();
  assert.equal(api.normalizarTelefono_('+54 9 11 2345-6789'), '+5491123456789');
  assert.equal(api.normalizarTelefono_('0054 9 11 2345 6789'), '+5491123456789');
  assert.equal(api.normalizarTelefono_('+1 (415) 555-2671'), '+14155552671');
});

/* ───────── registrar ───────── */

test('celular vacío → error', () => {
  const { api, filas } = crearEntorno();
  const e = msg(() => api.registrar(datos({ telefono: '' })));
  assert.equal(e.name, 'UserError');
  assert.equal(e.message, 'Ingresá tu celular.');
  assert.equal(msg(() => api.registrar(datos({ telefono: undefined }))).message, 'Ingresá tu celular.');
  assert.equal(filas().length, 0);
});

test('celular inválido → error', () => {
  const { api, filas } = crearEntorno();
  for (const t of ['123', 'abc', '099-12']) {
    const e = msg(() => api.registrar(datos({ telefono: t })));
    assert.equal(e.name, 'UserError');
    assert.equal(e.message, 'Ingresá un celular válido, por ejemplo 099 123 456.');
  }
  assert.equal(filas().length, 0);
});

test('un email ya no sirve como dato de contacto', () => {
  const { api } = crearEntorno();
  const e = msg(() => api.registrar(datos({ telefono: 'ana@correo.com', email: 'ana@correo.com' })));
  assert.equal(e.message, 'Ingresá un celular válido, por ejemplo 099 123 456.');
});

test('los distintos formatos generan la misma clave y actualizan la misma fila', () => {
  const { api, filas } = crearEntorno();
  const formatos = ['099123456', '099 123 456', '+598 99 123 456', '00598 99123456', '99123456', '+598 099 123 456'];
  formatos.forEach((t, i) => {
    const r = api.registrar(datos({ telefono: t, nombre: 'persona numero' + 'abcdef'[i] }));
    assert.equal(r.ok, true);
    assert.equal(r.actualizado, i > 0, 'actualizado en envío ' + i);
  });
  const f = filas();
  assert.equal(f.length, 1);
  assert.equal(f[0].clave, 'ev1|+59899123456');
  assert.equal(f[0].telefono, '+59899123456');
  assert.equal(f[0].ediciones, formatos.length - 1);
});

test('reenvío con otro formato y otro nombre actualiza la fila (ediciones = 1)', () => {
  const { api, filas } = crearEntorno();
  api.registrar(datos({ telefono: '099 123 456', nombre: 'Ana Rodriguez', acompanantes: 1 }));
  const r = api.registrar(datos({ telefono: '+598 99 123 456', nombre: 'Ana María Rodríguez', acompanantes: 2 }));
  assert.equal(r.actualizado, true);
  const f = filas();
  assert.equal(f.length, 1);
  assert.equal(f[0].ediciones, 1);
  assert.equal(f[0].nombre_apellido, 'Ana María Rodríguez');
  assert.equal(f[0].acompanantes, 2);
  assert.equal(f[0].total_personas, 3);
});

test('mismo nombre con otro celular crea otra fila', () => {
  const { api, filas } = crearEntorno();
  api.registrar(datos({ telefono: '099 123 456' }));
  const r = api.registrar(datos({ telefono: '098 765 432' }));
  assert.equal(r.actualizado, false);
  const f = filas();
  assert.equal(f.length, 2);
  assert.notEqual(f[0].clave, f[1].clave);
  assert.equal(f[1].telefono, '+59898765432');
});

test('el mismo celular en otro evento es otra fila', () => {
  const { api, filas, hojas } = crearEntorno();
  const ev = hojas.Eventos;
  ['ev2', 'Otro', '', new Date(2030, 0, 11), '20:00', 'Y', new Date(2099, 0, 1), 3, true, '#0f766e']
    .forEach((v, i) => ev.cells.set(ev._key(3, i + 1), v));
  api.registrar(datos());
  api.registrar(datos({ eventoId: 'ev2' }));
  assert.equal(filas().length, 2);
});

test('asiste = false → total 0 y acompañantes 0', () => {
  const { api, filas } = crearEntorno();
  const r = api.registrar(datos({ asiste: false, acompanantes: 3 }));
  assert.equal(r.asiste, 'No');
  assert.equal(r.acompanantes, 0);
  const f = filas()[0];
  assert.equal(f.asiste, 'No');
  assert.equal(f.acompanantes, 0);
  assert.equal(f.total_personas, 0);
});

test('acompañantes fuera de rango', () => {
  const { api, filas } = crearEntorno();
  for (const a of [-1, 4, 1.5, 'x', undefined]) {
    const e = msg(() => api.registrar(datos({ acompanantes: a })));
    assert.equal(e.message, 'La cantidad de acompañantes debe estar entre 0 y 3.');
  }
  assert.equal(filas().length, 0);
});

test('evento cerrado, inactivo e inexistente', () => {
  let env = crearEntorno({ evento: { activo: false } });
  assert.equal(msg(() => env.api.registrar(datos())).message, 'La confirmación para este evento ya está cerrada.');
  env = crearEntorno({ evento: { fecha_limite: new Date(2000, 0, 1, 12, 0) } });
  assert.equal(msg(() => env.api.registrar(datos())).message, 'La confirmación para este evento ya está cerrada.');
  env = crearEntorno();
  assert.equal(msg(() => env.api.registrar(datos({ eventoId: 'nada' }))).message, 'Evento no encontrado.');
  assert.equal(env.filas().length, 0);
});

test('honeypot: responde ok y no escribe', () => {
  const { api, filas } = crearEntorno();
  const r = api.registrar(datos({ website: 'http://spam' }));
  assert.equal(r.ok, true);
  assert.equal(filas().length, 0);
});

test('nombre con fórmula se sanitiza', () => {
  const { api, filas } = crearEntorno();
  api.registrar(datos({ nombre: '=HYPERLINK("http://malo.com","Click") Perez' }));
  const n = filas()[0].nombre_apellido;
  assert.doesNotMatch(n, /[=()",:\/]/);
  assert.doesNotMatch(n, /^[=+\-@]/);
  assert.equal(msg(() => api.registrar(datos({ nombre: '=1+1' }))).message, 'Ingresá tu nombre y apellido.');
});

test('el teléfono se guarda como texto con formato "@"', () => {
  const { api, conf, col, filas } = crearEntorno();
  conf.formats.clear();   // planilla sin formato previo: el código debe fijar el formato texto por sí mismo
  api.registrar(datos());
  const celda = conf.getRange(2, col('telefono'));
  assert.equal(typeof celda.getValue(), 'string');
  assert.equal(celda.getValue(), '+59899123456');
  assert.equal(celda.getNumberFormat(), '@');
  assert.equal(typeof filas()[0].clave, 'string');
});

test('usa el lock en cada registro y lo libera', () => {
  const { api, lockLog } = crearEntorno();
  api.registrar(datos());
  api.registrar(datos({ telefono: '098 000 111' }));
  assert.equal(lockLog.waits, 2);
  assert.equal(lockLog.releases, 2);
  assert.throws(() => api.registrar(datos({ acompanantes: 99 })));
  assert.equal(lockLog.waits, lockLog.releases);
});

test('el lock se libera aunque falle la escritura', () => {
  const env = crearEntorno();
  env.conf.appendRow = () => { throw new Error('boom'); };
  assert.throws(() => env.api.registrar(datos()), /boom/);
  assert.equal(env.lockLog.waits, env.lockLog.releases);
});

/* ───────── doPost / doGet ───────── */

test('doPost: JSON válido, errores de usuario y errores inesperados', () => {
  const env = crearEntorno();
  const post = o => JSON.parse(env.api.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).getContent());

  assert.deepEqual(post(datos()), { ok: true, actualizado: false, nombre: 'Ana Rodriguez', asiste: 'Sí', acompanantes: 1 });
  assert.deepEqual(post(datos({ telefono: '' })), { ok: false, error: 'Ingresá tu celular.' });
  assert.deepEqual(post('no es json'), { ok: false, error: 'Datos inválidos.' });

  env.conf.appendRow = () => { throw new Error('detalle interno secreto'); };
  const r = post(datos({ telefono: '098 000 111' }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'No se pudo guardar. Probá de nuevo en unos segundos.');
  assert.doesNotMatch(JSON.stringify(r), /secreto/);
});

test('doGet: devuelve el evento', () => {
  const env = crearEntorno();
  const r = JSON.parse(env.api.doGet({ parameter: { action: 'evento', e: 'ev1' } }).getContent());
  assert.equal(r.ok, true);
  assert.equal(r.evento.id, 'ev1');
  assert.equal(r.evento.abierto, true);
  assert.equal(JSON.parse(env.api.doGet({ parameter: { action: 'evento', e: 'zzz' } }).getContent()).evento, null);
});

/* ───────── setup ───────── */

test('setup: encabezado K1 nuevo es "telefono", sin "email" en el código', () => {
  const { conf, api } = crearEntorno();
  assert.equal(api.COLS_CONF[10], 'telefono');
  assert.equal(conf._get(1, 11), 'telefono');
  assert.doesNotMatch(SRC.replace(/\/\/.*$/gm, '').replace(/'email'/g, ''), /email/i);
});

test('setup: renombra K1 "email" → "telefono" sin tocar datos y es idempotente', () => {
  const env = crearEntorno();
  const { conf } = env;
  conf.cells.set(conf._key(1, 11), 'email');                       // planilla vieja
  conf.appendRow(['id-viejo', 'ev1', 'Juan Perez', 'Sí', 0, 1, new Date(), new Date(), 'ev1|juan@x.com', 0, 'juan@x.com']);
  const antes = JSON.stringify([...conf.cells.entries()].filter(([k]) => k !== '1,11'));
  env.api.setup();
  assert.equal(conf._get(1, 11), 'telefono');
  env.api.setup();
  assert.equal(conf._get(1, 11), 'telefono');
  const despues = JSON.stringify([...conf.cells.entries()].filter(([k]) => k !== '1,11'));
  assert.equal(despues, antes, 'los datos no deben cambiar');
  assert.equal(conf.colFormats[11], '@', 'columna telefono con formato texto');
  assert.deepEqual(conf.hidden, [9, 9, 9]);                        // clave oculta (una vez por setup)
});

test('setup: crea K1 si falta', () => {
  const env = crearEntorno();
  env.conf.cells.delete('1,11');
  env.api.setup();
  assert.equal(env.conf._get(1, 11), 'telefono');
});

test('filas viejas con clave evento|email no coinciden con las claves nuevas', () => {
  const { api, conf, filas } = crearEntorno();
  conf.appendRow(['viejo', 'ev1', 'Juan Perez', 'Sí', 0, 1, new Date(), new Date(), 'ev1|juan@x.com', 0, 'juan@x.com']);
  const r = api.registrar(datos());
  assert.equal(r.actualizado, false);
  assert.equal(filas().length, 2);
});
