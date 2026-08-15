"""Generate the five low-poly dioramas used by Interactable Memes.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python scripts/generate_interactable_meme_assets.py

The script intentionally uses only Blender primitives. That keeps the art direction coherent,
the exported GLBs small, and every animated node under our control in Three.js.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO / "public" / "interactable-memes" / "studio-models"
PREVIEW_DIR = REPO / "public" / "interactable-memes" / "studio-previews"
SOURCE_DIR = REPO / "art" / "interactable-memes"

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
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
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


def make_business_man(root: bpy.types.Object) -> bpy.types.Object:
    man = empty("OfficeHero", root)
    suit = material("Suit charcoal", "#22262f", roughness=0.55)
    shirt = material("Shirt", "#e9eef0", roughness=0.5)
    tie = material("Tie", "#8f2637", roughness=0.5)
    skin = material("Office skin", PALETTE["skin"], roughness=0.56)
    hair = material("Office hair", PALETTE["hair"], roughness=0.72)
    shoes = material("Shoes", "#111318", roughness=0.36)

    segment("Leg_L", (-0.38, 0, 0.28), (-0.55, -0.02, 1.32), 0.25, suit, end_radius=0.2, parent=man)
    segment("Leg_R", (0.48, 0, 0.28), (0.42, -0.02, 1.35), 0.25, suit, end_radius=0.2, parent=man)
    box("Shoe_L", (-0.58, -0.14, 0.22), (0.28, 0.44, 0.18), shoes, rot=(0, 0, -0.1), bevel=0.08, parent=man)
    box("Shoe_R", (0.47, -0.14, 0.22), (0.28, 0.44, 0.18), shoes, rot=(0, 0, 0.08), bevel=0.08, parent=man)
    box("Torso", (0, 0, 1.86), (0.72, 0.38, 0.72), suit, bevel=0.14, parent=man)
    box("ShirtFront", (0, -0.395, 1.94), (0.25, 0.035, 0.56), shirt, bevel=0.02, parent=man)
    cone("Tie", (0, -0.445, 1.91), 0.12, 0.035, 0.82, tie, vertices=4, parent=man)
    ico("Head", (0, -0.02, 2.86), (0.49, 0.42, 0.58), skin, subdivisions=2, parent=man)
    ico("Hair", (0, 0.04, 3.18), (0.48, 0.38, 0.28), hair, subdivisions=1, parent=man)
    box("Hairline", (0, -0.37, 3.03), (0.4, 0.06, 0.16), hair, rot=(0.08, 0, 0), bevel=0.06, parent=man)
    eye("OfficeEye_L", (-0.19, -0.41, 2.95), 0.74, man)
    eye("OfficeEye_R", (0.19, -0.41, 2.95), 0.74, man)
    segment("Brow_L", (-0.31, -0.5, 3.09), (-0.08, -0.52, 3.04), 0.035, hair, parent=man)
    segment("Brow_R", (0.08, -0.52, 3.04), (0.31, -0.5, 3.09), 0.035, hair, parent=man)
    box("Mouth", (0, -0.46, 2.67), (0.18, 0.025, 0.035), hair, bevel=0.02, parent=man)

    for side in (-1, 1):
        shoulder = (0.62 * side, -0.02, 2.25)
        elbow = (1.25 * side, -0.25, 2.15)
        palm = (1.88 * side, -0.42, 2.35)
        segment(f"ArmUpper_{side}", shoulder, elbow, 0.22, suit, end_radius=0.18, parent=man)
        segment(f"ArmLower_{side}", elbow, palm, 0.18, suit, end_radius=0.13, parent=man)
        ico(f"Palm_{side}", palm, (0.22, 0.13, 0.18), skin, subdivisions=1, parent=man)
        segment(f"HeroIndex_{side}", palm, (2.35 * side, -0.5, 2.37), 0.07, skin, end_radius=0.05, parent=man)
        segment(f"HeroThumb_{side}", palm, (2.0 * side, -0.48, 2.67), 0.075, skin, end_radius=0.05, parent=man)
    return man


def make_finger_gun(name: str, loc: tuple[float, float, float], side: int, parent: bpy.types.Object) -> bpy.types.Object:
    gun = empty(name, parent)
    skin = material("Foreground skin", PALETTE["skin_light"], roughness=0.54)
    sleeve_colors = ("#334133", "#9c2d32", "#e6e3da", "#2d405c")
    sleeve = material(f"{name}_Sleeve", sleeve_colors[int(name.split("_")[-1]) % len(sleeve_colors)], roughness=0.64)
    gun.location = loc
    segment(name + "_Sleeve", (-1.2 * side, 0.12, -0.04), (-0.18 * side, 0, 0), 0.28, sleeve, end_radius=0.2, parent=gun)
    ico(name + "_Palm", (0, 0, 0), (0.34, 0.18, 0.25), skin, subdivisions=1, parent=gun)
    segment(name + "_Index", (0.16 * side, -0.03, 0.08), (0.94 * side, -0.08, 0.08), 0.105, skin, end_radius=0.07, parent=gun)
    segment(name + "_Thumb", (0.08 * side, -0.01, 0.14), (0.34 * side, -0.02, 0.52), 0.095, skin, end_radius=0.06, parent=gun)
    return gun


def build_crossfire() -> bpy.types.Object:
    root = empty("CrossfireScene")
    base_platform(root, "#2a292c", PALETTE["acid"])
    wall = material("Office wall", "#8f7f6e", roughness=0.82)
    window = material("Office windows", "#242b33", roughness=0.32, metallic=0.1)
    blind = material("Office blinds", "#c6bda8", roughness=0.65)
    chair = material("Office chairs", "#282629", roughness=0.66)
    box("BackWall", (0, 2.5, 2.1), (4.25, 0.12, 2.1), wall, bevel=0.04, parent=root)
    for side in (-1, 1):
        box(f"Window_{side}", (2.55 * side, 2.32, 2.18), (1.12, 0.08, 1.22), window, bevel=0.04, parent=root)
        for row in range(12):
            box(f"Blind_{side}_{row}", (2.55 * side, 2.2, 1.15 + row * 0.18), (1.05, 0.025, 0.025), blind, bevel=0.01, parent=root)
    for index in range(5):
        x = -3.15 + index * 1.55
        box(f"ChairSeat_{index}", (x, 1.38, 0.58), (0.5, 0.48, 0.12), chair, bevel=0.08, parent=root)
        box(f"ChairBack_{index}", (x, 1.78, 1.08), (0.5, 0.12, 0.55), chair, rot=(0.08, 0, 0), bevel=0.08, parent=root)
        for dx in (-0.36, 0.36):
            segment(f"ChairLeg_{index}_{dx}", (x + dx, 1.18, 0.13), (x + dx, 1.32, 0.55), 0.04, chair, parent=root)
    make_business_man(root)
    placements = [
        ((-3.2, -1.22, 2.3), 1),
        ((3.2, -1.12, 2.2), -1),
        ((-3.0, -0.75, 1.18), 1),
        ((3.05, -0.65, 1.1), -1),
    ]
    for index, (loc, side) in enumerate(placements):
        gun = make_finger_gun(f"FingerGun_{index}", loc, side, root)
        gun.rotation_euler[2] = (0.08 if index % 2 else -0.06) * side
    return root


def make_cat(root: bpy.types.Object) -> bpy.types.Object:
    cat = empty("DJCat", root)
    fur = material("Cat fur", "#342f35", roughness=0.78)
    fur_light = material("Cat muzzle", "#d5c7b7", roughness=0.74)
    pink = material("Cat ears", "#d8838b", roughness=0.68)
    black = material("Glasses", "#07070a", roughness=0.25, metallic=0.12)
    pixel = material("Glasses shine", PALETTE["white"], roughness=0.25, emission=0.15)
    ico("CatBody", (0, 0.25, 1.2), (0.7, 0.55, 1.0), fur, subdivisions=2, parent=cat)
    ico("CatHead", (0, -0.03, 2.28), (0.74, 0.58, 0.68), fur, subdivisions=2, parent=cat)
    cone("CatEar_L", (-0.44, 0.02, 2.93), 0.36, 0, 0.76, fur, vertices=5, rot=(0, -0.1, -0.18), parent=cat)
    cone("CatEar_R", (0.44, 0.02, 2.93), 0.36, 0, 0.76, fur, vertices=5, rot=(0, 0.1, 0.18), parent=cat)
    cone("CatEarInner_L", (-0.44, -0.1, 2.93), 0.2, 0, 0.46, pink, vertices=5, rot=(0, -0.1, -0.18), parent=cat)
    cone("CatEarInner_R", (0.44, -0.1, 2.93), 0.2, 0, 0.46, pink, vertices=5, rot=(0, 0.1, 0.18), parent=cat)
    ico("CatMuzzle", (0, -0.58, 2.16), (0.48, 0.19, 0.29), fur_light, subdivisions=2, parent=cat)
    cone("CatNose", (0, -0.8, 2.26), 0.1, 0, 0.14, pink, vertices=5, rot=(math.pi / 2, 0, 0), parent=cat)
    for side in (-1, 1):
        box(f"Shade_{side}", (0.28 * side, -0.63, 2.48), (0.26, 0.06, 0.18), black, bevel=0.04, parent=cat)
        for px in range(3):
            box(f"ShadePixel_{side}_{px}", ((0.14 + px * 0.12) * side, -0.7, 2.55 - px * 0.025), (0.04, 0.018, 0.035), pixel, bevel=0.005, parent=cat)
    box("ShadeBridge", (0, -0.65, 2.49), (0.12, 0.05, 0.035), black, bevel=0.02, parent=cat)
    for side in (-1, 1):
        segment(f"CatArm_{side}", (0.45 * side, 0, 1.55), (0.95 * side, -0.58, 1.15), 0.18, fur, end_radius=0.14, parent=cat)
        ico(f"CatPaw_{side}", (0.98 * side, -0.62, 1.12), (0.24, 0.18, 0.16), fur_light, subdivisions=1, parent=cat)
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
    gorilla = empty("Gorilla", root)
    fur = material("Gorilla fur", "#252526", roughness=0.88)
    fur_mid = material("Gorilla chest", "#4b4640", roughness=0.82)
    face = material("Gorilla face", "#51483f", roughness=0.76)
    eye_mat = material("Gorilla eyes", PALETTE["acid"], roughness=0.28, emission=0.35)
    ico("GorillaTorso", (-1.65, 0.15, 1.65), (0.88, 0.66, 1.18), fur, subdivisions=2, rot=(0.05, 0.08, -0.08), parent=gorilla)
    ico("GorillaBelly", (-1.58, -0.57, 1.58), (0.58, 0.18, 0.73), fur_mid, subdivisions=2, parent=gorilla)
    ico("GorillaHead", (-1.6, -0.02, 2.95), (0.58, 0.5, 0.58), fur, subdivisions=2, parent=gorilla)
    ico("GorillaMuzzle", (-1.58, -0.53, 2.78), (0.45, 0.26, 0.31), face, subdivisions=1, parent=gorilla)
    for side in (-1, 1):
        x = -1.65 + 0.37 * side
        ico(f"GorillaEye_{side}", (x, -0.48, 3.08), (0.065, 0.04, 0.065), eye_mat, subdivisions=2, parent=gorilla)
        shoulder = (-1.65 + 0.7 * side, 0, 2.35)
        hand = (-1.65 + 1.16 * side, -0.2, 0.55)
        segment(f"GorillaArm_{side}", shoulder, hand, 0.32, fur, end_radius=0.25, parent=gorilla)
        ico(f"GorillaFist_{side}", hand, (0.38, 0.32, 0.34), fur_mid, subdivisions=1, parent=gorilla)
        segment(f"GorillaLeg_{side}", (-1.65 + 0.45 * side, 0.15, 1.0), (-1.65 + 0.58 * side, -0.05, 0.35), 0.3, fur, end_radius=0.24, parent=gorilla)
    return gorilla


def make_trex(root: bpy.types.Object) -> bpy.types.Object:
    trex = empty("Trex", root)
    green = material("Trex green", PALETTE["green"], roughness=0.68, emission=0.06)
    dark = material("Trex dark", PALETTE["green_dark"], roughness=0.74)
    mouth = material("Trex mouth", "#8d2639", roughness=0.6)
    eye_mat = material("Trex eye", "#ffe344", roughness=0.25, emission=0.25)
    ico("TrexBody", (1.45, 0.15, 1.75), (1.14, 0.62, 0.85), green, subdivisions=2, rot=(0.05, -0.08, -0.08), parent=trex)
    segment("TrexNeck", (1.7, 0.05, 2.2), (2.15, -0.05, 2.85), 0.45, green, end_radius=0.34, parent=trex)
    ico("TrexHead", (2.38, -0.2, 3.12), (0.86, 0.52, 0.48), green, subdivisions=2, rot=(0, -0.08, -0.08), parent=trex)
    box("TrexJaw", (2.55, -0.43, 2.82), (0.73, 0.27, 0.18), mouth, rot=(0, -0.06, -0.12), bevel=0.12, parent=trex)
    tooth_row("TrexTooth", [2.05 + i * 0.16 for i in range(7)], -0.72, 2.92, trex)
    ico("TrexEye", (2.55, -0.68, 3.3), (0.11, 0.05, 0.12), eye_mat, subdivisions=2, parent=trex)
    ico("TrexPupil", (2.57, -0.725, 3.3), (0.035, 0.018, 0.07), material("Trex pupil", PALETTE["ink"]), subdivisions=1, parent=trex)
    tail_points = [(0.7, 0.18, 1.8), (-0.1, 0.28, 1.7), (-0.8, 0.35, 1.48), (-1.35, 0.42, 1.25)]
    previous = (1.0, 0.18, 1.8)
    radii = [0.48, 0.36, 0.24, 0.1]
    for index, point in enumerate(tail_points):
        segment(f"TrexTail_{index}", previous, point, radii[index], green if index < 2 else dark, end_radius=radii[index] * 0.65, parent=trex)
        previous = point
    for side in (-1, 1):
        y = 0.2 + side * 0.34
        segment(f"TrexThigh_{side}", (1.3, y, 1.35), (1.05, y, 0.58), 0.36, green, end_radius=0.24, parent=trex)
        segment(f"TrexShin_{side}", (1.05, y, 0.58), (1.48, y - 0.08, 0.25), 0.2, dark, end_radius=0.14, parent=trex)
        box(f"TrexFoot_{side}", (1.65, y - 0.16, 0.2), (0.38, 0.26, 0.13), dark, bevel=0.07, parent=trex)
        segment(f"TrexTinyArm_{side}", (1.93, -0.3 + side * 0.2, 2.55), (2.25, -0.48 + side * 0.2, 2.28), 0.09, green, end_radius=0.055, parent=trex)
    for index in range(7):
        cone(f"TrexSpine_{index}", (0.5 + index * 0.31, 0.15, 2.48 + math.sin(index * 0.5) * 0.18), 0.13, 0, 0.34, dark, vertices=5, rot=(0.1, 0, 0), parent=trex)
    return trex


def build_reactor() -> bpy.types.Object:
    root = empty("ReactorScene")
    base_platform(root, "#273322", PALETTE["acid"], shape="round")
    rock = material("Reactor rock", "#3c423a", roughness=0.9)
    grass = material("Reactor grass", "#487f34", roughness=0.86)
    glow = material("Reactor glow", PALETTE["acid"], roughness=0.25, emission=2.5)
    smoke = material("Radioactive smoke", "#79c900", roughness=0.7, emission=0.32, alpha=0.45)
    for index in range(20):
        angle = index * 2.4
        radius = 2.0 + (index % 5) * 0.38
        loc = (math.cos(angle) * radius, math.sin(angle) * radius * 0.68, 0.25 + (index % 3) * 0.08)
        ico(f"Rock_{index:02d}", loc, (0.32 + (index % 4) * 0.09, 0.28, 0.24 + (index % 3) * 0.08), rock if index % 3 else grass, subdivisions=1, rot=(index * 0.2, index * 0.1, index * 0.3), parent=root)
    make_gorilla(root)
    make_trex(root)
    reactor = empty("ReactorCore", root)
    ico("CoreCrystal", (0.1, -0.65, 1.25), (0.44, 0.44, 0.58), glow, subdivisions=2, rot=(0.2, 0, 0.3), parent=reactor)
    for index in range(3):
        torus(f"CoreRing_{index}", (0.1, -0.65, 1.25), 0.67 + index * 0.19, 0.035, glow, rot=(index * 0.6, index * 0.4, index * 0.8), parent=reactor)
    for index in range(9):
        ico(f"Smoke_{index:02d}", (-0.2 + (index % 3) * 0.28, 0.3, 2.5 + index * 0.22), (0.28 + (index % 2) * 0.12, 0.22, 0.3), smoke, subdivisions=1, parent=root)
    return root


def make_morty(root: bpy.types.Object) -> bpy.types.Object:
    boy = empty("Morty", root)
    skin = material("Morty skin", PALETTE["skin_light"], roughness=0.56)
    shirt = material("Morty yellow", "#efcf32", roughness=0.62)
    pants = material("Morty pants", "#426ab5", roughness=0.66)
    backpack = material("Morty backpack", "#b92d3e", roughness=0.66)
    hair = material("Morty hair", "#6b3a21", roughness=0.74)
    box("MortyTorso", (-1.08, 0, 1.25), (0.48, 0.31, 0.64), shirt, bevel=0.13, parent=boy)
    box("MortyPants", (-1.08, 0, 0.58), (0.48, 0.32, 0.24), pants, bevel=0.1, parent=boy)
    box("MortyBackpack", (-1.08, 0.33, 1.28), (0.42, 0.18, 0.58), backpack, bevel=0.12, parent=boy)
    ico("MortyHead", (-1.08, -0.05, 2.28), (0.62, 0.5, 0.68), skin, subdivisions=2, parent=boy)
    for index in range(10):
        angle = index / 10 * math.tau
        ico(f"MortyHair_{index}", (-1.08 + math.cos(angle) * 0.45, 0.08, 2.65 + math.sin(angle) * 0.28), (0.18, 0.14, 0.18), hair, subdivisions=1, parent=boy)
    eye("MortyEye_L", (-1.3, -0.5, 2.35), 1.05, boy)
    eye("MortyEye_R", (-0.87, -0.5, 2.35), 1.05, boy)
    box("MortyMouth", (-1.08, -0.56, 2.02), (0.2, 0.03, 0.08), material("Morty mouth", "#551b22"), bevel=0.04, parent=boy)
    for side in (-1, 1):
        x = -1.08 + side * 0.34
        segment(f"MortyLeg_{side}", (x, 0, 0.54), (x + side * 0.04, 0, 0.08), 0.15, pants, end_radius=0.12, parent=boy)
    arm = empty("MortyPointArm", boy)
    arm.location = (-1.47, -0.02, 1.48)
    segment("MortyPointUpper", (0, 0, 0), (-0.45, -0.25, 0.16), 0.14, skin, end_radius=0.11, parent=arm)
    segment("MortyPointFinger", (-0.45, -0.25, 0.16), (-0.95, -0.3, 0.22), 0.065, skin, end_radius=0.04, parent=arm)
    segment("MortyOtherArm", (-0.7, -0.02, 1.48), (-0.52, -0.3, 1.05), 0.14, skin, end_radius=0.1, parent=boy)
    return boy


def make_rick(root: bpy.types.Object) -> bpy.types.Object:
    rick = empty("Rick", root)
    skin = material("Rick skin", "#dfaa78", roughness=0.55)
    coat = material("Rick coat", PALETTE["white"], roughness=0.64)
    shirt = material("Rick shirt", "#8ad9d7", roughness=0.58)
    pants = material("Rick pants", "#4a3a2c", roughness=0.68)
    hair = material("Rick hair", "#87bfd3", roughness=0.58, emission=0.08)
    box("RickTorso", (1.15, 0.08, 1.42), (0.58, 0.34, 0.8), coat, bevel=0.13, parent=rick)
    box("RickShirt", (1.15, -0.3, 1.45), (0.3, 0.045, 0.64), shirt, bevel=0.04, parent=rick)
    ico("RickHead", (1.15, -0.03, 2.65), (0.54, 0.45, 0.64), skin, subdivisions=2, parent=rick)
    eye("RickEye_L", (0.96, -0.44, 2.73), 0.9, rick)
    eye("RickEye_R", (1.34, -0.44, 2.73), 0.9, rick)
    box("RickMouth", (1.15, -0.5, 2.39), (0.28, 0.03, 0.1), material("Rick mouth", "#55222b"), bevel=0.04, parent=rick)
    for index in range(11):
        angle = -1.35 + index * 0.27
        cone(
            f"RickHair_{index}",
            (1.15 + math.sin(angle) * 0.49, 0.03, 3.12 + math.cos(angle) * 0.3),
            0.19,
            0,
            0.72,
            hair,
            vertices=6,
            rot=(0, angle * 0.2, -angle),
            parent=rick,
        )
    for side in (-1, 1):
        x = 1.15 + side * 0.3
        segment(f"RickLeg_{side}", (x, 0.05, 0.75), (x + side * 0.05, 0, 0.08), 0.17, pants, end_radius=0.13, parent=rick)
        shoulder = (1.15 + side * 0.52, 0, 1.78)
        hand = (1.15 + side * 0.95, -0.28, 1.37 + (0.3 if side == -1 else 0))
        segment(f"RickArm_{side}", shoulder, hand, 0.16, coat, end_radius=0.1, parent=rick)
        ico(f"RickHand_{side}", hand, (0.16, 0.12, 0.18), skin, subdivisions=1, parent=rick)
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


def make_excavator(root: bpy.types.Object) -> tuple[bpy.types.Object, bpy.types.Object]:
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
    box("ExcavatorBase", (-1.55, 0, 1.02), (1.15, 0.7, 0.32), yellow, bevel=0.12, parent=rig)
    box("ExcavatorCounterweight", (-2.25, 0.05, 1.65), (0.75, 0.7, 0.55), yellow, bevel=0.16, parent=rig)
    box("ExcavatorCab", (-1.1, -0.05, 1.74), (0.58, 0.63, 0.7), glass, bevel=0.09, parent=rig)
    for x in (-1.68, -0.52):
        segment(f"CabFrame_{x}", (x, -0.68, 1.08), (x, -0.68, 2.42), 0.045, dark, parent=rig)
    arm = empty("ExcavatorArm", rig)
    segment("ExcavatorBoom", (-0.65, 0, 1.82), (1.05, 0, 3.08), 0.23, yellow, end_radius=0.17, parent=arm)
    segment("ExcavatorStick", (1.05, 0, 3.08), (2.32, 0, 2.18), 0.18, yellow, end_radius=0.12, parent=arm)
    segment("BoomHydraulic", (-0.5, -0.28, 2.0), (1.32, -0.28, 2.78), 0.06, wheel, end_radius=0.045, parent=arm)
    box("ExcavatorBucket", (2.58, 0, 1.86), (0.5, 0.65, 0.42), dark, rot=(0, -0.25, 0), bevel=0.12, parent=arm)
    for index in range(4):
        cone(f"BucketTooth_{index}", (2.95, -0.42 + index * 0.28, 1.64), 0.07, 0, 0.28, dark, vertices=6, rot=(0, math.pi / 2, 0), parent=arm)
    return rig, arm


def make_plane(root: bpy.types.Object) -> bpy.types.Object:
    plane = empty("PlaneRig", root)
    white = material("Plane body", "#ebe9df", roughness=0.48, metallic=0.06)
    gold = material("Plane underwing", "#b9781f", roughness=0.5)
    stripe = material("Plane stripe", "#293442", roughness=0.42)
    glass = material("Plane windows", "#202b34", roughness=0.25, metallic=0.15)
    metal = material("Propeller", "#b7b2a8", roughness=0.28, metallic=0.62)
    ico("PlaneFuselage", (1.35, -0.12, 3.65), (1.9, 0.43, 0.42), white, subdivisions=2, rot=(0, 0.04, -0.05), parent=plane)
    box("PlaneStripe", (1.35, -0.54, 3.58), (1.45, 0.035, 0.08), stripe, rot=(0, 0.04, -0.05), bevel=0.02, parent=plane)
    box("PlaneWing", (1.15, -0.05, 3.52), (1.15, 2.05, 0.09), white, rot=(0, -0.06, 0), bevel=0.1, parent=plane)
    box("PlaneWingGold", (1.15, -0.05, 3.42), (1.06, 1.9, 0.035), gold, rot=(0, -0.06, 0), bevel=0.04, parent=plane)
    box("PlaneTailWing", (-0.15, 0, 3.77), (0.58, 0.82, 0.055), white, rot=(0, 0.1, 0), bevel=0.07, parent=plane)
    box("PlaneTailFin", (-0.32, 0.02, 4.18), (0.42, 0.07, 0.48), white, rot=(0, 0.2, 0), bevel=0.08, parent=plane)
    for index in range(4):
        box(f"PlaneWindow_{index}", (0.63 + index * 0.34, -0.54, 3.78), (0.11, 0.025, 0.1), glass, rot=(0, 0, -0.03), bevel=0.035, parent=plane)
    prop = empty("Propeller", plane)
    prop.location = (3.28, -0.1, 3.64)
    cylinder("PropHub", (0, 0, 0), 0.17, 0.25, metal, vertices=12, rot=(0, math.pi / 2, 0), parent=prop)
    box("PropBlade_A", (0.1, 0, 0), (0.06, 0.05, 0.78), metal, rot=(0.12, 0, 0.15), bevel=0.05, parent=prop)
    box("PropBlade_B", (0.1, 0, 0), (0.06, 0.78, 0.05), metal, rot=(0.12, 0, 0.15), bevel=0.05, parent=prop)
    for side in (-1, 1):
        cylinder(f"PlaneWheel_{side}", (0.9, side * 0.66, 3.02), 0.18, 0.1, material("Plane tire", PALETTE["ink"]), vertices=12, rot=(math.pi / 2, 0, 0), parent=plane)
        segment(f"PlaneStrut_{side}", (0.9, side * 0.62, 3.46), (0.9, side * 0.66, 3.08), 0.035, metal, parent=plane)
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
    make_excavator(root)
    make_plane(root)
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
    ("crossfire", build_crossfire, (7.6, -12.5, 6.3), (0, 0.25, 1.7), PALETTE["acid"]),
    ("scratch", build_scratch, (7.8, -12.2, 6.0), (0, 0.2, 1.7), PALETTE["violet"]),
    ("reactor", build_reactor, (8.5, -13.2, 6.8), (0.1, 0.1, 1.65), PALETTE["acid"]),
    ("brain", build_brain, (8.2, -13.0, 6.4), (0.2, 0.2, 1.8), PALETTE["cyan"]),
    ("demo", build_demo, (9.0, -14.2, 7.4), (0.0, 0.0, 1.8), PALETTE["yellow"]),
]


for name, builder, camera_location, camera_target, accent in SCENES:
    reset_scene()
    root_object = builder()
    set_render(name, camera_location, camera_target, accent)
    export_scene(name, root_object)

print("ALL_INTERACTABLE_MEME_ASSETS_GENERATED")
