"""Share image for social posts (Facebook, LinkedIn): 1200 x 630, matching the website's hero.

Run: python marketing/social/build_banner.py  (needs Pillow; uses Windows fonts)
Writes banner.png next to this script (drawn at 2x, then downsampled for smooth edges).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
FONTS = Path('C:/Windows/Fonts')

S = 2  # draw at 2x
W, H = 1200 * S, 630 * S

# The site's palette (apps/site/public/styles.css).
PAPER = '#f7f3ea'
INK = '#23211c'
INK_SOFT = '#5d584e'
LINE = '#e2d9c6'
GREEN = '#1f8f3a'

serif_bold = lambda size: ImageFont.truetype(str(FONTS / 'palab.ttf'), size * S)
sans = lambda size: ImageFont.truetype(str(FONTS / 'segoeui.ttf'), size * S)
sans_bold = lambda size: ImageFont.truetype(str(FONTS / 'segoeuib.ttf'), size * S)

img = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(img)
X = 72 * S

# Brand: the green library (transparent artwork) and the name.
logo = Image.open(ROOT / 'apps/mobile/assets/adaptive-icon.png').convert('RGBA')
logo = logo.crop(logo.getbbox()).resize((44 * S, 56 * S), Image.LANCZOS)
img.paste(logo, (X, 58 * S), logo)
d.text((X + 58 * S, 64 * S), 'Novel Route', font=serif_bold(36), fill=INK)

# Headline, as on the website.
d.text((X, 168 * S), 'Street libraries near you.', font=serif_bold(58), fill=INK)
line2 = 'Find your next '
d.text((X, 240 * S), line2, font=serif_bold(58), fill=INK)
d.text((X + d.textlength(line2, font=serif_bold(58)), 240 * S), 'read.', font=serif_bold(58), fill=GREEN)

# Lede.
lede = ['Novel Route maps the street libraries around you and', 'keeps track of the ones you\'ve visited, so you always', 'know which shelves are due another look.']
for i, text in enumerate(lede):
    d.text((X, 346 * S + i * 34 * S), text, font=sans(22), fill=INK_SOFT)

# Call to action pill and the address.
pill = 'Android testers wanted'
pw = d.textlength(pill, font=sans_bold(21)) + 40 * S
d.rounded_rectangle((X, 492 * S, X + pw, 492 * S + 48 * S), radius=24 * S, fill=GREEN)
d.text((X + 20 * S, 500 * S), pill, font=sans_bold(21), fill='#ffffff')
d.text((X + pw + 22 * S, 501 * S), 'novelroute.app/testing', font=sans_bold(22), fill=INK)

# The map, as a phone-shaped card running off the bottom edge.
card_w = 330 * S
map_img = Image.open(ROOT / 'apps/site/public/images/map.webp').convert('RGB')
map_img = map_img.resize((card_w, round(map_img.height * card_w / map_img.width)), Image.LANCZOS)
cx, cy = W - card_w - 80 * S, 56 * S
card_h = H - cy + 40 * S
map_img = map_img.crop((0, 0, card_w, card_h))
mask = Image.new('L', (card_w, card_h), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, card_w - 1, card_h - 1), radius=30 * S, fill=255)
shadow = Image.new('L', (W, H), 0)
ImageDraw.Draw(shadow).rounded_rectangle((cx, cy + 14 * S, cx + card_w, cy + card_h), radius=30 * S, fill=70)
shadow = shadow.filter(ImageFilter.GaussianBlur(22 * S))
img.paste(Image.new('RGB', (W, H), '#2a271f'), (0, 0), shadow)
img.paste(map_img, (cx, cy), mask)
d.rounded_rectangle((cx, cy, cx + card_w - 1, cy + card_h - 1), radius=30 * S, outline=LINE, width=2 * S)

img.resize((W // S, H // S), Image.LANCZOS).save(HERE / 'banner.png', optimize=True)
print('Wrote', HERE / 'banner.png')
