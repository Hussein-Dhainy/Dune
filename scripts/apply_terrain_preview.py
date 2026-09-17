import bpy
from pathlib import Path


TEXTURE_DIR = Path("C:/Users/husse/Desktop/Work/Dune/assets/terrain-textures")
NORMAL_PATH = TEXTURE_DIR / "ground-sand-normal.jpg"
ROUGHNESS_PATH = TEXTURE_DIR / "ground-sand-roughness.png"
PREVIEW_COLLECTION = "WEB_TEXTURE_PREVIEW"


def activate_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


if not NORMAL_PATH.exists() or not ROUGHNESS_PATH.exists():
    raise RuntimeError("Prepared GroundSand005 texture maps are missing")

# Rerunning the preview is safe: replace only the collection created here.
existing = bpy.data.collections.get(PREVIEW_COLLECTION)
if existing:
    for obj in list(existing.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(existing)

preview_collection = bpy.data.collections.new(PREVIEW_COLLECTION)
bpy.context.scene.collection.children.link(preview_collection)

source_objects = sorted(
    [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("WEB_")],
    key=lambda obj: obj.name,
)
if len(source_objects) != 5:
    raise RuntimeError(f"Expected five WEB_ terrain meshes, found {len(source_objects)}")

preview_objects = []
for source in source_objects:
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = source.name.removeprefix("WEB_") + " Preview"
    preview_collection.objects.link(obj)
    obj.hide_render = False
    activate_only(obj)

    smooth = obj.modifiers.new("Remove Geometric Sand Ripples", "SMOOTH")
    smooth.factor = 0.55
    smooth.iterations = 8 if "Desert Base" in obj.name else 6
    smooth.use_x = False
    smooth.use_y = False
    smooth.use_z = True
    if "Desert Base" in obj.name:
        influence = obj.vertex_groups.new(name="Preserve Pyramid Basin")
        for vertex in obj.data.vertices:
            radius = (vertex.co.x ** 2 + vertex.co.y ** 2) ** 0.5
            weight = max(0.0, min(1.0, (radius - 5.0) / 6.0))
            influence.add([vertex.index], weight, "REPLACE")
        smooth.vertex_group = influence.name
    bpy.ops.object.modifier_apply(modifier=smooth.name)

    decimate = obj.modifiers.new("Web Terrain Reduction", "DECIMATE")
    decimate.ratio = 0.5 if "Desert Base" in obj.name else 0.35
    bpy.ops.object.modifier_apply(modifier=decimate.name)

    uv_layer = obj.data.uv_layers.active
    if uv_layer:
        repeats_x = max(1.0, obj.dimensions.x / 3.0)
        repeats_y = max(1.0, obj.dimensions.y / 3.0)
        for value in uv_layer.data:
            value.uv.x *= repeats_x
            value.uv.y *= repeats_y

    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    preview_objects.append(obj)

# Give the preview its own material so the original web/source collections are
# untouched and can be restored simply by toggling collection visibility.
material = source_objects[0].data.materials[0].copy()
material.name = "WEB Sand - GroundSand005 Preview"
nodes = material.node_tree.nodes
links = material.node_tree.links
principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
normal_image = bpy.data.images.load(str(NORMAL_PATH), check_existing=True)
normal_image.colorspace_settings.name = "Non-Color"
roughness_image = bpy.data.images.load(str(ROUGHNESS_PATH), check_existing=True)
roughness_image.colorspace_settings.name = "Non-Color"
normal_texture = nodes.new("ShaderNodeTexImage")
normal_texture.name = "Ground Sand Normal"
normal_texture.image = normal_image
normal_texture.extension = "REPEAT"
normal_map = nodes.new("ShaderNodeNormalMap")
normal_map.inputs["Strength"].default_value = 0.65
roughness_texture = nodes.new("ShaderNodeTexImage")
roughness_texture.name = "Ground Sand Roughness"
roughness_texture.image = roughness_image
roughness_texture.extension = "REPEAT"
links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
links.new(roughness_texture.outputs["Color"], principled.inputs["Roughness"])

for obj in preview_objects:
    obj.data.materials.clear()
    obj.data.materials.append(material)

for name in ("Terrain", "Background", "WEB_OPTIMIZED"):
    collection = bpy.data.collections.get(name)
    if collection:
        collection.hide_viewport = True
        collection.hide_render = True

preview_collection.hide_viewport = False
preview_collection.hide_render = False
activate_only(preview_objects[0])

# Make the result immediately visible in the current Blender workspace.
for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.shading.type = "MATERIAL"

print(f"Created {PREVIEW_COLLECTION} with {len(preview_objects)} terrain objects")
print(f"Preview triangles: {sum(len(obj.data.loop_triangles) for obj in preview_objects)}")

if bpy.context.area:
    bpy.context.area.type = "VIEW_3D"
    bpy.context.area.spaces.active.shading.type = "MATERIAL"
    if bpy.context.scene.camera:
        bpy.context.area.spaces.active.region_3d.view_perspective = "CAMERA"
