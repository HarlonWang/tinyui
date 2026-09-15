// Model A: runtime signals (Solid-style). Dependencies discovered while effects run.
var MODEL = "signal";

var currentEffect = null, currentOwner = null;
var pending = [];
var patches = [];
var nextId = 1;
var handlers = {};

function signal(init) {
    var value = init, subs = [];
    function read() {
        var e = currentEffect;
        if (e && subs.indexOf(e) < 0) { subs.push(e); e.deps.push(subs); }
        return value;
    }
    function write(next) {
        if (next === value) return;
        value = next;
        for (var i = 0; i < subs.length; i++) {
            var e = subs[i];
            if (!e.queued) { e.queued = true; pending.push(e); }
        }
    }
    return [read, write];
}

function cleanupDeps(e) {
    for (var i = 0; i < e.deps.length; i++) {
        var subs = e.deps[i], k = subs.indexOf(e);
        if (k >= 0) subs.splice(k, 1);
    }
    e.deps = [];
}

function disposeOwner(o) {
    for (var i = 0; i < o.children.length; i++) {
        var c = o.children[i];
        c.disposed = true;
        cleanupDeps(c);
        disposeOwner(c);
    }
    o.children = [];
}

function runEffect(e) {
    if (e.disposed) return;
    cleanupDeps(e);
    disposeOwner(e);
    var prevE = currentEffect, prevO = currentOwner;
    currentEffect = e; currentOwner = e;
    e.fn();
    currentEffect = prevE; currentOwner = prevO;
}

function createEffect(fn) {
    var e = { fn: fn, deps: [], children: [], queued: false, disposed: false };
    if (currentOwner) currentOwner.children.push(e);
    runEffect(e);
    return e;
}

function flush() {
    for (var i = 0; i < pending.length; i++) {
        var e = pending[i];
        e.queued = false;
        runEffect(e);
    }
    pending = [];
    if (patches.length) {
        __host.apply(JSON.stringify(patches), patches.length);
        patches = [];
    }
}

function bindProp(id, key, thunk) {
    var last;
    createEffect(function () {
        var v = thunk();
        if (v !== last) { last = v; patches.push(["p", id, key, v]); }
    });
}

function h(type, props, children) {
    var id = nextId++;
    patches.push(["c", id, type]);
    if (props) {
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i], v = props[key];
            if (key.indexOf("on") === 0) {
                handlers[id + ":" + key] = v;
                patches.push(["p", id, key, true]);
            } else if (typeof v === "function") {
                bindProp(id, key, v);
            } else {
                patches.push(["p", id, key, v]);
            }
        }
    }
    if (children) {
        for (var j = 0; j < children.length; j++) patches.push(["i", id, children[j], j]);
    }
    return id;
}

function For(parentId, listRead, keyFn, renderRow) {
    var rows = {}, keys = [];
    createEffect(function () {
        var list = listRead(), newKeys = [], byKey = {};
        for (var i = 0; i < list.length; i++) {
            var k = keyFn(list[i]);
            newKeys.push(k);
            byKey[k] = list[i];
        }
        keys = reconcileKeys(keys, newKeys, {
            remove: function (k) {
                var r = rows[k];
                disposeOwner(r.owner);
                delete handlers[r.id + ":onClick"];
                patches.push(["r", r.id]);
                delete rows[k];
            },
            move: function (k, idx) { patches.push(["m", parentId, rows[k].id, idx]); },
            create: function (k, idx) {
                var owner = { children: [] };
                var prevE = currentEffect, prevO = currentOwner;
                currentEffect = null; currentOwner = owner;
                var id = renderRow(byKey[k]);
                currentEffect = prevE; currentOwner = prevO;
                rows[k] = { id: id, owner: owner };
                patches.push(["i", parentId, id, idx]);
            }
        });
    });
}

// ---- the app under test ----

function makeRecord(it) {
    return { key: it.key, title: signal(it.title), done: signal(it.done), ver: signal(it.ver) };
}

function renderRow(rec) {
    var title = rec.title[0], done = rec.done[0], ver = rec.ver[0];
    return h("Row", { onClick: function () {} }, [
        h("Text", { text: title, color: function () { return done() ? "#999" : "#000"; } }),
        h("Text", { text: function () { return "#" + ver(); } })
    ]);
}

var app = (function () {
    var itemsSig = signal([]), items = itemsSig[0], setItemsSig = itemsSig[1];
    var doneSig = signal(0), doneCount = doneSig[0], setDoneCount = doneSig[1];
    var records = [];

    function load(list) {
        var recs = [], n = 0;
        for (var i = 0; i < list.length; i++) {
            recs.push(makeRecord(list[i]));
            if (list[i].done) n++;
        }
        records = recs;
        setDoneCount(n);
        setItemsSig(recs);
    }

    return {
        mount: function (list) {
            load(list);
            var root = { children: [] };
            currentOwner = root;
            var header = h("Text", { text: function () { return "done " + doneCount() + "/" + items().length; } });
            var list_ = h("List", {});
            For(list_, items, function (r) { return r.key; }, renderRow);
            h("Column", {}, [header, list_]);
            currentOwner = null;
        },
        setTitle: function (i, s) { records[i].title[1](s); },
        setDone: function (i, b) {
            var rec = records[i];
            if (rec.done[0]() === b) return;
            rec.done[1](b);
            setDoneCount(doneCount() + (b ? 1 : -1));
        },
        setVer: function (i, n) { records[i].ver[1](n); },
        setItems: function (list) { load(list); },
        flush: flush
    };
})();
