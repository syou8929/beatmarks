# BeatMarks Engine

音声解析エンジン(Python)。アプリ本体からは同梱バイナリとして子プロセス起動される。

## 開発

    cd engine
    python3 -m venv .venv && source .venv/bin/activate
    pip install -e ".[dev]"
    pytest

## プロトコル

stdio 上の NDJSON / JSON-RPC 2.0。メソッド: `ping` / `version` / `analyze` / `cancel`。
`analyze` 実行中は `progress` notification(`{jobId, stage, percent}`)を送出する。
詳細は `beatmarks_engine/rpc.py` の docstring と `tests/test_rpc.py` を参照。

## 単発解析(デバッグ用)

    beatmarks-engine --analyze song.wav --out result.json

## バイナリビルド

    pyinstaller engine.spec --noconfirm
    ./dist/beatmarks-engine --version   # => 0.1.0

トラブルシューティング: frozen 環境で numba の ImportError が出る場合は
`NUMBA_DISABLE_JIT=1` で起動する(解析は遅くなるが動作する)。

エントリスクリプト(`beatmarks_engine/__main__.py`)は PyInstaller から
パッケージ経由ではなく直接実行されるため、相対import(`from . import ...`)は
`ImportError: attempted relative import with no known parent package` で失敗する
(`python beatmarks_engine/__main__.py` のように直接実行した場合も同様)。
このためエントリスクリプト内は絶対import(`from beatmarks_engine import ...`)を
使用する(本リポジトリでは対応済み。`beatmarks_engine` パッケージ内部の他モジュールは
通常どおりサブモジュールとしてインポートされるため相対importのままでよい)。
