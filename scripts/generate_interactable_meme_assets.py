"""Generate the five low-poly dioramas used by Interactable Memes.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python scripts/generate_interactable_meme_assets.py

The environments are modeled in Blender and the character-led scenes reuse the project's
licensed production meshes. Every browser-animated part is exported under a stable name.
"""

from __future__ import annotations

import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO / "public" / "interactable-memes" / "studio-models"
PREVIEW_DIR = REPO / "public" / "interactable-memes" / "studio-previews"
SOURCE_DIR = REPO / "art" / "interactable-memes"
LICENSED_MODEL_DIR = REPO / "public" / "interactable-memes" / "models"

MODEL_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)


def rgb(value: str) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)


PALETTE = {
    "ink": "#101012",
    "cream": "#eee8da",
    "skin": "#e8a875",
    "skin_light": "#f4bd87",
    "brown": "#5a3326",
    "hair": "#2a1b18",
    "white": "#f5f1e7",
    "purple": "#7d45ff",
    "violet": "#bd65ff",
    "acid": "#caff20",
    "green": "#85d900",
    "green_dark": "#326b21",
    "cyan": "#00d9e8",
    "cyan_dark": "#116f83",
    "red": "#f13754",
    "yellow": "#e9a916",
    "sand": "#8c5d27",
    "concrete": "#5c6269",
    "glass": "#74c7df",
    "pink": "#ef688e",
}


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Materials must be cleared too: every diorama deliberately reuses semantic
    # names such as "Platform" with a different palette. Keeping the previous
    # scene's material datablocks made every later set look pale and unfinished.
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def material(
    name: str,
    color: str,
    *,
    roughness: float = 0.62,
    metallic: float = 0.0,
    emission: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgb(color)[:-1] + (alpha,)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgb(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = rgb(color)
        bsdf.inputs["Emission Strength"].default_value = emission
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "DITHERED"
    return mat


def parent_to(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent:
        obj.parent = parent
    return obj


def assign(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.append(mat)
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = False
    return obj


def apply_modifiers(obj: bpy.types.Object, bevel: float = 0.0) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Tiny low-poly bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        mod.affect = "EDGES"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def empty(name: str, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    return parent_to(obj, parent)


def box(
    name: str,
    loc: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rot: tuple[float, float, float] = (0, 0, 0),
    bevel: float = 0.04,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, mat)
    apply_modifiers(obj, bevel)
    return parent_to(obj, parent)


def ico(
    name: str,
    loc: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    subdivisions: int = 1,
    rot: tuple[float, float, float] = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, mat)
    apply_modifiers(obj)
    return parent_to(obj, parent)


def cylinder(
    name: str,
    loc: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 10,
    rot: tuple[float, float, float] = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return parent_to(obj, parent)


def cone(
    name: str,
    loc: tuple[float, float, float],
    radius1: float,
    radius2: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 8,
    rot: tuple[float, float, float] = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return parent_to(obj, parent)


def torus(
    name: str,
    loc: tuple[float, float, float],
    major: float,
    minor: float,
    mat: bpy.types.Material,
    *,
    rot: tuple[float, float, float] = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=20,
        minor_segments=6,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return parent_to(obj, parent)


def segment(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    *,
    end_radius: float | None = None,
    vertices: int = 8,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    obj = cone(
        name,
        tuple(midpoint),
        radius,
        radius if end_radius is None else end_radius,
        direction.length,
        mat,
        vertices=vertices,
        parent=parent,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def eye(name: str, loc: tuple[float, float, float], scale: float, parent: bpy.types.Object) -> None:
    white = material("Eye white", PALETTE["white"], roughness=0.35)
    pupil = material("Pupil", PALETTE["ink"], roughness=0.3)
    ico(name, loc, (0.18 * scale, 0.11 * scale, 0.2 * scale), white, subdivisions=2, parent=parent)
    ico(name + "_Pupil", (loc[0], loc[1] - 0.105 * scale, loc[2]), (0.065 * scale,) * 3, pupil, subdivisions=2, parent=parent)


def tooth_row(prefix: str, xs: list[float], y: float, z: float, parent: bpy.types.Object) -> None:
    white = material("Teeth", "#fff7d6", roughness=0.42)
    for index, x in enumerate(xs):
        cone(
            f"{prefix}_{index:02d}",
            (x, y, z),
            0.055,
            0.0,
            0.2,
            white,
            vertices=6,
            rot=(0, 0, math.pi),
            parent=parent,
        )


def base_platform(root: bpy.types.Object, color: str, accent: str, *, shape: str = "square") -> None:
    base = material("Platform", color, roughness=0.72)
    trim = material("Platform trim", accent, roughness=0.45, emission=0.14)
    if shape == "round":
        cylinder("Stage_Platform", (0, 0, 0.0), 4.25, 0.3, base, vertices=12, parent=root)
        cylinder("Stage_Trim", (0, 0, 0.17), 4.15, 0.06, trim, vertices=12, parent=root)
    else:
        box("Stage_Platform", (0, 0, 0), (4.25, 3.05, 0.16), base, bevel=0.16, parent=root)
        box("Stage_Trim", (0, -3.02, 0.08), (4.12, 0.08, 0.14), trim, bevel=0.03, parent=root)


def hierarchy_meshes(objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    return [
        obj
        for obj in objects
        if obj.type == "MESH"
        and not obj.name.startswith("Icosphere")
        and not obj.hide_render
    ]


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in hierarchy_meshes(objects)
        for corner in obj.bound_box
    ]
    if not points:
        return Vector((0, 0, 0)), Vector((1, 1, 1))
    low = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    high = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return low, high


def import_glb_group(
    path: Path,
    name: str,
    parent: bpy.types.Object,
    *,
    target_size: float,
    location: tuple[float, float, float],
    fit: str = "height",
    rotation: tuple[float, float, float] = (0, 0, 0),
    center_location: bool = False,
) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    wrapper = empty(name, parent)
    top_level = [obj for obj in imported if obj.parent not in imported]
    for obj in top_level:
        obj.parent = wrapper
    wrapper.rotation_euler = rotation
    bpy.context.view_layer.update()

    low, high = world_bounds(imported)
    size = high - low
    metric = size.z if fit == "height" else max(size.x, size.y, size.z)
    uniform_scale = target_size / max(metric, 0.001)
    wrapper.scale = (uniform_scale, uniform_scale, uniform_scale)
    bpy.context.view_layer.update()

    low, high = world_bounds(imported)
    center = (low + high) * 0.5
    target = Vector(location)
    anchor = center if center_location else Vector((center.x, center.y, low.z))
    world_matrix = wrapper.matrix_world.copy()
    world_matrix.translation += target - anchor
    wrapper.matrix_world = world_matrix
    bpy.context.view_layer.update()

    for obj in hierarchy_meshes(imported):
        for polygon in obj.data.polygons:
            polygon.use_smooth = False
    return wrapper, imported


def imported_armature(objects: list[bpy.types.Object]) -> bpy.types.Object | None:
    return next((obj for obj in objects if obj.type == "ARMATURE"), None)


def set_action_pose(objects: list[bpy.types.Object], action_suffix: str, frame: float) -> None:
    rig = imported_armature(objects)
    action = next((candidate for candidate in bpy.data.actions if candidate.name.endswith(action_suffix)), None)
    if not rig or not action:
        return
    rig.animation_data_create()
    rig.animation_data.action = action
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def recolor_imported_meshes(objects: list[bpy.types.Object], mat: bpy.types.Material) -> None:
    for obj in hierarchy_meshes(objects):
        if not obj.material_slots:
            obj.data.materials.append(mat)
            continue
        for slot in obj.material_slots:
            slot.material = mat


def parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object) -> None:
    world_matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world_matrix


def baked_static_meshes(
    objects: list[bpy.types.Object],
    parent: bpy.types.Object,
    *,
    target_size: float,
    location: tuple[float, float, float],
    fit: str,
    center_location: bool = False,
) -> list[bpy.types.Object]:
    """Freeze an evaluated pose so the GLB cannot fall back to a T-pose."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = hierarchy_meshes(objects)
    baked: list[bpy.types.Object] = []
    for mesh_obj in meshes:
        relative_matrix = parent.matrix_world.inverted() @ mesh_obj.matrix_world
        evaluated = mesh_obj.evaluated_get(depsgraph)
        baked_data = bpy.data.meshes.new_from_object(
            evaluated,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        baked_data.transform(relative_matrix)
        old_data = mesh_obj.data
        mesh_obj.data = baked_data
        mesh_obj.modifiers.clear()
        mesh_obj.parent = parent
        mesh_obj.matrix_parent_inverse.identity()
        mesh_obj.matrix_basis.identity()
        for polygon in mesh_obj.data.polygons:
            polygon.use_smooth = True
        if old_data.users == 0:
            bpy.data.meshes.remove(old_data)
        baked.append(mesh_obj)
    for obj in list(objects):
        if obj not in baked and obj.name in bpy.context.scene.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    low, high = world_bounds(baked)
    size = high - low
    metric = size.z if fit == "height" else max(size.x, size.y, size.z)
    correction = target_size / max(metric, 0.001)
    parent.scale = tuple(axis * correction for axis in parent.scale)
    bpy.context.view_layer.update()
    low, high = world_bounds(baked)
    center = (low + high) * 0.5
    anchor = center if center_location else Vector((center.x, center.y, low.z))
    world_matrix = parent.matrix_world.copy()
    world_matrix.translation += Vector(location) - anchor
    parent.matrix_world = world_matrix
    bpy.context.view_layer.update()
    return baked


def build_hardest() -> bpy.types.Object:
    """A needlessly serious lab for the world's least cooperative dessert."""
    root = empty("HardestScene")
    base_platform(root, "#11151b", PALETTE["cyan"])

    steel = material("Lab steel", "#52616c", roughness=0.28, metallic=0.72)
    dark = material("Lab black", "#090d12", roughness=0.48, metallic=0.35)
    cyan = material("Vibranium glow", "#00d9ff", roughness=0.24, metallic=0.58, emission=0.85)
    blue = material("Ice cream tub blue", "#45aee8", roughness=0.48)
    white = material("Tub white", "#f5f1e7", roughness=0.58)
    chocolate = material("Refrozen chocolate", "#4c261b", roughness=0.9)
    chocolate_light = material("Chocolate frost", "#80513b", roughness=0.94)
    diamond = material("Diamond crystal", "#bdeeff", roughness=0.16, metallic=0.24)
    diamond_core = material("Diamond core", "#8deaff", roughness=0.14, emission=0.22)
    obsidian = material("Obsidian", "#08080c", roughness=0.15, metallic=0.34)
    obsidian_edge = material("Obsidian edges", "#342044", roughness=0.28, metallic=0.26)
    red = material("Warning red", "#ff2f3e", roughness=0.34, emission=0.75)
    amber = material("Warning amber", "#ffb400", roughness=0.35, emission=0.65)
    silver = material("Spoon metal", "#d9e2e6", roughness=0.18, metallic=0.92)
    paper = material("Lab labels", "#eae4d8", roughness=0.76)

    # Four deliberately overbuilt display bays make the hierarchy immediately read.
    stations = [(-2.15, 1.15), (2.15, 1.15), (-2.15, -1.35), (2.15, -1.35)]
    station_names = ("Diamond", "Obsidian", "Vibranium", "RefrozenDessert")
    for index, ((x, y), station_name) in enumerate(zip(stations, station_names)):
        box(f"{station_name}Bay", (x, y, 0.34), (1.65, 1.02, 0.16), dark, bevel=0.13, parent=root)
        box(f"{station_name}BayTrim", (x, y - 1.0, 0.38), (1.52, 0.055, 0.12), cyan if index == 2 else red if index == 3 else steel, bevel=0.025, parent=root)
        cylinder(f"{station_name}Pedestal", (x, y, 0.72), 0.78, 0.58, steel, vertices=12, parent=root)
        cylinder(f"{station_name}PedestalTop", (x, y, 1.03), 0.7, 0.08, paper, vertices=12, parent=root)

    # Diamond: a custom-cut gem instead of an off-the-shelf primitive.
    diamond_rig = empty("DiamondRig", root)
    vertices = []
    faces = []
    rings = [(0.0, 1.64, 0.28), (0.0, 1.38, 0.72), (0.0, 1.08, 0.88), (0.0, 0.54, 0.0)]
    for _, z, radius in rings[:3]:
        for index in range(10):
            angle = math.tau * index / 10 + (math.pi / 10 if z > 1.5 else 0)
            vertices.append((math.cos(angle) * radius, math.sin(angle) * radius, z))
    vertices.append((0, 0, rings[3][1]))
    tip_index = len(vertices) - 1
    for ring in range(2):
        for index in range(10):
            nxt = (index + 1) % 10
            faces.append((ring * 10 + index, ring * 10 + nxt, (ring + 1) * 10 + nxt, (ring + 1) * 10 + index))
    for index in range(10):
        faces.append((20 + index, 20 + (index + 1) % 10, tip_index))
    faces.append(tuple(reversed(range(10))))
    mesh = bpy.data.meshes.new("DiamondCutMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    gem = bpy.data.objects.new("DiamondCut", mesh)
    bpy.context.collection.objects.link(gem)
    # Lift the pavilion clear of the pedestal so it reads as a full diamond,
    # not a suspiciously expensive serving cloche.
    gem.location = (-2.15, 1.15, 0.62)
    gem.data.materials.append(diamond)
    gem.parent = diamond_rig
    cone("DiamondPavilion", (-2.15, 1.15, 1.41), 0.0, 0.88, 0.58, diamond, vertices=10, parent=diamond_rig)
    ico("DiamondInnerGlow", (-2.15, 1.15, 1.86), (0.42, 0.42, 0.5), diamond_core, subdivisions=2, parent=diamond_rig)

    # Obsidian: asymmetric fractured rock with a violet glassy edge.
    obsidian_rig = empty("ObsidianRig", root)
    rock = ico("ObsidianRock", (2.15, 1.15, 1.5), (0.88, 0.7, 0.72), obsidian, subdivisions=2, rot=(0.2, -0.38, 0.18), parent=obsidian_rig)
    for vertex in rock.data.vertices:
        factor = 0.72 + ((vertex.index * 37) % 29) / 70
        vertex.co.x *= factor
        vertex.co.y *= 0.82 + ((vertex.index * 19) % 17) / 80
    for index, offset in enumerate(((-0.66, -0.05), (0.62, 0.2), (0.34, -0.52))):
        ico(f"ObsidianShard_{index}", (2.15 + offset[0], 1.15 + offset[1], 1.1), (0.22, 0.16, 0.28), obsidian_edge, subdivisions=1, rot=(index * 0.4, index * 0.2, index), parent=obsidian_rig)

    # Vibranium: recognizable glowing ingot/canister with containment rings.
    vibranium_rig = empty("VibraniumRig", root)
    box("VibraniumIngot", (-2.15, -1.35, 1.46), (0.34, 0.58, 0.84), steel, rot=(0.05, -0.18, 0.12), bevel=0.11, parent=vibranium_rig)
    for index in range(4):
        box(f"VibraniumCore_{index}", (-2.15, -1.95, 1.15 + index * 0.23), (0.23, 0.035, 0.065), cyan, rot=(0.05, -0.18, 0.12), bevel=0.025, parent=vibranium_rig)
    for index, z in enumerate((1.05, 1.48, 1.9)):
        torus(f"VibraniumRing_{index}", (-2.15, -1.35, z), 0.67 + index * 0.04, 0.035, cyan, rot=(math.pi / 2, 0, 0), parent=vibranium_rig)

    # The real final boss: a frozen-solid tub surrounded by increasingly bad ideas.
    ice_rig = empty("IceCreamRig", root)
    cone("IceCreamTub", (2.15, -1.35, 1.55), 0.72, 0.88, 1.08, blue, vertices=24, parent=ice_rig)
    torus("IceCreamTubRim", (2.15, -1.35, 2.1), 0.83, 0.075, white, parent=ice_rig)
    torus("IceCreamTubFoot", (2.15, -1.35, 1.01), 0.7, 0.055, white, parent=ice_rig)
    box("IceCreamLabel", (2.15, -2.075, 1.58), (0.55, 0.025, 0.26), white, bevel=0.04, parent=ice_rig)
    box("IceCreamLabelBand", (2.15, -2.11, 1.58), (0.41, 0.018, 0.11), chocolate, bevel=0.025, parent=ice_rig)
    bpy.ops.object.text_add(location=(2.15, -2.145, 1.55), rotation=(math.pi / 2, 0, 0))
    tub_text = bpy.context.object
    tub_text.name = "IceCreamBrand_BandJ"
    tub_text.data.body = "B&J"
    tub_text.data.align_x = "CENTER"
    tub_text.data.align_y = "CENTER"
    tub_text.data.size = 0.23
    tub_text.data.extrude = 0.012
    tub_text.data.bevel_depth = 0.006
    tub_text.data.materials.append(white)
    bpy.ops.object.convert(target="MESH")
    tub_text.parent = ice_rig
    for index, loc in enumerate(((1.72, -1.34, 2.1), (2.18, -1.3, 2.22), (2.59, -1.37, 2.08), (2.08, -1.65, 2.16))):
        ico(f"IceCreamScoop_{index}", loc, (0.52, 0.46, 0.38), chocolate if index % 2 else chocolate_light, subdivisions=2, parent=ice_rig)
    for index in range(7):
        shard_angle = math.tau * index / 7
        cone(f"FrostSpike_{index}", (2.15 + math.cos(shard_angle) * 0.72, -1.35 + math.sin(shard_angle) * 0.55, 2.32), 0.08, 0, 0.35 + (index % 3) * 0.08, diamond_core, vertices=5, rot=(0.25 * math.sin(shard_angle), 0.25 * math.cos(shard_angle), shard_angle), parent=ice_rig)

    spoon = empty("AttemptSpoon", root)
    spoon.parent = root
    spoon_points = [(1.22, -2.24, 2.74), (1.55, -2.04, 2.48), (1.88, -1.86, 2.28), (2.12, -1.69, 2.17)]
    for index in range(3):
        segment(f"SpoonHandle_{index}", spoon_points[index], spoon_points[index + 1], 0.055, silver, end_radius=0.047, vertices=10, parent=spoon)
    ico("SpoonBowl", spoon_points[-1], (0.18, 0.08, 0.27), silver, subdivisions=2, rot=(0.35, 0.1, -0.75), parent=spoon)

    # A tiny jackhammer is objectively the correct utensil.
    hammer = empty("JackhammerRig", root)
    box("JackhammerBody", (3.08, -1.62, 2.5), (0.29, 0.22, 0.52), amber, rot=(0.03, -0.38, 0.0), bevel=0.08, parent=hammer)
    box("JackhammerStripe", (3.0, -1.845, 2.52), (0.18, 0.025, 0.1), dark, rot=(0.03, 0, -0.36), bevel=0.02, parent=hammer)
    segment("JackhammerBit", (2.92, -1.55, 2.14), (2.48, -1.43, 1.98), 0.055, silver, end_radius=0.018, parent=hammer)
    for side in (-1, 1):
        segment(f"JackhammerHandle_{side}", (3.08, -1.62, 2.72), (3.34, -1.62 + side * 0.26, 2.88), 0.055, dark, parent=hammer)

    for index, x in enumerate((1.15, 3.25)):
        warning = empty(f"WarningLight_{index}", root)
        cylinder(f"WarningBase_{index}", (x, -2.18, 0.86), 0.22, 0.1, dark, vertices=12, parent=warning)
        cone(f"WarningBeacon_{index}", (x, -2.18, 1.05), 0.17, 0.11, 0.32, amber if index == 0 else red, vertices=12, parent=warning)
    for index in range(3):
        # Casualties from previous attempts.
        bend = -0.32 + index * 0.22
        segment(f"FallenSpoon_{index}_A", (0.85 + index * 0.22, -1.0, 0.45), (1.05 + index * 0.24, -0.82 + bend, 0.52), 0.035, silver, end_radius=0.025, parent=root)
        segment(f"FallenSpoon_{index}_B", (1.05 + index * 0.24, -0.82 + bend, 0.52), (1.18 + index * 0.27, -0.62 + bend, 0.43), 0.03, silver, end_radius=0.02, parent=root)
    return root


def build_nod() -> bpy.types.Object:
    """A polished low-poly bust that performs the four universal man nods."""
    root = empty("NodScene")
    base_platform(root, "#12151c", PALETTE["cyan"], shape="round")

    skin = material("Nod skin", "#d99567", roughness=0.64)
    skin_light = material("Nod skin highlight", "#efb083", roughness=0.58)
    shirt = material("Nod black shirt", "#101318", roughness=0.72)
    beard = material("Nod beard", "#26110d", roughness=0.84)
    beard_light = material("Nod beard highlight", "#512a1e", roughness=0.8)
    hair = material("Nod hair", "#2a1715", roughness=0.76)
    white = material("Nod eye white", "#f7f1e6", roughness=0.35)
    iris = material("Nod blue iris", "#5cc8ee", roughness=0.2, emission=0.12)
    pupil = material("Nod pupil", "#080a0c", roughness=0.25)
    cyan = material("Nod up cyan", "#28e4f4", roughness=0.3, emission=0.65)
    orange = material("Nod right orange", "#ff733f", roughness=0.34, emission=0.48)
    violet = material("Nod left violet", "#9b64ff", roughness=0.32, emission=0.5)
    acid = material("Nod down acid", "#caff20", roughness=0.32, emission=0.6)
    halo = material("Nod radar", "#1f7784", roughness=0.42, emission=0.2)

    # Bust and shoulders are intentionally broad so the character reads as a
    # proper adult man rather than a floating emoji head.
    cone("NodTorso", (0, 0.26, 1.08), 1.6, 1.03, 1.72, shirt, vertices=14, parent=root)
    ico("NodShoulders", (0, 0.18, 1.42), (1.7, 0.62, 0.58), shirt, subdivisions=2, parent=root)
    cylinder("NodNeck", (0, -0.01, 2.03), 0.39, 0.64, skin, vertices=12, parent=root)

    # Everything facial is local to this pivot, which gives the browser a real
    # head to yaw, pitch, and nod without deforming the torso.
    head = empty("NodHead", root)
    head.location = (0, -0.08, 2.77)
    ico("NodSkull", (0, 0, 0.08), (0.88, 0.68, 1.03), skin, subdivisions=2, parent=head)
    ico("NodCheek_L", (-0.46, -0.5, -0.05), (0.36, 0.18, 0.43), skin_light, subdivisions=2, parent=head)
    ico("NodCheek_R", (0.46, -0.5, -0.05), (0.36, 0.18, 0.43), skin_light, subdivisions=2, parent=head)
    for side in (-1, 1):
        ico(f"NodEar_{side}", (0.82 * side, -0.01, 0.08), (0.18, 0.12, 0.29), skin, subdivisions=2, parent=head)
        ico(f"NodEye_{side}", (0.31 * side, -0.65, 0.27), (0.19, 0.1, 0.15), white, subdivisions=2, parent=head)
        ico(f"NodIris_{side}", (0.31 * side, -0.74, 0.27), (0.087, 0.035, 0.087), iris, subdivisions=2, parent=head)
        ico(f"NodPupil_{side}", (0.31 * side, -0.776, 0.27), (0.037, 0.02, 0.047), pupil, subdivisions=2, parent=head)
        segment(
            f"NodBrow_{side}",
            (0.12 * side, -0.72, 0.52),
            (0.51 * side, -0.64, 0.56),
            0.055,
            hair,
            end_radius=0.075,
            vertices=7,
            parent=head,
        )
    cone("NodNose", (0, -0.78, 0.03), 0.16, 0.055, 0.42, skin_light, vertices=7, rot=(math.pi / 2, 0, 0), parent=head)
    box("NodMouth", (0, -0.78, -0.31), (0.2, 0.035, 0.035), pupil, bevel=0.025, parent=head)

    beard_rig = empty("NodBeard", head)
    ico("NodBeardMass", (0, -0.66, -0.4), (0.69, 0.22, 0.74), beard, subdivisions=2, parent=beard_rig)
    ico("NodBeardChin", (0, -0.64, -0.86), (0.45, 0.2, 0.5), beard_light, subdivisions=2, parent=beard_rig)
    for side in (-1, 1):
        segment(f"NodMoustache_{side}", (0.02 * side, -0.81, -0.21), (0.34 * side, -0.68, -0.28), 0.08, beard_light, end_radius=0.045, vertices=8, parent=beard_rig)
        for index in range(4):
            cone(
                f"NodBeardPoint_{side}_{index}",
                (side * (0.12 + index * 0.11), -0.52, -0.78 + abs(index - 1.5) * 0.05),
                0.11,
                0,
                0.34,
                beard if index % 2 else beard_light,
                vertices=6,
                rot=(0.12 * side, 0.08 * side, math.pi),
                parent=beard_rig,
            )

    ico("NodHairCap", (0, 0.02, 0.86), (0.78, 0.62, 0.38), hair, subdivisions=2, parent=head)
    for index in range(9):
        x = -0.6 + index * 0.15
        cone(
            f"NodHairQuiff_{index}",
            (x, -0.35 + abs(x) * 0.12, 1.12 - abs(x) * 0.18),
            0.17,
            0,
            0.48 - abs(x) * 0.18,
            hair if index % 2 else beard_light,
            vertices=6,
            rot=(0.08, x * 0.2, -x * 0.3),
            parent=head,
        )

    # Radar rings and four physical arrows turn the reference diagram into a
    # real stage while keeping the character silhouette clean.
    for index, radius in enumerate((1.35, 1.7, 2.08)):
        torus(f"NodRadar_{index}", (0, 0.48, 2.77), radius, 0.025, halo, rot=(math.pi / 2, 0, 0), parent=root)

    def make_arrow(direction: str, location: tuple[float, float, float], arrow_mat: bpy.types.Material) -> None:
        arrow = empty(f"NodArrow_{direction}", root)
        arrow.location = location
        if direction in ("up", "down"):
            box(f"NodArrow_{direction}_Shaft", (0, 0, 0), (0.16, 0.11, 0.38), arrow_mat, bevel=0.05, parent=arrow)
            z_sign = 1 if direction == "up" else -1
            cone(
                f"NodArrow_{direction}_Head",
                (0, 0, 0.55 * z_sign),
                0.38,
                0,
                0.48,
                arrow_mat,
                vertices=6,
                rot=(0, 0, 0 if direction == "up" else math.pi),
                parent=arrow,
            )
        else:
            x_sign = -1 if direction == "right" else 1
            box(f"NodArrow_{direction}_Shaft", (0, 0, 0), (0.38, 0.11, 0.16), arrow_mat, bevel=0.05, parent=arrow)
            cone(
                f"NodArrow_{direction}_Head",
                (0.55 * x_sign, 0, 0),
                0.38,
                0,
                0.48,
                arrow_mat,
                vertices=6,
                rot=(0, -math.pi / 2 if direction == "right" else math.pi / 2, 0),
                parent=arrow,
            )

    make_arrow("up", (0, -0.24, 4.52), cyan)
    make_arrow("right", (-2.38, -0.2, 2.78), orange)
    make_arrow("left", (2.38, -0.2, 2.78), violet)
    make_arrow("down", (0, -1.38, 0.94), acid)
    return root


def make_cat(root: bpy.types.Object) -> bpy.types.Object:
    cat = empty("DJCat", root)
    fur = material("Cat fur", "#24232a", roughness=0.76)
    fur_light = material("Cat white fur", "#e6d8c6", roughness=0.72)
    pink = material("Cat ears", "#db7f8a", roughness=0.66)
    black = material("Glasses", "#07070a", roughness=0.25, metallic=0.12)
    pixel = material("Glasses shine", PALETTE["white"], roughness=0.25, emission=0.15)
    ico("CatBody", (0, 0.25, 1.24), (0.76, 0.58, 1.02), fur, subdivisions=2, parent=cat)
    ico("CatBib", (0, -0.45, 1.38), (0.4, 0.12, 0.7), fur_light, subdivisions=2, parent=cat)
    ico("CatHead", (0, -0.03, 2.34), (0.78, 0.6, 0.7), fur, subdivisions=2, parent=cat)
    cone("CatEar_L", (-0.44, 0.02, 2.93), 0.36, 0, 0.76, fur, vertices=5, rot=(0, -0.1, -0.18), parent=cat)
    cone("CatEar_R", (0.44, 0.02, 2.93), 0.36, 0, 0.76, fur, vertices=5, rot=(0, 0.1, 0.18), parent=cat)
    cone("CatEarInner_L", (-0.44, -0.1, 2.93), 0.2, 0, 0.46, pink, vertices=5, rot=(0, -0.1, -0.18), parent=cat)
    cone("CatEarInner_R", (0.44, -0.1, 2.93), 0.2, 0, 0.46, pink, vertices=5, rot=(0, 0.1, 0.18), parent=cat)
    ico("CatMuzzle_L", (-0.2, -0.59, 2.18), (0.3, 0.18, 0.26), fur_light, subdivisions=2, parent=cat)
    ico("CatMuzzle_R", (0.2, -0.59, 2.18), (0.3, 0.18, 0.26), fur_light, subdivisions=2, parent=cat)
    cone("CatNose", (0, -0.8, 2.28), 0.1, 0, 0.14, pink, vertices=5, rot=(math.pi / 2, 0, 0), parent=cat)
    for side in (-1, 1):
        box(f"Shade_{side}", (0.28 * side, -0.63, 2.48), (0.26, 0.06, 0.18), black, bevel=0.04, parent=cat)
        for px in range(3):
            box(f"ShadePixel_{side}_{px}", ((0.14 + px * 0.12) * side, -0.7, 2.55 - px * 0.025), (0.04, 0.018, 0.035), pixel, bevel=0.005, parent=cat)
    box("ShadeBridge", (0, -0.65, 2.49), (0.12, 0.05, 0.035), black, bevel=0.02, parent=cat)
    for side in (-1, 1):
        segment(f"CatArm_{side}", (0.45 * side, 0, 1.55), (0.95 * side, -0.58, 1.15), 0.18, fur, end_radius=0.14, parent=cat)
        ico(f"CatPaw_{side}", (0.98 * side, -0.62, 1.12), (0.24, 0.18, 0.16), fur_light, subdivisions=1, parent=cat)
    # A high, segmented tail gives the silhouette the same confident attitude
    # as the hero artwork even when the camera is orbiting.
    segment("CatTailLower", (0.55, 0.45, 1.05), (0.98, 0.55, 1.75), 0.14, fur, end_radius=0.11, parent=cat)
    segment("CatTailUpper", (0.98, 0.55, 1.75), (0.78, 0.5, 2.35), 0.11, fur, end_radius=0.07, parent=cat)
    return cat


def make_turntable(name: str, x: float, root: bpy.types.Object) -> None:
    dark = material("Deck body", "#17151c", roughness=0.38, metallic=0.12)
    vinyl = material("Vinyl", "#070708", roughness=0.22, metallic=0.2)
    purple = material("Deck purple", PALETTE["purple"], roughness=0.3, emission=0.18)
    metal = material("Deck metal", "#c9c5bd", roughness=0.26, metallic=0.65)
    box(name + "_Body", (x, -0.68, 0.88), (1.2, 0.75, 0.18), dark, bevel=0.08, parent=root)
    cylinder(name, (x, -0.72, 1.08), 0.67, 0.09, vinyl, vertices=24, parent=root)
    cylinder(name + "_Label", (x, -0.72, 1.14), 0.16, 0.04, purple, vertices=16, parent=root)
    segment(name + "_Tonearm", (x + 0.72, -0.5, 1.14), (x + 0.42, -1.02, 1.2), 0.035, metal, parent=root)


def build_scratch() -> bpy.types.Object:
    root = empty("ScratchScene")
    base_platform(root, "#21152d", PALETTE["purple"])
    brick = material("Brick", "#8d5b3a", roughness=0.86)
    mortar = material("Mortar", "#caa87a", roughness=0.9)
    wall = material("Brick backing", "#473126", roughness=0.9)
    box("BrickWall", (0, 2.48, 2.05), (4.25, 0.12, 2.0), wall, bevel=0.03, parent=root)
    for row in range(9):
        for col in range(12):
            x = -4.0 + col * 0.72 + (0.36 if row % 2 else 0)
            if x > 4.0:
                continue
            box(f"Brick_{row}_{col}", (x, 2.33, 0.56 + row * 0.38), (0.32, 0.05, 0.15), brick if (row + col) % 3 else mortar, bevel=0.025, parent=root)
    booth = material("DJ booth", "#25183d", roughness=0.42)
    glow = material("DJ glow", PALETTE["violet"], roughness=0.35, emission=0.35)
    box("DJBooth", (0, 0.18, 0.56), (3.25, 0.65, 0.5), booth, bevel=0.12, parent=root)
    box("DJBoothGlow", (0, -0.5, 0.58), (3.1, 0.035, 0.34), glow, bevel=0.03, parent=root)
    make_turntable("Platter_L", -1.2, root)
    make_turntable("Platter_R", 1.2, root)
    mixer = material("Mixer", "#15131a", roughness=0.34, metallic=0.18)
    box("MixerBody", (0, -0.72, 1.1), (0.52, 0.55, 0.13), mixer, bevel=0.06, parent=root)
    for row in range(3):
        for col in range(4):
            cylinder(
                f"MixerKnob_{row}_{col}",
                (-0.32 + col * 0.21, -1.05 + row * 0.22, 1.27),
                0.045,
                0.08,
                glow if (row + col) % 2 else mixer,
                vertices=10,
                parent=root,
            )
    speaker_body = material("Speaker body", "#111116", roughness=0.34)
    speaker_cone = material("Speaker cone", "#28232f", roughness=0.38)
    for side in (-1, 1):
        box(f"Speaker_{side}", (3.25 * side, 1.05, 1.25), (0.62, 0.42, 1.25), speaker_body, bevel=0.1, parent=root)
        for z in (0.6, 1.6):
            cylinder(f"SpeakerCone_{side}_{z}", (3.25 * side, 0.59, z), 0.36, 0.1, speaker_cone, vertices=14, rot=(math.pi / 2, 0, 0), parent=root)
            cylinder(f"SpeakerGlow_{side}_{z}", (3.25 * side, 0.52, z), 0.13, 0.06, glow, vertices=12, rot=(math.pi / 2, 0, 0), parent=root)
    make_cat(root)
    for index in range(15):
        height = 0.22 + (index % 5) * 0.1
        box(f"EQ_{index:02d}", (-2.75 + index * 0.39, 2.12, 3.37), (0.12, 0.05, height), glow, bevel=0.02, parent=root)
    return root


def make_gorilla(root: bpy.types.Object) -> bpy.types.Object:
    gorilla, imported = import_glb_group(
        LICENSED_MODEL_DIR / "gorilla.glb",
        "Gorilla",
        root,
        target_size=3.15,
        location=(-1.55, 0.22, 0.24),
        fit="height",
        rotation=(0, 0, 0.48),
    )
    for mesh_obj in hierarchy_meshes(imported):
        for slot in mesh_obj.material_slots:
            if not slot.material:
                continue
            bsdf = slot.material.node_tree.nodes.get("Principled BSDF") if slot.material.use_nodes else None
            if bsdf and "black" in slot.material.name.lower():
                bsdf.inputs["Base Color"].default_value = rgb("#171817")
                bsdf.inputs["Roughness"].default_value = 0.72
    return gorilla


def make_trex(root: bpy.types.Object) -> bpy.types.Object:
    trex, imported = import_glb_group(
        LICENSED_MODEL_DIR / "trex.glb",
        "Trex",
        root,
        target_size=4.3,
        location=(1.65, 0.2, 0.24),
        fit="span",
        rotation=(0, 0, -math.pi / 2),
    )
    set_action_pose(imported, "TRex_Idle", 24)

    trex_palette = {
        "Green": "#4f9f14",
        "LightGreen": "#8ed51d",
        "LightYellow": "#efe0a1",
    }
    for mesh_obj in hierarchy_meshes(imported):
        for slot in mesh_obj.material_slots:
            if not slot.material or slot.material.name not in trex_palette:
                continue
            slot.material.diffuse_color = rgb(trex_palette[slot.material.name])
            bsdf = slot.material.node_tree.nodes.get("Principled BSDF") if slot.material.use_nodes else None
            if bsdf:
                bsdf.inputs["Base Color"].default_value = rgb(trex_palette[slot.material.name])
                bsdf.inputs["Roughness"].default_value = 0.58

    rig = imported_armature(imported)
    head = rig.pose.bones.get("Head") if rig else None
    if rig and head:
        stare_at = rig.matrix_world @ head.tail
    else:
        stare_at = Vector((0.25, -0.1, 2.15))
    white = material("Trex awkward eye whites", "#fff9e9", roughness=0.28)
    pupil = material("Trex awkward pupils", "#111016", roughness=0.25)
    eye_positions = [
        stare_at + Vector((-0.08, -0.28, 0.16)),
        stare_at + Vector((0.13, -0.25, 0.04)),
    ]
    for index, position in enumerate(eye_positions):
        eyeball = ico(f"TrexStareEye_{index}", tuple(position), (0.15, 0.09, 0.17), white, subdivisions=2)
        pupil_obj = ico(
            f"TrexStarePupil_{index}",
            tuple(position + Vector((-0.055, -0.085, -0.012))),
            (0.045, 0.025, 0.06),
            pupil,
            subdivisions=2,
        )
        parent_keep_world(eyeball, trex)
        parent_keep_world(pupil_obj, trex)
    return trex


def build_reactor() -> bpy.types.Object:
    root = empty("ReactorScene")
    base_platform(root, "#151b13", "#74b72d", shape="round")
    rock = material("Habitat rock", "#5a574d", roughness=0.9)
    grass = material("Habitat grass", "#3c6c2e", roughness=0.86)
    bark = material("Palm bark", "#6d4828", roughness=0.9)
    leaf = material("Palm leaves", "#376f2f", roughness=0.82)
    for index in range(24):
        angle = index * 2.4
        radius = 2.0 + (index % 5) * 0.38
        loc = (math.cos(angle) * radius, math.sin(angle) * radius * 0.68, 0.25 + (index % 3) * 0.08)
        ico(f"Rock_{index:02d}", loc, (0.32 + (index % 4) * 0.09, 0.28, 0.24 + (index % 3) * 0.08), rock if index % 3 else grass, subdivisions=1, rot=(index * 0.2, index * 0.1, index * 0.3), parent=root)
    for palm_x in (-3.2, 3.15):
        segment(f"PalmTrunk_{palm_x}", (palm_x, 1.45, 0.28), (palm_x * 0.92, 1.45, 2.75), 0.15, bark, end_radius=0.09, parent=root)
        for index in range(7):
            angle = index / 7 * math.tau
            start = (palm_x * 0.92, 1.45, 2.68)
            end = (start[0] + math.cos(angle) * 1.15, start[1] + math.sin(angle) * 0.8, 2.48 + math.sin(index) * 0.18)
            segment(f"PalmLeaf_{palm_x}_{index}", start, end, 0.11, leaf, end_radius=0.025, vertices=6, parent=root)
    make_gorilla(root)
    make_trex(root)
    return root


def make_morty(root: bpy.types.Object) -> bpy.types.Object:
    boy = empty("Morty", root)
    skin = material("Morty skin", PALETTE["skin_light"], roughness=0.56)
    shirt = material("Morty yellow", "#efcf32", roughness=0.62)
    pants = material("Morty pants", "#426ab5", roughness=0.66)
    backpack = material("Morty backpack", "#b92d3e", roughness=0.66)
    hair = material("Morty hair", "#6b3a21", roughness=0.74)
    mouth = material("Morty mouth", "#471820", roughness=0.45)
    shoe = material("Morty shoes", "#e9e8df", roughness=0.68)
    cone("MortyTorso", (-1.08, 0, 1.28), 0.5, 0.42, 1.12, shirt, vertices=10, parent=boy)
    box("MortyPants", (-1.08, 0, 0.66), (0.48, 0.33, 0.24), pants, bevel=0.1, parent=boy)
    box("MortyBackpack", (-1.08, 0.34, 1.32), (0.43, 0.2, 0.52), backpack, bevel=0.14, parent=boy)
    ico("MortyHairCap", (-1.08, 0.08, 2.43), (0.67, 0.48, 0.66), hair, subdivisions=2, parent=boy)
    ico("MortyHead", (-1.08, -0.09, 2.29), (0.61, 0.5, 0.65), skin, subdivisions=2, parent=boy)
    for index in range(7):
        x = -1.47 + index * 0.13
        cone(f"MortyHairline_{index}", (x, -0.48, 2.69 + math.sin(index) * 0.045), 0.1, 0, 0.24, hair, vertices=6, rot=(0, 0, math.pi), parent=boy)
    eye("MortyEye_L", (-1.3, -0.52, 2.37), 1.08, boy)
    eye("MortyEye_R", (-0.87, -0.52, 2.37), 1.08, boy)
    ico("MortyNose", (-1.08, -0.63, 2.22), (0.09, 0.07, 0.11), skin, subdivisions=1, parent=boy)
    box("MortyMouth", (-1.08, -0.59, 1.99), (0.22, 0.035, 0.12), mouth, bevel=0.07, parent=boy)
    box("MortyTeeth", (-1.08, -0.63, 2.04), (0.15, 0.022, 0.03), material("Morty teeth", PALETTE["white"]), bevel=0.01, parent=boy)
    for side in (-1, 1):
        x = -1.08 + side * 0.34
        segment(f"MortyLeg_{side}", (x, 0, 0.58), (x + side * 0.04, -0.02, 0.16), 0.15, pants, end_radius=0.12, parent=boy)
        box(f"MortyShoe_{side}", (x + side * 0.05, -0.12, 0.08), (0.2, 0.3, 0.09), shoe, bevel=0.06, parent=boy)
    arm = empty("MortyPointArm", boy)
    arm.location = (-1.43, -0.03, 1.58)
    segment("MortyPointSleeve", (0, 0, 0), (-0.2, -0.12, 0.04), 0.18, shirt, end_radius=0.15, parent=arm)
    segment("MortyPointUpper", (-0.2, -0.12, 0.04), (-0.58, -0.3, 0.12), 0.13, skin, end_radius=0.1, parent=arm)
    ico("MortyPointHand", (-0.62, -0.31, 0.13), (0.17, 0.12, 0.14), skin, subdivisions=1, parent=arm)
    segment("MortyPointFinger", (-0.68, -0.34, 0.17), (-1.06, -0.38, 0.2), 0.055, skin, end_radius=0.035, parent=arm)
    segment("MortyOtherSleeve", (-0.71, -0.02, 1.58), (-0.54, -0.15, 1.55), 0.18, shirt, end_radius=0.14, parent=boy)
    segment("MortyOtherArm", (-0.54, -0.15, 1.55), (-0.48, -0.34, 1.13), 0.13, skin, end_radius=0.1, parent=boy)
    ico("MortyOtherHand", (-0.48, -0.35, 1.08), (0.16, 0.12, 0.16), skin, subdivisions=1, parent=boy)
    return boy


def make_rick(root: bpy.types.Object) -> bpy.types.Object:
    rick = empty("Rick", root)
    skin = material("Rick skin", "#dfaa78", roughness=0.55)
    coat = material("Rick coat", PALETTE["white"], roughness=0.64)
    shirt = material("Rick shirt", "#8ad9d7", roughness=0.58)
    pants = material("Rick pants", "#4a3a2c", roughness=0.68)
    hair = material("Rick hair", "#87bfd3", roughness=0.58, emission=0.08)
    mouth = material("Rick mouth", "#541823", roughness=0.44)
    belt = material("Rick belt", "#171515", roughness=0.5)
    cone("RickTorso", (1.15, 0.08, 1.5), 0.68, 0.5, 1.52, coat, vertices=10, parent=rick)
    box("RickShirt", (1.15, -0.43, 1.5), (0.3, 0.05, 0.62), shirt, bevel=0.05, parent=rick)
    box("RickLapel_L", (0.88, -0.47, 1.75), (0.18, 0.035, 0.5), coat, rot=(0, 0, -0.25), bevel=0.03, parent=rick)
    box("RickLapel_R", (1.42, -0.47, 1.75), (0.18, 0.035, 0.5), coat, rot=(0, 0, 0.25), bevel=0.03, parent=rick)
    box("RickBelt", (1.15, -0.39, 0.86), (0.48, 0.06, 0.08), belt, bevel=0.02, parent=rick)
    box("RickCoatTail_L", (0.84, 0.08, 0.76), (0.29, 0.32, 0.48), coat, rot=(0, 0.08, 0.08), bevel=0.08, parent=rick)
    box("RickCoatTail_R", (1.46, 0.08, 0.76), (0.29, 0.32, 0.48), coat, rot=(0, -0.08, -0.08), bevel=0.08, parent=rick)
    ico("RickHairScalp", (1.15, 0.04, 2.78), (0.59, 0.43, 0.62), hair, subdivisions=1, parent=rick)
    ico("RickHead", (1.15, -0.1, 2.63), (0.55, 0.46, 0.66), skin, subdivisions=2, parent=rick)
    eye("RickEye_L", (0.96, -0.5, 2.72), 0.94, rick)
    eye("RickEye_R", (1.34, -0.5, 2.72), 0.94, rick)
    box("RickBrow_L", (0.96, -0.62, 2.9), (0.18, 0.025, 0.035), hair, rot=(0, 0, -0.14), bevel=0.01, parent=rick)
    box("RickBrow_R", (1.34, -0.62, 2.9), (0.18, 0.025, 0.035), hair, rot=(0, 0, 0.14), bevel=0.01, parent=rick)
    ico("RickNose", (1.15, -0.62, 2.55), (0.1, 0.08, 0.14), skin, subdivisions=1, parent=rick)
    box("RickMouth", (1.15, -0.59, 2.3), (0.3, 0.035, 0.15), mouth, bevel=0.08, parent=rick)
    box("RickTeeth", (1.15, -0.63, 2.36), (0.22, 0.02, 0.04), material("Rick teeth", PALETTE["white"]), bevel=0.01, parent=rick)
    for index in range(12):
        angle = index / 12 * math.tau
        start = (1.15 + math.cos(angle) * 0.36, 0.06, 2.86 + math.sin(angle) * 0.38)
        end = (1.15 + math.cos(angle) * 0.82, 0.08, 2.95 + math.sin(angle) * 0.82)
        segment(f"RickHair_{index}", start, end, 0.18, hair, end_radius=0.025, vertices=7, parent=rick)
    for side in (-1, 1):
        x = 1.15 + side * 0.3
        segment(f"RickLeg_{side}", (x, 0.05, 0.79), (x + side * 0.05, -0.02, 0.11), 0.17, pants, end_radius=0.13, parent=rick)
        box(f"RickShoe_{side}", (x + side * 0.06, -0.14, 0.08), (0.21, 0.32, 0.09), belt, bevel=0.06, parent=rick)
        shoulder = (1.15 + side * 0.52, 0, 1.78)
        elbow = (1.15 + side * 0.78, -0.18, 1.64 + (0.3 if side == -1 else 0.12))
        hand = (1.15 + side * 1.05, -0.42, 1.58 + (0.52 if side == -1 else 0.16))
        segment(f"RickSleeve_{side}", shoulder, elbow, 0.2, coat, end_radius=0.15, parent=rick)
        segment(f"RickArm_{side}", elbow, hand, 0.13, skin, end_radius=0.1, parent=rick)
        ico(f"RickHand_{side}", hand, (0.16, 0.12, 0.18), skin, subdivisions=1, parent=rick)
        for finger in range(3):
            start = (hand[0] + side * 0.07, hand[1] - 0.02, hand[2] + (finger - 1) * 0.055)
            end = (start[0] + side * (0.17 + finger * 0.02), start[1] - 0.04, start[2] + (finger - 1) * 0.035)
            segment(f"RickFinger_{side}_{finger}", start, end, 0.025, skin, end_radius=0.014, vertices=7, parent=rick)
    return rick


def make_brain(root: bpy.types.Object) -> bpy.types.Object:
    brain = empty("Brain", root)
    pink = material("Brain pink", PALETTE["pink"], roughness=0.58, emission=0.22)
    for index in range(18):
        angle = index * 2.13
        x = 2.65 + math.cos(angle) * (0.45 + (index % 3) * 0.05)
        y = 0.25 + (index % 2) * 0.18
        z = 2.45 + math.sin(angle) * 0.38
        ico(f"BrainLobe_{index:02d}", (x, y, z), (0.28, 0.22, 0.25), pink, subdivisions=1, parent=brain)
    return brain


def make_pill(name: str, loc: tuple[float, float, float], rot: tuple[float, float, float], root: bpy.types.Object) -> None:
    pill = empty(name, root)
    pill.location = loc
    pill.rotation_euler = rot
    red = material("Pill red", PALETTE["red"], roughness=0.4, emission=0.08)
    white = material("Pill white", PALETTE["white"], roughness=0.42)
    ico(name + "_Red", (0, 0, 0.13), (0.13, 0.13, 0.24), red, subdivisions=2, parent=pill)
    ico(name + "_White", (0, 0, -0.13), (0.13, 0.13, 0.24), white, subdivisions=2, parent=pill)


def build_brain() -> bpy.types.Object:
    root = empty("BrainScene")
    base_platform(root, "#15262d", PALETTE["red"], shape="round")
    portal = material("Portal", PALETTE["cyan"], roughness=0.28, emission=1.8)
    portal_dark = material("Portal dark", PALETTE["cyan_dark"], roughness=0.45, emission=0.35)
    for index in range(5):
        torus(f"PortalRing_{index}", (0.4, 1.7, 2.0), 1.4 - index * 0.22, 0.09 + index * 0.01, portal if index % 2 == 0 else portal_dark, rot=(math.pi / 2, 0, index * 0.22), parent=root)
    for index in range(14):
        angle = index * 2.0
        ico(f"PortalShard_{index}", (0.4 + math.cos(angle) * 1.7, 1.45, 2 + math.sin(angle) * 1.55), (0.12, 0.09, 0.22), portal_dark, subdivisions=1, rot=(angle, 0.2, angle * 0.5), parent=root)
    make_morty(root)
    make_rick(root)
    make_brain(root)
    for index in range(12):
        make_pill(
            f"Pill_{index:02d}",
            (-2.8 + (index % 6) * 1.08, -0.65 + (index % 3) * 0.17, 3.5 + (index // 6) * 0.55 + math.sin(index) * 0.2),
            (index * 0.37, index * 0.23, index * 0.55),
            root,
        )
    return root


def make_excavator(root: bpy.types.Object) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    rig = empty("Excavator", root)
    yellow = material("Excavator yellow", PALETTE["yellow"], roughness=0.48, metallic=0.08)
    dark = material("Excavator tracks", "#242325", roughness=0.52, metallic=0.12)
    wheel = material("Excavator wheels", "#4a4540", roughness=0.45, metallic=0.18)
    glass = material("Excavator glass", PALETTE["glass"], roughness=0.22, metallic=0.12, alpha=0.72)
    for side in (-1, 1):
        y = side * 0.68
        box(f"Track_{side}", (-1.7, y, 0.47), (1.3, 0.3, 0.34), dark, bevel=0.16, parent=rig)
        for index in range(6):
            cylinder(f"TrackWheel_{side}_{index}", (-2.65 + index * 0.38, y - side * 0.32, 0.47), 0.22, 0.1, wheel, vertices=12, rot=(math.pi / 2, 0, 0), parent=rig)
        for index in range(10):
            box(f"TrackPad_{side}_{index}", (-2.8 + index * 0.27, y - side * 0.36, 0.74 if index < 5 else 0.2), (0.12, 0.06, 0.055), dark, bevel=0.02, parent=rig)
    box("ExcavatorUndercarriage", (-1.55, 0, 0.92), (1.22, 0.78, 0.18), dark, bevel=0.12, parent=rig)

    pivot = Vector((-1.55, 0, 1.02))
    upper = empty("ExcavatorUpper", rig)
    upper.location = pivot
    box("ExcavatorTurntable", (0, 0, 0), (1.15, 0.7, 0.32), yellow, bevel=0.12, parent=upper)
    box("ExcavatorCounterweight", (-0.7, 0.05, 0.63), (0.75, 0.7, 0.55), yellow, bevel=0.16, parent=upper)
    box("ExcavatorCab", (0.45, -0.05, 0.72), (0.58, 0.63, 0.7), glass, bevel=0.09, parent=upper)
    for x in (-0.13, 1.03):
        segment(f"CabFrame_{x}", (x, -0.68, 0.06), (x, -0.68, 1.4), 0.045, dark, parent=upper)

    arm = empty("ExcavatorArm", upper)
    segment("ExcavatorBoom", (0.9, 0, 0.8), (2.5, 0, 2.4), 0.25, yellow, end_radius=0.18, parent=arm)
    segment("ExcavatorStick", (2.5, 0, 2.4), (4.05, 0, 2.02), 0.19, yellow, end_radius=0.13, parent=arm)
    segment("BoomHydraulic", (1.05, -0.28, 0.98), (2.73, -0.28, 2.14), 0.065, wheel, end_radius=0.045, parent=arm)
    segment("StickHydraulic", (2.43, -0.22, 2.23), (3.93, -0.22, 1.98), 0.05, wheel, end_radius=0.035, parent=arm)
    box("ExcavatorBucket", (4.27, 0, 1.8), (0.52, 0.72, 0.24), dark, rot=(0, 0.18, 0), bevel=0.1, parent=arm)
    for side in (-1, 1):
        segment(f"PlaneCradle_{side}", (4.03, side * 0.5, 1.98), (4.55, side * 0.5, 2.34), 0.075, dark, end_radius=0.055, parent=arm)
        box(f"PlaneClamp_{side}", (4.62, side * 0.5, 2.44), (0.12, 0.14, 0.25), yellow, rot=(0, -0.32, 0), bevel=0.05, parent=arm)
    for index in range(5):
        cone(f"BucketTooth_{index}", (4.63, -0.52 + index * 0.26, 1.71), 0.065, 0, 0.25, dark, vertices=6, rot=(0, math.pi / 2, 0), parent=arm)
    return rig, upper, arm


def make_plane(parent: bpy.types.Object) -> bpy.types.Object:
    plane, imported = import_glb_group(
        LICENSED_MODEL_DIR / "small-airplane.glb",
        "PlaneRig",
        parent,
        target_size=5.4,
        location=(3.1, 0, 3.62),
        fit="span",
        center_location=True,
        rotation=(0, -0.04, -0.05),
    )
    propeller = next((obj for obj in imported if obj.name.startswith("Propeller_Cone")), None)
    if propeller:
        propeller.name = "Propeller"
    return plane


def build_demo() -> bpy.types.Object:
    root = empty("DemoScene")
    base_platform(root, "#614218", PALETTE["yellow"], shape="round")
    sand = material("Demo sand", PALETTE["sand"], roughness=0.9)
    line = material("Runway paint", "#ede4c9", roughness=0.72)
    box("Runway", (0, 0, 0.18), (3.9, 2.65, 0.08), sand, bevel=0.13, parent=root)
    for index in range(7):
        box(f"RunwayMark_{index}", (-3 + index * 1.0, -1.7, 0.29), (0.32, 0.08, 0.025), line, bevel=0.01, parent=root)
    for index in range(18):
        angle = index * 2.3
        radius = 3.1 + (index % 4) * 0.22
        ico(f"DemoRock_{index}", (math.cos(angle) * radius, math.sin(angle) * radius * 0.68, 0.32), (0.2 + index % 3 * 0.08, 0.22, 0.18), sand, subdivisions=1, rot=(angle, 0.3, angle * 0.5), parent=root)
    _, _, arm = make_excavator(root)
    make_plane(arm)
    return root


def select_hierarchy(root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_render(scene_name: str, camera_loc: tuple[float, float, float], target: tuple[float, float, float], accent: str) -> None:
    world = bpy.context.scene.world or bpy.data.worlds.new("Studio World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = rgb("#030305")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.07

    bpy.ops.object.camera_add(location=camera_loc)
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    camera.data.lens = 52
    look_at(camera, target)
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-4.5, -5.5, 7.5))
    key = bpy.context.object
    key.name = "PreviewKey"
    key.data.energy = 1250
    key.data.shape = "DISK"
    key.data.size = 5.5
    look_at(key, target)

    bpy.ops.object.light_add(type="AREA", location=(4.8, -1.2, 5.0))
    rim = bpy.context.object
    rim.name = "PreviewRim"
    rim.data.energy = 1100
    rim.data.color = rgb(accent)[:3]
    rim.data.size = 4.0
    look_at(rim, target)

    bpy.ops.object.light_add(type="AREA", location=(0, 4.5, 5.5))
    fill = bpy.context.object
    fill.name = "PreviewFill"
    fill.data.energy = 850
    fill.data.color = rgb("#4a2e8f")[:3]
    fill.data.size = 5.0
    look_at(fill, target)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(PREVIEW_DIR / f"{scene_name}.png")
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"


def export_scene(scene_name: str, root: bpy.types.Object) -> None:
    source_path = SOURCE_DIR / f"{scene_name}.blend"
    model_path = MODEL_DIR / f"{scene_name}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    bpy.ops.render.render(write_still=True)
    select_hierarchy(root)
    bpy.ops.export_scene.gltf(
        filepath=str(model_path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print(f"GENERATED {scene_name}: {model_path} and {PREVIEW_DIR / f'{scene_name}.png'}")


SCENES = [
    ("nod", build_nod, (7.2, -12.8, 5.7), (0, 0.0, 2.35), PALETTE["cyan"]),
    ("scratch", build_scratch, (7.8, -12.2, 6.0), (0, 0.2, 1.7), PALETTE["violet"]),
    ("reactor", build_reactor, (8.5, -13.2, 6.8), (0.1, 0.1, 1.65), PALETTE["acid"]),
    ("brain", build_brain, (8.2, -13.0, 6.4), (0.2, 0.2, 1.8), PALETTE["cyan"]),
    ("demo", build_demo, (9.0, -14.2, 7.4), (0.0, 0.0, 1.8), PALETTE["yellow"]),
]


requested_scenes = {arg.lower() for arg in sys.argv[sys.argv.index("--") + 1 :]} if "--" in sys.argv else set()

for name, builder, camera_location, camera_target, accent in SCENES:
    if requested_scenes and name not in requested_scenes:
        continue
    reset_scene()
    root_object = builder()
    set_render(name, camera_location, camera_target, accent)
    export_scene(name, root_object)

print("ALL_INTERACTABLE_MEME_ASSETS_GENERATED")
