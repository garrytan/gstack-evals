#!/bin/bash
cd /testbed
python -c 'from calc import add; assert add(2, 3) == 5' && echo 1 > /logs/verifier/reward.txt || echo 0 > /logs/verifier/reward.txt
