"""Generate committed PWA icons from the UI's open-circle and plus mark (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent / 'public'
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="19" fill="#4f46e5"/><g transform="translate(8 8) scale(1.5)" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><path d="M23 9a10 10 0 1 0 0 14"/><path d="M16 11v10m-5-5h10" stroke-width="3"/></g></svg>'
(root / 'favicon.svg').write_text(svg)
(root / 'icons').mkdir(exist_ok=True)
for name,size in [('icon-192',192),('icon-512',512),('apple-touch-icon',180),('maskable-512',512)]:
    n=size*4
    image=Image.new('RGBA',(n,n))
    draw=ImageDraw.Draw(image)
    maskable=name.startswith('maskable')
    draw.rounded_rectangle((0,0,n-1,n-1),radius=0 if maskable else n*19/64,fill='#4f46e5')
    scale=n*(1.2 if maskable else 1.5)/64
    offset=n*(12.8 if maskable else 8)/64
    point=lambda x,y:(round(offset+x*scale),round(offset+y*scale))
    box=(*point(6,6),*point(26,26))
    draw.arc(box,45,315,fill='white',width=round(4*scale))
    import math
    for angle in [45,315]:
        x=16+10*math.cos(math.radians(angle)); y=16+10*math.sin(math.radians(angle))
        draw.ellipse((*point(x-2,y-2),*point(x+2,y+2)),fill='white')
    for a,b in [((16,11),(16,21)),((11,16),(21,16))]:
        draw.line((point(*a),point(*b)),fill='white',width=round(3*scale))
        for x,y in [a,b]: draw.ellipse((*point(x-1.5,y-1.5),*point(x+1.5,y+1.5)),fill='white')
    image.resize((size,size),Image.Resampling.LANCZOS).save(root/'icons'/f'{name}.png')
