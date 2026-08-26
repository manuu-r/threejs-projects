"""Extract the playable GP loop and placement metadata from the supplied track.

Blender is the source of truth for the visible road, elevation, racing line,
crowd zones and advertising sockets. Three.js consumes the original GLB plus
the JSON generated here; it does not invent a second procedural circuit.
"""

import json
import math
import os
from collections import deque

import bpy
import numpy as np
from mathutils import Vector


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
SOURCE = os.path.join(PROJECT_ROOT, "art/motogp/nurburgring_gp_2016_layout.glb")
OUTPUT = os.path.join(PROJECT_ROOT, "public/motogp/track-collision.json")
PREVIEW = os.path.join(PROJECT_ROOT, "art/motogp/nurburgring-road-mask.png")
ROAD_OBJECT = "Object_24"
RESOLUTION = 3072
SAMPLE_SPACING_M = 4.0
ROAD_HALF_WIDTH_M = 5.8
BARRIER_OFFSET_M = 8.0


def reset_scene():
    for datablocks in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def skeletonize(image):
    image = image.copy()
    changed = True
    while changed:
        changed = False
        for phase in (0, 1):
            p2 = np.roll(image, 1, 0)
            p3 = np.roll(p2, -1, 1)
            p4 = np.roll(image, -1, 1)
            p5 = np.roll(p4, -1, 0)
            p6 = np.roll(image, -1, 0)
            p7 = np.roll(p6, 1, 1)
            p8 = np.roll(image, 1, 1)
            p9 = np.roll(p8, 1, 0)
            neighbors = sum(p.astype(np.uint8) for p in (p2, p3, p4, p5, p6, p7, p8, p9))
            transitions = sum(
                p.astype(np.uint8)
                for p in (
                    (~p2 & p3), (~p3 & p4), (~p4 & p5), (~p5 & p6),
                    (~p6 & p7), (~p7 & p8), (~p8 & p9), (~p9 & p2),
                )
            )
            if phase == 0:
                remove = image & (neighbors >= 2) & (neighbors <= 6) & (transitions == 1) & ~(p2 & p4 & p6) & ~(p4 & p6 & p8)
            else:
                remove = image & (neighbors >= 2) & (neighbors <= 6) & (transitions == 1) & ~(p2 & p4 & p8) & ~(p2 & p6 & p8)
            remove[[0, -1], :] = False
            remove[:, [0, -1]] = False
            if remove.any():
                image[remove] = False
                changed = True
    return image


PIXEL_DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def neighbors(pixel, graph):
    y, x = pixel
    result = []
    for dy, dx in PIXEL_DIRS:
        candidate = (y + dy, x + dx)
        if candidate not in graph:
            continue
        if dy and dx and ((y + dy, x) in graph or (y, x + dx) in graph):
            continue
        result.append(candidate)
    return result


def largest_component(graph):
    unseen = set(graph)
    components = []
    while unseen:
        seed = unseen.pop()
        component = {seed}
        stack = [seed]
        while stack:
            pixel = stack.pop()
            for adjacent in neighbors(pixel, unseen):
                unseen.remove(adjacent)
                component.add(adjacent)
                stack.append(adjacent)
        components.append(component)
    return max(components, key=len)


def strip_dead_ends(graph):
    graph = set(graph)
    queue = deque(pixel for pixel in graph if len(neighbors(pixel, graph)) < 2)
    while queue:
        pixel = queue.popleft()
        if pixel not in graph:
            continue
        adjacent = neighbors(pixel, graph)
        graph.remove(pixel)
        for item in adjacent:
            if len(neighbors(item, graph)) < 2:
                queue.append(item)
    return graph


def cycle_basis(graph):
    cycles = []
    remaining = set(graph)
    while remaining:
        root = next(iter(remaining))
        stack = [(root, iter(neighbors(root, graph)))]
        predecessor = {root: root}
        used = {root: set()}
        while stack:
            parent, children = stack[-1]
            try:
                child = next(children)
            except StopIteration:
                stack.pop()
                remaining.discard(parent)
                continue
            if child not in used:
                predecessor[child] = parent
                stack.append((child, iter(neighbors(child, graph))))
                used[child] = {parent}
            elif child == predecessor[parent]:
                continue
            elif child not in used[parent]:
                cycle = [child, parent]
                cursor = predecessor[parent]
                while cursor not in used[child]:
                    cycle.append(cursor)
                    cursor = predecessor[cursor]
                cycle.append(cursor)
                cycles.append(cycle)
                used[child].add(parent)
            used[parent].add(child)
    return cycles


def circular_smooth(points, radius=7):
    result = []
    count = len(points)
    for index in range(count):
        window = [points[(index + offset) % count] for offset in range(-radius, radius + 1)]
        result.append((sum(p[0] for p in window) / len(window), sum(p[1] for p in window) / len(window)))
    return result


def resample_closed(points, spacing):
    points = list(points) + [points[0]]
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = lengths[-1]
    count = max(8, round(total / spacing))
    result = []
    segment = 0
    for index in range(count):
        distance = total * index / count
        while segment + 1 < len(lengths) and lengths[segment + 1] < distance:
            segment += 1
        a, b = points[segment], points[segment + 1]
        span = max(lengths[segment + 1] - lengths[segment], 1e-9)
        alpha = (distance - lengths[segment]) / span
        result.append((a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha))
    return result, total / count


def render_road_mask(road, meshes):
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    center = (low + high) * 0.5
    span = max(high.x - low.x, high.y - low.y) * 1.03
    for obj in meshes:
        obj.hide_render = obj != road
    mask_material = bpy.data.materials.new("road_mask")
    mask_material.diffuse_color = (1, 1, 1, 1)
    road.data.materials.clear()
    road.data.materials.append(mask_material)
    bpy.ops.object.camera_add(location=(center.x, center.y, high.z + span))
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = span
    camera.data.clip_end = span * 4
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.render.film_transparent = True
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    rendered = bpy.data.images.load(PREVIEW, check_existing=False)
    pixels = np.array(rendered.pixels[:], dtype=np.float32).reshape(RESOLUTION, RESOLUTION, 4)
    return pixels[:, :, 3] > 0.5, center, span


def main():
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    road = bpy.data.objects[ROAD_OBJECT]
    # Preserve the real material before the mask pass replaces it.
    mask, center, span = render_road_mask(road, meshes)
    skeleton = skeletonize(mask)
    graph = strip_dead_ends(largest_component(set(map(tuple, np.argwhere(skeleton)))))
    cycles = sorted(cycle_basis(graph), key=len, reverse=True)
    if len(cycles) < 2:
        raise RuntimeError("Could not isolate the Nürburgring GP loop")
    for cycle_index, cycle in enumerate(cycles[:12]):
        cycle_points = [(pixel[1], pixel[0]) for pixel in cycle]
        cycle_world = [
            (
                center.x + (x / RESOLUTION - 0.5) * span,
                center.y + (y / RESOLUTION - 0.5) * span,
            )
            for x, y in cycle_points
        ]
        cycle_length = sum(
            math.hypot(b[0] - a[0], b[1] - a[1])
            for a, b in zip(cycle_world, cycle_world[1:] + cycle_world[:1])
        )
        xs = [p[0] for p in cycle_world]
        ys = [p[1] for p in cycle_world]
        print(
            f"[cycle {cycle_index}] pixels={len(cycle)} length={cycle_length:.1f}m "
            f"bounds=({min(xs):.1f},{min(ys):.1f})..({max(xs):.1f},{max(ys):.1f})"
        )
    # This asset is the GP-layout venue: its largest closed asphalt cycle is
    # the complete race circuit. Smaller cycles are pit/service/sprint links.
    gp_cycle = cycles[0]
    pixel_points = circular_smooth([(pixel[1], pixel[0]) for pixel in gp_cycle])
    world_xy = [
        (
            center.x + (x / RESOLUTION - 0.5) * span,
            center.y + (y / RESOLUTION - 0.5) * span,
        )
        for x, y in pixel_points
    ]
    world_xy, actual_spacing = resample_closed(world_xy, SAMPLE_SPACING_M)

    inverse = road.matrix_world.inverted()
    world_points = []
    for x, y in world_xy:
        success, location, _normal, _index = road.closest_point_on_mesh(inverse @ Vector((x, y, 500)), distance=1000)
        if not success:
            raise RuntimeError(f"Road height lookup failed at {x}, {y}")
        point = road.matrix_world @ location
        # Blender Z-up -> glTF/Three Y-up. The exporter convention maps
        # Blender +Y to game -Z.
        world_points.append((point.x, point.z + 0.04, -point.y))

    samples = []
    count = len(world_points)
    for index, point in enumerate(world_points):
        before = world_points[(index - 2) % count]
        after = world_points[(index + 2) % count]
        tx, tz = after[0] - before[0], after[2] - before[2]
        length = math.hypot(tx, tz) or 1
        tx, tz = tx / length, tz / length
        samples.append({
            "p": [round(point[0], 4), round(point[1], 4), round(point[2], 4)],
            "t": [round(tx, 6), 0, round(tz, 6)],
            "n": [round(tz, 6), 0, round(-tx, 6)],
            "hw": ROAD_HALF_WIDTH_M,
            "bl": BARRIER_OFFSET_M,
            "br": BARRIER_OFFSET_M,
            "curbL": True,
            "curbR": True,
        })

    # Pick a straight grid section by finding the flattest tangent window.
    start_index = max(
        range(count),
        key=lambda index: (
            samples[(index - 10) % count]["t"][0] * samples[(index + 10) % count]["t"][0]
            + samples[(index - 10) % count]["t"][2] * samples[(index + 10) % count]["t"][2]
        ),
    )
    ad_sockets = []
    crowd_zones = []
    for index in range(0, count, 16):
        sample = samples[index]
        side = 1 if (index // 16) % 2 == 0 else -1
        offset = side * (BARRIER_OFFSET_M + 1.3)
        ad_sockets.append({
            "p": [
                round(sample["p"][0] + sample["n"][0] * offset, 4),
                round(sample["p"][1] + 1.15, 4),
                round(sample["p"][2] + sample["n"][2] * offset, 4),
            ],
            "yaw": round(math.atan2(sample["t"][0], sample["t"][2]), 6),
            "side": side,
            "slot": (index // 16) % 3,
        })
    for index in range(0, count, 10):
        sample = samples[index]
        for side in (-1, 1):
            offset = side * (BARRIER_OFFSET_M + 4.5)
            crowd_zones.append({
                "p": [
                    round(sample["p"][0] + sample["n"][0] * offset, 4),
                    round(sample["p"][1], 4),
                    round(sample["p"][2] + sample["n"][2] * offset, 4),
                ],
                "yaw": round(math.atan2(sample["t"][0], sample["t"][2]), 6),
                "side": side,
                "count": 4,
            })

    output = {
        "version": 1,
        "name": "Nürburgring GP 2016",
        "spacing": round(actual_spacing, 5),
        "checkpoints": 8,
        "startSampleIndex": start_index,
        "samples": samples,
        "placements": {"adSockets": ad_sockets, "crowdZones": crowd_zones},
        "source": {"model": "nurburgring_gp_2016_layout.glb", "roadObject": ROAD_OBJECT},
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(output, handle, separators=(",", ":"))
    print(f"[track] {OUTPUT}: {count} samples, {count * actual_spacing:.0f} m GP loop")


if __name__ == "__main__":
    main()
