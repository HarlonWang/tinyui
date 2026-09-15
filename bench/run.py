#!/usr/bin/env python3
"""Run every model x scenario, collect median time, live heap after gc(), and the
smallest --memory-limit that completes. Writes results/<timestamp>.md."""
import json, os, re, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINES_ALL = {
    # binary, extra args, regex for live heap bytes in -d output
    "mqjs-Os": (os.path.join(HERE, ".engine", "mqjs"), [], r"heap size=(\d+)/"),
    "mqjs-O2": (os.path.join(HERE, ".engine-o2", "mqjs"), [], r"heap size=(\d+)/"),
    "qjs": (os.path.join(HERE, ".engine-qjs", "qjs"), ["--std"], r"memory used\s+\d+\s+(\d+)"),
}
ENGINES = {k: v for k, v in ENGINES_ALL.items() if k in os.environ.get("ENGINES", "mqjs-Os").split(",")}
MODELS_ALL = {
    "signal": ["signal.js"],
    "static-fine": ["static.js"],
    "static-coarse": ["coarse.js", "static.js"],
}
MODELS = {k: v for k, v in MODELS_ALL.items() if k in os.environ.get("MODELS", ",".join(MODELS_ALL)).split(",")}
SCENARIOS = os.environ.get("SCENARIOS", "S1,S2,S3,S4").split(",")
REPS = int(os.environ.get("REPS", "5"))
SKIP = {("static-coarse", "S1"), ("static-coarse", "S4")}  # identical code path to static-fine

def cmd(engine, model, scenario, extra=(), verify=False):
    binary, eargs, _ = ENGINES_ALL[engine]
    c = [binary, *eargs, *extra]
    for f in ["harness.js", *MODELS[model]]:
        c += ["-I", os.path.join(HERE, f)]
    c += [os.path.join(HERE, "run.js"), scenario]
    if verify:
        c.append("verify")
    return c

def run(engine, model, scenario, extra=(), verify=False):
    p = subprocess.run(cmd(engine, model, scenario, extra, verify), capture_output=True, text=True, timeout=600)
    return p.returncode, p.stdout, p.stderr

def measure(engine, model, scenario):
    times, heap, meta = [], None, None
    heap_re = ENGINES_ALL[engine][2]
    reps = 1 if model == "static-coarse" else REPS  # coarse S2 runs ~75 s; memory path is static-fine's
    for _ in range(reps):
        rc, out, err = run(engine, model, scenario, ["-d"])
        if rc != 0:
            raise RuntimeError(f"{engine} {model} {scenario} failed:\n{out}\n{err}")
        r = json.loads(re.search(r"RESULT (.*)", out).group(1))
        times.append(r["ms"])
        heap = int(re.search(heap_re, out).group(1))
        meta = r
    return statistics.median(times), min(times), heap, meta

def min_heap(engine, model, scenario):
    """Smallest --memory-limit (KiB, 64 KiB granularity) at which the run completes."""
    lo, hi = 64, 64
    while run(engine, model, scenario, ["--memory-limit", f"{hi}k"])[0] != 0:
        hi *= 2
        if hi > 1 << 20:
            return None
    lo = hi // 2
    while hi - lo > 64:
        mid = (lo + hi) // 2
        if run(engine, model, scenario, ["--memory-limit", f"{mid}k"])[0] == 0:
            hi = mid
        else:
            lo = mid
    return hi

def verify_all():
    """Every (engine, model) must produce the same patch stream per scenario."""
    ref = {}
    for scenario in SCENARIOS:
        for engine in ENGINES:
            for model in MODELS:
                if (model, scenario) in SKIP:
                    continue
                rc, out, err = run(engine, model, scenario, verify=True)
                if rc != 0:
                    raise RuntimeError(f"verify {engine} {model} {scenario} failed:\n{err}")
                flushes = [sorted(json.dumps(op) for op in json.loads(l)) for l in out.splitlines() if l.startswith("[")]
                if scenario not in ref:
                    ref[scenario] = ((engine, model), flushes)
                elif ref[scenario][1] != flushes:
                    raise RuntimeError(f"patch stream differs: {engine}/{model} vs {ref[scenario][0]} in {scenario}")
    print(f"verify: patch streams identical across {list(ENGINES)} x {list(MODELS)}")

def main():
    for e in ENGINES:
        if not os.path.exists(ENGINES_ALL[e][0]):
            sys.exit(f"engine {e} not built: see bench/README.md")
    verify_all()
    rows = []
    for scenario in SCENARIOS:
        for engine in ENGINES:
            for model in MODELS:
                if (model, scenario) in SKIP:
                    continue
                try:
                    med, best, heap, meta = measure(engine, model, scenario)
                except RuntimeError as e:
                    print(f"{scenario} {engine:8s} {model:12s} FAILED: {str(e).splitlines()[0]}")
                    rows.append((scenario, engine, model, None, None, None, None, None))
                    continue
                mh = None if model == "static-coarse" else min_heap(engine, model, scenario)
                rows.append((scenario, engine, model, med, best, heap, mh, meta))
                print(f"{scenario} {engine:8s} {model:12s} median {med:9.2f} ms  min {best:9.2f} ms  live heap {heap/1024:8.1f} KiB  min limit {mh} KiB")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = os.path.join(HERE, "results", f"{stamp}.md")
    with open(out, "w") as f:
        f.write(f"# mqjs reactivity bench — {stamp}\n\n")
        f.write(f"engines: {', '.join(ENGINES)}; macOS arm64, REPS={REPS}\n\n")
        f.write("| scenario | engine | model | median ms | min ms | live heap KiB | min --memory-limit KiB | flushes | patches | bytes |\n")
        f.write("|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n")
        for s, e, m, med, best, heap, mh, meta in rows:
            if meta is None:
                f.write(f"| {s} | {e} | {m} | crash | — | — | — | — | — | — |\n")
                continue
            f.write(f"| {s} | {e} | {m} | {med:.2f} | {best:.2f} | {heap/1024:.1f} | {mh} | {meta['flushes']} | {meta['patches']} | {meta['bytes']} |\n")
    print("written", out)

if __name__ == "__main__":
    main()
