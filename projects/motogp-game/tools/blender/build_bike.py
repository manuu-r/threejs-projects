"""Build the low-poly MotoGP bike + tuck rider and export public/assets/bike.glb.

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
        "fairing": make_material("bike_fairing", (0.78, 0.07, 0.10), roughness=0.32, metallic=0.15),
        "dark": make_material("bike_carbon", (0.07, 0.07, 0.08), roughness=0.5),
        "metal": make_material("bike_metal", (0.55, 0.56, 0.60), roughness=0.35, metallic=0.85),
        "suit": make_material("rider_suit", (0.05, 0.05, 0.06), roughness=0.8),
        "helmet": make_material("rider_helmet", (0.85, 0.83, 0.78), roughness=0.25, metallic=0.1),
        "screen": make_material("bike_screen", (0.10, 0.12, 0.14), roughness=0.15, metallic=0.3),
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

    # --- running gear (wheels drawn by the engine) ------------------------------
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
            0.028, 0.022, mats["metal"],
        ))
    # Handlebars.
    objects.append(cylinder(
        "bars", (-0.30, 0.44, 0.46), (0.30, 0.44, 0.46), 0.017, 0.017, mats["dark"],
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
        "helmet", (0.0, 0.50, 0.02), (0.0, 0.56, 0.16), 0.115, 0.105, mats["helmet"],
    ))
    # Arms: shoulders to the bar ends.
    for side in (-1, 1):
        objects.append(cylinder(
            f"arm_{'L' if side < 0 else 'R'}",
            (side * 0.10, 0.44, 0.02),
            (side * 0.26, 0.44, 0.44),
            0.045, 0.035, mats["suit"],
        ))
    # Thighs: hips to footpegs.
    for side in (-1, 1):
        objects.append(cylinder(
            f"leg_{'L' if side < 0 else 'R'}",
            (side * 0.11, 0.10, -0.32),
            (side * 0.20, -0.34, -0.18),
            0.065, 0.050, mats["suit"],
        ))

    out_dir = os.path.join(PROJECT_ROOT, "public", "assets")
    os.makedirs(out_dir, exist_ok=True)
    tri_count = sum(len(o.data.polygons) for o in objects)
    finish([
        f"objects: {len(objects)}, quads: {tri_count}",
    ])
    export_glb(objects, os.path.join(out_dir, "bike.glb"))


# Wheel anchor points must match src/config.ts WHEELS.
WHEEL_ATTACH_Y = -0.29
WHEELS_Z_FRONT = 0.75
WHEELS_Z_REAR = -0.75

if __name__ == "__main__":
    main()
