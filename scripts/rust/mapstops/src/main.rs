//! Every bus stop object of a map, as the game finds them on the tiles: an object whose
//! `.sco` has `[busstop]`, named by its first label. Prints JSON: [{id, name, x, y}] in world
//! metres (x east, y north).
//!
//! mapstops <OMSI 2 root> <map folder name>

use std::collections::HashMap;
use std::path::Path;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let root = Path::new(&a[1]);
    let map_dir = root.join("maps").join(&a[2]);
    let global = omsi_map::GlobalCfg::load(&map_dir.join("global.cfg")).expect("global.cfg");
    omsi_map::configure_grid(&global);
    let mut is_stop: HashMap<String, bool> = HashMap::new();
    let mut out = Vec::new();
    for t in &global.tiles {
        let Ok(tile) = omsi_map::tile::Tile::load(&map_dir.join(&t.file)) else { continue };
        for o in &tile.objects {
            let stop = *is_stop.entry(o.file.to_lowercase()).or_insert_with(|| {
                let p = root.join(o.file.replace(char::from(92), "/"));
                std::fs::read(&p)
                    .map(|b| String::from_utf8_lossy(&b).lines().any(|l| l.trim().eq_ignore_ascii_case("[busstop]")))
                    .unwrap_or(false)
            });
            let name = o.extra.first().map(|s| s.trim().to_string()).unwrap_or_default();
            if stop && !name.is_empty() {
                let (x, y) = omsi_map::tile_local_to_world(t.x, t.y, o.pos[0], o.pos[1]);
                out.push(serde_json::json!({ "id": o.id, "name": name, "x": x, "y": y }));
            }
        }
    }
    eprintln!("{} bus stops on {} tiles", out.len(), global.tiles.len());
    println!("{}", serde_json::Value::Array(out));
}
