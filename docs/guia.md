# Guía de la app de confirmación de asistencia (RSVP)

Formulario estático (`index.html`, publicado en Netlify) + API en Google Apps Script (`code_app_script.gs`, que se pega como `Code.gs`) que guarda en Google Sheets.

## Cómo identificamos a cada invitado: el celular

El **celular reemplaza al email**. Es obligatorio y es la clave para no duplicar respuestas.

- El formulario pide **nombre y apellido**, **celular**, si asiste y cuántos acompañantes.
- El servidor **normaliza** el celular a formato internacional (E.164, por ejemplo `+59899123456`), así que da lo mismo cómo lo escriba la persona. Todas estas variantes son el mismo celular:

  | Lo que escribe | Se guarda |
  |---|---|
  | `099123456`, `099 123 456`, `(099) 123-456` | `+59899123456` |
  | `99 123 456` | `+59899123456` |
  | `+598 99 123 456`, `598 99 123 456` | `+59899123456` |
  | `00598 99123456` | `+59899123456` |
  | `+598 099 123 456` (con el 0 sobrante) | `+59899123456` |

- Se aceptan números de otros países solo con `+` o `00` adelante (8 a 15 dígitos). Un número sin código de país que no sea uruguayo se rechaza, porque no se puede saber de qué país es.
- **Deduplicación**: la clave es `evento_id|celular normalizado` (columna oculta `clave`). Si alguien responde de nuevo con el mismo celular —aunque lo escriba distinto o cambie el nombre— se **actualiza su fila** (nombre, asistencia, acompañantes, total, fecha de actualización) y se suma 1 a `ediciones`. No se crea otra fila.
- El mismo celular en **otro evento** es otra fila (la clave incluye el evento).

## Hoja `Confirmaciones`

| Col | Encabezado | Contenido |
|---|---|---|
| A–J | `id`, `evento_id`, `nombre_apellido`, `asiste`, `acompanantes`, `total_personas`, `creado`, `actualizado`, `clave` (oculta), `ediciones` | igual que antes |
| K | `telefono` | celular normalizado, guardado como **texto** (si no, Sheets se comería el `+`) |

La hoja `Resumen` no usa la columna K: sus fórmulas solo leen las columnas B a F.

## Actualizar una planilla que ya existía (paso a paso)

1. Abrí la planilla → **Extensiones → Apps Script** y reemplazá el contenido de `Code.gs` por el de `code_app_script.gs`. Guardá.
2. Ejecutá **`setup()`** (menú *RSVP → Inicializar planilla*, o el botón Ejecutar). Es seguro correrlo las veces que haga falta: **no toca datos**. Hace dos cosas con la columna K:
   - si el encabezado de **K1** dice `email`, lo renombra a `telefono`; si falta, lo crea;
   - le da formato de texto a toda la columna.
3. **Borrá las filas de prueba** de `Confirmaciones`. Esas filas tienen emails en la columna del teléfono y una clave `evento|email` que ya no coincide con ninguna clave nueva (no se rompe nada, pero ensucian los totales).
4. **Implementar → Administrar implementaciones →** lápiz de la implementación existente **→ Versión: Nueva versión → Implementar**. No crees una implementación nueva: cambiaría la URL `/exec` y habría que tocar `API_URL` en `index.html`.

## Links prellenados

Se puede mandar el link ya con los datos de cada invitado (útil para WhatsApp):

```
https://<tu-sitio>.netlify.app/?e=<id-del-evento>&n=Ana%20Rodr%C3%ADguez&t=099123456
```

- `e` = id del evento (hoja `Eventos`), `n` = nombre, **`t` = celular**.
- Si la persona ya había respondido desde ese mismo navegador, el formulario recuerda nombre y celular (se guardan en el propio navegador, clave `rsvp:<id>`). El link tiene prioridad sobre lo recordado.
- `?m=` (el email) **ya no existe**: se ignora.

## Problemas frecuentes

| Problema | Qué pasa / qué hacer |
|---|---|
| "Ingresá tu celular." | Dejó el campo vacío. Es obligatorio para todos. |
| **"Ingresá un celular válido, por ejemplo 099 123 456."** | El número no se pudo interpretar. Aceptamos celulares uruguayos (`099 123 456`, `99 123 456`, `+598 99 123 456`) y números internacionales **con `+` o `00`** delante. Caracteres permitidos: dígitos, espacios, `+`, `( ) . -`. Pedirle que lo escriba con el formato `099 123 456`. |
| Alguien respondió dos veces y aparece una sola fila | Es lo esperado: mismo celular = misma fila actualizada (ver `ediciones`). |
| Alguien quiere cambiar su respuesta | Que vuelva a entrar al link y use **el mismo celular**. |
| Alguien cambió de celular y respondió de nuevo | Para el sistema es otra persona: quedan dos filas. Borrá la vieja a mano. |
| En la columna K se ve un número raro o sin `+` | La columna perdió el formato texto. Corré `setup()`. |
| Filas viejas con email | Quedan tal cual (con su email en K). No se actualizan: si esa persona responde, se crea una fila nueva. Borrá las viejas. |

## Cosas a tener en cuenta

- **El celular no se verifica.** No mandamos ningún código: alguien podría escribir el celular de otra persona y pisar o crear su respuesta. Para una invitación por WhatsApp a un evento es un riesgo aceptado; si hay una respuesta sospechosa, se ve en la planilla (nombre y fechas) y se corrige a mano.
- **Cada persona confirma con su propio celular.** Si una pareja responde por separado y cada uno suma al otro como acompañante, **se cuenta doble** (dos filas, cada una con su acompañante). Pedir que responda uno solo por los dos, o revisar la hoja antes de pasar números a catering.
- Los celulares son datos personales: no compartas la planilla más de lo necesario.

## Pruebas automáticas

Están en `tests/` (no se publican como parte del sitio ni hace falta correrlas en Netlify).

```bash
node --test tests/backend.test.js        # backend con mocks de Google (no necesita instalar nada)
cd tests && npm install && npx playwright test   # frontend con Playwright (API interceptada)
```

Si Playwright pide un Chromium que no tenés, el config usa el que ya esté en `%LOCALAPPDATA%\ms-playwright` o el indicado en la variable `CHROMIUM_PATH`.

## Publicar en Netlify (plan gratis)

Cada push a la rama principal es un deploy a producción y gasta **15 de los 300 créditos mensuales**. Trabajá en una rama aparte, probá todo en local y hacé **un solo merge** a la principal.
