#!/usr/bin/env python3
"""Static SEO and link checks for public/. Run from the repository root: python3 tools/check-site.py"""
import glob, html, json, os, re, sys, xml.etree.ElementTree as ET
ROOT = 'public'; BASE = 'https://www.via77.com.au'
DEMOS = ('forme', 'atelier-09', 'still-house', 'aliyaskin', 'fern-and-field', 'uppers', 'salim', 'glassi')
problems = []; titles = {}; descs = {}; indexable = set()
redirects = {l.split()[0] for l in open(f'{ROOT}/_redirects') if l.strip() and not l.startswith('#')}
def exists(path):
    path = path.split('#')[0].split('?')[0]
    if not path or path in redirects or path.rstrip('/') in redirects: return True
    if any(r.endswith('/*') and path.startswith(r[:-1]) for r in redirects): return True
    p = ROOT + path
    return os.path.isfile(p) or os.path.isfile(p + 'index.html') or os.path.isfile(p + '/index.html') or os.path.isfile(p + '.html')
for f in sorted(glob.glob(f'{ROOT}/**/*.html', recursive=True)):
    s = open(f, encoding='utf8', errors='ignore').read(); rel = f[len(ROOT):]
    url = re.sub(r'index\.html$', '', rel)
    demo = rel.split('/')[1] in DEMOS
    g = lambda p: (re.search(p, s, re.I | re.S) or [None, ''])[1]
    robots = g(r'<meta[^>]+name=["\']robots["\'][^>]+content=["\'](.*?)["\']')
    links = re.findall(r'<a\b[^>]*\bhref="(/[^"]*)"', s)
    for h in links:
        if "'" not in h and not exists(h): problems.append(f'{rel}: broken link {h}')
    if demo:
        if 'noindex' not in robots: problems.append(f'{rel}: demo store is missing noindex')
        if 'application/ld+json' in s and '"Product"' in s: problems.append(f'{rel}: demo store has Product markup')
        continue
    if rel == '/404.html':
        if 'noindex' not in robots: problems.append('404: missing noindex')
        continue
    title = html.unescape(g(r'<title[^>]*>(.*?)</title>')); desc = html.unescape(g(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']'))
    canon = g(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\'](.*?)["\']')
    if canon != BASE + url: problems.append(f'{rel}: canonical is {canon}')
    if 'noindex' in robots: problems.append(f'{rel}: unexpected noindex')
    else: indexable.add(url)
    if len(re.findall(r'<h1\b', s, re.I)) != 1: problems.append(f'{rel}: needs exactly one h1')
    if not 20 <= len(title) <= 65: problems.append(f'{rel}: title length {len(title)}: {title}')
    if not 70 <= len(desc) <= 165: problems.append(f'{rel}: description length {len(desc)}')
    if title in titles: problems.append(f'{rel}: duplicate title with {titles[title]}')
    if desc in descs: problems.append(f'{rel}: duplicate description with {descs[desc]}')
    titles[title] = rel; descs[desc] = rel
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try: json.loads(block)
        except ValueError as err: problems.append(f'{rel}: invalid JSON-LD: {err}')
    for src in re.findall(r'(?:src|srcset)="(/[^" ]+)', s) + re.findall(r' (/[^" ,]+\.webp) \d+w', s):
        if not exists(src): problems.append(f'{rel}: missing asset {src}')
    for img in re.findall(r'<img\b[^>]*>', s):
        if 'alt=' not in img: problems.append(f'{rel}: image without alt: {img[:80]}')
    levels = [int(x) for x in re.findall(r'<h([1-6])\b', re.sub(r'<footer.*?</footer>', '', s, flags=re.S))]
    for a, b in zip(levels, levels[1:]):
        if b > a + 1: problems.append(f'{rel}: heading jump h{a} to h{b}'); break
    text = re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style).*?</\1>', ' ', s, flags=re.S))
    for bad in ['Launching on Shopify', 'Shazil', 'number one', 'award-winning', 'Lorem', 'TBC', 'TODO']:
        if bad in text: problems.append(f'{rel}: contains "{bad}"')
ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
mapped = {u.text[len(BASE):] for u in ET.parse(f'{ROOT}/sitemap.xml').getroot().findall('s:url/s:loc', ns)}
for u in sorted(mapped - indexable): problems.append(f'sitemap lists non-indexable or missing {u}')
for u in sorted(indexable - mapped): problems.append(f'indexable page missing from sitemap {u}')
print(f'{len(indexable)} indexable pages, {len(mapped)} in sitemap, {len(problems)} problems')
print('\n'.join(problems))
sys.exit(1 if problems else 0)
