#!/bin/bash

set -eu

cd src

for SRC in **/*.js *.js; do
  echo $SRC
  ../node_modules/.bin/rollup --format=cjs --file=../require/${SRC%.*}.cjs -- $SRC
done

# We place the types here because TypeScript doesn't know about named subdir exports.
mkdir -p ../worker
cp worker/index.d.ts ../worker/index.d.ts
