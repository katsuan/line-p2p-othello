#!/usr/bin/env python3
"""ひっくり（HiQRi）のアイコン・ロゴ・OGP を作る。

名前は「ひっくり」（石をひっくり返す）。英字は HiQRi（おくるん＝OQRN・キロっく＝kiloQ と同じ作り方で、「く」を Q にする。Q の後ろも「Ri」と大文字）。
アイコンはおくるんと同じ角の丸い四角に、盤の緑（css/board.css の --board #14542e）とうっすら盤の線。
Q の輪は、白と黒の2本の矢印が追いかけ合う「入れ替え」の矢印（黒と白がひっくり返る）。
Q のしっぽは、輪の中から外へ斜めに刺さって突き抜ける石（少しだけ上から見た円盤を細長く。上の面が白、厚みが黒）で、
O に棒が刺さった Q の形。黒い矢印はこの石の下から出る。

  assets/icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  assets/logo.svg … 横長のロゴ「HiQRi」（H・i・R・i は Jua。Hi は黒い石の上に白い字、Ri は白い石の上に黒い字で、間の Q が黒から白へひっくり返るところ。Q はアイコンと同じ形（盤の線は除く））
  assets/ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
import math
from pathlib import Path

import brandkit_path  # noqa: F401（となりのおくるん（q-oqrn）の tools/brandkit.py を読めるようにする）
from brandkit import Brand, arc, arrow_head, centered, polar

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BRAND = Brand(light=(40, 130, 76), dark=(20, 84, 46))  # 盤の緑 #14542e
BLACK, WHITE = (32, 32, 32), (251, 248, 240)  # 石の色（css と同じ）
# ロゴ：Q の前の「Hi」は黒い石の上に白い字、後ろの「Ri」は白い石の上に黒い字。
# 間の Q（半分ずつ黒と白の石）で、黒から白へひっくり返るところを表す
LETTERS = [WHITE, WHITE, None, BLACK, BLACK]
PLATES = [((0, 1), BLACK), ((3, 4), WHITE)]

C = (46, 46)  # 輪の中心
R, RING_W = 23, 9  # 輪の半径（線の真ん中）・太さ
TAIL = 45  # しっぽの石の向き（右下）
BLACK_FROM = 40  # 黒い矢印の始まり（足の石の下から出る）


def ellipse(c, rx, ry, rot, a0=0, a1=360, step=6):
    """c を中心に、rot 度に傾いた楕円の点（a0〜a1 度の範囲）"""
    n = max(2, int(abs(a1 - a0) / step))
    r = math.radians(rot)
    pts = []
    for i in range(n + 1):
        t = math.radians(a0 + (a1 - a0) * i / n)
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((c[0] + x * math.cos(r) - y * math.sin(r), c[1] + x * math.sin(r) + y * math.cos(r)))
    return pts


def swap_arrows():
    """白と黒の入れ替え矢印（白は上を時計回りに右へ、黒は下を時計回りに左へ）。黒は盤の緑から浮くよう白でふち取る"""
    def head(end, length, width, extra=0):
        tip = polar(polar(C, end, R), end + 90, 8 + extra)
        return arrow_head(tip, end + 90, length, width)

    white_end = 360 + BLACK_FROM - 38
    black = arc(C, R, BLACK_FROM, 190)
    return [
        {"t": "line", "p": arc(C, R, 225, white_end), "w": RING_W},
        {"t": "poly", "p": head(white_end, 11, 19)},
        {"t": "line", "p": black, "w": RING_W + 3},
        {"t": "poly", "p": head(190, 14, 23, 1.4)},
        {"t": "line", "p": black, "w": RING_W, "fill": BLACK},
        {"t": "poly", "p": head(190, 11, 19), "fill": BLACK},
    ]


def tail_stone(center_dist=R + 5, rx=22, ry=6.1, thick=4.4, outline=2.4):
    """Q のしっぽ＝輪に斜めに刺さった石（少しだけ上から見た円盤を細長く）。輪の中から外へ突き抜ける（O に棒が刺さった Q）。
    上の面が白、厚みが黒。まわりを背景の色でふち取る。黒い矢印はこの石の下から出る"""
    center = polar(C, TAIL, center_dist)
    low = polar(center, TAIL + 90, thick)  # 厚みの分だけ画面の下寄りへ
    mid = polar(center, TAIL + 90, thick / 2)
    side = ellipse(low, rx, ry, TAIL, 0, 180) + ellipse(center, rx, ry, TAIL, 180, 360)  # 黒い厚み（下の弧＋上の弧）
    return [
        {"t": "poly", "p": ellipse(mid, rx + outline, ry + thick / 2 + outline, TAIL), "fill": "bg"},
        {"t": "poly", "p": side, "fill": BLACK},
        {"t": "poly", "p": ellipse(center, rx, ry, TAIL), "fill": WHITE},
    ]


SHAPES = [
    # うっすら盤の線（アイコンだけ。ロゴには入れない）
    *[{"t": "line", "p": [(x, 6), (x, 94)], "w": 1.6, "alpha": 0.14, "deco": True} for x in (25, 50, 75)],
    *[{"t": "line", "p": [(6, y), (94, y)], "w": 1.6, "alpha": 0.14, "deco": True} for y in (25, 50, 75)],
    # 輪の内側は塗らず、盤の線をそのまま見せる
    *swap_arrows(),
    *tail_stone(),
]
# 外形（しっぽを含む）の真ん中をアイコンの真ん中にそろえる（ロゴも同じ形を使う）
SHAPES, (_DX, _DY) = centered(SHAPES)
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


def decorate(d, s):
    """OGP の背景：うっすら盤の線"""
    for x in range(75, 1200, 150):
        d.line((x * s, 0, x * s, 630 * s), fill=(255, 255, 255, 30), width=3 * s)
    for y in range(90, 630, 150):
        d.line((0, y * s, 1200 * s, y * s), fill=(255, 255, 255, 30), width=3 * s)


def main():
    BRAND.write_icons(ASSETS, SHAPES)
    logo, ratio = BRAND.logo_svg("HiQRi", SHAPES, C, RING_OUTER, "HiQRi（ひっくり）", fills=LETTERS, plates=PLATES)
    (ASSETS / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(ASSETS / "ogp.png", SHAPES, "ひっくり", "HiQRi", ["LINE の友だちと、石を", "ひっくり返して対戦"], decorate, en_fills=LETTERS, en_plates=PLATES)
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
