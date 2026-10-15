"""Q のブランド（おくるん＝OQRN・さくせん盤＝SAQSEN・キロっく＝kiloQ と同じ作り方）のアイコン・ロゴ・OGP を描く小さな道具。

図形の並び（円・輪・丸い端の線・多角形・角丸の四角・字）を1つ書けば、SVG（ファビコン・ロゴ）と PNG（ホーム画面・OGP）の両方を同じ形で描く。

  図形（100 × 100 の座標）
    {"t": "circle", "c": (x, y), "r": 半径}
    {"t": "ring", "c": (x, y), "r": 線の真ん中の半径, "w": 太さ}
    {"t": "line", "p": [(x, y), ...], "w": 太さ}   … 丸い端・丸い角の折れ線（arc() で弧の点を作れる）
    {"t": "poly", "p": [(x, y), ...]}             … arrow_head() で矢印の先、star() で星を作れる
    {"t": "rect", "box": (x0, y0, x1, y1), "rx": 角の丸み}
    {"t": "text", "s": "3", "c": (x, y), "h": 字の高さ}  … Jua の字。字の外形の真ん中を c にそろえる
  どれも "fill" と "alpha"（0〜1。省くと 1）を付けられる。fill は "white"（省いたとき）、
  "bg"（背景と同じグラデーション。白い形のまわりを削って見分けやすくするのに使う）、(r, g, b)（色。紙吹雪など）
  "deco": True を付けた図形はアイコンだけに描き、ロゴの Q には入れない（まわりの飾り）

このファイルは pomodoro・countdown・gender-reveal・line-p2p-othello・qji の tools/ に同じものを置く（直したらすべてそろえる）。
Pillow・fontTools・Jua（SIL Open Font License 1.1、~/Library/Fonts/Jua.ttf）・macOS のヒラギノ角ゴシックが必要。
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = Path.home() / "Library" / "Fonts" / "Jua.ttf"
RADIUS = 23  # アイコンの角の丸み（おくるん・さくせん盤・キロっくと同じ）


def hex_(rgb):
    return "#%02x%02x%02x" % rgb


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def polar(c, angle, dist):
    """c から angle 度（右が 0、時計回り）の向きに dist 進んだ点"""
    return (c[0] + math.cos(math.radians(angle)) * dist, c[1] + math.sin(math.radians(angle)) * dist)


def arc(c, r, start, end, step=4):
    """c を中心に半径 r の弧の点（start 度から end 度へ。end < start なら反時計回り）"""
    n = max(2, int(abs(end - start) / step))
    return [polar(c, start + (end - start) * i / n, r) for i in range(n + 1)]


def arrow_head(tip, direction, length, width):
    """tip を先にして direction 度の向きを指す矢印の先（三角形）"""
    back = polar(tip, direction + 180, length)
    return [tip, polar(back, direction - 90, width / 2), polar(back, direction + 90, width / 2)]


def star(c, outer, inner, points=5, rot=-90):
    """星形の多角形（最初の先は上向き）"""
    return [polar(c, rot + 180 / points * i, outer if i % 2 == 0 else inner) for i in range(points * 2)]


def shape_points(sh):
    """図形の外形を囲む点（円・輪・線の太さ・字の高さも含める）"""
    pad = sh.get("r", 0) + sh.get("w", 0) / 2 + sh.get("h", 0) / 2  # 円は半径、輪は外側、線は太さの半分、字は高さの半分
    points = [sh["box"][:2], sh["box"][2:]] if sh["t"] == "rect" else sh.get("p", [sh.get("c")])
    return [(x + dx, y + dy) for x, y in points for dx in (-pad, pad) for dy in (-pad, pad)]


def shapes_bounds(shapes):
    pts = [pt for sh in shapes if not sh.get("deco") for pt in shape_points(sh)]
    return min(x for x, _ in pts), min(y for _, y in pts), max(x for x, _ in pts), max(y for _, y in pts)


def centered(shapes, target=(50, 50)):
    """飾り（deco）以外の図形の外形の真ん中を target にそろえる（Q のしっぽの分も含めて、アイコンの真ん中に見えるように）。
    ずらした図形と、ずらした量 (dx, dy) を返す。飾りはそのまま"""
    x0, y0, x1, y1 = shapes_bounds(shapes)
    dx, dy = target[0] - (x0 + x1) / 2, target[1] - (y0 + y1) / 2
    move = lambda pt: (pt[0] + dx, pt[1] + dy)  # noqa: E731
    out = []
    for sh in shapes:
        sh = dict(sh)
        if not sh.get("deco"):
            if "c" in sh:
                sh["c"] = move(sh["c"])
            if "p" in sh:
                sh["p"] = [move(pt) for pt in sh["p"]]
            if "box" in sh:
                sh["box"] = (*move(sh["box"][:2]), *move(sh["box"][2:]))
        out.append(sh)
    return out, (dx, dy)


def _glyphs():
    from fontTools.ttLib import TTFont

    font = TTFont(str(FONT_PATH))
    return font.getGlyphSet(), font.getBestCmap()


def glyph_path(text, c, h):
    """Jua の字の SVG パス。字の外形の高さを h に、外形の真ん中を c にそろえる"""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen

    glyphs, cmap = _glyphs()
    names = [cmap[ord(ch)] for ch in text]
    advances, x, boxes = [], 0, []
    for name in names:
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        boxes.append(pen.bounds)
        advances.append(x)
        x += glyphs[name].width
    x0 = min(adv + b[0] for adv, b in zip(advances, boxes))
    x1 = max(adv + b[2] for adv, b in zip(advances, boxes))
    y0, y1 = min(b[1] for b in boxes), max(b[3] for b in boxes)
    k = h / (y1 - y0)
    ox, oy = c[0] - (x0 + x1) / 2 * k, c[1] + (y0 + y1) / 2 * k
    pen = SVGPathPen(glyphs)
    for adv, name in zip(advances, names):
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, ox + adv * k, oy)))
    return pen.getCommands()


def draw_text(d, text, c, h, s, fill):
    """glyph_path と同じ位置・大きさで、Pillow で字を描く"""
    size = 100
    for _ in range(3):  # 字の外形の高さが h になる大きさを探す
        font = ImageFont.truetype(str(FONT_PATH), round(size))
        b = d.textbbox((0, 0), text, font=font)
        size *= (h * s) / (b[3] - b[1])
    font = ImageFont.truetype(str(FONT_PATH), round(size))
    b = d.textbbox((0, 0), text, font=font)
    d.text((c[0] * s - (b[0] + b[2]) / 2, c[1] * s - (b[1] + b[3]) / 2), text, font=font, fill=fill)


class Brand:
    """light → dark のグラデーション。ふだんは左上→右下、horizontal=True は左→右"""

    def __init__(self, light, dark, horizontal=False):
        self.light, self.dark, self.horizontal = light, dark, horizontal

    def color_at(self, t):
        return tuple(round(self.light[i] + (self.dark[i] - self.light[i]) * t) for i in range(3))

    def gradient_svg(self, x0, y0, w, h, gid="g"):
        x2, y2 = (x0 + w, y0) if self.horizontal else (x0 + w, y0 + h)
        return (
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{num(x0)}" y1="{num(y0)}" x2="{num(x2)}" y2="{num(y2)}">'
            f'<stop offset="0" stop-color="{hex_(self.light)}"/><stop offset="1" stop-color="{hex_(self.dark)}"/></linearGradient>'
        )

    def gradient_image(self, w, h):
        img = Image.new("RGB", (w, h))
        px = img.load()
        for y in range(h):
            for x in range(w):
                t = x / (w - 1) if self.horizontal else (x / (w - 1) + y / (h - 1)) / 2
                px[x, y] = self.color_at(t)
        return img

    # ---- SVG ----

    def shapes_svg(self, shapes, gid="g"):
        out = []
        for sh in shapes:
            color = sh.get("fill", "white")
            fill = f"url(#{gid})" if color == "bg" else hex_(color) if isinstance(color, tuple) else "#ffffff"
            alpha = sh.get("alpha", 1)
            op = f' opacity="{num(alpha)}"' if alpha < 1 else ""
            t = sh["t"]
            if t == "circle":
                out.append(f'<circle cx="{num(sh["c"][0])}" cy="{num(sh["c"][1])}" r="{num(sh["r"])}" fill="{fill}"{op}/>')
            elif t == "ring":
                out.append(f'<circle cx="{num(sh["c"][0])}" cy="{num(sh["c"][1])}" r="{num(sh["r"])}" fill="none" stroke="{fill}" stroke-width="{num(sh["w"])}"{op}/>')
            elif t == "line":
                d = "M" + "L".join(f"{num(x)} {num(y)}" for x, y in sh["p"])
                out.append(f'<path d="{d}" fill="none" stroke="{fill}" stroke-width="{num(sh["w"])}" stroke-linecap="round" stroke-linejoin="round"{op}/>')
            elif t == "poly":
                pts = " ".join(f"{num(x)},{num(y)}" for x, y in sh["p"])
                out.append(f'<polygon points="{pts}" fill="{fill}"{op}/>')
            elif t == "rect":
                x0, y0, x1, y1 = sh["box"]
                out.append(f'<rect x="{num(x0)}" y="{num(y0)}" width="{num(x1 - x0)}" height="{num(y1 - y0)}" rx="{num(sh.get("rx", 0))}" fill="{fill}"{op}/>')
            elif t == "text":
                out.append(f'<path d="{glyph_path(sh["s"], sh["c"], sh["h"])}" fill="{fill}"{op}/>')
        return "".join(out)

    def icon_svg(self, shapes):
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f"<defs>{self.gradient_svg(0, 0, 100, 100)}</defs>"
            f'<clipPath id="frame"><rect width="100" height="100" rx="{RADIUS}"/></clipPath>'
            f'<rect width="100" height="100" rx="{RADIUS}" fill="url(#g)"/>'
            # 枠からはみ出した図形は、角の丸い枠で切る（PNG と同じ見え方）
            + '<g clip-path="url(#frame)">' + self.shapes_svg(shapes) + "</g></svg>\n"
        )

    # ---- PNG（4 倍で描いて縮め、ふちをなめらかにする） ----

    def icon_png(self, shapes, size, rounded=True):
        big = size * 4
        s = big / 100
        grad = self.gradient_image(big, big)
        white = Image.new("RGB", (big, big), (255, 255, 255))
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=RADIUS * s if rounded else 0, fill=255)
        img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        img.paste(grad, (0, 0), mask)
        for sh in shapes:
            layer_mask = Image.new("L", (big, big), 0)
            d = ImageDraw.Draw(layer_mask)
            a = round(255 * sh.get("alpha", 1))
            t = sh["t"]
            if t == "circle":
                (x, y), r = sh["c"], sh["r"]
                d.ellipse(((x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s), fill=a)
            elif t == "ring":
                (x, y), r, w = sh["c"], sh["r"], sh["w"]
                o = r + w / 2
                d.ellipse(((x - o) * s, (y - o) * s, (x + o) * s, (y + o) * s), outline=a, width=round(w * s))
            elif t == "line":
                pts = [(x * s, y * s) for x, y in sh["p"]]
                half = sh["w"] * s / 2
                if len(pts) > 1:
                    d.line(pts, fill=a, width=round(sh["w"] * s), joint="curve")
                for x, y in pts:  # 丸い端・丸い角
                    d.ellipse((x - half, y - half, x + half, y + half), fill=a)
            elif t == "poly":
                d.polygon([(x * s, y * s) for x, y in sh["p"]], fill=a)
            elif t == "rect":
                x0, y0, x1, y1 = sh["box"]
                d.rounded_rectangle((x0 * s, y0 * s, x1 * s, y1 * s), radius=sh.get("rx", 0) * s, fill=a)
            elif t == "text":
                draw_text(d, sh["s"], sh["c"], sh["h"], s, a)
            color = sh.get("fill", "white")
            src = grad if color == "bg" else Image.new("RGB", (big, big), color) if isinstance(color, tuple) else white
            layer = src.convert("RGBA")
            layer.putalpha(Image.composite(layer_mask, Image.new("L", (big, big), 0), mask))
            img = Image.alpha_composite(img, layer)
        return img.resize((size, size), Image.LANCZOS)

    def write_icons(self, root, shapes):
        root = Path(root)
        (root / "icon.svg").write_text(self.icon_svg(shapes), encoding="utf-8")
        self.icon_png(shapes, 180, rounded=False).convert("RGB").save(root / "apple-touch-icon.png", optimize=True)
        self.icon_png(shapes, 512).save(root / "icon-512.png", optimize=True)
        self.icon_png(shapes, 512, rounded=False).convert("RGB").save(root / "icon-maskable-512.png", optimize=True)
        self.icon_png(shapes, 32).save(root / "icon-32.png", optimize=True)

    # ---- 横長のロゴ（Jua の字を並べ、Q だけアイコンの形） ----

    def logo_svg(self, word, mark, mark_center, mark_radius, label, fills=None, plates=None):
        """word の "Q" の位置に、アイコンの図形 mark を置く。mark_center・mark_radius はアイコンの中の Q の輪の中心と外側の半径
        （字の高さ＝輪の直径になるよう縮める）。輪の外に出るしっぽの分だけ、次の字を右へずらす。
        fills は字ごとの色（word と同じ長さの並び。(r, g, b) か None＝白。Q の位置は使わない）。
        plates は字の後ろに敷く丸い板（[(字の位置の並び, (r, g, b)), ...]。ひっくりの黒い石・白い石など）"""
        from fontTools.pens.boundsPen import BoundsPen
        from fontTools.pens.svgPathPen import SVGPathPen
        from fontTools.pens.transformPen import TransformPen
        from fontTools.ttLib import TTFont

        font = TTFont(str(FONT_PATH))
        glyphs = font.getGlyphSet()
        cmap = font.getBestCmap()

        def bounds(char):
            pen = BoundsPen(glyphs)
            glyphs[cmap[ord(char)]].draw(pen)
            return pen.bounds

        top, bottom = bounds("I")[3], bounds("I")[1]  # 上下が平らな大文字の I で字の高さ（Q の輪の高さ）を決める
        h = top - bottom
        gap = h * 0.09
        thin = h * 0.05  # 字のふちを背景の色でなぞって少し細く見せる幅
        k = (h / 2) / mark_radius
        mark = [sh for sh in mark if not sh.get("deco")]
        # 図形の外形（しっぽを含む。輪の中心からの範囲）
        bx0, by0, bx1, by1 = shapes_bounds(mark)
        mx0, my0 = (bx0 - mark_center[0]) * k, (by0 - mark_center[1]) * k
        mx1, my1 = (bx1 - mark_center[0]) * k, (by1 - mark_center[1]) * k
        plate_of = {i: n for n, (indices, _) in enumerate(plates or []) for i in indices}
        plate_px, plate_py = h * 0.3, h * 0.16  # 板の、字のまわりの余白（横・縦）
        spans = {}  # 板ごとの字の左右のはし
        paths, x, q = [], 0.0, None
        for i, char in enumerate(word):
            plate = plate_of.get(i)
            if plate is not None and plate_of.get(i - 1) != plate:
                x += plate_px  # 板に入るところは、板の余白の分だけあける
            if char == "Q":
                cx = x - mx0
                q = (cx, h / 2)
                x = cx + mx1 + gap
                continue
            b = bounds(char)
            origin = x - b[0]
            pen = SVGPathPen(glyphs)
            glyphs[cmap[ord(char)]].draw(TransformPen(pen, (1, 0, 0, -1, origin, top)))
            color = fills[i] if fills else None
            # 字のふちは、板の上なら板の色、なければ背景の色でなぞる
            stroke = hex_(plates[plate][1]) if plate is not None else "url(#g)"
            paths.append((pen.getCommands(), hex_(color) if color else "#ffffff", stroke))
            if plate is not None:
                lo, hi = spans.get(plate, (origin + b[0], origin + b[2]))
                spans[plate] = (min(lo, origin + b[0]), max(hi, origin + b[2]))
            x = origin + b[2] + gap
            if plate is not None and plate_of.get(i + 1) != plate:
                x += plate_px  # 板から出るところも、板の余白の分だけあける
        right = x - gap
        pad_x, pad_y = h * 0.55, h * 0.42
        y_top = min(0, q[1] + my0)
        y_bottom = max(h, q[1] + my1)
        x0, y0 = -pad_x, y_top - pad_y
        width, height = right + pad_x * 2, (y_bottom - y_top) + pad_y * 2
        mark_g = (
            f'<g transform="translate({num(q[0])} {num(q[1])}) scale({k:.5f}) translate({num(-mark_center[0])} {num(-mark_center[1])})">'
            + self.shapes_svg(mark, gid="gm")
            + "</g>"
        )
        # Q の中の「背景の色」は縮めた座標で塗るので、同じグラデーションをその座標に直したもの（gm）を使う
        inner = lambda px, py: ((px - q[0]) / k + mark_center[0], (py - q[1]) / k + mark_center[1])  # noqa: E731
        ix0, iy0 = inner(x0, y0)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x0)} {num(y0)} {num(width)} {num(height)}" role="img" aria-label="{label}">'
            f"<defs>{self.gradient_svg(x0, y0, width, height)}{self.gradient_svg(ix0, iy0, width / k, height / k, gid='gm')}</defs>"
            f'<rect x="{num(x0)}" y="{num(y0)}" width="{num(width)}" height="{num(height)}" rx="{num(h * 0.3)}" fill="url(#g)"/>'
            + "".join(
                f'<rect x="{num(lo - plate_px)}" y="{num(-plate_py)}" width="{num(hi - lo + plate_px * 2)}" height="{num(h + plate_py * 2)}" '
                f'rx="{num(h / 2 + plate_py)}" fill="{hex_(plates[n][1])}"/>'
                for n, (lo, hi) in spans.items()
            )
            + f'<g stroke-width="{num(thin)}" stroke-linejoin="round">'
            + "".join(f'<path d="{d}" fill="{color}" stroke="{stroke}"/>' for d, color, stroke in paths)
            + "</g>"
            + mark_g
            + "</svg>\n"
        ), width / height

    # ---- OGP（1200×630。左にアイコン、右に名前・英字・説明） ----

    def write_ogp(self, path, shapes, name, en, lines, decorate=None, name_size=104, en_fills=None, en_plates=None):
        W, H, S = 1200, 630, 2
        big = (W * S, H * S)
        img = self.gradient_image(*big).convert("RGBA")
        if decorate:
            layer = Image.new("RGBA", big, (0, 0, 0, 0))
            decorate(ImageDraw.Draw(layer), S)
            img = Image.alpha_composite(img, layer)
        icon = self.icon_png(shapes, 300 * S)
        shadow = Image.new("RGBA", big, (0, 0, 0, 0))
        dark = tuple(round(c * 0.4) for c in self.dark)
        ImageDraw.Draw(shadow).rounded_rectangle((138 * S, 177 * S, 438 * S, 477 * S), radius=69 * S, fill=dark + (70,))
        img = Image.alpha_composite(img, shadow)
        img.alpha_composite(icon, (130 * S, 165 * S))
        d = ImageDraw.Draw(img)
        x = 490 * S
        hira = lambda w, size: ImageFont.truetype(f"/System/Library/Fonts/ヒラギノ角ゴシック W{w}.ttc", size * S)  # noqa: E731
        d.text((x, 250 * S), name, font=hira(8, name_size), fill=(255, 255, 255), anchor="ls")
        jua = ImageFont.truetype(str(FONT_PATH), 46 * S)
        cx = x
        # 字の間を少しあける。en_fills で字ごとの色（None＝白）、en_plates で字の後ろに丸い板（ロゴと同じ）
        plate_of = {i: n for n, (indices, _) in enumerate(en_plates or []) for i in indices}
        pad = 12 * S
        places = []
        for i, ch in enumerate(en):
            if i in plate_of and plate_of.get(i - 1) != plate_of[i]:
                cx += pad
            places.append(cx)
            cx += d.textlength(ch, font=jua) + 10 * S
            if i in plate_of and plate_of.get(i + 1) != plate_of[i]:
                cx += pad
        for n, (indices, color) in enumerate(en_plates or []):
            x0 = places[indices[0]] - pad
            x1 = places[indices[-1]] + d.textlength(en[indices[-1]], font=jua) + pad
            d.rounded_rectangle((x0, 280 * S, x1, 336 * S), radius=28 * S, fill=color)
        for i, ch in enumerate(en):
            color = en_fills[i] if en_fills and en_fills[i] else (255, 255, 255)
            d.text((places[i], 322 * S), ch, font=jua, fill=color + (255,), anchor="ls")
            cx += d.textlength(ch, font=jua) + 10 * S
        for i, line in enumerate(lines):
            d.text((x, (410 + 56 * i) * S), line, font=hira(6, 40), fill=(255, 255, 255), anchor="ls")
        img.resize((W, H), Image.LANCZOS).convert("RGB").save(path, optimize=True)
