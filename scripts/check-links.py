from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import urllib.request
root=Path('/files/onze-v2')
class P(HTMLParser):
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k in ('src','href') and v and v.startswith('/'):
    path=urlsplit(v).path; target=root/path.lstrip('/')
    if path.endswith('/'):target=target/'index.html'
    assert target.exists(),f'Missing {target}'
count=0
for f in root.rglob('*.html'):
 if '.git' in f.parts:continue
 P().feed(f.read_text());count+=1
print(f'{count} HTML pages, all local links and assets resolve.')
