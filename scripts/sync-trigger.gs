/**
 * Web App del boton "Sincronizar con Drive" del tablero de The Little Market.
 * Lanza el workflow sync-ads-data.yml de GitHub (descarga Drive, regenera data/tlm-ads-2026.json y lo publica)
 * sin que el cliente tenga que entrar a GitHub.
 *
 * Seguridad:
 * - El repositorio y el workflow estan fijos aqui: la peticion no puede lanzar otra cosa.
 * - El token de GitHub va en Propiedades del script (GITHUB_TOKEN), nunca en el repo ni en el tablero.
 *   Token "fine-grained" limitado al repo objetivos-TLM con permiso Actions: Read and write.
 * - Solo acepta action=sync. Como mucho una sincronizacion cada 4 minutos para todos los visitantes.
 * - Los errores internos se registran en el log y al cliente solo le llega un mensaje generico.
 *
 * Publicar: Implementar > Nueva implementacion > Aplicacion web, ejecutar como "Yo", acceso "Cualquier usuario".
 * La URL /exec va en SYNC_TRIGGER_ENDPOINT (js/objectives.js).
 */
const TLM_SYNC_REPO = 'jorgeluis666/objetivos-TLM';
const TLM_SYNC_WORKFLOW = 'sync-ads-data.yml';
const TLM_SYNC_COOLDOWN_SECONDS = 240;
const TLM_SYNC_CACHE_KEY = 'tlm_sync_last_dispatch';

function doPost(event) {
  const action = String((event && event.postData && event.postData.contents) || '').trim();
  if (action !== 'action=sync') return respuestaJsonSync_({ ok: false, error: 'Solicitud no valida.' });
  return lanzarSincronizacion_();
}

function doGet(event) {
  const params = (event && event.parameter) || {};
  if (params.action !== 'sync') return respuestaJsonSync_({ ok: false, error: 'Solicitud no valida.' });
  return lanzarSincronizacion_();
}

function lanzarSincronizacion_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return respuestaJsonSync_({ ok: true, pending: true });
  try {
    const cache = CacheService.getScriptCache();
    // Si alguien ya la lanzo hace poco, el tablero solo espera a que terminen los datos de esa corrida.
    if (cache.get(TLM_SYNC_CACHE_KEY)) return respuestaJsonSync_({ ok: true, pending: true });
    const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    if (!token) throw new Error('Falta GITHUB_TOKEN en Propiedades del script');
    const response = UrlFetchApp.fetch(
      'https://api.github.com/repos/' + TLM_SYNC_REPO + '/actions/workflows/' + TLM_SYNC_WORKFLOW + '/dispatches', {
        method: 'post',
        contentType: 'application/json',
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
        payload: JSON.stringify({ ref: 'main' }),
        muteHttpExceptions: true,
      });
    if (response.getResponseCode() !== 204) {
      throw new Error('GitHub ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 200));
    }
    cache.put(TLM_SYNC_CACHE_KEY, new Date().toISOString(), TLM_SYNC_COOLDOWN_SECONDS);
    return respuestaJsonSync_({ ok: true, pending: false });
  } catch (error) {
    console.error('sync', error);
    return respuestaJsonSync_({ ok: false, error: 'No se pudo iniciar la sincronizacion.' });
  } finally {
    lock.releaseLock();
  }
}

function respuestaJsonSync_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
