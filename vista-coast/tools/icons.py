"""Generate PWA icons (sunset coast skyline + 'VC') into dist/ and android res."""
import math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def make(size: int) -> Image.Image:
    S = size * 4
    img = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(img)
    # sunset gradient sky
    top, mid, bot = (38, 22, 74), (233, 96, 74), (255, 196, 110)
    for y in range(S):
        t = y / S
        if t < 0.55:
            k = t / 0.55
            c = tuple(int(top[i] + (mid[i] - top[i]) * k) for i in range(3))
        else:
            k = (t - 0.55) / 0.45
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * k) for i in range(3))
        d.line([(0, y), (S, y)], fill=c)
    # sun
    cx, cy, r = S * 0.5, S * 0.6, S * 0.2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 220, 140))
    # sea
    sea_y = int(S * 0.7)
    for y in range(sea_y, S):
        k = (y - sea_y) / (S - sea_y)
        d.line([(0, y), (S, y)], fill=(int(30 + 20 * (1 - k)), int(60 + 40 * (1 - k)), int(110 + 30 * (1 - k))))
    for i in range(8):
        y = sea_y + 8 * S / 512 + i * S * 0.035
        w = S * (0.18 - i * 0.015)
        d.rectangle([cx - w, y, cx + w, y + S * 0.008], fill=(255, 200, 130))
    # skyline silhouette
    import random
    random.seed(7)
    x = 0
    while x < S:
        w = random.randint(int(S * 0.04), int(S * 0.09))
        h = random.randint(int(S * 0.05), int(S * 0.28))
        if abs(x + w / 2 - S * 0.38) < S * 0.06:
            h = int(S * 0.36)
        d.rectangle([x, sea_y - h, x + w - S * 0.006, sea_y], fill=(24, 16, 40))
        x += w
    # palm tree
    px, py = S * 0.82, sea_y
    d.line([(px, py), (px - S * 0.03, py - S * 0.3)], fill=(20, 12, 30), width=int(S * 0.018))
    tx, ty = px - S * 0.03, py - S * 0.3
    for a in (-170, -135, -100, -70, -40, -10):
        ang = math.radians(a)
        ex = tx + math.cos(ang) * S * 0.12
        my = ty + math.sin(ang) * S * 0.05
        ey = ty + S * 0.05 + abs(math.cos(ang)) * S * 0.03
        d.line([(tx, ty), ((tx + ex) / 2, my), (ex, ey)], fill=(20, 12, 30), width=int(S * 0.014), joint='curve')
    # text
    font = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf', int(S * 0.3))
    txt = 'VC'
    bb = d.textbbox((0, 0), txt, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx0, ty0 = (S - tw) / 2 - bb[0], S * 0.12 - bb[1]
    shadow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(shadow).text((tx0 + S * 0.01, ty0 + S * 0.012), txt, font=font, fill=200)
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.01))
    img.paste((0, 0, 0), (0, 0), shadow)
    d.text((tx0, ty0), txt, font=font, fill=(255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'dist'
    os.makedirs(out, exist_ok=True)
    for s in (192, 512):
        make(s).save(os.path.join(out, f'icon-{s}.png'), optimize=True)
    print('icons ok')
