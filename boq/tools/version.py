#!/usr/bin/env python3
"""Stamp a version on every module URL in index.html (import map), so browsers
never mix freshly deployed files with old cached ones. Run before each deploy."""
import json, os, re, time
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
v = time.strftime("%Y%m%d%H%M")
mods = sorted(f"./js/{f}" for f in os.listdir(os.path.join(root, "js")) if f.endswith(".js"))
mods += [f"./vendor/{f}" for f in sorted(os.listdir(os.path.join(root, "vendor"))) if f.endswith((".mjs", ".esm.min.js"))]
imap = {"imports": {m: f"{m}?v={v}" for m in mods}}
html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
block = f'<script type="importmap" id="versions">{json.dumps(imap, separators=(",", ":"))}</script>'
if 'id="versions"' in html:
    html = re.sub(r'<script type="importmap" id="versions">.*?</script>', block, html, flags=re.S)
else:
    html = html.replace('<script src="vendor/xlsx.full.min.js"></script>', '<script src="vendor/xlsx.full.min.js"></script>\n  ' + block)
html = re.sub(r'<script type="module" src="js/app\.js(\?v=\d+)?"></script>', f'<script type="module" src="js/app.js?v={v}"></script>', html)
html = re.sub(r'src="vendor/xlsx\.full\.min\.js(\?v=\d+)?"', f'src="vendor/xlsx.full.min.js?v={v}"', html)
html = re.sub(r'href="styles\.css(\?v=\d+)?"', f'href="styles.css?v={v}"', html)
open(os.path.join(root, "index.html"), "w", encoding="utf-8").write(html)
print("version", v, "modules", len(mods))
