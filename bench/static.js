// Model B: compile-time static dependencies (Svelte 3/4 style), hand-written as
// the code a compiler would emit: ctx slots + dirty bits + one p() per component.
// __COARSE = true switches to whole-list invalidation (any item change dirties
// the page's `items`, every row re-checks its bindings), which is what Svelte 4
// does for `items[i].x = v`.
var COARSE = (typeof __COARSE !== "undefined") && __COARSE;
var MODEL = COARSE ? "static-coarse" : "static-fine";

var scheduled = [];
var patches = [];
var nextId = 1;
var handlers = {};

function invalidate(comp, bit) {
    if (!comp.dirty) scheduled.push(comp);
    comp.dirty |= bit;
}

function flush() {
    for (var i = 0; i < scheduled.length; i++) {
        var c = scheduled[i];
        c.p();
        c.dirty = 0;
    }
    scheduled = [];
    if (patches.length) {
        __host.apply(JSON.stringify(patches), patches.length);
        patches = [];
    }
}

// Row component. ctx = [item]; bindings: text<-item.title, color<-item.done, text<-item.ver
var R_TITLE = 1, R_DONE = 2, R_VER = 4, R_ALL = 7;

function createRow(item) {
    var ctx = [item];
    var t1 = nextId++;
    patches.push(["c", t1, "Text"]);
    var lastTitle = ctx[0].title;
    patches.push(["p", t1, "text", lastTitle]);
    var lastColor = ctx[0].done ? "#999" : "#000";
    patches.push(["p", t1, "color", lastColor]);
    var t2 = nextId++;
    patches.push(["c", t2, "Text"]);
    var lastVer = "#" + ctx[0].ver;
    patches.push(["p", t2, "text", lastVer]);
    var row = nextId++;
    patches.push(["c", row, "Row"]);
    handlers[row + ":onClick"] = function () {};
    patches.push(["p", row, "onClick", true]);
    patches.push(["i", row, t1, 0]);
    patches.push(["i", row, t2, 1]);

    var comp = {
        id: row,
        dirty: 0,
        p: function () {
            var d = comp.dirty, v;
            if (d & R_TITLE) { v = ctx[0].title; if (v !== lastTitle) { lastTitle = v; patches.push(["p", t1, "text", v]); } }
            if (d & R_DONE) { v = ctx[0].done ? "#999" : "#000"; if (v !== lastColor) { lastColor = v; patches.push(["p", t1, "color", v]); } }
            if (d & R_VER) { v = "#" + ctx[0].ver; if (v !== lastVer) { lastVer = v; patches.push(["p", t2, "text", v]); } }
        },
        set: function (field, bit, v) {
            if (ctx[0][field] === v) return;
            ctx[0][field] = v;
            invalidate(comp, bit);
        }
    };
    return comp;
}

// Page component. ctx = [items, doneCount]; header text <- doneCount, items.length
var P_ITEMS = 1, P_DONE = 2;

function createPage(items, doneCount) {
    var ctx = [items, doneCount];
    var rows = {}, keys = [];

    var header = nextId++;
    patches.push(["c", header, "Text"]);
    var lastHeader = "done " + ctx[1] + "/" + ctx[0].length;
    patches.push(["p", header, "text", lastHeader]);
    var list = nextId++;
    patches.push(["c", list, "List"]);

    function reconcile() {
        var newKeys = [], byKey = {};
        for (var i = 0; i < ctx[0].length; i++) {
            var k = ctx[0][i].key;
            newKeys.push(k);
            byKey[k] = ctx[0][i];
        }
        keys = reconcileKeys(keys, newKeys, {
            remove: function (k) {
                delete handlers[rows[k].id + ":onClick"];
                patches.push(["r", rows[k].id]);
                delete rows[k];
            },
            move: function (k, idx) { patches.push(["m", list, rows[k].id, idx]); },
            create: function (k, idx) {
                var r = createRow(byKey[k]);
                rows[k] = r;
                patches.push(["i", list, r.id, idx]);
            }
        });
    }
    reconcile();

    var column = nextId++;
    patches.push(["c", column, "Column"]);
    patches.push(["i", column, header, 0]);
    patches.push(["i", column, list, 1]);

    var comp = {
        dirty: 0,
        p: function () {
            var d = comp.dirty;
            if (d & (P_ITEMS | P_DONE)) {
                var v = "done " + ctx[1] + "/" + ctx[0].length;
                if (v !== lastHeader) { lastHeader = v; patches.push(["p", header, "text", v]); }
            }
            if (d & P_ITEMS) {
                reconcile();
                if (COARSE) {
                    for (var i = 0; i < keys.length; i++) {
                        var r = rows[keys[i]];
                        r.dirty = R_ALL;
                        r.p();
                        r.dirty = 0;
                    }
                }
            }
        },
        rowOf: function (key) { return rows[key]; },
        setDoneCount: function (n) {
            if (ctx[1] === n) return;
            ctx[1] = n;
            invalidate(comp, P_DONE);
        },
        setItems: function (list_, n) {
            ctx[0] = list_;
            if (ctx[1] !== n) ctx[1] = n;
            invalidate(comp, P_ITEMS | P_DONE);
        },
        touchItems: function () { invalidate(comp, P_ITEMS); }
    };
    return comp;
}

// ---- the app under test ----

var app = (function () {
    var page = null, data = [], doneCount = 0;

    function copyItems(list) {
        var out = [], n = 0;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            out.push({ key: it.key, title: it.title, done: it.done, ver: it.ver });
            if (it.done) n++;
        }
        return { items: out, done: n };
    }

    function setField(i, field, bit, v) {
        var it = data[i];
        if (it[field] === v) return false;
        if (COARSE) {
            it[field] = v;
            page.touchItems();
        } else {
            page.rowOf(it.key).set(field, bit, v);
        }
        return true;
    }

    return {
        mount: function (list) {
            var c = copyItems(list);
            data = c.items;
            doneCount = c.done;
            page = createPage(data, doneCount);
        },
        setTitle: function (i, s) { setField(i, "title", R_TITLE, s); },
        setDone: function (i, b) {
            if (setField(i, "done", R_DONE, b)) {
                doneCount += b ? 1 : -1;
                page.setDoneCount(doneCount);
            }
        },
        setVer: function (i, n) { setField(i, "ver", R_VER, n); },
        setItems: function (list) {
            var c = copyItems(list);
            data = c.items;
            doneCount = c.done;
            page.setItems(data, doneCount);
        },
        flush: flush
    };
})();
