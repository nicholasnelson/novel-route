"""Mini flyer for leaving in street libraries (90 x 110 mm, about two business cards).

Builds two PDFs next to this script:
- flyer.pdf     one flyer at trim size plus 3 mm bleed (for a print shop)
- flyer-a4.pdf  four flyers on an A4 sheet with crop marks (for printing at home)

Run: python marketing/flyer/build_flyer.py  (needs reportlab)
"""
from pathlib import Path

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
ASSETS = ROOT / 'apps' / 'mobile' / 'assets'
FONTS = Path('C:/Windows/Fonts')

W, H = 90 * mm, 110 * mm
BLEED = 3 * mm
URL = 'https://novelroute.app'

# The site's palette (apps/site/public/styles.css).
PAPER = HexColor('#f7f3ea')
INK = HexColor('#23211c')
INK_SOFT = HexColor('#5d584e')
LINE = HexColor('#e2d9c6')
GREEN = HexColor('#1f8f3a')

pdfmetrics.registerFont(TTFont('Serif-Bold', str(FONTS / 'georgiab.ttf')))
pdfmetrics.registerFont(TTFont('Serif-Italic', str(FONTS / 'georgiai.ttf')))
pdfmetrics.registerFont(TTFont('Sans', str(FONTS / 'segoeui.ttf')))
pdfmetrics.registerFont(TTFont('Sans-Bold', str(FONTS / 'segoeuib.ttf')))

ICON = str(ASSETS / 'adaptive-icon.png')  # green library on transparent, centred in its square
MARKERS = [str(ASSETS / 'markers' / f'marker-large-{s}@3x.png') for s in ('never', 'fresh', 'recent', 'old')]

STEPS = [
    ('Find a library', 'Every street library in Australia, on one map.'),
    ('Record your visit', 'One tap when you stop by.'),
    ('Repeat', "Doors close slowly on the map, so you know which shelves are due another look."),
]

M = 7 * mm  # margin
BAND = 42 * mm  # height of the paper-coloured top band


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line] if line else lines


def flyer(c: canvas.Canvas, x: float, y: float, bleed: float) -> None:
    """Draw one flyer with its trim box's bottom-left corner at (x, y)."""
    c.saveState()
    c.translate(x, y)

    # Top band in paper colour, running into the bleed on three sides.
    c.setFillColor(PAPER)
    c.rect(-bleed, H - BAND, W + 2 * bleed, BAND + bleed, stroke=0, fill=1)

    # Brand: icon and name.
    icon = 13 * mm
    c.drawImage(ICON, M - 2.6 * mm, H - M - icon + 2.2 * mm, icon, icon, mask='auto')
    c.setFillColor(INK)
    c.setFont('Serif-Bold', 13)
    c.drawString(M + 9 * mm, H - M - 6.2 * mm, 'Novel Route')

    # Headline, as on the website.
    c.setFont('Serif-Bold', 14.5)
    c.drawString(M, H - 24 * mm, 'Street libraries near you.')
    c.setFillColor(GREEN)
    c.drawString(M, H - 30.5 * mm, 'Find your next read.')

    # The four marker states standing along the bottom of the band.
    mw, mh = 6.6 * mm, 8.8 * mm
    ground = H - BAND
    for i, path in enumerate(MARKERS):
        c.drawImage(path, W - M - 4 * mw - 3 * 1.6 * mm + i * (mw + 1.6 * mm), ground + 0.4 * mm, mw, mh, mask='auto')
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(-bleed, ground, W + bleed, ground)

    # Steps.
    top = ground - 6.5 * mm
    text_x = M + 7.5 * mm
    text_w = W - text_x - M
    for n, (title, body) in enumerate(STEPS, start=1):
        c.setFillColor(GREEN)
        c.circle(M + 2.6 * mm, top + 1.2 * mm, 2.6 * mm, stroke=0, fill=1)
        c.setFillColor(HexColor('#ffffff'))
        c.setFont('Sans-Bold', 8)
        c.drawCentredString(M + 2.6 * mm, top + 0.1 * mm, str(n))
        c.setFillColor(INK)
        c.setFont('Serif-Bold', 9.5)
        c.drawString(text_x, top, title)
        c.setFillColor(INK_SOFT)
        c.setFont('Sans', 7.4)
        lines = wrap(body, 'Sans', 7.4, text_w)
        for i, line in enumerate(lines):
            c.drawString(text_x, top - 3.9 * mm - i * 3.2 * mm, line)
        top -= 3.9 * mm + len(lines) * 3.2 * mm + 3.4 * mm

    # QR code and where to get it.
    qr_size = 23 * mm
    qr_x, qr_y = W - M - qr_size + 1.2 * mm, M + 2.6 * mm
    draw_qr(c, URL, qr_x, qr_y, qr_size)

    c.setFillColor(INK)
    c.setFont('Sans-Bold', 10)
    c.drawString(M, qr_y + 16 * mm, 'Free for Android')
    c.setFillColor(GREEN)
    c.setFont('Serif-Bold', 12)
    c.drawString(M, qr_y + 10.2 * mm, 'novelroute.app')
    c.setFillColor(INK_SOFT)
    c.setFont('Sans', 7.4)
    c.drawString(M, qr_y + 5.4 * mm, 'No account, no ads.')
    c.drawString(M, qr_y + 2.2 * mm, 'Scan to find out more.')

    # A note to whoever finds it.
    c.setFont('Serif-Italic', 6.6)
    c.drawCentredString(W / 2, 3.6 * mm, 'Take this card, or leave it for the next reader.')

    c.restoreState()


def draw_qr(c: canvas.Canvas, data: str, x: float, y: float, size: float) -> None:
    """QR code as dark modules that slightly overlap, so no hairlines show between them."""
    qr = QrCodeWidget(data, barLevel='M')
    qr.qr.make()
    n = qr.qr.getModuleCount()
    cell = size / n
    c.setFillColor(INK)
    for r in range(n):
        for col in range(n):
            if qr.qr.isDark(r, col):
                c.rect(x + col * cell, y + size - (r + 1) * cell, cell + 0.05, cell + 0.05, stroke=0, fill=1)


def crop_marks(c: canvas.Canvas, x: float, y: float) -> None:
    """Short marks at the trim corners, kept clear of the bleed."""
    c.setStrokeColor(INK)
    c.setLineWidth(0.25)
    gap, length = BLEED + 1 * mm, 4 * mm
    for cx in (x, x + W):
        for cy in (y, y + H):
            sx = -1 if cx == x else 1
            sy = -1 if cy == y else 1
            c.line(cx + sx * gap, cy, cx + sx * (gap + length), cy)
            c.line(cx, cy + sy * gap, cx, cy + sy * (gap + length))


def build_single() -> None:
    path = HERE / 'flyer.pdf'
    c = canvas.Canvas(str(path), pagesize=(W + 2 * BLEED, H + 2 * BLEED))
    c.setTitle('Novel Route flyer (90 x 110 mm, 3 mm bleed)')
    flyer(c, BLEED, BLEED, BLEED)
    c.showPage()
    c.save()


def build_a4() -> None:
    path = HERE / 'flyer-a4.pdf'
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle('Novel Route flyers (4 per A4 sheet)')
    pw, ph = A4
    gutter = 2 * BLEED + 4 * mm  # room for each flyer's bleed and the marks between them
    left = (pw - (2 * W + gutter)) / 2
    bottom = (ph - (2 * H + gutter)) / 2
    for col in range(2):
        for row in range(2):
            x, y = left + col * (W + gutter), bottom + row * (H + gutter)
            flyer(c, x, y, BLEED)
    # Marks after the flyers, so no bleed covers them.
    for col in range(2):
        for row in range(2):
            crop_marks(c, left + col * (W + gutter), bottom + row * (H + gutter))
    c.setFont('Sans', 7)
    c.setFillColor(INK_SOFT)
    c.drawCentredString(pw / 2, 8 * mm, 'Print at 100% (actual size), then cut along the marks. Each flyer is 90 x 110 mm.')
    c.showPage()
    c.save()


if __name__ == '__main__':
    build_single()
    build_a4()
    print('Wrote', HERE / 'flyer.pdf', 'and', HERE / 'flyer-a4.pdf')
