#!/usr/bin/env python3
"""
Per-Instance Program Synthesis (PIPS) entry-point.

Usage:
    python -m pips                 # starts on 0.0.0.0:8080
    python -m pips --port 5000     # custom port
    python -m pips --host 127.0.0.1 --debug
"""

import argparse
import sys

# Import the runner we exposed in the simplified web_app.py
from .web_app import run_app





def main() -> None:
    parser = argparse.ArgumentParser(
        prog="pips",
        description="PIPS – Per-Instance Program Synthesis web interface",
    )

    parser.add_argument(
        "-p", "--port",
        type=int,
        default=8080,
        help="HTTP port to listen on (default 8080)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Bind address (default 0.0.0.0)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable Flask/SockeIO debug mode",
    )

    args = parser.parse_args()

    print(f"▶️  Per-Instance Program Synthesis (PIPS) web UI: http://{args.host}:{args.port}  (debug={args.debug})")

    try:
        run_app(host=args.host, port=args.port, debug=args.debug)
    except KeyboardInterrupt:
        print("\n👋  Shutting down Per-Instance Program Synthesis (PIPS)—good-bye!")
        sys.exit(0)
    except Exception as exc:           # pragma: no cover
        print(f"❌  Fatal error starting Per-Instance Program Synthesis (PIPS): {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
