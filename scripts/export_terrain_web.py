import bpy
from pathlib import Path


OUTPUT_PATH = Path("C:/Users/husse/Desktop/Work/Dune/public/models/desert-terrain.glb")
TEXTURE_DIR = Path("C:/Users/husse/Desktop/Work/Dune/assets/terrain-textures")
SOURCE_DIR = Path("C:/Users/husse/Desktop/Blender/GroundSand005")
BASE_COLOR_PATH = TEXTURE_DIR / "ground-sand-basecolor-ao.jpg"
ROUGHNESS_PATH = TEXTURE_DIR / "ground-sand-roughness.jpg"
NORMAL_PATH = SOURCE_DIR / "GroundSand005_NRM_1K.jpg"
TEMP_COLLECTION_NAME = "__WEB_TERRAIN_EXPORT__"
UV_NAME = "GroundSand_WorldUV"


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def load_image(filename, color_space):
    image = bpy.data.images.load(str(SOURCE_DIR / filename), check_existing=True)
    image.colorspace_settings.name = color_space
    return image


def write_derived_textures():
    color = load_image("GroundSand005_COL_1K.jpg", "sRGB")
    ao = load_image("GroundSand005_AO_1K.jpg", "Non-Color")
    gloss = load_image("GroundSand005_GLOSS_1K.jpg", "Non-Color")
    if color.size[:] != ao.size[:] or color.size[:] != gloss.size[:]:
        raise RuntimeError("GroundSand005 color, AO, and gloss maps must have matching sizes")

    width, height = color.size[:]
    color_pixels = list(color.pixels)
    ao_pixels = list(ao.pixels)
    gloss_pixels = list(gloss.pixels)
    base_pixels = [0.0] * len(color_pixels)
    roughness_pixels = [0.0] * len(gloss_pixels)

    # Bake AO into base color to avoid a fourth web texture lookup. Keeping
    # 35% of the unoccluded color prevents the sand from becoming too dark.
    for index in range(0, len(color_pixels), 4):
        ao_factor = 0.35 + 0.65 * ao_pixels[index]
        base_pixels[index] = color_pixels[index] * ao_factor
        base_pixels[index + 1] = color_pixels[index + 1] * ao_factor
        base_pixels[index + 2] = color_pixels[index + 2] * ao_factor
        base_pixels[index + 3] = 1.0

        # Convert gloss to glTF roughness and keep it in the authored matte range.
        roughness = 0.88 - 0.32 * gloss_pixels[index]
        roughness_pixels[index:index + 4] = (roughness, roughness, roughness, 1.0)

    base = bpy.data.images.new("Ground Sand Base Color + AO", width, height, alpha=False)
    base.colorspace_settings.name = "sRGB"
    base.pixels.foreach_set(base_pixels)
    base.filepath_raw = str(BASE_COLOR_PATH)
    base.file_format = "JPEG"
    base.save()

    roughness = bpy.data.images.new("Ground Sand Roughness", width, height, alpha=False)
    roughness.colorspace_settings.name = "Non-Color"
    roughness.pixels.foreach_set(roughness_pixels)
    roughness.filepath_raw = str(ROUGHNESS_PATH)
    roughness.file_format = "JPEG"
    roughness.save()
    return base, roughness


def build_export_material(base_color, roughness):
    material = bpy.data.materials.new("WEB_GroundSand005_PBR")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (720, 0)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (440, 0)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["IOR"].default_value = 1.45
    specular = principled.inputs.get("Specular IOR Level") or principled.inputs.get("Specular")
    if specular:
        specular.default_value = 0.35
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = UV_NAME
    uv.location = (-700, 0)

    base_texture = nodes.new("ShaderNodeTexImage")
    base_texture.image = base_color
    base_texture.extension = "REPEAT"
    base_texture.location = (-420, 220)
    links.new(uv.outputs["UV"], base_texture.inputs["Vector"])
    links.new(base_texture.outputs["Color"], principled.inputs["Base Color"])

    roughness_texture = nodes.new("ShaderNodeTexImage")
    roughness_texture.image = roughness
    roughness_texture.extension = "REPEAT"
    roughness_texture.location = (-420, 0)
    links.new(uv.outputs["UV"], roughness_texture.inputs["Vector"])
    links.new(roughness_texture.outputs["Color"], principled.inputs["Roughness"])

    normal_image = bpy.data.images.load(str(NORMAL_PATH), check_existing=True)
    normal_image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = normal_image
    normal_texture.extension = "REPEAT"
    normal_texture.location = (-420, -240)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.55
    normal_map.location = (0, -220)
    links.new(uv.outputs["UV"], normal_texture.inputs["Vector"])
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    return material


def remove_temp_collection():
    collection = bpy.data.collections.get(TEMP_COLLECTION_NAME)
    if not collection:
        return
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
for required in (
    SOURCE_DIR / "GroundSand005_COL_1K.jpg",
    SOURCE_DIR / "GroundSand005_AO_1K.jpg",
    SOURCE_DIR / "GroundSand005_GLOSS_1K.jpg",
    NORMAL_PATH,
):
    if not required.exists():
        raise RuntimeError(f"Required GroundSand005 map is missing: {required}")

source_names = (
    "Background Dune Left",
    "Background Dune Right",
    "Background Far Ridge",
    "Desert Base Terrain",
    "Distant Horizon Dune",
)
source_objects = [bpy.data.objects.get(name) for name in source_names]
source_objects = [obj for obj in source_objects if obj and obj.type == "MESH"]
if len(source_objects) != 5:
    raise RuntimeError(f"Expected five authored terrain meshes, found {len(source_objects)}")

remove_temp_collection()
temp_collection = bpy.data.collections.new(TEMP_COLLECTION_NAME)
bpy.context.scene.collection.children.link(temp_collection)
export_objects = []
depsgraph = bpy.context.evaluated_depsgraph_get()

try:
    base_color, roughness = write_derived_textures()
    material = build_export_material(base_color, roughness)

    for source in source_objects:
        obj = source.copy()
        obj.data = source.data.copy()
        obj.name = source.name
        temp_collection.objects.link(obj)
        export_objects.append(obj)
        select_only([obj])

        # Remove authoring-only smoothing, then bake the current shape-key mix
        # while the copy is linked to a visible collection. Hidden WEB_ copies
        # are intentionally not used because Blender skips their evaluation.
        for modifier in list(obj.modifiers):
            obj.modifiers.remove(modifier)
        bpy.context.view_layer.update()
        evaluated = obj.evaluated_get(depsgraph)
        source_mesh = obj.data
        obj.data = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
        if source_mesh.users == 0:
            bpy.data.meshes.remove(source_mesh)

        if UV_NAME not in obj.data.uv_layers:
            raise RuntimeError(f"{source.name} is missing the authored {UV_NAME} layer")
        obj.data.uv_layers.active = obj.data.uv_layers[UV_NAME]
        obj.data.uv_layers[UV_NAME].active_render = True

        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        decimate = obj.modifiers.new("Web Terrain Reduction", "DECIMATE")
        decimate.ratio = 0.40 if "Desert Base" in obj.name else 0.35
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        triangulate = obj.modifiers.new("Web Triangulation", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=triangulate.name)

        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.data.materials.clear()
        obj.data.materials.append(material)

    select_only(export_objects)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )

    print(f"WEB_EXPORT={OUTPUT_PATH}")
    print(f"WEB_EXPORT_BYTES={OUTPUT_PATH.stat().st_size}")
    print(f"WEB_OBJECTS={len(export_objects)}")
    print(f"WEB_VERTICES={sum(len(obj.data.vertices) for obj in export_objects)}")
    print(f"WEB_TRIANGLES={sum(len(obj.data.polygons) for obj in export_objects)}")
finally:
    remove_temp_collection()
