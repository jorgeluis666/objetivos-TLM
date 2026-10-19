#!/usr/bin/env python3
"""Actualiza data/tlm-drive-reports.json (modulo Archivo de Reportes) con la carpeta de reportes de Drive.

Lee el manifest.json que deja scripts/drive-download.py:
  - agrega los archivos nuevos de la carpeta (peso tomado del archivo descargado);
  - quita los que ya no estan en la carpeta;
  - conserva los datos ya catalogados de los que siguen y actualiza su fecha si Drive muestra una mas nueva.

La fecha es la de "Ultima modificacion" de la vista publica de Drive (solo dia); si no viene, la de la sincronizacion.

Uso: python scripts/update-reports-catalog.py --root <carpeta de drive-download.py>
"""
import argparse
import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'data', 'tlm-drive-reports.json')
FOLDER = 'Reportes - The Little Market'
MIME_BY_EXTENSION = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


def load_catalog(folder_id):
    try:
        with open(CATALOG, encoding='utf-8') as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {'folder': {'id': folder_id, 'name': FOLDER, 'url': f'https://drive.google.com/drive/folders/{folder_id}'},
                'syncedAt': '', 'files': []}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    with open(os.path.join(args.root, 'manifest.json'), encoding='utf-8') as handle:
        folder = json.load(handle)[FOLDER]
    catalog = load_catalog(folder['folderId'])
    known = {item['id']: item for item in catalog.get('files', [])}
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    files, added, changed = [], [], []
    for entry in folder['files']:
        modified = entry.get('modified') or now[:10]
        if entry['id'] in known:
            item = known[entry['id']]
            # Un archivo reemplazado en Drive (misma ID) muestra una fecha mas nueva.
            if entry.get('modified') and entry['modified'] > item.get('modifiedTime', '')[:10]:
                item['modifiedTime'] = entry['modified']
                changed.append(entry['name'])
            files.append(item)
            continue
        listed_mime = entry.get('mimeType', '')
        mime = listed_mime if listed_mime.startswith('application/vnd.google-apps.') else MIME_BY_EXTENSION.get(os.path.splitext(entry['name'])[1].lower())
        if not mime or mime == 'application/vnd.google-apps.folder':
            continue
        path = os.path.join(args.root, FOLDER, entry['file']) if entry.get('file') else None
        files.append({
            'id': entry['id'],
            'title': entry['name'],
            'mimeType': mime,
            'sizeBytes': os.path.getsize(path) if path and os.path.exists(path) else 0,
            'modifiedTime': modified,
            'createdTime': modified,
        })
        added.append(entry['name'])
    listed = {entry['id'] for entry in folder['files']}
    removed = [item['title'] for item_id, item in known.items() if item_id not in listed]
    catalog['files'] = files
    if added or removed or changed or not catalog.get('syncedAt'):
        catalog['syncedAt'] = now[:10]
    with open(CATALOG, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(f'[reportes] {len(files)} documentos | nuevos: {added or "-"} | actualizados: {changed or "-"} | retirados: {removed or "-"}')


if __name__ == '__main__':
    main()
