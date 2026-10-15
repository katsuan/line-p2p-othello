"""となりの line-share/tools にある共通の描画スクリプト（brandkit.py）を読めるようにする。

line-share と同じフォルダ（~/GitHub）に、このリポジトリを置いて使う。
"""
import sys
from pathlib import Path

SHARED = Path(__file__).resolve().parents[2] / "line-share" / "tools"
if not (SHARED / "brandkit.py").exists():
    sys.exit(f"共通の描画スクリプトが見つかりません：{SHARED / 'brandkit.py'}（line-share を同じフォルダに置いてください）")
sys.path.insert(0, str(SHARED))
