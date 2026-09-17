#!/usr/bin/env python3
import hashlib, json, os, re, sys, time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except Exception as e:
    print("Dependencias faltantes: requests, beautifulsoup4", file=sys.stderr)
    raise

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "opportunities.json")
UA = "M&M-Radar/1.0 (+public procurement monitor; contact: GitHub cargazul33/mm-radar)"
TIMEOUT = 18
MAX_PAGES_PER_SOURCE = 35
TODAY = datetime.now().date()

SOURCES = [
    {
        "name": "Licitaciones Provincia del Neuquén",
        "url": "https://licitaciones.neuquen.gov.ar/",
        "allowed_hosts": {"licitaciones.neuquen.gov.ar"},
        "follow": ("licit", "concurso", "compra", "contrat", "pliego", "detalle", "?id="),
    },
    {
        "name": "Boletín Oficial del Neuquén",
        "url": "https://boficial.neuquen.gov.ar/",
        "allowed_hosts": {"boficial.neuquen.gov.ar", "infoleg.neuquen.gov.ar"},
        "follow": ("boletindetalle", "licit", "boletin", "detalle?id="),
    },
    {
        "name": "CO.DI.NEU / Contaduría General",
        "url": "https://www.contadurianeuquen.gob.ar/co-di-neu/",
        "allowed_hosts": {"www.contadurianeuquen.gob.ar", "contadurianeuquen.gob.ar"},
        "follow": ("co-di-neu", "codi", "proveedor", "licit", "compra"),
    },
]

INCLUDE = [
    "informat", "comput", "notebook", "pc ", "impresora", "toner", "tóner", "cartucho",
    "router", "switch", "access point", "wifi", "wi-fi", "redes", "servidor", "ups",
    "librer", "papeler", "resma", "útiles", "utiles", "oficina", "mobiliario", "silla",
    "electrodom", "heladera", "freezer", "microondas", "televisor", "tv ", "monitor",
    "aire acondicionado", "climat", "herramienta", "taladro", "amoladora", "motosierra",
    "electrónica", "electronica", "tecnolog", "cámara", "camara", "proyector", "celular",
]
EXCLUDE = [
    "medicamento", "hospital", "insumo médico", "insumo medico", "salud", "policía", "policia",
    "obra pública", "obra publica", "construcción", "construccion", "hormigón", "hormigon",
    "retroexcavadora", "motoniveladora", "equipo vial", "paviment", "movimiento de suelo",
]
MONTHS = {
    "enero":1,"febrero":2,"marzo":3,"abril":4,"mayo":5,"junio":6,
    "julio":7,"agosto":8,"septiembre":9,"setiembre":9,"octubre":10,"noviembre":11,"diciembre":12,
}

DATE_PATTERNS = [
    re.compile(r"(?:fecha\s+(?:y\s+hora\s+)?(?:de\s+)?(?:apertura|cierre)|apertura|cierre|recepci[oó]n\s+de\s+ofertas)[^\n]{0,80}?(\d{1,2})[/-](\d{1,2})[/-](20\d{2})", re.I),
    re.compile(r"(?:fecha\s+(?:y\s+hora\s+)?(?:de\s+)?(?:apertura|cierre)|apertura|cierre)[^\n]{0,80}?(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(20\d{2})", re.I),
]
OBJ_PATTERNS = [
    re.compile(r"(?:Objeto|OBJETO)\s*[:\-]\s*([^\n]{8,220})"),
    re.compile(r"(?:Licitaci[oó]n|Concurso|Contrataci[oó]n)[^\n]{0,120}\n([^\n]{8,220})", re.I),
]
NUMBER_PATTERN = re.compile(r"((?:Licitaci[oó]n\s+P[uú]blica|Concurso\s+de\s+Precios|Contrataci[oó]n\s+Directa|Compulsa)[^\n]{0,90})", re.I)
AMOUNT_PATTERN = re.compile(r"(?:presupuesto\s+oficial|precio\s+estimado|monto\s+estimado)[^$\d]{0,40}\$?\s*([\d\.]+(?:,\d{2})?)", re.I)


def clean(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def parse_date(text):
    for i, pat in enumerate(DATE_PATTERNS):
        m = pat.search(text)
        if not m: continue
        try:
            if i == 0:
                d, mo, y = map(int, m.groups())
            else:
                d, mon, y = m.groups(); d=int(d); y=int(y); mo=MONTHS.get(mon.lower())
                if not mo: continue
            return datetime(y, mo, d).date().isoformat()
        except Exception:
            pass
    return None


def classify(text):
    t = text.lower()
    inc = [k for k in INCLUDE if k in t]
    exc = [k for k in EXCLUDE if k in t]
    if "aire acondicionado" in t or "climat" in t:
        exc = [k for k in exc if k not in ("construcción", "construccion", "obra pública", "obra publica")]
    return inc, exc


def fetch(session, url):
    r = session.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if "text/html" not in ct and "application/xhtml" not in ct:
        return None, str(r.url), ct
    return r.text, str(r.url), ct


def candidate_from_page(url, title, text, links, source_name):
    low = text.lower()
    if not any(w in low for w in ("licitaci", "concurso", "contrataci", "compra", "adquisici", "pliego")):
        return None
    number = None
    m = NUMBER_PATTERN.search(text)
    if m: number = clean(m.group(1))
    obj = None
    for pat in OBJ_PATTERNS:
        m = pat.search(text)
        if m:
            obj = clean(m.group(1)); break
    if not obj:
        obj = clean(title)
    if not obj or len(obj) < 8:
        return None
    context = clean(" ".join([number or "", obj, text[:8000]]))
    inc, exc = classify(context)
    if exc or not inc:
        return None
    closing = parse_date(text)
    if closing:
        try:
            if datetime.fromisoformat(closing).date() < TODAY:
                return None
        except Exception:
            pass
    pliego = None
    for label, href in links:
        l = (label + " " + href).lower()
        if any(k in l for k in ("pliego", ".pdf", "bases y condiciones", "descargar")):
            pliego = href; break
    amount = None
    am = AMOUNT_PATTERN.search(text)
    if am:
        raw = am.group(1).replace(".", "").replace(",", ".")
        try: amount = float(raw)
        except Exception: amount = None
    score = 35 + min(25, len(set(inc))*5)
    if closing: score += 10
    if pliego: score += 15
    if amount is not None: score += 5
    score = min(100, score)
    oid = hashlib.sha256((url + "|" + obj).encode("utf-8")).hexdigest()[:16]
    return {
        "id": oid,
        "title": obj,
        "number": number,
        "organization": source_name,
        "source_url": url,
        "pliego_url": pliego,
        "closing_date": closing,
        "estimated_amount": amount,
        "fit_keywords": sorted(set(inc))[:12],
        "score": score,
        "verification": {"source": True,"pliego": bool(pliego),"product": False,"price": False,"stock": False},
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "status": "NUEVA"
    }


def crawl_source(src):
    session = requests.Session()
    q = [(src["url"], 0)]
    seen = set(); items=[]; errors=[]
    while q and len(seen) < MAX_PAGES_PER_SOURCE:
        url, depth = q.pop(0)
        if url in seen: continue
        seen.add(url)
        try:
            html, final_url, ct = fetch(session, url)
            if html is None: continue
            soup = BeautifulSoup(html, "html.parser")
            for bad in soup(["script","style","noscript"]): bad.decompose()
            title = clean(soup.title.get_text(" ") if soup.title else "")
            text = "\n".join(clean(x) for x in soup.stripped_strings)
            links=[]
            for a in soup.find_all("a", href=True):
                href=urljoin(final_url, a["href"])
                label=clean(a.get_text(" "))
                links.append((label, href))
            cand = candidate_from_page(final_url, title, text, links, src["name"])
            if cand: items.append(cand)
            if depth < 2:
                for label, href in links:
                    p=urlparse(href)
                    if p.scheme not in ("http","https") or p.netloc not in src["allowed_hosts"]: continue
                    key=(label+" "+href).lower()
                    if any(tok in key for tok in src["follow"]):
                        if href not in seen and len(q) < MAX_PAGES_PER_SOURCE*2:
                            q.append((href, depth+1))
        except Exception as e:
            errors.append({"url":url,"error":f"{type(e).__name__}: {e}"[:300]})
        time.sleep(0.15)
    ded={}
    for it in items: ded[it["id"]]=it
    return list(ded.values()), errors, len(seen)


def main():
    all_items=[]; errors=[]; source_states=[]
    for src in SOURCES:
        items, errs, pages = crawl_source(src)
        all_items.extend(items); errors.extend(errs)
        source_states.append({"name":src["name"],"url":src["url"],"pages_checked":pages,"matches":len(items),"ok":pages>0})
    ded={}
    for it in all_items:
        old=ded.get(it["id"])
        if not old or it["score"] > old["score"]: ded[it["id"]]=it
    items=sorted(ded.values(), key=lambda x: (x.get("closing_date") or "9999-12-31", -x.get("score",0)))
    out={
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": source_states,
        "opportunities": items,
        "errors": errors[:50],
        "note": "Datos generados automáticamente solo desde páginas públicas oficiales; verificar pliego y stock antes de cotizar."
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT,"w",encoding="utf-8") as f: json.dump(out,f,ensure_ascii=False,indent=2)
    print(f"Oportunidades: {len(items)} | errores: {len(errors)}")

if __name__ == "__main__": main()
