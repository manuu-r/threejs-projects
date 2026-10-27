"""Reference-led Roadster concept mesh, authored in Blender.
Three coordinates: +X right, +Y up, +Z forward. Photographic proportions,
not manufacturer CAD. Original geometry; official photographs stay private.
"""
import bpy, math, os
from mathutils import Vector
ROOT='/Users/manu/Dev_stuff/threejs-fun/roadster-lab'
scene=bpy.data.scenes.get('PrototypeCockpit') or bpy.data.scenes.get('RoadsterLab') or bpy.data.scenes.new('PrototypeCockpit')
scene.name='PrototypeCockpit'
bpy.context.window.scene=scene
for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
def p(v): return Vector((v[0],-v[2],v[1]))
def mat(name,c,r=.4,m=0):
 a=bpy.data.materials.new(name);a.diffuse_color=(*c,1);a.use_nodes=True;n=a.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*c,1);n.inputs['Roughness'].default_value=r;n.inputs['Metallic'].default_value=m;return a
def emit(name,c,power):
 a=mat(name,c,.24);n=a.node_tree.nodes.get('Principled BSDF');n.inputs['Emission Color'].default_value=(*c,1);n.inputs['Emission Strength'].default_value=power;return a
paint=mat('Pearl white clearcoat',(.70,.73,.72),.23,.04)
paint.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.8
paint.node_tree.nodes.get('Principled BSDF').inputs['Coat Roughness'].default_value=.16
white=mat('Ultrawhite perforated textile',(.65,.67,.64),.73)
suede=mat('Charcoal microsuede',(.018,.021,.022),.93)
leather=mat('Graphite fine grain',(.006,.008,.009),.58)
carbon=mat('Satin carbon composite',(.004,.006,.007),.47,.15)
metal=mat('Brushed titanium',(.26,.29,.30),.28,.88)
rimMetal=mat('Diamond cut forged aluminum',(.60,.63,.65),.26,.75)
black=mat('Display black glass',(.0015,.002,.0025),.16)
rubber=mat('Performance tire rubber',(.008,.009,.010),.87)
gold=mat('Ceramic brake caliper',(.30,.15,.038),.36,.7)
red=emit('Continuous rear lamp',(.55,.002,.004),3)
led=emit('White matrix LED',(.76,.86,.88),2)
ambient=emit('Door red ambient fiber',(.12,.001,.002),.65)

def mesh(name,verts,faces,material,smooth=True,bevel=0):
 data=bpy.data.meshes.new(name);data.from_pydata([p(v) for v in verts],[],faces);data.update();o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);data.materials.append(material)
 for f in data.polygons:f.use_smooth=smooth
 if bevel:
  mod=o.modifiers.new('Panel edge radius','BEVEL');mod.width=bevel;mod.segments=3
  o.modifiers.new('Corner normals','WEIGHTED_NORMAL')
 return o
def cube(name,loc,size,material,bevel=.008):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p(loc));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:
  b=o.modifiers.new('Upholstered edge','BEVEL');b.width=bevel;b.segments=4;o.modifiers.new('Surface normals','WEIGHTED_NORMAL')
 return o
def tube(name,points,radius,material,cyclic=False):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=12;c.bevel_depth=radius;c.bevel_resolution=3;c.use_fill_caps=True;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for b,co in zip(s.bezier_points,points):b.co=p(co);b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 s.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.data.materials.append(material);return o
def parent(o,root):o.parent=root;o.matrix_parent_inverse=root.matrix_world.inverted();return o
def empty(name,loc):
 bpy.ops.object.empty_add(location=p(loc));o=bpy.context.object;o.name=name;return o
def interp(z,rows):
 for a,b in zip(rows,rows[1:]):
  if a[0]<=z<=b[0]:t=(z-a[0])/(b[0]-a[0]);return a[1]*(1-t)+b[1]*t
 return rows[0][1] if z<rows[0][0] else rows[-1][1]
def lathe(name,profile,axis,center,material,N=64):
 vs=[];fs=[]
 for axial,r in profile:
  for i in range(N):
   a=i*math.tau/N;offset=(axial,r*math.sin(a),r*math.cos(a)) if axis=='x' else (r*math.cos(a),r*math.sin(a),axial)
   vs.append(tuple(center[k]+offset[k] for k in range(3)))
 for j in range(len(profile)-1):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;fs.append((a,b,b+N,a+N))
 return mesh(name,vs,fs,material)
# Exterior authored as joined surfaces in its dedicated source.
exec(compile(open(ROOT+'/art/exterior_shell.py').read(),'exterior_shell.py','exec'),globals())
# Detailed wheels: square-shouldered tires, deep barrels and forged split-Y spokes.
for idx,(z,x) in enumerate([(1.4,-.87),(1.4,.87),(-1.4,-.87),(-1.4,.87)]):
 root=empty('Wheel_'+str(idx),(x,-.255,z));yc=-.255
 profile=[(-.135,.282),(-.141,.289),(-.134,.317),(-.116,.337),(-.09,.341),(.09,.341),(.116,.337),(.134,.317),(.141,.289),(.135,.282)]
 parent(lathe('Squared performance tire',profile,'x',(x,yc,z),rubber),root)
 for side in [-1,1]:
  xx=x+side*.134
  parent(lathe('Forged rim barrel',[(side*.125,.284),(side*.13,.277),(side*.12,.265),(-side*.08,.265)],'x',(x,yc,z),carbon),root)
  parent(lathe('Diamond cut rim lip',[(side*.138,.279),(side*.143,.282),(side*.147,.277),(side*.142,.270)],'x',(x,yc,z),rimMetal),root)
  parent(lathe('Carbon ceramic rotor',[(side*.077,.209),(side*.080,.209),(side*.080,.066),(side*.077,.066)],'x',(x,yc,z),metal),root)
  for k in range(5):
   a=k*math.tau/5
   outline=[(.060,-.22),(.172,-.14),(.278,-.30),(.278,.32),(.21,.17),(.066,.31)]
   vv=[]
   for depth in [side*.121,side*.146]:
    for r,offset in outline:vv.append((x+depth,yc+r*math.sin(a+offset),z+r*math.cos(a+offset)))
   N=len(outline);ff=[tuple(reversed(range(N))),tuple(range(N,2*N))]+[(j,(j+1)%N,(j+1)%N+N,j+N)for j in range(N)]
   parent(mesh('Forged five blade aero spoke',vv,ff,rimMetal,False,.002),root)
   points=[(x+side*.149,yc+r*math.sin(a+off),z+r*math.cos(a+off))for r,off in [(.10,.16),(.19,.11),(.273,.11)]]
   parent(tube('Spoke dark relief',points,.004,carbon),root)
  parent(lathe('Center hub',[(side*.14,.055),(side*.153,.052),(side*.156,0)],'x',(x,yc,z),carbon,32),root)
  for k in range(5):
   a=k*math.tau/5;parent(lathe('Titanium hub bolt',[(side*.155,.006),(side*.16,.006),(side*.161,0)],'x',(x,yc+.034*math.sin(a),z+.034*math.cos(a)),metal,12),root)
 # Fine circumferential tread grooves break the smooth toy-tire appearance.
 for axial in [-.072,-.024,.024,.072]:
  parent(lathe('Tire longitudinal channel',[(axial-.003,.3413),(axial+.003,.3413)],'x',(x,yc,z),carbon),root)
 for k in range(48):
  a=k*math.tau/48
  for axial in [-.11,.11]:
   pts=[(x+axial,yc+.341*math.sin(a),z+.341*math.cos(a)),(x+axial*.75,yc+.342*math.sin(a+.024),z+.342*math.cos(a+.024))]
   parent(tube('Shoulder tread sipe',pts,.0014,carbon),root)
 brake=empty('Brake_'+str(idx),(x,yc,z))
 parent(cube('Gold monoblock caliper',(x,yc+.025,z+.174),(.19,.16,.067),gold,.013),brake)
# Closed cockpit tub, low dashboard, proper footwell and high belt line.
cube('Carbon cabin floor',(0,-.27,-.04),(1.75,.10,2.35),carbon,.035)
cube('Front sealed footwell',(0,-.045,1.04),(1.72,.55,.075),leather,.018)
for side in [-1,1]:cube('Inner footwell',(side*.82,-.08,.68),(.08,.40,.70),leather,.025)
# Swept, thin upper dash; broad shadow slot underneath.
vs=[];fs=[]
for j in range(12):
 z=.69+j*.029
 for i in range(49):
  x=-.87+i*1.74/48;y=.245+.018*math.cos(x*2)+.012*math.sin(j/11*math.pi);vs.append((x,y,z))
for j in range(11):
 for i in range(48):a=j*49+i;fs.append((a,a+49,a+50,a+1))
o=mesh('Swept microsuede instrument panel',vs,fs,suede);o.modifiers.new('Dashboard upholstered thickness','SOLIDIFY').thickness=.025
cube('Full width black vent fascia',(0,.175,.74),(1.76,.13,.09),leather,.019)
for yy in [.160,.187,.212]:tube('Instrument panel vent slat',[(-.85,yy,.682),(-.45,yy,.675),(0,yy,.67),(.45,yy,.675),(.85,yy,.682)],.0035,carbon)
tube('Instrument panel satin reveal',[(-.86,.244,.68),(-.45,.255,.67),(0,.257,.67),(.45,.255,.67),(.86,.244,.68)],.0025,metal)
# Displays sit above the cowl with a clear horizon, rather than floating at eye level.
for name,x,y,z,w,h in [('Center',.04,.285,.59,.38,.25),('Primary',-.46,.292,.662,.32,.125),('Secondary',.60,.325,.79,.25,.125)]:
 root=empty(name+'_Display',(x,y,z))
 parent(cube(name+' display enclosure',(x,y,z),(w+.012,h+.012,.018),leather,.009),root)
 parent(cube('Screen_'+name,(x,y,z-.012),(w,h,.004),black,.006),root)
# Rectangular yoke: continuous sculpted ring, flat faces and broad leather grips.
def roundrect(cx,cy,w,h,r,z):
 pts=[]
 for xx,yy,start in [(cx+w/2-r,cy+h/2-r,0),(cx-w/2+r,cy+h/2-r,90),(cx-w/2+r,cy-h/2+r,180),(cx+w/2-r,cy-h/2+r,270)]:
  for i in range(9):a=math.radians(start+i*90/8);pts.append((xx+r*math.cos(a),yy+r*math.sin(a),z))
 return pts
def ring(name,cx,cy,z,w,h,r,thick,depth,material):
 outer=roundrect(cx,cy,w,h,r,z);inner=roundrect(cx,cy,w-2*thick,h-2*thick,max(.008,r-thick),z);N=len(outer);vs=[]
 for zz in [z-depth/2,z+depth/2]:
  for contour in [outer,inner]:vs.extend([(x,y,zz) for x,y,_ in contour])
 fs=[]
 for i in range(N):
  j=(i+1)%N;fs.extend([(i,j,N+j,N+i),(2*N+i,3*N+i,3*N+j,2*N+j),(i,2*N+i,2*N+j,j),(N+i,N+j,3*N+j,3*N+i)])
 return mesh(name,vs,fs,material,True,.002)
yoke=empty('Yoke',(-.46,.15,.28))
parent(ring('Closed leather yoke',-.46,.15,.28,.438,.276,.065,.031,.044,leather),yoke)
parent(ring('Yoke thin satin perimeter',-.46,.15,.254,.441,.279,.065,.011,.006,white),yoke)
for side in [-1,1]:
 parent(cube('Yoke tactile thumb spoke',(-.46+side*.123,.15,.269),(.095,.055,.025),leather,.015),yoke)
 parent(cube('Yoke scroll control',(-.46+side*.133,.153,.247),(.023,.017,.008),metal,.006),yoke)
 parent(cube('Yoke touch icon',(-.46+side*.133,.188,.245),(.024,.003,.002),white,.001),yoke)
# Shield-shaped center airbag rather than a round box.
verts=[]
outline=[(-.105,.06),(-.07,.085),(.07,.085),(.105,.06),(.076,-.058),(.042,-.086),(-.042,-.086),(-.076,-.058)]
for zz in [.235,.30]:verts.extend([(-.46+x,.15+y,zz) for x,y in outline])
faces=[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8)for i in range(8)]
parent(mesh('Shield airbag pad',verts,faces,leather,False,.013),yoke)
# Small neutral badge, not a fabricated manufacturer control label.
# The center pad is deliberately unbadged.
cube('Steering column',(-.46,.12,.48),(.14,.13,.34),leather,.025)
cube('Pedal_Accelerator',(-.52,-.17,.88),(.066,.15,.025),metal,.009)
cube('Pedal_Brake',(-.34,-.16,.88),(.12,.09,.028),metal,.009)
for side in [-1,1]:
 mesh('Dark interior window ledge',[(side*.68,.265,.82),(side*.90,.265,.82),(side*.90,.289,-.86),(side*.68,.289,-.86)],[(0,1,2,3)],leather)
# Center backbone: slender white padded arch, dark equipment tunnel.
cube('Center console dark tunnel',(0,-.12,-.20),(.24,.25,1.52),leather,.065)
cube('Ultrawhite console bridge',(0,.008,-.45),(.28,.12,.83),white,.055)
cube('Console controller',(0,.018,.22),(.17,.10,.22),black,.025)
doorTrim=mat('Soft grey door surround',(.075,.083,.087),.82)
# Sculpted door planes, triangular handle voids, discreet red fiber.
for side in [-1,1]:
 x=side*.868
 cube('Door upper charcoal panel',(x,.15,-.06),(.105,.25,1.6),suede,.035)
 mesh('Angular inner door trim',[(x-side*.04,.13,-.77),(x-side*.10,-.07,-.56),(x-side*.10,-.07,.29),(x-side*.04,.13,.64),(x-side*.025,.22,.56),(x-side*.025,.21,-.70)],[(0,1,2,3,4,5)],doorTrim,False,.008)
 tube('Door silver handle surround',[(x-side*.065,.03,-.60),(x-side*.14,.02,-.35),(x-side*.13,.08,.15),(x-side*.065,.13,.40)],.009,metal)
 mesh('Door ambient reflected wash',[(x-side*.071,.10,-.70),(x-side*.075,.18,-.40),(x-side*.075,.18,.35),(x-side*.071,.125,.55),(x-side*.071,.09,.55),(x-side*.075,.145,.35),(x-side*.075,.145,-.40),(x-side*.071,.07,-.70)],[(0,1,6,7),(1,2,5,6),(2,3,4,5)],mat('Soft indirect red wash',(.07,.002,.001),.85),False)
 tube('Door subtle red fiber',[(x-side*.052,.105,-.70),(x-side*.055,.17,-.40),(x-side*.055,.17,.35),(x-side*.052,.12,.55)],.0022,ambient)
 cube('Door padded armrest',(x-side*.10,-.028,-.16),(.14,.07,.80),leather,.027)
 cube('White seat side sill',(side*.76,-.17,-.38),(.13,.12,.90),white,.04)
# Contoured buckets: wide perforated white centers and charcoal support wings.
for x in [-.46,.46]:
 cube('Ultrawhite seat cushion',(x,-.175,-.52),(.45,.12,.61),white,.058)
 for side in [-1,1]:
  cube('Support bolster cushion',(x+side*.20,-.125,-.51),(.09,.13,.55),suede,.038)
 back=cube('Ultrawhite fixed backrest',(x,.12,-.87),(.40,.59,.10),white,.047);back.rotation_euler.x=math.radians(-11)
 for side in [-1,1]:
  o=cube('Support bolster shoulder',(x+side*.197,.105,-.82),(.095,.54,.14),suede,.04);o.rotation_euler.x=math.radians(-11)
 cube('Integrated head restraint',(x,.476,-.96),(.28,.20,.105),white,.038)
 # Perforation marks share one removable mesh per seat.
 vv=[];ff=[]
 for row in range(13):
  for col in range(7):
   xx=x+(col-3)*.036;zz=-.76+row*.035;n=len(vv)
   vv.extend([(xx-.001,-.113,zz-.0015),(xx+.001,-.113,zz-.0015),(xx+.001,-.113,zz+.0015),(xx-.001,-.113,zz+.0015)]);ff.append((n,n+1,n+2,n+3))
 o=mesh('Ultrawhite seat perforation',vv,ff,suede,False);o.location.x=x;o.data.transform(__import__('mathutils').Matrix.Translation((-x,0,0)))
# Real mirror is mounted under the header, high enough to preserve visibility.
cube('Mirror stem',(0,.657,.28),(.021,.10,.021),leather,.005)
cube('Rear mirror enclosure',(0,.595,.30),(.257,.07,.025),leather,.010)
cube('Screen_Mirror',(0,.595,.284),(.235,.051,.004),black,.005)
# Export is atomic so a live dev browser never fetches a partial GLB.
assets=[o for o in scene.objects if o.type in {'MESH','CURVE','EMPTY'}]
bpy.ops.object.select_all(action='DESELECT')
for o in assets:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=ROOT+'/public/assets/vehicle.next.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True,use_active_scene=True)
os.replace(ROOT+'/public/assets/vehicle.next.glb',ROOT+'/public/assets/vehicle.glb')
# Independent studio renders document the authored model as well as driver view.
world=bpy.data.worlds.new('Prototype soft studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.29,.34,1);world.node_tree.nodes['Background'].inputs[1].default_value=.7
for loc,power,size in [((2,3,3),650,5),((-3,2,-1),800,4),((1,2,-4),600,3)]:
 bpy.ops.object.light_add(type='AREA',location=p(loc));o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(p((0,.1,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=p((4,2.0,5.7)));cam=bpy.context.object;scene.camera=cam;cam.rotation_euler=(p((0,.08,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=48
cube('Studio floor',(0,-.607,0),(200,.02,200),mat('Studio grey',(.055,.063,.072),.68),0)
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=1280;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/art/prototype-source.blend')
scene.render.filepath=ROOT+'/art/exterior-qa.png';bpy.ops.render.render(write_still=True)
cam.location=p((-.46,.47,-.48));cam.rotation_euler=(p((-.46,.445,10))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=24/(2*math.tan(math.radians(64/2)));cam.data.clip_start=.025
scene.render.filepath=ROOT+'/art/cockpit-qa.png';bpy.ops.render.render(write_still=True)
print('Prototype authored:',len(assets),'objects; closed canopy / forged wheels / four nozzles / charcoal cabin')
