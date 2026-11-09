// Servidor estático mínimo solo para los tests: sirve index.html en http://localhost:4173/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'site', 'index.html');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}).listen(4173, '127.0.0.1', () => console.log('http://localhost:4173'));
