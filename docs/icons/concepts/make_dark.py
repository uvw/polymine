"""Builds icon-dark.html and its dark-*.svg files: the realistic mine on six dark plates."""

import math
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]

def mine(p, uid):
    """The realistic mine on a plate. p holds CSS color strings."""
    s = lambda c: f'style="stop-color:{c}"'
    spikes, caps = [], []
    for k in range(8):
        a = k * math.pi / 4
        x1, y1 = 50 + 18 * math.cos(a), 50 + 18 * math.sin(a)
        x2, y2 = 50 + 33 * math.cos(a), 50 + 33 * math.sin(a)
        spikes.append(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="url(#{uid}sp)" stroke-width="7" stroke-linecap="round"/>'
        )
        cap = p.get("spark") if (p.get("spark") and k == 7) else p["cap"]
        caps.append(f'<circle cx="{x2:.2f}" cy="{y2:.2f}" r="3.6" style="fill:{cap}"/>')
    extra = ""
    if p.get("pattern"):
        extra = pattern(uid, p["pattern"])
    if p.get("spark"):
        sx, sy = 50 + 33 * math.cos(7 * math.pi / 4), 50 + 33 * math.sin(7 * math.pi / 4)
        caps.append(
            f'<circle cx="{sx:.2f}" cy="{sy:.2f}" r="9" fill="url(#{uid}sk)"/>'
        )
    gloss = ""
    if p.get("gloss"):
        gloss = (
            f'<path d="M8 28 Q8 8 28 8 H72 Q92 8 92 28 V40 Q50 30 8 46 Z" '
            f'fill="#fff" opacity="{p["gloss"]}"/>'
        )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
<linearGradient id="{uid}pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" {s(p['plate_top'])}/><stop offset="1" {s(p['plate_bot'])}/></linearGradient>
<radialGradient id="{uid}ha" cx="0.5" cy="0.5" r="0.5"><stop offset="0" {s(p['halo'])} stop-opacity="{p.get('halo_op', 0.55)}"/><stop offset="1" {s(p['halo'])} stop-opacity="0"/></radialGradient>
<radialGradient id="{uid}ba" cx="0.38" cy="0.35" r="0.75"><stop offset="0" {s(p['ball_hi'])}/><stop offset="0.35" {s(p['ball_mid'])}/><stop offset="1" {s(p['ball_lo'])}/></radialGradient>
<linearGradient id="{uid}sp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" {s(p['spike_hi'])}/><stop offset="1" {s(p['spike_lo'])}/></linearGradient>
<radialGradient id="{uid}sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="{uid}sk" cx="0.5" cy="0.5" r="0.5"><stop offset="0" {s(p.get('spark', '#fff'))} stop-opacity="0.9"/><stop offset="1" {s(p.get('spark', '#fff'))} stop-opacity="0"/></radialGradient>
<clipPath id="{uid}cl"><rect x="4" y="4" width="92" height="92" rx="20"/></clipPath>
</defs>
<rect x="4" y="4" width="92" height="92" rx="20" fill="url(#{uid}pl)"/>
<g clip-path="url(#{uid}cl)">{extra}<circle cx="50" cy="50" r="40" fill="url(#{uid}ha)"/>{gloss}</g>
<rect x="5" y="5" width="90" height="90" rx="19" fill="none" style="stroke:{p['edge']}" stroke-opacity="{p.get('edge_op', 0.35)}" stroke-width="1.5"/>
<ellipse cx="52" cy="79" rx="26" ry="6" fill="url(#{uid}sh)"/>
{''.join(spikes)}{''.join(caps)}
<circle cx="50" cy="50" r="22" fill="url(#{uid}ba)"/>
<circle cx="50" cy="50" r="21.3" fill="none" style="stroke:{p['rim']}" stroke-opacity="{p.get('rim_op', 0.5)}" stroke-width="1.2"/>
<ellipse cx="42" cy="40" rx="7" ry="4.5" fill="#fff" opacity="0.6" transform="rotate(-30 42 40)"/>
</svg>"""


def pattern(uid, color):
    """Faint triangles and hexagons behind the mine, a nod to the tilings."""
    out = []
    h = 10 * math.sqrt(3) / 2
    for row in range(-1, 13):
        for col in range(-1, 12):
            x = col * 10 + (5 if row % 2 else 0)
            y = row * h
            out.append(f"M{x:.1f} {y:.1f} l10 0 l-5 {h:.1f} z")
    return (
        f'<path d="{" ".join(out)}" fill="none" style="stroke:{color}" '
        f'stroke-width="0.6" opacity="0.5"/>'
    )


STEEL = dict(
    ball_hi="#9aa0aa", ball_mid="#3a3e46", ball_lo="#07080a",
    spike_hi="#c4cad4", spike_lo="#3d424b", cap="#6a707b",
)

VARIANTS = [
    ("Graphite plate", "Near-black plate with a cool top-down light and a soft halo, so the steel mine lifts off the dark.",
     dict(STEEL, plate_top="#2a2f3a", plate_bot="#0f1115", halo="#8d96a6", edge="#ffffff", rim="#c8d0dc")),
    ("Ember", "Same plate, one spike tip glowing like a lit fuse. Reads as \"danger\" without a red tile.",
     dict(STEEL, plate_top="#262a33", plate_bot="#0c0d10", halo="#f07848", halo_op=0.28, edge="#ffffff", rim="#f0a070", spark="#ff8a4c")),
    ("Midnight", "Deep navy plate with a blue rim light on the mine, like the Midnight theme.",
     dict(STEEL, plate_top="#1f2a52", plate_bot="#0a0f22", halo="#6f86ff", halo_op=0.35, edge="#9fb0ff", rim="#9fb0ff", rim_op=0.7)),
    ("Closed cell", "The plate is a dark board cell with a bevel, so the icon reads as a tile you haven't opened yet.",
     dict(STEEL, plate_top="#5b647a", plate_bot="#2a2f3b", halo="#ffffff", halo_op=0.18, edge="#ffffff", edge_op=0.5, rim="#e6e8ee")),
    ("Black glass", "Glossy black with a reflection band across the top, closest to macOS app icon gloss.",
     dict(STEEL, plate_top="#1a1c21", plate_bot="#030304", halo="#8d96a6", halo_op=0.3, edge="#ffffff", edge_op=0.25, rim="#d0d6e0", gloss=0.09)),
    ("Poly grid", "Faint triangle lattice behind the mine: the \"poly\" in Polymine, visible at large sizes only.",
     dict(STEEL, plate_top="#232833", plate_bot="#0d0f13", halo="#8d96a6", halo_op=0.45, edge="#ffffff", rim="#c8d0dc", pattern="#5a6478")),
]


# ---- page -------------------------------------------------------------------

def sizes(svg):
    return "".join(
        f'<span class="sz" style="width:{n}px;height:{n}px">{svg}</span>' for n in (64, 32, 16)
    )


def card(title, desc, svg):
    return f"""<figure class="card"><div class="big">{svg}</div>
<div class="strips"><div class="strip dark">{sizes(svg)}</div><div class="strip light">{sizes(svg)}</div></div>
<figcaption><b>{title}</b><span>{desc}</span></figcaption></figure>"""


def main():
    ref = [
        ("Current: pastel", "What ships today, for comparison.", (REPO / "ui/public/icon.svg").read_text(encoding="utf-8")),
        ("Realistic, light plate", "The style sheet's realistic take, unchanged.", (OUT / "style-realistic.svg").read_text(encoding="utf-8")),
    ]
    cards = [card(t, d, s) for t, d, s in ref]
    cards += [card(t, d, mine(p, f"v{i}")) for i, (t, d, p) in enumerate(VARIANTS)]
    for i, (t, _, p) in enumerate(VARIANTS):
        slug = re.sub(r"[^a-z]+", "-", t.lower()).strip("-")
        (OUT / f"dark-{slug}.svg").write_text(mine(p, "a"), encoding="utf-8")
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Polymine dark icons</title>
<style>
:root{{--bg:#f4f5f7;--fg:#1b1d22;--muted:#5d6370;--card:#fff;--line:#e2e4e9}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111317;--fg:#e8eaee;--muted:#9aa1ad;--card:#1a1d23;--line:#2a2e36}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:32px 16px 64px}}
h1{{font-size:26px;margin:0 0 4px}} h2{{font-size:19px;margin:44px 0 4px}}
p.lead{{color:var(--muted);margin:0 0 20px;max-width:760px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}}
.card{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}}
.big svg{{width:160px;height:160px;display:block;margin:0 auto}}
.strips{{display:grid;gap:6px}}
.strip{{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 6px;border-radius:8px}}
.strip.dark{{background:#202020}} .strip.light{{background:#f3f3f3}}
.sz svg{{width:100%;height:100%;display:block}}
figcaption{{display:flex;flex-direction:column;gap:2px}} figcaption span{{color:var(--muted);font-size:13.5px}}
.themes{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}}
.tile{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}}
.tile .t svg{{width:96px;height:96px}} .ts{{display:flex;justify-content:center;align-items:center;gap:8px;margin:6px 0;background:#202020;border-radius:6px;padding:6px}}
.tile figcaption{{font-size:13px;color:var(--muted)}}
</style></head><body><main>
<h1>Polymine dark icons</h1>
<p class="lead">The realistic mine on dark backplanes. Each card shows 160 px, then 64, 32 and 16 px on a dark and a light taskbar.</p>
<div class="grid">{''.join(cards)}</div>
</main></body></html>"""
    (OUT / "icon-dark.html").write_text(html, encoding="utf-8")
    print("wrote", OUT / "icon-dark.html")


main()
