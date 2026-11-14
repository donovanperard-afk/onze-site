#!/usr/bin/env python3
# Build GitHub Pages tree (prefix /onze-site/) into OUT/onze-site
import os,re,shutil,sys,glob
R='/home/kit/work/onze-v2'; OUT=sys.argv[1] if len(sys.argv)>1 else '/home/kit/work/r12/dist'
P='/onze-site'
d=OUT+P
shutil.rmtree(OUT,ignore_errors=True); os.makedirs(d)
skip={'shots','scripts','.git','node_modules'}
for root,dirs,files in os.walk(R):
    dirs[:]=[x for x in dirs if x not in skip and not x.endswith('.md')]
    for f in files:
        if f.endswith(('.md','.py')) or f=='goal-frame.webp': continue
        s=os.path.join(root,f); t=os.path.join(d,os.path.relpath(s,R)); os.makedirs(os.path.dirname(t),exist_ok=True)
        if f.endswith(('.html','.css')):
            x=open(s,encoding='utf-8').read()
            x=re.sub(r'((?:href|src|url)=")/(?!/)',lambda m:m.group(1)+P+'/',x)
            x=re.sub(r'(content="0;url=)/',lambda m:m.group(1)+P+'/',x)
            x=re.sub(r"url\('/",f"url('{P}/",x)
            open(t,'w',encoding='utf-8').write(x)
        else: shutil.copy(s,t)
print('built',d)
