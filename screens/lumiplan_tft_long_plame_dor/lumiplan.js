// The Lumiplan TFT (long, Palme d'Or) of lumiplan.html. Its map, routes and look come from
// ekrang's generated files, loaded by the page before this one:
//   ../../maps/maps.js        EKRANG_HOFS, EKRANG_MAPS (and EKRANG_STYLES, empty)
//   src/<map>/style.js        this screen's style of each map, added to EKRANG_STYLES
// The map shown is the one made for the bus's depot file (omsi.vehicle.info.yard).
window.omsi = window.omsi || {};

// The paths of the generated files are from the ekrang folder: this page is two folders down.
var ROOT = "../../";

// The map window (the middle of the 2400 x 720 screen) and the screen's turn: the map, then
// the next stops, then an information picture over the whole screen (when the style shows them).
var VIEW_W = 2400;
var VIEW_H = 472;
var MAP_SECONDS = 15;
var STOPS_SECONDS = 15;
var AD_SECONDS = 5;
// Stops listed after the next one.
var LIST_COUNT = 5;
// The line badges' height: in the next stops, and on the stop page.
var BADGE_LIST_H = 40;
var BADGE_STATION_H = 72;

// The page has no overflow clipping, so long names are cut by hand.
var shown = {};

function cut(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function setText(id, text) {
    if (shown[id] !== text) {
        document.getElementById(id).textContent = text;
        shown[id] = text;
    }
}

function norm(s) {
    return String(s || "")
        .trim()
        .toLowerCase();
}

// Sorted list of the distinct numbers in a (the engine's arrays have no sort).
function uniqueSorted(a) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
        var k = 0;
        while (k < out.length && out[k] < a[i]) k++;
        if (k < out.length && out[k] === a[i]) continue;
        out.push(0);
        for (var m = out.length - 1; m > k; m--) out[m] = out[m - 1];
        out[k] = a[i];
    }
    return out;
}

// Lines in order: by number first ("2" before "14"), then the others by name.
function lineBefore(a, b) {
    var na = parseInt(a, 10);
    var nb = parseInt(b, 10);
    var da = !isNaN(na);
    var db = !isNaN(nb);
    if (da !== db) return da;
    if (da && na !== nb) return na < nb;
    return a.toLowerCase() < b.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// The map of the bus's depot
// ---------------------------------------------------------------------------------------------

var MAP = null; // EKRANG_MAPS entry, or null: no GPS
var STYLE = null; // this screen's EKRANG_STYLES entry for MAP
var yardShown = null;
// What MAP and STYLE give, worked out once per map:
var tileSet = {}; // "<col>_<row>" of the tiles there are
var tripStopIndex = []; // per trip: stop name -> where it comes first
var CORR = {}; // stop name -> the lines stopping there, in order
var ADS = []; // the information pictures shown in turn
var BADGES = {}; // line in lower case -> its badge file (STYLE.LINES)

function selectMap(yard) {
    var key = norm(yard);
    if (key === yardShown) return;
    yardShown = key;
    MAP = null;
    STYLE = null;
    var id = null;
    for (var i = 0; i < EKRANG_HOFS.length; i++) {
        if (norm(EKRANG_HOFS[i][0]) === key) {
            id = EKRANG_HOFS[i][1];
            break;
        }
    }
    for (var m = 0; id !== null && m < EKRANG_MAPS.length; m++) {
        if (EKRANG_MAPS[m].id === id) MAP = EKRANG_MAPS[m];
    }
    for (var s = 0; MAP && s < EKRANG_STYLES.length; s++) {
        if (EKRANG_STYLES[s].map === id) STYLE = EKRANG_STYLES[s];
    }
    // (a map without a style of this screen: its src/<map>/style.js is not in the page)
    if (!STYLE) MAP = null;

    tileSet = {};
    tripStopIndex = [];
    CORR = {};
    ADS = [];
    BADGES = {};
    prepared = 0;
    if (MAP) {
        for (var t = 0; t < STYLE.TILES.length; t++) tileSet[STYLE.TILES[t]] = true;
        var lines = STYLE.LINES || [];
        for (var b = 0; b < lines.length; b++) BADGES[lines[b][0]] = lines[b][1];
        if (STYLE.showInformations) ADS = STYLE.informations;
    }
    routeId = -1;
    tileLegs = {};
    lastMatchKey = null;
    shown.map = "";
    shown.stops = null;
    shown.stationIcons = null;
}

// The trips' stops and lines (tripStopIndex, CORR), PREPARE_TRIPS trips an update: a script
// may only run so long (the engine stops it after 400 000 steps), and a map has hundreds of
// trips. True once every trip is done.
var PREPARE_TRIPS = 20;
var prepared = 0;

function prepare() {
    if (!MAP) return false;
    var end = Math.min(MAP.TRIPS.length, prepared + PREPARE_TRIPS);
    for (var k = prepared; k < end; k++) {
        var at = {};
        var line = String(MAP.TRIPS[k][1] || "").trim();
        var list = MAP.TRIPS[k][3];
        for (var u = 0; u < list.length; u++) {
            var name = norm(list[u]);
            if (at[name] === undefined) at[name] = u;
            if (line) addLine(name, line);
        }
        tripStopIndex.push(at);
    }
    if (end > prepared && end === MAP.TRIPS.length) {
        // (done: what was shown without the lines and routes is shown again)
        shown.stops = null;
        shown.stationIcons = null;
        lastMatchKey = null;
    }
    prepared = end;
    return prepared === MAP.TRIPS.length;
}

// Adds a line to a stop's, keeping them in order.
function addLine(stop, line) {
    if (!CORR[stop]) CORR[stop] = [];
    var lines = CORR[stop];
    var k = 0;
    while (k < lines.length && lineBefore(lines[k], line)) k++;
    if (k < lines.length && lines[k] === line) return;
    lines.push("");
    for (var m = lines.length - 1; m > k; m--) lines[m] = lines[m - 1];
    lines[k] = line;
}

// ---------------------------------------------------------------------------------------------
// The stop page: the whole screen gives the stop's name when the bus is at it (standing, a
// door open)
// ---------------------------------------------------------------------------------------------

var AT_STOP_KMH = 2;
var atStop = false;

// The stop page fades: the engine has no opacity or transitions, so its texts are coloured
// step by step from the page's blue to their own colour (and back before the page goes),
// FADE_STEP_MS apart.
var FADE_MS = 500;
var FADE_STEP_MS = 40;
// (the page comes out of black and goes back into it: the engine cannot blend it with the
// screen before)
var STATION_FROM = [0, 0, 0];
var STATION_BG = [11, 61, 110];
// Pictures cannot fade: the line badges show once the fade is this far.
var ICONS_FROM = 0.7;
var STATION_NAME = [255, 255, 255];
var STATION_LABEL = [255, 176, 32];
var fade = 0;
var fadeTimer = null;

function mix(a, b, t) {
    return (
        "rgb(" +
        Math.round(a[0] + (b[0] - a[0]) * t) + "," +
        Math.round(a[1] + (b[1] - a[1]) * t) + "," +
        Math.round(a[2] + (b[2] - a[2]) * t) + ")"
    );
}

function paintFade() {
    // (eased: quick at first, gentle at the end)
    var t = 1 - (1 - fade) * (1 - fade);
    document.getElementById("station").style.backgroundColor = mix(STATION_FROM, STATION_BG, t);
    document.getElementById("stationName").style.color = mix(STATION_FROM, STATION_NAME, t);
    document.getElementById("stationLabel").style.color = mix(STATION_FROM, STATION_LABEL, t);
    document.getElementById("stationIcons").style.visibility = t >= ICONS_FROM ? "visible" : "hidden";
}

function fadeStep() {
    var d = FADE_STEP_MS / FADE_MS;
    fade = atStop ? Math.min(1, fade + d) : Math.max(0, fade - d);
    paintFade();
    if (fade > 0 && fade < 1) return;
    clearInterval(fadeTimer);
    fadeTimer = null;
    if (fade === 0) {
        document.getElementById("station").style.display = "none";
        document.getElementById("main").style.display = "block";
        // (the map is drawn again when it shows)
        shown.map = "";
    }
}

function setAtStop(on, name, line) {
    if (on) {
        setText("stationName", cut(name, 30));
        var icons = lineIcons(name, line, BADGE_STATION_H, "stationIcon");
        if (shown.stationIcons !== icons) {
            document.getElementById("stationIcons").innerHTML = icons;
            shown.stationIcons = icons;
        }
    }
    if (on === atStop) return;
    atStop = on;
    if (on && fade === 0) {
        paintFade();
        document.getElementById("station").style.display = "block";
        document.getElementById("main").style.display = "none";
    }
    // (a fade under way just turns round)
    if (fadeTimer === null) fadeTimer = setInterval(fadeStep, FADE_STEP_MS);
}

// ---------------------------------------------------------------------------------------------
// The middle of the screen's turn
// ---------------------------------------------------------------------------------------------

var seconds = 0;
var mode = "";
var lastAd = -1;
var seed = 0;

// A number from 0 to n - 1 (the engine has no Math.random): Park-Miller, whose products stay
// below 2^53, so the numbers are exact.
function random(n) {
    if (seed <= 0) seed = (Math.floor(omsi.timestamp || 0) % 2147483646) + 1;
    seed = (seed * 16807) % 2147483647;
    return seed % n;
}

function pickAd() {
    if (ADS.length === 0) return;
    var k = random(ADS.length);
    if (k === lastAd) k = (k + 1) % ADS.length;
    lastAd = k;
    document.getElementById("adImg").setAttribute("src", ROOT + STYLE.informationsDir + ADS[k]);
}

function setMode(m) {
    if (m === mode) return;
    mode = m;
    document.getElementById("map").style.display = m === "map" ? "block" : "none";
    document.getElementById("stops").style.display = m === "stops" ? "block" : "none";
    document.getElementById("ad").style.display = m === "ad" ? "block" : "none";
    // (the information pictures are the screen's size: the bars go meanwhile)
    document.getElementById("top").style.display = m === "ad" ? "none" : "block";
    document.getElementById("bottom").style.display = m === "ad" ? "none" : "block";
    if (m === "map") shown.map = "";
    if (m === "stops") shown.stops = null;
    if (m === "ad") pickAd();
}

// The turn leaves out the map without a map, and the pictures without pictures.
function modeAt(s) {
    var mapS = MAP ? MAP_SECONDS : 0;
    var adS = ADS.length > 0 ? AD_SECONDS : 0;
    var t = s % (mapS + STOPS_SECONDS + adS);
    if (t < mapS) return "map";
    if (t < mapS + STOPS_SECONDS) return "stops";
    return "ad";
}

// ---------------------------------------------------------------------------------------------
// The next stops
// ---------------------------------------------------------------------------------------------

// The badges of the other lines stopping at a stop, as <img> tags (maps/<map>/src/assets/lines,
// any picture type: the style lists the files), h px high (their width follows: badges are not
// all the same shape). A line without a badge is left out.
function lineIcons(stop, ownLine, h, cls) {
    if (!MAP) return "";
    var lines = CORR[norm(stop)] || [];
    var dir = ROOT + STYLE.linesDir;
    var html = "";
    for (var i = 0; i < lines.length; i++) {
        if (norm(lines[i]) === norm(ownLine)) continue;
        var file = BADGES[norm(lines[i])];
        if (file) html += '<img class="' + cls + '" src="' + dir + file + '" height="' + h + '">';
    }
    return html;
}

function drawStops(route, line) {
    var stops = route.stops || [];
    var names = [];
    var icons = [];
    if (route.nextIndex !== null && stops.length > 0) {
        for (var i = route.nextIndex + 1; i < stops.length && names.length < LIST_COUNT; i++) {
            names.push(cut(stops[i].name, 60));
            icons.push(lineIcons(stops[i].name, line, BADGE_LIST_H, "lineIcon"));
        }
    }
    var key = names.join("|") + "#" + line + "#" + (MAP ? MAP.id : "");
    if (shown.stops === key) return;
    shown.stops = key;
    var html = "";
    if (names.length === 0) {
        html = "<div class=\"empty\">Pas d'arrêt suivant</div>";
    } else {
        for (var k = 0; k < names.length; k++) {
            html += '<div class="stop"><span class="dot"></span><span class="name">' + names[k] + "</span>" + icons[k] + "</div>";
        }
    }
    document.getElementById("stops").innerHTML = html;
}

// ---------------------------------------------------------------------------------------------
// The route on the map
// ---------------------------------------------------------------------------------------------

// The route of the trip the bus is on, from the timetable or typed into the IBIS: the trip
// that has the most of the bus's stops in the same order (a stop of another name, or missing
// on the map, does not spoil it), the same line counting in its favour. At least two stops
// and half of them must agree. -1: none.
var lastMatchKey = null;
var lastMatch = -1;

function findRoute(route, line) {
    if (!MAP) return -1;
    var names = (route.stops || []).map(function (s) {
        return norm(s.name);
    });
    line = norm(line);
    var matchKey = line + "#" + names.join("|");
    if (matchKey === lastMatchKey) return lastMatch;
    lastMatchKey = matchKey;
    lastMatch = -1;
    if (names.length < 2) return -1;
    var best = 0;
    for (var i = 0; i < MAP.TRIPS.length; i++) {
        var at = tripStopIndex[i];
        var matched = 0;
        var last = -1;
        for (var k = 0; k < names.length; k++) {
            var idx = at[names[k]];
            if (idx !== undefined && idx > last) {
                matched++;
                last = idx;
            }
        }
        if (matched < 2 || matched * 2 < names.length) continue;
        var score = matched * 10 + (line && norm(MAP.TRIPS[i][1]) === line ? 5 : 0) - Math.abs(MAP.TRIPS[i][3].length - names.length);
        if (score > best) {
            best = score;
            lastMatch = MAP.TRIPS[i][4];
        }
    }
    return lastMatch;
}

// The route shown, cut into legs (the way to a stop, with the stop): for each tile
// "<col>_<row>" the legs drawn on it, as [leg, index of its stop].
var routeId = -1;
var tileLegs = {};
// The index of the next stop in the route's stop list: the legs to the stops before it are
// driven (grey). -1: not known, nothing is grey.
var progress = -1;

function setRoute(id) {
    if (id === routeId) return;
    routeId = id;
    tileLegs = {};
    var list = id >= 0 ? MAP.ROUTES[id] : [];
    for (var i = 0; i < list.length; i++) {
        // (the style's tiles of this leg; none when the style is older than the map)
        var tiles = STYLE.LEGS[list[i][0]] || [];
        for (var k = 0; k < tiles.length; k++) {
            if (!tileLegs[tiles[k]]) tileLegs[tiles[k]] = [];
            tileLegs[tiles[k]].push(list[i]);
        }
    }
    shown.map = "";
}

// Where the bus is on its route: the timetable's next stop, else (a route typed into the
// IBIS) the stop the IBIS shows, looked up in the list.
function progressOf(route) {
    if (route.nextIndex !== null && route.nextIndex !== undefined) return route.nextIndex;
    if (!route.current) return -1;
    var name = norm(route.current.name);
    var stops = route.stops || [];
    for (var i = 0; i < stops.length; i++) {
        if (norm(stops[i].name) === name) return i;
    }
    return -1;
}

// The layers of a cell: the route's legs on this tile, the driven ones (grey) under those
// still ahead, each a box over the one before with the same piece of its tile. Returns the
// opening tags; as many </span> close them.
function legLayers(col, row, w, h, bgx, bgy) {
    var legs = tileLegs[col + "_" + row];
    var out = { open: "", count: 0 };
    if (!legs) return out;
    var dir = ROOT + STYLE.dir + "legs/";
    for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < legs.length; i++) {
            var driven = progress >= 0 && legs[i][1] < progress;
            if (driven !== (pass === 0)) continue;
            out.open +=
                '<span class="over" style="width:' + w + "px;height:" + h + "px;" +
                "background-image:url(" + dir + legs[i][0] + "/" + (driven ? "g_" : "b_") + col + "_" + row + ".png);" +
                "background-position:" + bgx + "px " + bgy + 'px">';
            out.count++;
        }
    }
    return out;
}

// Where the view's cells are cut along one axis: its two ends, every tile edge in between and
// the marker's two edges, so that each cell shows one tile and the marker is whole cells.
function cuts(start, size, tile, m0, m1) {
    var a = [0, size, m0, m1];
    var k = Math.ceil(start / tile) * tile - start;
    while (k < size) {
        if (k > 0) a.push(k);
        k += tile;
    }
    return uniqueSorted(a);
}

// The map has no positioning and no clipping to work with: the window is cut into rows of
// inline-block cells, each showing its piece of one tile by background-position, with the
// route's legs over it the same way (see legLayers). The marker is drawn in the last of the
// cells under it (the one painted last), pulled back over the others by negative margins.
function drawMap(x, y, heading) {
    var TILE = MAP.TILE;
    var bx = Math.round((x - MAP.X0) / MAP.MPP);
    var by = Math.round((MAP.Y1 - y) / MAP.MPP);
    var step = STYLE.arrowStep || 2;
    var deg = Math.round(heading / step) * step;
    deg = ((deg % 360) + 360) % 360;
    var key = MAP.id + "," + bx + "," + by + "," + deg + "," + routeId + "," + progress;
    if (shown.map === key) return;
    shown.map = key;

    // (the arrow pictures are squares of arrowSize px; without them, no marker)
    var mark = STYLE.arrowSize || 0;
    var vx = bx - VIEW_W / 2;
    var vy = by - VIEW_H / 2;
    var mx0 = Math.round(VIEW_W / 2 - mark / 2);
    var my0 = Math.round(VIEW_H / 2 - mark / 2);
    var xs = cuts(vx, VIEW_W, TILE, mx0, mx0 + mark);
    var ys = cuts(vy, VIEW_H, TILE, my0, my0 + mark);
    var marker = ROOT + STYLE.arrowDir + "arrow_rotation_" + String(deg).padStart(3, "0") + ".png";
    var tiles = ROOT + STYLE.dir + "tiles/";

    var html = "";
    for (var j = 0; j + 1 < ys.length; j++) {
        var h = ys[j + 1] - ys[j];
        var gy = vy + ys[j];
        var row = Math.floor(gy / TILE);
        html += '<div class="row" style="height:' + h + 'px">';
        for (var i = 0; i + 1 < xs.length; i++) {
            var w = xs[i + 1] - xs[i];
            var gx = vx + xs[i];
            var col = Math.floor(gx / TILE);
            // (a tile left out by the generator is plain background)
            var picture = tileSet[col + "_" + row]
                ? "background-image:url(" + tiles + "t_" + col + "_" + row + ".png);" +
                  "background-position:" + (col * TILE - gx) + "px " + (row * TILE - gy) + "px;"
                : "";
            html += '<span class="cell" style="width:' + w + "px;height:" + h + "px;background-color:" + STYLE.background + ";" + picture + '">';
            var layers = legLayers(col, row, w, h, col * TILE - gx, row * TILE - gy);
            html += layers.open;
            if (mark > 0 && xs[i + 1] === mx0 + mark && ys[j + 1] === my0 + mark) {
                html +=
                    '<img src="' + marker + '" width="' + mark + '" height="' + mark + '" style="margin-left:' +
                    (mx0 - xs[i]) + "px;margin-top:" + (my0 - ys[j]) + 'px">';
            }
            for (var c = 0; c < layers.count; c++) html += "</span>";
            html += "</span>";
        }
        html += "</div>";
    }
    document.getElementById("map").innerHTML = html;
}

// ---------------------------------------------------------------------------------------------
// Every update
// ---------------------------------------------------------------------------------------------

function draw() {
    if (omsi.time) {
        setText("clock", String(omsi.time.hour).padStart(2, "0") + ":" + String(omsi.time.minute).padStart(2, "0"));
    }
    var v = omsi.vehicle;
    if (!v) return;
    selectMap(v.info ? v.info.yard : "");
    var route = v.route;
    var line = route.line || (route.ibis.line ? String(route.ibis.line) : "");
    var terminus = route.destination || (route.terminus ? route.terminus.name : "");
    var next = route.current ? route.current.name : v.info.nextStop;
    setText("line", line ? cut(line, 6) : "--");
    setText("terminus", cut(terminus, 60));
    setText("next", next ? cut(next, 70) : "--");
    setAtStop(!!next && v.doors.anyOpen && Math.abs(v.motion.speedKmh || 0) < AT_STOP_KMH, next, line);
    setRoute(prepare() ? findRoute(route, line) : -1);
    progress = routeId >= 0 ? progressOf(route) : -1;
    if (mode === "stops") drawStops(route, line);
    if (mode === "map" && MAP && v.motion.x !== null && v.motion.y !== null) {
        drawMap(v.motion.x, v.motion.y, v.motion.heading || 0);
    }
}

window.omsi.update = function (d) {
    draw();
};
setMode(modeAt(0));
// Every second: the clock, and the middle's turn.
setInterval(function () {
    seconds++;
    setMode(modeAt(seconds));
    draw();
}, 1000);
