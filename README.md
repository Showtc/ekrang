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
| hof name | The `[name]` written inside a `.hof` file, **not** its file name. `CREA_St-Servan_DEVIATION.hof` has the name `St-Servan - Deviation - AgoProjects`. |
| tile | One square PNG of the GPS map, `t_<col>_<row>.png`. |
| leg | The part of an itinerary from one stop to the next, drawn over the tiles. |
| style | One set of generated GPS pictures (`tiles_style_<n>`) or arrows (`style_<n>`). |

# Folder structure

```
ekrang
├── scripts                          generators (map, styles, arrows)
├── maps
│   ├── hofs-folders.json            hof name → map folder (see below)
│   ├── hofs-folders.js              generated copy of it, for the pages
│   ├── arrows                       bus marker, shared by every map
│   │   ├── style_1
│   │   │   ├── arrow_rotation_000.png
│   │   │   ├── ...                  one every 2°
│   │   │   └── arrow_rotation_358.png
│   │   └── style_2
│   │       └── ...
│   ├── st_servan
│   │   ├── info.txt                 the tiles' grid (generated)
│   │   ├── map.js                   trips, routes, stops (generated)
│   │   ├── routes.json              what map.js is written from (generated)
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
    │       │   ├── hofs                  the .hof files this screen supports on the map
    │       │   │   ├── St-Servan.hof
    │       │   │   └── ...
    │       │   ├── map-information.json  input of the map generator
    │       │   ├── style.json            input of the style generator, read by the screen
    │       │   ├── style.js              generated copy of style.json, for the pages
    │       │   ├── arrow.png             source of the arrow style
    │       │   └── stop_marker.png       stop marker drawn on the tiles
    │       └── grand_paris_moulon
    │           └── ...
    └── ineo
        └── ...
```

Generated files (`info.txt`, `map.js`, `routes.json`, `*.js` copies of JSON files, everything
in `src/gps` and `arrows`) are never edited by hand: change the inputs and generate again.

# What the pages can and cannot do

The pages run in openOMSI's built-in HTML engine, not in a browser. The full list of what it
supports is in `Vehicles\PDO_C2\resources\HTML_CSS_REFERENCE.md`. What matters for ekrang:

- **No file reading at runtime.** There is no `fetch`, no `XMLHttpRequest` and no `JSON`
  object. `<script src>` and `<link rel="stylesheet" href>` are pasted into the page once, when
  it loads. So:
  - every JSON file a page needs has a generated `.js` copy that sets a global variable
    (`hofs-folders.js` sets `EKRANG_HOFS`, `style.js` pushes into `EKRANG_STYLES`);
  - a page cannot choose at runtime which `map.js` to load: it includes every map's `map.js`
    with `<script src>`, and each one pushes itself into `EKRANG_MAPS`.
- **Paths** in `src` / `href` are counted from the page's own folder (then the model folder,
  then the bus folder). From `screens/<screen>/`, the maps are at `../../maps/`. In JavaScript
  write paths with `/`, never `\` (`\` starts an escape in a string).
- **CSS:** block flow and `inline-block` only. No flexbox, no `transform` / rotation, no
  `@font-face`, no `letter-spacing` effect, no `opacity`, no `transition`. That is why the GPS
  pictures (stop names, icons, rotations) are drawn by the generators, not by the page.

# Configuration files

## `maps/hofs-folders.json`

Says which map folder each hof name belongs to. It is the first thing a screen uses (through
`hofs-folders.js`).

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

A hof name must appear in one map only. A bus whose hof name is in no map shows no GPS.

## `map-information.json` (map generator input)

```json
{
  "mapDirectory": "st_servan",
  "mapFolder": "D:/Program Files/Steam/steamapps/common/OMSI 2/maps/St-Servan/",
  "hofs": ["St-Servan", "CREA_St-Servan", "CREA_St-Servan_12", "CREA_St-Servan_DEV", "St-Servan - Deviation - AgoProjects"]
}
```

| Key | Type | Meaning |
|-----|------|---------|
| `mapDirectory` | string | Output folder in `maps/`. |
| `mapFolder` | string | Absolute path of the OMSI 2 map (`/` separators). |
| `hofs` | string[] | Hof names supported. |

The generator reads the `.hof` files of the `hofs` folder next to this file and keeps the ones
whose `[name]` is in `hofs`. At least one must be found, otherwise it stops with an error.
`.hof` files can be Windows-1252, UTF-8 or UTF-16 (the HOF Suite writes UTF-16): read them by
their byte order mark.

It writes `maps/<mapDirectory>/info.txt`, `map.js` and `routes.json`, and adds the map's hof
names to `maps/hofs-folders.json`.

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
    "stopsLabel": "#0066ff"
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
    "font": "C:/Windows/Fonts/Inter-Bold.ttf",
    "size": "12px",
    "rotation": 0,
    "lineHeight": "100%",
    "letterSpacing": "0px",
    "gapFromMarker": "15px"
  },
  "stopMarker": "stop_marker.png",
  "arrow": "arrow.png",
  "showInformations": true,
  "positionsIconsStops": ["connectionsStopLinesIcon", "stopsIcons"]
}
```

Sizes are strings in `px`. Colours are `#rrggbb`. `position` is one of `top`, `right`,
`bottom`, `left`. Everything except `styleInformation` and `showInformations` is drawn into
the pictures by the generator: changing it needs a new generation.

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
| `route` | The route still ahead (`b_*.png`) and the ring of its stops. |
| `driven` | The part already driven (`g_*.png`) and the ring of its stops. |
| `stopsLabel` | Stop names. |

### `stopsIcons` — pictograms next to a stop name

| Key | Type | Meaning |
|-----|------|---------|
| `stopsIconsInformations` | bool | Draw these icons or not. |
| `stops` | object | Stop name → one file name or a list of file names in `maps/<map>/src/assets/pictograms`. Stop names are those of `map.js`, compared without letter case. Can be empty. |
| `iconSizeWidth`, `iconSizeHeight` | px | Size of one icon. |
| `gapFromStopName` | px | Gap between the stop name and the icons. |
| `gapIcons` | px | Gap between two icons of a row. |
| `maxInLine` | int | Icons in a row before starting a new row. |
| `gapLines` | px | Gap between two rows. |
| `position` | side | Side of the stop name the icons go. |

### `connectionsStopLinesIcon` — connecting line badges next to a stop name

Same keys as `stopsIcons`, with `show` (bool) instead of `stopsIconsInformations` and no
`stops`. The badges are `maps/<map>/src/assets/lines/<line>.png`, for the other lines that
serve the stop.

### `texts` — stop names on the map

| Key | Meaning |
|-----|---------|
| `font` | Absolute path of a `.ttf` / `.otf` file. |
| `size` | Font size (px). |
| `rotation` | Rotation of the text, in degrees. |
| `lineHeight` | Line height in %, as in Figma. |
| `letterSpacing` | Space between letters (px). |
| `gapFromMarker` | Gap between the stop marker and the text (px). |

### Other keys

| Key | Meaning |
|-----|---------|
| `stopMarker` | File name of the stop marker, next to `style.json`. |
| `arrow` | File name of the arrow picture, next to `style.json`. The generator turns it into `maps/arrows/<arrowStyle>/arrow_rotation_000.png … 358.png`. |
| `showInformations` | Show the pictures of `maps/<map>/src/assets/informations` (read by the screen at runtime). |
| `positionsIconsStops` | When `stopsIcons` and `connectionsStopLinesIcon` have the same `position`, their order from the stop name outwards: index 0 is closest to the name. Values: `"stopsIcons"`, `"connectionsStopLinesIcon"`. |

# Generation

1. **Map**: from `map-information.json`, write `maps/<map>/info.txt`, `map.js`, `routes.json`
   and update `maps/hofs-folders.json` / `hofs-folders.js`.
2. **Styles**: for each `style.json`, draw `maps/<map>/src/gps/<styleName>/tiles` and `legs`,
   draw `maps/arrows/<arrowStyle>` from `arrow`, and write `style.js`.

Generating a style needs its map generated first. Generating again replaces the output folder.

# In game

What a screen does when it loads:

1. Take the hof name from `omsi.vehicle.info.yard`.
2. Find it in `EKRANG_HOFS` (from `hofs-folders.js`). Not found: no GPS.
3. Take that map from `EKRANG_MAPS` (from the `map.js` files).
4. Take this screen's style for that map from `EKRANG_STYLES` (from its `style.js`):
   - arrow pictures from `maps/arrows/<arrowStyle>/`;
   - tiles and legs from `maps/<map>/src/gps/<styleName>/`.
5. If `styleName` does not exist for that map, use the folder of `maps/<map>/src/gps/` whose
   name contains a word of the screen's folder name (words split on `_`), otherwise the first
   folder in alphabetical order.
