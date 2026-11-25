# The figures in about_v1.docx, saved as PNG in visuals\about_v1_figures.
#   python visuals\about_v1_source\make_figures.py
# Data charts use the dataviz reference palette (validated categorical slots,
# one-hue blue ramp); diagrams use TizCat's navy and gold. Numbers come from
# ai_browser\plans_browser.docx (25 October 2026) and Cloudflare's published
# free-plan limits (checked 18 November 2026); assumptions are written on the
# figure that uses them.
import io
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "about_v1_figures")
# --web: the website's copies of the figures that differ from the document's
# (fig1, fig3, fig4, fig7, fig9). The user's choices, 2026-11-18: the website
# does not say what TizCat is built from, and it describes JibCoin and
# JibWallet without saying whether they exist yet or when (no "coming",
# "later", "proposed", no future roadmap). Written as WebP, 1200 px wide,
# straight into servers\web\site\img\figures; the document's PNGs are left
# alone. After running it, raise the ?v= of those images in the pages.
#   python visuals\about_v1_source\make_figures.py --web
WEB = "--web" in sys.argv
if WEB:
    OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "servers", "web", "site", "img", "figures")
os.makedirs(OUT, exist_ok=True)

# Reference palette (dataviz references/palette.md), light mode.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
GRID = "#e4e3df"
BLUE = "#2a78d6"
ORANGE = "#eb6834"
AQUA = "#1baf7a"
BLUE_RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
             "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]
# TizCat's colors, for diagrams.
NAVY = "#1c2b4a"
GOLD = "#d9a43a"
GOLD_SOFT = "#f6e7c6"
NAVY_SOFT = "#dfe5f0"
LOCAL_SOFT = "#dcefe6"
LOCAL = "#1b7f5a"

plt.rcParams.update({
    "font.family": ["Segoe UI", "Arial", "DejaVu Sans"],
    "font.size": 10,
    "axes.edgecolor": GRID,
    "axes.labelcolor": INK2,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.titlecolor": INK,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
})


def save(fig, name):
    if WEB:
        from PIL import Image

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", pad_inches=0.15)
        plt.close(fig)
        img = Image.open(buf).convert("RGB")
        img = img.resize((1200, round(img.height * 1200 / img.width)), Image.LANCZOS)
        path = os.path.join(OUT, name.replace(".png", ".webp"))
        img.save(path, "WEBP", quality=85, method=6)
        print("wrote", path, img.size)
        return
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=200, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    print("wrote", os.path.relpath(path, os.path.dirname(os.path.dirname(HERE))))


def box(ax, x, y, w, h, title, lines=(), fill=NAVY_SOFT, edge=NAVY, title_color=NAVY, size=9.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.012,rounding_size=0.018",
                                linewidth=1.2, edgecolor=edge, facecolor=fill))
    ax.text(x + w / 2, y + h - 0.035, title, ha="center", va="top", fontsize=size,
            fontweight="bold", color=title_color)
    for i, line in enumerate(lines):
        ax.text(x + w / 2, y + h - 0.085 - i * 0.042, line, ha="center", va="top",
                fontsize=size - 1.5, color=INK2)


def arrow(ax, a, b, color=INK2, style="-|>", lw=1.3, text=None, text_xy=None, ls="-"):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle=style, mutation_scale=12, color=color,
                                 linewidth=lw, linestyle=ls, shrinkA=2, shrinkB=2))
    if text:
        tx, ty = text_xy or ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        ax.text(tx, ty, text, ha="center", va="center", fontsize=7.8, color=INK2,
                bbox=dict(boxstyle="round,pad=0.2", fc=SURFACE, ec="none"))


def canvas(w=7.2, h=4.2):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(0, 1.06)
    ax.axis("off")
    return fig, ax


# ---------------------------------------------------------------------------
# 1. Architecture

def architecture():
    fig, ax = canvas(7.4, 4.6)
    ax.text(0.0, 1.02, "How TizCat fits together", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.975, "Small permanent hooks in the browser; everything that changes lives in a module or on a server.",
            fontsize=8.5, color=INK2)
    # Laptop column
    ax.add_patch(FancyBboxPatch((0.0, 0.03), 0.46, 0.88, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.4, ec=LOCAL, fc="#f3faf6"))
    ax.text(0.23, 0.868, "On your laptop", ha="center", fontsize=10.5, fontweight="bold", color=LOCAL)
    box(ax, 0.03, 0.66, 0.40, 0.18, "TizCat browser",
        ["A complete browser, compiled", "with a speed profile (PGO)"] if WEB else
        ["Chromium engine, built with", "Chrome's speed profile (PGO)"])
    box(ax, 0.03, 0.44, 0.18, 0.18, "Yuzal", ["AI agent in the", "side panel"], fill=GOLD_SOFT, edge=GOLD, title_color="#8a5d0f")
    box(ax, 0.25, 0.44, 0.18, 0.18, "TizCat Services", ["New Tab, Rewards,", "notification ads"], fill=GOLD_SOFT, edge=GOLD, title_color="#8a5d0f", size=9)
    box(ax, 0.03, 0.22, 0.18, 0.18, "Passwords", ["encrypted locally;", "the AI never sees them"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL)
    box(ax, 0.25, 0.22, 0.18, 0.18, "Local AI engine", ["Ollama models,", "free and private"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL, size=9)
    ax.text(0.23, 0.09, "Modules update with a restart, no rebuild", ha="center", fontsize=7.8, color=INK2, style="italic")
    # Cloud column
    ax.add_patch(FancyBboxPatch((0.56, 0.03), 0.44, 0.88, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.4, ec=NAVY, fc="#f4f6fb"))
    ax.text(0.78, 0.868, "TizCat's servers on Cloudflare", ha="center", fontsize=10, fontweight="bold", color=NAVY)
    box(ax, 0.585, 0.70, 0.18, 0.14, "www.tizcat.com", ["the website"], size=8.6)
    box(ax, 0.795, 0.70, 0.18, 0.14, "account.tizcat.com", ["accounts"], size=8.6)
    box(ax, 0.59, 0.47, 0.38, 0.15, "api.tizcat.com", ["one front door, versioned /v1 contract"])
    box(ax, 0.59, 0.25, 0.105, 0.15, "Ads", ["catalog"], size=9)
    box(ax, 0.727, 0.25, 0.105, 0.15, "Rewards", ["points"], size=9)
    box(ax, 0.864, 0.25, 0.105, 0.15, "JibWallet", ["Solana"] if WEB else ["coming"], size=9)
    ax.text(0.78, 0.09, "Each part deploys on its own, in seconds", ha="center", fontsize=7.8, color=INK2, style="italic")
    # Links
    arrow(ax, (0.43, 0.53), (0.59, 0.545), color=NAVY, text="device token, HTTPS", text_xy=(0.51, 0.585))
    arrow(ax, (0.43, 0.74), (0.79, 0.77), color=NAVY, ls="--", text="Get started", text_xy=(0.52, 0.775))
    arrow(ax, (0.78, 0.47), (0.643, 0.40), color=NAVY)
    arrow(ax, (0.78, 0.47), (0.78, 0.40), color=NAVY)
    arrow(ax, (0.78, 0.47), (0.917, 0.40), color=NAVY)
    save(fig, "fig1_architecture.png")


# ---------------------------------------------------------------------------
# 2. What stays on the laptop

def privacy():
    fig, ax = canvas(7.4, 4.3)
    ax.text(0.0, 1.02, "Yuzal: what stays on your laptop", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.975, "Passwords never reach the AI or any server. With the local engine, nothing about the page leaves either.",
            fontsize=8.5, color=INK2)
    ax.add_patch(FancyBboxPatch((0.0, 0.05), 0.62, 0.86, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.6, ec=LOCAL, fc="#f3faf6"))
    ax.text(0.31, 0.875, "Your laptop", ha="center", fontsize=11, fontweight="bold", color=LOCAL)
    box(ax, 0.03, 0.62, 0.26, 0.2, "Saved passwords", ["TizCat's password manager,", "encrypted for your Windows", "account"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL)
    box(ax, 0.33, 0.62, 0.26, 0.2, "AI keys and settings", ["kept on this computer,", "sent only to the AI", "company you picked"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL)
    box(ax, 0.03, 0.33, 0.26, 0.22, "Local AI engine", ["Ollama, e.g. qwen3:8b:", "the page and your words", "stay here"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL)
    box(ax, 0.33, 0.33, 0.26, 0.22, "Yuzal's agent", ["reads the page, plans,", "acts; read-only and", "never-submit gates"], fill=GOLD_SOFT, edge=GOLD, title_color="#8a5d0f")
    box(ax, 0.03, 0.08, 0.56, 0.17, "You", ["approve every login (you pick the saved account) and every", "payment or form submission; the browser fills, Yuzal does not"],
        fill="#ffffff", edge=INK2, title_color=INK)
    arrow(ax, (0.29, 0.44), (0.33, 0.44), color=LOCAL, style="<|-|>")
    arrow(ax, (0.46, 0.33), (0.46, 0.25), color=INK2, style="<|-|>")
    # The optional cloud lane
    ax.add_patch(FancyBboxPatch((0.68, 0.33), 0.32, 0.49, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.4, ec=ORANGE, fc="#fdf1ec", linestyle="--"))
    ax.text(0.84, 0.79, "Only if you choose", ha="center", va="top", fontsize=10, fontweight="bold", color="#b44a1e")
    ax.text(0.84, 0.72, "a cloud AI engine", ha="center", va="top", fontsize=9, color="#b44a1e")
    for i, line in enumerate(["gets the page text and a", "screenshot for that turn,", "under your own key or plan.", "", "Never: your passwords."]):
        ax.text(0.84, 0.63 - i * 0.052, line, ha="center", va="top", fontsize=8.3,
                color=INK if line.startswith("Never") else INK2, fontweight="bold" if line.startswith("Never") else "normal")
    arrow(ax, (0.59, 0.47), (0.68, 0.55), color=ORANGE, ls="--")
    ax.text(0.84, 0.25, "For banking or health:\nuse the local engine", ha="center", va="center", fontsize=8.5,
            color=LOCAL, fontweight="bold")
    save(fig, "fig2_privacy.png")


# ---------------------------------------------------------------------------
# 3. Where the speed comes from

def speed():
    fig, ax = canvas(7.4, 3.6)
    ax.text(0.0, 1.03, "Where TizCat's speed comes from", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.975, "Four layers, from the compiler up. Benchmarks will be published once measured on the new build.",
            fontsize=8.5, color=INK2)
    rows = [
        ("Compiled for speed", "Profile-guided optimization: the code real browsing uses most\nis laid out to run fastest.", NAVY_SOFT, NAVY) if WEB else
        ("Compiled like Chrome", "Profile-guided optimization with Google's own profile for this\nChromium version: the code real browsing uses runs fastest.", NAVY_SOFT, NAVY),
        ("A New Tab with no waiting", "Local files only; pictures and the ad list arrive in the background\nand stay on the device, so the page never waits for a server.", GOLD_SOFT, GOLD),
        ("Instant commands", "\"Go to bbc\", \"scroll down\" and similar run at once in Yuzal,\nwithout asking an AI model.", LOCAL_SOFT, LOCAL),
        ("Light modules", "TizCat's own parts are small extensions loaded beside the browser,\nwith short network time limits; the browser never waits on them.", "#eceae4", INK2),
    ]
    for i, (title, text, fill, edge) in enumerate(rows):
        y = 0.72 - i * 0.235
        ax.add_patch(FancyBboxPatch((0.0, y), 1.0, 0.19, boxstyle="round,pad=0.008,rounding_size=0.02",
                                    lw=1.2, ec=edge, fc=fill))
        ax.text(0.025, y + 0.095, title, va="center", fontsize=9.6, fontweight="bold", color=INK)
        ax.text(0.40, y + 0.095, text, va="center", fontsize=8.0, color=INK2, linespacing=1.4)
    save(fig, "fig3_speed.png")


# ---------------------------------------------------------------------------
# 4. TizCat Rewards: how value flows

def rewards_flow():
    fig, ax = canvas(7.4, 3.9)
    ax.text(0.0, 1.03, "TizCat Rewards: how value flows", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.975, "People keep 70 percent of what advertisers pay for their attention, as Brave does.",
            fontsize=8.5, color=INK2)
    box(ax, 0.0, 0.58, 0.18, 0.26, "Advertiser", ["pays for views", "and clicks"], fill="#ffffff", edge=INK2, title_color=INK)
    box(ax, 0.24, 0.58, 0.2, 0.26, "Ad catalog", ["sent to every", "browser; matched", "on the device"], fill=NAVY_SOFT)
    box(ax, 0.50, 0.58, 0.2, 0.26, "You see an ad", ["New Tab picture or", "notification, only", "with Rewards on"], fill=GOLD_SOFT, edge=GOLD, title_color="#8a5d0f")
    box(ax, 0.76, 0.58, 0.24, 0.26, "Points", ["counted in your", "TizCat account,", "once per view"], fill=GOLD_SOFT, edge=GOLD, title_color="#8a5d0f")
    arrow(ax, (0.18, 0.71), (0.24, 0.71), color=NAVY)
    arrow(ax, (0.44, 0.71), (0.50, 0.71), color=NAVY)
    arrow(ax, (0.70, 0.71), (0.76, 0.71), color=NAVY)
    # Split
    ax.add_patch(FancyBboxPatch((0.0, 0.08), 0.46, 0.36, boxstyle="round,pad=0.01,rounding_size=0.02", lw=1.2, ec=INK2, fc="#ffffff"))
    ax.text(0.23, 0.41, "Each dollar an advertiser pays", ha="center", va="top", fontsize=9, fontweight="bold", color=INK)
    # One bar, 0.40 wide: 70% (0.28) and 30% (0.12), with a 2px-like gap.
    ax.add_patch(FancyBboxPatch((0.03, 0.15), 0.278, 0.1, boxstyle="round,pad=0,rounding_size=0.01", lw=0, fc=BLUE))
    ax.add_patch(FancyBboxPatch((0.312, 0.15), 0.118, 0.1, boxstyle="round,pad=0,rounding_size=0.01", lw=0, fc=ORANGE))
    ax.text(0.17, 0.2, "70% to people", ha="center", va="center", fontsize=8.5, color="#ffffff", fontweight="bold")
    ax.text(0.371, 0.2, "30% TizCat", ha="center", va="center", fontsize=7.6, color="#ffffff", fontweight="bold")
    ax.text(0.23, 0.11, "Paid only from money advertisers actually paid", ha="center", va="top", fontsize=7.6, color=INK2)
    # JibCoin and JibWallet (the website's copy says nothing about when)
    box(ax, 0.54, 0.08, 0.46, 0.36, "JibCoin and JibWallet" if WEB else "Later: JibCoin and JibWallet", [
        "points designed to convert to JibCoin" if WEB else "points become JibCoin once it exists",
        "spend it inside TizCat (AI credits, premium)",
        "or keep it in JibWallet, your own keys",
        "no promise of price or listing",
    ], fill="#fbf7ee", edge=GOLD, title_color="#8a5d0f")
    arrow(ax, (0.88, 0.58), (0.80, 0.44), color=GOLD, ls="--")
    save(fig, "fig4_rewards_flow.png")


# ---------------------------------------------------------------------------
# 5. Earnings heatmap

def earnings():
    ads = [3, 5, 10, 20]
    cpm = [2, 5, 10]
    vals = [[0.70 * a * 30 * c / 1000 for c in cpm] for a in ads]
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    vmax = 4.2
    # One-hue blue ramp, light (low) to dark (high).
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list("blue", [BLUE_RAMP[0], BLUE_RAMP[6], BLUE_RAMP[12]])
    ax.imshow(vals, cmap=cmap, vmin=0, vmax=vmax, aspect="auto")
    for i, row in enumerate(vals):
        for j, v in enumerate(row):
            ax.text(j, i, f"${v:.2f}", ha="center", va="center", fontsize=11, fontweight="bold",
                    color="#ffffff" if v > 1.6 else INK)
    ax.set_xticks(range(len(cpm)), [f"${c} per 1,000 views" for c in cpm])
    ax.set_yticks(range(len(ads)), [f"{a} ads a day" + ("  (too many)" if a == 20 else "") for a in ads])
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xticks([x - 0.5 for x in range(1, len(cpm))], minor=True)
    ax.set_yticks([y - 0.5 for y in range(1, len(ads))], minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=3)
    ax.tick_params(which="minor", length=0)
    ax.set_title("What one person earns a month from TizCat Rewards", loc="left", pad=22)
    ax.text(0, 1.04, "70% of ad revenue, 30 days. The realistic case, outlined: 5 ads a day at $5, about 53 cents.",
            transform=ax.transAxes, fontsize=8.5, color=INK2)
    ax.add_patch(plt.Rectangle((0.53, 0.53), 0.94, 0.94, fill=False, ec=ORANGE, lw=3, zorder=5))
    save(fig, "fig5_earnings.png")


# ---------------------------------------------------------------------------
# 6. AI cost against ad revenue

def ai_cost():
    labels = ["TizCat pays for everyone's\ncloud AI", "A small free quota,\nthen your own key", "Your own key\n(free tiers exist)", "A local model\non your laptop"]
    cost = [14.0, 0.05, 0.0, 0.0]
    fig, ax = plt.subplots(figsize=(6.6, 3.4))
    y = list(range(len(labels)))[::-1]
    ax.barh(y, cost, color=BLUE, height=0.5)
    for yi, c in zip(y, cost):
        ax.text(max(c + 0.25, 1.0), yi, "$14.00" if c >= 1 else ("a few cents" if c > 0 else "$0 to TizCat"),
                va="center", fontsize=9, color=INK)
    ax.axvline(0.75, color=ORANGE, lw=2)
    ax.text(1.0, 2.5, "Orange line: ad revenue per user, $0.75 a month", color=INK, fontsize=8.5, va="center")
    ax.set_yticks(y, labels)
    ax.set_xlim(0, 16.5)
    ax.set_xlabel("Cost to TizCat per active user per month (US dollars)")
    ax.grid(axis="x", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.set_title("Why TizCat's AI is free: it runs on your side", loc="left", pad=20)
    ax.text(0, 1.04, "20 cloud AI calls a day cost about 20 times what ads earn; local and own-key AI cost TizCat nothing.",
            transform=ax.transAxes, fontsize=8.5, color=INK2)
    save(fig, "fig6_ai_cost.png")


# ---------------------------------------------------------------------------
# 7. Proposed JibCoin allocation

def allocation():
    parts = [("User rewards pool", 50, "paid only for real attention, on a published schedule"),
             ("Treasury and operations", 20, "multi-signature, public address"),
             ("Team", 15, "four-year vesting, one-year cliff"),
             ("Liquidity", 10, "so it can be bought and sold at all"),
             ("Advisors and legal reserve", 5, "including the cost of being wrong")]
    fig, ax = plt.subplots(figsize=(6.6, 3.2))
    y = list(range(len(parts)))[::-1]
    ax.barh(y, [p[1] for p in parts], color=BLUE, height=0.55)
    for yi, (name, share, why) in zip(y, parts):
        ax.text(share + 1, yi + 0.08, f"{share}%", va="center", fontsize=10, fontweight="bold", color=INK)
        ax.text(share + 1, yi - 0.24, why, va="center", fontsize=7.8, color=INK2)
    ax.set_yticks(y, [p[0] for p in parts])
    ax.set_xlim(0, 100)
    ax.set_xticks([])
    for s in ("top", "right", "bottom", "left"):
        ax.spines[s].set_visible(False)
    ax.tick_params(axis="y", length=0)
    if WEB:
        ax.set_title("JibCoin: how the fixed supply is allocated", loc="left", pad=20)
        ax.text(0, 1.05, "Half of the fixed supply is reserved for the people who earn it.",
                transform=ax.transAxes, fontsize=8.5, color=INK2)
    else:
        ax.set_title("JibCoin: a proposed allocation (draft, not decided)", loc="left", pad=20)
        ax.text(0, 1.05, "A fixed supply with half reserved for people who earn it. Final numbers come with the legal review.",
                transform=ax.transAxes, fontsize=8.5, color=INK2)
    save(fig, "fig7_allocation.png")


# ---------------------------------------------------------------------------
# 8. How far Cloudflare's free plan goes

def free_plan():
    users = list(range(0, 5001, 50))
    req_per_user = 35   # requests a day: hourly settings and catalog (16), ad events (9), balance (8), account (2)
    rows_per_user = 50  # D1 rows written a day: about 5 per credited event (indexes count), plus device check-ins
    limit = 100_000
    fig, ax = plt.subplots(figsize=(6.6, 3.6))
    ax.plot(users, [u * req_per_user for u in users], color=BLUE, lw=2, label="Worker requests a day")
    ax.plot(users, [u * rows_per_user for u in users], color=ORANGE, lw=2, label="Database rows written a day")
    ax.axhline(limit, color=INK2, lw=1.2, ls="--")
    ax.text(60, limit - 4000, "Free plan limit for each: 100,000 a day", ha="left", va="top", fontsize=8.5, color=INK2)
    for per, color, dx, ha, dy in ((rows_per_user, ORANGE, -60, "right", 9000), (req_per_user, BLUE, 60, "left", -14000)):
        u = limit / per
        ax.plot([u], [limit], "o", ms=8, color=color, mec=SURFACE, mew=2)
        ax.text(u + dx, limit + dy, f"about {round(u, -2):,.0f} users", ha=ha, fontsize=8.5, color=INK)
    ax.set_xlim(0, 5000)
    ax.set_ylim(0, 200_000)
    ax.set_xlabel("Daily active Rewards users")
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v / 1000:.0f}k"))
    ax.grid(color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.legend(frameon=False, loc="upper left", fontsize=8.5)
    ax.set_title("How far Cloudflare's free plan goes", loc="left", pad=20)
    ax.text(0, 1.04, "Estimate: 35 requests and 50 written rows per user a day. Past about 2,000 users, the $5 plan.",
            transform=ax.transAxes, fontsize=8.5, color=INK2)
    save(fig, "fig8_free_plan.png")


# ---------------------------------------------------------------------------
# 9. Roadmap

def roadmap():
    done = [("Oct 29, 2026", "Complete\nbrowser" if WEB else "Chromium fork", "Google sign-in works"),
            ("Oct 30", "Yuzal built in", "AI agent, side panel"),
            ("Nov 16", "Named TizCat", "cheetah logos"),
            ("Nov 18", "Accounts, Rewards,\nwebsite live", "PGO speed build")]
    nxt = [("M0", "A browser\npeople keep", "installer,\nupdates"),
           ("M1", "First\nrevenue", "sponsored shortcuts,\npartner bookmarks"),
           ("M2", "Points\nledger", "built, in testing"),
           ("M3", "Pilot\npayouts", "gift cards or USDC;\nJibWallet"),
           ("M4", "Own ad\ncatalog", "sold directly"),
           ("M5", "Advertiser\nportal", "self-serve"),
           ("M6", "JibCoin", "only if it\nmust exist")]
    if WEB:
        # The website shows only what has happened: no future steps.
        fig, ax = canvas(7.6, 2.55)
        ax.set_ylim(0.50, 1.06)
        ax.text(0.0, 1.03, "How TizCat came together", fontsize=13, fontweight="bold", color=INK)
        ax.text(0.0, 0.985, "From the first complete build to accounts, Rewards and this website, in under three weeks.",
                fontsize=8.5, color=INK2)
    else:
        fig, ax = canvas(7.6, 4.8)
        ax.text(0.0, 1.03, "Roadmap: what is done, and the order of what comes next", fontsize=13, fontweight="bold", color=INK)
        ax.text(0.0, 0.985, "Each step pays for the next; none needs the one after it. Future steps carry no dates on purpose.",
                fontsize=8.5, color=INK2)

    def lane(items, y, color, filled, heading):
        xs = [0.08 + i * (0.86 / (len(items) - 1)) for i in range(len(items))]
        ax.text(0.0, y + 0.13, heading, fontsize=10.5, fontweight="bold", color=color)
        ax.plot([xs[0], xs[-1]], [y, y], color=color if filled else GRID, lw=3, solid_capstyle="round", zorder=1)
        for x, (tag, title, sub) in zip(xs, items):
            ax.plot([x], [y], "o", ms=12, color=color if filled else SURFACE, mec=color if not filled else SURFACE,
                    mew=2, zorder=2)
            ax.text(x, y + 0.055, tag, ha="center", fontsize=7.8, color=color, fontweight="bold")
            ax.text(x, y - 0.05, title, ha="center", va="top", fontsize=8, color=INK, fontweight="bold", linespacing=1.15)
            ax.text(x, y - 0.165, sub, ha="center", va="top", fontsize=7.1, color=INK2, linespacing=1.2)

    if WEB:
        lane(done, 0.74, LOCAL, True, "So far")
    else:
        lane(done, 0.74, LOCAL, True, "Done")
        lane(nxt, 0.31, NAVY, False, "Next, in this order")
    save(fig, "fig9_roadmap.png")


# ---------------------------------------------------------------------------
# 10. How TizCat pays its way (the user's income model, 2026-11-24). What is
# not decided yet carries "coming soon", by the user's instruction.

def tag(ax, x, y, w, text, color="#8a5d0f"):
    ax.text(x + w / 2, y + 0.028, text, ha="center", va="center", fontsize=7.8,
            color=color, fontweight="bold", style="italic")


def income():
    fig, ax = canvas(7.4, 4.5)
    ax.text(0.0, 1.03, "How TizCat pays its way", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.985, "Five sources of income, from three kinds of payers. None of them is selling your data.",
            fontsize=8.5, color=INK2)
    w = 0.31
    cols = [
        (0.0, "Advertisers", NAVY, NAVY_SOFT, NAVY, [
            ("TizCat Rewards ads", ["New Tab pictures and notifications,", "only for people who opt in"], "70% to viewers, 30% to TizCat"),
            ("Sponsored shortcuts", ["and address-bar suggestions,", "each labeled Sponsored"], "Details coming soon..."),
        ]),
        (0.345, "Shopping and travel partners", GOLD, GOLD_SOFT, "#8a5d0f", [
            ("Partner bookmarks", ["shopping and travel sites on the", "New Tab; a share when you buy"], "Details coming soon..."),
        ]),
        (0.69, "People who choose to pay", LOCAL, LOCAL_SOFT, LOCAL, [
            ("TizCat Cloud subscription", ["strong cloud AI for Yuzal,", "with no setup"], "Prices coming soon..."),
            ("JibWallet swap fees", ["a small fee when you swap tokens,", "shown before you approve"], "Details coming soon..."),
        ]),
    ]
    for x, payer, edge, fill, title_color, streams in cols:
        ax.add_patch(FancyBboxPatch((x, 0.845), w, 0.07, boxstyle="round,pad=0.008,rounding_size=0.02",
                                    lw=0, fc=edge))
        ax.text(x + w / 2, 0.88, payer, ha="center", va="center", fontsize=8.8, fontweight="bold", color="#ffffff")
        ys = [0.58, 0.33] if len(streams) == 2 else [0.455]
        for y, (title, lines, note) in zip(ys, streams):
            box(ax, x, y, w, 0.215, title, lines, fill=fill, edge=edge, title_color=title_color, size=9.4)
            tag(ax, x, y, w, note, color=title_color)
        arrow(ax, (x + w / 2, 0.33 if len(streams) == 2 else 0.455), (x + w / 2, 0.235), color=edge)
    ax.add_patch(FancyBboxPatch((0.0, 0.12), 1.0, 0.11, boxstyle="round,pad=0.008,rounding_size=0.02",
                                lw=1.2, ec=INK2, fc="#ffffff"))
    ax.text(0.5, 0.19, "TizCat", ha="center", va="center", fontsize=10.5, fontweight="bold", color=INK)
    ax.text(0.5, 0.145, "pays for its servers, security updates and development", ha="center", va="center",
            fontsize=8.2, color=INK2)
    ax.text(0.5, 0.055, "Never: selling your data, or putting ads inside other websites.", ha="center", va="center",
            fontsize=9, fontweight="bold", color=LOCAL)
    save(fig, "fig10_income.png")


# ---------------------------------------------------------------------------
# 11. Yuzal's two ways to think (the user's description, 2026-11-24)

def ai_modes():
    fig, ax = canvas(7.4, 4.5)
    ax.text(0.0, 1.03, "Yuzal: two ways to think", fontsize=13, fontweight="bold", color=INK)
    ax.text(0.0, 0.985, "Cloud AI for the strongest models; the local engine for private and highly secure documents.",
            fontsize=8.5, color=INK2)
    # Cloud
    ax.add_patch(FancyBboxPatch((0.0, 0.215), 0.46, 0.715, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.4, ec=NAVY, fc="#f4f6fb"))
    ax.text(0.23, 0.885, "Cloud AI", ha="center", va="center", fontsize=11, fontweight="bold", color=NAVY)
    box(ax, 0.025, 0.605, 0.41, 0.23, "TizCat Cloud subscription",
        ["strong cloud models with no setup;", "TizCat pays its AI partners"])
    tag(ax, 0.025, 0.605, 0.41, "Prices coming soon...", color=NAVY)
    box(ax, 0.025, 0.345, 0.41, 0.23, "Your own key",
        ["Gemini, ChatGPT, Claude and others;", "TizCat charges nothing for it"])
    tag(ax, 0.025, 0.345, 0.41, "You pay your AI company, or use its free tier", color=NAVY)
    ax.text(0.23, 0.275, "For each turn, the page text and a screenshot\ngo to that AI. Never your passwords.",
            ha="center", va="center", fontsize=7.6, color=INK2, linespacing=1.3)
    # Local
    ax.add_patch(FancyBboxPatch((0.54, 0.215), 0.46, 0.715, boxstyle="round,pad=0.01,rounding_size=0.02",
                                lw=1.6, ec=LOCAL, fc="#f3faf6"))
    ax.text(0.77, 0.885, "Local AI engine, on your laptop", ha="center", va="center", fontsize=11,
            fontweight="bold", color=LOCAL)
    box(ax, 0.565, 0.605, 0.41, 0.23, "Private and highly secure documents",
        ["bank statements, medical records,", "contracts and tax forms"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL, size=9.2)
    tag(ax, 0.565, 0.605, 0.41, "Switch to the local engine for these", color=LOCAL)
    box(ax, 0.565, 0.345, 0.41, 0.23, "Free, and nothing leaves",
        ["an open model runs through Ollama;", "about 16 GB of memory recommended"], fill=LOCAL_SOFT, edge=LOCAL, title_color=LOCAL)
    tag(ax, 0.565, 0.345, 0.41, "$0, no account, no limit but your hardware", color=LOCAL)
    ax.text(0.77, 0.275, "The page, the document and your words\nstay on the laptop.",
            ha="center", va="center", fontsize=7.6, color=INK2, linespacing=1.3)
    # The switch between them
    arrow(ax, (0.46, 0.59), (0.54, 0.59), color=GOLD, style="<|-|>", lw=2)
    ax.add_patch(FancyBboxPatch((0.0, 0.03), 1.0, 0.13, boxstyle="round,pad=0.008,rounding_size=0.02",
                                lw=1.2, ec=GOLD, fc="#fbf7ee"))
    ax.text(0.5, 0.118, "Switch any time in Yuzal's panel: Model, then \"On this PC\"", ha="center", va="center",
            fontsize=9.4, fontweight="bold", color="#8a5d0f")
    ax.text(0.5, 0.065, "Either way, passwords never reach the AI, and read-only and never-submit keep you in control.",
            ha="center", va="center", fontsize=8, color=INK2)
    save(fig, "fig11_ai_modes.png")


# Names after the options pick which figures to make (e.g. income ai_modes);
# none makes the full set.
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]
if __name__ == "__main__" and ONLY:
    for name in ONLY:
        globals()[name]()
elif __name__ == "__main__" and WEB:
    architecture()
    speed()
    rewards_flow()
    allocation()
    roadmap()
    income()
    ai_modes()
elif __name__ == "__main__":
    architecture()
    privacy()
    speed()
    rewards_flow()
    earnings()
    ai_cost()
    allocation()
    free_plan()
    roadmap()
    income()
    ai_modes()
