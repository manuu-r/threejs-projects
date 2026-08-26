"""Build the circuit: asphalt ribbon, edge lines, curbs, start gantry, barriers,
grass plane. Exports public/assets/track.glb AND public/assets/track-collision.json
(dense centerline samples shared with the engine so physics can never drift from
visuals).

All geometry is computed in GAME space (Y up, track on XZ) and converted to
Blender space only at mesh-build time (see common.to_game).

Run: blender --background --factory-startup --python tools/blender/build_track.py
"""

import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (
    PROJECT_ROOT,
    build_mesh,
    eval_closed_spline,
    export_glb,
    finish,
    load_track_json,
    make_material,
    reset_scene,
    resample_closed,
    tangent_and_right,
    to_game,
)

SPACING = 4.0
CURB_WIDTH = 1.0
CURB_HALF_SPAN = math.radians(9.0)
LINE_WIDTH = 0.12
BARRIER_HEIGHT = 1.0
BARRIER_CHUNK_M = 8.0
GRASS_SIZE = 3000

# Layer heights (game Y). Separations are deliberately centimetre-scale: depth
# precision at 100+ m is a few mm even on 24-bit depth buffers, and flat
# decals closer than that to the surface they sit on z-fight into shimmer.
GRASS_Y = -0.06
LINE_Y = 0.02
CURB_Y = 0.03
CHECKER_Y = 0.04


def main():
    reset_scene()
    track = load_track_json()
    hw_default = float(track["defaultHalfWidthM"])
    barrier_offset = float(track["defaultBarrierOffsetM"])
    points = [tuple(p["p"]) for p in track["points"]]

    # --- spline -> dense -> arc-length resample ------------------------------
    dense = eval_closed_spline(points, subdivisions_per_segment=64)
    samples, total_len = resample_closed(dense, SPACING)
    n = len(samples)

    # Sanity: the spline must visit anchors in order — find each anchor's nearest
    # sample and require those indices to advance monotonically around the lap.
    # Catches basis-function bugs that still "hit every point" but zigzag.
    anchor_idx = []
    for spec in track["points"]:
        sp = spec["p"]
        best_i = min(range(n), key=lambda i: math.dist(samples[i], sp))
        anchor_idx.append(best_i)
    for k in range(1, len(anchor_idx)):
        gap = (anchor_idx[k] - anchor_idx[k - 1]) % n
        if gap <= 0:
            raise SystemExit(
                f"track spline visits anchors out of order "
                f"(anchor {k - 1}@{anchor_idx[k - 1]} -> {k}@{anchor_idx[k]})"
            )

    def right_at(i):
        tg, right = tangent_and_right(samples[i - 1], samples[(i + 1) % n])
        return right

    def pt(i, lateral, y=0.0):
        r = right_at(i)
        p = samples[i]
        return (p[0] + r[0] * lateral, y, p[2] + r[2] * lateral)

    # --- per-sample flags: half-width + curbs (nearest anchor by polar angle) --
    anchors = track["points"]
    n_pts = len(anchors)
    anchor_angles = [math.atan2(s["p"][2], s["p"][0]) for s in anchors]
    # Turn side per anchor: sign of the polygon cross product decides which side
    # is the inside of the corner.
    inside_right = []
    for i in range(n_pts):
        a = points[(i - 1) % n_pts]
        b = points[i]
        c = points[(i + 1) % n_pts]
        cross_y = (b[0] - a[0]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[0] - b[0])
        inside_right.append(cross_y < 0)

    curb_spans = []  # (angle_center, 'left' | 'right')
    for i, spec in enumerate(anchors):
        side = spec.get("curb", "none")
        if side == "none":
            continue
        turn_side = "right" if inside_right[i] else "left"
        sides = ["left", "right"] if side == "both" else [turn_side]
        for s in sides:
            curb_spans.append((anchor_angles[i], s))

    def ang_dist(a, b):
        return abs((a - b + math.pi) % (2 * math.pi) - math.pi)

    flags = []
    for i in range(n):
        p = samples[i]
        ang = math.atan2(p[2], p[0])
        hw = hw_default
        for j, spec in enumerate(anchors):
            if spec.get("hw") and ang_dist(ang, anchor_angles[j]) < CURB_HALF_SPAN:
                hw = float(spec["hw"])
        curb_l = False
        curb_r = False
        for center, side in curb_spans:
            if ang_dist(ang, center) < CURB_HALF_SPAN:
                if side in ("left", "both"):
                    curb_l = True
                if side in ("right", "both"):
                    curb_r = True
        flags.append((hw, curb_l, curb_r))

    # --- materials -------------------------------------------------------------
    mats = {
        "asphalt": make_material("asphalt", (0.11, 0.11, 0.12), roughness=0.95),
        "line": make_material("line_white", (0.9, 0.9, 0.88), roughness=0.6),
        "curb_red": make_material("curb_red", (0.75, 0.08, 0.08), roughness=0.8),
        "curb_white": make_material("curb_white", (0.92, 0.92, 0.9), roughness=0.8),
        "barrier_blue": make_material("barrier_blue", (0.1, 0.25, 0.65), roughness=0.6),
        "barrier_white": make_material("barrier_white", (0.85, 0.85, 0.83), roughness=0.6),
        "checker_black": make_material("checker_black", (0.05, 0.05, 0.05), roughness=0.7),
        "checker_white": make_material("checker_white", (0.95, 0.95, 0.93), roughness=0.7),
        "steel": make_material("gantry_steel", (0.35, 0.36, 0.4), roughness=0.5, metallic=0.6),
        "banner": make_material("gantry_banner", (0.75, 0.12, 0.14), roughness=0.6),
        "grass": make_material("grass", (0.28, 0.42, 0.18), roughness=1.0),
    }

    objects = []

    class QuadMesh:
        """Accumulates quads (game-space corners) into one Blender object."""

        def __init__(self, name, materials):
            self.name = name
            self.materials = materials
            self.verts = []
            self.faces = []
            self.face_mats = []
            self.uv_faces = []  # list of 4-tuples [(u,v)x4] per face, or None

        def quad(self, p1, p2, p3, p4, mat_idx=0, uvs=None):
            base = len(self.verts)
            self.verts.extend([to_game(p1), to_game(p2), to_game(p3), to_game(p4)])
            self.faces.append((base, base + 1, base + 2, base + 3))
            self.face_mats.append(mat_idx)
            self.uv_faces.append(uvs)

        def build(self):
            mesh = bpy.data.meshes.new(self.name)
            mesh.from_pydata(self.verts, [], self.faces)
            before = len(mesh.polygons)
            mesh.validate()
            after = len(mesh.polygons)
            if before != after or after == 0:
                print(f"[quadmesh] {self.name}: faces before={before} after={after} "
                      f"(verts={len(self.verts)}, faces_req={len(self.faces)})")
            bad = [v.index for v in mesh.vertices
                   if not all(math.isfinite(c) for c in v.co)]
            src_bad = [i for i, p in enumerate(self.verts)
                       if not all(math.isfinite(c) for c in p)]
            if bad or src_bad:
                print(f"[quadmesh] {self.name}: NONFINITE verts mesh={bad[:8]} "
                      f"src={src_bad[:8]} (of {len(self.verts)})")
            for m in self.materials:
                mesh.materials.append(m)
            for poly, mi in zip(mesh.polygons, self.face_mats):
                poly.material_index = mi
            if any(u is not None for u in self.uv_faces):
                uv_layer = mesh.uv_layers.new(name="UVMap")
                li = 0
                for face_uvs in self.uv_faces:
                    if face_uvs is not None:
                        for uvv in face_uvs:
                            uv_layer.data[li].uv = uvv
                    li += 4
            obj = bpy.data.objects.new(self.name, mesh)
            bpy.context.collection.objects.link(obj)
            return obj

    # Asphalt: one variable-width ribbon.
    asphalt = QuadMesh("asphalt", [mats["asphalt"]])
    for i in range(n):
        j = (i + 1) % n
        hw_i = flags[i][0]
        hw_j = flags[j][0]
        v0 = i * SPACING / 8.0
        v1 = v0 + SPACING / 8.0
        asphalt.quad(
            pt(i, -hw_i), pt(i, hw_i),
            pt(j, hw_j), pt(j, -hw_j),
            uvs=[(0, v0), (1, v0), (1, v1), (0, v1)],
        )
    objects.append(asphalt.build())

    # White edge lines.
    for sign, label in ((-1, "L"), (1, "R")):
        lines = QuadMesh(f"edge_line_{label}", [mats["line"]])
        for i in range(n):
            j = (i + 1) % n
            hw_i = flags[i][0]
            hw_j = flags[j][0]
            inner_i = hw_i * sign
            outer_i = (hw_i + LINE_WIDTH) * sign
            inner_j = hw_j * sign
            outer_j = (hw_j + LINE_WIDTH) * sign
            lines.quad(
                pt(i, inner_i, LINE_Y), pt(i, outer_i, LINE_Y),
                pt(j, outer_j, LINE_Y), pt(j, inner_j, LINE_Y),
            )
        objects.append(lines.build())

    # Curbs on flagged spans — red/white alternating every 2 m.
    curbs = QuadMesh("curbs", [mats["curb_red"], mats["curb_white"]])
    for i in range(n):
        j = (i + 1) % n
        hw_i, cl, cr = flags[i]
        hw_j, clj, crj = flags[j]
        for side_flag, side_flag_j, sign in ((cl, clj, -1), (cr, crj, 1)):
            if not (side_flag and side_flag_j):
                continue
            inner_i = hw_i * sign
            outer_i = (hw_i + CURB_WIDTH) * sign
            inner_j = hw_j * sign
            outer_j = (hw_j + CURB_WIDTH) * sign
            red = i % 2 == 0  # alternate per sample (4 m red / 4 m white)
            curbs.quad(
                pt(i, inner_i, CURB_Y), pt(i, outer_i, CURB_Y),
                pt(j, outer_j, CURB_Y), pt(j, inner_j, CURB_Y),
                mat_idx=0 if red else 1,
            )
    if curbs.faces:
        objects.append(curbs.build())

    # Barriers both sides — continuous wall, blue/white alternating chunks.
    chunk_samples = max(1, int(round(BARRIER_CHUNK_M / SPACING)))
    for sign, label in ((1, "R"), (-1, "L")):
        barrier = QuadMesh(f"barrier_{label}", [mats["barrier_blue"], mats["barrier_white"]])
        for i in range(n):
            j = (i + 1) % n
            off_i = (flags[i][0] + barrier_offset) * sign
            off_j = (flags[j][0] + barrier_offset) * sign
            barrier.quad(
                pt(i, off_i, 0.0), pt(i, off_i, BARRIER_HEIGHT),
                pt(j, off_j, BARRIER_HEIGHT), pt(j, off_j, 0.0),
                mat_idx=(i // chunk_samples) % 2,
            )
        objects.append(barrier.build())

    # Grass plane.
    grass = QuadMesh("grass", [mats["grass"]])
    g = GRASS_SIZE / 2
    grass.quad((-g, GRASS_Y, -g), (g, GRASS_Y, -g), (g, GRASS_Y, g), (-g, GRASS_Y, g))
    objects.append(grass.build())

    # Start/finish checker band over sample 0 (2 m deep).
    start_hw = flags[0][0]
    t0, _r0 = tangent_and_right(samples[-1], samples[1])
    cols = 10
    rows = 2
    cell_w = (start_hw * 2) / cols
    checkers = QuadMesh("start_line", [mats["checker_black"], mats["checker_white"]])

    def band_corner(lat, lon):
        p = samples[0]
        return (p[0] + _r0[0] * lat + t0[0] * lon, CHECKER_Y, p[2] + _r0[2] * lat + t0[2] * lon)

    for c in range(cols):
        for r in range(rows):
            la = -start_hw + c * cell_w
            lb = la + cell_w
            oa = r * 1.0
            ob = oa + 1.0
            checkers.quad(
                band_corner(la, oa), band_corner(lb, oa),
                band_corner(lb, ob), band_corner(la, ob),
                mat_idx=(c + r) % 2,
            )
    objects.append(checkers.build())

    # Gantry: two box pillars + beam + banner (built as boxes; no ops/context need).
    pillar_h = 7.0
    gantry_off = start_hw + 1.5

    def box(name, cx, cy, cz, hx, hy, hz, yaw, material):
        cy_, sy_ = math.cos(yaw), math.sin(yaw)

        def rot(dx, dz):
            return (cx + dx * cy_ + dz * sy_, cz - dx * sy_ + dz * cy_)

        corners_bottom = [rot(-hx, -hz), rot(hx, -hz), rot(hx, hz), rot(-hx, hz)]
        verts_b = [to_game((x, cy - hy, z)) for x, z in corners_bottom]
        verts_t = [to_game((x, cy + hy, z)) for x, z in corners_bottom]
        verts = verts_b + verts_t
        faces = [
            (0, 1, 2, 3),          # bottom
            (4, 5, 6, 7),          # top
            (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
        ]
        obj = build_mesh(name, verts, faces, materials=[material])
        return obj

    for sign, label in ((-1, "L"), (1, "R")):
        px = samples[0][0] + _r0[0] * gantry_off * sign
        pz = samples[0][2] + _r0[2] * gantry_off * sign
        yaw = math.atan2(_r0[0], _r0[2]) - math.pi / 2
        objects.append(box(f"gantry_pillar_{label}", px, pillar_h / 2, pz, 0.25, pillar_h / 2, 0.25, yaw, mats["steel"]))

    beam_len = gantry_off * 2 + 1.0
    yaw = math.atan2(_r0[0], _r0[2])
    objects.append(box("gantry_beam", samples[0][0], pillar_h - 0.35, samples[0][2], beam_len / 2, 0.25, 0.25, yaw, mats["steel"]))
    objects.append(box("gantry_banner", samples[0][0], pillar_h - 1.05, samples[0][2], beam_len / 2 - 0.2, 0.55, 0.06, yaw, mats["banner"]))

    # --- collision JSON ----------------------------------------------------------
    out_samples = []
    for i in range(n):
        tg, right = tangent_and_right(samples[i - 1], samples[(i + 1) % n])
        hw, curb_l, curb_r = flags[i]
        out_samples.append({
            "p": [round(samples[i][0], 4), round(samples[i][1], 4), round(samples[i][2], 4)],
            "t": [round(tg[0], 4), 0.0, round(tg[2], 4)],
            "n": [round(right[0], 4), 0.0, round(right[2], 4)],
            "hw": round(hw, 4),
            "bl": round(hw + barrier_offset, 4),
            "br": round(hw + barrier_offset, 4),
            "curbL": bool(curb_l),
            "curbR": bool(curb_r),
        })
    collision = {
        "version": 1,
        "spacing": SPACING,
        "lapLengthM": round(total_len, 2),
        "name": track["name"],
        "checkpoints": track.get("checkpoints", 8),
        "startSampleIndex": 0,
        "samples": out_samples,
    }
    out_dir = os.path.join(PROJECT_ROOT, "public", "assets")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "track-collision.json"), "w", encoding="utf-8") as f:
        json.dump(collision, f, separators=(",", ":"))
        f.write("\n")

    tri_count = sum(len(o.data.polygons) for o in objects if o.type == "MESH")
    finish([
        f"samples: {n} @ {SPACING} m",
        f"lap length: {total_len:.1f} m",
        f"objects: {len(objects)}, quads: {tri_count}",
        f"collision JSON: {os.path.getsize(os.path.join(out_dir, 'track-collision.json')) / 1024:.0f} KiB",
    ])

    export_glb(objects, os.path.join(out_dir, "track.glb"))


if __name__ == "__main__":
    main()
