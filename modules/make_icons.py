# Icons for TizCat's modules, made from TizCat's logo (visuals\logo_d2.png),
# and JibWallet's wallet icon.
#   python modules\make_icons.py [services] [wallet]   (no name: all of them)
# Needs Pillow.
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TIZCAT = os.path.dirname(HERE)
LOGO = os.path.join(TIZCAT, "visuals", "logo_d2.png")


def logo(size):
    art = Image.open(LOGO).convert("RGBA")
    art = art.crop(art.getbbox())
    side = max(art.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)
    return square.resize((size, size), Image.LANCZOS)


def background(w=1920, h=1080):
    # The New Tab page's own picture (Brave shows photos; TizCat's is its
    # colors and cheetah until real photos are chosen): navy, a warm glow,
    # the cheetah small and quiet at the side.
    from PIL import ImageDraw, ImageFilter
    navy, deep, gold = (28, 43, 74), (12, 18, 32), (217, 164, 58)
    img = Image.new("RGB", (w, h), deep)
    grad = Image.linear_gradient("L").transpose(Image.ROTATE_90).resize((w, h))
    img = Image.composite(Image.new("RGB", (w, h), navy), img, grad)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((w * 0.58, h * 0.05, w * 1.0, h * 0.75), fill=gold + (60,))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    img.paste(glow, (0, 0), glow)
    # Upper right, clear of the clock (top left), the search box (middle)
    # and the Rewards card (bottom right).
    cat = logo(340)
    cat.putalpha(cat.getchannel("A").point(lambda a: a * 0.55))
    img.paste(cat, (int(w * 0.74), int(h * 0.20)), cat)
    return img


def wallet(size):
    # JibWallet's toolbar icon: a wallet in TizCat's gold, a card peeking out
    # of it and a dark clasp, simple enough to read at 16 pixels. Drawn at
    # 512 and scaled down.
    from PIL import ImageDraw
    s = 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    edge = (138, 92, 16, 255)
    d.rounded_rectangle((104, 52, 424, 236), radius=40, fill=(246, 222, 160, 255), outline=edge, width=16)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((32, 132, 480, 460), radius=76, fill=255)
    top, bottom = (233, 182, 76), (190, 134, 30)
    shade = Image.linear_gradient("L").resize((s, s))
    body = Image.composite(Image.new("RGBA", (s, s), bottom + (255,)), Image.new("RGBA", (s, s), top + (255,)), shade)
    img.paste(body, (0, 0), mask)
    d.rounded_rectangle((32, 132, 480, 460), radius=76, outline=edge, width=16)
    d.rounded_rectangle((292, 236, 480, 356), radius=46, fill=(120, 78, 12, 255))
    d.ellipse((322, 274, 366, 318), fill=(255, 244, 216, 255))
    return img.resize((size, size), Image.LANCZOS)


def make_services():
    out = os.path.join(HERE, "services", "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 24, 32, 48, 128):
        path = os.path.join(out, f"icon_{size}.png")
        logo(size).save(path, optimize=True)
        print("wrote", os.path.relpath(path, TIZCAT))
    img_dir = os.path.join(HERE, "services", "img")
    os.makedirs(img_dir, exist_ok=True)
    path = os.path.join(img_dir, "background-1.jpg")
    background().save(path, quality=84, optimize=True, progressive=True)
    print("wrote", os.path.relpath(path, TIZCAT), os.path.getsize(path) // 1024, "KB")


def make_wallet():
    out = os.path.join(HERE, "wallet", "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 24, 32, 48, 128):
        path = os.path.join(out, f"icon_{size}.png")
        wallet(size).save(path, optimize=True)
        print("wrote", os.path.relpath(path, TIZCAT))
    # TizCat's cheetah for the panel's header (shown at 32, sharp at 2x).
    path = os.path.join(out, "tizcat_64.png")
    logo(64).save(path, optimize=True)
    print("wrote", os.path.relpath(path, TIZCAT))


if __name__ == "__main__":
    import sys
    parts = {"services": make_services, "wallet": make_wallet}
    for name in sys.argv[1:] or parts:
        parts[name]()
