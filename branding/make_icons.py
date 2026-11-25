# Make TizCat's icons from the artwork in tizcat\visuals:
#   logo_d2.png   the folded-gold cheetah: the browser itself (its program
#                 icon, the taskbar, the About page, the Start menu tiles);
#   logo_ai2.png  the half-cheetah, half-network face: Yuzal, the AI
#                 assistant (her toolbar button and the mark in her panel);
#   logo_grey1.png  the gray outline cheetah: the New Tab page's tab icon,
#                 where Chromium shows a gray Chromium logo.
#   logo_black1.png the same cheetah in black: the one-color logo Chromium
#                 draws in the text color (black, or white in a dark theme)
#                 beside "TizCat" in the address bar, on TizCat's own pages
#                 in the address bar's suggestions, and on "About TizCat" in
#                 Settings. That logo is a drawing, not a picture, so this
#                 one is traced into a drawing too (product_mono.icon for the
#                 address bar, product_mono.svg for the pages).
# (Chosen by the user on 2026-11-16, replacing logo_d.png and logo_2.png.)
# Each is trimmed to the picture, centered on a square and scaled down
# smoothly. Writes branding\icons and yuzal\icons.
#   python make_icons.py      (needs Pillow, and OpenCV for the tracing)
import base64
import io
import os
import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
JIB = os.path.dirname(HERE)
OUT = os.path.join(HERE, "icons")
YUZAL_OUT = os.path.join(JIB, "yuzal", "icons")
BROWSER_ART = os.path.join(JIB, "visuals", "logo_d2.png")
AI_ART = os.path.join(JIB, "visuals", "logo_ai2.png")
NEW_TAB_ART = os.path.join(JIB, "visuals", "logo_grey1.png")
MONO_ART = os.path.join(JIB, "visuals", "logo_black1.png")


def mono_outlines(path):
    """The black cheetah's outlines, in the 24-unit square Chromium's own
    one-color icons use, filling the middle 20 units as the Chrome logo does.

    At 16 pixels, the address bar's size, the artwork's lines would be under
    half a pixel wide and fade to gray, so they are first thickened a little
    (about a quarter of a unit on each side): the same shapes, drawn bolder,
    as heavy as the Chrome logo it replaces. Outlines run one way and holes
    the other, so the shape fills the same under either fill rule."""
    a = np.array(Image.open(path).convert("RGBA"))
    mask = (a[..., 3] > 127).astype(np.uint8) * 255
    ys, xs = np.nonzero(mask)
    grow = max(1, round(0.0135 * max(xs.max() - xs.min(), ys.max() - ys.min())))
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
    mask = cv2.dilate(mask, disk)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    scale = 20.0 / max(x1 - x0, y1 - y0)
    ox = 2 + (20 - (x1 - x0) * scale) / 2 - x0 * scale
    oy = 2 + (20 - (y1 - y0) * scale) / 2 - y0 * scale
    contours, tree = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    outlines = []
    for i, c in enumerate(contours):
        if cv2.contourArea(c) * scale * scale < 0.02:   # specks too small to see
            continue
        depth, parent = 0, tree[0][i][3]
        while parent >= 0:
            depth, parent = depth + 1, tree[0][parent][3]
        c = cv2.approxPolyDP(c, 0.025 / scale, True)
        pts = [(p[0][0] * scale + ox, p[0][1] * scale + oy) for p in c]
        area = sum(x0_ * y1_ - x1_ * y0_ for (x0_, y0_), (x1_, y1_) in zip(pts, pts[1:] + pts[:1]))
        if (area > 0) != (depth % 2 == 0):
            pts.reverse()
        outlines.append(pts)
    return outlines


def write_mono(outlines):
    num = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
    # The .icon numbers go into C++ as they are: 2.5f is a float, a whole
    # number stays bare (12f would not compile).
    flt = lambda v: num(v) + ("f" if "." in num(v) else "")
    lines = [
        "// TizCat's cheetah in one color, traced from visuals\\logo_black1.png by",
        "// branding\\make_icons.py. apply-jib.ps1 copies it over Chromium's",
        "// chrome_product.icon and product_chrome_refresh_old.icon.",
        "",
        "CANVAS_DIMENSIONS, 24,",
    ]
    d = []
    for pts in outlines:
        (x, y), rest = pts[0], pts[1:]
        lines.append(f"MOVE_TO, {flt(x)}, {flt(y)},")
        lines += [f"LINE_TO, {flt(x)}, {flt(y)}," for x, y in rest]
        lines.append("CLOSE,")
        d.append(f"M{num(x)} {num(y)}" + "".join(f"L{num(x)} {num(y)}" for x, y in rest) + "Z")
    with open(os.path.join(OUT, "product_mono.icon"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(OUT, "product_mono.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
                f'<path fill-rule="evenodd" d="{"".join(d)}"/></svg>\n')


def square(path, margin=0.02):
    """The picture alone (transparent edges cut off), centered on a square."""
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    im = im.crop(box)
    side = round(max(im.size) * (1 + 2 * margin))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return sq


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    os.makedirs(OUT, exist_ok=True)
    big = square(BROWSER_ART)
    at = lambda n: big.resize((n, n), Image.LANCZOS)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    for n in sizes + [512]:
        at(n).save(os.path.join(OUT, f"product_logo_{n}.png"))
    at(256).save(os.path.join(OUT, "tizcat.ico"), sizes=[(n, n) for n in sizes])
    # The Windows Start menu tiles.
    at(600).save(os.path.join(OUT, "Logo.png"))
    at(176).save(os.path.join(OUT, "SmallLogo.png"))
    # Chromium's pages ask for an SVG logo; this one carries the picture.
    b64 = base64.b64encode(png_bytes(at(256))).decode("ascii")
    with open(os.path.join(OUT, "product_logo.svg"), "w", encoding="utf-8") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
                f'<image width="256" height="256" href="data:image/png;base64,{b64}"/></svg>\n')
    # The New Tab page's tab icon, at 16 and (for high-DPI screens) 32 pixels.
    # Shrunk that far, its thin lines blend into the background and look
    # washed out, so their coverage is strengthened (same gray, same shape).
    tab = square(NEW_TAB_ART, margin=0)
    for n in [16, 32]:
        small = tab.resize((n, n), Image.LANCZOS)
        small.putalpha(small.getchannel("A").point(lambda a: min(255, round(a * 1.7))))
        small.save(os.path.join(OUT, f"favicon_ntp_{n}.png"))
    # The one-color logo, as drawings.
    write_mono(mono_outlines(MONO_ART))

    os.makedirs(YUZAL_OUT, exist_ok=True)
    ai = square(AI_ART)
    for n in [16, 24, 32, 48, 128]:
        ai.resize((n, n), Image.LANCZOS).save(os.path.join(YUZAL_OUT, f"ai_{n}.png"))
    print("icons in", OUT, "and", YUZAL_OUT)


if __name__ == "__main__":
    main()
