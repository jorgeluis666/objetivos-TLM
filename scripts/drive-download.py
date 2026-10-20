#!/usr/bin/env python3
"""Descarga de Google Drive las carpetas que alimentan scripts/build-ads-data.py y el Archivo de Reportes.

Deja en --out la misma estructura que la carpeta The Little Market sincronizada en G:, mas un manifest.json:
  <out>/Meta files - The Little Market/*.xlsx
  <out>/Reportes - The Little Market/*.pdf

Sin credenciales: las carpetas deben estar compartidas como "Cualquier persona con el enlace puede ver".
Se lee su vista publica (embeddedfolderview), con la fecha de "Ultima modificacion" de cada archivo:
  - Hojas de calculo de Google (carpeta de Meta) -> se exportan a .xlsx;
  - archivos .xlsx (Meta) y .pdf (Reportes) -> se descargan tal cual;
  - subcarpetas y otros documentos -> se listan en el manifest, pero no se descargan.
Cada descarga se reintenta; si un archivo sigue sin bajar, se sigue con el resto y el manifest lo marca
con "error" (el tablero lo muestra como aviso). Una carpeta que no se puede leer detiene todo.

Uso (lo corre .github/workflows/sync-ads-data.yml):
  python scripts/drive-download.py --out drive-data
Requiere: requests.
"""
import argparse
import html
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

# Carpeta local -> ID de la carpeta en Drive (se puede cambiar por variable de entorno).
META_FOLDER = 'Meta files - The Little Market'
REPORTS_FOLDER = 'Reportes - The Little Market'
FOLDERS = {
    META_FOLDER: os.environ.get('TLM_META_FOLDER_ID', '1lpi0wzaLuwL3MWMKBNtHBHJyDBD6p8Ie'),
    # Archivo de Reportes: los PDF se descargan solo para saber su peso.
    REPORTS_FOLDER: os.environ.get('TLM_REPORTS_FOLDER_ID', '17U5xr16eq1aLobF7LEHeb67KLg_D8aZe'),
}
LISTING_URL = 'https://drive.google.com/embeddedfolderview?id={id}'
SHEET_EXPORT_URL = 'https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx'
FILE_URL = 'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'
ENTRY_RE = re.compile(
    r'<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)".*?<a href="([^"]+)".*?'
    r'/type/([^"]+)".*?<div class="flip-entry-title">([^<]*)</div>(.*?)(?=<div class="flip-entry" |$)', re.S)
MODIFIED_RE = re.compile(r'class="flip-entry-last-modified"><div>([^<]*)<')
MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
# Segundos de espera antes de cada reintento de una descarga (3 intentos en total).
RETRY_WAITS = [5, 15]
EXTENSIONS = {META_FOLDER: ('.xlsx',), REPORTS_FOLDER: ('.pdf',)}
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'Mozilla/5.0 (tlm-sync)'


def safe_name(name):
    # Los nombres vienen de Drive: sin separadores de ruta ni nombres ocultos.
    return os.path.basename(html.unescape(name).replace('\\', '/')).lstrip('.').strip() or 'archivo'


def public_view_date(text):
    """Fecha de la columna "Ultima modificacion" de la vista publica: "3:04 PM" (hoy), "Oct 5" o "10/5/25"."""
    text = html.unescape(text or '').strip()
    today = (datetime.now(timezone.utc) - timedelta(hours=5)).date()  # Lima (UTC-5)
    if re.match(r'^\d{1,2}:\d{2}\s*[AP]M$', text, re.I):
        return today.isoformat()
    match = re.match(r'^([A-Z][a-z]{2}) (\d{1,2})$', text)
    if match and match[1] in MONTHS_EN:
        day = date(today.year, MONTHS_EN.index(match[1]) + 1, int(match[2]))
        return (day.replace(year=today.year - 1) if day > today else day).isoformat()
    match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2})$', text)
    return f'20{match[3]}-{int(match[1]):02d}-{int(match[2]):02d}' if match else None


def list_folder(folder_id):
    response = SESSION.get(LISTING_URL.format(id=folder_id), timeout=60)
    entries = []
    for match in ENTRY_RE.findall(response.text):
        modified = MODIFIED_RE.search(match[4])
        entries.append({'id': match[0], 'href': match[1], 'mimeType': match[2], 'name': safe_name(match[3]),
                        'modified': public_view_date(modified[1]) if modified else None})
    if response.status_code != 200 or ('flip-entry' not in response.text and 'flip-empty' not in response.text):
        sys.exit(f'No se pudo leer la carpeta {folder_id} (HTTP {response.status_code}).\n'
                 'Revisa que este compartida como "Cualquier persona con el enlace puede ver".')
    return entries


def fetch(url, target):
    """Descarga el archivo; devuelve None si salio bien o el motivo del fallo."""
    try:
        response = SESSION.get(url, timeout=120)
    except requests.RequestException as error:
        return f'error de red: {type(error).__name__}'
    content_type = response.headers.get('content-type', '')
    # Si el archivo no es publico, Google devuelve una pagina de inicio de sesion en HTML.
    if response.status_code != 200 or content_type.startswith('text/html'):
        return f'HTTP {response.status_code}' + (', Drive devolvio una pagina en vez del archivo' if response.status_code == 200 else '')
    with open(target, 'wb') as handle:
        handle.write(response.content)
    return None


def fetch_with_retries(url, target):
    for attempt, wait in enumerate(RETRY_WAITS + [None], start=1):
        error = fetch(url, target)
        if not error or wait is None:
            return error
        print(f'[drive] intento {attempt} fallido ({error}); se reintenta en {wait} s', file=sys.stderr)
        time.sleep(wait)


def download_folder(folder_id, target_dir, extensions, sheets):
    """Descarga lo que usan los scripts y devuelve el listado completo (con los IDs de Drive).

    Un archivo que no baja tras los reintentos no detiene la sincronizacion: queda en el manifest con
    "error" (y sin "file") y build-ads-data.py lo pasa a los avisos del tablero."""
    entries = []
    for entry in list_folder(folder_id):
        item = {'id': entry['id'], 'name': entry['name'], 'mimeType': entry['mimeType'], 'modified': entry['modified'], 'file': None}
        if sheets and entry['mimeType'] == SHEET_MIME:
            item['file'] = entry['name'] + '.xlsx'
            url = SHEET_EXPORT_URL.format(id=entry['id'])
        elif entry['name'].lower().endswith(extensions):
            item['file'] = entry['name']
            url = FILE_URL.format(id=entry['id'])
        error = item['file'] and fetch_with_retries(url, os.path.join(target_dir, item['file']))
        if error:
            print(f'[drive] no se pudo descargar "{entry["name"]}" ({entry["id"]}): {error}', file=sys.stderr)
            item.update(file=None, error=error)
        entries.append(item)
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', required=True, help='Carpeta destino')
    args = parser.parse_args()
    manifest = {}
    for local, folder_id in FOLDERS.items():
        target_dir = os.path.join(args.out, local)
        os.makedirs(target_dir, exist_ok=True)
        entries = download_folder(folder_id, target_dir, EXTENSIONS[local], sheets=local == META_FOLDER)
        downloaded = [entry['file'] for entry in entries if entry['file']]
        failed = [entry['name'] for entry in entries if entry.get('error')]
        # Sin ninguna hoja de Meta se publicaria un tablero vacio: eso si detiene la sincronizacion.
        if not downloaded and failed and local == META_FOLDER:
            sys.exit(f'No se pudo descargar ninguna hoja de la carpeta "{local}" ({folder_id}).')
        if not downloaded and local == META_FOLDER:
            sys.exit(f'La carpeta "{local}" ({folder_id}) no tiene hojas de calculo ni .xlsx.')
        manifest[local] = {'folderId': folder_id, 'files': entries}
        print(f'[drive] {local}: {len(downloaded)} descargados de {len(entries)} -> {", ".join(downloaded)}'
              + (f' | fallidos: {", ".join(failed)}' if failed else ''))
    with open(os.path.join(args.out, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
