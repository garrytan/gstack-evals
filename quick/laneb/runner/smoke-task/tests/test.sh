#!/bin/bash
set -u
mkdir -p /logs/verifier
cd /testbed
patch=/logs/artifacts/model.patch
applied=0
if [ -s "$patch" ] && git apply --whitespace=nowarn "$patch"; then applied=1; fi
passed=0
python3 -c 'import calc; assert calc.add(2, 3) == 5' && passed=1
echo "applied=$applied passed=$passed"
echo $(( applied && passed )) > /logs/verifier/reward.txt
