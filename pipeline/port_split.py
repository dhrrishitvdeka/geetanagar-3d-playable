"""One-off Milestone 1 tool: split the single-file prototype (legacy/current_build.html)
into ES modules under src/, generating import/export lists from top-level declarations.
Kept for provenance; the generated modules are now edited by hand.

usage: python pipeline/port_split.py  (run from the project root)
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, 'legacy', 'current_build.html'), encoding='utf8').read()
a = html.find('<script type="module">') + len('<script type="module">')
js = html[a:html.find('</script>', a)]
lines = js.split('\n')
# drop the embedded GEO line; the remaining numbering matches code.js used while planning
gi = next(i for i, l in enumerate(lines) if l.startswith('const GEO = '))
lines = lines[:gi] + lines[gi + 1:]
L = lambda a, b: lines[a - 1:b]  # 1-based inclusive

MODULES = {
    'core/context.js': [(11, 21)],
    'core/geo.js': [(22, 58), (1140, 1140)],
    'world/lighting.js': [(60, 80)],
    'world/terrain.js': [(82, 120), (1475, 1488)],
    'world/buildings.js': [(122, 227)],
    'ui/labels.js': [(229, 248)],
    'ui/controls.js': [(250, 357)],
    'ui/minimap.js': [(359, 398)],
    'main.js': [(400, 446)],
    'world/materials.js': [(450, 506), (927, 934)],
    'world/geom.js': [(508, 588), (660, 669)],
    'world/mainroad.js': [(590, 643)],
    'world/streets.js': [(645, 658), (670, 765)],
    'world/deck.js': [(770, 845)],
    'world/sky.js': [(846, 866)],
    'world/outer.js': [(868, 923)],
    'world/landmarks.js': [(935, 947), (1139, 1139), (1141, 1158)],
    'world/mandir.js': [(948, 1036)],
    'world/shops.js': [(1038, 1137)],
    'world/streetlife.js': [(1161, 1299)],
    'veg/assets.js': [(1302, 1325)],
    'veg/trees.js': [(1327, 1422)],
    'veg/grass.js': [(1424, 1474)],
}

def split_decls(stmt):
    """names declared by 'const|let a = .., [b, c] = .., d' (stmt excludes the keyword)"""
    names, depth, cur, i, q = [], 0, '', 0, None
    parts = []
    while i < len(stmt):
        ch = stmt[i]
        if q:
            cur += ch
            if ch == '\\': cur += stmt[i + 1]; i += 1
            elif ch == q: q = None
        elif ch in '\'"`': q = ch; cur += ch
        elif ch in '([{': depth += 1; cur += ch
        elif ch in ')]}': depth -= 1; cur += ch
        elif ch == ',' and depth == 0: parts.append(cur); cur = ''
        elif ch == ';' and depth == 0: break
        else: cur += ch
        i += 1
    parts.append(cur)
    for p in parts:
        lhs = p.split('=')[0].strip()
        if lhs.startswith('['): names += [n.strip() for n in lhs[1:lhs.index(']')].split(',') if n.strip()]
        elif re.match(r'^[A-Za-z_$][\w$]*$', lhs): names.append(lhs)
    return names

def top_names(code):
    out = []
    for m in re.finditer(r'^(?:async\s+)?function\s+([\w$]+)', code, re.M): out.append(m.group(1))
    for m in re.finditer(r'^(?:const|let)\s+', code, re.M): out += split_decls(code[m.end():])
    return out

src = {k: '\n'.join(sum((L(a, b) for a, b in v), [])) for k, v in MODULES.items()}
# GEO used to be inlined; it is now fetched from data/geo.json (top-level await)
src['core/geo.js'] = ("import geoUrl from '../../data/geo.json?url';\n"
                      "const GEO = await (await fetch(geoUrl)).json();\n") + src['core/geo.js']
decl = {k: top_names(c) for k, c in src.items()}
owner = {}
for k, ns in decl.items():
    for n in ns:
        if n in owner: print('DUPLICATE', n, owner[n], k, file=sys.stderr)
        owner[n] = k

ADDONS = {
    'OrbitControls': 'three/addons/controls/OrbitControls.js',
    'mergeGeometries': 'three/addons/utils/BufferGeometryUtils.js',
    'GLTFLoader': 'three/addons/loaders/GLTFLoader.js',
    'EXRLoader': 'three/addons/loaders/EXRLoader.js',
}

def rel(frm, to):
    r = os.path.relpath(to, os.path.dirname(frm)).replace('\\', '/')
    return r if r.startswith('.') else './' + r

for k, code in src.items():
    bare = re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"", "''", code)  # string bodies
    bare = re.sub(r'(^|[\s;{}(),])//[^\n]*', r'\1', bare)                       # line comments
    bare = re.sub(r'/\*.*?\*/', '', bare, flags=re.S)
    used = set(re.findall(r'(?<![\.\w$])([A-Za-z_$][\w$]*)', bare))
    head = ["import * as THREE from 'three';"]
    for n, path in ADDONS.items():
        if n in used: head.append(f"import {{ {n} }} from '{path}';")
    by = {}
    for n in sorted(used):
        o = owner.get(n)
        if o and o != k: by.setdefault(o, []).append(n)
    for o in sorted(by): head.append(f"import {{ {', '.join(by[o])} }} from '{rel(k, o)}';")
    exp = [n for n in decl[k]]
    tail = f"\nexport {{ {', '.join(exp)} }};\n" if exp and k != 'main.js' else '\n'
    out = os.path.join(ROOT, 'src', k)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf8', newline='\n').write('\n'.join(head) + '\n\n' + code.strip('\n') + '\n' + tail)
    print(f'{k:24s} {len(code.splitlines()):4d} lines, {len(exp)} exports, imports from {len(by)} modules')
