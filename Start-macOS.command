#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -x .venv/bin/python || ! -d node_modules ]]; then
  node scripts/setup.mjs || exit 1
fi
node server/main.mjs --open
