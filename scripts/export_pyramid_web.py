import bpy
import bmesh
from pathlib import Path


OUTPUT_DIR = Path("C:/Users/husse/Desktop/Work/Dune/public/models")
TEXTURE_DIR = Path("C:/Users/husse/Desktop/Work/Dune/assets/pyramid-textures")
GLB_PATH = OUTPUT_DIR / "pyramid.glb"
TEXTURE_SIZE = 2048


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def add_bake_target(material, image):
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.name = "Web Bake Target"
    node.image = image
    material.node_tree.nodes.active = node
    node.select = True
    return node


def save_image(image, path):
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TEXTURE_DIR.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
pyramid_parts = sorted([
    obj for obj in scene.objects
    if obj.type == "MESH" and obj.name.startswith("Pyramid_C")
], key=lambda obj: obj.name)
if not pyramid_parts:
    raise RuntimeError("No Pyramid_C mesh objects were found")

# Make the export independent of the source blocks, then apply all object-level
# shading and sizing before combining the pieces into one web draw call.
select_only(pyramid_parts)
bpy.ops.object.make_single_user(object=True, obdata=True, material=False, animation=False)
for obj in pyramid_parts:
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# Preserve block membership through the temporary joined mesh used for atlas
# baking. The mesh is split back into individually animated objects afterward.
block_names = []
for block_id, obj in enumerate(pyramid_parts):
    block_names.append(obj.name)
    attribute = obj.data.attributes.get("block_id") or obj.data.attributes.new(
        name="block_id", type="INT", domain="FACE"
    )
    for value in attribute.data:
        value.value = block_id

select_only(pyramid_parts)
bpy.ops.object.join()
pyramid = bpy.context.object
pyramid.name = "Pyramid"
pyramid.data.name = "Pyramid_Web_Mesh"

# Put the model at a predictable origin: centered in X/Y and standing on Z=0.
xs = [pyramid.matrix_world @ pyramid.data.vertices[index].co for index in range(len(pyramid.data.vertices))]
minimum_x = min(point.x for point in xs)
maximum_x = max(point.x for point in xs)
minimum_y = min(point.y for point in xs)
maximum_y = max(point.y for point in xs)
minimum_z = min(point.z for point in xs)
pyramid.location.x -= (minimum_x + maximum_x) / 2
pyramid.location.y -= (minimum_y + maximum_y) / 2
pyramid.location.z -= minimum_z
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# A single non-overlapping atlas lets the procedural Blender material become
# portable image textures understood by glTF and Three.js.
while pyramid.data.uv_layers:
    pyramid.data.uv_layers.remove(pyramid.data.uv_layers[0])
pyramid.data.uv_layers.new(name="WebUV", do_init=False)
pyramid.data.uv_layers.active_index = len(pyramid.data.uv_layers) - 1
select_only([pyramid])
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.012)
bpy.ops.object.mode_set(mode="OBJECT")

source_material = pyramid.data.materials[0]
pyramid.data.materials.clear()
pyramid.data.materials.append(source_material)
nodes = source_material.node_tree.nodes
links = source_material.node_tree.links
output = next(node for node in nodes if node.type == "OUTPUT_MATERIAL")
principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
surface_link = output.inputs["Surface"].links[0]
surface_source = surface_link.from_socket

scene.render.engine = "CYCLES"
scene.cycles.samples = 8
scene.render.bake.margin = 12
scene.render.bake.use_clear = True

base_color = bpy.data.images.new("Pyramid Base Color", TEXTURE_SIZE, TEXTURE_SIZE, alpha=False)
base_target = add_bake_target(source_material, base_color)
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.use_pass_color = True
bpy.ops.object.bake(type="DIFFUSE")
save_image(base_color, TEXTURE_DIR / "pyramid-base-color.png")
nodes.remove(base_target)

roughness = bpy.data.images.new("Pyramid Roughness", TEXTURE_SIZE, TEXTURE_SIZE, alpha=False)
roughness.colorspace_settings.name = "Non-Color"
roughness_target = add_bake_target(source_material, roughness)
emission = nodes.new("ShaderNodeEmission")
roughness_input = principled.inputs["Roughness"]
if roughness_input.is_linked:
    links.new(roughness_input.links[0].from_socket, emission.inputs["Color"])
else:
    value = roughness_input.default_value
    emission.inputs["Color"].default_value = (value, value, value, 1.0)
links.remove(output.inputs["Surface"].links[0])
links.new(emission.outputs["Emission"], output.inputs["Surface"])
bpy.ops.object.bake(type="EMIT")
save_image(roughness, TEXTURE_DIR / "pyramid-roughness.png")
nodes.remove(roughness_target)
nodes.remove(emission)
links.new(surface_source, output.inputs["Surface"])

normal = bpy.data.images.new("Pyramid Normal", TEXTURE_SIZE, TEXTURE_SIZE, alpha=False)
normal.colorspace_settings.name = "Non-Color"
normal_target = add_bake_target(source_material, normal)
bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
save_image(normal, TEXTURE_DIR / "pyramid-normal.png")
nodes.remove(normal_target)

# Replace the Blender-only procedural graph with a standard PBR graph.
web_material = bpy.data.materials.new("Pyramid Sandstone Web")
web_material.use_nodes = True
web_nodes = web_material.node_tree.nodes
web_links = web_material.node_tree.links
for node in list(web_nodes):
    web_nodes.remove(node)

web_output = web_nodes.new("ShaderNodeOutputMaterial")
web_principled = web_nodes.new("ShaderNodeBsdfPrincipled")
base_node = web_nodes.new("ShaderNodeTexImage")
base_node.image = base_color
roughness_node = web_nodes.new("ShaderNodeTexImage")
roughness_node.image = roughness
roughness_node.image.colorspace_settings.name = "Non-Color"
normal_node = web_nodes.new("ShaderNodeTexImage")
normal_node.image = normal
normal_node.image.colorspace_settings.name = "Non-Color"
normal_map = web_nodes.new("ShaderNodeNormalMap")
normal_map.inputs["Strength"].default_value = 0.75

web_principled.inputs["Metallic"].default_value = 0.0
web_links.new(base_node.outputs["Color"], web_principled.inputs["Base Color"])
web_links.new(roughness_node.outputs["Color"], web_principled.inputs["Roughness"])
web_links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
web_links.new(normal_map.outputs["Normal"], web_principled.inputs["Normal"])
web_links.new(web_principled.outputs["BSDF"], web_output.inputs["Surface"])

pyramid.data.materials.clear()
pyramid.data.materials.append(web_material)

# Split the atlas-baked mesh back into named blocks. Each object receives a
# centered origin so animation rotations and scaling behave naturally.
block_objects = []
combined_mesh = pyramid.data
for block_id, block_name in enumerate(block_names):
    block = pyramid.copy()
    block.data = combined_mesh.copy()
    block.name = block_name
    scene.collection.objects.link(block)

    editable = bmesh.new()
    editable.from_mesh(block.data)
    id_layer = editable.faces.layers.int.get("block_id")
    if id_layer is None:
        raise RuntimeError("The block_id face attribute was lost during joining")
    remove_faces = [face for face in editable.faces if face[id_layer] != block_id]
    bmesh.ops.delete(editable, geom=remove_faces, context="FACES")
    editable.to_mesh(block.data)
    editable.free()
    block.data.update()

    attribute = block.data.attributes.get("block_id")
    if attribute:
        block.data.attributes.remove(attribute)

    select_only([block])
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    triangulate = block.modifiers.new("Web Triangulation", "TRIANGULATE")
    bpy.context.view_layer.objects.active = block
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    block_objects.append(block)

bpy.data.objects.remove(pyramid, do_unlink=True)
if combined_mesh.users == 0:
    bpy.data.meshes.remove(combined_mesh)

# Export just the prepared mesh. Textures are embedded in the binary glTF.
select_only(block_objects)
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=90,
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

print(f"WEB_EXPORT={GLB_PATH}")
print(f"WEB_EXPORT_BYTES={GLB_PATH.stat().st_size}")
print(f"WEB_BLOCK_OBJECTS={len(block_objects)}")
print(f"WEB_MESH_VERTICES={sum(len(block.data.vertices) for block in block_objects)}")
print(f"WEB_MESH_POLYGONS={sum(len(block.data.polygons) for block in block_objects)}")
