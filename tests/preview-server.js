// Vista previa local: sirve index.html y reemplaza el API de Google por el backend REAL
// (code_app_script.gs) corriendo contra una planilla simulada en memoria.
//   node tests/preview-server.js     →  http://localhost:5173/
// No toca Google ni Netlify. Al reiniciar el server se borran las respuestas de prueba.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { crearEntorno } = require('./gas-mock');

const PORT = process.env.PORT || 5173;
const env = crearEntorno({ evento: {
  id: 'evento2026', nombre: 'Cierre de año Dom Desarrollos', descripcion: '¡Cerramos el año juntos y compartiremos novedades!',
  fecha: new Date(2026, 11, 12), hora: '20:00', lugar: 'Montevideo, Uruguay', fecha_limite: new Date(2026, 11, 5, 23, 59), max_acompanantes: 3,
} });
// Eventos extra para ver los otros estados.
const ev = env.hojas.Eventos;
[['cerrado', 'Evento ya cerrado', 'Plazo vencido.', new Date(2026, 5, 1), '20:00', 'Montevideo', new Date(2026, 4, 1), 3, true, '#1d4ed8'],
 ['inactivo', 'Evento desactivado', '', new Date(2026, 11, 20), '19:00', 'Montevideo', new Date(2099, 0, 1), 3, false, '#b45309']]
  .forEach((fila, i) => fila.forEach((v, j) => ev.cells.set(ev._key(3 + i, j + 1), v)));

const html = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/const API_URL = '[^']*';/, "const API_URL = '/api';");

function filasTexto() {
  return env.filas().map(f => ({ evento: f.evento_id, nombre: f.nombre_apellido, asiste: f.asiste, acomp: f.acompanantes,
    total: f.total_personas, ediciones: f.ediciones, telefono: f.telefono, clave: f.clave }));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }); res.end(body); };

  if (url.pathname === '/api') {
    if (req.method === 'GET') {
      return send(200, 'application/json', env.api.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => send(200, 'application/json', env.api.doPost({ postData: { contents: body } }).getContent()));
    return;
  }
  if (url.pathname === '/filas') {            // lo que quedaría guardado en la hoja Confirmaciones
    return send(200, 'application/json', JSON.stringify(filasTexto(), null, 2));
  }
  if (url.pathname === '/' && !url.searchParams.has('e')) {
    res.writeHead(302, { Location: '/?e=evento2026' }); return res.end();
  }
  send(200, 'text/html', html());
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Vista previa:   http://localhost:${PORT}/            (evento abierto)`);
  console.log(`Evento cerrado: http://localhost:${PORT}/?e=cerrado`);
  console.log(`Inactivo:       http://localhost:${PORT}/?e=inactivo`);
  console.log(`Con datos:      http://localhost:${PORT}/?e=evento2026&n=Ana%20Rodr%C3%ADguez&t=099123456`);
  console.log(`Filas guardadas: http://localhost:${PORT}/filas`);
});
