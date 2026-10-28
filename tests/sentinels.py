"""Plaintext sentinels for ciphertext scans (00.07.000). Short markers such as 'XYZ' can turn up in random base64 by chance,
so tests seed every plaintext field with a long unique sentinel and then search both the raw file text and the base64-decoded
ciphertext bytes for every one of them. Fictional test data only."""
import base64, hashlib, json, re
PREFIX = "QA_PLAINTEXT_SENTINEL_"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}([T ][\d:.]+([+-]\d{2}:\d{2}|Z)?)?$")
def sentinel(path): return PREFIX + hashlib.sha256(path.encode()).hexdigest()[:16]
def seed(obj, skip=(), domain_keys=(), url_keys=(), id_keys=("id",), path="$"):
    """Returns (seeded copy, sentinels, id_map). Format-constrained fields keep a valid shape: dates/enums in `skip` are left
    as they are, domains become qs-<hex>.example, URLs get ?q=<sentinel>, ids get -<sentinel>, free text is prefixed."""
    sents, ids = [], {}
    def walk(v, key, p):
        if isinstance(v, dict): return {k: walk(x, k, f"{p}.{k}") for k, x in v.items()}
        if isinstance(v, list): return [walk(x, key, f"{p}[{i}]") for i, x in enumerate(v)]
        if not isinstance(v, str) or key in skip or ISO.match(v): return v
        s = sentinel(p)
        if key in domain_keys: d = "qs-" + s[len(PREFIX):] + ".example"; sents.append(d); return d
        if key in url_keys: sents.append(s); return v + ("&" if "?" in v else "?") + "q=" + s
        if key in id_keys:   # ids and references to them map the same value to the same new id
            s = sentinel("id:" + v); n = v + "-" + s; ids[v] = n
            if s not in sents: sents.append(s)
            return n
        sents.append(s); return s + " " + v
    return walk(obj, None, path), sents, ids
def _payloads(text):
    out = [text.encode()]
    try:
        o = json.loads(text)
        for k in ("ct", "iv", "env"):
            if isinstance(o, dict) and isinstance(o.get(k), str):
                try: out.append(base64.b64decode(o[k] + "=" * (-len(o[k]) % 4)))
                except Exception: pass
                if k == "env": out.extend(_payloads(o[k]))
    except Exception: pass
    return out
def leaks(texts, sents):
    """texts: {name: text}. Returns [(name, sentinel)] for every sentinel found in the raw text or the decoded ciphertext bytes."""
    found = []
    for n, t in texts.items():
        bufs = _payloads(t)
        for s in sents:
            if any(s.encode() in b for b in bufs): found.append((n, s))
    return found
