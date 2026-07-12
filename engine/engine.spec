# -*- mode: python ; coding: utf-8 -*-
"""BeatMarks engine の PyInstaller ビルド定義。

librosa / numba / llvmlite / soundfile はデータファイルや動的ロードを含むため
collect_all で丸ごと同梱する(スペック §12 の既知レシピ)。
"""
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("librosa", "numba", "llvmlite", "soundfile", "audioread", "lazy_loader"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["beatmarks_engine/__main__.py"],
    pathex=["."],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["matplotlib", "tkinter", "PIL"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="beatmarks-engine",
    console=True,
    strip=False,
    upx=False,
)
