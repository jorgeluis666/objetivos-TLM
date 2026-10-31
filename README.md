# The Little Market | Gasto publicitario 2026

Dashboard de Agencia Lima Retail para controlar la inversion publicitaria de The Little Market en Meta Ads
(Facebook e Instagram). Es una copia adaptada del tablero de Rekluta: la marca solo tiene Meta Ads como
fuente, facturada en soles.

Version actual: `v1.7.0`.

## Versionado

El proyecto usa la nomenclatura `vMAJOR.MINOR.PATCH`:

- `MAJOR`: cambios incompatibles o una nueva etapa del tablero.
- `MINOR`: nuevos modulos, indicadores o funciones compatibles.
- `PATCH`: correcciones visuales, de datos o funcionamiento.

Convenciones de pantalla (desde la v1.4.1, alineadas con Royal Baby): soles como `S/. 1,234.56` (los datos sincronizados siguen trayendo `symbol: "S/"` y el tablero lo muestra con punto), un dato vacio como `—` (raya), meses "Septiembre"/"Sep", tildes y eñes en todos los textos ("Campaña"), pestaña del mes activa en los tonos verde azulado de la marca y tablas con numeros monoespaciados a la derecha. Al cambiar un archivo se sube su `?v=` en `index.html` a la version nueva.

Barra superior (desde la v1.5.0, como Royal Baby): queda fija al hacer scroll, translucida (blanco al 88 % con
desenfoque). A la izquierda, el boton para minimizar el panel, el titulo de la vista y como bajada la misma
descripcion del modulo que muestra el panel lateral. A la derecha, la pildora de sincronizacion
("Sincronizado · hace 2 h" en verde; "Recargando…" en ambar con el punto latiendo mientras corre Actualizar;
ambar si hay avisos de la carpeta de Drive o mas de un dia sin sincronizar; rojo si no se pudo cargar o lanzar la
sincronizacion). Desde la v1.6.0 tambien se pone ambar cuando el corte de los datos lleva mas de dos dias atras, y
entonces dice «Datos al 26 de octubre» en lugar de «Sincronizado»: sincronizar y traer datos nuevos no son lo mismo,
y la carpeta de Drive puede llevar dias parada con el barrido en verde. El detalle lo repite («Meta Ads al 26 de
octubre (hace 4 dias)»). La pildora abre el detalle (datos, ultima y proxima sincronizacion, hoja del mes, fuente y avisos), y
el boton fantasma "Actualizar" con icono de recarga (mismo `id="ads-sync-btn"` y misma funcion de siempre).

## Modulos

- Gasto publicitario de la cuenta de Meta Ads (S/.).
  - Tres tipos de campana: Ventas (compras en la tienda online), Mensajes (conversaciones de WhatsApp y
    visitas al perfil de Instagram) y Reconocimiento (ThruPlays).
  - KPIs del periodo: inversion, valor de compras y ROAS, compras, conversaciones y clics. Desde la v1.5.0 cada
    KPI lleva su variacion contra el mes anterior como en Royal Baby ("▲ 12.3% vs 1-18 Septiembre"): verde si
    mejora, rojo si empeora y gris en la inversion, que es neutra. Un mes cerrado se compara contra el mes
    anterior completo; el mes en curso, contra el mismo tramo del mes anterior (del 1 al ultimo dia con datos)
    sacado de `data/tlm-ads-daily.json`. Cada suma usa el informe por dia solo si ese informe da en el mes
    anterior el mismo total que su hoja mensual (julio, por ejemplo, empieza el 6); si no, se compara contra el
    mes anterior prorrateado a los mismos dias ("vs Sep prorrateado"). Sin mes anterior con datos (enero, o marzo
    porque febrero no tiene hoja valida) la tarjeta dice "Sin mes anterior para comparar". En Anual va el
    promedio por mes ("Prom. mensual"), sin contar el mes en curso mientras haya meses cerrados.
  - Linea del periodo: "Periodo: 1-18 Octubre 2026 (mes en curso)" (Anual: "Periodo: 1 Enero - 18 Octubre
    2026 (año en curso)"), debajo "Comparación vs 1-18 Septiembre" y la fuente (hoja del mes, dias con pauta,
    campanas y si la comparacion sale del informe por dia).
  - Grafico mensual: inversion frente a valor de compras, compras, conversaciones, clics, costo por compra
    (inversion de la campana de Ventas / compras) y costo por conversacion (inversion de la campana de
    Mensajes / conversaciones), los mismos costos de los KPIs; un mes sin compras o sin conversaciones queda
    como hueco. Cada punto lleva su valor: arriba en un pico, abajo en un valle, con halo blanco y dentro del
    grafico; sin etiqueta en los ceros y omitida si choca con otra (queda en el tooltip). Los soles van sin
    decimales salvo montos menores a S/. 10.
  - Por mes: resumen con la distribucion por tipo de campana, embudo de compra de la campana de Ventas
    (impresiones > clics > visitas a la web > carrito > pagos iniciados > compras) y tabla de campanas con
    sus mejores anuncios (con vista previa en Meta). La tabla cierra con la fila "Total del periodo" de las
    campanas a la vista (respeta el filtro de tipo): las sumas salen de las campanas y CPM, costo por clic y
    ROAS se recalculan sobre esas sumas; el resultado principal solo se suma si todas son del mismo tipo.
  - Avisos cuando una hoja de Drive falta o no trae dias de su mes (por ejemplo, una copia del mes anterior).
- Anuncios (desde la v1.7.0, con la estructura del tablero de Terminal Pesquero): Meta Ads anuncio por
  anuncio, justo despues de Gasto publicitario y compartiendo el mes con el: cambiarlo en una vista lo
  cambia en la otra, en los dos sentidos.
  - Pestanas de mes y Anual. En Anual las cifras de un anuncio se suman entre meses y no hay comparacion.
  - Mejor anuncio de cada tipo de campana, una tarjeta por tipo. No hay un Top 3 unico a proposito: el
    resultado de una pieza de Ventas son compras, el de una de Mensajes conversaciones y el de una de
    Reconocimiento ThruPlays, y rankearlos juntos compararia cosas distintas.
  - Tabla de anuncios con 17 columnas: tipo, anuncio (con enlace a la vista previa y estrella en el lider
    de su tipo), campana y conjunto, tipo de resultado, resultados, los del mes anterior, variacion, costo
    por resultado, inversion, compras, valor de compras, ROAS, impresiones, alcance, CPM, clics y dias
    activos. Filtro por tipo de campana, densidad compacta recordada en `localStorage` y pantalla completa
    (`Esc` sale). Las columnas **Tipo y Anuncio van ancladas** y la cabecera tambien: diecisiete columnas
    piden unos 2.050 px y no caben en ninguna pantalla, asi que al llegar al ROAS sin anclarlas ya no se
    sabria de que anuncio habla la fila. El mes anterior es el anterior **con anuncios**, que no siempre
    es el de al lado.
  - Las columnas de compras, valor y ROAS son propias de esta cuenta: Terminal Pesquero no vende en linea
    y su tabla no las tiene.
- Calculadora de Inversion (desde la v1.7.0): de una meta de facturacion a la inversion que haria falta.
  La de Terminal Pesquero va por CPL de mensajes porque esa cuenta vende por WhatsApp; esta va por la
  cadena del e-commerce: facturacion objetivo -> compras necesarias (ticket promedio) -> inversion
  necesaria (ROAS). Los tres campos arrancan con los numeros reales del ano y se pueden cambiar.
  Debajo, la misma meta con el ROAS a la mitad, el que pusiste, un 25 % mejor y el doble.
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
  ultimo dia con inversion es la fecha de corte. **El mes en curso nunca se da por cerrado** (v1.6.1): con
  datos del dia 30, la regla del penultimo dia daba octubre entero por cerrado y el tablero decia
  "Periodo: 1 - 31 Octubre" estando a 30, comparando ademas contra septiembre completo. "Hoy" se calcula
  en Lima, no en UTC, porque el barrido corre en UTC y de noche alla ya es el dia siguiente.

### La tabla de anuncios (desde la v1.7.0)

Cada mes lleva ademas `ads`: una fila por anuncio con el detalle que usa el modulo Anuncios. Van en
columnas, con el orden en `adColumns` de la raiz, porque son todos los anuncios de los doce meses y con
las claves repetidas el archivo pesaria el doble; aun asi el JSON pasa de 65 KB a unos 170 KB. El "tipo
de resultado" de cada anuncio es el que mas resultados le trae: la exportacion mezcla varios en la misma
columna y una pieza puede cambiar de objetivo a mitad de mes. "Dias" cuenta solo los dias con inversion.

### La pestana "Nexus Meta" (desde la v1.6.0)

Nexus escribe en la misma hoja del mes una pestana propia, `Nexus Meta`, con el contrato `NEXUS_META_V1`:
la fila 1 identifica contrato, captura, cuenta, moneda, mes y corte, y la fila 2 son las columnas. El
barrido la lee **solo para los dias que la exportacion todavia no trae**; un dia ya exportado manda siempre,
porque sus filas son mas ricas y mezclar los dos origenes en el mismo dia duplicaria el gasto.

De esa pestana se usan unicamente las filas de nivel `ad`: los niveles (`campaign`, `adset`, `ad`) son el
mismo gasto contado tres veces y sumarlos lo triplicaria. El contrato trae menos columnas que la
exportacion, asi que esos dias **no suman embudo (visitas a la web, carrito, pagos iniciados), ni desglose
por edad y sexo, ni vista previa del anuncio**, y tampoco alcance ni ThruPlays salvo que el destino de esa
cuenta en Nexus tenga activado `extended_fields`. Edad y sexo van como `Unknown`, la etiqueta que Meta usa
para lo que no sabe y que el reporte semanal ya descarta al elegir su segmento.

Nexus guarda los nombres crudos de Meta, asi que el barrido los traduce a los de la exportacion antes de
mezclarlos: el indicador del resultado (`video_thruplay_watched_actions` pasa a `ThruPlay`, y de ahi salen
los ThruPlays del mes) y el objetivo (`OUTCOME_SALES` pasa a `Ventas`). Sin esa segunda traduccion, una
campana que solo apareciera en los dias de Nexus se agruparia bajo un grupo inventado, `OUTCOME_SALES`.

El mes afectado lleva un bloque `nexus` (`from`, `to`, `days`, `missing`) y el tablero lo dice en la linea
de fuente: «del 30 al 31 de octubre desde Nexus (sin alcance, embudo, desglose por edad, vista previa)».
Un mes recien creado que solo tenga la pestana de Nexus tambien se lee: la exportacion dejo de ser
obligatoria.

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

- **Automatica:** 7:00 a. m., 12:00 m. y 5:00 p. m. (hora de Lima). Solo publica si cambiaron los datos.
- **A pedido:** boton "Actualizar" de la barra superior. Llama al Web App de Apps Script
  `scripts/sync-trigger.gs`, que lanza el workflow con un token guardado en Apps Script (el cliente no
  entra a GitHub), y el tablero se actualiza solo cuando llega el nuevo JSON (2 a 4 minutos). Como mucho
  una corrida cada 4 minutos. Mientras `SYNC_TRIGGER_ENDPOINT` (`js/objectives.js`) este vacio, el boton
  solo vuelve a leer los datos publicados.

Puesta en marcha del Web App (una vez):

1. GitHub > Settings > Developer settings > Fine-grained tokens: token solo para `objetivos-TLM`, permiso
   **Actions: Read and write**. Anotar su vencimiento: al vencer, el boton deja de lanzar la sincronizacion.
2. script.google.com > Nuevo proyecto "Sincronizar TLM": pegar `scripts/sync-trigger.gs`.
3. Configuracion del proyecto > Propiedades del script: `GITHUB_TOKEN` = el token.
4. Implementar > Nueva implementacion > Aplicacion web: ejecutar como "Yo", acceso "Cualquier usuario".
5. Pegar la URL `/exec` en `SYNC_TRIGGER_ENDPOINT` y publicar.

Si la hoja de un mes no se puede leer (por ejemplo, Meta cambia el nombre de una columna), ese mes queda
sin datos con un aviso en el tablero y el resto se sigue actualizando. En octubre de 2026 Meta renombro
"Importe gastado (PEN)" a "Monto gastado (PEN)": se aceptan los dos.

Cada descarga de Drive se intenta hasta tres veces (con 5 y 15 segundos de espera). Si un archivo sigue sin
bajar, la sincronizacion sigue con el resto y el tablero muestra un aviso con su nombre; se vuelve a
intentar en la corrida siguiente. Solo se detiene si no se puede leer una carpeta entera o no baja ninguna
hoja de Meta.

| Carpeta | ID de Drive |
| --- | --- |
| Meta files - The Little Market | `1lpi0wzaLuwL3MWMKBNtHBHJyDBD6p8Ie` |

La carpeta debe estar compartida como **"Cualquier persona con el enlace" > Lector**. Si el workflow falla
en "Descargar la carpeta de Drive", la carpeta sigue restringida (una sola hoja restringida no lo detiene:
sale como aviso en el tablero).

## Archivo de Reportes

Modulo con dos pestanas (`js/reports-archive.js` y `js/report-week.js`):

- **Documentos:** los archivos de la carpeta de reportes de Drive
  (`17U5xr16eq1aLobF7LEHeb67KLg_D8aZe`, compartida por enlace), con tipo, periodo, version vigente,
  vista previa, enlace a Drive y descarga. El workflow la lista en cada sincronizacion
  (`scripts/drive-download.py` + `scripts/update-reports-catalog.py` -> `data/tlm-drive-reports.json`). La fecha es
  la de "Ultima modificacion" de la vista publica de Drive.
- **Generar reporte semanal:** el reporte de Meta Ads de una semana cerrada de lunes a domingo (las ultimas 12),
  frente a la semana anterior, con las laminas del ultimo reporte subido a la carpeta: portada, resumen
  ejecutivo, distribucion de la inversion, Ventas (con embudo), Mensajes (con segmentacion por edad y sexo),
  Reconocimiento, conclusiones y cierre.
  - Datos: `data/tlm-ads-daily.json`, que `build-ads-data.py` escribe con las filas por dia, campana y anuncio de
    las ultimas 15 semanas, y aparte la segmentacion por dia, grupo, edad y sexo.
  - Los textos de analisis y conclusiones vienen propuestos con los numeros; se editan en pantalla y quedan
    guardados por semana en el navegador (`tlm-week-notes-v1`). "Restaurar textos" vuelve a los propuestos.
  - "Descargar PDF" abre la impresion del navegador (A4 horizontal, una lamina por pagina) con el nombre
    `The-Little-Market-Reporte-Ads-Semanal-<dias>-<Mes>-<Ano>`. Al subir ese PDF a la carpeta, Documentos lo
    reconoce como reporte semanal.
  - Si la descarga de Meta no llega al domingo, avisa que faltan dias.
  - El alcance es la suma de las filas diarias, no el alcance sin duplicar de Meta.

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
