#!/usr/bin/env python3
"""Genera data/tlm-ads-2026.json a partir de las exportaciones de Meta Ads de The Little Market.

Fuente: carpeta "Meta files - The Little Market" de Google Drive, una hoja por mes
("The Little Market - Octubre 2026"), pestana Raw Data Report: una fila por dia / edad / sexo / anuncio,
con los importes en soles (PEN).

Reglas:
  - El mes de cada hoja se reconoce por el nombre ("Octubre", "The Little Market - Octubre 2026") o por
    el rango de fechas de la exportacion ("..._20261001-20261031").
  - Solo cuentan las filas cuyo dia cae en ese mes. Si una hoja no trae ningun dia de su mes (por ejemplo,
    una copia del mes anterior), el mes queda sin datos y se avisa en "warnings".
  - Grupos de campana: Ventas (objetivo Ventas: compras en la web), Mensajes (WhatsApp y visitas al perfil
    de Instagram) y Reconocimiento (resultado ThruPlay).
  - La pestana "Nexus Meta" (contrato NEXUS_META_V1) trae las filas de la API, un dia por fila y a nivel
    anuncio. **Mandan sobre la exportacion del mismo dia**: la exportacion viene desglosada por dia, edad
    y sexo y Meta deja fuera de ese desglose medio punto porcentual del gasto, asi que el tablero no
    cuadraba con Ads Manager (octubre de 2026: S/ 1,115.25 contra S/ 1,120.56). De la exportacion de ese
    dia se siguen tomando el embudo y el enlace de vista previa, que el contrato no manda, y el desglose
    por edad y sexo, que se arma solo con sus filas. Lo que falte queda en cero y el mes lo dice en
    "nexus". Un mes puede venir en dos hojas (la historica y la de Nexus): se leen las dos.

Uso:
  python scripts/build-ads-data.py [--root "G:/Mi unidad/.../The Little Market"]
Requiere: openpyxl.
"""
import argparse
import calendar
import glob
import json
import os
import re
import sys
import unicodedata
import warnings
from datetime import date, datetime, timedelta, timezone

import openpyxl

warnings.filterwarnings('ignore')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DRIVE = 'G:/Mi unidad/Agencia Lima Retail/01_Clientes y Ventas/02_Clientes de la agencia/The Little Market'
META_DIR = 'Meta files - The Little Market'
OUT = os.path.join(ROOT, 'data', 'tlm-ads-2026.json')
# Filas por dia para el Generador de reporte semanal (Archivo de Reportes): las ultimas semanas, no todo el ano.
DAILY_OUT = os.path.join(ROOT, 'data', 'tlm-ads-daily.json')
DAILY_WEEKS = 15
DAILY_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts', 'purchases', 'revenue',
                'conversations', 'thruplays', 'profileVisits']
SEGMENT_FIELDS = ['spend', 'purchases', 'revenue', 'conversations', 'thruplays']
YEAR = 2026
MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
CURRENCY = 'PEN'
TOP_ADS = 5

# Encabezado de la exportacion (sin tildes, en minusculas) -> clave interna.
COLUMNS = {
    'dia': 'day', 'nombre del anuncio': 'ad', 'objetivo': 'objective', 'impresiones': 'impressions', 'alcance': 'reach',
    'clics en el enlace': 'clicks', 'visitas a la pagina de destino del sitio web': 'landingViews',
    'interacciones': 'interactions', 'articulos agregados al carrito': 'addToCart', 'pagos iniciados': 'checkouts',
    'compras': 'purchases', 'valor de conversion de compras': 'revenue',
    'conversaciones con mensajes iniciadas': 'conversations', 'tipo de resultado': 'resultType', 'resultados': 'results',
    'enlace de vista previa': 'preview', 'nombre de la campana': 'campaign', 'edad': 'age', 'sexo': 'sex',
    'nombre del conjunto de anuncios': 'adSet',
}
NEXUS_MARK = 'NEXUS_META_V1'
# El mes entero en una fila por entidad: de ahi sale el alcance sin duplicar, que no se puede sumar de
# los dias. Su "dia" es el primero del periodo, no un dia con entrega.
MONTH_LEVELS = ('month_campaign', 'month_adset', 'month_ad')
NEXUS_LEVELS = ('ad', 'segment') + MONTH_LEVELS
# Cabecera de la pestana que escribe Nexus -> clave interna. Las cinco ultimas solo llegan si su destino
# tiene activado "extended_fields"; sin ellas no hay alcance ni ThruPlays de esos dias.
NEXUS_COLUMNS = {
    'level': 'level', 'day': 'day', 'name': 'ad', 'campaign': 'campaign', 'adset': 'adSet', 'spend': 'spend',
    'impressions': 'impressions', 'inline_link_clicks': 'clicks', 'purchases': 'purchases',
    'purchase_value': 'revenue', 'messages': 'conversations',
    'reach': 'reach', 'objective': 'objective', 'result_type': 'resultType', 'results': 'results',
    'landing_page_views': 'landingViews', 'add_to_cart': 'addToCart', 'checkouts': 'checkouts',
    'age': 'age', 'gender': 'sex', 'preview': 'preview',
}
# El embudo: si el destino no lo manda, el tablero lo avisa en vez de contarlo como cero.
FUNNEL = ('landingViews', 'addToCart', 'checkouts')
# Nexus guarda el indicador crudo de Meta; la exportacion trae el nombre en espanol que mira add().
NEXUS_RESULTS = (('thruplay', 'ThruPlay'), ('messaging_conversation', 'Conversaciones con mensajes iniciadas'),
                 ('profile_visit', 'Visitas al perfil de Instagram'), ('purchase', 'Compras en el sitio web'))
# Lo mismo con el objetivo: Nexus manda OUTCOME_SALES y group_of() espera el "Ventas" de la exportacion.
NEXUS_OBJECTIVES = {
    'outcome_sales': 'Ventas', 'outcome_awareness': 'Reconocimiento', 'brand_awareness': 'Reconocimiento',
    'outcome_traffic': 'Trafico', 'link_clicks': 'Trafico', 'outcome_engagement': 'Interaccion',
    'post_engagement': 'Interaccion', 'outcome_leads': 'Clientes potenciales',
    'lead_generation': 'Clientes potenciales', 'messages': 'Mensajes', 'conversions': 'Conversiones',
    'reach': 'Alcance', 'video_views': 'Reproducciones de video',
}
# El alcance, el embudo, la vista previa y el desglose por edad no estan aqui: se miran en los datos,
# porque el embudo y el enlace llegan de la exportacion del mismo dia y el alcance, si el destino lo manda.
SUMMED = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts', 'purchases', 'revenue',
          'conversations', 'interactions']
METRICS = SUMMED + ['profileVisits', 'thruplays']
MONEY = {'spend', 'revenue'}
AD_FIELDS = ['spend', 'impressions', 'clicks', 'purchases', 'revenue', 'conversations', 'profileVisits', 'thruplays']
# Tabla del modulo Anuncios: una fila por anuncio del mes. Va en columnas y no en objetos porque son todos
# los anuncios de los doce meses, y con las claves repetidas el archivo pesaria el doble.
AD_TABLE_METRICS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts',
                    'purchases', 'revenue', 'conversations', 'profileVisits', 'thruplays']
AD_TABLE_COLUMNS = ['name', 'campaign', 'adSet', 'group', 'resultType', 'results', 'days', 'url'] + AD_TABLE_METRICS
# Orden de los mejores anuncios segun el objetivo de la campana.
TOP_SORT = {'Ventas': ('purchases', 'revenue', 'clicks'), 'Mensajes': ('conversations', 'profileVisits', 'clicks'),
            'Reconocimiento': ('thruplays', 'impressions')}
GROUPS = {'ventas': 'Ventas', 'reconocimiento': 'Reconocimiento', 'trafico': 'Tráfico', 'interaccion': 'Interacción',
          'clientes potenciales': 'Clientes potenciales'}


def norm(text):
    return unicodedata.normalize('NFD', str(text or '')).encode('ascii', 'ignore').decode().strip().lower()


def num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if number != number else number


def to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    match = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(value or ''))
    return date(int(match[1]), int(match[2]), int(match[3])) if match else None


def zero():
    return {key: 0.0 for key in METRICS}


def add(target, row):
    for key in SUMMED:
        target[key] += num(row.get(key))
    kind = norm(row.get('resultType'))
    # "Resultados" mezcla tipos: se separan los que se reportan aparte.
    if kind == 'thruplay':
        target['thruplays'] += num(row.get('results'))
    elif 'visitas al perfil' in kind:
        target['profileVisits'] += num(row.get('results'))


def rounded(values, keys=METRICS):
    return {key: round(values[key], 2) if key in MONEY else int(round(values[key])) for key in keys}


def group_of(name, objective):
    if 'mensaje' in norm(name) or 'mensaje' in norm(objective):
        return 'Mensajes'
    return GROUPS.get(norm(objective), str(objective or 'Otros').strip())


def month_files(folder, month):
    """Hojas del mes: por nombre ("Octubre.xlsx", "The Little Market - Octubre 2026.xlsx") o por el rango de
    fechas de la exportacion ("..._20261001-20261031.xlsx").

    Son varias porque el mes puede venir en dos hojas: la historica con la exportacion de Meta y la que
    llena Nexus con las filas de la API."""
    paths = [path for path in sorted(glob.glob(os.path.join(folder, '*.xlsx')))
             if is_month_name(os.path.basename(path), month)]
    # La hoja que nombra el mes en el tablero es la que no lleva sufijo: la historica, la que edita el
    # equipo. drive-download.py le pone " (2)" a la segunda carpeta que trae el mismo nombre.
    paths.sort(key=lambda path: bool(re.search(r' \(\d+\)\.xlsx$', os.path.basename(path))))
    return paths


def is_month_name(file_name, month):
    name = norm(file_name)
    span = re.search(r'(\d{4})(\d{2})\d{2}\s*-\s*\d{8}', name)
    return bool(re.search(r'(^|[^a-z])' + norm(month) + r'([^a-z]|$)', name)
                or (span and int(span.group(1)) == YEAR and int(span.group(2)) == MONTHS.index(month) + 1))


def read_file(path):
    """Las filas de una hoja, separadas por origen: exportacion de Meta y pestana de Nexus."""
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        exported = export_rows(book, path)
    except ValueError:
        # Un mes recien creado puede tener solo la pestana de Nexus, sin exportacion todavia.
        if nexus_sheet(book) is None:
            book.close()
            raise
        exported = []
    nexus = nexus_rows(book)
    book.close()
    return exported, nexus


def ad_key(row):
    return (row['day'], row['campaign'], str(row.get('adSet') or '').strip(), str(row.get('ad') or '').strip())


def month_rows(paths):
    """Las filas del mes con la API por delante.

    Un dia que la pestana de Nexus trae se cuenta con sus filas de anuncio, porque son las de la API y
    suman lo mismo que dice Ads Manager; la exportacion de ese dia viene desglosada por dia, edad y sexo
    y Meta deja fuera de ese desglose medio punto porcentual del gasto.

    El desglose por edad y sexo sale de las filas de nivel `segment` de la misma pestana, y si Nexus
    todavia no las manda, de la exportacion de ese dia. Nunca de las dos a la vez: son el mismo gasto
    repartido y se contaria doble. El embudo del dia y el enlace de vista previa se pegan a la fila de la
    API desde la exportacion solo si la API no los trajo. Un dia que Nexus no trae se cuenta como siempre."""
    exported, nexus, errors = [], [], []
    for path in paths:
        try:
            from_export, from_nexus = read_file(path)
        except ValueError as error:
            errors.append(error)
            continue
        exported += from_export
        nexus += from_nexus
    if errors and not exported and not nexus:
        raise errors[0]
    main = [row for row in nexus if row.get('level') == 'ad']
    segments = [row for row in nexus if row.get('level') == 'segment']
    nexus_days = {row['day'] for row in main}
    if not nexus_days:
        return exported
    segment_days = {row['day'] for row in segments}
    export_days = {row['day'] for row in exported}
    extra = {}
    for row in exported:
        if row['day'] not in nexus_days:
            continue
        slot = extra.setdefault(ad_key(row), {key: 0.0 for key in FUNNEL})
        for key in FUNNEL:
            slot[key] += num(row.get(key))
        url = row.get('preview')
        if not slot.get('preview') and isinstance(url, str) and url.startswith('https://'):
            slot['preview'] = url
    for row in main:
        slot = extra.get(ad_key(row))
        if not slot:
            continue
        # Solo se rellena lo que la API no trajo: su cifra manda sobre la del desglose.
        for key in FUNNEL:
            if not num(row.get(key)):
                row[key] = slot[key]
        if slot.get('preview') and not row.get('preview'):
            row['preview'] = slot['preview']
    rows = []
    for row in main:
        # Si el dia tiene de donde sacar el desglose, estas filas solo ponen las cifras.
        if row['day'] in segment_days or row['day'] in export_days:
            row['only'] = 'totals'
        rows.append(row)
    for row in segments:
        row['only'] = 'segment'
        rows.append(row)
    for row in exported:
        if row['day'] in segment_days:
            continue  # el desglose de ese dia ya viene de la API
        if row['day'] in nexus_days:
            row['only'] = 'segment'
        rows.append(row)
    return rows


# Un dia que la API ya trae se cuenta con sus filas; las de la exportacion de ese dia solo sirven para el
# desglose por edad y sexo, que la API no manda.
def for_totals(row):
    return row.get('only') not in ('segment', 'month')


def for_segments(row):
    return row.get('only') not in ('totals', 'month')


def unique_reach(rows):
    """El alcance sin duplicar del mes, por campaña, conjunto y anuncio.

    Lo mandan las filas `month_*` de Nexus, una por entidad. No se suma: el alcance de dos conjuntos no
    es el de su campaña, porque hay personas en los dos. Por eso cada lamina del reporte busca la entidad
    que le corresponde y, si no esta, se queda con la suma de los dias y lo dice."""
    found = {'campaigns': {}, 'sets': {}, 'ads': {}}
    where = {'month_campaign': 'campaigns', 'month_adset': 'sets', 'month_ad': 'ads'}
    for row in rows:
        slot = where.get(row.get('level'))
        reach = num(row.get('reach'))
        if not slot or reach <= 0:
            continue
        name = str(row.get('ad') or '').strip()
        key = [row['campaign']]
        if slot != 'campaigns':
            key.append(str(row.get('adSet') or '').strip())
        if slot == 'ads':
            key.append(name)
        found[slot]['|'.join(key)] = {'reach': int(round(reach)), 'impressions': int(round(num(row.get('impressions'))))}
    return {key: value for key, value in found.items() if value}


def export_rows(book, path):
    sheet = book['Raw Data Report'] if 'Raw Data Report' in book.sheetnames else book.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    keys, currency = [], None
    for cell in next(rows, None) or []:
        # Meta renombro "Importe gastado (PEN)" a "Monto gastado (PEN)" en octubre de 2026: valen las dos.
        spend = re.match(r'(?:importe|monto) gastado \((\w+)\)', norm(cell))
        if spend:
            currency = spend.group(1).upper()
        keys.append('spend' if spend else COLUMNS.get(norm(cell)))
    if 'spend' not in keys or 'campaign' not in keys or 'day' not in keys:
        raise ValueError(f'{path}: no tiene las columnas de la exportacion de Meta (Dia, Importe o Monto gastado, Nombre de la campana)')
    if currency != CURRENCY:
        raise ValueError(f'{path}: moneda inesperada {currency} (se espera {CURRENCY})')
    records = []
    for values in rows:
        row = {key: value for key, value in zip(keys, values) if key}
        row['day'] = to_date(row.get('day'))
        row['campaign'] = str(row.get('campaign') or '').strip()
        if row['day'] and row['campaign']:
            records.append(row)
    return records


def nexus_sheet(book):
    """Pestana que escribe Nexus en la hoja del mes: se reconoce por el contrato de su primera celda."""
    for sheet in book.worksheets:
        for values in sheet.iter_rows(min_row=1, max_row=1, values_only=True):
            if values and norm(values[0]) == norm(NEXUS_MARK):
                return sheet
    return None


def result_type_of(indicator):
    text = norm(indicator)
    return next((label for needle, label in NEXUS_RESULTS if needle in text), '')


def nexus_rows(book):
    """Filas de la pestana de Nexus: las de la API, un dia por fila.

    Se quedan dos niveles. `ad` trae las cifras del mes y manda sobre la exportacion del mismo dia (lo
    decide month_rows); su edad y su sexo van como "Unknown", la etiqueta de Meta para lo que no sabe.
    `segment` es la campana desglosada por edad y sexo: el mismo gasto repartido, asi que solo alimenta
    el desglose y nunca los totales.

    `month_campaign`, `month_adset` y `month_ad` son el mes entero en una fila por entidad: de ahi sale el
    alcance sin duplicar, que no se puede sumar de los dias. No entran ni en los totales ni en el
    desglose. `campaign` y `adset` si se descartan: son el mismo gasto diario contado otra vez."""
    sheet = nexus_sheet(book)
    if sheet is None:
        return []
    rows = sheet.iter_rows(min_row=2, values_only=True)
    keys = [NEXUS_COLUMNS.get(norm(cell)) for cell in next(rows, None) or []]
    if 'day' not in keys or 'spend' not in keys or 'campaign' not in keys:
        return []
    records = []
    for values in rows:
        row = {key: value for key, value in zip(keys, values) if key}
        row['day'] = to_date(row.get('day'))
        row['campaign'] = str(row.get('campaign') or '').strip()
        level = norm(row.pop('level', ''))
        if level not in NEXUS_LEVELS or not row['day'] or not row['campaign']:
            continue
        row['level'], row['nexus'] = level, True
        if level in MONTH_LEVELS:
            # El mes entero: ni totales ni desglose, solo el alcance sin duplicar.
            row['only'] = 'month'
            row['age'], row['sex'] = 'Unknown', 'unknown'
        elif level == 'segment':
            row['age'] = str(row.get('age') or '').strip() or 'Unknown'
            row['sex'] = str(row.get('sex') or '').strip() or 'unknown'
            row['ad'] = ''
        else:
            row['age'], row['sex'] = 'Unknown', 'unknown'
        row['resultType'] = result_type_of(row.get('resultType'))
        row['objective'] = NEXUS_OBJECTIVES.get(norm(row.get('objective')), '')
        records.append(row)
    return records


def top_ads(rows, group):
    ads = {}
    for row in rows:
        name = str(row.get('ad') or '').strip() or '(sin nombre)'
        ad = ads.setdefault(name, {'name': name, 'url': None, **zero()})
        add(ad, row)
        url = row.get('preview')
        if not ad['url'] and isinstance(url, str) and url.startswith('https://'):
            ad['url'] = url
    keys = TOP_SORT.get(group, ('clicks',))
    ranked = sorted((ad for ad in ads.values() if ad['spend'] > 0),
                    key=lambda ad: tuple(ad[key] for key in keys) + (ad['spend'],), reverse=True)[:TOP_ADS]
    result = []
    for ad in ranked:
        item = {'name': ad['name'], **rounded(ad, AD_FIELDS)}
        if ad['url']:
            item['url'] = ad['url']
        result.append(item)
    return result


def ads_table(rows):
    """Una fila por anuncio y conjunto del mes, de mas a menos inversion, para el modulo Anuncios.

    La fila es el anuncio dentro de su conjunto, no el anuncio solo: una misma pieza puede correr en dos
    conjuntos con publicos distintos (en Mensajes, el de WhatsApp general y el del radio de 3 km alrededor
    de la tienda) y sus numeros no son del mismo publico. Antes se sumaba todo en una fila y se le ponia
    el conjunto donde mas se gasto, asi que el reporte repartia mal las conversaciones entre los dos.

    El tipo de resultado es el que mas resultados le trae al anuncio: la exportacion mezcla varios en la
    misma columna (ThruPlay, compras, conversaciones, visitas al perfil) y un anuncio puede cambiar de
    objetivo a mitad de mes. "Dias" cuenta solo los dias con inversion, que es lo que mide cuanto corrio."""
    ads = {}
    for row in rows:
        name = str(row.get('ad') or '').strip() or '(sin nombre)'
        adset = str(row.get('adSet') or '').strip()
        ad = ads.setdefault((name, row['campaign'], adset),
                            {'name': name, 'campaign': row['campaign'], 'adSet': adset, 'objective': '',
                             'kinds': {}, 'days': set(), 'url': None, **zero()})
        add(ad, row)
        if num(row.get('spend')) > 0:
            ad['days'].add(row['day'])
        if not ad['objective'] and row.get('objective'):
            ad['objective'] = str(row['objective']).strip()
        kind = str(row.get('resultType') or '').strip()
        if kind:
            ad['kinds'][kind] = ad['kinds'].get(kind, 0) + num(row.get('results'))
        url = row.get('preview')
        if not ad['url'] and isinstance(url, str) and url.startswith('https://'):
            ad['url'] = url
    table = []
    for ad in ads.values():
        if ad['spend'] <= 0 and ad['impressions'] <= 0:
            continue
        kind, results = max(ad['kinds'].items(), key=lambda item: item[1], default=('', 0))
        values = rounded(ad, AD_TABLE_METRICS)
        table.append([ad['name'], ad['campaign'], ad['adSet'], group_of(ad['campaign'], ad['objective']),
                      kind, int(round(results)), len(ad['days']), ad['url'] or '']
                     + [values[key] for key in AD_TABLE_METRICS])
    return sorted(table, key=lambda row: -row[AD_TABLE_COLUMNS.index('spend')])


def campaigns_of(rows):
    by_name = {}
    for row in rows:
        by_name.setdefault(row['campaign'], []).append(row)
    campaigns = []
    for name, items in by_name.items():
        totals = zero()
        for row in items:
            add(totals, row)
        if totals['spend'] <= 0:
            continue
        objective = next((str(row['objective']).strip() for row in items if row.get('objective')), '')
        group = group_of(name, objective)
        campaign = {'name': name, 'objective': objective, 'group': group, **rounded(totals)}
        campaign['cpm'] = round(totals['spend'] / totals['impressions'] * 1000, 2) if totals['impressions'] else None
        campaign['cpc'] = round(totals['spend'] / totals['clicks'], 4) if totals['clicks'] else None
        campaign['topAds'] = top_ads(items, group)
        campaigns.append(campaign)
    order = {'Ventas': 0, 'Mensajes': 1, 'Reconocimiento': 2}
    return sorted(campaigns, key=lambda c: (order.get(c['group'], 3), -c['spend']))


def sheet_ids(drive):
    """IDs de Drive de cada hoja, tomados del manifest que deja drive-download.py (si existe)."""
    try:
        with open(os.path.join(drive, 'manifest.json'), encoding='utf-8') as handle:
            folder = json.load(handle).get(META_DIR, {})
    except FileNotFoundError:
        return None, {}
    return folder.get('folderId'), {item['file']: item['id'] for item in folder.get('files', []) if item.get('file')}


def failed_downloads(drive):
    """Archivos que drive-download.py no pudo bajar (marcados con "error" en su manifest): (carpeta, item)."""
    try:
        with open(os.path.join(drive, 'manifest.json'), encoding='utf-8') as handle:
            manifest = json.load(handle)
    except FileNotFoundError:
        return []
    return [(folder, item) for folder, info in manifest.items() for item in info.get('files', []) if item.get('error')]


def lima_today():
    """Hoy en Lima (UTC-5). El barrido corre en UTC: a las 7 de la tarde de Lima alla ya es el dia siguiente,
    y el 31 a esa hora octubre pasaria por mes pasado."""
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def short(day):
    return f'{day.day}/{day.month:02d}'


def compact(values, keys):
    return [round(values[key], 2) if key in MONEY else int(round(values[key])) for key in keys]


def daily_table(rows, cutoff):
    """Filas por dia / campana / anuncio (sumando edad, sexo y conjunto) y, aparte, por dia / grupo / edad / sexo
    para la segmentacion. Se guardan con indices para que el archivo pese poco."""
    if not rows or not cutoff:
        return None
    last = date.fromisoformat(cutoff)
    first = date.fromordinal(last.toordinal() - last.weekday() - 7 * (DAILY_WEEKS - 1))
    campaigns, ads, by_ad, by_segment = {}, {}, {}, {}
    groups = {}
    for row in rows:
        if row['day'] < first or row['day'] > last:
            continue
        name = row['campaign']
        if name not in groups:
            groups[name] = group_of(name, row.get('objective'))
        offset = (row['day'] - first).days
        if for_segments(row):
            segment = (offset, groups[name], str(row.get('age') or '').strip() or '?', norm(row.get('sex')) or '?')
            add(by_segment.setdefault(segment, zero()), row)
        if not for_totals(row):
            continue
        campaign = campaigns.setdefault(name, len(campaigns))
        ad_name = str(row.get('ad') or '').strip() or '(sin nombre)'
        ad = ads.setdefault(ad_name, {'index': len(ads), 'url': None})
        url = row.get('preview')
        if not ad['url'] and isinstance(url, str) and url.startswith('https://'):
            ad['url'] = url
        add(by_ad.setdefault((offset, campaign, ad['index']), zero()), row)
    labels = {part: sorted({key[index] for key in by_segment}) for index, part in ((1, 'groups'), (2, 'ages'), (3, 'sexes'))}
    return {
        'firstDay': first.isoformat(),
        'lastDay': cutoff,
        'campaigns': [{'name': name, 'group': groups[name]} for name in campaigns],
        'ads': [{'name': name, 'url': info['url']} for name, info in ads.items()],
        'columns': ['d', 'campaign', 'ad'] + DAILY_FIELDS,
        'rows': [list(key) + compact(values, DAILY_FIELDS) for key, values in sorted(by_ad.items())],
        # Segmentacion por edad y sexo: grupo, edad y sexo van como indices de sus listas.
        'segments': {
            **labels,
            'columns': ['d', 'group', 'age', 'sex'] + SEGMENT_FIELDS,
            'rows': [[key[0], labels['groups'].index(key[1]), labels['ages'].index(key[2]), labels['sexes'].index(key[3])]
                     + compact(values, SEGMENT_FIELDS) for key, values in sorted(by_segment.items()) if values['spend'] > 0],
        },
    }


def build(drive):
    folder = os.path.join(drive, META_DIR)
    if not os.path.isdir(folder):
        sys.exit(f'No existe la carpeta {folder}')
    folder_id, ids = sheet_ids(drive)
    failed = failed_downloads(drive)
    warnings_list = [f'"{item["name"]}" (carpeta {name}) no se pudo descargar de Drive en esta sincronizacion '
                     f'({item["error"]}); se vuelve a intentar en la proxima.' for name, item in failed]
    months, all_rows = [], []
    for index, month in enumerate(MONTHS):
        paths = month_files(folder, month)
        entry = {'name': month, 'status': 'sin-datos', 'period': None, 'sheet': None, 'firstDay': None, 'lastDay': None,
                 'kpis': None, 'spendByGroup': {}, 'campaigns': []}
        months.append(entry)
        if not paths:
            continue
        file_name = os.path.basename(paths[0])
        entry['sheet'] = {'title': os.path.splitext(file_name)[0], 'id': ids.get(file_name)}
        # Una hoja mal formada no detiene la sincronizacion: el mes queda sin datos y el tablero lo avisa.
        try:
            rows = month_rows(paths)
        except ValueError as error:
            warnings_list.append(f'{month}: la hoja "{entry["sheet"]["title"]}" no se pudo leer '
                                 f'({str(error).split(": ", 1)[-1]}).')
            entry['notice'] = 'La hoja no se pudo leer'
            continue
        inside = [row for row in rows if row['day'].year == YEAR and row['day'].month == index + 1]
        if rows and not inside:
            days = sorted(row['day'] for row in rows)
            warnings_list.append(f'{month}: la hoja "{entry["sheet"]["title"]}" no trae dias de {month.lower()} '
                                 f'(sus fechas van del {short(days[0])} al {short(days[-1])}). Revisa que no sea una copia de otro mes.')
            entry['notice'] = 'La hoja no trae dias de este mes'
            continue
        all_rows.extend(inside)
        # Las cifras del mes salen de las filas que mandan; las de la exportacion de un dia que ya trae la
        # API quedan solo para el desglose por edad y sexo.
        main = [row for row in inside if for_totals(row)]
        campaigns = campaigns_of(main)
        if not campaigns:
            continue
        from_nexus = [row for row in main if row.get('nexus')]
        if from_nexus:
            # Lo que esos dias no traen se dice en la linea de fuente del tablero. Embudo, alcance y vista
            # previa se miran en los datos: el embudo y el enlace llegan de la exportacion del mismo dia
            # cuando la hay, y el alcance solo si el destino de Nexus lo manda.
            nexus_days = sorted({row['day'] for row in from_nexus})
            # El desglose de un dia sale de las filas `segment` de la API o, si no las hay, de la
            # exportacion; solo falta cuando no esta ninguno de los dos.
            con_desglose = ({row['day'] for row in inside if not row.get('nexus')}
                            | {row['day'] for row in inside if row.get('level') == 'segment'})
            missing = []
            if any(day not in con_desglose for day in nexus_days):
                missing.append('desglose por edad')
            if not any(isinstance(row.get('preview'), str) for row in from_nexus):
                missing.append('vista previa')
            if not any(num(row.get(key)) for row in from_nexus for key in FUNNEL):
                missing.insert(0, 'embudo')
            if not any(num(row.get('reach')) for row in from_nexus):
                missing.insert(0, 'alcance')
            entry['nexus'] = {'from': nexus_days[0].isoformat(), 'to': nexus_days[-1].isoformat(),
                              'days': len(nexus_days), 'missing': missing}
        unique = unique_reach([row for row in inside if row.get('only') == 'month'])
        if unique:
            entry['unique'] = unique
        totals = zero()
        for row in main:
            add(totals, row)
        days = sorted(row['day'] for row in main if num(row.get('spend')) > 0)
        by_group = {}
        for campaign in campaigns:
            by_group[campaign['group']] = round(by_group.get(campaign['group'], 0) + campaign['spend'], 2)
        entry.update({'firstDay': days[0].isoformat(), 'lastDay': days[-1].isoformat(), 'kpis': rounded(totals),
                      'spendByGroup': by_group, 'campaigns': campaigns, 'ads': ads_table(main)})

    with_data = [i for i, month in enumerate(months) if month['kpis']]
    cutoff = None
    for index in with_data:
        month = months[index]
        days_in_month = calendar.monthrange(YEAR, index + 1)[1]
        last = int(month['lastDay'][8:10])
        # Un mes con datos posteriores esta cerrado; el ultimo, si llega al penultimo dia (la pauta pudo
        # terminar antes). El mes en curso nunca: con datos del dia 30 daria por cerrado octubre entero,
        # y el tablero diria "1 - 31" y compararia contra septiembre completo estando a 30.
        running = (YEAR, index + 1) == (lima_today().year, lima_today().month)
        closed = index < with_data[-1] or (last >= days_in_month - 1 and not running)
        end = days_in_month if closed else last
        month['status'] = 'cerrado' if closed else 'parcial'
        month['period'] = f'1 - {end} {month["name"]} {YEAR}'
        cutoff = date(YEAR, index + 1, end).isoformat()
    for index in range(with_data[-1] if with_data else 0):
        month = months[index]
        # Si la hoja esta en Drive pero no bajo, ya tiene su aviso de descarga.
        if not month['sheet'] and not any(name == META_DIR and is_month_name(item['name'], month['name']) for name, item in failed):
            warnings_list.append(f'{month["name"]}: no hay hoja del mes en la carpeta de Drive.')
            month['notice'] = 'Sin hoja en la carpeta de Drive'
    return all_rows, {
        'account': 'The Little Market',
        'year': YEAR,
        'cutoff': cutoff,
        'generatedAt': date.today().isoformat(),
        # El boton "Sincronizar con Drive" del tablero espera a que cambie este sello para recargar.
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'Exportaciones de Meta Ads (Google Drive)',
        'platform': {'key': 'meta', 'label': 'Meta Ads', 'currency': CURRENCY, 'symbol': 'S/'},
        'folderId': folder_id or os.environ.get('TLM_META_FOLDER_ID', '1lpi0wzaLuwL3MWMKBNtHBHJyDBD6p8Ie'),
        # Orden de las columnas de months[].ads, que van en filas para que el archivo no pese el doble.
        'adColumns': AD_TABLE_COLUMNS,
        'warnings': warnings_list,
        'months': months,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', default=os.environ.get('TLM_DRIVE_ROOT', DEFAULT_DRIVE), help='Carpeta The Little Market en Google Drive')
    args = parser.parse_args()
    if not os.path.isdir(args.root):
        sys.exit(f'No existe la carpeta {args.root}')
    rows, data = build(args.root)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=1)
        handle.write('\n')
    daily = daily_table(rows, data['cutoff'])
    if daily:
        daily['syncedAt'] = data['syncedAt']
        with open(DAILY_OUT, 'w', encoding='utf-8', newline='\n') as handle:
            # Una fila por linea y sin espacios: legible en los diffs sin inflar el archivo.
            line = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            segments = daily['segments']
            head = ',\n'.join(f' "{key}": {line(value)}' for key, value in daily.items() if key not in ('rows', 'segments'))
            seg_head = ',\n'.join(f'  "{key}": {line(value)}' for key, value in segments.items() if key != 'rows')
            handle.write('{\n' + head + ',\n "rows": [\n' + ',\n'.join(line(row) for row in daily['rows']) + '\n ],\n'
                         ' "segments": {\n' + seg_head + ',\n  "rows": [\n' + ',\n'.join(line(row) for row in segments['rows'])
                         + '\n  ]\n }\n}\n')
        print(f'[diario] escrito {os.path.relpath(DAILY_OUT, ROOT)} ({daily["firstDay"]} a {daily["lastDay"]}, '
              f'{len(daily["rows"])} filas, {len(daily["segments"]["rows"])} de segmentacion)')
    for month in data['months']:
        if not month['kpis']:
            continue
        k = month['kpis']
        roas = k['revenue'] / k['spend'] if k['spend'] else 0
        print(f"{month['name']:<11} {month['status']:<8} S/ {k['spend']:>9,.2f} | {k['purchases']:>3} compras "
              f"S/ {k['revenue']:>9,.2f} (ROAS {roas:.2f}) | {k['conversations']:>4} conversaciones | {len(month['campaigns'])} campanas")
    for warning in data['warnings']:
        print(f'[aviso] {warning}')
    print(f'[ads] escrito {os.path.relpath(OUT, ROOT)} (corte {data["cutoff"]})')


if __name__ == '__main__':
    main()
