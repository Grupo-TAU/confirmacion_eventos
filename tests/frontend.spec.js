// Tests del formulario (index.html) con Playwright. El API se intercepta: no sale nada a Google.
const { test, expect } = require('@playwright/test');

const EVENTO = {
  id: 'ev1', nombre: 'Fiesta de fin de año', descripcion: 'Texto', fechaTxt: 'sábado 12 de diciembre', hora: '20:00',
  lugar: 'Montevideo', limiteTxt: 'sábado 5 de diciembre', maxAcomp: 3, abierto: true, color: '#0f766e',
};
const CORS = { 'access-control-allow-origin': '*' };

/** Intercepta el API. Devuelve { posts } con los bodies POST ya parseados. */
async function mockApi(page, { respuestaPost } = {}) {
  const posts = [];
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, evento: EVENTO }) });
    }
    const body = JSON.parse(req.postData() || '{}');
    posts.push(body);
    const r = respuestaPost ? respuestaPost(body)
      : { ok: true, actualizado: false, nombre: body.nombre, asiste: body.asiste ? 'Sí' : 'No', acompanantes: body.acompanantes };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(r) });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());   // sin red externa
  return { posts };
}

const errores = new WeakMap();
test.beforeEach(async ({ page }) => {
  const lista = [];
  errores.set(page, lista);
  page.on('pageerror', e => lista.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)|ERR_FAILED|Failed to load resource/.test(m.text() + (m.location().url || ''))) return;   // fuentes bloqueadas a propósito
    lista.push('console.error: ' + m.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(errores.get(page), 'errores de JavaScript en consola').toEqual([]);
});

async function abrir(page, query = '', opts) {
  const api = await mockApi(page, opts);
  await page.goto('/?e=ev1' + query);
  await expect(page.locator('#form')).toBeVisible();
  return api;
}
const llenarNombre = page => page.fill('#nombre', 'Ana Rodríguez');

test('el campo es un celular (type=tel) y ya no hay email', async ({ page }) => {
  await abrir(page);
  const tel = page.locator('#telefono');
  await expect(tel).toHaveAttribute('type', 'tel');
  await expect(tel).toHaveAttribute('autocomplete', 'tel');
  await expect(tel).toHaveAttribute('inputmode', 'tel');
  await expect(tel).toHaveAttribute('placeholder', '099 123 456');
  await expect(tel).toHaveAttribute('maxlength', '25');
  await expect(tel).toHaveAttribute('required', '');
  await expect(page.locator('label[for=telefono]')).toHaveText('Celular');
  await expect(page.locator('.hint').first()).toHaveText(
    'Lo usamos solo para este evento y para identificar tu respuesta. Si necesitás cambiarla, volvé a entrar con el mismo celular.');
  await expect(page.locator('input[type=email], #email')).toHaveCount(0);
  expect(await page.content()).not.toMatch(/email/i);
});

test('el input tel tiene el mismo estilo que el de texto (y :focus)', async ({ page }) => {
  await abrir(page);
  const css = sel => page.locator(sel).evaluate(el => {
    const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderTopStyle, s.borderRadius, s.padding, s.fontSize, s.width].join('|');
  });
  expect(await css('#telefono')).toBe(await css('#nombre'));
  await page.locator('#telefono').focus();
  const focusTel = await page.locator('#telefono').evaluate(el => getComputedStyle(el).boxShadow);
  await page.locator('#nombre').focus();
  const focusTxt = await page.locator('#nombre').evaluate(el => getComputedStyle(el).boxShadow);
  expect(focusTel).toBe(focusTxt);
  expect(focusTel).not.toBe('none');
});

test('celular vacío: error, marca el campo, lo enfoca y no envía', async ({ page }) => {
  const { posts } = await abrir(page);
  await llenarNombre(page);
  await page.click('#enviar');
  await expect(page.locator('#err')).toHaveText('Ingresá tu celular.');
  await expect(page.locator('#telefono')).toHaveClass(/bad/);
  await expect(page.locator('#telefono')).toBeFocused();
  expect(posts).toHaveLength(0);
  await page.fill('#telefono', '0');            // al escribir se limpia el error
  await expect(page.locator('#telefono')).not.toHaveClass(/bad/);
  await expect(page.locator('#err')).toHaveText('');
});

for (const malo of ['123', 'abc', '099-12', '1234567890123456', '   ']) {
  test(`celular inválido (${JSON.stringify(malo)}): error y no envía`, async ({ page }) => {
    const { posts } = await abrir(page);
    await llenarNombre(page);
    await page.fill('#telefono', malo);
    await page.click('#enviar');
    const esperado = malo.trim() === '' ? 'Ingresá tu celular.' : 'Ingresá un celular válido, por ejemplo 099 123 456.';
    await expect(page.locator('#err')).toHaveText(esperado);
    await expect(page.locator('#telefono')).toHaveClass(/bad/);
    await expect(page.locator('#telefono')).toBeFocused();
    expect(posts).toHaveLength(0);
  });
}

test('celular válido: envía "telefono" y no "email"', async ({ page }) => {
  const { posts } = await abrir(page);
  await llenarNombre(page);
  await page.fill('#telefono', '099 123 456');
  await page.click('#mas');
  await page.click('#enviar');
  await expect(page.locator('#v-ok')).toBeVisible();
  await expect(page.locator('#ok-titulo')).toHaveText('¡Gracias, Ana!');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toEqual({ eventoId: 'ev1', nombre: 'Ana Rodríguez', telefono: '099 123 456', asiste: true, acompanantes: 1, website: '' });
  expect(Object.keys(posts[0])).not.toContain('email');
  const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('rsvp:ev1')));
  expect(guardado).toEqual({ nombre: 'Ana Rodríguez', telefono: '099 123 456' });
});

test('formatos internacionales pasan la validación del cliente', async ({ page }) => {
  const { posts } = await abrir(page);
  await llenarNombre(page);
  await page.fill('#telefono', '+598 99 123 456');
  await page.click('#enviar');
  await expect(page.locator('#v-ok')).toBeVisible();
  expect(posts[0].telefono).toBe('+598 99 123 456');   // el servidor normaliza
});

test('error del servidor se muestra y el botón se rehabilita', async ({ page }) => {
  await abrir(page, '', { respuestaPost: () => ({ ok: false, error: 'Ingresá un celular válido, por ejemplo 099 123 456.' }) });
  await llenarNombre(page);
  await page.fill('#telefono', '12345678');
  await page.click('#enviar');
  await expect(page.locator('#err')).toHaveText('Ingresá un celular válido, por ejemplo 099 123 456.');
  await expect(page.locator('#enviar')).toBeEnabled();
});

test('"No puedo ir" también exige celular', async ({ page }) => {
  const { posts } = await abrir(page);
  await llenarNombre(page);
  await page.click('#no');
  await page.click('#enviar');
  await expect(page.locator('#err')).toHaveText('Ingresá tu celular.');
  await page.fill('#telefono', '099123456');
  await page.click('#enviar');
  await expect(page.locator('#ok-titulo')).toHaveText('Gracias por avisar, Ana');
  expect(posts[0].asiste).toBe(false);
  expect(posts[0].telefono).toBe('099123456');
});

test('precarga por ?n= y ?t=', async ({ page }) => {
  await abrir(page, '&n=Luis%20P%C3%A9rez&t=099%20111%20222');
  await expect(page.locator('#nombre')).toHaveValue('Luis Pérez');
  await expect(page.locator('#telefono')).toHaveValue('099 111 222');
});

test('precarga desde localStorage (rsvp:<id>)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rsvp:ev1', JSON.stringify({ nombre: 'María Gómez', telefono: '098 333 444' })));
  await abrir(page);
  await expect(page.locator('#nombre')).toHaveValue('María Gómez');
  await expect(page.locator('#telefono')).toHaveValue('098 333 444');
});

test('la URL tiene prioridad sobre localStorage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rsvp:ev1', JSON.stringify({ nombre: 'María Gómez', telefono: '098 333 444' })));
  await abrir(page, '&t=099%20999%20888');
  await expect(page.locator('#telefono')).toHaveValue('099 999 888');
  await expect(page.locator('#nombre')).toHaveValue('María Gómez');
});

test('?m= ya no precarga nada y un "email" viejo en localStorage se ignora', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rsvp:ev1', JSON.stringify({ nombre: 'Ana Pérez', email: 'ana@correo.com' })));
  await abrir(page, '&m=ana%40correo.com');
  await expect(page.locator('#telefono')).toHaveValue('');
  await expect(page.locator('#nombre')).toHaveValue('Ana Pérez');
});

test('el celular precargado se limita a 25 caracteres', async ({ page }) => {
  await abrir(page, '&t=' + '1'.repeat(40));
  expect((await page.locator('#telefono').inputValue()).length).toBe(25);
});

test('evento cerrado: no muestra formulario', async ({ page }) => {
  await page.route(/script\.google\.com/, route => route.fulfill({
    status: 200, contentType: 'application/json', headers: CORS,
    body: JSON.stringify({ ok: true, evento: { ...EVENTO, abierto: false } }),
  }));
  await page.route(/fonts\./, route => route.abort());
  await page.goto('/?e=ev1');
  await expect(page.locator('#v-cerrado')).toBeVisible();
  await expect(page.locator('#form')).toBeHidden();
});
