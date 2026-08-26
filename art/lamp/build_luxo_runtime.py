"""Build the web-ready Luxo lamp from the downloaded Blender rig.

Run inside Blender with both the legacy lamp scene (``Scene``) and the appended
download scene (``LuxoSource_Inspection``) loaded.  The script creates a clean,
rigid-pivot hierarchy that Three.js can drive without Blender-only IK
constraints.  It deliberately leaves the two source scenes intact in memory.
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Matrix, Vector


SOURCE_SCENE = "LuxoSource_Inspection"
LEGACY_SCENE = "Scene"
RUNTIME_SCENE = "LuxoRuntime"
PREVIEW_PATH = "/private/tmp/luxo-runtime-preview.png"
GLB_PATH = "/private/tmp/luxo-character-lamp-preview.glb"

REQUIRED_NAMES = (
    "LampRoot",
    "BaseYaw",
    "Shoulder",
    "Elbow",
    "HeadPitch",
    "HeadYaw",
    "Base",
    "Lamp_lamp_head",
    "LampBulb",
    "EyeLeft",
    "EyeRight",
    "ScleraLeft",
    "ScleraRight",
    "PupilLeft",
    "PupilRight",
    "PupilCoreLeft",
    "PupilCoreRight",
    "CatchlightLeft",
    "CatchlightRight",
    "FacePlate",
    "NeckAxle",
    "NeckCollarHead",
    "NeckCollarArm",
    "RubberFoot_1",
    "RubberFoot_2",
    "RubberFoot_3",
    "RubberFoot_4",
)


def remove_scene(name: str) -> None:
    scene = bpy.data.scenes.get(name)
    if scene is None:
        return
    owned = list(scene.objects)
    bpy.data.scenes.remove(scene)
    for obj in owned:
        if obj.users == 0:
            bpy.data.objects.remove(obj, do_unlink=True)


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    principled = mat.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in principled.inputs:
        principled.inputs["Coat Weight"].default_value = 0.32
        principled.inputs["Coat Roughness"].default_value = 0.16
    return mat


def parent_keep_world(child: bpy.types.Object, parent: bpy.types.Object) -> None:
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def make_empty(
    scene: bpy.types.Scene,
    name: str,
    location: Vector,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.025
    obj.matrix_world = Matrix.Translation(location)
    if parent:
        parent_keep_world(obj, parent)
    return obj


def set_single_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def make_group_piece(
    scene: bpy.types.Scene,
    source: bpy.types.Object,
    group_name: str,
    name: str,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    add_bevel: bool = False,
) -> bpy.types.Object:
    group = source.vertex_groups.get(group_name)
    if group is None:
        raise RuntimeError(f"{source.name} has no vertex group {group_name}")

    disabled: list[tuple[bpy.types.Modifier, bool]] = []
    for modifier in source.modifiers:
        if modifier.type != "ARMATURE":
            disabled.append((modifier, modifier.show_viewport))
            modifier.show_viewport = False
    bpy.context.view_layer.update()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        if len(evaluated_mesh.vertices) != len(source.data.vertices):
            raise RuntimeError(
                f"Topology changed while extracting {source.name}: "
                f"{len(source.data.vertices)} -> {len(evaluated_mesh.vertices)}"
            )
        selected = {
            vertex.index
            for vertex in source.data.vertices
            if any(link.group == group.index and link.weight > 0.001 for link in vertex.groups)
        }
        polygons = [
            tuple(polygon.vertices)
            for polygon in evaluated_mesh.polygons
            if all(index in selected for index in polygon.vertices)
        ]
        used = sorted({index for polygon in polygons for index in polygon})
        remap = {old: new for new, old in enumerate(used)}
        vertices = [evaluated_mesh.vertices[index].co.copy() for index in used]
        faces = [tuple(remap[index] for index in polygon) for polygon in polygons]
    finally:
        evaluated.to_mesh_clear()
        for modifier, visible in disabled:
            modifier.show_viewport = visible
        bpy.context.view_layer.update()

    if not faces:
        raise RuntimeError(f"No faces found for {source.name}:{group_name}")

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.matrix_world = source.matrix_world.copy()
    set_single_material(obj, mat)
    parent_keep_world(obj, parent)
    if add_bevel:
        bevel = obj.modifiers.new("Precision edge bevel", "BEVEL")
        bevel.width = 0.00028
        bevel.segments = 2
    return obj


def make_curve_mesh(
    scene: bpy.types.Scene,
    source: bpy.types.Object,
    name: str,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    curve = source.data
    old_bevel_mode = curve.bevel_mode
    old_bevel_object = curve.bevel_object
    old_bevel_depth = curve.bevel_depth
    old_bevel_resolution = curve.bevel_resolution
    curve.bevel_object = None
    curve.bevel_mode = "ROUND"
    curve.bevel_depth = 0.00125
    curve.bevel_resolution = 2
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    try:
        mesh = bpy.data.meshes.new_from_object(
            evaluated,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
    finally:
        curve.bevel_mode = old_bevel_mode
        curve.bevel_object = old_bevel_object
        curve.bevel_depth = old_bevel_depth
        curve.bevel_resolution = old_bevel_resolution
        bpy.context.view_layer.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.matrix_world = source.matrix_world.copy()
    set_single_material(obj, mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    parent_keep_world(obj, parent)
    return obj


def make_cylinder(
    scene: bpy.types.Scene,
    name: str,
    location: Vector,
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    along_x: bool = False,
) -> bpy.types.Object:
    bpy.context.window.scene = scene
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48,
        radius=radius,
        depth=depth,
        location=location,
        rotation=(0.0, math.pi / 2.0, 0.0) if along_x else (0.0, 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    set_single_material(obj, mat)
    bevel = obj.modifiers.new("Soft machined edge", "BEVEL")
    bevel.width = min(radius * 0.18, depth * 0.22)
    bevel.segments = 3
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    parent_keep_world(obj, parent)
    return obj


def make_ellipsoid(
    scene: bpy.types.Scene,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    bpy.context.window.scene = scene
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48,
        ring_count=24,
        location=location,
        scale=scale,
    )
    obj = bpy.context.object
    obj.name = name
    set_single_material(obj, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parent_keep_world(obj, parent)
    return obj


def make_face_plate(
    scene: bpy.types.Scene,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    bpy.context.window.scene = scene
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=64,
        ring_count=32,
        location=(0.0, -0.1315, 0.386),
        scale=(0.085, 0.008, 0.085),
    )
    obj = bpy.context.object
    obj.name = "FacePlate"
    set_single_material(obj, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    parent_keep_world(obj, parent)
    return obj


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = ((target - obj.location).to_track_quat("-Z", "Y")).to_euler()


source_scene = bpy.data.scenes.get(SOURCE_SCENE)
if source_scene is None:
    raise RuntimeError(
        f"Expected scene {SOURCE_SCENE!r}; "
        f"found {[scene.name for scene in bpy.data.scenes]}"
    )

for name in REQUIRED_NAMES:
    obj = bpy.data.objects.get(name)
    if obj is not None:
        obj.name = f"Legacy_{name}"

remove_scene(RUNTIME_SCENE)
runtime = bpy.data.scenes.new(RUNTIME_SCENE)
bpy.context.window.scene = runtime

pearl_blue = material(
    "Luxo Pearl Blue Enamel",
    (0.19, 0.34, 0.43, 1.0),
    metallic=0.16,
    roughness=0.18,
)
porcelain = material(
    "Luxo Porcelain Face",
    (0.86, 0.79, 0.63, 1.0),
    metallic=0.02,
    roughness=0.24,
)
graphite = material(
    "Luxo Graphite Metal",
    (0.035, 0.065, 0.078, 1.0),
    metallic=0.76,
    roughness=0.2,
)
steel = material(
    "Luxo Spring Steel",
    (0.24, 0.29, 0.33, 1.0),
    metallic=0.94,
    roughness=0.17,
)
accent = material(
    "Luxo Champagne Accent",
    (0.52, 0.31, 0.105, 1.0),
    metallic=0.86,
    roughness=0.2,
)
bulb_off = material(
    "Luxo Bulb Off",
    (0.65, 0.61, 0.52, 1.0),
    metallic=0.0,
    roughness=0.38,
)
rubber = material(
    "Luxo Rubber",
    (0.018, 0.023, 0.027, 1.0),
    metallic=0.02,
    roughness=0.55,
)
eye_rim = material(
    "Luxo Eye Rim",
    (0.025, 0.055, 0.065, 1.0),
    metallic=0.35,
    roughness=0.2,
)
eye_white = material(
    "Luxo Eye White",
    (0.93, 0.89, 0.76, 1.0),
    metallic=0.0,
    roughness=0.2,
)
iris = material(
    "Luxo Teal Iris",
    (0.018, 0.31, 0.36, 1.0),
    metallic=0.2,
    roughness=0.17,
)
pupil_core = material(
    "Luxo Pupil Core",
    (0.006, 0.016, 0.019, 1.0),
    metallic=0.05,
    roughness=0.12,
)
catchlight = material(
    "Luxo Eye Catchlight",
    (1.0, 0.82, 0.54, 1.0),
    metallic=0.0,
    roughness=0.08,
)
catchlight_bsdf = catchlight.node_tree.nodes.get("Principled BSDF")
if "Emission Color" in catchlight_bsdf.inputs:
    catchlight_bsdf.inputs["Emission Color"].default_value = (1.0, 0.58, 0.22, 1.0)
    catchlight_bsdf.inputs["Emission Strength"].default_value = 1.8

# These are the real mechanical joint centers in the downloaded rig's posed mesh.
base_pivot = Vector((0.0, 0.0, 0.06365))
elbow_pivot = Vector((0.0, 0.02725, 0.16615))
head_pivot = Vector((0.0, -0.02815, 0.30575))

lamp_root = make_empty(runtime, "LampRoot", Vector((0.0, 0.0, 0.0)))
base_yaw = make_empty(runtime, "BaseYaw", base_pivot, lamp_root)
shoulder = make_empty(runtime, "Shoulder", base_pivot, base_yaw)
elbow = make_empty(runtime, "Elbow", elbow_pivot, shoulder)
head_pitch = make_empty(runtime, "HeadPitch", head_pivot, elbow)
head_yaw = make_empty(runtime, "HeadYaw", head_pivot, head_pitch)

body = source_scene.objects["Circle.002"]
pins = source_scene.objects["goupilles"]
bulb = source_scene.objects["ampoule"]

body_map = {
    "pied_skin": ("Base", pearl_blue, lamp_root),
    "roll_genou": ("BaseSocket", accent, shoulder),
    "plaque_inf": ("LowerJointPlate", accent, shoulder),
    "bras_inf_av": ("LowerArmFront", graphite, shoulder),
    "plaque_inter": ("ElbowPlate", accent, elbow),
    "bras_sup_av": ("UpperArmFront", graphite, elbow),
    "plaque_sup_main": ("HeadJointPlate", accent, elbow),
    "cou": ("NeckCore", graphite, head_pitch),
    "tete": ("Lamp_lamp_head", pearl_blue, head_yaw),
}
for group_name, (name, mat, parent) in body_map.items():
    make_group_piece(runtime, body, group_name, name, mat, parent)

pin_parent = {
    "plaque_inf": shoulder,
    "bras_inf_av": shoulder,
    "bras_inf_ar": shoulder,
    "plaque_inter": elbow,
    "bras_sup_av": elbow,
    "bras_sup_ar": elbow,
    "plaque_sup_main": elbow,
}
for group_name, parent in pin_parent.items():
    make_group_piece(
        runtime,
        pins,
        group_name,
        f"Hardware_{group_name}",
        steel,
        parent,
        add_bevel=True,
    )

make_group_piece(runtime, bulb, "tete", "LampBulb", bulb_off, head_yaw)

for index, source_name in enumerate(("Spiral.001", "Spiral.002", "Spiral.003", "Spiral.004"), 1):
    parent = elbow if index <= 2 else shoulder
    make_curve_mesh(runtime, source_scene.objects[source_name], f"Spring_{index}", steel, parent)

# A visible, coaxial neck assembly closes the gap under every head rotation.
make_cylinder(runtime, "NeckAxle", head_pivot, 0.0125, 0.082, steel, elbow, along_x=True)
make_cylinder(
    runtime,
    "NeckCollarArm",
    head_pivot + Vector((0.035, 0.0, 0.0)),
    0.0175,
    0.009,
    accent,
    elbow,
    along_x=True,
)
make_cylinder(
    runtime,
    "NeckCollarHead",
    head_pivot + Vector((-0.035, 0.0, 0.0)),
    0.0175,
    0.009,
    accent,
    head_pitch,
    along_x=True,
)

# A clean browless face uses layered eye geometry for expression: a graphite
# rim, warm sclera, deep teal iris, black pupil, and small amber catchlight.
make_face_plate(runtime, porcelain, head_yaw)
for side, x in (("Left", -0.034), ("Right", 0.034)):
    eye = make_ellipsoid(
        runtime,
        f"Eye{side}",
        (x, -0.1435, 0.385),
        (0.0325, 0.0065, 0.0245),
        eye_rim,
        head_yaw,
    )
    make_ellipsoid(
        runtime,
        f"Sclera{side}",
        (x, -0.148, 0.385),
        (0.0295, 0.0055, 0.0215),
        eye_white,
        eye,
    )
    pupil = make_ellipsoid(
        runtime,
        f"Pupil{side}",
        (x, -0.153, 0.384),
        (0.013, 0.0038, 0.013),
        iris,
        head_yaw,
    )
    make_ellipsoid(
        runtime,
        f"PupilCore{side}",
        (x, -0.156, 0.384),
        (0.0067, 0.0024, 0.0067),
        pupil_core,
        pupil,
    )
    make_ellipsoid(
        runtime,
        f"Catchlight{side}",
        (x - 0.0042, -0.158, 0.389),
        (0.0028, 0.0015, 0.0028),
        catchlight,
        pupil,
    )

# Four low-profile contact pads keep the base grounded without wheels.
for index, (x, y) in enumerate(((-0.071, -0.071), (0.071, -0.071), (-0.071, 0.071), (0.071, 0.071)), 1):
    make_cylinder(
        runtime,
        f"RubberFoot_{index}",
        Vector((x, y, -0.004)),
        0.019,
        0.008,
        rubber,
        lamp_root,
    )

# Match the existing web character's authored scale while retaining a clean
# meter-like asset size for floor and hop calculations.
lamp_root.scale = (1.85, 1.85, 1.85)

# Neutral preview setup; the actual in-app lamp bulb remains fully off.
runtime.world = bpy.data.worlds.new("Luxo Runtime World")
runtime.world.color = (0.012, 0.018, 0.024)
runtime.render.engine = "BLENDER_WORKBENCH"
runtime.display.shading.light = "STUDIO"
runtime.display.shading.color_type = "MATERIAL"
runtime.display.shading.show_shadows = True
runtime.display.shading.show_cavity = True
runtime.display.shading.cavity_type = "WORLD"
runtime.display.shading.show_specular_highlight = True
runtime.render.resolution_x = 800
runtime.render.resolution_y = 800
runtime.render.resolution_percentage = 100
runtime.render.image_settings.file_format = "PNG"
runtime.render.filepath = PREVIEW_PATH

camera_data = bpy.data.cameras.new("QA_Camera")
camera = bpy.data.objects.new("QA_Camera", camera_data)
runtime.collection.objects.link(camera)
camera.location = (0.82, -1.52, 0.88)
camera.data.lens = 58
look_at(camera, Vector((0.0, 0.0, 0.43)))
runtime.camera = camera

bpy.context.window.scene = runtime
bpy.ops.render.render(write_still=True)

# Preview GLB: cameras/lights are disabled and the active runtime scene is the
# only exported scene.  The source and legacy scenes are never overwritten.
bpy.ops.export_scene.gltf(
    filepath=GLB_PATH,
    export_format="GLB",
    export_animations=False,
    export_skins=False,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    use_active_scene=True,
    export_apply=True,
    export_copyright=(
        "Luxo Jr. Rig by aiden915, credited to pistiwique, CC BY 4.0; "
        "browless facial and material refinements by the project author"
    ),
)

print(
    "LUXO_RUNTIME_BUILT",
    {
        "scene": runtime.name,
        "objects": len(runtime.objects),
        "preview": PREVIEW_PATH,
        "glb": GLB_PATH,
        "glb_bytes": os.path.getsize(GLB_PATH),
        "required_names": {name: bool(runtime.objects.get(name)) for name in REQUIRED_NAMES},
    },
)
