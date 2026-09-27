import bpy
from pathlib import Path


OUTPUT_PATH = Path("C:/Users/husse/Desktop/Work/Dune/public/models/desert-terrain.glb")
TEMP_COLLECTION_NAME = "__WEB_TERRAIN_EXPORT__"
UV_NAME = "SandWorldUV"
UV_METERS_PER_REPEAT = 18.0
# The reference desert was authored around this pyramid base. The pyramid is
# delivered as a standalone GLB rooted at (0, 0, 0), so terrain must be rebased
# by the same anchor to preserve the Blender composition on the website.
PYRAMID_ANCHOR = (0.0, 42.0, 1.1447181701660156)

# Export only the authored desert surface. The pyramid and decorative rocks
# remain separate website assets and must never be folded into this GLB.
SOURCE_NAMES = (
    "WEBREF_Terrain",
    "WEBREF_MidRidge_A",
    "WEBREF_MidRidge_B",
    "WEBREF_HorizonRidge",
    "WEBREF_BackRidge_C",
    "WEBREF_BackRidge_D",
    "WEBREF_BackRidge_E_BIG",
    "WEBREF_BackRidge_F",
    "WEBREF_TransitionDunes",
)


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def remove_temp_collection():
    collection = bpy.data.collections.get(TEMP_COLLECTION_NAME)
    if not collection:
        return
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def add_world_planar_uv(obj):
    """Generate stable X/Y planar UVs without embedding any texture data."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.get(UV_NAME) or mesh.uv_layers.new(name=UV_NAME)
    uv_layer.active_render = True
    mesh.uv_layers.active = uv_layer
    world_matrix = obj.matrix_world
    for loop in mesh.loops:
        position = world_matrix @ mesh.vertices[loop.vertex_index].co
        uv_layer.data[loop.index].uv = (
            position.x / UV_METERS_PER_REPEAT,
            position.y / UV_METERS_PER_REPEAT,
        )


OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
source_objects = [bpy.data.objects.get(name) for name in SOURCE_NAMES]
missing = [name for name, obj in zip(SOURCE_NAMES, source_objects) if obj is None]
if missing:
    raise RuntimeError(f"Missing terrain source objects: {', '.join(missing)}")
if any(obj.type != "MESH" for obj in source_objects):
    raise RuntimeError("Every terrain export source must be a mesh")

remove_temp_collection()
temp_collection = bpy.data.collections.new(TEMP_COLLECTION_NAME)
bpy.context.scene.collection.children.link(temp_collection)
export_objects = []
depsgraph = bpy.context.evaluated_depsgraph_get()

try:
    for source in source_objects:
        # Evaluate onto a temporary copy so all current dune/valley modifiers
        # are baked while the editable Blender source remains untouched.
        obj = source.copy()
        obj.data = source.data.copy()
        obj.name = source.name.removeprefix("WEBREF_")
        temp_collection.objects.link(obj)
        select_only([obj])
        bpy.context.view_layer.update()

        evaluated = obj.evaluated_get(depsgraph)
        source_mesh = obj.data
        obj.data = bpy.data.meshes.new_from_object(
            evaluated,
            depsgraph=depsgraph,
            preserve_all_data_layers=True,
        )
        if source_mesh.users == 0:
            bpy.data.meshes.remove(source_mesh)
        obj.modifiers.clear()

        # The website owns the material. Keep UVs and normals only; strip every
        # Blender material slot so no image or shader payload enters the GLB.
        obj.data.materials.clear()
        add_world_planar_uv(obj)
        obj.location.x -= PYRAMID_ANCHOR[0]
        obj.location.y -= PYRAMID_ANCHOR[1]
        obj.location.z -= PYRAMID_ANCHOR[2]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

        triangulate = obj.modifiers.new("Web Triangulation", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        export_objects.append(obj)

    select_only(export_objects)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )

    print(f"WEB_EXPORT={OUTPUT_PATH}")
    print(f"WEB_EXPORT_BYTES={OUTPUT_PATH.stat().st_size}")
    print(f"WEB_OBJECTS={len(export_objects)}")
    print(f"WEB_VERTICES={sum(len(obj.data.vertices) for obj in export_objects)}")
    print(f"WEB_TRIANGLES={sum(len(obj.data.polygons) for obj in export_objects)}")
    print("WEB_MATERIALS=0")
finally:
    remove_temp_collection()
