# ekrang

`ekrang` is the shared folder of the passenger-information screens of OMSI 2 buses, shown with
openOMSI's `[htmltexture]`. Every screen (INEO, Lumiplan TFT, …) uses the same GPS maps,
itineraries and assets from `maps`, and keeps only its own look in `screens/<screen>`.

It is installed at `OMSI 2\ekrang\`. A bus points to a screen from its `.bus` / model `.cfg`
with a path counted from the bus folder, for example:

```
[htmltexture]
800
480
..\..\ekrang\screens\ineo\ineo.html
```

The pages in `Vehicles\PDO_C2\Script\ineo_html` and `Vehicles\PDO_C2\html` are proofs of
concept. They do not follow this layout: this document is the layout to follow.

## Words used here

| Word | Meaning |
|------|---------|
| map | An OMSI 2 map (`OMSI 2\maps\<map>`), and its folder in `maps/<mapName>`. |
| hof | A depot file (`.hof`). Its `[name]` entry is what the game gives the page as `omsi.vehicle.info.yard`. |
| hof name | The `[name]` written inside a `.hof` file, **not** its file name. `St-Servan_BLANC-DEV.hof` has the name `St-Servan - Deviation - AgoProjects`. |
| tile | One square PNG of the GPS map, `t_<col>_<row>.png`. |
| leg | The part of an itinerary from one stop to the next, drawn over the tiles. |
| style | One set of generated GPS pictures (`tiles_style_<n>`) or arrows (`style_<n>`). |

# Folder structure

```
ekrang
├── .env                             this machine's OMSI 2 folder (not in git, see Generation)
├── .env.example                     what to copy to .env
├── hofs                             the .hof files, one folder per map
│   ├── st_servan                    (the map's id, as in maps/ and styleInformation.map)
│   │   ├── St-Servan.hof
│   │   └── ...
│   └── grand_paris_moulon
│       └── ...
├── scripts                          the generator (see Generation)
│   ├── generate.py                  the one script to run
│   ├── settings.json                where openOMSI is, timetable day, tile size
│   ├── steps                        the Python steps generate.py runs
│   ├── rust
│   │   ├── mapstops                 finds the bus stop objects of a map
│   │   └── render                   draws the tiles, legs and labels
│   └── work                         intermediate files, one folder per map (not in git)
├── maps
│   ├── hofs-folders.json            hof name → map folder (generated)
│   ├── maps.js                      every map and hof name, for the pages (generated)
│   ├── arrows                       bus marker, shared by every map
│   │   ├── style_1
│   │   │   ├── arrow.png            source picture (made by hand)
│   │   │   ├── arrow_rotation_000.png
│   │   │   ├── ...                  one every 2°
│   │   │   └── arrow_rotation_358.png
│   │   └── style_2
│   │       └── ...
│   ├── st_servan
│   │   ├── info.txt                 the tiles' grid, the same for every style (generated)
│   │   ├── routes.json              trips and routes, put into maps.js (generated)
│   │   └── src
│   │       ├── gps
│   │       │   ├── tiles_style_1
│   │       │   │   ├── tiles
│   │       │   │   │   ├── t_1_12.png
│   │       │   │   │   └── ...
│   │       │   │   └── legs
│   │       │   │       ├── 0
│   │       │   │       │   ├── b_10_23.png   leg 0, still ahead
│   │       │   │       │   ├── g_10_23.png   leg 0, already driven
│   │       │   │       │   └── ...
│   │       │   │       ├── 1
│   │       │   │       └── ...
│   │       │   └── tiles_style_2
│   │       │       └── (same as tiles_style_1)
│   │       └── assets                    made by hand, not generated
│   │           ├── lines                 line badges: <line>.png (2.png, 25.png, …)
│   │           ├── pictograms            stop icons (parc.png, town_hall.png, …)
│   │           └── informations          information / ad pictures (ad1.png, …)
│   └── grand_paris_moulon
│       └── ...
└── screens
    ├── lumiplan_tft_long_palme_dor
    │   ├── *.html, *.js, *.css, *.osc, …  the screen itself
    │   └── src
    │       ├── st_servan
    │       │   ├── map-information.json  input of the map generator
    │       │   ├── style.json            input of the style generator
    │       │   ├── style.js              this screen's style of this map, for the pages (generated)
    │       │   └── stop_marker.png       stop marker drawn on the tiles (optional)
    │       └── grand_paris_moulon
    │           └── ...
    └── ineo
        └── ...
```

Generated files (`hofs-folders.json`, `maps.js`, `info.txt`, `routes.json`, `style.js`,
everything in `src/gps`, the `arrow_rotation_*.png` of `arrows`) are never edited by hand:
change the inputs and generate again.

# What the pages can and cannot do

The pages run in openOMSI's built-in HTML engine, not in a browser. The full list of what it
supports is in `Vehicles\PDO_C2\resources\HTML_CSS_REFERENCE.md`. What matters for ekrang:

- **No file reading at runtime.** There is no `fetch`, no `XMLHttpRequest` and no `JSON`
  object. `<script src>` and `<link rel="stylesheet" href>` are pasted into the page once, when
  it loads. So the generator writes what pages need as `.js` files that set global variables:
  `maps/maps.js` (`EKRANG_HOFS`, `EKRANG_MAPS`: every map, so a page never has to choose one
  at load time; it also declares `EKRANG_STYLES`, empty) and one
  `screens/<screen>/src/<map>/style.js` per map, which adds the screen's style of that map to
  `EKRANG_STYLES`. See In game.
- **Generated JavaScript** sticks to what the engine is known to run: `var`, arrays,
  `obj.push({ key: value })` with unquoted keys. No quoted object keys, no `JSON`.
- **Paths** in `src` / `href` are counted from the page's own folder (then the model folder,
  then the bus folder). From `screens/<screen>/`, the maps are at `../../maps/`. In JavaScript
  write paths with `/`, never `\` (`\` starts an escape in a string).
- **CSS:** block flow and `inline-block` only. No flexbox, no `transform` / rotation, no
  `@font-face`, no `letter-spacing` effect, no `opacity`, no `transition`. That is why the GPS
  pictures (stop names, icons, rotations) are drawn by the generators, not by the page.

# Configuration files

## `maps/hofs-folders.json`

Says which map folder each hof name belongs to. Generated from every `map-information.json`
(do not edit it); the pages get the same as `EKRANG_HOFS` in `maps/maps.js`.

```json
{
  "st_servan": {
    "mapDirectory": "st_servan",
    "hofs": ["St-Servan", "CREA_St-Servan", "CREA_St-Servan_12", "CREA_St-Servan_DEV", "St-Servan - Deviation - AgoProjects"]
  },
  "grand_paris_moulon": {
    "mapDirectory": "grand_paris_moulon",
    "hofs": ["GPM Les Cars Vier", "GPM Global", "GPM Keolis Essonne Mobilites", "GPM InterEssonne", "GPM Transdev les Cars Moulon"]
  }
}
```

| Key | Type | Meaning |
|-----|------|---------|
| `<key>` | object | One map. The key is the map's id. |
| `mapDirectory` | string | Folder name in `maps/`. |
| `hofs` | string[] | Hof **names** (`[name]` inside the `.hof`) the map is shown for. |

A hof name must appear in one map only (the generator stops otherwise). A bus whose hof name
is in no map shows no GPS.

## `map-information.json` (map generator input)

```json
{
  "mapDirectory": "st_servan",
  "mapFolder": "maps/St-Servan",
  "hofs": ["St-Servan", "CREA_St-Servan", "CREA_St-Servan_12", "CREA_St-Servan_DEV", "St-Servan - Deviation - AgoProjects"]
}
```

| Key | Type | Meaning |
|-----|------|---------|
| `mapDirectory` | string | Output folder in `maps/`. Must be the name of the `src/<map>` folder the file is in. |
| `mapFolder` | string | The OMSI 2 map's folder from the OMSI 2 folder (`OMSI2_ROOT` of `.env`): `maps/<map>`, with `/`. |
| `hofs` | string[] | The hofs supported, each a file name of `hofs/<map>/` without `.hof` (`St-Servan_BLANC-DEV`) or a hof name (`St-Servan - Deviation - AgoProjects`). |

The `.hof` files of a map are in `hofs/<map>/`, where `<map>` is the map's id: the `src/<map>`
folder this file is in, which is also `styleInformation.map` of the styles. The screens hold no
`.hof` files.

The generator keeps the `.hof` files of `hofs/<map>/` that `hofs` picks: their IBIS routes are
drawn, and their hof names (never file names) go into `hofs-folders.json` and `maps.js`. A hof
name picks every file with that name. At least one file must be found, otherwise it stops with
an error; an entry that picks no file only warns (it goes in as a hof name: the map still shows
for it, with the timetable's trips). `.hof` files can be Windows-1252, UTF-8 or UTF-16 (the HOF Suite writes
UTF-16): read them by their byte order mark.

When several screens have a `map-information.json` for the same map, they are merged: their
`hofs` add up, and their `mapFolder` must be the same.

It writes `maps/<mapDirectory>/info.txt` and `routes.json`, and the map's hof names into
`maps/hofs-folders.json` and `maps/maps.js`.

## `style.json` (style generator input, read by the screen)

One per screen and map: `screens/<screen>/src/<map>/style.json`.

```json
{
  "styleInformation": {
    "map": "st_servan",
    "arrowStyle": "style_1",
    "styleName": "tiles_style_1"
  },
  "mapColors": {
    "background": "#f2efe9",
    "road": "#ffffff",
    "main_road": "#fcd6a4",
    "vegetation": "#add19e",
    "water": "#aad3df"
  },
  "legsColor": {
    "route": "#0033ff",
    "driven": "#9e9e9e",
    "stopsLabel": "#0066ff",
    "stopsLabelDriven": "#9e9e9e"
  },
  "stopsIcons": {
    "stopsIconsInformations": true,
    "stops": {
      "stade de verfontaine": ["stadium.png", "parc.png"],
      "p+r ronoe": "parking.png"
    },
    "iconSizeHeight": "50px",
    "iconSizeWidth": "50px",
    "gapFromStopName": "15px",
    "gapIcons": "5px",
    "maxInLine": 5,
    "gapLines": "5px",
    "position": "top"
  },
  "connectionsStopLinesIcon": {
    "show": true,
    "iconSizeHeight": "50px",
    "iconSizeWidth": "50px",
    "gapFromStopName": "15px",
    "gapIcons": "5px",
    "maxInLine": 5,
    "gapLines": "5px",
    "position": "bottom"
  },
  "texts": {
    "font": "D:/Fonts/InterVariable.ttf",
    "weight": 700,
    "size": "12px",
    "rotation": 0,
    "lineHeight": "100%",
    "letterSpacing": "0px",
    "gapFromMarker": "15px"
  },
  "stopMarker": {
    "image": "stop_marker.png",
    "imageDriven": "stop_marker_driven.png",
    "iconSizeHeight": "18px",
    "iconSizeWidth": "auto"
  },
  "arrow": {
    "image": "arrow.png",
    "iconSizeHeight": "18px",
    "iconSizeWidth": "auto"
  },
  "showInformations": true,
  "positionsIconsStops": ["connectionsStopLinesIcon", "stopsIcons"]
}
```

Sizes are strings in `px` (icon sizes can also be `%` or `auto`). Colours are `#rrggbb`. `position` is one of `top`, `right`,
`bottom`, `left`. Everything except `styleInformation` and `showInformations` is drawn into
the pictures by the generator: changing it needs a new generation.

Several screens can use the same `styleName` of a map only with the same drawn settings
(everything but `arrowStyle`, `arrow` and `showInformations`): the generator stops otherwise.
Give a screen with another look its own `styleName`.

### `styleInformation`

| Key | Meaning |
|-----|---------|
| `map` | Map folder in `maps/`. |
| `arrowStyle` | Folder in `maps/arrows/` used for the bus marker. |
| `styleName` | Folder in `maps/<map>/src/gps/` the tiles and legs are written to and read from. |

### `mapColors` — the tiles

| Key | Colours |
|-----|---------|
| `background` | Ground, paved land and sand. |
| `road` | Ordinary roads and paved surfaces (squares, car parks). |
| `main_road` | Main roads (avenues, highways). |
| `vegetation` | Forest and fields. |
| `water` | Water. |

### `legsColor` — the itinerary (`legs`)

| Key | Colours |
|-----|---------|
| `route` | The route still ahead (`b_*.png`), and the ring of its stops when there is no `stopMarker`. |
| `driven` | The part already driven (`g_*.png`), and the ring of its stops when there is no `stopMarker`. |
| `stopsLabel` | Stop names of the stops still ahead (`b_*.png`). |
| `stopsLabelDriven` | Optional. Stop names of the stops already driven (`g_*.png`); left out: `stopsLabel`. |

### `stopsIcons` — pictograms next to a stop name

| Key | Type | Meaning |
|-----|------|---------|
| `stopsIconsInformations` | bool | Draw these icons or not. |
| `stops` | object | Stop name → one file name or a list of file names (any picture type, see below) in `maps/<map>/src/assets/pictograms`. Stop names are the names drawn on the map, compared without letter case and with `-` and `_` as spaces. Can be empty. A name no trip stops at only warns. |
| `iconSizeWidth`, `iconSizeHeight` | px, %, `auto` | Size each icon is drawn at, as in CSS: `px` as given; `%` of the picture's own size; `auto` keeps the picture's proportions from the other side (both `auto`, or the key left out: the picture's own size). With `"iconSizeHeight": "40px", "iconSizeWidth": "auto"`, icons of different shapes get the same height. |
| `gapFromStopName` | px | Gap between the stop name and the icons. |
| `gapIcons` | px | Gap between two icons of a row. |
| `maxInLine` | int | Icons in a row before starting a new row. A row is as high as its highest icon, the others centred in it. |
| `gapLines` | px | Gap between two rows. |
| `position` | side | Side of the stop name the icons go. |

On the stops already driven (`g_*.png`) the icons are drawn in grey (their brightness, same
transparency); `connectionsStopLinesIcon` too.

### `connectionsStopLinesIcon` — connecting line badges next to a stop name

Same keys as `stopsIcons`, with `show` (bool) instead of `stopsIconsInformations` and no
`stops`. The badges are `maps/<map>/src/assets/lines/<line>.<type>` (any picture type), for the other
lines whose trips (timetable or hofs) stop there, sorted by number. A line without a badge
file is left out, with one warning listing them all.

### `texts` — stop names on the map

| Key | Meaning |
|-----|---------|
| `font` | Absolute path of a `.ttf` / `.otf` file. |
| `weight` | Optional. Weight of a variable font (`700`: bold); ignored by other fonts. |
| `size` | Font size (px). |
| `rotation` | Rotation of the label (the name and its icons) about the stop, in degrees, clockwise. |
| `lineHeight` | Line height in %, as in Figma. |
| `letterSpacing` | Space between letters (px). |
| `gapFromMarker` | Gap between the stop marker and the text (px). |

### Other keys

| Key | Meaning |
|-----|---------|
| `stopMarker` | Optional. The stop marker (any picture type) next to `style.json`, centred on the stop: `{ "image", "imageDriven", "iconSizeWidth", "iconSizeHeight" }`. `image` is drawn on the stops still ahead (`b_*.png`), `imageDriven` (optional) on the stops already driven (`g_*.png`), as `route` and `driven` of `legsColor`; without it, or when its file is missing (a warning), `image` is drawn on both. Sizes as for icons (`px`, `%`, `auto`; left out: `auto`), the same for both pictures; the stop name starts `gapFromMarker` after the wider of the two. Or just a file name (its own size, on both). Without `stopMarker`, a white disc ringed in `route` / `driven`. |
| `arrow` | The arrow's source picture in `maps/arrows/<arrowStyle>/`, pointing north, the same way as `stopMarker`: `{ "image", "iconSizeWidth", "iconSizeHeight" }` or just the file name. The generator makes it that size, then turns it into `arrow_rotation_000.png … 358.png` in the same folder, each a square just wide enough for the arrow's visible pixels at every angle (twice the distance from the centre, where it turns, to its furthest visible pixel: transparent corners add nothing). Every style using the same `arrowStyle` must give the same `arrow`. |
| `showInformations` | Show the pictures of `maps/<map>/src/assets/informations` (read by the screen at runtime). |
| `positionsIconsStops` | When `stopsIcons` and `connectionsStopLinesIcon` have the same `position`, their order from the stop name outwards: index 0 is closest to the name. Values: `"stopsIcons"`, `"connectionsStopLinesIcon"`. |

# Generation

From the ekrang folder:

```
python scripts/generate.py                    asks for the screens, then their maps, styles and arrows
python scripts/generate.py --screens all      the same without the question (0, 0,1 or all)
python scripts/generate.py --map st_servan    only these maps of the chosen screens (and their styles)
python scripts/generate.py --styles-only      only the styles, arrows and .js files (after a style.json change)
python scripts/generate.py --refetch          read the maps anew from the game (after a map or timetable change)
```

It first lists the folders of `screens/`, numbered from 0, and asks which to generate for: a
number (`1`), a list of numbers (`0,1`) or `all`; a wrong answer is asked again. Then:

- only the maps the chosen screens use (their `map-information.json` and `style.json`), their
  styles, the arrows of those styles and their `style.js` are generated;
- `maps/hofs-folders.json` and `maps/maps.js` still hold every map of every screen (a page
  needs them all);
- styles are checked against every screen's, chosen or not: two screens drawing the same
  `styleName` of a map, or the same `arrowStyle`, must give them the same settings.

It needs:

- **`.env`** in the ekrang folder, with this machine's OMSI 2 folder. Copy `.env.example`
  (git ignores `.env`):
  ```
  OMSI2_ROOT="D:/Program Files/Steam/steamapps/common/OMSI 2"
  ```
  An `OMSI2_ROOT` environment variable wins over the file.
- **Python 3** with **Pillow** (`pip install pillow`).
- **Rust** (`cargo`): `scripts/rust/render` and `scripts/rust/mapstops` are built the first time.
- **openOMSI**: `scripts/settings.json` gives `openomsi` (its `openomsi.exe`, whose launcher
  service exports the map) and `openomsiSource` (its source folder: `mapstops` uses its
  `omsi-map` and `omsi-cfg` crates). Also `timetableDate` (the timetable's day),
  `metresPerPixel` and `tileSize` (keep 1.25 and 512 unless the pages change too).
- **Each map driven once in openOMSI**: the vegetation, water and road surfaces come from the
  map cache openOMSI writes when it first loads a map. Without it the tiles only have roads.

What it does:

1. **Maps** (every `map-information.json`, merged by map): export the map, its stops and its
   timetable trips into `scripts/work/<map>/` (kept: `--refetch` to read them again), route
   the hofs' IBIS routes along the roads, then write `maps/<map>/info.txt` (the tiles' grid)
   and `routes.json` (the trips cut into legs; the legs' shapes stay in `scripts/work/<map>/plan.json`).
2. **`maps/hofs-folders.json`**, from every map.
3. **Styles** (every `style.json`, merged by map and `styleName`): draw
   `maps/<map>/src/gps/<styleName>/tiles` and `legs`, the folder emptied first.
4. **Arrows** (every `arrowStyle` used): `maps/arrows/<arrowStyle>/arrow_rotation_*.png`.
5. **The pages' files**: `maps/maps.js`, and a `style.js` next to every `style.json`
   (`screens/<screen>/src/<map>/style.js`).

A style needs its map generated first (its files in `scripts/work/<map>/`). Errors stop the
generator with `error: …`; `warning: …` lines are worth reading (missing pictures, hofs,
badges).

Pictures can be PNG, JPG/JPEG, TGA or DDS (badges, pictograms, stop markers, arrows,
information pictures). When a folder has two files of the same name, the first of that order
is taken. The pages show them as they are; the generator turns them into PNG for the renderer.

Pictures (icons, badges, stop markers) are first made to the size they are drawn at, with a
Lanczos filter, into `scripts/work/<map>/pictures/`, then drawn as they are on whole pixels: the
renderer's own scaling only reads 4 x 4 pixels around each point and turns much smaller
pictures jagged. A size in `px` is rounded to a whole pixel.

The drawing sizes not in `style.json` (the route line 7 px wide, the default stop disc) are
constants at the top of `scripts/rust/render/src/main.rs`.

# In game

A screen's page (in `screens/<screen>/`) loads the generated files before its own script:
`maps.js` first (it declares `EKRANG_STYLES`), then the `style.js` of every map the screen has
(a page cannot choose one at load time):

```html
<script src="../../maps/maps.js"></script>
<script src="src/st_servan/style.js"></script>
<script src="src/grand_paris_moulon/style.js"></script>
<script src="screen.js"></script>
```

A new map for the screen needs its `<script>` line added.

What they hold (paths in them are from the ekrang folder: the page puts `../../` before them):

| Variable | Content |
|----------|---------|
| `EKRANG_HOFS[i]` | `[hof name, map id]`. |
| `EKRANG_MAPS[i]` | `{ id, dir, hofs, X0, Y1, MPP, TILE, COLS, ROWS, TRIPS, ROUTES }`. Tile `t_<col>_<row>.png` covers picture pixels from `(col*TILE, row*TILE)`; picture pixel (0, 0) is world point (`X0`, `Y1`), x east, y north, `MPP` metres a pixel. `TRIPS[i] = [name, line, terminus, [stop names], route]`; `ROUTES[r] = [[leg, stop index], ...]`. |
| `EKRANG_STYLES[i]` | One per `style.js` loaded: `{ map, styleName, dir, background, arrowDir, arrowStep, arrowSize, showInformations, informationsDir, informations, linesDir, LINES, TILES, LEGS }`. `informations`: the picture files of `informationsDir`; `LINES[i] = [line in lower case, its badge file in linesDir]` (a page cannot list a folder, so it takes the file names from here). `TILES`: the tiles `"<col>_<row>"` of `dir/tiles/` (a missing one is plain `background`); `LEGS[l]`: the tiles of `dir/legs/<l>/`, each as `b_` (ahead) and `g_` (driven). Arrow for heading h: `arrowDir + "arrow_rotation_" + pad3(round(h / arrowStep) * arrowStep) + ".png"`. |

What a screen does when it loads:

1. Take the hof name from `omsi.vehicle.info.yard`.
2. Find it in `EKRANG_HOFS`, compared trimmed and without letter case. Not found: no GPS.
3. Take that map from `EKRANG_MAPS`.
4. Take this screen's style for that map from `EKRANG_STYLES`.
5. If there is none, use the style of that map whose `styleName` contains a word of the
   screen's folder name (words split on `_`), otherwise the first in alphabetical order.
