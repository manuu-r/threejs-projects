"""Build the race-spec MotoGP bike + tuck rider and export public/motogp/bike.glb.

Authored directly in GAME space (Y up, forward +Z, right +X) — common.to_game
converts at mesh-build time so exported coords match physics coords exactly.
The body origin is the PHYSICS chassis center: wheels hang at y = attachY
(-0.29) with radius 0.31, so the ground plane sits at y = -0.60.

Wheels are intentionally NOT exported — the engine draws them procedurally from
live suspension/steer/spin state so they always match the constraint.

Run: blender --background --factory-startup --python tools/blender/build_bike.py
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (
    PROJECT_ROOT,
    build_mesh,
    export_glb,
    finish,
    make_material,
    reset_scene,
    to_game,
)

CYL_SEGS = 12


def frustum(name, bottom, top, material):
    """Box between two parallel rectangles (4-tuples of (x, y, z), game space)."""
    b = [to_game(p) for p in bottom]
    t = [to_game(p) for p in top]
    verts = b + t
    faces = [
        (0, 3, 2, 1),           # bottom (inverted so its normal points down)
        (4, 5, 6, 7),           # top
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    return build_mesh(name, verts, faces, materials=[material])


def rect(y, z0, z1, x0, x1):
    """Axis-aligned rectangle corners in game space, CCW seen from above."""
    return [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]


def cylinder(name, p0, p1, r0, r1, material, segs=CYL_SEGS):
    """Tapered cylinder from p0 to p1 (game space), radius r0 -> r1."""
    ax = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    length = math.sqrt(ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2) or 1e-9
    a = (ax[0] / length, ax[1] / length, ax[2] / length)
    # Orthonormal basis (u, a, v) around the axis.
    up = (0.0, 1.0, 0.0)
    if abs(a[1]) > 0.99:
        up = (1.0, 0.0, 0.0)
    ux = a[1] * up[2] - a[2] * up[1]
    uy = a[2] * up[0] - a[0] * up[2]
    uz = a[0] * up[1] - a[1] * up[0]
    ul = math.sqrt(ux * ux + uy * uy + uz * uz) or 1e-9
    u = (ux / ul, uy / ul, uz / ul)
    v = (
        a[1] * u[2] - a[2] * u[1],
        a[2] * u[0] - a[0] * u[2],
        a[0] * u[1] - a[1] * u[0],
    )

    def ring(center, r):
        pts = []
        for i in range(segs):
            th = 2 * math.pi * i / segs
            c, s = math.cos(th), math.sin(th)
            pts.append(
                to_game(
                    (
                        center[0] + r * (c * u[0] + s * v[0]),
                        center[1] + r * (c * u[1] + s * v[1]),
                        center[2] + r * (c * u[2] + s * v[2]),
                    )
                )
            )
        return pts

    rb = ring(p0, r0)
    rt = ring(p1, r1)
    verts = rb + rt
    faces = []
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((i, j, segs + j, segs + i))
    faces.append(tuple(range(segs - 1, -1, -1)))          # cap at p0
    faces.append(tuple(range(segs, 2 * segs)))            # cap at p1
    return build_mesh(name, verts, faces, materials=[material])


def main():
    reset_scene()

    mats = {
        "fairing": make_material("factory_red", (0.78, 0.018, 0.035), roughness=0.22, metallic=0.28),
        "stripe": make_material("race_white", (0.92, 0.94, 0.95), roughness=0.28, metallic=0.1),
        "accent": make_material("electric_cyan", (0.01, 0.34, 0.52), roughness=0.2, metallic=0.5),
        "dark": make_material("forged_carbon", (0.012, 0.016, 0.025), roughness=0.31, metallic=0.35),
        "metal": make_material("machined_aluminium", (0.48, 0.53, 0.58), roughness=0.24, metallic=0.92),
        "gold": make_material("fork_gold", (0.72, 0.42, 0.06), roughness=0.2, metallic=0.92),
        "rubber": make_material("race_rubber", (0.008, 0.009, 0.012), roughness=0.7),
        "suit": make_material("rider_leathers", (0.025, 0.04, 0.07), roughness=0.38, metallic=0.05),
        "suit_trim": make_material("rider_trim", (0.8, 0.035, 0.06), roughness=0.3, metallic=0.18),
        "helmet": make_material("helmet_pearl", (0.94, 0.95, 0.94), roughness=0.16, metallic=0.25),
        "visor": make_material("visor_smoke", (0.008, 0.025, 0.045), roughness=0.08, metallic=0.55),
        "screen": make_material("windscreen_smoke", (0.02, 0.08, 0.12), roughness=0.1, metallic=0.38),
    }

    objects = []

    # --- body: nose, tank, seat/tail, belly -----------------------------------
    # Nose: wide at the tank, tapering to the front spindle line.
    objects.append(frustum(
        "nose",
        rect(-0.18, 0.40, 0.95, -0.17, 0.17),
        rect(0.22, 0.55, 0.90, -0.10, 0.10),
        mats["fairing"],
    ))
    # Windscreen atop the nose.
    objects.append(frustum(
        "screen",
        rect(0.22, 0.55, 0.88, -0.09, 0.09),
        rect(0.34, 0.68, 0.80, -0.07, 0.07),
        mats["screen"],
    ))
    # Tank.
    objects.append(frustum(
        "tank",
        rect(-0.05, -0.15, 0.50, -0.19, 0.19),
        rect(0.28, -0.05, 0.42, -0.15, 0.15),
        mats["fairing"],
    ))
    # Seat + tail (kicks up at the rear).
    objects.append(frustum(
        "tail",
        rect(0.02, -0.80, -0.10, -0.14, 0.14),
        rect(0.24, -0.72, -0.16, -0.10, 0.10),
        mats["fairing"],
    ))
    objects.append(frustum(
        "tail_tip",
        rect(0.24, -0.78, -0.60, -0.09, 0.09),
        rect(0.34, -0.74, -0.66, -0.06, 0.06),
        mats["dark"],
    ))
    # Belly pan.
    objects.append(frustum(
        "belly",
        rect(-0.48, -0.55, 0.55, -0.16, 0.16),
        rect(-0.12, -0.50, 0.50, -0.19, 0.19),
        mats["dark"],
    ))

    # --- race bodywork: layered side pods, intakes and aero --------------------
    # The base fairing above establishes the silhouette. These thin layers give
    # the rear camera rich highlights and prevent the bike from reading as a
    # single red block at speed.
    for side in (-1, 1):
        x0, x1 = side * 0.17, side * 0.235
        if side < 0:
            x0, x1 = x1, x0
        objects.append(frustum(
            f"sidepod_{'L' if side < 0 else 'R'}",
            rect(-0.34, -0.02, 0.73, x0, x1),
            rect(0.06, 0.16, 0.63, x0 * 0.86, x1 * 0.86),
            mats["fairing"],
        ))
        objects.append(frustum(
            f"sidepod_stripe_{'L' if side < 0 else 'R'}",
            rect(-0.015, 0.28, 0.58, x0 * 1.01, x1 * 1.01),
            rect(0.035, 0.33, 0.55, x0 * 1.01, x1 * 1.01),
            mats["stripe"],
        ))
        # Stacked winglets in front of the rider, each one an actual thin foil.
        for level, y in enumerate((0.08, 0.17)):
            wing_x0, wing_x1 = side * 0.19, side * 0.39
            if side < 0:
                wing_x0, wing_x1 = wing_x1, wing_x0
            objects.append(frustum(
                f"wing_{'L' if side < 0 else 'R'}_{level}",
                rect(y, 0.50, 0.74, wing_x0, wing_x1),
                rect(y + 0.028, 0.53, 0.70, wing_x0 * 0.96, wing_x1 * 0.96),
                mats["dark"],
            ))

    # Ram-air intake lip and radiator matrix.
    objects.append(frustum(
        "intake_lip",
        rect(-0.02, 0.78, 0.98, -0.13, 0.13),
        rect(0.13, 0.79, 0.92, -0.095, 0.095),
        mats["dark"],
    ))
    for z in (0.16, 0.25, 0.34):
        objects.append(cylinder(
            f"radiator_fin_{z}", (-0.17, -0.12, z), (0.17, -0.12, z), 0.012, 0.012, mats["metal"], 10,
        ))

    # --- running gear (wheels drawn live by the engine) -------------------------
    # Forks: steering head down to the front spindle, along the caster axis.
    head = (0.0, 0.34, 0.52)
    axle_f = (0.0, WHEEL_ATTACH_Y, WHEELS_Z_FRONT)
    caster = math.radians(26.0)
    for side in (-1, 1):
        off = (side * 0.075, 0.0, 0.0)
        objects.append(cylinder(
            f"fork_{'L' if side < 0 else 'R'}",
            (head[0] + off[0], head[1], head[2] + off[2]),
            (axle_f[0] + off[0], axle_f[1], axle_f[2] + off[2]),
            0.034, 0.025, mats["gold"],
        ))
    # Handlebars.
    objects.append(cylinder(
        "bars", (-0.30, 0.44, 0.46), (0.30, 0.44, 0.46), 0.017, 0.017, mats["dark"],
    ))
    # Carbon clip-ons, brake discs and calipers make the exposed mechanical
    # areas read clearly through the fairing openings.
    for side in (-1, 1):
        objects.append(cylinder(
            f"clip_on_{'L' if side < 0 else 'R'}",
            (side * 0.10, 0.42, 0.41), (side * 0.33, 0.42, 0.49), 0.014, 0.014, mats["dark"], 10,
        ))
    for name, z, radius in (("front", WHEELS_Z_FRONT, 0.22), ("rear", WHEELS_Z_REAR, 0.18)):
        objects.append(cylinder(
            f"brake_disc_{name}", (-0.045, WHEEL_ATTACH_Y, z), (0.045, WHEEL_ATTACH_Y, z), radius, radius, mats["metal"], 24,
        ))
        objects.append(cylinder(
            f"caliper_{name}", (0.09, WHEEL_ATTACH_Y + 0.08, z + 0.03), (0.14, WHEEL_ATTACH_Y + 0.08, z + 0.03), 0.045, 0.045, mats["fairing"], 10,
        ))
    # Swingarm: pivot behind the rider to the rear spindle.
    for side in (-1, 1):
        objects.append(cylinder(
            f"swingarm_{'L' if side < 0 else 'R'}",
            (side * 0.09, -0.22, -0.12),
            (side * 0.075, WHEEL_ATTACH_Y, WHEELS_Z_REAR),
            0.030, 0.026, mats["metal"],
        ))
    # Exhaust, right side, low.
    objects.append(cylinder(
        "exhaust", (0.16, -0.30, -0.30), (0.20, -0.38, -0.78), 0.055, 0.045, mats["metal"],
    ))
    objects.append(cylinder(
        "exhaust_tip", (0.20, -0.38, -0.78), (0.21, -0.39, -0.89), 0.058, 0.052, mats["dark"],
    ))
    # Frame, rear-set pegs and a visible chain run bring enough detail to the
    # rider view without exporting duplicate wheels.
    for side in (-1, 1):
        objects.append(cylinder(
            f"frame_{'L' if side < 0 else 'R'}",
            (side * 0.12, 0.18, 0.24), (side * 0.12, -0.20, -0.31), 0.022, 0.018, mats["metal"],
        ))
        objects.append(cylinder(
            f"peg_{'L' if side < 0 else 'R'}",
            (side * 0.10, -0.25, -0.18), (side * 0.28, -0.25, -0.18), 0.018, 0.018, mats["metal"], 10,
        ))
    objects.append(cylinder(
        "chain_guard", (-0.12, -0.34, -0.18), (-0.12, -0.34, -0.72), 0.022, 0.022, mats["gold"], 10,
    ))

    # --- rider in full tuck ------------------------------------------------------
    # Torso: hips over the seat, shoulders low over the tank.
    objects.append(frustum(
        "torso",
        rect(0.10, -0.42, -0.18, -0.13, 0.13),
        rect(0.46, -0.10, 0.10, -0.11, 0.11),
        mats["suit"],
    ))
    # Helmet just ahead of the shoulders.
    objects.append(cylinder(
        "helmet", (0.0, 0.50, 0.02), (0.0, 0.59, 0.17), 0.14, 0.12, mats["helmet"], 20,
    ))
    objects.append(frustum(
        "helmet_visor",
        rect(0.51, 0.12, 0.24, -0.105, 0.105),
        rect(0.59, 0.17, 0.25, -0.095, 0.095),
        mats["visor"],
    ))
    objects.append(frustum(
        "rider_hump",
        rect(0.28, -0.42, -0.13, -0.12, 0.12),
        rect(0.53, -0.33, -0.10, -0.08, 0.08),
        mats["suit_trim"],
    ))
    # Arms: shoulders to the bar ends.
    for side in (-1, 1):
        objects.append(cylinder(
            f"arm_{'L' if side < 0 else 'R'}",
            (side * 0.10, 0.44, 0.02),
            (side * 0.26, 0.44, 0.44),
            0.045, 0.035, mats["suit"],
        ))
        objects.append(cylinder(
            f"glove_{'L' if side < 0 else 'R'}",
            (side * 0.26, 0.44, 0.44), (side * 0.30, 0.43, 0.50), 0.040, 0.035, mats["suit_trim"], 12,
        ))
    # Thighs: hips to footpegs.
    for side in (-1, 1):
        objects.append(cylinder(
            f"leg_{'L' if side < 0 else 'R'}",
            (side * 0.11, 0.10, -0.32),
            (side * 0.20, -0.34, -0.18),
            0.065, 0.050, mats["suit"],
        ))
        objects.append(cylinder(
            f"boot_{'L' if side < 0 else 'R'}",
            (side * 0.20, -0.34, -0.18), (side * 0.28, -0.30, 0.04), 0.060, 0.048, mats["rubber"], 12,
        ))
        objects.append(cylinder(
            f"knee_slider_{'L' if side < 0 else 'R'}",
            (side * 0.18, -0.10, -0.12), (side * 0.27, -0.13, -0.10), 0.055, 0.045, mats["suit_trim"], 12,
        ))

    out_dir = os.path.join(PROJECT_ROOT, "public", "motogp")
    os.makedirs(out_dir, exist_ok=True)
    tri_count = sum(len(o.data.polygons) for o in objects)
    finish([
        f"race-spec objects: {len(objects)}, faces: {tri_count}",
    ])
    export_glb(objects, os.path.join(out_dir, "bike.glb"))


# Wheel anchor points must match src/config.ts WHEELS.
WHEEL_ATTACH_Y = -0.29
WHEELS_Z_FRONT = 0.75
WHEELS_Z_REAR = -0.75

if __name__ == "__main__":
    main()
