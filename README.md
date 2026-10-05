# The Little Market | Gasto publicitario 2026

Dashboard de Agencia Lima Retail para controlar la inversion publicitaria de The Little Market en Meta Ads
(Facebook e Instagram). Es una copia adaptada del tablero de Rekluta: la marca solo tiene Meta Ads como
fuente, facturada en soles.

Version actual: `v1.0.0`.

## Versionado

El proyecto usa la nomenclatura `vMAJOR.MINOR.PATCH`:

- `MAJOR`: cambios incompatibles o una nueva etapa del tablero.
- `MINOR`: nuevos modulos, indicadores o funciones compatibles.
- `PATCH`: correcciones visuales, de datos o funcionamiento.

## Modulos

- Gasto publicitario de la cuenta de Meta Ads (S/).
  - Tres tipos de campana: Ventas (compras en la tienda online), Mensajes (conversaciones de WhatsApp y
    visitas al perfil de Instagram) y Reconocimiento (ThruPlays).
  - KPIs acumulados del ano: inversion, valor de compras y ROAS, compras, conversaciones y clics.
  - Grafico mensual: inversion frente a valor de compras, compras, conversaciones y clics.
  - Por mes: resumen con la distribucion por tipo de campana, embudo de compra de la campana de Ventas
    (impresiones > clics > visitas a la web > carrito > pagos iniciados > compras) y tabla de campanas con
    sus mejores anuncios (con vista previa en Meta).
  - Avisos cuando una hoja de Drive falta o no trae dias de su mes (por ejemplo, una copia del mes anterior).
- Proyecciones: cierre estimado del mes en curso (ver abajo).
- Historico de Campanas: campanas de los meses cerrados.
- Bitacora: checklist editable de cambios, comentarios y decisiones con fecha (ver abajo).

## Datos

La fuente normalizada del dashboard es `data/tlm-ads-2026.json`, generada con `scripts/build-ads-data.py`
a partir de la carpeta `Meta files - The Little Market` de Google Drive: una hoja de calculo por mes
("The Little Market - Octubre 2026") con la exportacion Raw Data Report de Meta (una fila por dia, edad,
sexo y anuncio; importes en PEN).

- El mes de cada hoja se reconoce por el nombre ("Octubre", "The Little Market - Octubre 2026") o por el
  rango de fechas de la exportacion ("..._20261001-20261031").
- Solo cuentan las filas cuyo dia cae en el mes de la hoja. Si una hoja no trae ningun dia de su mes, el
  mes queda sin datos y el tablero lo avisa.
- Tipo de campana: si el nombre u objetivo dice "mensaje" es Mensajes; si no, se toma del objetivo
  (Ventas, Reconocimiento, Trafico...).
- "Resultados" mezcla tipos de resultado: los ThruPlay se cuentan como ThruPlays y las "Visitas al perfil
  de Instagram" como visitas al perfil. Compras, valor de compras, carrito, pagos iniciados y
  conversaciones salen de sus columnas propias.
- ROAS total = valor de compras / inversion de todas las campanas. ROAS de Ventas = lo mismo, solo con la
  campana de Ventas. Costo por compra = inversion de Ventas / compras de Ventas.
- Un mes esta cerrado si hay datos de un mes posterior o si llega al penultimo dia; si no, es parcial y su
  ultimo dia con inversion es la fecha de corte.

Para correrlo a mano:

```
pip install openpyxl
python scripts/build-ads-data.py            # usa G:/Mi unidad/.../The Little Market
python scripts/build-ads-data.py --root "<carpeta The Little Market>"
```

El script imprime por mes la inversion, las compras, el ROAS y las conversaciones, mas los avisos.

## Sincronizacion con Drive

Todo corre en GitHub, sin credenciales de Google. `.github/workflows/sync-ads-data.yml`:

1. descarga la carpeta de Drive (`scripts/drive-download.py`): las Hojas de calculo de Google se exportan
   a `.xlsx` y se guarda el ID de cada una (para el boton "Abrir hoja del mes");
2. regenera `data/tlm-ads-2026.json` (`scripts/build-ads-data.py`);
3. publica en `main`; GitHub Pages lo sirve en uno o dos minutos.

Corre de dos formas:

- **Automatica:** todos los dias a las 7:00 a. m. (hora de Lima).
- **A pedido:** boton "Sincronizar con Drive" en Gasto publicitario. Abre el workflow en GitHub para
  pulsar "Run workflow" (requiere sesion en GitHub con acceso al repositorio) y el tablero se
  actualiza solo cuando llega el nuevo JSON (2 a 4 minutos).

| Carpeta | ID de Drive |
| --- | --- |
| Meta files - The Little Market | `1lpi0wzaLuwL3MWMKBNtHBHJyDBD6p8Ie` |

La carpeta debe estar compartida como **"Cualquier persona con el enlace" > Lector**. Si el workflow falla
en "Descargar la carpeta de Drive", la carpeta o alguna hoja sigue restringida.

## Proyecciones

El modulo Proyecciones lee los datos del modulo Gasto publicitario a traves de
`window.TLMObjectives.snapshot()` y proyecta el cierre del mes en curso.

- El mes proyectado es el de la fecha de corte (`cutoff`); si no tiene datos, se usa el ultimo mes con datos.
- Ritmo diario = acumulado real / dias con pauta. Proyeccion = actual + ritmo x dias restantes del mes.
- Indicadores: inversion (total y por tipo de campana), valor de compras, compras, agregados al carrito,
  conversaciones, clics y ThruPlays.
- Costo por compra, ROAS, costo por conversacion y costo por clic se mantienen al cierre con un ritmo
  constante; se comparan con el mes anterior.
- Cada carga de datos emite el evento `tlm:data-updated` y el modulo se recalcula solo.

## Bitacora

Checklist mensual de cambios, comentarios y decisiones, agrupado por mes segun la fecha de cada item.
La fuente publicada es `data/tlm-bitacora-2026.json` (el build la incrusta en `dist/index.html`):

```json
{ "id": "b09", "date": "2026-10-01", "type": "cambio", "area": "ventas", "done": false, "text": "..." }
```

- `type`: `cambio`, `comentario` o `decision`. `area`: `general`, `ventas`, `mensajes` o `reconocimiento`.
  `done`: casilla marcada.
- En el tablero se agregan, editan, marcan y eliminan items. Las ediciones quedan como borrador en ese
  navegador (`localStorage`, clave `tlm-bitacora-draft`) y nadie mas las ve hasta publicarlas.
- Para publicar: boton **Exportar**, reemplazar `data/tlm-bitacora-2026.json` con el archivo descargado y
  hacer push. "Descartar borrador" vuelve a la version publicada.
- Los items iniciales se armaron con los cambios que muestran las exportaciones (variaciones de
  inversion por tipo de campana).

## Configuracion

| Que | Donde |
| --- | --- |
| Contrasena de acceso | `index.html`, al final (`AuthLogin.init`) |
| Logo de la barra lateral (carpa) | `assets/logo-tlm.png` |
| Logo completo | `assets/logo-tlm-completo.jpg` |
| Favicon | `assets/favicon.png` |
| Color de marca (verde agua) | `css/dashboard.css`, variables `--brand*` en `:root` |
| Fondo del login | `login-bg.jpg` en la raiz (el mismo de los demas tableros) |

La pantalla de acceso usa el azul de LR Suite, como todos los tableros de la agencia.

## Desarrollo

```
npm install
npm run dev      # live-server en el puerto 3000
npm run build    # genera dist/index.html con todo embebido
```

## Despliegue

GitHub Pages publica la raiz de la rama `main` del repositorio `jorgeluis666/objetivos-TLM` en
**https://tlm.limaretail.com/**. Cada push a `main` (incluidos los de la sincronizacion diaria con Drive)
se publica solo en unos minutos. El archivo `.nojekyll` evita que Pages procese el sitio con Jekyll.

### Dominio propio

- `CNAME` (en la raiz) contiene `tlm.limaretail.com`: le dice a GitHub Pages que sirva este repo en ese
  dominio. No borrarlo ni moverlo.
- DNS en Banahosting (cPanel > Zone Editor > `limaretail.com`): registro **CNAME** `tlm` >
  `jorgeluis666.github.io` (sin ruta: GitHub elige el repo por el archivo `CNAME`).
- GitHub: Settings > Pages > Source "Deploy from a branch", rama `main`, carpeta `/ (root)`; luego
  *Custom domain* `tlm.limaretail.com` con **Enforce HTTPS** marcado.
- Todas las rutas del sitio son relativas (`css/...`, `js/...`, `data/...`), asi que funcionan en la raiz
  del dominio sin base path.
