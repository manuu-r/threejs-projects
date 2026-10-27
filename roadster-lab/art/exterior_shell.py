"""Continuous reference-led exterior. Executed by build_cockpit.py.
Body stations, crown and rolled arch returns share boundary vertices. The
canopy uses formed panels rather than a tube cage. Dimensions are inferred.
"""
def smooth(z,rows):
 # Shape-preserving cubic Hermite interpolation avoids kinks between stations.
 if z<=rows[0][0]:return rows[0][1]
 if z>=rows[-1][0]:return rows[-1][1]
 slopes=[(rows[i+1][1]-rows[i][1])/(rows[i+1][0]-rows[i][0]) for i in range(len(rows)-1)]
 tangents=[slopes[0]]+[0 if slopes[i-1]*slopes[i]<=0 else 2/(1/slopes[i-1]+1/slopes[i]) for i in range(1,len(rows)-1)]+[slopes[-1]]
 for i,(a,b) in enumerate(zip(rows,rows[1:])):
  if a[0]<=z<=b[0]:
   d=b[0]-a[0];t=(z-a[0])/d
   return (2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*d*tangents[i]+(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*d*tangents[i+1]
def surface(name,fn,nu,nv,material,reverse=False,thickness=0):
 vv=[fn(i/nu,j/nv)for j in range(nv+1)for i in range(nu+1)];ff=[]
 for j in range(nv):
  for i in range(nu):
   a=j*(nu+1)+i;face=(a,a+1,a+nu+2,a+nu+1);ff.append(tuple(reversed(face)) if reverse else face)
 o=mesh(name,vv,ff,material)
 if thickness:
  m=o.modifiers.new('Closed panel return','SOLIDIFY');m.thickness=thickness;m.offset=-1
 return o
widths=[(-2.38,.96),(-2.17,1.015),(-1.42,1.045),(-.6,.985),(.42,.98),(1.4,1.045),(1.95,1.025),(2.32,.995),(2.40,.935)]
heights=[(-2.38,.235),(-2.1,.30),(-1.4,.365),(-.75,.32),(.4,.275),(1.38,.355),(1.94,.285),(2.4,.145)]
def inner(z):return smooth(z,[(1,.615),(1.94,.695),(2.4,.745)]) if z>=1 else .685
def crown(z):
 w=smooth(z,widths);h=smooth(z,heights);xi=inner(z)
 return [(xi,h-.025),(xi+(w-xi)*.46,h+.012),(w-.026,h-.004),(w,h-.047)]
def crown_y(x,z):
 pts=crown(z)
 return smooth(x,[(a,b)for a,b in pts])
def arch(z):
 bottom=-.34
 for c in [-1.4,1.4]:
  d=abs(z-c)
  if d<.372:bottom=max(bottom,-.255+math.sqrt(.372**2-d*d))
 return bottom
def side_xy(t,z):
 w=smooth(z,widths);h=smooth(z,heights)-.047;b=arch(z);lift=max(0,min(1,(b+.34)/.45))
 y=h*(1-t)+b*t;x=w+.006*math.sin(t*math.pi)-.037*t*t*(1-lift)
 return x,y
# Unified upper crown + side surface. The inward return creates panel thickness.
for sign in [-1,1]:
 zs=sorted(set([-2.38+i*4.78/240 for i in range(241)]+[-1.78,-.72,1.0]))
 vv=[];ff=[];N=16
 for z in zs:
  pts=crown(z)+[side_xy(j/10,z)for j in range(1,11)]
  x,y=pts[-1];pts.extend([(x-.015,y+.002),(x-.085,y+.014)])
  vv.extend([(sign*x,y,z)for x,y in pts])
 for j in range(len(zs)-1):
  for i in range(N-1):
   # Rear haunch takes over the crown through the flying-buttress region.
   # The underlying crown remains inside the quarter panel as a sealed return.
   a=j*N+i;f=(a,a+N,a+N+1,a+1);ff.append(f if sign<0 else tuple(reversed(f)))
 o=mesh('Body continuous shoulder and side',vv,ff,paint)
 o.data.materials.append(leather)
 for face in o.data.polygons:
  center=face.center
  # Blender's -Y is forward in the authored Three-coordinate model.
  xyz=[vv[i] for i in face.vertices];zmid=sum(v[2]for v in xyz)/len(xyz);xmid=sum(abs(v[0])for v in xyz)/len(xyz)
  if -.72<zmid<.98 and xmid<.86:face.material_index=1
 # Deep rolled wheel returns meet the shell exactly, with no floating arch rings.
 for zc in [-1.4,1.4]:
  def rolled(u,v,zc=zc,sign=sign):
   a=math.pi*u;z=zc+.372*math.cos(a);y=-.255+.372*math.sin(a);xx,_=side_xy(1,z)
   return sign*(xx-.105*v),y-.002*math.sin(v*math.pi),z
  surface('Integral wheel arch return',rolled,80,5,paint,sign<0)
  def liner(u,v,zc=zc,sign=sign):
   a=math.pi*u;return sign*(.75+.23*v),-.255+.365*math.sin(a),zc+.365*math.cos(a)
  surface('Deep wheel well',liner,64,3,carbon)
 # A fitted dark rocker follows the underside, rather than projecting as a rail.
 surface('Carbon rocker skirt',lambda u,v,s=sign:(s*(.951+.036*v),-.34-.018*math.sin(v*math.pi),-.99+1.97*u),36,4,carbon)
 # A quiet, properly fitted door perimeter with no high curvature overshoots.
 points=[]
 for z,y in [(.86,.285),(.77,.12),(.66,-.12),(.55,-.27),(-.54,-.27),(-.76,-.20),(-.94,.06),(-1.0,.32)]:
  bottom=arch(z);top=smooth(z,heights)-.047;t=max(0,min(1,(top-y)/(top-bottom)));xx,_=side_xy(t,z);points.append((sign*(xx+.001),y,z))
 seam=tube('Door panel fine gap',points,.0012,carbon)
 for bp in seam.data.splines[0].bezier_points:bp.handle_left_type=bp.handle_right_type='VECTOR'
 # Small flush release in the body crease.
 x,_=side_xy(.13,-.48);cube('Flush door release',(sign*(x+.002),.235,-.48),(.004,.012,.115),carbon,.005)
# Broad, gently crowned trapezoid bonnet, with exactly shared fender boundaries.
def bonnet(u,v):
 z=1+1.40*v;w=inner(z);x=(u*2-1)*w;edge=crown(z)[0][1]
 return x,edge+.009*(1-(x/w)**2),z
surface('Bonnet formed central panel',bonnet,48,64,paint)
for sign in [-1,1]:tube('Bonnet precision gap',[(sign*inner(z),crown(z)[0][1]+.0005,z)for z in [1+i*1.40/32 for i in range(33)]],.0008,carbon)
# Flush triangular lenses conform to the curved crown. Nothing overlaps the bonnet.
lens=mat('Smoked headlamp lens',(.008,.012,.016),.11,.32)
for sign in [-1,1]:
 A=(.713,2.025);B=(.967,1.987);C=(.774,2.325)
 vv=[];ff=[];rows=18
 # Triangulated barycentric patch follows the same height function as the shell.
 idx={}
 for j in range(rows+1):
  for i in range(rows-j+1):
   u=i/rows;v=j/rows;x=A[0]*(1-u-v)+B[0]*u+C[0]*v;z=A[1]*(1-u-v)+B[1]*u+C[1]*v
   idx[(i,j)]=len(vv);vv.append((sign*x,crown_y(x,z)+.0035,z))
 for j in range(rows):
  for i in range(rows-j):
   ff.append((idx[(i,j)],idx[(i+1,j)],idx[(i,j+1)]))
   if i<rows-j-1:ff.append((idx[(i+1,j)],idx[(i+1,j+1)],idx[(i,j+1)]))
 mesh('Flush triangular light cover',vv,ff,paint)
 for first,last in [(A,B),(B,C),(C,A)]:
  tube('Light cover precision gap',[(sign*(first[0]*(1-t)+last[0]*t),crown_y(first[0]*(1-t)+last[0]*t,first[1]*(1-t)+last[1]*t)+.004,first[1]*(1-t)+last[1]*t) for t in [i/20 for i in range(21)]],.0008,carbon)
# Sculpted full-width nose. Separate carbon surfaces meet the folded white corners.
def front_z(x,y):return 2.405-.095*(abs(x)/1.035)**5-.026*max(0,(-y-.1)/.2)
for sign in [-1,1]:
 def cheek(u,v,s=sign):
  y=.145-.455*v;xi=.745+.045*v;xo=.935+.045*math.sin(v*math.pi);x=xi*(1-u)+xo*u
  return s*x,y,front_z(x,y)
 surface('Front folded outer bumper',cheek,12,24,paint,sign<0,thickness=.008)
fascia=mat('Carbon aero nose',(.009,.012,.014),.34,.23)
surface('Front closed aero fascia',lambda u,v:((u*2-1)*(.745+.022*v),.133-.29*v,front_z((u*2-1)*(.745+.022*v),.133-.29*v)+.001),64,16,fascia,True,.012)
surface('Lower inlet shadow',lambda u,v:((u*2-1)*(.765+.04*v),-.157-.128*v,front_z((u*2-1)*(.765+.04*v),-.157-.128*v)-.009),48,6,carbon,True)
# Thin white blade, convex in plan like the photographed front lip.
tube('Front signature white blade',[(x,.133,front_z(x,.133)+.003)for x in [-.745+i*1.49/40 for i in range(41)]],.003,led)
for yy in [-.175,-.207,-.239]:tube('Recessed front aero vane',[(x,yy,front_z(x,yy)-.004)for x in [-.76+i*1.52/24 for i in range(25)]],.0025,carbon)
surface('Integrated carbon splitter',lambda u,v:((u*2-1)*(.94+.025*math.sin(v*math.pi)),-.303-.012*math.sin(v*math.pi),2.27+.15*v-.085*abs(u*2-1)**5),64,6,carbon,False,.012)
# Rear haunches wrap around the narrowing fastback glazing.
roofBlack=mat('Bronze ceramic roof',(.010,.008,.007),.12,.35)
roofBlack.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.65
for sign in [-1,1]:
 def quarter(u,v,s=sign):
  xi=.70*(1-v)+.53*v;drop=v-v*(1-v)**6;yi=.735*(1-drop)+.278*drop;zi=-.72-1.06*v
  zo=-1.18-.60*v;xo=.905*(1-v)+smooth(zo,widths)*v;yo=crown_y(xo,zo)+.004*(1-v)
  return s*(xi*(1-u)+xo*u),yi*(1-u)+yo*u+.008*math.sin(u*math.pi),zi*(1-u)+zo*u
 surface('Broad rear flying shoulder',quarter,32,48,paint,sign>0)
# Rear trunk resolves the glass taper into the horizontal tail.
def deck(u,v):
 z=-1.78-.60*v;w=.53*(1-v)+inner(z)*v;x=(u*2-1)*w
 return x,.278*(1-v)+.210*v+.006*(1-(x/w)**2),z
surface('Rear central deck',deck,40,24,paint,True)
# Fill outside the narrow tail end of the fastback, with no open triangles.
for sign in [-1,1]:
 surface('Rear deck infill',lambda u,v,s=sign:(s*((.53*(1-v)+inner(-1.78-.60*v)*v)*(1-u)+inner(-1.78-.60*v)*u),(.278*(1-v)+.210*v)*(1-u)+crown(-1.78-.60*v)[0][1]*u,-1.78-.60*v),16,24,paint)
# Molded canopy: curved glazing, solid roof, broad pillars, no round cage members.
glass=mat('Bronze optical canopy',(.010,.008,.007),.10,.35)
glass.diffuse_color=(.010,.008,.007,.97);glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.97
if hasattr(glass,'surface_render_method'):glass.surface_render_method='DITHERED'
def windshield(u,v):
 w=.858*(1-v)+.702*v;x=(u*2-1)*w
 rise=v+v**6*(1-v)
 y=(.286+.007*(1-(x/w)**2))*(1-rise)+(.735+.014*(1-(x/w)**2))*rise
 z=1.035*(1-v)+(.225+.11*(1-(x/w)**2))*v+.042*(1-(x/w)**2)*math.sin(v*math.pi)
 return x,y,z
surface('Curved panoramic windshield',windshield,64,32,glass,False)
# The pillar is a formed, closed ribbon with a charcoal inner face.
for sign in [-1,1]:
 def pillar(u,v,s=sign):
  x,y,z=windshield(1 if s>0 else 0,v)
  return x-s*(.004+.035*u),y-.005*u,z-.030*u
 surface('Formed windshield pillar exterior',pillar,6,40,roofBlack,sign<0,.012)
 surface('Windshield pillar inner upholstery',lambda u,v,s=sign:(pillar(u,v,s)[0]-s*.006,pillar(u,v,s)[1]-.012,pillar(u,v,s)[2]-.008),6,40,suede,sign>0,.008)
 # Glazing follows the side taper into a small triangular quarter window.
 def sideglass(u,v,s=sign):
  front=(.858,.286,1.035);topfront=(.702,.735,.225);toprear=(.700,.735,-.72);rearlow=(.905,crown_y(.905,-1.18)+.004,-1.18)
  low=[front[k]*(1-u)+rearlow[k]*u for k in range(3)];high=[topfront[k]*(1-u)+toprear[k]*u for k in range(3)]
  pt=[low[k]*(1-v)+high[k]*v for k in range(3)];pt[1]+=(high[1]-low[1])*v**6*(1-v)*(1-u);pt[0]+=.009*math.sin(u*math.pi)*math.sin(v*math.pi)
  return s*pt[0],pt[1],pt[2]
 surface('Sculpted side canopy glass',sideglass,40,20,glass,sign<0)
 surface('Flush side window lower seal',lambda u,v,s=sign:(sideglass(u,0,s)[0],sideglass(u,0,s)[1]-.008*v,sideglass(u,0,s)[2]),40,2,carbon)
# One continuous exterior roof. Three sewn interior panels sit immediately beneath.
def roof(u,v):
 w=.702+.007*math.sin(v*math.pi);x=(u*2-1)*w;z=(.225+.11*(1-(x/w)**2))*(1-v)-.72*v
 return x,.735+.014*(1-(x/w)**2)+.010*math.sin(v*math.pi),z
surface('One piece ceramic roof',roof,48,36,roofBlack,False,.015)
for a,b in [(0,.32),(.33,.67),(.68,1)]:surface('Sewn suede headliner',lambda u,v,a=a,b=b:(roof(a+(b-a)*u,v)[0],roof(a+(b-a)*u,v)[1]-.027,roof(a+(b-a)*u,v)[2]),14,24,suede,True,.004)
surface('Molded windshield inner header',lambda u,v:(windshield(u,1)[0],windshield(u,1)[1]-.008-.026*v,.225-.045*v),48,4,suede,True,.008)
def rearwindow(u,v):
 w=.70*(1-v)+.53*v;x=(u*2-1)*w
 drop=v-v*(1-v)**6
 return x,.735*(1-drop)+.278*drop+.014*(1-(x/w)**2),-.72-1.06*v
surface('Tapered fastback rear canopy',rearwindow,48,32,glass,True)
# Reference uses flush side camera modules rather than projecting mirror pods.
marker=emit('Soft amber side marker',(.32,.095,.012),1.3)
for sign in [-1,1]:
 cube('Flush side camera module',(sign*1.008,.185,.87),(.012,.035,.155),carbon,.006)
 cube('Amber side repeater',(sign*1.016,.187,.87),(.003,.008,.065),marker,.002)
# Folded tail bumper with a recessed center and properly rounded corner returns.
def tail(u,v):
 x=(u*2-1)*(.962-.025*v);y=.192-.325*v
 z=-2.393+.065*abs(u*2-1)**5+.034*math.sin(v*math.pi)*(1-abs(u*2-1))
 return x,y,z
surface('Sculpted rear bumper return',tail,64,20,paint,False,.012)
tube('Full width red rear light',[(x,.205,-2.404+.065*(abs(x)/.964)**5)for x in [-.964+i*1.928/64 for i in range(65)]],.0042,red)
surface('Tail lamp shadow channel',lambda u,v:((u*2-1)*.965,.196+.025*v,-2.402+.065*abs(u*2-1)**5),64,3,black)
cube('Recessed license plate',(0,.011,-2.409),(.34,.14,.008),white,.008)
# Rear gas outlets are small warm metal bells above four visible blower shrouds.
nozzleMetal=mat('Warm Inconel gas outlets',(.23,.18,.115),.31,.86)
for x in [-.57,-.19,.19,.57]:
 lathe('Rear cold gas bell',[(.07,.027),(.015,.030),(-.035,.044),(-.045,.044),(-.045,.038),(.035,.023)],'z',(x,-.132,-2.40),nozzleMetal,48)
 lathe('Nozzle black throat',[(.03,.023),(.031,0)],'z',(x,-.132,-2.40),black,32)
 lathe('Rear blower shroud',[(.06,.107),(-.03,.113),(-.04,.112),(-.04,.101),(.05,.094)],'z',(x,-.292,-2.33),carbon,48)
 lathe('Rear blower hub',[(-.036,.026),(-.046,0)],'z',(x,-.292,-2.33),carbon,24)
 for i in range(9):
  a=i*math.tau/9;vv=[]
  for r,da in [(.03,0),(.098,.16),(.098,.50),(.035,.42)]:vv.append((x+r*math.cos(a+da),-.292+r*math.sin(a+da),-2.36))
  mesh('Blower impeller blade',vv,[(0,1,2,3)],carbon,False)
# Integrated diffuser frame with recessed pockets and shaped vertical walls.
for sign in [-1,1]:
 surface('Diffuser folded outer ramp',lambda u,v,s=sign:(s*(.82+.12*u),-.12-.30*v,-2.35+.12*u-.035*math.sin(v*math.pi)),6,14,carbon,sign>0,.012)
surface('Diffuser lower floor',lambda u,v:((u*2-1)*(.84+.03*v),-.422+.018*math.sin(v*math.pi),-2.12-.29*v),48,8,carbon,False,.009)
for x in [-.83,-.38,0,.38,.83]:
 o=mesh('Diffuser structural vane',[(x,-.42,-2.10),(x,-.42,-2.41),(x,-.21,-2.39),(x,-.14,-2.15)],[(0,1,2,3)],carbon,False);o.modifiers.new('Fin laminate thickness','SOLIDIFY').thickness=.008
# Active wing has real section depth and a stowed trailing edge.
aero=empty('Active_Aero',(0,.235,-2.21))
wing=surface('Active aero formed wing',lambda u,v:((u*2-1)*.935,.235+.018*math.sin(v*math.pi)-.009*(u*2-1)**2,-2.10-.25*v),64,12,paint,False,.014);parent(wing,aero)
for sign in [-1,1]:
 for z in [-1.3,1.3]:
  cube('Underbody lift port',(sign*.84,-.285,z),(.15,.034,.18),carbon,.018)
