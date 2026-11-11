from playwright.sync_api import sync_playwright
from pathlib import Path
import json
root=Path('/files/onze-v2/shots');root.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/opt/hako/bin/google-chrome',args=['--no-sandbox'])
 results=[]
 for name,w,h in [('desktop',1440,900),('mobile',390,844),('tablet',768,1024)]:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:52743/',wait_until='networkidle');page.screenshot(path=str(root/f'{name}-start.png'))
  for state,t in [('mid',.5),('end',1)]:
   page.evaluate('(t)=>scrollTo(0,(document.querySelector(".hero-track").offsetHeight-innerHeight)*t)',t)
   page.wait_for_timeout(120);page.screenshot(path=str(root/f'{name}-{state}.png'))
  for route,key in [('/portfolio/','portfolio'),('/portfolio/identite/','project'),('/shop/','shop'),('/shop/t-shirt-blanc/','product'),('/shop/vestiaire/','vestiaire')]:
   page.goto('http://127.0.0.1:52743'+route,wait_until='networkidle');page.screenshot(path=str(root/f'{name}-{key}.png'),full_page=True)
   overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth')
   results.append({'viewport':name,'route':route,'overflow':overflow,'errors':errors.copy()})
  page.goto('http://127.0.0.1:52743/shop/t-shirt-blanc/')
  page.get_by_role('button',name='XL',exact=True).click()
  assert page.locator('#chosen-size').inner_text()=='XL'
  page.locator('[data-contact]:visible').first.click();assert page.locator('dialog').is_visible()
  page.keyboard.press('Escape');assert not page.locator('dialog').is_visible()
  page.close()
 reduced=b.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
 reduced.goto('http://127.0.0.1:52743/',wait_until='networkidle');reduced.screenshot(path=str(root/'mobile-reduced.png'))
 results.append({'reducedHeroHeight':reduced.locator('.hero-track').evaluate('(e)=>e.offsetHeight')})
 print(json.dumps(results,indent=2))
 (root/'qa.json').write_text(json.dumps(results,indent=2))
 b.close()
