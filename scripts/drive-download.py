#!/usr/bin/env python3
"""Descarga de Google Drive la carpeta que alimenta scripts/build-ads-data.py.

Deja en --out la misma estructura que la carpeta The Little Market sincronizada en G:, mas un manifest.json:
  <out>/Meta files - The Little Market/*.xlsx

Sin credenciales: la carpeta debe estar compartida como "Cualquier persona con el enlace puede ver".
Se lee su vista publica (embeddedfolderview):
  - Hojas de calculo de Google -> se exportan a .xlsx;
  - archivos .xlsx -> se descargan tal cual;
  - subcarpetas y otros documentos -> se listan en el manifest, pero no se descargan.

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

import requests

# Carpeta local -> ID de la carpeta en Drive (se puede cambiar por variable de entorno).
FOLDERS = {
    'Meta files - The Little Market': os.environ.get('TLM_META_FOLDER_ID', '1lpi0wzaLuwL3MWMKBNtHBHJyDBD6p8Ie'),
}
LISTING_URL = 'https://drive.google.com/embeddedfolderview?id={id}'
SHEET_EXPORT_URL = 'https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx'
FILE_URL = 'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'
ENTRY_RE = re.compile(
    r'<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)".*?<a href="([^"]+)".*?'
    r'/type/([^"]+)".*?<div class="flip-entry-title">([^<]*)</div>', re.S)
SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
EXTENSIONS = ('.xlsx',)
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'Mozilla/5.0 (tlm-sync)'


def safe_name(name):
    # Los nombres vienen de Drive: sin separadores de ruta ni nombres ocultos.
    return os.path.basename(html.unescape(name).replace('\\', '/')).lstrip('.').strip() or 'archivo'


def list_folder(folder_id):
    response = SESSION.get(LISTING_URL.format(id=folder_id), timeout=60)
    entries = [{'id': match[0], 'href': match[1], 'mimeType': match[2], 'name': safe_name(match[3])}
               for match in ENTRY_RE.findall(response.text)]
    if response.status_code != 200 or ('flip-entry' not in response.text and 'flip-empty' not in response.text):
        sys.exit(f'No se pudo leer la carpeta {folder_id} (HTTP {response.status_code}).\n'
                 'Revisa que este compartida como "Cualquier persona con el enlace puede ver".')
    return entries


def fetch(url, target):
    response = SESSION.get(url, timeout=120)
    content_type = response.headers.get('content-type', '')
    # Si el archivo no es publico, Google devuelve una pagina de inicio de sesion en HTML.
    if response.status_code != 200 or content_type.startswith('text/html'):
        return False
    with open(target, 'wb') as handle:
        handle.write(response.content)
    return True


def download_folder(folder_id, target_dir):
    """Descarga lo que usa build-ads-data.py y devuelve el listado completo (con los IDs de Drive)."""
    entries = []
    for entry in list_folder(folder_id):
        item = {'id': entry['id'], 'name': entry['name'], 'mimeType': entry['mimeType'], 'file': None}
        if entry['mimeType'] == SHEET_MIME:
            item['file'] = entry['name'] + '.xlsx'
            url = SHEET_EXPORT_URL.format(id=entry['id'])
        elif entry['name'].lower().endswith(EXTENSIONS):
            item['file'] = entry['name']
            url = FILE_URL.format(id=entry['id'])
        if item['file'] and not fetch(url, os.path.join(target_dir, item['file'])):
            sys.exit(f'No se pudo descargar "{entry["name"]}" ({entry["id"]}): revisa que sea publico.')
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
        entries = download_folder(folder_id, target_dir)
        downloaded = [entry['file'] for entry in entries if entry['file']]
        if not downloaded:
            sys.exit(f'La carpeta "{local}" ({folder_id}) no tiene hojas de calculo ni .xlsx.')
        manifest[local] = {'folderId': folder_id, 'files': entries}
        print(f'[drive] {local}: {len(downloaded)} descargados de {len(entries)} -> {", ".join(downloaded)}')
    with open(os.path.join(args.out, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
