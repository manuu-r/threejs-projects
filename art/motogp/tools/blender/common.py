"""Shared helpers for headless Blender asset builders.

Coordinate conventions:
  - Game/world space (track.json, engine): Y up, flat track on the XZ plane.
  - Blender scene space: Z up.
  - The glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y); therefore
    to_game() authors geometry so exported coords match game coords exactly:
    blender_pos = (game_x, -game_z, game_y).

All builders are deterministic: no randomness, sorted iteration, rounded output.
"""

import json
import math
import os
import sys

import bpy

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
ART_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def reset_scene():
    """Clear every scene object without replacing Blender's active context.

    `read_factory_settings()` invalidates `active_object` in Blender 5's glTF
    exporter when the generator is driven through the Blender MCP session.
    Removing datablocks directly leaves the context valid for export while
    still giving each asset builder an empty scene.
    """
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        if material.users == 0:
            bpy.data.materials.remove(material)


def make_material(name, color, roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def to_game(p):
    """Game-space tuple -> Blender-space vertex."""
    return (p[0], -p[2], p[1])


def build_mesh(name, verts, faces, materials=None, face_mats=None):
    """Create a mesh object from raw loops. verts/faces in BLENDER space."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    if mesh.uv_layers:
        pass  # builders add UV layers explicitly via set_face_uvs when needed
    if materials:
        for m in materials:
            mesh.materials.append(m)
    if face_mats:
        for poly, mi in zip(mesh.polygons, face_mats):
            poly.material_index = mi
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def set_face_uvs(mesh, per_loop_uv):
    """Assign uv tuples, one per mesh loop, in order."""
    uv_layer = mesh.uv_layers[0]
    for i, uvv in enumerate(per_loop_uv):
        uv_layer.data[i].uv = uvv


def export_glb(objects, filepath):
    """Export selected objects as GLB (Y-up conversion handled by exporter)."""
    # Deselect everything, select only ours.
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        use_selection=True,
    )
    size = os.path.getsize(filepath)
    print(f"[export] {filepath} ({size / 1024:.1f} KiB)")
    return filepath


def load_track_json(path=None):
    path = path or os.path.join(ART_ROOT, "track.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# --- spline math (uniform Catmull-Rom, closed) -------------------------------


def catmull_rom_point(p0, p1, p2, p3, t):
    """Uniform Catmull-Rom: passes through p1 at t=0 and p2 at t=1."""
    t2 = t * t
    t3 = t2 * t
    return tuple(
        0.5 * (
            (2 * b)
            + (-a + c) * t
            + (2 * a - 5 * b + 4 * c - d) * t2
            + (-a + 3 * b - 3 * c + d) * t3
        )
        # (a, b, c, d) must be (P0, P1, P2, P3): (2b)=2·P1, (-a+c)=P2-P0, ...
        for a, b, c, d in zip(p0, p1, p2, p3)
    )


def eval_closed_spline(points, subdivisions_per_segment=64):
    """Evaluate a closed uniform Catmull-Rom through `points` (3-tuples).

    Returns dense polyline including the wrap-around back to points[0].
    """
    n = len(points)
    dense = []
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n]
        for j in range(subdivisions_per_segment):
            t = j / subdivisions_per_segment
            dense.append(catmull_rom_point(p0, p1, p2, p3, t))
    dense.append(dense[0])
    return dense


def resample_closed(dense, spacing):
    """Resample a closed polyline (first==last) at fixed arc-length spacing."""
    cum = [0.0]
    for i in range(1, len(dense)):
        seg = math.dist(dense[i], dense[i - 1])
        cum.append(cum[-1] + seg)
    total = cum[-1]
    count = max(8, int(round(total / spacing)))
    step = total / count
    samples = []
    seg = 1
    for k in range(count):
        target = k * step
        while seg < len(cum) - 1 and cum[seg] < target:
            seg += 1
        seg_len = cum[seg] - cum[seg - 1] or 1e-9
        f = (target - cum[seg - 1]) / seg_len
        a, b = dense[seg - 1], dense[seg]
        samples.append(tuple(a[i] + (b[i] - a[i]) * f for i in range(3)))
    return samples, total


def tangent_and_right(prev_pt, next_pt):
    """Unit tangent (travel dir) and unit lateral-right in GAME space."""
    t = (next_pt[0] - prev_pt[0], next_pt[1] - prev_pt[1], next_pt[2] - prev_pt[2])
    tl = math.sqrt(t[0] ** 2 + t[2] ** 2) or 1e-9
    tg = (t[0] / tl, 0.0, t[2] / tl)
    right = (tg[2], 0.0, -tg[0])
    return tg, right


def finish(summary_lines):
    print("[summary]")
    for line in summary_lines:
        print("  " + line)
    sys.stdout.flush()
