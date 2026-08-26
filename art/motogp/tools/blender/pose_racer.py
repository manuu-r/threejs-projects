"""Bake the supplied rigged racer into a static MotoGP riding tuck.

The source GLB retains its Mixamo rig and animation in art/motogp. The runtime
copy is deliberately static: it is smaller, cheaper, and cannot fall back to a
T-pose when the browser updates its skeleton matrices.
"""

import os

import bpy


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
SOURCE = os.path.join(PROJECT_ROOT, "art/motogp/racer_bikecar.glb")
ART_OUTPUT = os.path.join(PROJECT_ROOT, "art/motogp/racer-posed.glb")
PUBLIC_OUTPUT = os.path.join(PROJECT_ROOT, "public/motogp/racer-posed.glb")

POSE = {
    "mixamorig6:Hips_01": (0.16, 0, 0),
    "mixamorig6:Spine_02": (0.24, 0, 0),
    "mixamorig6:Spine1_03": (0.25, 0, 0),
    "mixamorig6:Spine2_04": (0.2, 0, 0),
    "mixamorig6:Neck_05": (-0.42, 0, 0),
    "mixamorig6:Head_06": (-0.22, 0, 0),
    "mixamorig6:LeftArm_09": (0.18, -0.55, 1.02),
    "mixamorig6:RightArm_033": (0.18, -0.55, -1.02),
    "mixamorig6:LeftForeArm_010": (0.08, -0.7, 0.18),
    "mixamorig6:RightForeArm_034": (0.08, -0.7, -0.18),
    "mixamorig6:LeftHand_011": (0, -0.15, 0.1),
    "mixamorig6:RightHand_035": (0, 0.15, -0.1),
    "mixamorig6:LeftUpLeg_056": (-1.0, 0.08, 0.18),
    "mixamorig6:RightUpLeg_00": (-1.0, -0.08, -0.18),
    "mixamorig6:LeftLeg_057": (1.55, 0, 0),
    "mixamorig6:RightLeg_061": (1.55, 0, 0),
    "mixamorig6:LeftFoot_058": (-0.52, 0, 0),
    "mixamorig6:RightFoot_062": (-0.52, 0, 0),
}


def reset_scene():
    for datablocks in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.armatures,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def export_selected(mesh, output):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_animations=False,
        use_selection=True,
    )
    print(f"[export] {output} ({os.path.getsize(output) / 1024:.1f} KiB)")


def main():
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")

    if armature.animation_data:
        armature.animation_data.action = None
        for track in armature.animation_data.nla_tracks:
            track.mute = True
    for name, rotation in POSE.items():
        bone = armature.pose.bones.get(name)
        if bone is None:
            continue
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = rotation
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    for modifier in list(mesh.modifiers):
        if modifier.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    world_matrix = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = world_matrix
    mesh.name = "MarcMarquez93_Rider"
    export_selected(mesh, ART_OUTPUT)
    export_selected(mesh, PUBLIC_OUTPUT)


if __name__ == "__main__":
    main()
