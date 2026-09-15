#!/usr/bin/env python3
"""Compare two verify outputs: same number of flushes, same multiset of ops per flush."""
import json, sys

def load(path):
    flushes = []
    for line in open(path):
        line = line.strip()
        if line.startswith("RESULT") or not line:
            continue
        ops = json.loads(line)
        flushes.append(sorted(json.dumps(op) for op in ops))
    return flushes

a, b = load(sys.argv[1]), load(sys.argv[2])
if len(a) != len(b):
    print(f"flush count differs: {len(a)} vs {len(b)}"); sys.exit(1)
for i, (x, y) in enumerate(zip(a, b)):
    if x != y:
        print(f"flush #{i} differs:")
        print("  only in A:", [o for o in x if o not in y][:5])
        print("  only in B:", [o for o in y if o not in x][:5])
        sys.exit(1)
print(f"identical: {len(a)} flushes, {sum(len(f) for f in a)} ops")
