from PIL import Image,ImageDraw,ImageFilter,ImageChops
from pathlib import Path
p=Path('/files/onze-v2/assets')
im=Image.open(p/'terrain.webp').convert('RGB'); w,h=im.size
# Extract the photograph's actual front frame and mesh, not an invented net.
lum=im.convert('L'); high=ImageChops.subtract(lum,lum.filter(ImageFilter.GaussianBlur(2)))
a=high.point(lambda x:min(220,max(0,(x-2)*18)))
region=Image.new('L',im.size);d=ImageDraw.Draw(region)
d.polygon([(int(x*w),int(y*h)) for x,y in [(0.695,.333),(.992,.288),(.991,.552),(.695,.516)]],fill=255)
a=ImageChops.multiply(a,region)
out=im.convert('RGBA');out.putalpha(a);out.save(p/'goal-net.webp',lossless=True)
def svg(name,body,bg='#e7e8df'):
 (p/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1100"><rect width="1000" height="1100" fill="{bg}"/>{body}</svg>')
svg('project-identity.svg','<path d="M110 110h780v880H110z" fill="#2449e8"/><g fill="none" stroke="#f2f1e9" stroke-width="6"><path d="M230 260h540v530H230zM500 260v530"/><circle cx="500" cy="525" r="100"/><path d="M230 400h90v250h-90m540-250h-90v250h90"/></g><text x="500" y="205" text-anchor="middle" font-family="sans-serif" font-size="62" fill="#f2f1e9" font-weight="800">ONZE CONTRE ONZE</text><text x="500" y="900" text-anchor="middle" font-family="sans-serif" font-size="125" fill="#f2f1e9" font-weight="800">11:11</text>')
svg('project-motion.svg','<g fill="none" stroke="#eef0df" stroke-width="24"><ellipse cx="500" cy="550" rx="370" ry="180" transform="rotate(-35 500 550)"/><ellipse cx="500" cy="550" rx="280" ry="135" transform="rotate(-35 500 550)"/><ellipse cx="500" cy="550" rx="180" ry="85" transform="rotate(-35 500 550)"/></g><circle cx="500" cy="550" r="50" fill="#eef0df"/>', '#ec542f')
svg('project-edition.svg','<g fill="#18211b"><text x="70" y="190" font-family="serif" font-size="150" font-style="italic">Le jeu</text><text x="65" y="365" font-family="sans-serif" font-size="150" font-weight="800">SE JOUE</text><text x="70" y="530" font-family="serif" font-size="150" font-style="italic">aussi</text><text x="65" y="705" font-family="sans-serif" font-size="150" font-weight="800">AILLEURS.</text></g><path d="M80 800h840M80 830h840M80 860h840M80 890h840M80 920h840M80 950h840" stroke="#2449e8" stroke-width="12"/>')
svg('project-shirt.svg','<path d="M300 260 160 330l-95 205 170 80 65-100v400h400V515l65 100 170-80-95-205-140-70q-200 125-400 0" fill="#f2f1e9"/><text x="500" y="660" text-anchor="middle" font-size="175" font-family="sans-serif" font-weight="800" fill="#2449e8">11</text>', '#2449e8')
for color,fill,ink in [('blanc','#f3f1e7','#2449e8'),('noir','#202920','#f2f1e9')]:
 svg('tee-'+color+'.svg',f'<path d="M335 215 180 300 95 490 260 565 315 455v470h370V455l55 110 165-75-85-190-155-85q-165 110-330 0" fill="{fill}" stroke="#acb0a4" stroke-width="3"/><text x="500" y="565" text-anchor="middle" font-size="115" font-family="sans-serif" font-weight="800" fill="{ink}">onze.</text><text x="500" y="600" text-anchor="middle" font-size="17" letter-spacing="5" font-family="sans-serif" fill="{ink}">CULTURE FOOTBALL</text>')
