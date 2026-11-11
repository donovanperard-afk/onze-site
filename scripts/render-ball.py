import bpy, math
from mathutils import Vector
s=bpy.context.scene
b=bpy.data.objects['BALLON']
for o in list(s.objects):
 if o!=b: bpy.data.objects.remove(o,do_unlink=True)
b.location=(0,0,0)
b.rotation_euler=(0.18,0.3,0.2)
# Retain original mesh and materials, move origin to actual geometric center.
bpy.context.view_layer.update()
center=sum((b.matrix_world@Vector(c) for c in b.bound_box),Vector())/8
b.location-=center
s.world=bpy.data.worlds.new('Night')
s.world.use_nodes=True
s.world.node_tree.nodes['Background'].inputs[0].default_value=(0.10,0.15,0.25,1)
s.world.node_tree.nodes['Background'].inputs[1].default_value=0.20
def area(name,loc,power,size,color):
 data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size; data.color=color
 o=bpy.data.objects.new(name,data); s.collection.objects.link(o);o.location=loc;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
area('Cold upper-left',(-2,-3,4),340,3,(0.68,0.81,1))
area('Goal rim',(2,1,2),110,2,(0.75,0.86,1))
cam=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));s.collection.objects.link(cam);cam.location=(0,-4,1.1);cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.38;s.camera=cam
s.render.engine='CYCLES';s.cycles.samples=40;s.cycles.use_denoising=True
s.render.resolution_x=900;s.render.resolution_y=900;s.render.resolution_percentage=100
s.render.film_transparent=True
s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.filepath='/files/onze-v2/assets/ball.png'
bpy.ops.wm.save_as_mainfile(filepath='/files/onze-v2/scripts/ball-render.blend')
bpy.ops.render.render(write_still=True)
