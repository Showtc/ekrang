"""Generates everything of ekrang's maps from the screens' inputs (see AGENTS.md).

It first asks which screens (folders of screens/) to generate for: a number, a list of numbers
(0,1) or all. Only the maps those screens use, their styles and the arrows of those styles are
generated; maps/hofs-folders.json and maps/maps.js always hold every map of every screen, and
styles are checked against every screen's (two screens must not draw the same pictures
differently).

 for each map (every screens/<screen>/src/<map>/map-information.json, merged by map):
   1. work/<map>/map.json        the map's roads and layers (fetch_map.py, openOMSI's launcher service)
   2. work/<map>/stops.json      every bus stop object on the map's tiles (rust/mapstops)
   3. work/<map>/routes_tt.json  the timetable's trips with their route (fetch_routes.py)
   4. work/<map>/routes_tt_placed.json  the stops the export could not place, placed (place_missing.py)
   5. work/<map>/routes_hof.json the hofs' IBIS routes along the roads (hof_routes.py)
   6. work/<map>/routes_all.json both together (merge_routes.py)
   7. maps/<map>/info.txt        the tiles' grid (render grid)
   8. maps/<map>/routes.json     trips and routes, and work/<map>/plan.json the legs (render plan)
 maps/hofs-folders.json         every map's hof names
 for each style (every screens/<screen>/src/<map>/style.json, merged by map and styleName):
   9. maps/<map>/src/gps/<styleName>/tiles   (render tiles)
  10. maps/<map>/src/gps/<styleName>/legs    (render legs)
 for each arrow style used:
  11. maps/arrows/<arrowStyle>/arrow_rotation_*.png  (make_arrows.py)
 the pages' files:
  12. maps/maps.js               EKRANG_HOFS and EKRANG_MAPS, every map
  13. screens/<screen>/src/<map>/style.js  the screen's style of that map, added to EKRANG_STYLES

Steps 1 to 4 take minutes and are kept in scripts/work: --refetch reads the map anew (after
the map or its timetable changed). The other steps are always done again.

python scripts/generate.py [--screens <0,1|all>] [--map <map> ...] [--styles-only] [--refetch]
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = os.path.join(HERE, "steps")
sys.path.insert(0, STEPS)
from omsi_text import lines_of

ap = argparse.ArgumentParser(description="Generates ekrang's maps, styles and arrows.")
ap.add_argument(
    "--screens",
    help="the screens to generate for, as asked at the start (0,1 or all): no question then",
)
ap.add_argument(
    "--map",
    nargs="+",
    help="only these maps (folder names in maps/); default: every map of the chosen screens",
)
ap.add_argument(
    "--styles-only",
    action="store_true",
    help="skip the map steps (1 to 8): the maps must have been generated before",
)
ap.add_argument(
    "--refetch",
    action="store_true",
    help="read the maps anew from the game (steps 1 to 4)",
)
ap.add_argument(
    "--root",
    default=os.path.dirname(HERE),
    help="the ekrang folder (default: the one of this script)",
)
ap.add_argument(
    "--work",
    default=os.path.join(HERE, "work"),
    help="the folder of the intermediate files (default: scripts/work)",
)
a = ap.parse_args()

ROOT = os.path.abspath(a.root)
MAPS = os.path.join(ROOT, "maps")
SCREENS = os.path.join(ROOT, "screens")
settings = json.load(open(os.path.join(HERE, "settings.json"), encoding="utf-8"))
EXE = ".exe" if os.name == "nt" else ""
ARROW_STEP = 2


def fail(msg):
    sys.exit("error: " + msg)


def read_env(path):
    """KEY=value lines of a .env file (# comments, values maybe in quotes)."""
    env = {}
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8-sig"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            env[k.strip()] = v
    return env


# the OMSI 2 folder: OMSI2_ROOT of ekrang's .env (or of the environment)
env = read_env(os.path.join(ROOT, ".env"))
OMSI_ROOT = os.environ.get("OMSI2_ROOT") or env.get("OMSI2_ROOT")
if not OMSI_ROOT:
    fail(
        "no OMSI2_ROOT: copy %s to .env and put the OMSI 2 folder in it"
        % os.path.join(ROOT, ".env.example")
    )
OMSI_ROOT = os.path.normpath(OMSI_ROOT)
if not os.path.isdir(os.path.join(OMSI_ROOT, "maps")):
    fail("OMSI2_ROOT %s is not the OMSI 2 folder (it has no maps folder)" % OMSI_ROOT)


def run(*cmd, stdout=None):
    print(">", " ".join('"%s"' % c if " " in c else c for c in cmd), flush=True)
    subprocess.run(cmd, check=True, stdout=stdout)


def py(script, *args):
    run(sys.executable, os.path.join(STEPS, script), *args)


def tool(crate, name):
    """A program of rust/<crate>, built when it is missing."""
    d = os.path.join(HERE, "rust", crate)
    exe = os.path.join(d, "target", "release", name + EXE)
    if not os.path.isfile(exe):
        if crate == "mapstops":
            # (its Cargo.toml names openOMSI's crates by path)
            toml = os.path.join(d, "Cargo.toml")
            src = settings["openomsiSource"].replace("\\", "/").rstrip("/")
            lines = open(toml, encoding="utf-8").read().splitlines()
            for i, l in enumerate(lines):
                for c in ("omsi-map", "omsi-cfg"):
                    if l.startswith(c + " ="):
                        lines[i] = '%s = { path = "%s/crates/%s" }' % (c, src, c)
            open(toml, "w", encoding="utf-8", newline="\n").write(
                "\n".join(lines) + "\n"
            )
        run(
            "cargo",
            "build",
            "--release",
            "--manifest-path",
            os.path.join(d, "Cargo.toml"),
        )
    return exe


def rel(path):
    """A path from the ekrang folder, with '/' (as the pages write it)."""
    return os.path.relpath(path, ROOT).replace("\\", "/")


def key_of(s):
    """A stop name compared loosely: letter case, '-' and '_' as spaces, runs of spaces."""
    return " ".join(str(s).lower().replace("-", " ").replace("_", " ").split())


def px(v, what):
    """A size of style.json: '15px' or 15."""
    if isinstance(v, (int, float)):
        return float(v)
    m = re.fullmatch(r"\s*(-?[\d.]+)\s*(px)?\s*", str(v))
    if not m:
        fail("%s: %r is not a size in px" % (what, v))
    return float(m.group(1))


def icon_size(v, what):
    """An icon's width or height of style.json, as CSS: ('px', n), ('%', n) or ('auto',)."""
    if isinstance(v, (int, float)):
        return ("px", float(v))
    s = str(v).strip().lower()
    if s == "auto":
        return ("auto",)
    m = re.fullmatch(r"([\d.]+)\s*(px|%)?", s)
    if not m:
        fail("%s: %r is not a size (px, % or auto)" % (what, v))
    return (m.group(2) or "px", float(m.group(1)))


picture_sizes = {}


def drawn_size(path, w_spec, h_spec):
    """The size an icon is drawn at: px as given, % of the picture's own size, auto keeping
    its proportions from the other side (both auto: its own size)."""
    if path not in picture_sizes:
        from PIL import Image

        picture_sizes[path] = Image.open(path).size
    nw, nh = picture_sizes[path]
    side = lambda spec, own: spec[1] if spec[0] == "px" else spec[1] / 100.0 * own if spec[0] == "%" else None
    w, h = side(w_spec, nw), side(h_spec, nh)
    if w is None and h is None:
        w, h = nw, nh
    elif w is None:
        w = h * nw / nh
    elif h is None:
        h = w * nh / nw
    return w, h


def resized(path, w, h, work):
    """{path, w, h} of the picture made w x h px (rounded) with a good filter, kept in
    work/pictures: the renderer then draws it as it is. (Its own scaling reads only 4 x 4
    pixels around each point: much smaller pictures would come out jagged.)"""
    import hashlib
    from PIL import Image

    W, H = max(1, round(w)), max(1, round(h))
    # (the renderer reads PNG only: another picture is always made into one)
    if (W, H) == picture_sizes.get(path) and path.lower().endswith(".png"):
        return {"path": path, "w": W, "h": H}
    d = os.path.join(work, "pictures")
    os.makedirs(d, exist_ok=True)
    tag = hashlib.sha1(os.path.abspath(path).lower().encode("utf-8")).hexdigest()[:8]
    out = os.path.join(d, "%s_%s_%dx%d.png" % (os.path.splitext(os.path.basename(path))[0], tag, W, H))
    if not os.path.isfile(out) or os.path.getmtime(out) < os.path.getmtime(path):
        # (premultiplied alpha, else the transparent pixels' colour fringes the edges)
        im = Image.open(path).convert("RGBA").convert("RGBa")
        im.resize((W, H), Image.LANCZOS).convert("RGBA").save(out)
    return {"path": out, "w": W, "h": H}


# The picture types ekrang reads (the pages show them as they are, the generator turns them
# into PNG for the renderer), in the order taken when two files have the same name.
PICTURE_TYPES = (".png", ".jpg", ".jpeg", ".tga", ".dds")


def picture_files(d):
    """name without its type, in lower case -> path, of the pictures of folder d."""
    out = {}
    if os.path.isdir(d):
        files = [f for f in os.listdir(d) if os.path.splitext(f)[1].lower() in PICTURE_TYPES]
        files.sort(key=lambda f: PICTURE_TYPES.index(os.path.splitext(f)[1].lower()))
        for f in files:
            out.setdefault(os.path.splitext(f)[0].lower(), os.path.join(d, f))
    return out


def picture_setting(v, what):
    """A picture of style.json (stopMarker, arrow): a file name, drawn at its own size, or
    {"image", "iconSizeWidth", "iconSizeHeight"}: (file name, width, height as icon_size)."""
    if isinstance(v, str):
        return (v, ("auto",), ("auto",))
    if not isinstance(v, dict) or not v.get("image"):
        fail("%s: a file name or {\"image\", \"iconSizeWidth\", \"iconSizeHeight\"}" % what)
    return (
        v["image"],
        icon_size(v.get("iconSizeWidth", "auto"), what + ".iconSizeWidth"),
        icon_size(v.get("iconSizeHeight", "auto"), what + ".iconSizeHeight"),
    )


def percent(v, what):
    m = re.fullmatch(r"\s*([\d.]+)\s*%\s*", str(v))
    if not m:
        fail("%s: %r is not a percentage" % (what, v))
    return float(m.group(1)) / 100.0


def hof_name(path):
    """The [name] of a hof: what the page sees as omsi.vehicle.info.yard."""
    ls = [l.strip() for l in lines_of(path)]
    for i, l in enumerate(ls):
        if l == "[name]" and i + 1 < len(ls):
            return ls[i + 1]
    return ""


def screen_files(name):
    """(screen, map folder of src, path) of every screens/<screen>/src/<map>/<name>."""
    out = []
    for p in sorted(glob.glob(os.path.join(SCREENS, "*", "src", "*", name))):
        d = os.path.dirname(p)
        out.append(
            (
                os.path.basename(os.path.dirname(os.path.dirname(d))),
                os.path.basename(d),
                p,
            )
        )
    return out


def load(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        fail("%s: %s" % (path, e))


def dump(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------------------------
# The screens to generate for
# ---------------------------------------------------------------------------------------------


def screens_from(answer, names):
    """The screens an answer picks (a number, numbers with commas, or all), or None."""
    answer = answer.strip().lower()
    if answer == "all":
        return list(names)
    picked = []
    for part in answer.split(","):
        part = part.strip()
        if not part.isdigit() or int(part) >= len(names):
            return None
        if names[int(part)] not in picked:
            picked.append(names[int(part)])
    return picked or None


screen_names = (
    sorted(d for d in os.listdir(SCREENS) if os.path.isdir(os.path.join(SCREENS, d)))
    if os.path.isdir(SCREENS)
    else []
)
if not screen_names:
    fail("no screen folder in %s" % SCREENS)
asked = "a number from 0 to %d, numbers with commas (0,1) or all" % (len(screen_names) - 1)
if a.screens is not None:
    chosen_screens = screens_from(a.screens, screen_names)
    if chosen_screens is None:
        fail("--screens %r: %s" % (a.screens, asked))
else:
    print("Screens:")
    for i, n in enumerate(screen_names):
        print("  %d  %s" % (i, n))
    while True:
        try:
            answer = input("Generate for which screens? (a number, a list as 0,1, or all): ")
        except EOFError:
            fail("no answer: give the screens with --screens (0,1 or all)")
        chosen_screens = screens_from(answer, screen_names)
        if chosen_screens is not None:
            break
        print("  %r: type %s" % (answer, asked))
print("screens: %s" % ", ".join(chosen_screens), flush=True)

# ---------------------------------------------------------------------------------------------
# The maps' inputs, merged by map (every screen's: maps.js and hofs-folders.json hold them all)
# ---------------------------------------------------------------------------------------------

maps = {}  # map -> {mapFolder, names (hof names, in order), files (.hof path -> its name), sources}
for screen, src_map, path in screen_files("map-information.json"):
    info = load(path)
    m = info.get("mapDirectory") or src_map
    if m != src_map:
        fail("%s: mapDirectory is %r but the file is in src/%s" % (path, m, src_map))
    folder = os.path.normpath(info["mapFolder"].strip("/\\"))
    if os.path.isabs(folder) or os.path.basename(os.path.dirname(folder)).lower() != "maps":
        fail(
            "%s: mapFolder %r must be the map's folder from the OMSI 2 folder, as maps/<map>"
            % (path, info["mapFolder"])
        )
    e = maps.setdefault(
        m, {"mapFolder": folder, "names": [], "files": {}, "sources": []}
    )
    e["sources"].append(path)
    if os.path.normcase(folder) != os.path.normcase(e["mapFolder"]):
        fail(
            "map %s has two mapFolder: %s and %s (%s)"
            % (m, e["mapFolder"], folder, ", ".join(e["sources"]))
        )
    # the map's .hof files are in hofs/<map>/; `hofs` picks some of them, each by its file
    # name (without .hof) or by its [name]
    hof_dir = os.path.join(ROOT, "hofs", m)
    if not os.path.isdir(hof_dir):
        fail("%s: no folder %s for the hofs of the map %s" % (path, hof_dir, m))
    named = []
    for h in sorted(glob.glob(os.path.join(hof_dir, "*.hof"))):
        n = hof_name(h)
        if n:
            named.append((h, n))
        else:
            print("warning: %s has no [name]: left out" % h)
    found = 0
    for want in info.get("hofs", []):
        hits = [
            (h, n)
            for h, n in named
            if want == n or want.lower() == os.path.basename(h)[:-4].lower()
        ]
        if not hits:
            print(
                "warning: %s: no .hof in %s is called or named %r (the map shows for it, without its routes)"
                % (path, hof_dir, want)
            )
            hits = [(None, want)]
        for h, n in hits:
            if n not in e["names"]:
                e["names"].append(n)
            if h:
                e["files"].setdefault(h, n)
                found += 1
    if not found:
        fail("%s: none of its hofs is in %s" % (path, hof_dir))

owner = {}
for m, e in maps.items():
    for n in e["names"]:
        if n in owner and owner[n] != m:
            fail("the hof %r is in two maps: %s and %s" % (n, owner[n], m))
        owner[n] = m

# the maps of the chosen screens (their map-information.json and style.json), maybe fewer
used = {
    src_map
    for name in ("map-information.json", "style.json")
    for screen, src_map, _ in screen_files(name)
    if screen in chosen_screens
}
chosen = sorted(m for m in maps if m in used)
if a.map:
    for m in a.map:
        if m not in maps:
            fail("no screens/*/src/%s/map-information.json for the map %s" % (m, m))
        if m not in used:
            fail("the map %s is not one of the chosen screens' (%s)" % (m, ", ".join(chosen_screens)))
    chosen = [m for m in chosen if m in a.map]
for m in sorted(used - set(maps)):
    print("warning: the map %s has a style.json but no map-information.json: left out" % m)

# ---------------------------------------------------------------------------------------------
# 1 to 8: the maps
# ---------------------------------------------------------------------------------------------

for m in chosen if not a.styles_only else []:
    e = maps[m]
    work = os.path.join(a.work, m)
    os.makedirs(work, exist_ok=True)
    W = lambda name: os.path.join(work, name)
    fresh = lambda name: a.refetch or not os.path.isfile(W(name))
    omsi_root = OMSI_ROOT
    map_name = os.path.basename(e["mapFolder"])
    map_path = os.path.join(OMSI_ROOT, e["mapFolder"])
    if not os.path.isfile(os.path.join(map_path, "global.cfg")):
        fail("map %s: no global.cfg in %s" % (m, map_path))
    print("=== map %s (%s)" % (m, map_path), flush=True)
    date = settings.get("timetableDate", "2024-06-03")
    if fresh("map.json"):
        py(
            "fetch_map.py",
            settings["openomsi"],
            omsi_root,
            map_name,
            date,
            W("map.json"),
        )
    if fresh("stops.json"):
        with open(W("stops.json"), "w", encoding="utf-8") as f:
            run(tool("mapstops", "mapstops"), omsi_root, map_name, stdout=f)
    if fresh("routes_tt.json"):
        py(
            "fetch_routes.py",
            settings["openomsi"],
            omsi_root,
            map_name,
            date,
            W("routes_tt.json"),
        )
    if fresh("routes_tt_placed.json"):
        py(
            "place_missing.py",
            W("routes_tt.json"),
            W("stops.json"),
            map_path,
            W("routes_tt_placed.json"),
        )
    # (the hofs can change without the map: always routed again)
    py(
        "hof_routes.py",
        W("map.json"),
        W("stops.json"),
        W("routes_hof.json"),
        *e["files"],
    )
    py(
        "merge_routes.py",
        W("routes_tt_placed.json"),
        W("routes_hof.json"),
        W("routes_all.json"),
    )
    out = os.path.join(MAPS, m)
    os.makedirs(out, exist_ok=True)
    render = tool("render", "render")
    run(
        render,
        "grid",
        W("map.json"),
        os.path.join(out, "info.txt"),
        str(settings.get("metresPerPixel", 1.25)),
        str(settings.get("tileSize", 512)),
    )
    run(
        render,
        "plan",
        W("routes_all.json"),
        os.path.join(out, "info.txt"),
        os.path.join(out, "routes.json"),
        W("plan.json"),
    )

# every map's hof names (all maps, not only the chosen ones)
os.makedirs(MAPS, exist_ok=True)
with open(
    os.path.join(MAPS, "hofs-folders.json"), "w", encoding="utf-8", newline="\n"
) as f:
    json.dump(
        {m: {"mapDirectory": m, "hofs": maps[m]["names"]} for m in sorted(maps)},
        f,
        ensure_ascii=False,
        indent=2,
    )
    f.write("\n")

# ---------------------------------------------------------------------------------------------
# 9 to 11: the styles and arrows
# ---------------------------------------------------------------------------------------------

styles = []  # (screen, map, path, style)
for screen, src_map, path in screen_files("style.json"):
    s = load(path)
    si = s.get("styleInformation", {})
    for k in ("map", "arrowStyle", "styleName"):
        if not si.get(k):
            fail("%s: styleInformation.%s is missing" % (path, k))
    if si["map"] != src_map:
        fail(
            "%s: styleInformation.map is %r but the file is in src/%s"
            % (path, si["map"], src_map)
        )
    styles.append((screen, si["map"], path, s))


def drawn_part(s):
    """What of a style.json is drawn into the map's pictures (the rest is read by the page)."""
    d = json.loads(json.dumps(s))
    d.pop("showInformations", None)
    d.pop("arrow", None)
    d["styleInformation"].pop("arrowStyle", None)
    return d


def lines_at_stops(routes_all):
    """Stop name key -> the lines whose trips stop there."""
    at = {}
    for t in routes_all["trips"]:
        line = str(t.get("line") or "").strip()
        if not line:
            continue
        for name in t.get("labels") or t["stops"]:
            at.setdefault(key_of(name), set()).add(line)
    return at


def line_order(line):
    m = re.match(r"(\d+)(.*)", line)
    return (0, int(m.group(1)), m.group(2)) if m else (1, 0, line.lower())


def draw_settings(m, path, s, plan, routes_all, work):
    """draw.json of `render legs`: the style with sizes in px and every leg's icon blocks."""
    base = os.path.dirname(path)
    assets = os.path.join(MAPS, m, "src", "assets")
    t = s.get("texts", {})
    font = t.get("font")
    if not font or not os.path.isfile(font):
        fail("%s: texts.font %r is not a font file" % (path, font))
    marker = None
    if s.get("stopMarker"):
        image, ws, hs = picture_setting(s["stopMarker"], "%s: stopMarker" % path)
        p = os.path.join(base, image)
        if not os.path.isfile(p):
            fail("%s: no stop marker %s" % (path, p))
        marker = resized(p, *drawn_size(p, ws, hs), work)
        # the marker of the stops already driven (g_ tiles), at the same size settings
        driven = s["stopMarker"].get("imageDriven") if isinstance(s["stopMarker"], dict) else None
        if driven:
            p = os.path.join(base, driven)
            if os.path.isfile(p):
                d = resized(p, *drawn_size(p, ws, hs), work)
                marker.update(pathDriven=d["path"], wDriven=d["w"], hDriven=d["h"])
            else:
                print("warning: %s: no stop marker %s (the driven stops get image)" % (path, p))
    lc = s.get("legsColor", {})
    si = s.get("stopsIcons", {})
    ci = s.get("connectionsStopLinesIcon", {})
    order = s.get("positionsIconsStops", ["connectionsStopLinesIcon", "stopsIcons"])
    for k in order:
        if k not in ("stopsIcons", "connectionsStopLinesIcon"):
            fail(
                "%s: positionsIconsStops has %r (stopsIcons or connectionsStopLinesIcon)"
                % (path, k)
            )

    def block(b, what, icons):
        pos = b.get("position", "bottom")
        if pos not in ("top", "right", "bottom", "left"):
            fail("%s: %s.position %r (top, right, bottom or left)" % (path, what, pos))
        ws = icon_size(b.get("iconSizeWidth", "auto"), what + ".iconSizeWidth")
        hs = icon_size(b.get("iconSizeHeight", "auto"), what + ".iconSizeHeight")
        sized = [resized(p, *drawn_size(p, ws, hs), work) for p in icons]
        return {
            "position": pos,
            "icons": sized,
            "gapFromStopName": px(
                b.get("gapFromStopName", 0), what + ".gapFromStopName"
            ),
            "gapIcons": px(b.get("gapIcons", 0), what + ".gapIcons"),
            "gapLines": px(b.get("gapLines", 0), what + ".gapLines"),
            "maxInLine": int(b.get("maxInLine", 1)),
        }

    pictos = {}
    if si.get("stopsIconsInformations"):
        for name, files in (si.get("stops") or {}).items():
            files = [files] if isinstance(files, str) else files
            ok = []
            for f in files:
                p = os.path.join(assets, "pictograms", f)
                if os.path.isfile(p):
                    ok.append(p)
                else:
                    print("warning: %s: no pictogram %s (left out)" % (path, p))
            pictos[key_of(name)] = ok
        known = {key_of(l["name"]) for l in plan["legs"]}
        for k in pictos:
            if k not in known:
                print(
                    "warning: %s: stopsIcons.stops has %r, a stop no trip of the map stops at"
                    % (path, k)
                )
    at = lines_at_stops(routes_all) if ci.get("show") else {}
    missing = set()

    badge_files = picture_files(os.path.join(assets, "lines"))

    def badges(leg):
        out = []
        for line in sorted(
            at.get(key_of(leg["name"]), set()) - {leg["line"]}, key=line_order
        ):
            p = badge_files.get(line.lower())
            if p:
                out.append(p)
            else:
                missing.add(line)
        return out

    blocks = []
    for leg in plan["legs"]:
        made = {
            "stopsIcons": block(si, "stopsIcons", pictos.get(key_of(leg["name"]), []))
            if pictos
            else None,
            "connectionsStopLinesIcon": block(
                ci, "connectionsStopLinesIcon", badges(leg)
            )
            if ci.get("show")
            else None,
        }
        # (nearest the name first: the order of positionsIconsStops, then the rest)
        blocks.append(
            [
                made[k]
                for k in order + [k for k in made if k not in order]
                if made.get(k) and made[k]["icons"]
            ]
        )
    if missing:
        print(
            "warning: no line badge in %s for the lines %s"
            % (
                os.path.join(assets, "lines"),
                ", ".join(sorted(missing, key=line_order)),
            )
        )
    return {
        "route": lc.get("route", "#ff1610"),
        "driven": lc.get("driven", "#9e9e9e"),
        "label": lc.get("stopsLabel", "#000000"),
        # (the names of the stops already driven: their own colour, else the same)
        "labelDriven": lc.get("stopsLabelDriven") or lc.get("stopsLabel", "#000000"),
        "marker": marker,
        "text": {
            "font": font,
            "weight": t.get("weight"),
            "size": px(t.get("size", 16), "texts.size"),
            "lineHeight": percent(t.get("lineHeight", "120%"), "texts.lineHeight"),
            "letterSpacing": px(t.get("letterSpacing", 0), "texts.letterSpacing"),
            "rotation": float(t.get("rotation", 0)),
            "gapFromMarker": px(t.get("gapFromMarker", 7), "texts.gapFromMarker"),
        },
        "blocks": blocks,
    }


# (every screen's styles are checked: a shared styleName draws the same pictures for all)
done = {}  # (map, styleName) -> (drawn part, style.json)
for screen, m, path, s in styles:
    name = s["styleInformation"]["styleName"]
    part = drawn_part(s)
    if (m, name) in done and done[(m, name)][0] != part:
        fail(
            "%s and %s both draw %s/src/gps/%s, differently: give one of them another styleName"
            % (done[(m, name)][1], path, m, name)
        )
    done.setdefault((m, name), (part, path))

drawn = set()  # (map, styleName) generated
for screen, m, path, s in styles:
    name = s["styleInformation"]["styleName"]
    if screen not in chosen_screens or m not in chosen or (m, name) in drawn:
        continue
    drawn.add((m, name))
    work = os.path.join(a.work, m)
    for f in ("map.json", "plan.json", "routes_all.json"):
        if not os.path.isfile(os.path.join(work, f)):
            fail(
                "map %s is not generated yet (no %s): run without --styles-only"
                % (m, os.path.join(work, f))
            )
    print("=== style %s/%s (%s)" % (m, name, path), flush=True)
    plan = load(os.path.join(work, "plan.json"))
    draw = draw_settings(m, path, s, plan, load(os.path.join(work, "routes_all.json")), work)
    draw_path = os.path.join(work, "draw_%s.json" % name)
    json.dump(draw, open(draw_path, "w", encoding="utf-8"), ensure_ascii=False)
    out = os.path.join(MAPS, m, "src", "gps", name)
    if os.path.isdir(out):
        shutil.rmtree(out)
    mc = s.get("mapColors", {})
    colours = [
        mc.get("background", "#ffd79c"),
        mc.get("road", "#ffffff"),
        mc.get("main_road", "#ffefa4"),
        mc.get("vegetation", "#ced78c"),
        mc.get("water", "#9fcff2"),
    ]
    render = tool("render", "render")
    info = os.path.join(MAPS, m, "info.txt")
    run(
        render,
        "tiles",
        os.path.join(work, "map.json"),
        info,
        os.path.join(out, "tiles"),
        *colours,
    )
    run(
        render,
        "legs",
        os.path.join(work, "plan.json"),
        draw_path,
        info,
        os.path.join(out, "legs"),
    )

# (every screen's arrows are checked: an arrow style's pictures are shared)
arrows = {}  # arrowStyle -> (arrow, style.json)
for screen, m, path, s in styles:
    st = s["styleInformation"]["arrowStyle"]
    arrow = picture_setting(s.get("arrow", "arrow.png"), "%s: arrow" % path)
    if st in arrows:
        if arrows[st][0] != arrow:
            said = lambda a: "%s, width %s, height %s" % (
                a[0],
                *("".join(map(lambda v: "%g" % v if isinstance(v, float) else v, x[::-1])) for x in a[1:]),
            )
            fail(
                "the arrow style %s is given two different arrows: give them the same arrow, or each its own arrowStyle\n  %s: %s\n  %s: %s"
                % (st, arrows[st][1], said(arrows[st][0]), path, said(arrow))
            )
        continue
    arrows[st] = (arrow, path)

made = set()  # arrow styles generated
for screen, m, path, s in styles:
    st = s["styleInformation"]["arrowStyle"]
    if screen not in chosen_screens or m not in chosen or st in made:
        continue
    made.add(st)
    arrow = arrows[st][0]
    src = os.path.join(MAPS, "arrows", st, arrow[0])
    if not os.path.isfile(src):
        fail("%s: no arrow picture %s" % (path, src))
    w, h = drawn_size(src, arrow[1], arrow[2])
    py("make_arrows.py", src, "%.2f" % w, "%.2f" % h)

# ---------------------------------------------------------------------------------------------
# 12, 13: the pages' files
# ---------------------------------------------------------------------------------------------


def grid_of(m):
    g = {}
    for l in open(os.path.join(MAPS, m, "info.txt"), encoding="utf-8"):
        if "=" in l:
            k, v = l.split("=", 1)
            g[k.strip()] = float(v)
    return g


ready = [
    m
    for m in sorted(maps)
    if os.path.isfile(os.path.join(MAPS, m, "routes.json"))
    and os.path.isfile(os.path.join(MAPS, m, "info.txt"))
]
rows = [
    "// ekrang maps: written by scripts/generate.py, do not edit by hand.",
    "// EKRANG_HOFS[i] = [hof name (omsi.vehicle.info.yard), map id].",
    "// EKRANG_MAPS[i]: a map. Its tiles t_<col>_<row>.png cover picture pixels [col*TILE, row*TILE]",
    "// and onwards, and picture pixel (0, 0) is world point (X0, Y1), x east and y north, MPP metres",
    "// a pixel. TRIPS[i] = [name, line, terminus, [stop names], route]; ROUTES[r] = its legs as",
    "// [leg, stop index]. Which tiles each leg has is in the style (EKRANG_STYLES).",
    "// EKRANG_STYLES: empty here; each screens/<screen>/src/<map>/style.js, loaded after this",
    "// file, adds its own.",
    "var EKRANG_STYLES = [];",
    "var EKRANG_HOFS = [",
]
rows += ["    %s," % dump([n, m]) for m in ready for n in maps[m]["names"]]
rows += ["];", "var EKRANG_MAPS = [];"]
for m in ready:
    g = grid_of(m)
    r = load(os.path.join(MAPS, m, "routes.json"))
    rows += (
        [
            "EKRANG_MAPS.push({",
            "    id: %s," % dump(m),
            "    dir: %s," % dump("maps/%s/" % m),
            "    hofs: %s," % dump(maps[m]["names"]),
            "    X0: %s," % dump(g["X0"]),
            "    Y1: %s," % dump(g["Y1"]),
            "    MPP: %s," % dump(g["MPP"]),
            "    TILE: %d," % g["TILE"],
            "    COLS: %d," % g["COLS"],
            "    ROWS: %d," % g["ROWS"],
            "    TRIPS: [",
        ]
        + ["        %s," % dump(t) for t in r["trips"]]
        + ["    ],", "    ROUTES: ["]
        + ["        %s," % dump(x) for x in r["routes"]]
        + ["    ],", "});"]
    )
open(os.path.join(MAPS, "maps.js"), "w", encoding="utf-8", newline="\n").write(
    "\n".join(rows) + "\n"
)
print("maps/maps.js: %d map(s)" % len(ready))


def tile_names(d, prefix):
    return (
        sorted(
            f[len(prefix) : -4]
            for f in os.listdir(d)
            if f.startswith(prefix) and f.endswith(".png")
        )
        if os.path.isdir(d)
        else []
    )


for screen in chosen_screens:
    # (the one styles.js of every map that came before the per-map style.js)
    old = os.path.join(SCREENS, screen, "src", "styles.js")
    if os.path.isfile(old):
        os.remove(old)
        print("removed %s (now one style.js per map)" % rel(old))
for screen, m, path, s in styles:
    if screen not in chosen_screens:
        continue
    rows = [
        "// The style of the screen %s on the map %s: written by scripts/generate.py from the"
        % (screen, m),
        "// style.json next to it, do not edit by hand. It adds itself to EKRANG_STYLES (declared by",
        "// maps/maps.js, loaded before). Paths are from the ekrang folder (a page in screens/<screen>/",
        '// puts "../../" before them). TILES: the tiles "<col>_<row>" of dir/tiles/ (a missing one',
        "// is plain background); LEGS[l]: the tiles of dir/legs/<l>/ (b_ ahead, g_ driven);",
        "// LINES[i] = [line in lower case, its badge file in linesDir].",
    ]
    si = s["styleInformation"]
    gps = os.path.join(MAPS, m, "src", "gps", si["styleName"])
    if not os.path.isdir(gps):
        print("warning: %s: %s is not generated" % (path, rel(gps)))
    legs_dir = os.path.join(gps, "legs")
    n_legs = len(os.listdir(legs_dir)) if os.path.isdir(legs_dir) else 0
    legs = [tile_names(os.path.join(legs_dir, str(i)), "b_") for i in range(n_legs)]
    infos = os.path.join(MAPS, m, "src", "assets", "informations")
    lines_dir = os.path.join(MAPS, m, "src", "assets", "lines")
    arrow_dir = os.path.join(MAPS, "arrows", si["arrowStyle"])
    first = os.path.join(arrow_dir, "arrow_rotation_000.png")
    arrow_size = 0
    if os.path.isfile(first):
        from PIL import Image

        arrow_size = Image.open(first).width
    rows += (
        [
            "EKRANG_STYLES.push({",
            "    map: %s," % dump(m),
            "    styleName: %s," % dump(si["styleName"]),
            "    dir: %s," % dump(rel(gps) + "/"),
            "    background: %s,"
            % dump(s.get("mapColors", {}).get("background", "#ffd79c")),
            "    arrowDir: %s," % dump(rel(arrow_dir) + "/"),
            "    arrowStep: %d," % ARROW_STEP,
            "    arrowSize: %d," % arrow_size,
            "    showInformations: %s," % dump(bool(s.get("showInformations"))),
            "    informationsDir: %s," % dump(rel(infos) + "/"),
            "    informations: %s,"
            % dump(sorted(os.path.basename(f) for f in picture_files(infos).values())),
            "    linesDir: %s," % dump(rel(lines_dir) + "/"),
            "    LINES: %s,"
            % dump(sorted(([n, os.path.basename(f)] for n, f in picture_files(lines_dir).items()), key=lambda x: x[0])),
            "    TILES: %s," % dump(tile_names(os.path.join(gps, "tiles"), "t_")),
            "    LEGS: [",
        ]
        + ["        %s," % dump(l) for l in legs]
        + ["    ],", "});"]
    )
    out = os.path.join(os.path.dirname(path), "style.js")
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(rows) + "\n")
    print("%s: written" % rel(out))
print("done")
