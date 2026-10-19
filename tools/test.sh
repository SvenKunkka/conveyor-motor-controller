#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$ROOT/verification"
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -I"$ROOT/firmware/include" "$ROOT/tests/safety.cpp" -o "$ROOT/verification/safety-ubsan"
"$ROOT/verification/safety-ubsan"
node --test "$ROOT"/tests/*.test.mjs
"$ROOT/.venv/bin/python" -m unittest discover -s "$ROOT/tests" -p 'test_*.py' -v
