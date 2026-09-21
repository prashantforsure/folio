(function () {
  var READ = "var(--read)";
  function t(text) { return { text: text, ink: READ, italic: "normal", bg: "transparent", pad: "0" }; }
  function m(text) { return { text: text, ink: "var(--accent)", italic: "normal", bg: "var(--accent-bg)", pad: "1px 6px" }; }
  function q(text) { return { text: text, ink: "var(--ink)", italic: "italic", bg: "transparent", pad: "0" }; }

  function grad(h, l) {
    var a = (l || 0.36), b = a - 0.13, c = a - 0.22;
    return "linear-gradient(155deg,oklch(" + a.toFixed(2) + " .055 " + h + "),oklch(" + b.toFixed(2) + " .045 " + (h + 18) + ") 58%,oklch(" + c.toFixed(2) + " .03 " + (h + 36) + "))";
  }

  var CAST = {
    ade: { id: "ade", name: "Ade", ini: "AD", meta: "17 · lead", look: true, turn: true, hue: 300,
      app: "seventeen, wiry, close-cropped hair, a faded green training top two sizes too big, taped-up boots" },
    old: { id: "old", name: "Old man", ini: "OM", meta: "unnamed · bench", look: false, turn: false, hue: 40,
      app: "sixties, heavy coat, flat cap, hands that never leave his pockets" },
    nia: { id: "nia", name: "Nia", ini: "NI", meta: "16 · Ade's friend", look: true, turn: false, hue: 150,
      app: "sixteen, braided hair, school blazer pulled over a tracksuit, phone always in hand" }
  };

  // ── shots ───────────────────────────────────────────────────────────────
  var S1R1 = [
    { n: 1, cam: "Wide · Eye level · Static · ARRI Alexa Mini LF · 24mm T2.8", s: 4, tile: { st: "drawn", hue: 250, kept: true, take: [2, 3] },
      d: [t("The cage under the floodlights, rain just stopped. "), m("@Old man"), t(" on the bench at the touchline, a flat ball at his feet.")] },
    { n: 2, cam: "Medium · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0", s: 3, tile: { st: "drawn", hue: 265, kept: true, take: [1, 1] },
      d: [m("@Ade"), t(" at the gate, bag on one shoulder, looking at the ball and not the man.")] },
    { n: 3, cam: "Close-up · Low · Static · ARRI Alexa Mini LF · 50mm T2.0", s: 5, tile: { st: "drawn", hue: 40, kept: true, take: [2, 2] },
      d: [t("The old man taps the flat ball toward "), m("@Ade"), t("; it barely rolls.")] },
    { n: 4, cam: "Medium close-up · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0", s: 3, tile: { st: "drawn", hue: 150, kept: true, take: [1, 2] },
      d: [m("@Ade"), t(" stops it with the taped boot. Doesn't look up. "), q("\u201cIt's flat.\u201d")] }
  ];

  var S1R2 = [
    { n: 1, cam: "Wide · Eye level · Static · ARRI Alexa Mini LF · 24mm T2.8", s: 4, tile: { st: "drawn", hue: 250, kept: true, take: [1, 1] },
      d: [t("The two of them from behind the fence, the ball dead between them.")] },
    { n: 2, cam: "Medium · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0", s: 3, tile: { st: "ready" },
      d: [m("@Ade"), t(" picks the ball up, turns it over, finds the split in the seam.")] },
    { n: 3, cam: "Close-up · Eye level · Static · ARRI Alexa Mini LF · 50mm T2.0", s: 3, proposed: true, camMuted: true, tile: { st: "empty" },
      d: [t("The old man watches him find it, and says nothing.")] }
  ];

  var S3R1 = [
    { n: 1, cam: "Wide · High · Static · ARRI Alexa Mini LF · 24mm T2.8", s: 4, tile: { st: "drawn", hue: 250, kept: true, take: [1, 1] },
      d: [t("The cage at night, one floodlight dead. Rain on the chain fence.")] },
    { n: 2, cam: "Medium · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0", s: 4, tile: { st: "gen", pct: 62 },
      d: [m("@Ade"), t(" runs the length of the cage with the ball, faster than he needs to.")] },
    { n: 3, cam: "Close-up · Low · Static · ARRI Alexa Mini LF · 50mm T2.0", s: 4, tile: { st: "queued" },
      d: [m("@Nia"), t(" at the fence, fingers through the links, not calling out.")] },
    { n: 4, cam: "Medium · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0", s: 3, blocked: true, tile: { st: "blocked" },
      d: [m("@Ade"), t(" goes down on the wet concrete and comes up with his knee opened.")],
      blockText: "The model refused this shot: violence. Rewrite the shot or remove the blood." }
  ];

  var S5R1 = [
    { n: 1, cam: "Wide · Eye level · Static · ARRI Alexa Mini LF · 24mm T2.8", s: 5, tile: { st: "stale", hue: 75, kept: true, take: [1, 1] },
      d: [t("Daylight on the pitch. The puddles gone, the ball still flat on the spot.")] },
    { n: 2, cam: "Medium · Eye level · Static · ARRI Alexa Mini LF · 35mm T2.8", s: 5, tile: { st: "stale", hue: 60, kept: true, take: [2, 2] },
      d: [m("@Ade"), t(" pumps the ball at the fence, counting strokes under his breath.")] },
    { n: 3, cam: "Wide · Low · Static · ARRI Alexa Mini LF · 24mm T4.0", s: 5, tile: { st: "drawn", hue: 150, kept: true, take: [1, 1] },
      d: [t("He drops it, strikes it clean, and it finally flies.")] }
  ];

  var REELS = {
    s1r1: { id: "s1r1", scene: 1, name: "Reel 1", len: 15, cont: "natural", status: "rendered", finalized: true, shots: S1R1,
      clip: { st: "rendered", ver: [2, 2], poster: 250 } },
    s1r2: { id: "s1r2", scene: 1, name: "Reel 2", len: 10, cont: "match", status: "writing", shots: S1R2,
      clip: { st: "gate" }, extra: true, image: true },
    s3r1: { id: "s3r1", scene: 3, name: "Reel 1", len: 15, cont: "natural", status: "generating", shots: S3R1, clip: { st: "gate" } },
    s4r1: { id: "s4r1", scene: 4, name: "Reel 1", len: 15, cont: "natural", status: "writing", shots: [], clip: { st: "gate" } },
    s5r1: { id: "s5r1", scene: 5, name: "Reel 1", len: 15, cont: "natural", status: "stale", finalized: true, shots: S5R1,
      clip: { st: "stale", ver: [1, 1], poster: 75 } }
  };

  var SCENES = [
    { n: 1, heading: "EXT. COMMUNITY PITCH – DUSK", loc: "Community pitch", facts: "EXT · DUSK · rain just stopped",
      plate: true, still: { st: "drawn", hue: 250, take: [1, 2] }, range: "lines 1–18", reels: ["s1r1", "s1r2"], cast: ["ade", "old", "nia"],
      lines: [
        { k: "head", text: "EXT. COMMUNITY PITCH – DUSK" },
        { k: "action", text: "The cage under the floodlights. Rain just stopped. An OLD MAN sits on the bench at the touchline, a flat ball at his feet." },
        { k: "cue", who: "ade" }, { k: "dlg", text: "It's flat." },
        { k: "cue", who: "old" }, { k: "paren", text: "(not looking up)" },
        { k: "dlg", text: "Everything's flat round here." }
      ] },
    { n: 2, heading: "INT. ADE'S KITCHEN – NIGHT", loc: "Ade's kitchen", facts: "INT · NIGHT",
      plate: false, still: { st: "empty" }, range: "whole scene", reels: [], cast: ["ade"],
      lines: [
        { k: "head", text: "INT. ADE'S KITCHEN – NIGHT" },
        { k: "action", text: "A strip light over a small table. ADE eats standing up, boots still on, the bag by the door where he dropped it." },
        { k: "cue", who: "ade" }, { k: "dlg", text: "I'm not going back." }
      ] },
    { n: 3, heading: "EXT. COMMUNITY PITCH – NIGHT", loc: "Community pitch", facts: "EXT · NIGHT · rain",
      plate: true, still: { st: "empty" }, range: "lines 31–44", reels: ["s3r1"], cast: ["ade", "nia"],
      lines: [
        { k: "head", text: "EXT. COMMUNITY PITCH – NIGHT" },
        { k: "action", text: "One floodlight dead. ADE runs the cage alone. NIA watches from the fence, hood up, saying nothing." },
        { k: "cue", who: "nia" }, { k: "dlg", text: "You'll wreck that knee." }
      ] },
    { n: 4, heading: "INT. BUS SHELTER – DAWN", loc: "Bus shelter", facts: "INT · DAWN",
      plate: false, still: { st: "empty" }, range: "whole scene", reels: ["s4r1"], cast: ["ade"],
      lines: [
        { k: "head", text: "INT. BUS SHELTER – DAWN" },
        { k: "action", text: "First light. ADE asleep sitting up, the bag across his lap, the flat ball under the bench." }
      ] },
    { n: 5, heading: "EXT. COMMUNITY PITCH – DAY", loc: "Community pitch", facts: "EXT · DAY · dry",
      plate: true, still: { st: "drawn", hue: 75, take: [1, 1] }, range: "lines 1–14", reels: ["s5r1"], cast: ["ade", "nia"], stale: true,
      lines: [
        { k: "head", text: "EXT. COMMUNITY PITCH – DAY" },
        { k: "action", text: "Daylight. The cage empty, the puddles gone. ADE arrives with a pump in his hand and nothing to prove to anyone." },
        { k: "cue", who: "ade" }, { k: "dlg", text: "Right." }
      ] }
  ];

  var FRAMES = {
    F01: { name: "Production · Scene · authoring", scene: 1, reel: "s1r2" },
    F02: { name: "Production · Scene · rendered", scene: 1, reel: "s1r1" },
    F03: { name: "Production · Scene · generating + refused", scene: 3, reel: "s3r1" },
    F04: { name: "Production · Scene · stale", scene: 5, reel: "s5r1" },
    F05: { name: "Production · Scene · needs credits", scene: 1, reel: "s1r1", needsCredits: true },
    F06: { name: "Production · Scene · no film settings", scene: 1, reel: "s1r2", noSettings: true, overlay: "settings" },
    F07: { name: "Production · Scene · empty scene", scene: 2, reel: null },
    F08: { name: "Production · Scene · no script", noScript: true },
    F09: { name: "Production · Episode", view: "episode" },
    F10: { name: "Film settings dialog", scene: 1, reel: "s1r2", dialog: "settings" },
    F11: { name: "File view drawer", scene: 1, reel: "s1r1", drawer: "file" },
    F12: { name: "Tasks drawer", scene: 3, reel: "s3r1", drawer: "tasks" },
    F13: { name: "Compare", scene: 1, reel: "s1r1", compare: true },
    F14: { name: "Characters drawer · Look", route: "characters", drawer: "look" },
    F15: { name: "Locations drawer · Plate", route: "locations", drawer: "plate" },
    F16: { name: "Play episode modal", view: "episode", dialog: "play" },
    F17: { name: "Light theme", scene: 1, reel: "s1r2", theme: "light" },
    F18: { name: "Narrow + assistant", scene: 1, reel: "s1r1", width: 1100, assistant: true },
    F19: { name: "Auto-assign confirm", scene: 1, reel: "s1r2", dialog: "autoassign" },
    F20: { name: "Canvas states sheet", sheet: true }
  };

  var SEG = ["var(--seg-1)", "var(--seg-2)", "var(--seg-3)", "var(--seg-4)"];

  // frame-tile presentation for a state
  function tile(st, o) {
    o = o || {};
    var base = {
      bg: "linear-gradient(160deg,var(--frame-a),var(--frame-b))", border: "var(--line2)",
      glyph: "", glyphInk: "var(--frame-ink)", label: "", labelInk: "var(--frame-ink)",
      img: "", imgOpacity: "1", gridLines: true, shimmer: false, prog: false, pct: "0%",
      kept: false, stale: false, badge: "", stop: false
    };
    var map = {
      empty: { label: "Describe the shot" },
      ready: { label: "Ready to draw" },
      queued: { glyph: "◌", label: "Queued" },
      gen: { glyph: "", label: "Generating", shimmer: true, prog: true, pct: (o.pct || 0) + " %", stop: true },
      waiting: { label: "Waiting for shot 2's frame", labelInk: "var(--ink3)" },
      drawn: { img: grad(o.hue || 250), gridLines: false, kept: !!o.kept },
      uploaded: { img: grad(o.hue || 250), gridLines: false, kept: !!o.kept, badge: "↑" },
      stale: { img: grad(o.hue || 250), gridLines: false, imgOpacity: ".7", stale: true, kept: !!o.kept },
      blocked: { bg: "var(--bad-bg)", border: "var(--bad)", glyph: "⛔", glyphInk: "var(--bad)", label: "Can't draw — rewrite shot 4", labelInk: "var(--bad)", gridLines: false },
      failed: { label: "Failed · refunded", labelInk: "var(--live)" },
      cancelled: { label: "Cancelled", labelInk: "var(--ink3)" }
    };
    var r = Object.assign({}, base, map[st] || {});
    r.st = st;
    r.pctNum = (o.pct || 0) + "%";
    return r;
  }

  window.FOLIO = { t: t, m: m, q: q, grad: grad, CAST: CAST, REELS: REELS, SCENES: SCENES, FRAMES: FRAMES, SEG: SEG, tile: tile };
})();
