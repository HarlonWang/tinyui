#!/usr/bin/env python3
"""Run every model x scenario, collect median time, live heap after gc(), and the
smallest --memory-limit that completes. Writes results/<timestamp>.md."""
import json, os, re, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
MQJS = os.path.join(HERE, ".engine", "mqjs")
MODELS_ALL = {
    "signal": ["signal.js"],
    "static-fine": ["static.js"],
    "static-coarse": ["coarse.js", "static.js"],
}
MODELS = {k: v for k, v in MODELS_ALL.items() if k in os.environ.get("MODELS", ",".join(MODELS_ALL)).split(",")}
SCENARIOS = os.environ.get("SCENARIOS", "S1,S2,S3,S4").split(",")
REPS = int(os.environ.get("REPS", "5"))
SKIP = {("static-coarse", "S1"), ("static-coarse", "S4")}  # identical code path to static-fine

def cmd(model, scenario, extra=(), verify=False):
    c = [MQJS, *extra]
    for f in ["harness.js", *MODELS[model]]:
        c += ["-I", os.path.join(HERE, f)]
    c += [os.path.join(HERE, "run.js"), scenario]
    if verify:
        c.append("verify")
    return c

def run(model, scenario, extra=(), verify=False):
    p = subprocess.run(cmd(model, scenario, extra, verify), capture_output=True, text=True, timeout=600)
    return p.returncode, p.stdout, p.stderr

def measure(model, scenario):
    times, heap, meta = [], None, None
    reps = 1 if model == "static-coarse" else REPS  # coarse S2 runs ~75 s; memory path is static-fine's
    for _ in range(reps):
        rc, out, err = run(model, scenario, ["-d"])
        if rc != 0:
            raise RuntimeError(f"{model} {scenario} failed:\n{out}\n{err}")
        r = json.loads(re.search(r"RESULT (.*)", out).group(1))
        times.append(r["ms"])
        heap = int(re.search(r"heap size=(\d+)/", out).group(1))
        meta = r
    return statistics.median(times), min(times), heap, meta

def min_heap(model, scenario):
    """Smallest --memory-limit (KiB, 64 KiB granularity) at which the run completes."""
    lo, hi = 64, 64
    while run(model, scenario, ["--memory-limit", f"{hi}k"])[0] != 0:
        hi *= 2
        if hi > 1 << 20:
            return None
    lo = hi // 2
    while hi - lo > 64:
        mid = (lo + hi) // 2
        if run(model, scenario, ["--memory-limit", f"{mid}k"])[0] == 0:
            hi = mid
        else:
            lo = mid
    return hi

def verify_all():
    ref = {}
    for scenario in SCENARIOS:
        for model in MODELS:
            if (model, scenario) in SKIP:
                continue
            rc, out, err = run(model, scenario, verify=True)
            if rc != 0:
                raise RuntimeError(f"verify {model} {scenario} failed:\n{err}")
            flushes = [sorted(json.dumps(op) for op in json.loads(l)) for l in out.splitlines() if l.startswith("[")]
            if scenario not in ref:
                ref[scenario] = (model, flushes)
            elif ref[scenario][1] != flushes:
                raise RuntimeError(f"patch stream differs: {model} vs {ref[scenario][0]} in {scenario}")
    print("verify: patch streams identical across models")

def main():
    if not os.path.exists(MQJS):
        sys.exit("engine not built: run bench/build-engine.sh first")
    verify_all()
    rows = []
    for scenario in SCENARIOS:
        for model in MODELS:
            if (model, scenario) in SKIP:
                continue
            med, best, heap, meta = measure(model, scenario)
            mh = None if model == "static-coarse" else min_heap(model, scenario)
            rows.append((scenario, model, med, best, heap, mh, meta))
            print(f"{scenario} {model:14s} median {med:9.2f} ms  min {best:9.2f} ms  live heap {heap/1024:8.1f} KiB  min limit {mh} KiB")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = os.path.join(HERE, "results", f"{stamp}.md")
    with open(out, "w") as f:
        f.write(f"# mqjs reactivity bench — {stamp}\n\n")
        f.write(f"engine: MicroQuickJS (-Os), macOS arm64, REPS={REPS}\n\n")
        f.write("| scenario | model | median ms | min ms | live heap KiB | min --memory-limit KiB | flushes | patches | bytes |\n")
        f.write("|---|---|---:|---:|---:|---:|---:|---:|---:|\n")
        for s, m, med, best, heap, mh, meta in rows:
            f.write(f"| {s} | {m} | {med:.2f} | {best:.2f} | {heap/1024:.1f} | {mh} | {meta['flushes']} | {meta['patches']} | {meta['bytes']} |\n")
    print("written", out)

if __name__ == "__main__":
    main()
