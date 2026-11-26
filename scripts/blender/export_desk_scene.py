"""Export the Overgrown desk scene for the website (glTF binary + scene.json for Three.js).

The site shows the live game on the CRT, so this differs from showcase/blender/export_web.py:
the screen becomes plain dark glass (the page lays the real site over it), its exact bounds go
into scene.json, and the sticky note moves off the glass. Run it headless so the live Blender
session and the .blend stay untouched:

  blender -b E:/BLENDER/Overgrown.blend --python scripts/blender/export_desk_scene.py

Writes apps/web/public/scene/. Needs the baked textures in showcase/textures/web/
(showcase/blender/make_web_textures.py).
"""
import json
import math
import os
import shutil

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOW = os.path.join(REPO, "showcase")
ASSETS = os.path.join(REPO, "apps", "web", "public", "scene")
TEXW = os.path.join(SHOW, "textures", "web")
os.makedirs(ASSETS, exist_ok=True)

sc = bpy.data.scenes["Overgrown_Showcase"]
bpy.context.window.scene = sc
vl = sc.view_layers[0]
sc.frame_set(1)
dg = bpy.context.evaluated_depsgraph_get()

# Blender (Z up, -Y forward) -> glTF / Three.js (Y up)
B2T = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))


def t_vec(v):
    return [round(c, 5) for c in (B2T @ Vector(v))]


# ------------------------------------------------------------------ materials
def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def load_web_image(fname):
    path = os.path.join(TEXW, fname)
    for img in bpy.data.images:
        if img.filepath and os.path.normcase(bpy.path.abspath(img.filepath)) == os.path.normcase(path):
            return img
    img = bpy.data.images.load(path, check_existing=False)
    img.name = "web_" + fname
    return img


SCALARS = ("Roughness", "Metallic", "IOR", "Alpha", "Coat Weight", "Coat Roughness", "Transmission Weight",
           "Specular IOR Level", "Emission Color", "Emission Strength", "Coat Tint")
OVERRIDE_TEX = {   # material -> (baked texture, use as emission too, interpolation)
    "OG_Key_Alpha": ("key_alpha.png", False, "Linear"),
    "OG_Key_Mod": ("key_mod.png", False, "Linear"),
    "OG_Key_Moss": ("key_moss.png", False, "Linear"),
    "OG_DeskWood": ("desk_wood.jpg", False, "Linear"),
}
_cache = {}


def ramp_average(node):
    els = node.color_ramp.elements
    return [sum(e.color[i] for e in els) / len(els) for i in range(3)]


def ramp_at(node, t):
    c = node.color_ramp.evaluate(t)
    return [c[0], c[1], c[2]]


def convert(src, variant=None):
    key = (src.name, variant)
    if key in _cache:
        return _cache[key]
    name = src.name if variant is None else f"{src.name}_{variant}"
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = principled(m)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    sb = principled(src)
    if src_name(src) == "OG_Screen_Race":           # the live site covers it: plain dark glass
        b.inputs["Base Color"].default_value = (0.012, 0.016, 0.014, 1)
        b.inputs["Roughness"].default_value = 0.18
        b.inputs["Emission Strength"].default_value = 0.0
        _cache[key] = m
        return m
    if sb is None:                                  # pure emission shader (night sky)
        em = next(n for n in src.node_tree.nodes if n.type == "EMISSION")
        b.inputs["Base Color"].default_value = (0, 0, 0, 1)
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = load_web_image("night_sky.png")
        nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = em.inputs["Strength"].default_value
        b.inputs["Roughness"].default_value = 1.0
        _cache[key] = m
        return m
    for k in SCALARS:
        if k in sb.inputs and k in b.inputs and not sb.inputs[k].is_linked:
            b.inputs[k].default_value = sb.inputs[k].default_value
    b.inputs["Alpha"].default_value = 1.0          # keep everything opaque on the web
    bc = sb.inputs["Base Color"]
    if src_name(src) in OVERRIDE_TEX:
        fname, emissive, interp = OVERRIDE_TEX[src_name(src)]
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = load_web_image(fname); tex.interpolation = interp
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if emissive:
            nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    elif bc.is_linked:
        n = bc.links[0].from_node
        if n.type == "TEX_IMAGE":
            tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = n.image; tex.interpolation = n.interpolation
            tex.extension = n.extension
            nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
            ec = sb.inputs["Emission Color"]
            if ec.is_linked and ec.links[0].from_node == n:
                nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        elif n.type == "VERTEX_COLOR":
            va = nt.nodes.new("ShaderNodeVertexColor"); va.layer_name = n.layer_name
            nt.links.new(va.outputs["Color"], b.inputs["Base Color"])
        elif n.type == "VALTORGB":
            col = ramp_at(n, variant) if isinstance(variant, float) else ramp_average(n)
            b.inputs["Base Color"].default_value = (*col, 1)
        else:
            b.inputs["Base Color"].default_value = bc.default_value
    else:
        b.inputs["Base Color"].default_value = bc.default_value
    _cache[key] = m
    return m


# ------------------------------------------------------------------ geometry
GEOM = {"MESH", "CURVE", "FONT", "META"}
for n in ("CRT_StickyNote", "CRT_StickyText"):   # clear of the glass, still on the bezel corner
    o = sc.objects.get(n)
    if o:
        o.matrix_world.translation += Vector((0.028, 0, 0.018))
dg.update()
sources = [o for o in sc.objects if o.type in GEOM and not o.hide_render]
names = {o: o.name for o in sources}
# Things a visitor can pick up: an object tagged ["pickable"] = label (usually an empty) and
# everything under it. They keep their own node in the glTF so the site can lift them.
pick_roots = [o for o in sc.objects if o.get("pickable") and not o.hide_render]
names.update({o: o.name for o in pick_roots})
for o in sources + pick_roots:
    o.name = "SRC__" + o.name
for m in list(bpy.data.materials):
    if not m.name.startswith("SRC__"):
        m.name = "SRC__" + m.name


def src_name(m):
    return m.name[5:] if m.name.startswith("SRC__") else m.name


coll = bpy.data.collections.new("WEB_EXPORT")
sc.collection.children.link(coll)


def box_uv(me, mw):
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        n = (mw.to_3x3() @ p.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = {2: (co.x, co.y), 1: (co.x, co.z), 0: (co.y, co.z)}[ax]


pick_nodes = {}
for r in pick_roots:
    e = bpy.data.objects.new(names[r], None)
    coll.objects.link(e)
    e.matrix_world = r.matrix_world.copy()
    pick_nodes[r] = e


def pick_root_of(o):
    p = o
    while p is not None:
        if p in pick_nodes:
            return p
        p = p.parent
    return None


tris = 0
for o in sources:
    name = names[o]
    oe = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(oe, preserve_all_data_layers=True, depsgraph=dg)
    if len(me.polygons) == 0:
        bpy.data.meshes.remove(me)
        continue
    me.name = name
    new = bpy.data.objects.new(name, me)
    coll.objects.link(new)
    root = pick_root_of(o)
    if root is not None:
        new.parent = pick_nodes[root]
        new.matrix_parent_inverse = Matrix.Identity(4)
    new.matrix_world = o.matrix_world.copy()
    variant = None
    if "Leaf" in name or "Crown" in name:             # leaves get one of 3 green shades
        variant = (0.2, 0.5, 0.8)[sum(map(ord, name)) % 3]
    for i, m in enumerate(me.materials):
        if m is None:
            continue
        sm = m
        sm_name = src_name(m)
        m2 = convert(sm, variant)
        m2.name = sm_name if variant is None else f"{sm_name}_{variant}"
        me.materials[i] = m2
        if sm_name == "OG_DeskWood":
            box_uv(me, new.matrix_world)
    tris += sum(len(p.vertices) - 2 for p in me.polygons)
print("WEB objects", len(coll.objects), "tris", tris)

# ------------------------------------------------------------------ export
vl.update()
vl.active_layer_collection = vl.layer_collection.children[coll.name]
glb = os.path.join(ASSETS, "desk.glb")
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
opts = dict(filepath=glb, export_format="GLB", use_active_scene=True, use_active_collection=True, export_cameras=False,
            export_lights=False, export_yup=True, export_apply=False, export_texcoords=True,
            export_normals=True, export_materials="EXPORT", export_vertex_color="MATERIAL",
            export_image_format="AUTO", export_animations=False, export_extras=False,
            export_meshopt_compression_enable=True)
opts = {k: v for k, v in opts.items() if k in props or k == "filepath"}
try:
    bpy.ops.export_scene.gltf(**opts)
except Exception as e:
    print("WEB meshopt export failed, retrying uncompressed:", e)
    opts["export_meshopt_compression_enable"] = False
    bpy.ops.export_scene.gltf(**opts)
print("WEB glb", glb, os.path.getsize(glb))

# ------------------------------------------------------------------ lights + camera -> scene.json
lights = []
for o in sc.objects:
    if o.type != "LIGHT" or o.hide_render:
        continue
    L = o.data
    mw = o.matrix_world
    rot = (B2T @ mw.to_3x3().normalized()).to_quaternion()
    d = mw.to_3x3() @ Vector((0, 0, -1))
    e = {"name": o.name, "type": L.type.lower(), "watts": L.energy, "color": [round(c, 4) for c in L.color],
         "position": t_vec(mw.translation), "direction": t_vec(d.normalized()),
         "quaternion": [round(rot.x, 5), round(rot.y, 5), round(rot.z, 5), round(rot.w, 5)]}
    if L.type == "AREA":
        e["width"] = L.size
        e["height"] = L.size_y if L.shape in ("RECTANGLE", "ELLIPSE") else L.size
    if L.type == "SPOT":
        e["angle"] = L.spot_size / 2
        e["blend"] = L.spot_blend
    if L.type in ("POINT", "SPOT"):
        e["radius"] = L.shadow_soft_size
    lights.append(e)

cam = sc.camera
cd = cam.data
fwd = cam.matrix_world.to_3x3() @ Vector((0, 0, -1))
target = cam.matrix_world.translation + fwd * 1.92
hfov = 2 * math.atan(cd.sensor_width / 2 / cd.lens)
data = {
    "units": "metres, Three.js Y-up (converted from Blender Z-up)",
    "camera": {"position": t_vec(cam.matrix_world.translation), "target": t_vec(target),
               "hfovDeg": round(math.degrees(hfov), 3), "near": 0.02, "far": 30,
               "focusDistance": round((bpy.data.objects["SRC__CRT_Screen"].matrix_world.translation
                                       - cam.matrix_world.translation).length, 3)},
    "lights": lights,
    "background": [0.004, 0.005, 0.012],
    "floaters": ["Vox_Apple", "Vox_Strawberry", "Vox_Melon", "Vox_Pineapple", "Vox_RockHead", "Vox_Saw"],
    "loopSeconds": 5.0,
    "bobMetres": 0.015,
    "lavaBlobs": [n for n in (names[o] for o in sources) if n.startswith("Lava_Blob")],
    "screenMaterial": "OG_Screen_Race",
    "neonMaterial": "OG_Neon",
    "pickables": [{"node": names[r], "label": r["pickable"],
                   **({"hide": ["Gamepad_Cable"]} if names[r] == "Pick_Gamepad" else {})}
                  for r in sorted(pick_roots, key=lambda r: names[r])],
    # the computer's power: either switch toggles it; the LEDs go dark while it is off
    "power": {"buttons": ["CRT_PowerSwitch", "PC_PowerButton"],
              "leds": ["CRT_PowerLED", "PC_LED_0", "PC_LED_1", "PC_Floppy_LED"]},
    # Three.js has no shadowed area lights: the moon (outside, through the blinds) becomes a
    # shadow-casting spot so the slats still stripe the room. `gain` dims a light in the browser
    # only (the room read too bright there with the EEVEE values).
    "lightHints": {"Moon_Key": {"as": "spot", "angleDeg": 24, "penumbra": 0.5, "shadow": True, "mapSize": 2048},
                   "Lamp_Spot": {"shadow": True, "mapSize": 1024, "gain": 0.55},
                   "Lava_Light": {"gain": 0.25},
                   "Neon_Spill": {"gain": 0.7},
                   "Rim_Magenta": {"gain": 0.6},
                   "Rim_Blue": {"gain": 0.75}},
    # multipliers on top of the physical conversion, tuned against the EEVEE render
    "tuning": {"exposure": 0.9, "area": 1.0, "point": 1.0, "spot": 1.0, "ambient": 0.0,
               "bloom": {"strength": 0.16, "radius": 0.5, "threshold": 1.35}},
}
scr_obj = bpy.data.objects["SRC__CRT_Screen"]
data["camera"]["orbitTarget"] = t_vec(scr_obj.matrix_world.translation)
sme = scr_obj.evaluated_get(dg).to_mesh()
pts = [scr_obj.matrix_world @ v.co for v in sme.vertices]
x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
front = min(p.y for p in pts)                      # nearest the viewer (Blender -Y)
data["screen"] = {
    "center": t_vec(((x0 + x1) / 2, front, (z0 + z1) / 2)),
    "width": round(x1 - x0, 5),
    "height": round(z1 - z0, 5),
    "node": "CRT_Screen",
}
scr_obj.evaluated_get(dg).to_mesh_clear()
with open(os.path.join(ASSETS, "scene.json"), "w") as f:
    json.dump(data, f, indent=1)
print("WEB done", len(lights), "lights")
