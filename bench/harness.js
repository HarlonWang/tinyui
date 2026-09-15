// Shared by both models: host stub, seeded data, keyed reconcile, scenario driver.
// ES5 only (mquickjs subset, strict mode).

var __verify = false;
var __flushCount = 0, __patchCount = 0, __patchBytes = 0;

var __host = {
    apply: function (json, count) {
        __flushCount++;
        __patchCount += count;
        __patchBytes += json.length;
        if (__verify) print(json);
    }
};

var __seed = 12345;
function rand(n) {
    __seed = (__seed * 1103515245 + 12345) & 0x7fffffff;
    return __seed % n;
}

function makeItems(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
        out.push({ key: i + 1, title: "Item " + i + " " + rand(1000), done: rand(4) === 0, ver: 0 });
    }
    return out;
}

// Keyed reconcile shared by both models so the patch streams are comparable.
// cb.remove(key) / cb.move(key, index) / cb.create(key, index)
function reconcileKeys(oldKeys, newKeys, cb) {
    var i, k, present = {};
    for (i = 0; i < newKeys.length; i++) present[newKeys[i]] = true;
    var cur = [];
    for (i = 0; i < oldKeys.length; i++) {
        k = oldKeys[i];
        if (present[k]) cur.push(k); else cb.remove(k);
    }
    var pos = {};
    for (i = 0; i < cur.length; i++) pos[cur[i]] = true;
    for (i = 0; i < newKeys.length; i++) {
        k = newKeys[i];
        if (cur[i] === k) continue;
        if (pos[k]) {
            var j = cur.indexOf(k, i + 1);
            cur.splice(j, 1);
            cur.splice(i, 0, k);
            cb.move(k, i);
        } else {
            cur.splice(i, 0, k);
            pos[k] = true;
            cb.create(k, i);
        }
    }
    return cur;
}

// Scenario driver. `app` is provided by the model file:
//   app.mount(items) / app.setTitle(i, s) / app.setDone(i, b) / app.setVer(i, n)
//   app.setItems(items) / app.flush()
function runScenario(name, verify) {
    var N = verify ? 20 : 1000;
    var items = makeItems(N);
    var t0, t1, i, r, k;

    if (name === "S1") {
        t0 = performance.now();
        app.mount(items);
        app.flush();
        t1 = performance.now();
    } else if (name === "S2") {
        app.mount(items); app.flush();
        var K = verify ? 10 : 200000;
        t0 = performance.now();
        for (k = 1; k <= K; k++) {
            app.setVer(k % N, k);
            app.flush();
        }
        t1 = performance.now();
    } else if (name === "S3") {
        app.mount(items); app.flush();
        var R = verify ? 3 : 2000, M = verify ? 5 : 100;
        t0 = performance.now();
        for (r = 1; r <= R; r++) {
            for (i = 0; i < M; i++) {
                var idx = (i * (N / M) + r) % N;
                if ((i & 3) === 0) app.setDone(idx, (r & 1) === 1); else app.setVer(idx, r);
            }
            app.flush();
        }
        t1 = performance.now();
    } else if (name === "S4") {
        app.mount(items); app.flush();
        var R4 = verify ? 2 : 30;
        t0 = performance.now();
        for (r = 0; r < R4; r++) {
            app.setItems([]); app.flush();
            app.setItems(items); app.flush();
        }
        t1 = performance.now();
    } else {
        throw new Error("unknown scenario " + name);
    }
    if (typeof gc === "function") gc(); else std.gc();
    print("RESULT " + JSON.stringify({
        model: MODEL, scenario: name, ms: t1 - t0,
        flushes: __flushCount, patches: __patchCount, bytes: __patchBytes
    }));
}
