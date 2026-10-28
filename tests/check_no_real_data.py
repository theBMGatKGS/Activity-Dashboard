#!/usr/bin/env python3
"""T15 (plan §5): fail if any file that would be committed contains real-looking data.
Checks: email addresses whose domain isn't a reserved .example domain; phone numbers; currency amounts;
domains other than *.example and the two internal-rule domains; people outside the example allowlist in data files.
Git-ignored files (Data/inbox-snapshot.*, Data/notebook-log.js, exports) are skipped: they never get committed."""
import pathlib, re, sys, fnmatch
ROOT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1]
gi = ROOT / ".gitignore"; ignore = [l.strip() for l in gi.read_text().splitlines() if l.strip() and not l.startswith("#")] if gi.exists() else []
ALLOWED_DOMAINS = {"example.com", "example.net"}  # internal-domain rules only (plan §15, QA check 1)
PEOPLE = {"Jordan P.", "Alex R.", "Priya M.", "Chris T.", "Sam K.", "Dana L."}
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
PHONE = re.compile(r"(?<![\d.])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)")
MONEY = re.compile(r"(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP)\b)")
DOMAIN = re.compile(r"\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|us|uk|de)\b", re.I)
PERSON = re.compile(r'"person":\s*"([^"]+)"')
TEXT = {".png", ".woff2", ".js", ".json", ".md", ".html", ".css", ".py", ".sh", ".txt", ".csv", ""}
import hashlib
# Optional private denylist: set DASH_DENYLIST to a file kept OUTSIDE the repo, one sha256(term.lower())[:16] per line.
import os
_dl = os.environ.get("DASH_DENYLIST")
DENY = set(open(_dl).read().split()) if _dl and os.path.exists(_dl) else set()
TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
def denied(text):
    hits = set()
    for m in TOKEN.finditer(text.lower()):
        tok = m.group(0)
        for part in {tok, *tok.split("-")}:
            if hashlib.sha256(part.encode()).hexdigest()[:16] in DENY: hits.add(part)
    return hits
bad = []
for f in sorted(ROOT.rglob("*")):
    rel = f.relative_to(ROOT).as_posix()
    if not f.is_file() or f.suffix not in TEXT or any(fnmatch.fnmatch(rel, g) for g in ignore) or rel.startswith(".git/"): continue
    if rel == "tests/check_no_real_data.py": continue
    t = f.read_bytes().decode("latin-1") if f.suffix in (".png", ".woff2") else f.read_text(errors="ignore")
    for w in sorted(denied(t)): bad.append(f"{rel}: denylisted term {w}")
    for m in EMAIL.finditer(t):
        if not m.group(1).lower().endswith(".example"): bad.append(f"{rel}: email {m.group(0)}")
    noisy = f.suffix == ".woff2"   # compressed font bytes: money/phone patterns match random bytes, so only denylist, email and domain checks apply
    if rel == "tests/fixtures/example-guard-fixtures.json": noisy = True   # 00.07.000: explicit money/email guard fixtures (fictional); domain, denylist and email checks still apply
    for m in ([] if noisy else PHONE.finditer(t)): bad.append(f"{rel}: phone-like {m.group(0)}")
    for m in ([] if noisy else MONEY.finditer(t)):
        if not re.fullmatch(r"\$\d", m.group(0)): bad.append(f"{rel}: money {m.group(0)}")
    for m in DOMAIN.finditer(t):
        d = m.group(0).lower()
        if m.start() > 0 and t[m.start() - 1] == ".": continue  # a suffix hint such as ".co.uk" in the rules list
        if d not in ALLOWED_DOMAINS and not d.endswith(".example") and not re.match(r"^(superdesign\.dev|github\.com|api\.github\.com|scripts\.sil\.org|teams\.microsoft\.com|maps\.apple\.com|schemas\.openxmlformats\.org)$", d): bad.append(f"{rel}: domain {d}")
    if rel.startswith(("Data/", "examples/")) or rel.endswith(".json"):
        for m in PERSON.finditer(t):
            if m.group(1) not in PEOPLE and m.group(1) != "Me": bad.append(f"{rel}: person not in example allowlist: {m.group(1)}")
for b in bad: print("FAIL", b)
print("T15 no-real-data:", "PASS" if not bad else f"FAIL ({len(bad)})"); raise SystemExit(1 if bad else 0)
