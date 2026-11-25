# The diagram in servers\email_v1.docx: how mail to and from tizcat.com flows.
#   python servers\scripts\make_email_figure.py
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "email_figure.png")
NAVY, GOLD, GREEN, INK, INK2 = "#1c2b4a", "#d9a43a", "#1b7f5a", "#0b0b0b", "#52514e"
plt.rcParams.update({"font.family": ["Segoe UI", "Arial"], "figure.facecolor": "#fcfcfb"})

fig, ax = plt.subplots(figsize=(7.4, 3.9))
ax.set_xlim(-0.02, 1.02)
ax.set_ylim(0, 1.06)
ax.axis("off")


def box(x, y, w, h, title, sub, fill, edge, color):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.01,rounding_size=0.02", lw=1.3, ec=edge, fc=fill))
    ax.text(x + w / 2, y + h - 0.045, title, ha="center", va="top", fontsize=9.2, fontweight="bold", color=color)
    ax.text(x + w / 2, y + h - 0.105, sub, ha="center", va="top", fontsize=7.6, color=INK2, linespacing=1.3)


def arrow(a, b, color):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=12, color=color, lw=1.5, shrinkA=2, shrinkB=2))


ax.text(0, 1.03, "How TizCat email works", fontsize=13, fontweight="bold", color=INK)
ax.text(0, 0.975, "Mail lives in Gmail; tizcat.com is the address people see.", fontsize=8.5, color=INK2)
# Receiving
ax.text(0, 0.86, "Receiving", fontsize=10, fontweight="bold", color=GREEN)
box(0.00, 0.55, 0.24, 0.26, "Someone writes to", "hamid@tizcat.com\nor ramona@tizcat.com", "#ffffff", INK2, INK)
box(0.32, 0.55, 0.30, 0.26, "Cloudflare Email Routing", "tizcat.com's mail servers\n(free), forward at once", "#e6ebf4", NAVY, NAVY)
box(0.70, 0.55, 0.30, 0.26, "Your Gmail inbox", "hamid.ahady@gmail.com\njaberian.ramona@gmail.com", "#e3f2ea", GREEN, GREEN)
arrow((0.24, 0.68), (0.32, 0.68), GREEN)
arrow((0.62, 0.68), (0.70, 0.68), GREEN)
# Sending
ax.text(0, 0.44, "Sending", fontsize=10, fontweight="bold", color="#a8741a")
box(0.00, 0.10, 0.24, 0.29, "You write in Gmail", "From: hamid@tizcat.com\n(Gmail \"Send mail as\")", "#f8efdc", GOLD, "#8a5d0f")
box(0.32, 0.10, 0.30, 0.29, "Gmail's mail server", "smtp.gmail.com, signed in\nwith a Google app password", "#e6ebf4", NAVY, NAVY)
box(0.70, 0.10, 0.30, 0.29, "They receive it", "from hamid@tizcat.com,\nreplies come back to it", "#ffffff", INK2, INK)
arrow((0.24, 0.245), (0.32, 0.245), GOLD)
arrow((0.62, 0.245), (0.70, 0.245), GOLD)
fig.savefig(OUT, dpi=200, bbox_inches="tight", pad_inches=0.15)
print("wrote", OUT)
