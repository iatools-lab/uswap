from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8').replace(', viewport-fit=cover','').replace('width=device-width, initial-scale=1.0','width=device-width, initial-scale=1.0, viewport-fit=cover')
if 'rel="manifest"' not in s:
    s=s.replace('<title>', '<link rel="manifest" href="/manifest.webmanifest"/><link rel="apple-touch-icon" href="/icons/app-192.png"/><meta name="apple-mobile-web-app-title" content="uSwap"/><title>')
p.write_text(s,encoding='utf-8')
# Code-native application icon, derived from the existing uSwap lightning mark.
from PIL import Image, ImageDraw
out=Path('public/icons');out.mkdir(exist_ok=True)
for name,size in [('app-192.png',192),('app-512.png',512),('app-maskable.png',512)]:
    im=Image.new('RGB',(size,size),'#001A70');d=ImageDraw.Draw(im)
    d.rounded_rectangle((size*.19,size*.19,size*.81,size*.81),radius=size*.15,fill='#FD5716')
    points=[(.54,.27),(.34,.54),(.47,.54),(.43,.74),(.67,.44),(.53,.44)]
    d.polygon([(int(x*size),int(y*size)) for x,y in points],fill='white')
    im.save(out/name)
