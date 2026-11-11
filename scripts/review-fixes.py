from pathlib import Path
import re, math
from PIL import Image,ImageDraw,ImageFilter
r=Path('/files/onze-v2')
# One semantic headline and exactly the two destinations throughout the shot.
p=r/'scripts/build.py';s=p.read_text();s=re.sub(r'<div class="scene-end">.*?</div>', '', s);s=s.replace('<div class="ground-shadow"','<img class="net-contact" src="/assets/net-contact.webp" alt="" width="128" height="128"><img class="net-impact" src="/assets/net-impact.webp" alt="" width="128" height="128"><div class="ground-shadow"');p.write_text(s)
# Correct both generated assets and their source, so regeneration is safe.
p=r/'scripts/prepare-graphics.py';s=p.read_text();s=s.replace('<ellipse cx="500" cy="985" rx="270" ry="25" fill="#c8cabe"/>','').replace('<path d="M405 236q95 75 190 0" fill="none" stroke="#9a9e91" stroke-width="8"/>','');p.write_text(s)
for p in (r/'assets').glob('tee-*.svg'):
 s=p.read_text();s=re.sub(r'<ellipse[^>]*/>','',s);s=re.sub(r'<path d="M405 236[^>]*/>','',s);p.write_text(s)
# Localized warped photographic net plus diffuse contact shadow.
im=Image.open('/files/sky_v1_01a1c871-f23c-76cb-a643-0adaf84eec45.png').convert('RGB')
cx,cy,n=2199,733,128
patch=Image.new('RGBA',(n,n));pix=patch.load()
for y in range(n):
 for x in range(n):
  dx=x-n/2;dy=y-n/2;rr=math.hypot(dx,dy)
  pull=math.exp(-(rr/31)**2)
  sx=int(cx+dx-110*pull);sy=int(cy+dy-10*pull)
  rgb=im.getpixel((sx,sy));shadow=.18*math.exp(-(((dx-5)/18)**2+((dy-5)/15)**2))
  alpha=int(255*max(0,min(1,(61-rr)/12)))
  pix[x,y]=tuple(int(c*(1-shadow)) for c in rgb)+(alpha,)
patch.save(r/'assets/net-impact.webp',lossless=True)

# Fine warped mesh threads pass in front of the impact point, the photo stays behind.
from PIL import ImageChops
lum=patch.convert('L'); detail=ImageChops.subtract(lum,lum.filter(ImageFilter.GaussianBlur(1.4)))
threads=patch.copy(); alpha=Image.new('L',(n,n));ap=alpha.load();dp=detail.load()
for y in range(n):
 for x in range(n):
  rr=math.hypot(x-n/2,y-n/2)
  ap[x,y]=int(min(120,max(0,(dp[x,y]-5)*12))*max(0,min(1,(29-rr)/12)))
threads.putalpha(alpha);threads.save(r/'assets/net-contact.webp',lossless=True)
