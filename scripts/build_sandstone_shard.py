import bpy
import math
import os
import random
from mathutils import Vector


ROOT = r"C:\Users\husse\Desktop\Work\Dune"
MODEL_DIR = os.path.join(ROOT, "public", "models")
CHECK_DIR = os.path.join(ROOT, "blend-files", "sandstone-shard-checks")
TEXTURE_DIR = os.path.join(ROOT, "blend-files", "sandstone-shard-textures")
GLB_PATH = os.path.join(MODEL_DIR, "sandstone-shard.glb")
BLEND_PATH = os.path.join(MODEL_DIR, "sandstone-shard.blend")

EXPORT_COLLECTION = "SandstoneShard_Export"
HIGH_COLLECTION = "SandstoneShard_HighPoly"
RIG_COLLECTION = "SandstoneShard_PreviewRig"


def ensure_dirs():
    for path in (MODEL_DIR, CHECK_DIR, TEXTURE_DIR):
        os.makedirs(path, exist_ok=True)


def ensure_collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def clear_collection(name):
    coll = ensure_collection(name)
    for obj in list(coll.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    return coll


def link_only(obj, collection):
    for coll in list(obj.users_collection):
        coll.objects.unlink(obj)
    collection.objects.link(obj)


def look_at(obj, target=(0.0, 0.0, 0.0)):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def make_blockout_mesh():
    random.seed(7391)
    n = 24
    zs = [-0.98, -0.88, -0.75, -0.61, -0.48, -0.34, -0.20, -0.06,
          0.08, 0.20, 0.33, 0.46, 0.58, 0.69, 0.79, 0.88, 0.96]
    rx = [0.08, 0.25, 0.32, 0.39, 0.45, 0.48, 0.52, 0.56,
          0.60, 0.63, 0.66, 0.64, 0.61, 0.56, 0.50, 0.41, 0.30]
    ry = [0.06, 0.18, 0.23, 0.28, 0.32, 0.34, 0.36, 0.39,
          0.42, 0.44, 0.45, 0.43, 0.40, 0.36, 0.32, 0.27, 0.21]
    hard_layers = {-0.48: 0.035, 0.20: 0.045, 0.58: 0.030}
    angle_jitter = [random.uniform(-0.065, 0.065) for _ in range(n)]
    radial_profile = [random.uniform(0.90, 1.10) for _ in range(n)]
    vertices = []

    for ri, z in enumerate(zs):
        layer_out = sum(amount for hz, amount in hard_layers.items() if abs(z - hz) < 0.015)
        cx = 0.045 * math.sin((z + 0.7) * 2.2)
        cy = -0.028 * math.cos((z - 0.1) * 2.7)
        for ai in range(n):
            a = 2.0 * math.pi * ai / n + angle_jitter[ai]
            local = radial_profile[ai] * (1.0 + 0.025 * math.sin(ri * 1.71 + ai * 0.83))

            # A nearly separating front-right corner: a deep, tapering vertical cleft.
            crack_delta = abs(math.atan2(math.sin(a - 0.68), math.cos(a - 0.68)))
            crack_z = max(0.0, 1.0 - abs(z - 0.37) / 0.48)
            crack = max(0.0, 1.0 - crack_delta / 0.20) * crack_z
            local *= 1.0 - 0.28 * crack

            # A started slab on the back-left bedding plane.
            slab_delta = abs(math.atan2(math.sin(a - 3.88), math.cos(a - 3.88)))
            slab = max(0.0, 1.0 - slab_delta / 0.52)
            if -0.34 < z < -0.06:
                local *= 1.0 + 0.10 * slab
            elif -0.48 < z <= -0.34:
                local *= 1.0 - 0.07 * slab

            rr_x = rx[ri] * local + layer_out
            rr_y = ry[ri] * local + layer_out * 0.70
            # A few broad facets are deliberately cleaner than the broken sectors.
            x = cx + rr_x * math.cos(a)
            y = cy + rr_y * math.sin(a)
            z_jag = z + 0.012 * math.sin(ai * 1.91 + ri * 0.67)
            vertices.append((x, y, z_jag))

    bottom_index = len(vertices)
    vertices.append((0.015, -0.012, -1.03))
    top_index = len(vertices)
    vertices.append((-0.035, 0.018, 1.01))

    faces = []
    face_meta = []
    for ri in range(len(zs) - 1):
        for ai in range(n):
            ni = (ai + 1) % n
            a = ri * n + ai
            b = ri * n + ni
            c = (ri + 1) * n + ni
            d = (ri + 1) * n + ai
            # Alternate diagonals to avoid a machine-regular triangulation.
            if (ri + ai) % 2:
                faces.extend([(a, b, d), (b, c, d)])
            else:
                faces.extend([(a, b, c), (a, c, d)])
            face_meta.extend([(ri, ai), (ri, ai)])
    for ai in range(n):
        ni = (ai + 1) % n
        faces.append((bottom_index, ni, ai))
        face_meta.append((-1, ai))
        a = (len(zs) - 1) * n + ai
        b = (len(zs) - 1) * n + ni
        faces.append((a, b, top_index))
        face_meta.append((len(zs), ai))

    mesh = bpy.data.meshes.new("SandstoneShard_Low_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()

    # Cylindrical unwrap for sides, with planar-ish cap islands. Object-space
    # procedural baking keeps bedding bands continuous regardless of islands.
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        ri, _ = face_meta[poly.index]
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            if vi == bottom_index:
                uv = (0.25, 0.25)
            elif vi == top_index:
                uv = (0.75, 0.75)
            else:
                ring = vi // n
                seg = vi % n
                u = seg / n
                # unwrap seam consistently for triangles that cross it
                segs = [mesh.loops[x].vertex_index % n for x in poly.loop_indices
                        if mesh.loops[x].vertex_index < bottom_index]
                if seg == 0 and segs and max(segs) == n - 1:
                    u = 1.0
                v = (zs[ring] + 1.03) / 2.04
                uv = (u, v)
            uv_layer.data[li].uv = uv

    # Corner attribute distinguishes lighter clean fracture planes from darker,
    # weathered faces while retaining a single final material.
    attr = mesh.color_attributes.new(name="FractureMask", type='FLOAT_COLOR', domain='CORNER')
    for poly in mesh.polygons:
        center = poly.center
        angle = math.atan2(center.y, center.x)
        front_clean = 0.18 < angle < 1.55 and center.z > -0.72
        back_clean = -2.75 < angle < -2.10 and center.z > -0.30
        cap_clean = abs(poly.normal.z) > 0.72
        value = 0.92 if (front_clean or back_clean or cap_clean) else 0.08
        for li in poly.loop_indices:
            attr.data[li].color = (value, value, value, 1.0)

    obj = bpy.data.objects.new("SandstoneShard", mesh)
    for poly in mesh.polygons:
        poly.use_smooth = False
    return obj


def build_procedural_material(name="SandstoneShard_Procedural"):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tex.outputs["Generated"], sep.inputs["Vector"])

    broad = nodes.new("ShaderNodeTexNoise")
    broad.noise_dimensions = '3D'
    broad.inputs["Scale"].default_value = 3.2
    broad.inputs["Detail"].default_value = 4.0
    broad.inputs["Roughness"].default_value = 0.68
    links.new(tex.outputs["Generated"], broad.inputs["Vector"])

    warp = nodes.new("ShaderNodeMath")
    warp.operation = 'MULTIPLY'
    warp.inputs[1].default_value = 2.4
    links.new(broad.outputs["Fac"], warp.inputs[0])
    zscale = nodes.new("ShaderNodeMath")
    zscale.operation = 'MULTIPLY'
    zscale.inputs[1].default_value = 31.0
    links.new(sep.outputs["Z"], zscale.inputs[0])
    add = nodes.new("ShaderNodeMath")
    add.operation = 'ADD'
    links.new(zscale.outputs[0], add.inputs[0])
    links.new(warp.outputs[0], add.inputs[1])
    sine = nodes.new("ShaderNodeMath")
    sine.operation = 'SINE'
    links.new(add.outputs[0], sine.inputs[0])

    fine = nodes.new("ShaderNodeTexNoise")
    fine.noise_dimensions = '3D'
    fine.inputs["Scale"].default_value = 18.0
    fine.inputs["Detail"].default_value = 5.0
    fine.inputs["Roughness"].default_value = 0.76
    links.new(tex.outputs["Generated"], fine.inputs["Vector"])

    combine = nodes.new("ShaderNodeMath")
    combine.operation = 'MULTIPLY_ADD'
    combine.inputs[1].default_value = 0.78
    links.new(sine.outputs[0], combine.inputs[0])
    links.new(fine.outputs["Fac"], combine.inputs[2])

    ramp = nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements.remove(cr.elements[1])
    cr.elements[0].position = 0.15
    cr.elements[0].color = (0.17, 0.065, 0.018, 1.0)
    e = cr.elements.new(0.40); e.color = (0.42, 0.18, 0.045, 1.0)
    e = cr.elements.new(0.63); e.color = (0.67, 0.35, 0.105, 1.0)
    e = cr.elements.new(0.83); e.color = (0.31, 0.115, 0.028, 1.0)
    links.new(combine.outputs[0], ramp.inputs[0])

    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "FractureMask"
    fresh = nodes.new("ShaderNodeMixRGB")
    fresh.blend_type = 'SCREEN'
    fresh.inputs[2].default_value = (0.44, 0.25, 0.105, 1.0)
    links.new(attr.outputs["Fac"], fresh.inputs[0])
    links.new(ramp.outputs["Color"], fresh.inputs[1])
    links.new(fresh.outputs["Color"], bsdf.inputs["Base Color"])

    rough_mix = nodes.new("ShaderNodeMix")
    rough_mix.data_type = 'FLOAT'
    rough_mix.inputs[2].default_value = 0.86
    rough_mix.inputs[3].default_value = 0.66
    links.new(attr.outputs["Fac"], rough_mix.inputs[0])
    links.new(rough_mix.outputs[0], bsdf.inputs["Roughness"])

    bump_mix = nodes.new("ShaderNodeMath")
    bump_mix.operation = 'ADD'
    bump_mix.inputs[1].default_value = 0.0
    links.new(fine.outputs["Fac"], bump_mix.inputs[0])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.28
    bump.inputs["Distance"].default_value = 0.075
    links.new(bump_mix.outputs[0], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def make_preview_rig():
    coll = clear_collection(RIG_COLLECTION)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.look = 'AgX - Medium High Contrast'

    world = scene.world or bpy.data.worlds.new("SandstoneShard_World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.055, 0.047, 0.040, 1.0)
    bg.inputs["Strength"].default_value = 0.32

    cam_data = bpy.data.cameras.new("SandstoneShard_PreviewCamera_Data")
    cam = bpy.data.objects.new("SandstoneShard_PreviewCamera", cam_data)
    coll.objects.link(cam)
    cam.location = (3.25, -5.6, 1.85)
    cam_data.lens = 64
    cam_data.sensor_width = 36
    look_at(cam, (0.0, 0.0, 0.02))
    scene.camera = cam

    specs = [
        ("Overcast_Key", (3.8, -4.2, 5.2), 620.0, 5.0, (1.0, 0.88, 0.72)),
        ("Overcast_Fill", (-4.0, -1.4, 2.0), 360.0, 4.0, (0.70, 0.78, 1.0)),
        ("Soft_Rim", (-0.8, 4.2, 3.0), 560.0, 3.2, (1.0, 0.78, 0.52)),
    ]
    for name, loc, energy, size, color in specs:
        data = bpy.data.lights.new(name + "_Data", 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = loc
        look_at(light, (0.0, 0.0, 0.0))
        coll.objects.link(light)
    return cam


def render_checkpoint(path, target_obj, angle='front'):
    scene = bpy.context.scene
    cam = scene.camera
    if angle == 'back':
        cam.location = (-3.05, 5.45, 1.72)
    else:
        cam.location = (3.25, -5.6, 1.85)
    look_at(cam, (0.0, 0.0, 0.02))
    prior = {}
    keep = {EXPORT_COLLECTION, HIGH_COLLECTION, RIG_COLLECTION}
    for coll in bpy.data.collections:
        if coll.name not in keep:
            prior[coll.name] = coll.hide_render
            coll.hide_render = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for name, state in prior.items():
        if bpy.data.collections.get(name):
            bpy.data.collections[name].hide_render = state


def build_blockout():
    ensure_dirs()
    export_coll = clear_collection(EXPORT_COLLECTION)
    clear_collection(HIGH_COLLECTION)
    obj = make_blockout_mesh()
    export_coll.objects.link(obj)
    mat = build_procedural_material()
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_CENTER_OF_MASS', center='MEDIAN')
    obj.location = (0.0, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    make_preview_rig()
    render_checkpoint(os.path.join(CHECK_DIR, "01-blockout.png"), obj, 'front')
    return {
        "stage": "blockout",
        "object": obj.name,
        "vertices": len(obj.data.vertices),
        "triangles": len(obj.data.polygons),
        "screenshot": os.path.join(CHECK_DIR, "01-blockout.png"),
    }


def create_high_poly(low):
    high_coll = clear_collection(HIGH_COLLECTION)
    high = low.copy()
    high.data = low.data.copy()
    high.name = "SandstoneShard_High"
    high.data.name = "SandstoneShard_High_Mesh"
    high_coll.objects.link(high)
    high.data.materials.clear()
    high.data.materials.append(build_procedural_material())
    for poly in high.data.polygons:
        poly.use_smooth = False

    subdiv = high.modifiers.new("Fracture_Subdivision", 'SUBSURF')
    subdiv.subdivision_type = 'SIMPLE'
    subdiv.levels = 3
    subdiv.render_levels = 3
    noise = bpy.data.textures.get("Sandstone_MicroFracture") or bpy.data.textures.new("Sandstone_MicroFracture", type='CLOUDS')
    noise.noise_scale = 0.065
    noise.noise_depth = 2
    noise.contrast = 1.15
    disp = high.modifiers.new("Wind_Erosion", 'DISPLACE')
    disp.texture = noise
    disp.texture_coords = 'GLOBAL'
    disp.strength = 0.034
    disp.mid_level = 0.53
    bpy.context.view_layer.objects.active = high
    high.select_set(True)
    low.select_set(False)
    bpy.ops.object.modifier_apply(modifier=subdiv.name)
    bpy.ops.object.modifier_apply(modifier=disp.name)
    for poly in high.data.polygons:
        poly.use_smooth = False
    return high


def make_bake_material(name, mode, target_image):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = target_image
    image_node.select = True
    nodes.active = image_node

    if mode == 'NORMAL' or mode == 'AO':
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (0.55, 0.32, 0.12, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.8
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        return mat

    proc = build_procedural_material("_Bake_Procedural_Source")
    source_nodes = proc.node_tree.nodes
    source_links = proc.node_tree.links
    # Reuse the procedural source tree temporarily, adding an emission endpoint.
    # The copied material is isolated from the preview material.
    mat.node_tree.nodes.clear()
    for node in source_nodes:
        pass
    # Build a duplicate from the procedural material to retain all object-space detail.
    bpy.data.materials.remove(mat)
    mat = proc.copy()
    mat.name = name
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    old_out = next((n for n in nodes if n.bl_idname == 'ShaderNodeOutputMaterial'), None)
    bsdf = next((n for n in nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = target_image
    image_node.select = True
    nodes.active = image_node
    emission = nodes.new("ShaderNodeEmission")
    if mode == 'COLOR':
        src = bsdf.inputs["Base Color"].links[0].from_socket
        links.new(src, emission.inputs["Color"])
        emission.inputs["Strength"].default_value = 1.0
    else:
        src = bsdf.inputs["Roughness"].links[0].from_socket
        links.new(src, emission.inputs["Color"])
        emission.inputs["Strength"].default_value = 1.0
    for link in list(old_out.inputs["Surface"].links):
        links.remove(link)
    links.new(emission.outputs["Emission"], old_out.inputs["Surface"])
    return mat


def new_bake_image(name, colorspace='Non-Color'):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, width=2048, height=2048, alpha=True, float_buffer=False)
    img.colorspace_settings.name = colorspace
    return img


def set_single_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def bake_maps(low, high):
    scene = bpy.context.scene
    low.hide_render = False
    low.hide_set(False)
    high.hide_render = False
    high.hide_set(False)
    for coll in high.users_collection:
        coll.hide_render = False
        coll.hide_viewport = False
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.bake.margin = 16
    scene.render.bake.use_clear = True
    scene.render.bake.use_cage = False
    scene.render.bake.cage_extrusion = 0.045
    scene.render.bake.max_ray_distance = 0.16

    base = new_bake_image("SandstoneShard_BaseColor", 'sRGB')
    rough = new_bake_image("SandstoneShard_Roughness", 'Non-Color')
    ao = new_bake_image("SandstoneShard_AO", 'Non-Color')
    normal = new_bake_image("SandstoneShard_Normal", 'Non-Color')

    for mode, img in (("COLOR", base), ("ROUGH", rough)):
        mat = make_bake_material("_Bake_" + mode, mode, img)
        set_single_material(low, mat)
        bpy.ops.object.select_all(action='DESELECT')
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        scene.render.bake.use_selected_to_active = False
        bpy.ops.object.bake(type='EMIT')

    ao_mat = make_bake_material("_Bake_AO", 'AO', ao)
    set_single_material(low, ao_mat)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type='AO')

    normal_mat = make_bake_material("_Bake_NORMAL", 'NORMAL', normal)
    set_single_material(low, normal_mat)
    bpy.ops.object.select_all(action='DESELECT')
    high.hide_set(False)
    high.hide_render = False
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene.render.bake.use_selected_to_active = True
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
    scene.render.bake.use_selected_to_active = False

    base.filepath_raw = os.path.join(TEXTURE_DIR, "sandstone-shard-basecolor.png")
    base.file_format = 'PNG'; base.save()
    normal.filepath_raw = os.path.join(TEXTURE_DIR, "sandstone-shard-normal.png")
    normal.file_format = 'PNG'; normal.save()
    rough.filepath_raw = os.path.join(TEXTURE_DIR, "sandstone-shard-roughness-source.png")
    rough.file_format = 'PNG'; rough.save()
    ao.filepath_raw = os.path.join(TEXTURE_DIR, "sandstone-shard-ao-source.png")
    ao.file_format = 'PNG'; ao.save()

    import numpy as np
    rp = np.empty(2048 * 2048 * 4, dtype=np.float32)
    ap = np.empty(2048 * 2048 * 4, dtype=np.float32)
    rough.pixels.foreach_get(rp)
    ao.pixels.foreach_get(ap)
    rp = rp.reshape((-1, 4)); ap = ap.reshape((-1, 4))
    packed = np.empty_like(rp)
    packed[:, 0] = ap[:, 0]
    packed[:, 1] = rp[:, 0]
    packed[:, 2] = 0.0
    packed[:, 3] = 1.0
    orm = new_bake_image("SandstoneShard_ORM", 'Non-Color')
    orm.pixels.foreach_set(packed.reshape(-1))
    orm.filepath_raw = os.path.join(TEXTURE_DIR, "sandstone-shard-orm.png")
    orm.file_format = 'PNG'; orm.save()

    for img in (base, normal, orm):
        img.pack()
    return base, normal, orm


def build_final_material(base, normal, orm):
    mat = bpy.data.materials.get("SandstoneShard_Material") or bpy.data.materials.new("SandstoneShard_Material")
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    base_node = nodes.new("ShaderNodeTexImage"); base_node.image = base
    normal_node = nodes.new("ShaderNodeTexImage"); normal_node.image = normal
    orm_node = nodes.new("ShaderNodeTexImage"); orm_node.image = orm
    base_node.interpolation = 'Linear'
    normal_node.interpolation = 'Linear'
    orm_node.interpolation = 'Linear'
    links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.82
    links.new(normal_node.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    sep = nodes.new("ShaderNodeSeparateColor")
    links.new(orm_node.outputs["Color"], sep.inputs["Color"])
    links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", 'ShaderNodeTree')
        if hasattr(group, 'interface'):
            sockets = (
                ("Occlusion", 1.0),
                ("Thickness", 0.0),
                ("Dispersion", 0.0),
                ("Iridescence Factor", 0.0),
                ("Iridescence Thickness Minimum", 100.0),
            )
            for socket_name, default in sockets:
                socket = group.interface.new_socket(name=socket_name, in_out='INPUT', socket_type='NodeSocketFloat')
                socket.default_value = default
            group.nodes.new('NodeGroupOutput')
            group.nodes.new('NodeGroupInput')
        else:
            group.inputs.new('NodeSocketFloat', "Occlusion")
    group_node = nodes.new("ShaderNodeGroup")
    group_node.node_tree = group
    group_node.name = "glTF Material Output"
    if group_node.inputs.get("Occlusion"):
        links.new(sep.outputs["Red"], group_node.inputs["Occlusion"])
    return mat


def export_and_save(low, high):
    scene = bpy.context.scene
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    while low.data.color_attributes:
        low.data.color_attributes.remove(low.data.color_attributes[0])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    scene.render.engine = 'BLENDER_EEVEE'
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
    )


def finish_asset():
    ensure_dirs()
    low = bpy.data.objects.get("SandstoneShard")
    if low is None:
        build_blockout()
        low = bpy.data.objects["SandstoneShard"]
    high = create_high_poly(low)

    # High-detail procedural checkpoint, both readable sides.
    low.hide_render = True
    high.hide_render = False
    render_checkpoint(os.path.join(CHECK_DIR, "02-high-front.png"), high, 'front')
    render_checkpoint(os.path.join(CHECK_DIR, "03-high-back.png"), high, 'back')

    base, normal, orm = bake_maps(low, high)
    final_mat = build_final_material(base, normal, orm)
    set_single_material(low, final_mat)
    low.hide_render = False
    high.hide_render = True
    high.hide_set(True)
    high.users_collection[0].hide_viewport = True
    high.users_collection[0].hide_render = True

    render_checkpoint(os.path.join(CHECK_DIR, "04-baked-front.png"), low, 'front')
    render_checkpoint(os.path.join(CHECK_DIR, "05-baked-back.png"), low, 'back')
    export_and_save(low, high)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = low.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()
    tri_count = sum(len(p.vertices) - 2 for p in eval_mesh.polygons)
    eval_obj.to_mesh_clear()
    return {
        "stage": "final",
        "object": low.name,
        "materials": len(low.data.materials),
        "triangles": tri_count,
        "high_triangles": sum(len(p.vertices) - 2 for p in high.data.polygons),
        "dimensions_m": [round(v, 4) for v in low.dimensions],
        "glb": GLB_PATH,
        "blend": BLEND_PATH,
        "screenshots": [os.path.join(CHECK_DIR, x) for x in (
            "02-high-front.png", "03-high-back.png", "04-baked-front.png", "05-baked-back.png")],
        "textures": [base.size[:], normal.size[:], orm.size[:]],
    }


ensure_dirs()
if globals().get("SANDSTONE_STAGE", "final") == "blockout":
    result = build_blockout()
else:
    result = finish_asset()
