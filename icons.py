from PIL import Image, ImageDraw
def make(size, scale, path):
    S = 2048
    im = Image.new('RGB', (S, S), (0, 0, 0)); d = ImageDraw.Draw(im)
    cw, ch, gap = 520*scale, 760*scale, 150*scale
    total = cw*2 + gap; x0 = (S-total)/2; y0 = (S-ch)/2; r = 90*scale
    for i in range(2):
        x = x0 + i*(cw+gap)
        d.rounded_rectangle([x-4, y0-4, x+cw+4, y0+ch+4], r+4, fill=(60, 60, 60))
        d.rounded_rectangle([x, y0, x+cw, y0+ch], r, fill=(22, 22, 22))
        d.rounded_rectangle([x, y0, x+cw, y0+ch/2], r, fill=(34, 34, 34))
        d.rectangle([x, y0+ch/2-r, x+cw, y0+ch/2], fill=(34, 34, 34))
        d.rectangle([x, y0+ch/2, x+cw, y0+ch/2+r], fill=(22, 22, 22))
        d.rectangle([x-6, y0+ch/2-8*scale, x+cw+6, y0+ch/2+8*scale], fill=(0, 0, 0))
        # simple bold digit-like bar glyph
        bw = 70*scale; cx = x+cw/2
        d.rounded_rectangle([cx-bw/2, y0+150*scale, cx+bw/2, y0+ch-150*scale], bw/2, fill=(255, 255, 255))
    cx = S/2; dot = 34*scale
    for dy in (-90*scale, 90*scale):
        d.ellipse([cx-dot, S/2+dy-dot, cx+dot, S/2+dy+dot], fill=(150, 150, 150))
    im.resize((size, size), Image.LANCZOS).save(path)
make(192, 1.0, 'icons/icon-192.png'); make(512, 1.0, 'icons/icon-512.png')
make(512, 0.62, 'icons/maskable-512.png'); make(180, 1.0, 'icons/apple-touch-icon.png'); make(32, 1.0, 'icons/favicon-32.png')
