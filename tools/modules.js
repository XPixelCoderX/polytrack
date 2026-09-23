/*
 * N2AB Client - additional modules.
 *
 * This file is injected into the client bundle by tools/build-n2ab-client.js,
 * immediately after the built-in modules register. `__api` is the client's
 * feature registry.
 *
 * Registry contract (mirrors the built-in modules):
 *   __api.registerFeature(name, {
 *     label, description, category,   // category: Movement | HUD | Network | Render
 *     toggleable, mode,               // mode: "toggle" | "hold" | "momentary"
 *     transient,                      // true = never persisted to storage
 *     settings: { key: { type, label, default, min, max, step, maxLength } },
 *                                     // type: "range" | "bool" | "text"
 *     onState(state), onToggle(active, state),
 *   })
 *
 * State for a module is `state[name]`, always with an `active` flag plus one
 * entry per declared setting.
 *
 * Everything here is client-side and presentational: overlays, readouts and
 * panel conveniences. Nothing touches physics, the leaderboard or netcode.
 */

var g = typeof window !== "undefined" ? window : self;

/* ------------------------------------------------------------------ utils */

function n2abOverlay(id, css) {
  var el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;" +
      'font-family:var(--n2ab-mono,ui-monospace,"JetBrains Mono",monospace);' +
      "font-size:12px;font-weight:600;letter-spacing:.04em;line-height:1.5;" +
      "color:#edeef2;background:rgba(16,16,20,.92);border:1px solid rgba(255,255,255,.09);" +
      "border-radius:12px;padding:9px 12px;white-space:pre;" +
      "box-shadow:0 18px 44px -14px rgba(0,0,0,.75);" + (css || "");
    document.body.appendChild(el);
  }
  return el;
}

function n2abRemove(id) {
  var el = document.getElementById(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function n2abLoop(name, fn) {
  var key = "__n2abRaf_" + name;
  if (g[key]) return;
  var tick = function () {
    if (!g[key]) return;
    try { fn(); } catch (e) { /* keep the loop alive */ }
    g[key] = requestAnimationFrame(tick);
  };
  g[key] = requestAnimationFrame(tick);
}

function n2abStop(name) {
  var key = "__n2abRaf_" + name;
  if (g[key]) { cancelAnimationFrame(g[key]); g[key] = 0; }
}

function n2abSpeed() {
  try {
    var s = g.__n2abSnap && g.__n2abSnap.linVel;
    if (!s) return 0;
    return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  } catch (e) { return 0; }
}

/* ------------------------------------------------- 1. performance overlay */

var n2abPerf = { frames: 0, last: 0, fps: 0, min: 0, p1: [], ms: 0 };

__api.registerFeature("perfOverlay", {
  label: "Performance",
  description: "FPS, frame time and 1% lows in a compact corner readout.",
  category: "Render",
  settings: {
    showFrameTime: { type: "bool", label: "Show frame time", default: true },
    showLows: { type: "bool", label: "Show 1% lows", default: true },
    corner: { type: "range", label: "Corner (1-4)", min: 1, max: 4, step: 1, default: 1 },
  },
  onState: function (state) {
    var s = state.perfOverlay || {};
    if (!s.active) { n2abStop("perf"); n2abRemove("n2ab-perf"); return; }

    var spots = {
      1: "top:14px;left:14px;",
      2: "top:14px;right:14px;",
      3: "bottom:14px;left:14px;",
      4: "bottom:14px;right:14px;",
    };
    var el = n2abOverlay("n2ab-perf", spots[s.corner] || spots[1]);
    el.style.top = el.style.bottom = el.style.left = el.style.right = "";
    var pos = (spots[s.corner] || spots[1]).split(";");
    for (var i = 0; i < pos.length; i++) {
      var kv = pos[i].split(":");
      if (kv.length === 2) el.style[kv[0]] = kv[1];
    }

    n2abLoop("perf", function () {
      var now = performance.now();
      if (!n2abPerf.last) n2abPerf.last = now;
      var dt = now - n2abPerf.last;
      n2abPerf.last = now;
      n2abPerf.ms = n2abPerf.ms * 0.9 + dt * 0.1;
      n2abPerf.p1.push(dt);
      if (n2abPerf.p1.length > 600) n2abPerf.p1.shift();

      var fps = 1000 / Math.max(n2abPerf.ms, 0.0001);
      var out = "FPS  " + fps.toFixed(0).padStart(3, " ");
      if (s.showFrameTime) out += "\nms   " + n2abPerf.ms.toFixed(1).padStart(5, " ");
      if (s.showLows && n2abPerf.p1.length > 30) {
        var sorted = n2abPerf.p1.slice().sort(function (a, b) { return b - a; });
        var low = 1000 / sorted[Math.floor(sorted.length * 0.01)];
        out += "\n1%   " + low.toFixed(0).padStart(5, " ");
      }
      el.textContent = out;
    });
  },
});

/* ------------------------------------------------------- 2. speed history */

__api.registerFeature("speedGraph", {
  label: "Speed Graph",
  description: "Rolling speed trace so you can see where you bleed momentum.",
  category: "HUD",
  settings: {
    seconds: { type: "range", label: "Window (s)", min: 3, max: 30, step: 1, default: 10 },
    height: { type: "range", label: "Height (px)", min: 40, max: 160, step: 10, default: 70 },
  },
  onState: function (state) {
    var s = state.speedGraph || {};
    if (!s.active) { n2abStop("graph"); n2abRemove("n2ab-graph"); return; }

    var host = n2abOverlay("n2ab-graph", "bottom:14px;left:50%;transform:translateX(-50%);padding:8px;");
    var cv = host.querySelector("canvas");
    if (!cv) { cv = document.createElement("canvas"); host.appendChild(cv); }
    var w = 320, h = Number(s.height) || 70;
    cv.width = w * 2; cv.height = h * 2;
    cv.style.cssText = "width:" + w + "px;height:" + h + "px;display:block";

    var pts = [];
    n2abLoop("graph", function () {
      var kmh = n2abSpeed() * 3.6;
      pts.push(kmh);
      var cap = Math.max(60, (Number(s.seconds) || 10) * 60);
      while (pts.length > cap) pts.shift();

      var ctx = cv.getContext("2d");
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, w, h);

      var max = 1;
      for (var i = 0; i < pts.length; i++) if (pts[i] > max) max = pts[i];
      max = Math.ceil(max / 25) * 25;

      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 1;
      for (var q = 1; q < 4; q++) {
        var y = (h / 4) * q;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      ctx.strokeStyle = "#ff3a3a";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (var j = 0; j < pts.length; j++) {
        var x = (j / Math.max(pts.length - 1, 1)) * w;
        var yy = h - (pts[j] / max) * (h - 4) - 2;
        if (j === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();

      ctx.fillStyle = "#9a9aa6";
      ctx.font = '600 10px var(--n2ab-mono,ui-monospace,monospace)';
      ctx.fillText(max.toFixed(0) + " km/h", 4, 11);
      ctx.fillStyle = "#edeef2";
      ctx.fillText(kmh.toFixed(1), 4, h - 4);
    });
  },
});

/* ---------------------------------------------------------- 3. run splits */

__api.registerFeature("splits", {
  label: "Checkpoint Splits",
  description: "Logs checkpoint times and the delta against your best run.",
  category: "HUD",
  settings: {
    keep: { type: "range", label: "Rows shown", min: 3, max: 12, step: 1, default: 6 },
  },
  onState: function (state) {
    var s = state.splits || {};
    if (!s.active) { n2abStop("splits"); n2abRemove("n2ab-splits"); return; }

    var el = n2abOverlay("n2ab-splits", "top:50%;right:14px;transform:translateY(-50%);");
    if (!g.__n2abSplitBest) g.__n2abSplitBest = [];
    var seen = [], t0 = 0;

    n2abLoop("splits", function () {
      var cps = g.__n2abCheckpoints || [];
      var now = performance.now();
      if (!t0) t0 = now;

      // reset when the run restarts (checkpoint set rebuilt)
      if (cps.length && seen.length > cps.length) { seen = []; t0 = now; }

      var lines = ["SPLITS"];
      var keep = Number(s.keep) || 6;
      var from = Math.max(0, seen.length - keep);
      for (var i = from; i < seen.length; i++) {
        var t = seen[i];
        var best = g.__n2abSplitBest[i];
        var d = best == null ? null : t - best;
        var tag = d == null ? "  --  " : (d <= 0 ? "-" : "+") + Math.abs(d).toFixed(2);
        lines.push(String(i + 1).padStart(2, " ") + "  " + t.toFixed(2).padStart(7, " ") + "  " + tag);
      }
      if (seen.length === 0) lines.push("waiting for run...");
      el.textContent = lines.join("\n");
    });
  },
});

/* ------------------------------------------------------- 4. input display */

__api.registerFeature("inputDisplay", {
  label: "Input Display",
  description: "Live WASD / arrow key overlay for recording and review.",
  category: "HUD",
  settings: {
    scale: { type: "range", label: "Scale (%)", min: 60, max: 200, step: 10, default: 100 },
  },
  onState: function (state) {
    var s = state.inputDisplay || {};
    if (!s.active) { n2abStop("keys"); n2abRemove("n2ab-keys"); return; }

    var el = n2abOverlay("n2ab-keys", "bottom:14px;right:14px;padding:10px;");
    var k = (Number(s.scale) || 100) / 100;
    var box = Math.round(30 * k);

    var cells = [["", "up", ""], ["left", "down", "right"]];
    var codes = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" };
    el.innerHTML = "";
    var grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-columns:repeat(3," + box + "px);gap:" + Math.round(4 * k) + "px";
    var refs = {};
    cells.forEach(function (row) {
      row.forEach(function (name) {
        var c = document.createElement("div");
        c.style.cssText =
          "height:" + box + "px;border-radius:" + Math.round(7 * k) + "px;" +
          "background:" + (name ? "rgba(255,255,255,.07)" : "transparent") + ";" +
          (name ? "border:1px solid rgba(255,255,255,.1);" : "") +
          "transition:background 90ms linear,border-color 90ms linear";
        grid.appendChild(c);
        if (name) refs[name] = c;
      });
    });
    el.appendChild(grid);

    n2abLoop("keys", function () {
      var keys = g.__n2abKeys || {};
      Object.keys(refs).forEach(function (name) {
        var down =
          keys[codes[name]] ||
          keys["Arrow" + name.charAt(0).toUpperCase() + name.slice(1)];
        refs[name].style.background = down ? "rgba(255,58,58,.85)" : "rgba(255,255,255,.07)";
        refs[name].style.borderColor = down ? "rgba(255,58,58,.9)" : "rgba(255,255,255,.1)";
      });
    });
  },
});

/* ------------------------------------------------------------ 5. cinematic */

__api.registerFeature("cleanScreen", {
  label: "Clean Screen",
  description: "Hides the game HUD for screenshots and video. Hold to preview.",
  category: "Render",
  mode: "toggle",
  settings: {
    keepTimer: { type: "bool", label: "Keep timer visible", default: false },
  },
  onState: function (state) {
    var s = state.cleanScreen || {};
    var id = "n2ab-clean-style";
    var st = document.getElementById(id);
    if (!s.active) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement("style"); st.id = id; document.head.appendChild(st); }
    var hide = [
      ".speedometer-ui", ".checkpoint-ui", ".game-toolbar-ui",
      ".hint-ui", ".input-visualizer-ui", ".player-list-ui",
    ];
    if (!s.keepTimer) hide.push(".timer-ui");
    st.textContent = "#ui " + hide.join(",#ui ") + "{opacity:0!important;transition:opacity .2s}";
  },
});

/* ------------------------------------------------------- 6. session stats */

__api.registerFeature("sessionStats", {
  label: "Session Stats",
  description: "Top speed, average speed and distance for the current session.",
  category: "HUD",
  settings: {
    resetOnRun: { type: "bool", label: "Reset each run", default: false },
  },
  onState: function (state) {
    var s = state.sessionStats || {};
    if (!s.active) { n2abStop("stats"); n2abRemove("n2ab-stats"); return; }

    var el = n2abOverlay("n2ab-stats", "top:14px;left:50%;transform:translateX(-50%);");
    var top = 0, sum = 0, n = 0, dist = 0, last = performance.now();

    n2abLoop("stats", function () {
      var now = performance.now();
      var dt = (now - last) / 1000;
      last = now;

      var v = n2abSpeed();
      var kmh = v * 3.6;
      if (kmh > top) top = kmh;
      sum += kmh; n++;
      dist += v * dt;

      if (s.resetOnRun && kmh < 0.5 && n > 120) { top = 0; sum = 0; n = 1; dist = 0; }

      el.textContent =
        "TOP  " + top.toFixed(1).padStart(6, " ") + " km/h\n" +
        "AVG  " + (sum / Math.max(n, 1)).toFixed(1).padStart(6, " ") + " km/h\n" +
        "DIST " + dist.toFixed(0).padStart(6, " ") + " m";
    });
  },
});

/* --------------------------------------------------------- 7. panel theme */

__api.registerFeature("theme", {
  label: "Panel Theme",
  description: "Recolours the client panel and overlays. Applies instantly.",
  category: "Render",
  toggleable: true,
  settings: {
    hue: { type: "range", label: "Accent hue", min: 0, max: 360, step: 5, default: 0 },
    dim: { type: "range", label: "Surface darkness", min: 0, max: 100, step: 5, default: 0 },
  },
  onState: function (state) {
    var s = state.theme || {};
    var id = "n2ab-theme-style";
    var st = document.getElementById(id);
    if (!s.active) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement("style"); st.id = id; document.head.appendChild(st); }

    var hue = Number(s.hue) || 0;
    var dim = (Number(s.dim) || 0) / 100;
    var l = Math.round(60 - dim * 12);
    st.textContent =
      ":root{" +
      "--n2ab-red:hsl(" + hue + ",100%," + l + "%);" +
      "--n2ab-red-hi:hsl(" + hue + ",100%," + (l + 4) + "%);" +
      "--n2ab-red-deep:hsl(" + hue + ",78%," + Math.round(l - 22) + "%);" +
      "--n2ab-red-glow:hsla(" + hue + ",100%," + l + "%,.45);" +
      "}";
  },
});
