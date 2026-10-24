//! The drawing steps of ekrang's generator (scripts/generate.py runs them):
//!
//! render grid  <map.json> <info.txt> <metres per pixel> <tile size>
//!     The tiles' grid of a map: the picture covers every road with a margin, its corners
//!     on whole tiles. Writes info.txt (X0, Y1, MPP, TILE, COLS, ROWS). The same for every
//!     style of the map.
//! render plan  <routes_all.json> <info.txt> <out routes.json> <out plan.json>
//!     Every trip cut into legs, one per stop (the way from the stop before, and the stop).
//!     Legs alike in several trips are kept once. routes.json: trips [name, line, terminus,
//!     stops, route] and routes[r] = [[leg, stop index], ...]; plan.json: each leg's way,
//!     stop, name and line in picture pixels, for `legs`.
//! render tiles <map.json> <info.txt> <out dir> <background> <road> <main road> <vegetation> <water>
//!     The map tiles t_<col>_<row>.png in those colours (#rrggbb). A tile that is plain
//!     background is left out.
//! render legs  <plan.json> <draw.json> <info.txt> <out dir>
//!     Every leg as transparent tiles over the map tiles, ahead (b_<col>_<row>.png) and
//!     driven (g_<col>_<row>.png), in out dir/<leg>/. draw.json is the style (see
//!     generate.py, draw_settings).

use ab_glyph::{Font, FontRef, PxScale, ScaleFont, VariableFont};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path as FsPath;
use tiny_skia::*;

type Pt = (f32, f32);

// the itinerary's line and the stop disc drawn when the style has no stop marker picture
const ROUTE_W: f32 = 7.0;
const STOP_R: f32 = 8.0;
const STOP_RING: f32 = 3.5;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("grid") => grid(&a[2], &a[3], a[4].parse().unwrap(), a[5].parse().unwrap()),
        Some("plan") => plan(&a[2], &a[3], &a[4], &a[5]),
        Some("tiles") => tiles(&a[2], &a[3], &a[4], [&a[5], &a[6], &a[7], &a[8], &a[9]]),
        Some("legs") => legs(&a[2], &a[3], &a[4], &a[5]),
        _ => {
            eprintln!("render grid|plan|tiles|legs ... (see the top of src/main.rs)");
            std::process::exit(2);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

fn read_json(path: &str) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn nums(v: &Value) -> Vec<f64> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default()
}

/// `#rrggbb` (or `rrggbb`) as 0xrrggbb.
fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim().trim_start_matches('#'), 16).unwrap_or_else(|_| panic!("not a colour: {s}"))
}

fn rgb(c: u32) -> (u8, u8, u8) {
    ((c >> 16 & 255) as u8, (c >> 8 & 255) as u8, (c & 255) as u8)
}

fn paint(c: u32) -> Paint<'static> {
    let (r, g, b) = rgb(c);
    let mut p = Paint::default();
    p.set_color_rgba8(r, g, b, 255);
    p.anti_alias = true;
    p
}

fn stroke(width: f32) -> Stroke {
    Stroke { width, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Default::default() }
}

/// The tiles' grid (info.txt).
struct Grid {
    x0: f64,
    y1: f64,
    mpp: f64,
    tile: u32,
    cols: u32,
    rows: u32,
}

impl Grid {
    fn load(path: &str) -> Grid {
        let mut v: HashMap<String, f64> = HashMap::new();
        for l in std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}")).lines() {
            if let Some((k, x)) = l.split_once('=') {
                v.insert(k.trim().to_string(), x.trim().parse().unwrap());
            }
        }
        Grid { x0: v["X0"], y1: v["Y1"], mpp: v["MPP"], tile: v["TILE"] as u32, cols: v["COLS"] as u32, rows: v["ROWS"] as u32 }
    }

    /// Export metres (from the export's origin `o`) to picture pixels.
    fn px(&self, o: &[f64], rx: f64, ry: f64) -> Pt {
        (((rx + o[0] - self.x0) / self.mpp) as f32, ((self.y1 - (ry + o[1])) / self.mpp) as f32)
    }
}

// ---------------------------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------------------------

fn grid(map_json: &str, info_path: &str, mpp: f64, tile: u32) {
    let d = read_json(map_json);
    let o = nums(&d["origin"]);
    // Some maps have stray points hundreds of kilometres away: only the points within the
    // export's own 1 - 99 % box of the roads (`lo`, `hi`), widened by a quarter of its size
    // on each side, count.
    let (blo, bhi) = (nums(&d["lo"]), nums(&d["hi"]));
    let window = |q: &[f64]| {
        if blo.len() < 2 || bhi.len() < 2 {
            return true;
        }
        (0..2).all(|k| {
            let pad = (bhi[k] - blo[k]) * 0.25;
            q[k] >= blo[k] - pad && q[k] <= bhi[k] + pad
        })
    };
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for r in d["roads"].as_array().expect("map.json has no roads") {
        for q in nums(&r["p"]).chunks_exact(2) {
            if !window(q) {
                continue;
            }
            for k in 0..2 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
    }
    let margin = 300.0;
    let span = tile as f64 * mpp;
    let x0 = ((lo[0] + o[0] - margin) / span).floor() * span;
    let y1 = ((hi[1] + o[1] + margin) / span).ceil() * span;
    let cols = (((hi[0] + o[0] + margin) - x0) / span).ceil() as u32;
    let rows = ((y1 - (lo[1] + o[1] - margin)) / span).ceil() as u32;
    let info = format!("X0 = {x0}\nY1 = {y1}\nMPP = {mpp}\nTILE = {tile}\nCOLS = {cols}\nROWS = {rows}\n");
    std::fs::write(info_path, &info).unwrap();
    eprintln!("grid: {cols} x {rows} tiles of {tile} px, {mpp} m/px");
}

// ---------------------------------------------------------------------------------------------
// tiles
// ---------------------------------------------------------------------------------------------

/// Triangles (flat x,y lists) as one path, all turned the same way so overlaps never cancel.
fn triangles(g: &Grid, o: &[f64], flat: &[f64]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for t in flat.chunks_exact(6) {
        let (a, mut b, mut c) = (g.px(o, t[0], t[1]), g.px(o, t[2], t[3]), g.px(o, t[4], t[5]));
        if (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0) < 0.0 {
            std::mem::swap(&mut b, &mut c);
        }
        pb.move_to(a.0, a.1);
        pb.line_to(b.0, b.1);
        pb.line_to(c.0, c.1);
        pb.close();
    }
    pb.finish()
}

fn polyline(pts: impl Iterator<Item = Pt>) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for (i, (x, y)) in pts.enumerate() {
        if i == 0 {
            pb.move_to(x, y)
        } else {
            pb.line_to(x, y)
        }
    }
    pb.finish()
}

fn tiles(map_json: &str, info_path: &str, out: &str, colours: [&str; 5]) {
    let [background, road, main_road, vegetation, water] = colours.map(hex);
    // the export's land classes: plain ground, forest, field, paved land, sand, water
    let land_classes = [background, vegetation, vegetation, background, background, water];
    let d = read_json(map_json);
    let o = nums(&d["origin"]);
    let g = Grid::load(info_path);
    let out = FsPath::new(out);
    std::fs::create_dir_all(out).unwrap();
    let (w, h) = (g.cols * g.tile, g.rows * g.tile);
    let mut pm = Pixmap::new(w, h).unwrap();
    let (r, gr, b) = rgb(background);
    pm.fill(Color::from_rgba8(r, gr, b, 255));
    let id = Transform::identity();

    let layers = &d["layers"];
    if layers.is_object() {
        for (k, list) in layers["land"].as_array().unwrap().iter().enumerate() {
            let c = land_classes[k.min(5)];
            if c == background {
                continue;
            }
            if let Some(p) = triangles(&g, &o, &nums(list)) {
                pm.fill_path(&p, &paint(c), FillRule::Winding, id, None);
            }
        }
        // the carriageways' own surface (pavements and yards stay background)
        if let Some(p) = layers["paved"].as_array().unwrap().first().and_then(|l| triangles(&g, &o, &nums(l))) {
            pm.fill_path(&p, &paint(road), FillRule::Winding, id, None);
        }
    }

    // Roads: every lane in the road colour, then the main roads' lanes over them, a little
    // wider so that the road colour between their lanes does not show.
    let mut main = Vec::new();
    for rd in d["roads"].as_array().unwrap() {
        let p = nums(&rd["p"]);
        let Some(path) = polyline(p.chunks_exact(2).map(|q| g.px(&o, q[0], q[1]))) else { continue };
        let wpx = ((rd["w"].as_f64().unwrap_or(6.0) / g.mpp) as f32).max(2.5);
        pm.stroke_path(&path, &paint(road), &stroke(wpx), id, None);
        if rd["main"].as_bool() == Some(true) {
            main.push((path, wpx));
        }
    }
    for (path, wpx) in &main {
        pm.stroke_path(path, &paint(main_road), &stroke(wpx + 3.0), id, None);
    }

    let bg = Color::from_rgba8(r, gr, b, 255).premultiply().to_color_u8();
    let (mut written, mut bytes) = (0, 0u64);
    for row in 0..g.rows {
        for col in 0..g.cols {
            let t = pm.clone_rect(IntRect::from_xywh((col * g.tile) as i32, (row * g.tile) as i32, g.tile, g.tile).unwrap()).unwrap();
            if t.pixels().iter().all(|p| *p == bg) {
                continue;
            }
            let png = t.encode_png().unwrap();
            bytes += png.len() as u64;
            std::fs::write(out.join(format!("t_{col}_{row}.png")), png).unwrap();
            written += 1;
        }
    }
    eprintln!("tiles: {written} written ({:.1} MB)", bytes as f64 / 1e6);
}

// ---------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------

/// One leg: the way to a stop (pixel polylines, maybe none), the stop, its name and the
/// line of the trip (its connections leave this line out).
struct Leg {
    lines: Vec<Vec<Pt>>,
    stop: Pt,
    name: String,
    line: String,
}

impl Leg {
    fn key(&self) -> String {
        let r = |p: &Pt| format!("{:.0},{:.0}", p.0 * 2.0, p.1 * 2.0);
        let l: Vec<String> = self.lines.iter().map(|l| l.iter().map(r).collect::<Vec<_>>().join(";")).collect();
        format!("{}|{}|{}|{}", r(&self.stop), self.name, self.line, l.join("/"))
    }
}

fn dist_to(l: &[Pt], p: Pt) -> f32 {
    l.iter().map(|q| (q.0 - p.0).hypot(q.1 - p.1)).fold(f32::MAX, f32::min)
}

// A stop is drawn on its route, at the line's point nearest to it (the bus stop object stands
// beside the road, the route follows the road's middle), when that point is this near (m).
const SNAP_M: f32 = 50.0;

/// The point of the polylines nearest to p, and how far it is.
fn nearest_on(lines: &[&Vec<Pt>], p: Pt) -> Option<(Pt, f32)> {
    let mut best: Option<(Pt, f32)> = None;
    for l in lines {
        for s in l.windows(2) {
            let (a, b) = (s[0], s[1]);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
            let q = (a.0 + t * dx, a.1 + t * dy);
            let d = (q.0 - p.0).hypot(q.1 - p.1);
            if best.map_or(true, |b| d < b.1) {
                best = Some((q, d));
            }
        }
    }
    best
}

/// A timetable route (its road pieces in driving order) cut at its stops: the piece nearest
/// each stop, searched onwards from the previous one, ends the leg to that stop. The pieces
/// before the first stop go with it; those after the last stop with the last leg.
fn split(pieces: &[Vec<Pt>], stops: &[(usize, Pt)], px_per_m: f32) -> Vec<Vec<Vec<Pt>>> {
    let near = 35.0 * px_per_m;
    let mut out = Vec::new();
    if pieces.is_empty() {
        return out;
    }
    let mut cur = 0;
    for (j, (_, at)) in stops.iter().enumerate() {
        if cur >= pieces.len() {
            out.push(Vec::new());
            continue;
        }
        if j + 1 == stops.len() {
            out.push(pieces[cur..].to_vec());
            break;
        }
        let d: Vec<f32> = pieces[cur..].iter().map(|l| dist_to(l, *at)).collect();
        let end = match d.iter().position(|x| *x < near) {
            Some(mut i) => {
                while i + 1 < d.len() && d[i + 1] < d[i] {
                    i += 1;
                }
                cur + i
            }
            None => cur + d.iter().enumerate().fold((0, f32::MAX), |b, (i, x)| if *x < b.1 { (i, *x) } else { b }).0,
        };
        let end = end.min(pieces.len() - 1);
        out.push(if cur > end { Vec::new() } else { pieces[cur..=end].to_vec() });
        cur = end + 1;
    }
    out
}

fn plan(routes_all: &str, info_path: &str, routes_out: &str, plan_out: &str) {
    let d = read_json(routes_all);
    let g = Grid::load(info_path);
    let o = nums(&d["origin"]);
    let px = |q: &[f64]| g.px(&o, q[0], q[1]);

    let mut leg_ids: HashMap<String, usize> = HashMap::new();
    let mut legs: Vec<Leg> = Vec::new();
    let mut routes: Vec<Vec<[usize; 2]>> = Vec::new();
    let mut route_ids: HashMap<String, usize> = HashMap::new();
    let mut trips_out = Vec::new();
    for t in d["trips"].as_array().unwrap() {
        let names: Vec<String> = t["stops"].as_array().unwrap().iter().map(|s| s.as_str().unwrap_or("").to_string()).collect();
        let line = t["line"].as_str().unwrap_or("").to_string();
        let mut placed: Vec<(usize, Pt)> = t["stop_at"].as_object().unwrap().iter().map(|(k, v)| (k.parse().unwrap(), px(&nums(v)))).collect();
        placed.sort_by_key(|p| p.0);
        let pieces: Vec<Vec<Pt>> = t["route"].as_array().unwrap().iter().map(|l| nums(l).chunks_exact(2).map(px).collect()).collect();
        let ways: Vec<Vec<Vec<Pt>>> = if t["hof"].as_bool() == Some(true) {
            // (an IBIS route is stop to stop already: way j runs from placed stop j to j + 1)
            std::iter::once(Vec::new()).chain(pieces.iter().map(|l| if l.len() >= 2 { vec![l.clone()] } else { Vec::new() })).collect()
        } else {
            split(&pieces, &placed, (1.0 / g.mpp) as f32)
        };
        let mut route = Vec::new();
        for (j, (k, at)) in placed.iter().enumerate() {
            // (the name drawn: the trip's `labels` when it has them - an IBIS route whose stops
            // are announcement idents - else the stop's own)
            let name = t["labels"].get(*k).and_then(Value::as_str).map(str::to_string).or_else(|| names.get(*k).cloned()).unwrap_or_default();
            // (on the line: the way to this stop and the way on from it - the first stop of an
            // IBIS route has only the latter)
            let near: Vec<&Vec<Pt>> = ways.get(j).into_iter().chain(ways.get(j + 1)).flatten().collect();
            let stop = match nearest_on(&near, *at) {
                Some((q, d)) if d <= SNAP_M / g.mpp as f32 => q,
                _ => *at,
            };
            let leg = Leg { lines: ways.get(j).cloned().unwrap_or_default(), stop, name, line: line.clone() };
            let key = leg.key();
            let id = *leg_ids.entry(key).or_insert_with(|| {
                legs.push(leg);
                legs.len() - 1
            });
            route.push([id, *k]);
        }
        let r = *route_ids.entry(format!("{route:?}")).or_insert_with(|| {
            routes.push(route.clone());
            routes.len() - 1
        });
        trips_out.push(json!([t["name"], t["line"], t["terminus"], names, r]));
    }
    std::fs::write(routes_out, json!({ "trips": trips_out, "routes": routes }).to_string()).unwrap();
    let round = |p: &Pt| json!([(p.0 * 10.0).round() / 10.0, (p.1 * 10.0).round() / 10.0]);
    let plan: Vec<Value> = legs
        .iter()
        .map(|l| json!({ "name": l.name, "line": l.line, "stop": round(&l.stop), "ways": l.lines.iter().map(|w| w.iter().map(round).collect::<Vec<_>>()).collect::<Vec<_>>() }))
        .collect();
    std::fs::write(plan_out, json!({ "legs": plan }).to_string()).unwrap();
    eprintln!("plan: {} trips, {} routes, {} legs", trips_out.len(), routes.len(), legs.len());
}

// ---------------------------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------------------------

/// The stop name's look (draw.json `text`).
struct TextStyle<'f> {
    font: FontRef<'f>,
    size: f32,
    line_height: f32,
    letter_spacing: f32,
    colour: u32,
}

impl TextStyle<'_> {
    fn width(&self, s: &str) -> f32 {
        let sf = self.font.as_scaled(PxScale::from(self.size));
        let n = s.chars().count();
        let adv: f32 = s.chars().map(|c| sf.h_advance(sf.glyph_id(c))).sum();
        adv + self.letter_spacing * n.saturating_sub(1) as f32
    }

    /// Draws `s` with its line box's top left at `at` (pixmap pixels), source over.
    fn draw(&self, pm: &mut Pixmap, at: Pt, s: &str) {
        let scale = PxScale::from(self.size);
        let sf = self.font.as_scaled(scale);
        let (asc, desc) = (sf.ascent(), sf.descent());
        let baseline = at.1 + (self.line_height - (asc - desc)) / 2.0 + asc;
        let (w, h) = (pm.width() as i32, pm.height() as i32);
        let (cr, cg, cb) = rgb(self.colour);
        let mut x = at.0;
        let mut prev = None;
        for ch in s.chars() {
            let id = sf.glyph_id(ch);
            if let Some(p) = prev {
                x += sf.kern(p, id);
            }
            let glyph = id.with_scale_and_position(scale, ab_glyph::point(x, baseline));
            x += sf.h_advance(id) + self.letter_spacing;
            prev = Some(id);
            let Some(og) = self.font.outline_glyph(glyph) else { continue };
            let b = og.px_bounds();
            let px = pm.pixels_mut();
            og.draw(|gx, gy, cov| {
                let (ix, iy) = (b.min.x as i32 + gx as i32, b.min.y as i32 + gy as i32);
                if ix < 0 || iy < 0 || ix >= w || iy >= h || cov <= 0.0 {
                    return;
                }
                // (source over, premultiplied)
                let d = &mut px[(iy * w + ix) as usize];
                let a = cov.min(1.0);
                let over = |s: u8, t: u8| (s as f32 * a + t as f32 * (1.0 - a)).round() as u8;
                let out_a = over(255, d.alpha());
                *d = PremultipliedColorU8::from_rgba(over(cr, d.red()).min(out_a), over(cg, d.green()).min(out_a), over(cb, d.blue()).min(out_a), out_a).unwrap();
            });
        }
    }
}

/// Pictures read once.
struct Pictures(HashMap<String, Option<Pixmap>>);

impl Pictures {
    fn get(&mut self, path: &str) -> Option<&Pixmap> {
        self.0
            .entry(path.to_string())
            .or_insert_with(|| match Pixmap::load_png(path) {
                Ok(p) => Some(p),
                Err(e) => {
                    eprintln!("warning: {path}: {e} (left out)");
                    None
                }
            })
            .as_ref()
    }

    /// The picture in shades of grey (its brightness), for the stops already driven.
    fn grey(&mut self, path: &str) -> Option<&Pixmap> {
        let key = format!("{path}\u{0}grey");
        if !self.0.contains_key(&key) {
            let grey = self.get(path).cloned().map(|mut pm| {
                for p in pm.pixels_mut() {
                    // (premultiplied: the weighted sum of r, g, b stays within alpha)
                    let l = (0.299 * p.red() as f32 + 0.587 * p.green() as f32 + 0.114 * p.blue() as f32).round().min(p.alpha() as f32) as u8;
                    *p = PremultipliedColorU8::from_rgba(l, l, l, p.alpha()).unwrap();
                }
                pm
            });
            self.0.insert(key.clone(), grey);
        }
        self.0[&key].as_ref()
    }
}

/// A rectangle of the label (x, y, w, h) and what goes in it.
enum Item {
    Text(String),
    Picture(String),
}

/// The label of a leg: its stop name and icon blocks laid out around it, in the label's own
/// frame (origin: the name's left edge, at the name's vertical middle).
fn layout(leg: &Value, blocks: &[Value], text: &TextStyle) -> Vec<(f32, f32, f32, f32, Item)> {
    let name = leg["name"].as_str().unwrap_or("");
    let (tw, lh) = (text.width(name), text.line_height);
    let mut items = vec![(0.0, -lh / 2.0, tw, lh, Item::Text(name.to_string()))];
    // how far each side is taken already (top and left grow negative)
    let (mut top, mut bottom, mut left, mut right) = (-lh / 2.0, lh / 2.0, 0.0f32, tw);
    for b in blocks {
        // (each icon with its own drawn size: generate.py works out px, % and auto)
        let icons: Vec<(String, f32, f32)> = b["icons"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| Some((v["path"].as_str()?.to_string(), v["w"].as_f64()? as f32, v["h"].as_f64()? as f32)))
            .collect();
        if icons.is_empty() {
            continue;
        }
        let f = |k: &str| b[k].as_f64().unwrap_or(0.0) as f32;
        let (gap, gi, gl) = (f("gapFromStopName"), f("gapIcons"), f("gapLines"));
        let per_row = (b["maxInLine"].as_u64().unwrap_or(1).max(1)) as usize;
        // rows of up to per_row icons: a row as wide as its icons, as high as its highest one
        let rows: Vec<&[(String, f32, f32)]> = icons.chunks(per_row).collect();
        let row_w = |r: &[(String, f32, f32)]| r.iter().map(|i| i.1).sum::<f32>() + gi * (r.len() as f32 - 1.0);
        let row_h = |r: &[(String, f32, f32)]| r.iter().map(|i| i.2).fold(0.0, f32::max);
        let bw = rows.iter().map(|r| row_w(r)).fold(0.0, f32::max);
        let bh = rows.iter().map(|r| row_h(r)).sum::<f32>() + gl * (rows.len() as f32 - 1.0);
        let (bx, by) = match b["position"].as_str().unwrap_or("bottom") {
            "top" => {
                top -= gap + bh;
                (0.0, top)
            }
            "left" => {
                left -= gap + bw;
                (left, -bh / 2.0)
            }
            "right" => {
                let x = right + gap;
                right = x + bw;
                (x, -bh / 2.0)
            }
            _ => {
                let y = bottom + gap;
                bottom = y + bh;
                (0.0, y)
            }
        };
        // (each icon centred in its row's height)
        let mut y = by;
        for r in rows {
            let (mut x, h) = (bx, row_h(r));
            for (path, w, ih) in r {
                items.push((x, y + (h - ih) / 2.0, *w, *ih, Item::Picture(path.clone())));
                x += w + gi;
            }
            y += h + gl;
        }
    }
    items
}

/// The label drawn into its own picture; with where the picture's top left lies in the
/// label's frame.
fn label_sprite(items: &[(f32, f32, f32, f32, Item)], text: &TextStyle, pics: &mut Pictures, grey: bool) -> Option<(Pixmap, Pt)> {
    let (mut lo, mut hi) = ((f32::MAX, f32::MAX), (f32::MIN, f32::MIN));
    for (x, y, w, h, _) in items {
        lo = (lo.0.min(*x), lo.1.min(*y));
        hi = (hi.0.max(x + w), hi.1.max(y + h));
    }
    // (room for glyphs that reach out of their line box, as italics and accents do)
    let pad = text.size * 0.5;
    let lo = ((lo.0 - pad).floor(), (lo.1 - pad).floor());
    let mut pm = Pixmap::new((hi.0 + pad - lo.0).ceil().max(1.0) as u32, (hi.1 + pad - lo.1).ceil().max(1.0) as u32)?;
    for (x, y, w, h, item) in items {
        let at = (x - lo.0, y - lo.1);
        match item {
            Item::Text(s) => text.draw(&mut pm, at, s),
            Item::Picture(p) => {
                let Some(pic) = (if grey { pics.grey(p) } else { pics.get(p) }) else { continue };
                // (on whole pixels: a picture made to its size by generate.py stays sharp)
                let t = Transform::from_row(w / pic.width() as f32, 0.0, 0.0, h / pic.height() as f32, at.0.round(), at.1.round());
                pm.draw_pixmap(0, 0, pic.as_ref(), &PixmapPaint { quality: FilterQuality::Bicubic, ..Default::default() }, t, None);
            }
        }
    }
    Some((pm, lo))
}

fn legs(plan_path: &str, draw_path: &str, info_path: &str, out: &str) {
    let plan = read_json(plan_path);
    let draw = read_json(draw_path);
    let g = Grid::load(info_path);
    let out = FsPath::new(out);
    let t = &draw["text"];
    let font_path = t["font"].as_str().expect("draw.json: text.font");
    let font_data = std::fs::read(font_path).unwrap_or_else(|e| panic!("{font_path}: {e}"));
    let mut font = FontRef::try_from_slice(&font_data).unwrap_or_else(|e| panic!("{font_path}: {e}"));
    if let Some(wght) = t["weight"].as_f64() {
        // (a variable font only; another font keeps its own weight)
        font.set_variation(b"wght", wght as f32);
    }
    let size = t["size"].as_f64().unwrap_or(16.0) as f32;
    let text = TextStyle {
        font,
        size,
        line_height: size * t["lineHeight"].as_f64().unwrap_or(1.2) as f32,
        letter_spacing: t["letterSpacing"].as_f64().unwrap_or(0.0) as f32,
        colour: hex(draw["label"].as_str().unwrap_or("#000000")),
    };
    // the stop names of the stops already driven (g_ tiles): their own colour
    let text_driven = TextStyle {
        font: text.font.clone(),
        colour: draw["labelDriven"].as_str().map(hex).unwrap_or(text.colour),
        ..text
    };
    let rotation = (t["rotation"].as_f64().unwrap_or(0.0) as f32).to_radians();
    let (cos, sin) = (rotation.cos(), rotation.sin());
    let gap_from_marker = t["gapFromMarker"].as_f64().unwrap_or(7.0) as f32;
    let (route, driven) = (hex(draw["route"].as_str().unwrap()), hex(draw["driven"].as_str().unwrap()));
    let mut pics = Pictures(HashMap::new());
    // the stop marker pictures (ahead, and driven: the same when the style has one) and the
    // size each is drawn at
    let mk = &draw["marker"];
    let mut marker_of = |path: &str, w: &str, h: &str| {
        mk[path].as_str().and_then(|p| pics.get(p).cloned()).map(|pic| {
            let w = mk[w].as_f64().map(|v| v as f32).unwrap_or(pic.width() as f32);
            let h = mk[h].as_f64().map(|v| v as f32).unwrap_or(pic.height() as f32);
            (pic, w, h)
        })
    };
    let marker = marker_of("path", "w", "h");
    let marker_driven = marker_of("pathDriven", "wDriven", "hDriven").or_else(|| marker.clone());
    // (the name keeps one place: after the wider of the two)
    let marker_r = match (&marker, &marker_driven) {
        (Some(a), Some(b)) => a.1.max(b.1) / 2.0,
        _ => STOP_R + STOP_RING / 2.0,
    };
    let no_blocks = Vec::new();
    let blocks_of = draw["blocks"].as_array().unwrap_or(&no_blocks);

    let tile = g.tile;
    let ts = tile as f32;
    let mut files = 0;
    for (n, leg) in plan["legs"].as_array().unwrap().iter().enumerate() {
        let stop = { let s = nums(&leg["stop"]); (s[0] as f32, s[1] as f32) };
        let ways: Vec<Vec<Pt>> = leg["ways"].as_array().unwrap().iter().map(|w| w.as_array().unwrap().iter().map(|p| { let p = nums(p); (p[0] as f32, p[1] as f32) }).collect()).collect();
        let mut pb = PathBuilder::new();
        let (mut lo, mut hi) = ((stop.0 - marker_r, stop.1 - marker_r), (stop.0 + marker_r, stop.1 + marker_r));
        for (_, w, h) in marker.iter().chain(marker_driven.iter()) {
            lo = (lo.0.min(stop.0 - w / 2.0), lo.1.min(stop.1 - h / 2.0));
            hi = (hi.0.max(stop.0 + w / 2.0), hi.1.max(stop.1 + h / 2.0));
        }
        for w in &ways {
            for (i, p) in w.iter().enumerate() {
                if i == 0 { pb.move_to(p.0, p.1) } else { pb.line_to(p.0, p.1) }
                lo = (lo.0.min(p.0), lo.1.min(p.1));
                hi = (hi.0.max(p.0), hi.1.max(p.1));
            }
        }
        let path = pb.finish();
        // the label, turned by `rotation` about the stop, its name `gapFromMarker` after the
        // marker: label frame point (x, y) -> picture (stop + R (x + marker_r + gap, y))
        let blocks = blocks_of.get(n).and_then(Value::as_array).unwrap_or(&no_blocks);
        let items = layout(leg, blocks, &text);
        let sprite = label_sprite(&items, &text, &mut pics, false);
        // (the same label for a stop already driven: the name in its driven colour, the
        // pictograms and line badges in grey; the same picture when there are none of either)
        let has_pictures = items.iter().any(|i| matches!(i.4, Item::Picture(_)));
        let sprite_driven = if text_driven.colour == text.colour && !has_pictures { sprite.clone() } else { label_sprite(&items, &text_driven, &mut pics, true) };
        let place = |x: f32, y: f32| {
            let x = x + marker_r + gap_from_marker;
            (stop.0 + cos * x - sin * y, stop.1 + sin * x + cos * y)
        };
        if let Some((s, o)) = &sprite {
            for (x, y) in [(0.0, 0.0), (s.width() as f32, 0.0), (0.0, s.height() as f32), (s.width() as f32, s.height() as f32)] {
                let p = place(o.0 + x, o.1 + y);
                lo = (lo.0.min(p.0), lo.1.min(p.1));
                hi = (hi.0.max(p.0), hi.1.max(p.1));
            }
        }
        let m = ROUTE_W + 4.0;
        let (c0, r0) = (((lo.0 - m) / ts).floor().max(0.0) as u32, ((lo.1 - m) / ts).floor().max(0.0) as u32);
        let (c1, r1) = ((((hi.0 + m) / ts).floor().max(0.0) as u32).min(g.cols - 1), (((hi.1 + m) / ts).floor().max(0.0) as u32).min(g.rows - 1));
        let dir = out.join(n.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        for r in r0..=r1 {
            for c in c0..=c1 {
                let o = (c as f32 * ts, r as f32 * ts);
                let tr = Transform::from_translate(-o.0, -o.1);
                for (prefix, colour, marker, sprite) in [("b", route, &marker, &sprite), ("g", driven, &marker_driven, &sprite_driven)] {
                    let mut pm = Pixmap::new(tile, tile).unwrap();
                    if let Some(p) = &path {
                        pm.stroke_path(p, &paint(colour), &stroke(ROUTE_W), tr, None);
                    }
                    match marker {
                        Some((pic, w, h)) => {
                            let at = (stop.0 - w / 2.0 - o.0, stop.1 - h / 2.0 - o.1);
                            let t = Transform::from_row(w / pic.width() as f32, 0.0, 0.0, h / pic.height() as f32, at.0.round(), at.1.round());
                            pm.draw_pixmap(0, 0, pic.as_ref(), &PixmapPaint { quality: FilterQuality::Bicubic, ..Default::default() }, t, None);
                        }
                        None => {
                            // a white disc ringed in the route's colour
                            if let Some(p) = PathBuilder::from_circle(stop.0, stop.1, STOP_R) {
                                pm.fill_path(&p, &paint(0xffffff), FillRule::Winding, tr, None);
                                pm.stroke_path(&p, &paint(colour), &stroke(STOP_RING), tr, None);
                            }
                        }
                    }
                    if let Some((s, so)) = sprite {
                        let x = so.0 + marker_r + gap_from_marker;
                        let (tx, ty) = (stop.0 + cos * x - sin * so.1 - o.0, stop.1 + sin * x + cos * so.1 - o.1);
                        // (unturned, on whole pixels: drawn as it is, not resampled)
                        let (tx, ty) = if rotation == 0.0 { (tx.round(), ty.round()) } else { (tx, ty) };
                        let st = Transform::from_row(cos, sin, -sin, cos, tx, ty);
                        pm.draw_pixmap(0, 0, s.as_ref(), &PixmapPaint { quality: FilterQuality::Bicubic, ..Default::default() }, st, None);
                    }
                    if pm.pixels().iter().all(|p| p.alpha() == 0) {
                        break;
                    }
                    pm.save_png(dir.join(format!("{prefix}_{c}_{r}.png"))).unwrap();
                    files += 1;
                }
            }
        }
    }
    eprintln!("legs: {} legs, {files} leg tiles", plan["legs"].as_array().unwrap().len());
}
