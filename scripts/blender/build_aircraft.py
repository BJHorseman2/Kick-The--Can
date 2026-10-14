"""Sky Fury: World Tour -- procedural aircraft builder (Blender 5.x, headless).

Models every aircraft in the game from code (no imported meshes, no third-party
assets, no insignia or markings) and exports plain glTF 2.0 binaries:

    public/models/fighter_player.glb   light grey, neon-cyan accents
    public/models/fighter_bandit.glb   charcoal, red wingtips / fin flash
    public/models/fighter_ace.glb      black, gold accents
    public/models/bomber.glb           four-engine swept-wing bomber, dark grey
    public/models/transport.glb        twin-engine VIP airliner, white / deep blue

Run (deterministic: same script -> byte-identical files):

    <blender-venv>/bin/python scripts/blender/build_aircraft.py
    <blender-venv>/bin/python scripts/blender/build_aircraft.py --previews /tmp/previews

Axes (what Cesium needs) -- see README.md for the full contract:
    glTF +X = nose, +Y = up, +Z = right wing.  Metres.
    Cesium.Model.fromGltfAsync({ url, upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.X })
    then the model frame is x = nose, y = left wing, z = up.

Everything a Cesium web worker would have to decode is avoided on purpose:
no Draco, no meshopt, no KTX2/Basis -- one tiny PNG palette per file.
"""
import argparse
import json
import math
import os
import struct
import sys
import tempfile
import zlib

import bpy  # must come first: it makes bmesh/mathutils importable
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DEG = math.pi / 180.0

# =============================================================================
# Palette: one 32x32 PNG per file, an 8x8 grid of 4x4-pixel swatches. Every
# face samples the centre of one swatch (nearest filtering), so a livery is
# just a different PNG over identical geometry and UVs.
# =============================================================================
SLOTS = [
    # airframe paint
    'hull', 'hull2', 'belly', 'radome', 'antiglare', 'wing', 'wing_lo', 'walk',
    # canopy / openings / hot metal
    'glass', 'glass_hi', 'frame', 'intake', 'lip', 'fan', 'spinner', 'nacelle',
    'metal', 'metal_hi', 'soot', 'engine', 'exhaust', 'pylon', 'gear', 'panel',
    # livery accents
    'accent', 'tip', 'fin', 'fin2', 'blue', 'pin', 'window', 'white',
    # stores
    'missile', 'missile_nose', 'missile_fin', 'rail', 'spare1', 'spare2', 'spare3', 'spare4',
    # row 5 is the cabin-window pattern (not swatches), see WINDOW_ROW
    '_win0', '_win1', '_win2', '_win3', '_win4', '_win5', '_win6', '_win7',
    # emissive (sampled through the Glow material's emissiveTexture)
    'nav_red', 'nav_green', 'beacon', 'spare5', 'spare6', 'spare7', 'spare8', 'spare9',
]
WINDOW_ROW = 5  # 32 texels = 8 x (2 texels window, 2 texels pillar); u wraps (REPEAT) along a cabin
RAMP_ROW = 7  # top row of the grid: a 32-texel afterburner gradient (white-hot -> red)
RAMP_KEYS = [(0.0, '#fffbf2'), (0.12, '#fff1c8'), (0.3, '#ffd98a'), (0.5, '#ffb455'),
             (0.7, '#ff8a30'), (0.86, '#f25a1c'), (1.0, '#c23412')]
GRID = 8
SWATCH = 4
PAL_SIZE = GRID * SWATCH  # 32 px
assert len(SLOTS) <= GRID * GRID


def ramp_uv(t):
    """UV of the ramp texel for t in 0..1 (nearest filtering picks one texel)."""
    x = min(PAL_SIZE - 1, max(0, round(t * (PAL_SIZE - 1))))
    return ((x + 0.5) / PAL_SIZE, (RAMP_ROW + 0.5) / GRID)


def ramp_rgb(t):
    for (ta, ca), (tb, cb) in zip(RAMP_KEYS, RAMP_KEYS[1:]):
        if t <= tb:
            k = (t - ta) / (tb - ta)
            a, b = hex_rgb(ca), hex_rgb(cb)
            return tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3))
    return hex_rgb(RAMP_KEYS[-1][1])


def window_uv(f0, pitch):
    """Per-vertex UV for a cabin-window band: one window + pillar every `pitch` metres aft of f0."""
    return lambda r, f, u: ((f0 - f) / (8.0 * pitch), (WINDOW_ROW + 0.5) / GRID)


def slot_uv(slot):
    i = SLOTS.index(slot)
    col, row = i % GRID, i // GRID  # row counted from the bottom (Blender UV space)
    return ((col + 0.5) / GRID, (row + 0.5) / GRID)


GLOW_COMMON = {'nav_red': '#ff2a1c', 'nav_green': '#1dff6a', 'beacon': '#ff3a2a'}

LIVERIES = {
    # Friendly: light air-superiority grey, darker radome/anti-glare panel,
    # thin neon-cyan stripes in the HUD's colour.
    'player': {
        'hull': '#aab4bf', 'hull2': '#97a2ae', 'belly': '#c3cbd3', 'radome': '#7d8894',
        'antiglare': '#3f4851', 'wing': '#a3adb8', 'wing_lo': '#bcc4cc', 'walk': '#8e99a5',
        'glass': '#1d2933', 'glass_hi': '#5a7487', 'frame': '#7c8792', 'intake': '#14171b',
        'lip': '#cdd3da', 'metal': '#5c636b', 'metal_hi': '#959ba2', 'soot': '#1e2023',
        'engine': '#40291b', 'accent': '#19e6ff', 'tip': '#19e6ff', 'fin': '#19e6ff',
        'fin2': '#2a3038', 'missile': '#e1e5e9', 'missile_nose': '#4b525a', 'missile_fin': '#c5cbd2',
        'rail': '#6d7681', 'panel': '#8f9aa6',
    },
    # Hostile: charcoal, red wingtips and fin flash, red-tinted canopy.
    'bandit': {
        'hull': '#3d424b', 'hull2': '#343841', 'belly': '#4b515a', 'radome': '#272a30',
        'antiglare': '#1c1f23', 'wing': '#393e47', 'wing_lo': '#4a5059', 'walk': '#30343b',
        'glass': '#2a1513', 'glass_hi': '#6b2f28', 'frame': '#2c3036', 'intake': '#0e1013',
        'lip': '#e5262b', 'metal': '#4a4d52', 'metal_hi': '#7b7f85', 'soot': '#18191b',
        'engine': '#3e2418', 'accent': '#ff2f2f', 'tip': '#ff2a2a', 'fin': '#ff2a2a',
        'fin2': '#1b1d21', 'missile': '#a3a9b0', 'missile_nose': '#3a3f45', 'missile_fin': '#8c939b',
        'rail': '#2a2d33', 'panel': '#30343c',
    },
    # Named aces: gloss black with gold.
    'ace': {
        'hull': '#1a1b20', 'hull2': '#222329', 'belly': '#2a2b31', 'radome': '#111215',
        'antiglare': '#0b0b0d', 'wing': '#18191d', 'wing_lo': '#28292f', 'walk': '#25262c',
        'glass': '#3a2a08', 'glass_hi': '#a07a22', 'frame': '#c99a2e', 'intake': '#0b0b0d',
        'lip': '#e0ad35', 'metal': '#4a4338', 'metal_hi': '#b48a33', 'soot': '#151515',
        'engine': '#3e2418', 'accent': '#ffc53d', 'tip': '#ffc53d', 'fin': '#ffc53d',
        'fin2': '#101114', 'missile': '#c9a24a', 'missile_nose': '#2a2a2e', 'missile_fin': '#8a6a1c',
        'rail': '#202126', 'panel': '#24252b',
    },
    # Strategic bomber: dark grey, slightly lighter belly.
    'bomber': {
        'hull': '#5d656e', 'hull2': '#535a63', 'belly': '#6e767f', 'radome': '#343a40',
        'antiglare': '#2a2e33', 'wing': '#59616a', 'wing_lo': '#6a727b', 'walk': '#50575f',
        'glass': '#141b23', 'glass_hi': '#3d5465', 'frame': '#3b4148', 'intake': '#121418',
        'lip': '#9aa2ab', 'fan': '#2c3036', 'spinner': '#25282d', 'nacelle': '#565d66',
        'metal': '#3a3d42', 'metal_hi': '#6f747b', 'soot': '#1b1c1e', 'exhaust': '#2b2a29',
        'pylon': '#535a63', 'fin': '#59616a', 'panel': '#4f565e',
    },
    # VIP transport: white over deep blue, light-blue pinstripe, no markings.
    'transport': {
        'white': '#f1f4f7', 'hull': '#f1f4f7', 'blue': '#1b3566', 'pin': '#8fd3ff',
        'window': '#1a2635', 'glass': '#101c2b', 'glass_hi': '#2f4a63', 'frame': '#dfe5eb',
        'wing': '#c3cbd3', 'wing_lo': '#a9b2bc', 'walk': '#b3bcc6', 'nacelle': '#eef1f5',
        'lip': '#b9c2cc', 'intake': '#16191d', 'fan': '#3a4048', 'spinner': '#c8ced5',
        'metal': '#7c838b', 'metal_hi': '#a9afb6', 'soot': '#2a2c30', 'exhaust': '#3b3d40',
        'pylon': '#d9dee4', 'fin': '#1b3566', 'fin2': '#8fd3ff', 'belly': '#1b3566',
        'radome': '#e4e9ee', 'panel': '#e6eaef',
    },
}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def palette_png(livery):
    """Deterministic 32x32 RGB PNG (our own encoder: no timestamps, fixed zlib)."""
    colours = dict(GLOW_COMMON)
    colours.update(LIVERIES[livery])
    grid = [[(128, 128, 128)] * GRID for _ in range(GRID)]  # [row_from_top][col]
    for i, slot in enumerate(SLOTS):
        col, row_b = i % GRID, i // GRID
        grid[GRID - 1 - row_b][col] = hex_rgb(colours.get(slot, '#808080'))
    ramp_y = (GRID - 1 - RAMP_ROW) * SWATCH
    win_y = (GRID - 1 - WINDOW_ROW) * SWATCH
    win = (hex_rgb(colours.get('window', '#808080')), hex_rgb(colours.get('white', '#808080')))
    raw = bytearray()
    for y in range(PAL_SIZE):
        raw.append(0)  # filter: none
        for x in range(PAL_SIZE):
            if ramp_y <= y < ramp_y + SWATCH:
                raw.extend(ramp_rgb(x / (PAL_SIZE - 1)))
            elif win_y <= y < win_y + SWATCH:
                raw.extend(win[(x // 2) % 2])
            else:
                raw.extend(grid[y // SWATCH][x // SWATCH])

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', PAL_SIZE, PAL_SIZE, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


# =============================================================================
# Geometry soup in the aircraft BODY frame: r = right, f = forward, u = up (m).
# Converted at the end to Blender (x=f, y=-r, z=u), which the glTF exporter
# writes as glTF (x=f, y=u, z=r): nose +X, up +Y, right wing +Z.
# =============================================================================
class Geo:
    def __init__(self):
        self.verts = []
        self.faces = []  # (vertex indices, palette slot | {vertex: uv}, smooth?)

    def v(self, r, f, u):
        self.verts.append((float(r), float(f), float(u)))
        return len(self.verts) - 1

    def face(self, idx, slot, smooth=True):
        out = []
        for i in idx:
            if not out or out[-1] != i:
                out.append(i)
        while len(out) > 1 and out[0] == out[-1]:
            out.pop()
        if len(out) >= 3:
            self.faces.append((tuple(out), slot, smooth))

    def add(self, other):
        base = len(self.verts)
        self.verts.extend(other.verts)
        self.faces.extend((tuple(i + base for i in idx),
                           {k + base: uv for k, uv in s.items()} if isinstance(s, dict) else s, sm)
                          for idx, s, sm in other.faces)
        return self

    def mirrored(self):
        g = Geo()
        g.verts = [(-r, f, u) for r, f, u in self.verts]
        g.faces = [(tuple(reversed(idx)), s, sm) for idx, s, sm in self.faces]
        return g

    def ramp(self, f0, f1):
        """Re-colour every face with the afterburner ramp by distance along f."""
        def t(vi):
            return min(1.0, max(0.0, (self.verts[vi][1] - f0) / (f1 - f0)))
        self.faces = [(idx, {vi: ramp_uv(t(vi)) for vi in idx}, sm) for idx, _, sm in self.faces]
        return self


def _mid_angle(a, b):
    if b < a:
        b += 360.0
    return ((a + b) * 0.5) % 360.0


def loft(geo, stations, angles, slot=lambda sa, sb, amid: 'hull', closed=True, floor_slot='hull',
         cap_slots=('hull', 'hull'), smooth=True, cap=(True, True)):
    """Skin superellipse cross-sections.

    station: dict(f, w, ht, hb, zc, rc, n, rake, wobble); w == 0 -> single point.
    angles: section angles in degrees, 0 = +r (right side), 90 = top.
    slot(sa, sb, amid) picks the palette slot of each face between stations.
    closed=False: angles span an arc; a flat floor strip closes the shell.
    """
    rings = []
    for st in stations:
        f0, w = st['f'], st['w']
        zc, rc = st.get('zc', 0.0), st.get('rc', 0.0)
        if w <= 1e-6:
            rings.append([geo.v(rc, f0, zc)])
            continue
        ht = st.get('ht', w)
        hb = st.get('hb', ht)
        e = 2.0 / st.get('n', 2.0)
        rake, wob = st.get('rake', 0.0), st.get('wobble', 0.0)
        ring = []
        for j, a in enumerate(angles):
            c, s = math.cos(a * DEG), math.sin(a * DEG)
            k = 1.0 + (wob if j % 2 == 0 else -wob)
            r = w * k * math.copysign(abs(c) ** e, c)
            u = (ht if s >= 0 else hb) * k * math.copysign(abs(s) ** e, s)
            ring.append(geo.v(rc + r, f0 + rake * u, zc + u))
        rings.append(ring)
    n = len(angles)
    nb = n if closed else n - 1
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        sa, sb = stations[i], stations[i + 1]
        for j in range(nb):
            jn = (j + 1) % n
            sl = slot(sa, sb, _mid_angle(angles[j], angles[jn]))
            if callable(sl):  # per-vertex UVs from position
                quad = (A[j % len(A)], A[jn % len(A)], B[jn % len(B)], B[j % len(B)])
                sl = {vi: sl(*geo.verts[vi]) for vi in quad}
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                geo.face((A[0], B[jn], B[j]), sl, smooth)
            elif len(B) == 1:
                geo.face((A[j], A[jn], B[0]), sl, smooth)
            else:
                geo.face((A[j], A[jn], B[jn], B[j]), sl, smooth)
        if not closed and len(A) > 1 and len(B) > 1:
            geo.face((A[-1], A[0], B[0], B[-1]), floor_slot, False)
    if cap[0] and len(rings[0]) > 2:
        geo.face(tuple(rings[0]), cap_slots[0], False)
    if cap[-1] and len(rings[-1]) > 2:
        geo.face(tuple(reversed(rings[-1])), cap_slots[1], False)
    return geo


def lathe(geo, profile, seg, rc=0.0, zc=0.0, phase=0.0, wobble=None):
    """Body of revolution about a fore-aft axis through (rc, zc).
    profile: [(f, radius, slot_of_band_to_next_point)], radius 0 = on axis."""
    angles = [phase + 360.0 * j / seg for j in range(seg)]
    st = []
    for k, (f, rad, sl) in enumerate(profile):
        st.append(dict(f=f, w=rad, ht=rad, hb=rad, rc=rc, zc=zc, slot=sl,
                       wobble=(wobble[k] if wobble else 0.0)))
    return loft(geo, st, angles, slot=lambda sa, sb, amid: sa['slot'],
                cap_slots=(profile[0][2], profile[-2][2]))


def surface(geo, stations, place, profile, slot=lambda i, side, x: 'hull', smooth=True):
    """Lifting surface (wing, fin, stab, control surface, pylon, plate).

    stations: [dict(s, le, te, t, h0)] -- span position, leading/trailing edge
              (body f), thickness and offset of the chord plane.
    place(s, f, h) -> (r, f, u) maps span/chord/thickness to the body frame.
    profile: [(x, upper, lower)] x = 0 at LE .. 1 at TE, half-thickness
             fractions of t/2. upper == lower at an end gives a sharp edge.
    slot(band_index, side, x_mid) with side in 'up' | 'lo' | 'le' | 'te' | 'cap'.
    """
    loop = []  # (x, frac, side_tag_of_edge_to_next)
    x0, u0, l0 = profile[0]
    x1, u1, l1 = profile[-1]
    if abs(u0 - l0) < 1e-9:
        loop.append((x0, u0, 'up'))
    else:
        loop.append((x0, l0, 'le'))
        loop.append((x0, u0, 'up'))
    for x, up, lo in profile[1:-1]:
        loop.append((x, up, 'up'))
    if abs(u1 - l1) < 1e-9:
        loop.append((x1, u1, 'lo'))
    else:
        loop.append((x1, u1, 'te'))
        loop.append((x1, l1, 'lo'))
    for x, up, lo in reversed(profile[1:-1]):
        loop.append((x, lo, 'lo'))
    if abs(u0 - l0) > 1e-9:
        loop[-1] = (loop[-1][0], loop[-1][1], 'lo')
    rings = []
    for st in stations:
        ring = []
        for x, frac, _ in loop:
            f = st['le'] + x * (st['te'] - st['le'])
            h = st.get('h0', 0.0) + frac * st['t'] * 0.5
            ring.append(geo.v(*place(st['s'], f, h)))
        rings.append(ring)
    n = len(loop)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(n):
            kn = (k + 1) % n
            side = loop[k][2]
            xm = 0.5 * (loop[k][0] + loop[kn][0])
            geo.face((A[k], A[kn], B[kn], B[k]), slot(i, side, xm), smooth)
    geo.face(tuple(rings[0]), slot(-1, 'cap', 0.0), False)
    geo.face(tuple(reversed(rings[-1])), slot(len(rings) - 1, 'cap', 0.0), False)
    return geo


def wing_place(dihedral_deg=0.0, r0=0.0, u0=0.0):
    """Right-side horizontal surface: span along +r tilted by dihedral."""
    c, s = math.cos(dihedral_deg * DEG), math.sin(dihedral_deg * DEG)
    return lambda sp, f, h: (r0 + sp * c - h * s, f, u0 + sp * s + h * c)


def fin_place(r0=0.0, cant_deg=0.0):
    """Vertical surface: span along +u (cant tilts the top outboard toward +r)."""
    c, s = math.cos(cant_deg * DEG), math.sin(cant_deg * DEG)
    return lambda sp, f, h: (r0 + sp * s + h * c, f, sp * c - h * s)


def lerp_table(table, x):
    """Piecewise-linear lookup in [(x, y)] sorted by x."""
    if x <= table[0][0]:
        return table[0][1]
    for (xa, ya), (xb, yb) in zip(table, table[1:]):
        if x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return table[-1][1]


# Airfoils: (x, upper, lower) half-thickness fractions.
AIRFOIL = [(0.0, 0.0, 0.0), (0.05, 0.46, -0.38), (0.22, 0.9, -0.74), (0.45, 1.0, -0.82),
           (0.75, 0.7, -0.58), (1.0, 0.0, 0.0)]
AIRFOIL_HINGE = [(0.0, 0.0, 0.0), (0.05, 0.46, -0.38), (0.22, 0.9, -0.74), (0.45, 1.0, -0.82),
                 (0.75, 0.74, -0.62), (1.0, 0.4, -0.34)]  # blunt TE at a hinge line
SYM = [(0.0, 0.0, 0.0), (0.06, 0.5, -0.5), (0.3, 1.0, -1.0), (0.7, 0.6, -0.6), (1.0, 0.0, 0.0)]
SYM_HINGE = [(0.0, 0.0, 0.0), (0.06, 0.5, -0.5), (0.3, 1.0, -1.0), (0.7, 0.72, -0.72), (1.0, 0.4, -0.4)]
CONTROL = [(0.0, 0.2, -0.17), (0.1, 0.37, -0.31), (1.0, 0.0, 0.0)]  # flaperon / TE strip
CONTROL_SYM = [(0.0, 0.2, -0.2), (0.1, 0.37, -0.37), (1.0, 0.0, 0.0)]  # rudder
PLATE = [(0.0, 1.0, -1.0), (1.0, 1.0, -1.0)]  # thin box


# =============================================================================
# Fighter (one airframe, three liveries). Body frame, metres, ~15 m long.
# =============================================================================
F_NOSE, F_EXIT = 8.0, -7.0           # radome tip / nozzle exit plane  -> 15.0 m
F_HINGE, F_TE = -2.90, -3.55         # wing flaperon hinge line / trailing edge
F_FLAP_IN, F_FLAP_OUT = 0.93, 3.47   # flaperon span (outboard of it: fixed TE strip)
F_WING_U = 0.08                      # wing chord plane height
F_TIP_R = 4.70                       # wing tip (span 9.4 m + rails/missiles ~9.9 m)
F_FIN_HINGE, F_FIN_TE = -6.02, -6.62
F_STAB_PIVOT = (0.62, -5.55, 0.05)

FUS_ANGLES = [0, 24, 48, 68, 86, 94, 112, 132, 156, 180, 204, 232, 270, 308, 336]


def fighter_fuselage(g):
    S = [  # f, w, ht, hb, zc, n
        (8.00, 0.00, 0.00, 0.00, 0.02, 2.0),
        (7.20, 0.20, 0.20, 0.19, 0.04, 2.0),
        (6.10, 0.37, 0.37, 0.35, 0.07, 2.0),
        (5.30, 0.46, 0.46, 0.44, 0.09, 2.1),
        (4.60, 0.53, 0.52, 0.50, 0.10, 2.2),
        (3.20, 0.62, 0.58, 0.57, 0.10, 2.35),
        (1.60, 0.76, 0.63, 0.60, 0.08, 2.6),
        (0.40, 0.85, 0.69, 0.60, 0.06, 2.8),
        (-1.40, 0.88, 0.73, 0.58, 0.04, 2.8),
        (-3.00, 0.84, 0.69, 0.56, 0.02, 2.7),
        (-4.60, 0.76, 0.64, 0.57, 0.01, 2.4),
        (-6.15, 0.66, 0.65, 0.65, 0.00, 2.0),
    ]
    st = [dict(f=f, w=w, ht=ht, hb=hb, zc=zc, n=n) for f, w, ht, hb, zc, n in S]

    def slot(sa, sb, a):
        fm = 0.5 * (sa['f'] + sb['f'])
        if fm > 5.3:
            return 'radome'
        if fm > 4.6 and 40 < a < 140:
            return 'antiglare'
        if -4.6 < fm < 0.4 and 86 < a < 94:
            return 'accent'
        if 200 < a < 340:
            return 'belly'
        if fm < 0.4 and (48 < a < 86 or 94 < a < 132):
            return 'hull2'  # spine panels a shade darker
        return 'hull'

    loft(g, st, FUS_ANGLES, slot=slot, cap_slots=('hull', 'soot'))


def fighter_canopy(g):
    S = [  # f, half-width, height above the sill
        (4.80, 0.18, 0.02), (4.38, 0.37, 0.27), (3.98, 0.45, 0.42), (3.88, 0.455, 0.435),
        (3.00, 0.47, 0.56), (2.10, 0.45, 0.53), (1.20, 0.38, 0.41), (0.40, 0.25, 0.21),
        (-0.25, 0.10, 0.03),
    ]
    st = [dict(f=f, w=w, ht=h, hb=h, zc=0.60, n=2.0) for f, w, h in S]

    def slot(sa, sb, a):
        fm = 0.5 * (sa['f'] + sb['f'])
        if 3.88 <= fm <= 3.98:
            return 'frame'  # windscreen bow
        if fm < 0.4:
            return 'hull2'  # the canopy fairing behind the glass
        if 62 < a < 118 and fm < 3.9:
            return 'glass_hi'  # sky reflection along the top of the bubble
        return 'glass'

    loft(g, st, [0, 30, 62, 90, 118, 150, 180], slot=slot, closed=False, floor_slot='hull',
         cap_slots=('frame', 'hull2'))


def fighter_intake(g):
    # Raked rectangular side intake under the LERX, fairing into the fuselage.
    S = [  # f, w, h, rc, zc, rake, band slot
        (2.70, 0.19, 0.25, 0.86, -0.27, 0.35, 'intake'),
        (3.16, 0.19, 0.25, 0.86, -0.27, 0.35, 'lip'),
        (3.22, 0.30, 0.36, 0.86, -0.27, 0.35, 'hull'),
        (2.55, 0.32, 0.38, 0.86, -0.27, 0.0, 'hull'),
        (0.30, 0.29, 0.35, 0.82, -0.24, 0.0, 'hull'),
        (-2.80, 0.12, 0.18, 0.62, -0.14, 0.0, 'hull'),
    ]
    st = [dict(f=f, w=w, ht=h, hb=h, rc=rc, zc=zc, rake=rk, n=4.0, slot=sl) for f, w, h, rc, zc, rk, sl in S]

    def slot(sa, sb, a):
        if sa['slot'] == 'hull' and 200 < a < 340:
            return 'belly'
        return sa['slot']

    loft(g, st, [0, 45, 90, 135, 180, 225, 270, 315], slot=slot,
         cap_slots=('intake', 'hull'))


WING_LE = [(0.55, 3.90), (1.30, 1.10), (F_TIP_R, -2.32)]
WING_T = [(0.55, 0.10), (1.30, 0.30), (F_TIP_R, 0.07)]
TIP_BAND = 4.30


def fighter_wing(g):
    def st(r):
        return dict(s=r, le=lerp_table(WING_LE, r), te=F_HINGE, t=lerp_table(WING_T, r), h0=0.0)

    stations = [st(r) for r in (0.55, 1.30, TIP_BAND, F_TIP_R)]

    def slot(i, side, x):
        if side == 'cap':
            return 'tip' if i >= 0 else 'wing'
        if i == 2:
            return 'tip'
        return 'wing_lo' if side == 'lo' else 'wing'

    surface(g, stations, wing_place(0.0, 0.0, F_WING_U), AIRFOIL_HINGE, slot)
    # static outboard trailing-edge strip (aileron area is fixed; flaperon moves)
    te = [dict(s=r, le=F_HINGE - 0.03, te=F_TE, t=lerp_table(WING_T, r)) for r in (3.50, TIP_BAND, F_TIP_R)]
    surface(g, te, wing_place(0.0, 0.0, F_WING_U), CONTROL,
            lambda i, side, x: 'tip' if (i == 1 or (side == 'cap' and i > 0)) else ('wing_lo' if side == 'lo' else 'wing'))


def fighter_flaperon_geo():
    g = Geo()
    st = [dict(s=r, le=F_HINGE - 0.03, te=F_TE, t=lerp_table(WING_T, r)) for r in (F_FLAP_IN, F_FLAP_OUT)]
    surface(g, st, wing_place(0.0, 0.0, F_WING_U), CONTROL,
            lambda i, side, x: 'wing_lo' if side == 'lo' else 'wing')
    return g


def fighter_stab_geo():
    g = Geo()
    st = [dict(s=0.50, le=-4.55, te=-6.85, t=0.14), dict(s=3.05, le=-6.30, te=-7.08, t=0.05)]
    surface(g, st, wing_place(0.0, 0.0, F_STAB_PIVOT[2]), SYM,
            lambda i, side, x: 'wing_lo' if side == 'lo' else 'wing')
    return g


FIN_LE = [(0.45, -1.30), (0.95, -3.25), (3.35, -5.36)]
FIN_T = [(0.45, 0.08), (0.95, 0.24), (3.35, 0.07)]
FIN_BAND = 3.00


def fighter_fin(g):
    stations = [dict(s=u, le=lerp_table(FIN_LE, u), te=F_FIN_HINGE, t=lerp_table(FIN_T, u))
                for u in (0.45, 0.95, FIN_BAND, 3.35)]
    surface(g, stations, fin_place(), SYM_HINGE,
            lambda i, side, x: 'fin' if (i == 2 or (side == 'cap' and i > 0)) else 'hull')
    # fixed trailing-edge strips below and above the rudder
    for lo, hi, top in ((0.55, 0.92, False), (3.03, 3.35, True)):
        st = [dict(s=u, le=F_FIN_HINGE - 0.03, te=F_FIN_TE, t=lerp_table(FIN_T, u)) for u in (lo, hi)]
        surface(g, st, fin_place(), CONTROL_SYM, lambda i, side, x, top=top: 'fin' if top else 'hull')


def fighter_rudder_geo():
    g = Geo()
    st = [dict(s=u, le=F_FIN_HINGE - 0.03, te=F_FIN_TE, t=lerp_table(FIN_T, u)) for u in (0.95, 3.00)]
    surface(g, st, fin_place(), CONTROL_SYM, lambda i, side, x: 'hull')
    return g


def fighter_tail_booms(g):
    # Stabilator root fairings either side of the nozzle.
    st = [dict(f=-4.10, w=0.0, zc=0.02, rc=0.64),
          dict(f=-4.70, w=0.10, ht=0.11, hb=0.10, zc=0.03, rc=0.65),
          dict(f=-6.70, w=0.11, ht=0.12, hb=0.10, zc=0.03, rc=0.66),
          dict(f=-7.10, w=0.06, ht=0.06, hb=0.05, zc=0.03, rc=0.66)]
    loft(g, st, [30, 90, 150, 210, 270, 330], slot=lambda sa, sb, a: 'hull2',
         cap_slots=('hull2', 'metal'))


def fighter_nozzle(g):
    prof = [(-5.85, 0.00, 'metal'), (-5.85, 0.64, 'metal'), (-6.25, 0.63, 'metal'),
            (-6.97, 0.53, 'metal_hi'), (-7.00, 0.465, 'soot'), (-6.68, 0.43, 'engine'), (-6.68, 0.0, 'engine')]
    lathe(g, prof, 12, phase=15.0, wobble=[0, 0, 0, 0.035, 0.035, 0, 0])


def fighter_stores(g):
    # Wingtip launch rail + short-range missile (right side; mirrored later).
    rc, zc = F_TIP_R + 0.17, F_WING_U
    surface(g, [dict(s=F_TIP_R - 0.06, le=-1.55, te=-3.05, t=0.10), dict(s=rc - 0.04, le=-1.55, te=-3.05, t=0.10)],
            wing_place(0.0, 0.0, F_WING_U), PLATE, lambda i, side, x: 'rail', smooth=False)
    lathe(g, [(-0.62, 0.0, 'missile_nose'), (-0.82, 0.052, 'missile_nose'), (-1.00, 0.066, 'missile'),
              (-3.52, 0.066, 'missile'), (-3.60, 0.0, 'missile')], 6, rc=rc, zc=zc, phase=30.0)
    for vertical in (False, True):
        st = [dict(s=-0.20, le=-3.12, te=-3.52, t=0.016), dict(s=0.20, le=-3.30, te=-3.55, t=0.016)]
        st[0]['le'] = -3.30  # cropped delta fins
        place = (lambda sp, f, h: (rc + h, f, zc + sp)) if vertical else (lambda sp, f, h: (rc + sp, f, zc + h))
        surface(g, st, place, PLATE, lambda i, side, x: 'missile_fin', smooth=False)


def navlight_geo(f_front, f_back, radius, r, u, slot):
    g = Geo()
    lathe(g, [(f_front, 0.0, slot), (0.6 * f_front + 0.4 * f_back, radius, slot), (f_back, 0.0, slot)],
          6, rc=r, zc=u)
    return g


def afterburner_geo():
    g = Geo()
    prof = [(-6.80, 0.0, 'hull'), (-6.80, 0.40, 'hull'), (-7.30, 0.43, 'hull'),
            (-8.10, 0.36, 'hull'), (-9.00, 0.22, 'hull'), (-10.0, 0.0, 'hull')]
    lathe(g, prof, 10)
    return g.ramp(-6.95, -10.0)


def build_fighter(ctx):
    body = Geo()
    fighter_fuselage(body)
    fighter_canopy(body)
    fighter_nozzle(body)
    right = Geo()
    fighter_intake(right)
    fighter_wing(right)
    fighter_tail_booms(right)
    fighter_stores(right)
    body.add(right).add(right.mirrored())
    fighter_fin(body)

    root = ctx.root('Jet')
    ctx.part('Body', body, 'paint', root)
    flap = fighter_flaperon_geo()
    hinge_mid = (0.5 * (F_FLAP_IN + F_FLAP_OUT), F_HINGE - 0.03, F_WING_U)
    ctx.part('Flaperon_L', flap.mirrored(), 'paint', root, (-hinge_mid[0], hinge_mid[1], hinge_mid[2]))
    ctx.part('Flaperon_R', flap, 'paint', root, hinge_mid)
    stab = fighter_stab_geo()
    sp = F_STAB_PIVOT
    ctx.part('Stab_L', stab.mirrored(), 'paint', root, (-sp[0], sp[1], sp[2]))
    ctx.part('Stab_R', stab, 'paint', root, sp)
    ctx.part('Rudder', fighter_rudder_geo(), 'paint', root, (0.0, F_FIN_HINGE - 0.03, 0.5 * (0.95 + 3.00)))
    ctx.part('Afterburner', afterburner_geo(), 'glow', root, (0.0, F_EXIT, 0.0))
    nav_r = (F_TIP_R - 0.14, F_WING_U)
    le_at = lerp_table(WING_LE, nav_r[0])
    ctx.part('NavLight_L', navlight_geo(le_at + 0.13, le_at - 0.22, 0.075, -nav_r[0], nav_r[1], 'nav_red'),
             'glow', root, (-nav_r[0], le_at, nav_r[1]))
    ctx.part('NavLight_R', navlight_geo(le_at + 0.13, le_at - 0.22, 0.075, nav_r[0], nav_r[1], 'nav_green'),
             'glow', root, (nav_r[0], le_at, nav_r[1]))


# =============================================================================
# Bomber: ~46 m four-engine shoulder-wing swept bomber, dark grey.
# =============================================================================
B_ANG = [0, 18, 36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 252, 270, 288, 306, 324, 342]
B_WING_LE = [(0.8, 5.5), (8.0, 0.46), (24.0, -10.75)]
B_WING_TE = [(0.8, -6.0), (8.0, -7.6), (24.0, -13.2)]
B_WING_T = [(0.8, 1.25), (8.0, 0.85), (24.0, 0.28)]
B_DIHEDRAL = -3.0
B_WING_U = 1.40


def b_wing_h(r):
    return B_WING_U + (r - 0.8) * math.tan(B_DIHEDRAL * DEG)


def jet_pod(g, f_front, length, radius, rc, zc, seg=12):
    L = length
    prof = [(f_front - 0.40, 0.0, 'spinner'), (f_front - 0.55, radius * 0.30, 'fan'),
            (f_front - 0.55, radius * 0.80, 'intake'), (f_front - 0.02, radius * 0.84, 'lip'),
            (f_front + 0.02, radius * 0.95, 'lip'), (f_front - 0.35, radius * 1.03, 'nacelle'),
            (f_front - 0.45 * L, radius * 1.02, 'nacelle'), (f_front - 0.86 * L, radius * 0.80, 'metal'),
            (f_front - 0.88 * L, radius * 0.70, 'soot'), (f_front - 0.80 * L, radius * 0.58, 'exhaust'),
            (f_front - L, 0.0, 'exhaust')]
    lathe(g, prof, seg, rc=rc, zc=zc, phase=180.0 / seg)


def build_bomber(ctx):
    body = Geo()
    S = [  # f, w, ht, hb, zc
        (23.0, 0.0, 0.0, 0.0, 0.10), (22.4, 0.55, 0.58, 0.50, 0.10), (21.2, 1.05, 1.08, 0.95, 0.15),
        (20.0, 1.36, 1.48, 1.30, 0.20), (18.6, 1.55, 1.78, 1.60, 0.20), (16.5, 1.66, 1.95, 1.76, 0.15),
        (6.0, 1.66, 1.98, 1.76, 0.15), (-7.0, 1.66, 1.98, 1.76, 0.15),
        (-12.0, 1.58, 1.98, 1.55, 0.25), (-16.0, 1.36, 1.92, 1.15, 0.45), (-19.5, 0.92, 1.62, 0.62, 0.80),
        (-22.0, 0.45, 1.05, 0.30, 1.20), (-23.0, 0.20, 0.45, 0.15, 1.50),
    ]
    st = [dict(f=f, w=w, ht=ht, hb=hb, zc=zc, n=2.3) for f, w, ht, hb, zc in S]

    def slot(sa, sb, a):
        fm = 0.5 * (sa['f'] + sb['f'])
        if fm > 21.2:
            return 'radome'
        if 18.6 < fm < 20.0 and (36 < a < 72 or 108 < a < 144):
            return 'glass'
        if 18.6 < fm < 21.2 and 80 <= a <= 100:
            return 'antiglare'
        if -7.0 < fm < 6.0 and 252 < a < 288:
            return 'panel'  # bomb-bay doors
        if 216 < a < 324:
            return 'belly'
        if 6.0 < fm < 16.5 and 72 < a < 108:
            return 'walk'
        return 'hull'

    loft(body, st, B_ANG, slot=slot, cap_slots=('radome', 'metal'))
    # tail cone (defensive-systems fairing)
    lathe(body, [(-22.8, 0.0, 'metal'), (-22.8, 0.30, 'metal'), (-24.2, 0.16, 'radome'), (-24.6, 0.0, 'radome')],
          8, zc=1.50)
    right = Geo()
    ws = [dict(s=r, le=lerp_table(B_WING_LE, r), te=lerp_table(B_WING_TE, r), t=lerp_table(B_WING_T, r))
          for r in (0.8, 8.0, 16.0, 24.0)]
    surface(right, ws, wing_place(B_DIHEDRAL, 0.0, B_WING_U), AIRFOIL,
            lambda i, side, x: 'wing_lo' if side == 'lo' else ('hull2' if side == 'cap' else 'wing'))
    for r_pod, length, rad in ((7.0, 6.6, 0.82), (14.5, 6.3, 0.78)):
        le = lerp_table(B_WING_LE, r_pod)
        wing_bottom = b_wing_h(r_pod) - 0.42 * lerp_table(B_WING_T, r_pod)
        zc = wing_bottom - 0.45 - rad
        f_front = le + 2.6
        jet_pod(right, f_front, length, rad, r_pod, zc)
        py = [dict(s=zc + rad * 0.6, le=f_front - 1.2, te=f_front - 5.4, t=0.32),
              dict(s=wing_bottom + 0.25, le=le - 0.2, te=le - 3.6, t=0.26)]
        surface(right, py, fin_place(r_pod), SYM, lambda i, side, x: 'pylon')
    # chin sensor blister under the nose
    lathe(right, [(19.6, 0.0, 'radome'), (19.0, 0.30, 'radome'), (17.4, 0.34, 'radome'), (16.4, 0.0, 'radome')],
          8, rc=0.62, zc=-1.28)
    # outrigger gear pod near the wingtip (a classic big-bomber cue)
    r_out = 18.6
    le_o = lerp_table(B_WING_LE, r_out)
    u_o = b_wing_h(r_out) - 0.42 * lerp_table(B_WING_T, r_out) - 0.75
    lathe(right, [(le_o - 0.4, 0.0, 'hull2'), (le_o - 1.0, 0.36, 'hull2'), (le_o - 2.6, 0.38, 'hull2'),
                  (le_o - 3.6, 0.0, 'hull2')], 8, rc=r_out, zc=u_o)
    surface(right, [dict(s=u_o + 0.2, le=le_o - 1.0, te=le_o - 2.8, t=0.14),
                    dict(s=u_o + 1.0, le=le_o - 0.8, te=le_o - 2.9, t=0.14)], fin_place(r_out), SYM,
            lambda i, side, x: 'pylon')
    # swept tailplane on the tail cone
    hs = [dict(s=0.6, le=-15.2, te=-20.8, t=0.65), dict(s=8.6, le=-20.6, te=-23.0, t=0.2)]
    surface(right, hs, wing_place(2.0, 0.0, 1.15), SYM,
            lambda i, side, x: 'wing_lo' if side == 'lo' else 'wing')
    body.add(right).add(right.mirrored())
    fs = [dict(s=1.4, le=-10.8, te=-19.9, t=0.7), dict(s=2.6, le=-14.0, te=-20.9, t=0.62),
          dict(s=10.8, le=-20.4, te=-23.4, t=0.22)]
    surface(body, fs, fin_place(), SYM, lambda i, side, x: 'hull2' if side == 'cap' else 'fin')

    root = ctx.root('Bomber')
    ctx.part('Body', body, 'paint', root)
    r = 23.9
    le = lerp_table(B_WING_LE, r)
    u = b_wing_h(r)
    ctx.part('NavLight_L', navlight_geo(le + 0.2, le - 0.6, 0.16, -r, u, 'nav_red'), 'glow', root, (-r, le, u))
    ctx.part('NavLight_R', navlight_geo(le + 0.2, le - 0.6, 0.16, r, u, 'nav_green'), 'glow', root, (r, le, u))


# =============================================================================
# Transport: ~40 m twin-engine VIP airliner. White over deep blue, pinstripe.
# =============================================================================
T_UP = [0, 5, 15, 36, 50, 64, 78, 90, 102, 116, 130, 144, 165, 175, 180]
T_LO = [184, 200, 222, 246, 270, 294, 318, 340, 356]
T_ANG = T_UP + T_LO
T_WING_LE = [(1.2, 4.0), (6.5, 1.29), (17.6, -4.40)]
T_WING_TE = [(1.2, -4.6), (6.5, -4.4), (17.6, -6.3)]
T_WING_T = [(1.2, 0.95), (6.5, 0.62), (17.6, 0.20)]
T_DIHEDRAL = 6.0
T_WING_U = -1.25


def t_wing_h(r):
    return T_WING_U + (r - 1.2) * math.tan(T_DIHEDRAL * DEG)


def build_transport(ctx):
    body = Geo()
    S = [  # f, w, ht, hb, zc
        (20.0, 0.0, 0.0, 0.0, -0.45), (19.75, 0.55, 0.45, 0.50, -0.40), (19.2, 1.00, 0.95, 0.95, -0.30),
        (18.6, 1.30, 1.27, 1.22, -0.22), (17.4, 1.66, 1.70, 1.60, -0.10), (16.3, 1.82, 1.90, 1.78, -0.05),
        (15.0, 1.85, 1.95, 1.85, 0.0), (-9.0, 1.85, 1.95, 1.85, 0.0),
        (-12.5, 1.66, 1.92, 1.50, 0.20), (-16.0, 1.16, 1.62, 0.95, 0.65), (-19.0, 0.52, 0.98, 0.42, 1.10),
        (-20.0, 0.22, 0.36, 0.20, 1.30),
    ]
    st = [dict(f=f, w=w, ht=ht, hb=hb, zc=zc, n=2.0) for f, w, ht, hb, zc in S]

    def slot(sa, sb, a):
        fm = 0.5 * (sa['f'] + sb['f'])
        if 17.4 < fm < 18.6 and (36 < a < 64 or 116 < a < 144):
            return window_uv(18.6, 0.6)  # two cockpit panes a side, frames between them
        if -9.0 < fm < 15.0 and (5 < a < 15 or 165 < a < 175):
            return window_uv(15.0, 0.95)
        if 180 < a < 184 or a > 356:
            return 'pin'
        if 184 < a < 356:
            return 'blue'
        return 'white'

    loft(body, st, T_ANG, slot=slot, cap_slots=('white', 'metal'))
    right = Geo()
    ws = [dict(s=r, le=lerp_table(T_WING_LE, r), te=lerp_table(T_WING_TE, r), t=lerp_table(T_WING_T, r))
          for r in (1.2, 6.5, 12.0, 17.6)]
    surface(right, ws, wing_place(T_DIHEDRAL, 0.0, T_WING_U), AIRFOIL,
            lambda i, side, x: 'wing_lo' if side == 'lo' else ('walk' if (i == 0 and side == 'up') else 'wing'))
    # blended winglet
    tip_r, tip_u = 17.55, t_wing_h(17.6)
    cant = 14.0
    wl = [dict(s=0.0, le=-4.40, te=-6.30, t=0.20), dict(s=0.6, le=-4.95, te=-6.45, t=0.16),
          dict(s=2.5, le=-6.25, te=-7.05, t=0.08)]
    surface(right, wl, lambda sp, f, h: (tip_r + sp * math.sin(cant * DEG) + h * math.cos(cant * DEG), f,
                                         tip_u + sp * math.cos(cant * DEG) - h * math.sin(cant * DEG)),
            SYM, lambda i, side, x: 'blue')
    # underwing turbofan + pylon
    r_eng = 6.0
    le = lerp_table(T_WING_LE, r_eng)
    wing_bottom = t_wing_h(r_eng) - 0.42 * lerp_table(T_WING_T, r_eng)
    rad = 1.05
    zc = wing_bottom - 0.32 - rad
    f_front = le + 2.9
    jet_pod(right, f_front, 6.1, rad, r_eng, zc, seg=14)
    py = [dict(s=zc + rad * 0.6, le=f_front - 1.0, te=f_front - 5.6, t=0.36),
          dict(s=wing_bottom + 0.25, le=le - 0.3, te=le - 4.5, t=0.30)]
    surface(right, py, fin_place(r_eng), SYM, lambda i, side, x: 'pylon')
    hs = [dict(s=0.6, le=-14.4, te=-18.9, t=0.42), dict(s=7.0, le=-18.5, te=-20.2, t=0.14)]
    surface(right, hs, wing_place(5.0, 0.0, 0.75), SYM, lambda i, side, x: 'wing_lo' if side == 'lo' else 'white')
    body.add(right).add(right.mirrored())
    fs = [dict(s=1.5, le=-10.6, te=-17.9, t=0.60), dict(s=2.3, le=-12.6, te=-18.5, t=0.50),
          dict(s=3.0, le=-13.25, te=-18.75, t=0.46), dict(s=9.0, le=-17.7, te=-20.4, t=0.18)]
    surface(body, fs, fin_place(), SYM,
            lambda i, side, x: 'fin2' if i == 1 else ('white' if i == 0 else 'fin'))

    root = ctx.root('Transport')
    ctx.part('Body', body, 'paint', root)
    r = tip_r - 0.25
    le = lerp_table(T_WING_LE, r)
    u = t_wing_h(r)
    ctx.part('NavLight_L', navlight_geo(le + 0.15, le - 0.5, 0.14, -r, u, 'nav_red'), 'glow', root, (-r, le, u))
    ctx.part('NavLight_R', navlight_geo(le + 0.15, le - 0.5, 0.14, r, u, 'nav_green'), 'glow', root, (r, le, u))


# =============================================================================
# Blender plumbing
# =============================================================================
class Ctx:
    """Fresh scene for one aircraft: palette image, two materials, nodes."""

    def __init__(self, livery, tmpdir):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.livery = livery
        path = os.path.join(tmpdir, f'palette_{livery}.png')
        with open(path, 'wb') as fh:
            fh.write(palette_png(livery))
        img = bpy.data.images.load(path, check_existing=False)
        img.name = f'palette_{livery}'
        img.pack()
        img.filepath = ''
        img.filepath_raw = ''
        self.image = img
        self.mats = {'paint': self._material('Paint', emissive=False),
                     'glow': self._material('Glow', emissive=True)}
        self.objects = []

    def _material(self, name, emissive):
        m = bpy.data.materials.new(name)
        if hasattr(m, 'use_nodes'):
            m.use_nodes = True
        m.use_backface_culling = True  # closed meshes: export single-sided (glTF doubleSided false)
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = self.image
        tex.interpolation = 'Closest'
        b.inputs['Metallic'].default_value = 0.0
        if emissive:
            # black base + palette-driven emission: glTF emissiveTexture, factor 1
            b.inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1.0)
            b.inputs['Roughness'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
            b.inputs['Emission Strength'].default_value = 1.0
        else:
            nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
            b.inputs['Roughness'].default_value = 0.5
        return m

    def root(self, name):
        ob = bpy.data.objects.new(name, None)
        self.scene.collection.objects.link(ob)
        self.objects.append(ob)
        return ob

    def part(self, name, geo, mat, parent, pivot=(0.0, 0.0, 0.0)):
        pr, pf, pu = pivot
        verts = [(f - pf, -(r - pr), u - pu) for r, f, u in geo.verts]
        faces = [idx for idx, _, _ in geo.faces]
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        assert len(me.polygons) == len(geo.faces), name
        me.shade_smooth()
        uv = me.uv_layers.new(name='UVMap')
        for poly, (_, slot, smooth) in zip(me.polygons, geo.faces):
            poly.use_smooth = smooth
            if isinstance(slot, dict):  # per-vertex UVs (ramp)
                for li in poly.loop_indices:
                    uv.data[li].uv = slot[me.loops[li].vertex_index]
            else:
                uvc = slot_uv(slot)
                for li in poly.loop_indices:
                    uv.data[li].uv = uvc
        me.set_sharp_from_angle(angle=40 * DEG)
        me.materials.append(self.mats[mat])
        ob = bpy.data.objects.new(name, me)
        self.scene.collection.objects.link(ob)
        ob.location = (pf, -pr, pu)
        ob.parent = parent
        self.objects.append(ob)
        return ob

    def export(self, path):
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=True,
            export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
            export_vertex_color='NONE', export_image_format='AUTO', export_materials='EXPORT',
            export_texcoords=True, export_normals=True, export_tangents=False, export_morph=False,
            export_skins=False, export_draco_mesh_compression_enable=False, export_use_gltfpack=False,
            export_original_specular=False)


AIRCRAFT = {
    'fighter_player': ('player', build_fighter),
    'fighter_bandit': ('bandit', build_fighter),
    'fighter_ace': ('ace', build_fighter),
    'bomber': ('bomber', build_bomber),
    'transport': ('transport', build_transport),
}
BUDGET = {'fighter_player': 1500, 'fighter_bandit': 1500, 'fighter_ace': 1500, 'bomber': 3000, 'transport': 3000}


# =============================================================================
# GLB inspection (what Cesium will actually see)
# =============================================================================
def inspect_glb(path):
    data = open(path, 'rb').read()
    magic, ver, total = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF' and ver == 2
    clen, _ = struct.unpack_from('<I4s', data, 12)
    g = json.loads(data[20:20 + clen])
    acc = g['accessors']
    nodes = g['nodes']

    def quat_mat(q):
        x, y, z, w = q
        return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]

    lo, hi = [1e9] * 3, [-1e9] * 3
    prims = tris = 0
    names = []
    node_tris = {}

    def walk(ni, R, T):
        nonlocal prims, tris
        n = nodes[ni]
        names.append(n.get('name'))
        Rl = quat_mat(n.get('rotation', [0, 0, 0, 1]))
        Tl = n.get('translation', [0, 0, 0])
        R2 = [[sum(R[i][k] * Rl[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        T2 = [T[i] + sum(R[i][k] * Tl[k] for k in range(3)) for i in range(3)]
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                prims += 1
                t = acc[p['indices']]['count'] // 3
                tris += t
                node_tris[n.get('name')] = node_tris.get(n.get('name'), 0) + t
                a = acc[p['attributes']['POSITION']]
                for corner in range(8):
                    c = [a['max'][i] if corner >> i & 1 else a['min'][i] for i in range(3)]
                    w = [T2[i] + sum(R2[i][k] * c[k] for k in range(3)) for i in range(3)]
                    for i in range(3):
                        lo[i], hi[i] = min(lo[i], w[i]), max(hi[i], w[i])
        for c in n.get('children', []):
            walk(c, R2, T2)

    I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for ni in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(ni, I3, [0, 0, 0])
    imgs = []
    for im in g.get('images', []):
        bv = g['bufferViews'][im['bufferView']]
        off = 20 + clen + 8 + bv.get('byteOffset', 0)
        w, h = struct.unpack('>II', data[off + 16:off + 24])
        imgs.append((im.get('mimeType'), w, h))
    return dict(bytes=total, tris=tris, prims=prims, nodes=names, node_tris=node_tris, images=imgs,
                materials=[m['name'] for m in g.get('materials', [])],
                extensionsUsed=g.get('extensionsUsed', []), extensionsRequired=g.get('extensionsRequired', []),
                samplers=g.get('samplers', []),
                size=[round(hi[i] - lo[i], 2) for i in range(3)], min=[round(x, 2) for x in lo],
                max=[round(x, 2) for x in hi])


# =============================================================================
# Cycles previews (optional): 3/4 front, chase-cam 3/4 rear-above, side.
# =============================================================================
def look_at(cam, loc, target):
    from mathutils import Vector
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_preview_world(scene):
    world = bpy.data.worlds.new('Sky')
    scene.world = world
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.10, 0.11, 0.105, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (0.20, 0.36, 0.62, 1)
    e = cr.elements.new(0.497)
    e.color = (0.30, 0.31, 0.32, 1)
    e = cr.elements.new(0.503)
    e.color = (0.62, 0.68, 0.75, 1)
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.2
    sun.angle = 2.0 * DEG
    so = bpy.data.objects.new('Sun', sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (38 * DEG, 18 * DEG, 150 * DEG)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'


def render_previews(name, ctx, outdir, res):
    scene = ctx.scene
    setup_preview_world(scene)
    camd = bpy.data.cameras.new('Cam')
    cam = bpy.data.objects.new('Cam', camd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    L, k = {'fighter': (15.0, 1.0), 'bomber': (48.0, 0.92), 'transport': (40.0, 0.95)}[name.split('_')[0]]
    L *= k
    # Blender frame: +X nose, +Y left wing, +Z up.
    views = {
        'front34': ((0.95 * L, 0.80 * L, 0.38 * L), (0.02 * L, 0.04 * L, 0.0), 50.0),
        'chase34': ((-1.55 * L, -0.55 * L, 0.62 * L), (0.0, 0.0, 0.0), 50.0),
        'side': ((0.0, -2.4 * L, 0.10 * L), (0.0, 0.0, 0.0), 50.0),
    }
    out = []
    scene.render.resolution_x, scene.render.resolution_y = res
    for view, (loc, tgt, lens) in views.items():
        camd.lens = lens
        camd.sensor_fit = 'HORIZONTAL'
        camd.clip_end = 5000
        look_at(cam, loc, tgt)
        path = os.path.join(outdir, f'{name}_{view}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        out.append(path)
    # true game chase camera: 58 m behind, 20 m above, pitch -10 deg, 60 deg FOV
    if name.startswith('fighter'):
        camd.lens_unit = 'FOV'
        camd.sensor_fit = 'HORIZONTAL'
        camd.angle = 60 * DEG
        cam.location = (-58.0, 0.0, 20.0)
        cam.rotation_euler = ((90 - 10) * DEG, 0.0, -90 * DEG)
        path = os.path.join(outdir, f'{name}_gamechase.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        out.append(path)
        camd.lens_unit = 'MILLIMETERS'
    return out


def contact_sheet(paths, out_path, cols):
    import numpy as np
    ims = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        ims.append(a)
        bpy.data.images.remove(im)
    h = max(a.shape[0] for a in ims)
    w = max(a.shape[1] for a in ims)
    rows = (len(ims) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), np.float32)
    for k, a in enumerate(ims):
        r, c = k // cols, k % cols
        y0 = (rows - 1 - r) * h  # Blender pixel rows run bottom-up
        sheet[y0:y0 + a.shape[0], c * w:c * w + a.shape[1]] = a
    img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out_path
    img.file_format = 'PNG'
    img.save()


# =============================================================================
def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=os.path.join(REPO, 'public', 'models'))
    ap.add_argument('--only', nargs='*', choices=sorted(AIRCRAFT), default=None)
    ap.add_argument('--previews', default=None, help='directory for Cycles preview PNGs (optional)')
    ap.add_argument('--res', default='800x500')
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    res = tuple(int(x) for x in args.res.split('x'))
    names = args.only or list(AIRCRAFT)
    report = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            livery, builder = AIRCRAFT[name]
            ctx = Ctx(livery, tmp)
            builder(ctx)
            path = os.path.join(args.out, f'{name}.glb')
            ctx.export(path)
            info = inspect_glb(path)
            report[name] = info
            assert not info['extensionsUsed'], (name, info['extensionsUsed'])
            assert info['tris'] <= BUDGET[name], (name, info['tris'])
            assert all(w <= 64 and h <= 64 for _, w, h in info['images']), info['images']
            if args.previews:
                os.makedirs(args.previews, exist_ok=True)
                shots = render_previews(name, ctx, args.previews, res)
                contact_sheet(shots, os.path.join(args.previews, f'{name}_sheet.png'), 2)
    print('\nAIRCRAFT REPORT')
    for name, i in report.items():
        print(f"  {name:16s} {i['bytes']:7d} B  tris={i['tris']:5d}  draw-prims={i['prims']:2d}  "
              f"size(x nose, y up, z right)={i['size']}  images={i['images']}")
        print(f"  {'':16s} node tris={i['node_tris']}  materials={i['materials']}  ext={i['extensionsUsed']}")
    print('REPORT_JSON ' + json.dumps(report))


if __name__ == '__main__':
    # `python build_aircraft.py args` (bpy module) or `blender -b -P build_aircraft.py -- args`
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
