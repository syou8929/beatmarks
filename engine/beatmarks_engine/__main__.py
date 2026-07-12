"""CLI エントリポイント。

- 引数なし             → JSON-RPC サーバーモード(アプリが子プロセスとして起動)
- --analyze <wav>      → 単発解析して JSON を stdout(または --out ファイル)へ
- --version            → エンジンバージョン
"""
import argparse
import json
import sys

from beatmarks_engine import ENGINE_VERSION


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="beatmarks-engine")
    parser.add_argument("--analyze", metavar="AUDIO", help="単発解析する音声ファイル")
    parser.add_argument("--out", metavar="JSON", help="解析結果の出力先ファイル")
    parser.add_argument("--version", action="store_true", help="バージョン表示")
    args = parser.parse_args(argv)

    if args.version:
        print(ENGINE_VERSION)
        return 0

    if args.analyze:
        from beatmarks_engine.analyze import analyze
        from beatmarks_engine.audio_io import AudioLoadError
        try:
            result = analyze(
                args.analyze,
                progress=lambda s, p: print(f"[{p:3d}%] {s}", file=sys.stderr),
            )
        except AudioLoadError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        text = json.dumps(result, ensure_ascii=False)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text)
        else:
            print(text)
        return 0

    from beatmarks_engine.rpc import RpcServer
    server = RpcServer()
    server.serve_forever()
    server.wait_for_jobs()
    return 0


if __name__ == "__main__":
    sys.exit(main())
