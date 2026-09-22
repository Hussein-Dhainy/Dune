import bpy
from mathutils import Vector
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
GLB_PATH = PROJECT_DIR / "public" / "models" / "pyramid.glb"
REBUILD_COLLECTION = "Pyramid_Rebuild"
SOURCE_COLLECTION = "Pyramid_Rebuild_Sources"
BACKING_COLLECTION = "Pyramid_Rebuild_Joint_Backing"


def descendants(collection):
    yield collection
    for child in collection.children:
        yield from descendants(child)


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
rebuild = bpy.data.collections.get(REBUILD_COLLECTION)
if rebuild is None:
    raise RuntimeError(f"Missing Blender collection: {REBUILD_COLLECTION}")

# Export only the rebuilt pyramid blocks. Authoring sources, the internal joint
# backing, lights, controllers, the legacy pyramid, and archive copies stay in
# the .blend file only.
export_collections = [
    collection
    for collection in descendants(rebuild)
    if collection.name not in {SOURCE_COLLECTION, BACKING_COLLECTION}
]
source_blocks = sorted(
    {
        obj
        for collection in export_collections
        for obj in collection.objects
        if obj.type == "MESH" and obj.name.startswith("PYR_")
    },
    key=lambda obj: obj.name,
)
if len(source_blocks) != 146:
    raise RuntimeError(f"Expected 146 rebuilt pyramid blocks, got {len(source_blocks)}")

# Work on temporary object copies so exporting never changes the authored
# scene. The copies retain linked mesh datablocks, allowing glTF to reuse the
# seven block geometries across all 146 independently animated nodes.
temporary = bpy.data.collections.new("__Pyramid_Web_Export__")
scene.collection.children.link(temporary)
export_blocks = []
for source in source_blocks:
    block = source.copy()
    block.data = source.data
    block.animation_data_clear()
    block.hide_viewport = False
    block.hide_render = False
    block.matrix_world = source.matrix_world.copy()
    temporary.objects.link(block)
    export_blocks.append(block)

bpy.context.view_layer.update()
points = [
    block.matrix_world @ Vector(corner)
    for block in export_blocks
    for corner in block.bound_box
]
minimum = Vector([min(point[axis] for point in points) for axis in range(3)])
maximum = Vector([max(point[axis] for point in points) for axis in range(3)])
offset = Vector((
    -(minimum.x + maximum.x) * 0.5,
    -(minimum.y + maximum.y) * 0.5,
    -minimum.z,
))
for block in export_blocks:
    block.matrix_world.translation += offset
bpy.context.view_layer.update()

# UVs and normals are retained for future Three.js materials. Blender
# materials and image textures are intentionally excluded from this GLB.
select_only(export_blocks)
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_materials="NONE",
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    export_extras=False,
    export_yup=True,
)

final_points = [
    block.matrix_world @ Vector(corner)
    for block in export_blocks
    for corner in block.bound_box
]
final_minimum = [min(point[axis] for point in final_points) for axis in range(3)]
final_maximum = [max(point[axis] for point in final_points) for axis in range(3)]
unique_meshes = {block.data.name for block in export_blocks}

print(f"WEB_EXPORT={GLB_PATH}")
print(f"WEB_EXPORT_BYTES={GLB_PATH.stat().st_size}")
print(f"WEB_BLOCK_OBJECTS={len(export_blocks)}")
print(f"WEB_UNIQUE_MESHES={len(unique_meshes)}")
print(f"WEB_UNIQUE_VERTICES={sum(len(bpy.data.meshes[name].vertices) for name in unique_meshes)}")
print(f"WEB_UNIQUE_POLYGONS={sum(len(bpy.data.meshes[name].polygons) for name in unique_meshes)}")
print(f"WEB_BOUNDS={final_minimum}|{final_maximum}")
