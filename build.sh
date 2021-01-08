#!/bin/bash

set -eu

cd src

for SRC in **/*.js *.js; do
  echo $SRC
  ../node_modules/.bin/rollup --format=cjs --file=../${SRC%.*}.cjs -- $SRC
done

touch ../worker/index.js
cp worker/index.d.ts ../worker/index.d.ts

touch ../index.js
cp index.d.ts ../index.d.ts