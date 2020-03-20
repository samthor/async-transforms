#!/bin/bash

set -eu

for SRC in lib/*.js; do
  BASE=$(basename $SRC)
  node_modules/.bin/rollup --format=cjs --file=require/${BASE%.*}.cjs -- lib/$BASE
done
