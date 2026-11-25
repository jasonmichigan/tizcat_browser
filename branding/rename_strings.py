# "Chromium" becomes the browser's name (PRODUCT_SHORTNAME in BRANDING, now
# TizCat) in the words the user reads. It only finds "Chromium", so it first
# puts these files back as Chromium has them (from git): that is what lets
# the name change again.
#
# Only Chromium's branded string files are touched (the ones a non-Google
# build uses for its own name, with their translations), and only inside a
# message or a translation, never in the markup around it. Left alone:
#   - "The Chromium Authors", the copyright holder, whose notice the license
#     says to keep;
#   - ChromiumOS and Chromium OS, which is another product;
#   - addresses and identifiers (chromium.org, chromium_strings);
#   - the link to the Chromium project in "... is made possible by the
#     Chromium open source project" (between BEGIN_LINK_CHROMIUM and
#     END_LINK_CHROMIUM, in every language): that credit stays Chromium's.
#
#   python rename_strings.py C:\tizcat\src [--dry-run]
import glob, os, re, subprocess, sys

FILES = [
    "chrome/app/chromium_strings.grd",
    "chrome/app/settings_chromium_strings.grdp",
    "components/components_chromium_strings.grd",
    "chrome/app/resources/chromium_strings_*.xtb",
    "components/strings/components_chromium_strings_*.xtb",
]
BODY = re.compile(r"(<(message|translation)\b[^>]*>)(.*?)(</\2>)", re.S)
WORD = re.compile(r"(?<![\w./-])Chromium(?!\w|[./-]\w| OS| Authors)")
CREDIT = re.compile(r"(BEGIN_LINK_CHROMIUM.*?END_LINK_CHROMIUM)", re.S)


def product_name():
    here = os.path.dirname(os.path.abspath(__file__))
    for line in open(os.path.join(here, "BRANDING"), encoding="utf-8"):
        key, _, value = line.strip().partition("=")
        if key == "PRODUCT_SHORTNAME":
            return value
    raise SystemExit("BRANDING has no PRODUCT_SHORTNAME")


NAME = product_name()


def rename(text):
    n = 0

    def body(m):
        nonlocal n
        # Odd pieces are the Chromium credit links, kept as they are.
        parts = CREDIT.split(m.group(3))
        for i in range(0, len(parts), 2):
            parts[i], k = WORD.subn(NAME, parts[i])
            n += k
        return m.group(1) + "".join(parts) + m.group(4)

    return BODY.sub(body, text), n


def main():
    src = sys.argv[1]
    dry = "--dry-run" in sys.argv
    if not dry:
        # autocrlf off: Chromium's files are LF, and git on Windows would
        # otherwise check them out as CRLF.
        subprocess.run(["git", "-c", "core.autocrlf=false", "-C", src, "checkout", "--"] + FILES,
                       check=True)
    total = files = 0
    for pattern in FILES:
        for path in sorted(glob.glob(os.path.join(src, pattern))):
            text = open(path, encoding="utf-8", newline="").read()
            out, n = rename(text)
            if n:
                files += 1
                total += n
                if not dry:
                    open(path, "w", encoding="utf-8", newline="").write(out)
    print(("would rename" if dry else "renamed"), total, "in", files, "files, to", NAME)


if __name__ == "__main__":
    main()
