import bpy
from pathlib import Path
# Run with Blender -b your-ball.blend --python scripts/export-ball-web.py
b=bpy.data.objects['BALLON']
for o in list(bpy.context.scene.objects):
 if o!=b: bpy.data.objects.remove(o,do_unlink=True)
for i in bpy.data.images:
 if i.size[0]>2048: i.scale(2048,2048)
b.parent=None
b.rotation_euler=(0,0,0)
bpy.ops.object.select_all(action='DESELECT')
b.select_set(True)
bpy.context.view_layer.objects.active=b
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY',center='BOUNDS')
b.location=(0,0,0)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
tri=b.modifiers.new('Triangulate','TRIANGULATE')
bpy.ops.object.modifier_apply(modifier=tri.name)
d=b.modifiers.new('Web mesh','DECIMATE')
d.ratio=min(1,25000/len(b.data.polygons))
bpy.ops.object.modifier_apply(modifier=d.name)
print('TRIS',len(b.data.polygons),flush=True)
bpy.ops.export_scene.gltf(filepath=str(Path(__file__).resolve().parents[1] / 'assets' / 'ball.glb'),export_format='GLB',use_selection=True,export_apply=False,export_image_format='JPEG',export_jpeg_quality=80)
