import json
import urllib.request

CRM_BASE = "http://80.78.243.138/api/webhook"
API_KEY = "8FqtNnz7TD2Zyvx"
PASSWORD = "Deboshir123321"


def fetch(url):
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "Mozilla/5.0")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def handler(event: dict, context) -> dict:
    """Тестовый зонд — смотрим структуру CRM API склада"""
    results = {}

    # Типы товаров
    try:
        results["types"] = fetch(f"{CRM_BASE}/storage/types?api_key={API_KEY}")
    except Exception as e:
        results["types_error"] = str(e)

    # Первые товары (без фильтра)
    try:
        data = fetch(f"{CRM_BASE}/storage?api_key={API_KEY}")
        if isinstance(data, list):
            results["items_sample"] = data[:3]
            results["items_total"] = len(data)
        else:
            results["items_raw"] = data
    except Exception as e:
        results["items_error"] = str(e)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(results, ensure_ascii=False, indent=2),
    }