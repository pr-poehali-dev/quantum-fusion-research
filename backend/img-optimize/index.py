import json
import os
import io
import hashlib
import urllib.request

import boto3
from PIL import Image


def _slug_from_url(url: str) -> str:
    '''Детерминированное короткое имя из URL — чтобы один и тот же оригинал
    всегда давал один и тот же набор webp (идемпотентность).'''
    return 'auto-' + hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]


def _resp(status: int, body: dict):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'isBase64Encoded': False,
        'body': json.dumps(body, ensure_ascii=False),
    }


def handler(event: dict, context) -> dict:
    '''Сжимает картинку по URL в WebP в нескольких размерах и кладёт в S3.
    Возвращает ссылки на готовые webp-версии (для srcset).
    Тело запроса: {"url": "https://...", "name": "banner-podbor", "widths": [480,960,1440], "quality": 80}
    '''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    ensure = False
    if method == 'GET':
        qs = event.get('queryStringParameters') or {}
        src_url = qs.get('url')
        ensure = qs.get('ensure') in ('1', 'true', 'yes')
        name = (qs.get('name') or '').strip().replace('/', '_')
        widths_raw = qs.get('widths')
        widths = [int(x) for x in widths_raw.split(',')] if widths_raw else [480, 768, 1024]
        quality = int(qs.get('quality') or 80)
        if ensure and src_url and not name:
            name = _slug_from_url(src_url)
    elif method == 'POST':
        raw_body = event.get('body')
        if not raw_body:
            return _resp(400, {'error': 'empty body'})
        try:
            body = json.loads(raw_body)
        except Exception:
            return _resp(400, {'error': 'body is not valid JSON'})
        src_url = body.get('url')
        name = (body.get('name') or 'image').strip().replace('/', '_')
        widths = body.get('widths') or [480, 768, 1024]
        quality = int(body.get('quality') or 80)
    else:
        return _resp(405, {'error': 'Use GET or POST'})

    if not src_url:
        return _resp(400, {'error': 'url is required'})

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    akid = os.environ['AWS_ACCESS_KEY_ID']
    widths_sorted = sorted(set(int(x) for x in widths))

    def cdn_for(w):
        return f'https://cdn.poehali.dev/projects/{akid}/bucket/optimized/{name}-{w}.webp'

    # ensure: если webp уже созданы ранее — не пересжимаем, сразу отдаём ссылки.
    if ensure:
        try:
            existing = s3.head_object(Bucket='files', Key=f'optimized/{name}-{widths_sorted[0]}.webp')
            if existing:
                variants = [{'width': w, 'url': cdn_for(w)} for w in widths_sorted]
                return _resp(200, {'source': src_url, 'cached': True, 'variants': variants})
        except Exception:
            pass  # нет — создаём ниже

    try:
        req = urllib.request.Request(src_url, headers={'User-Agent': 'img-optimize/1.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
    except Exception as e:
        return _resp(502, {'error': 'download failed', 'detail': str(e)})

    try:
        src = Image.open(io.BytesIO(raw)).convert('RGB')
        src.load()
        orig_w, orig_h = src.size
    except Exception as e:
        return _resp(422, {'error': 'cannot open image', 'detail': str(e)})

    results = []
    for w in widths_sorted:
        target_w = min(w, orig_w)
        target_h = max(1, round(orig_h * target_w / orig_w))
        img = src.resize((target_w, target_h), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format='WEBP', quality=quality, method=4)
        data = buf.getvalue()

        key = f'optimized/{name}-{w}.webp'
        s3.put_object(
            Bucket='files',
            Key=key,
            Body=data,
            ContentType='image/webp',
            CacheControl='public, max-age=31536000, immutable',
        )
        results.append({'width': w, 'url': f'https://cdn.poehali.dev/projects/{akid}/bucket/{key}', 'bytes': len(data)})

    return _resp(200, {
        'source': src_url,
        'original': {'width': orig_w, 'height': orig_h, 'bytes': len(raw)},
        'variants': results,
    })