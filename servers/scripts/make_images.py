# Make the servers' pictures from TizCat's logo (visuals\logo_d2.png): the
# website's and account site's logos and icon, and the two house ads (a New
# Tab picture and a notification icon). Run again after changing the logo.
#   python servers\scripts\make_images.py
# Needs Pillow.
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SERVERS = os.path.dirname(HERE)
TIZCAT = os.path.dirname(SERVERS)
LOGO = os.path.join(TIZCAT, "visuals", "logo_d2.png")
FONTS = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")

NAVY = (28, 43, 74)
NAVY_DEEP = (14, 22, 40)
GOLD = (217, 164, 58)
WHITE = (246, 244, 239)


def logo(size):
    art = Image.open(LOGO).convert("RGBA")
    box = art.getbbox()
    art = art.crop(box)
    side = max(art.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)
    return square.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(SERVERS, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith(".jpg"):
        img.convert("RGB").save(path, quality=86, optimize=True, progressive=True)
    else:
        img.save(path, optimize=True)
    print("wrote", os.path.relpath(path, TIZCAT), img.size)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def ntp_house_ad():
    w, h = 1920, 1080
    img = Image.new("RGB", (w, h), NAVY_DEEP)
    # A soft navy-to-deep gradient with a warm glow behind the cheetah.
    grad = Image.linear_gradient("L").resize((w, h)).rotate(-25, expand=False)
    img = Image.composite(Image.new("RGB", (w, h), NAVY), img, grad)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((w * 0.52, h * 0.12, w * 0.98, h * 0.88), fill=GOLD + (70,))
    img.paste(glow.filter(ImageFilter.GaussianBlur(160)), (0, 0), glow.filter(ImageFilter.GaussianBlur(160)))
    cat = logo(560)
    img.paste(cat, (int(w * 0.60), int(h * 0.24)), cat)
    d = ImageDraw.Draw(img)
    d.text((140, 380), "TizCat Rewards", font=font("segoeuib.ttf", 96), fill=WHITE)
    d.text((144, 510), "Points for the ads you choose to see.", font=font("segoeui.ttf", 46), fill=GOLD)
    d.text((144, 580), "Turn Rewards on in TizCat's toolbar.", font=font("segoeui.ttf", 36), fill=WHITE)
    return img


def note_house_ad():
    size = 192
    img = Image.new("RGBA", (size, size), NAVY + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=40, fill=255)
    img.putalpha(mask)
    cat = logo(150)
    img.paste(cat, (21, 21), cat)
    return img


def main():
    for folder in (("web", "site", "img"), ("account", "site", "img")):
        save(logo(64), *folder, "logo-64.png")
        save(logo(32), *folder, "favicon.png")
    save(logo(512), "web", "site", "img", "logo-512.png")
    save(ntp_house_ad(), "ads", "media", "house-ntp-1.jpg")
    save(note_house_ad(), "ads", "media", "house-note-1.png")


if __name__ == "__main__":
    main()
