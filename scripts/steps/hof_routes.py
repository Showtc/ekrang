"""The IBIS routes of a bus's depot files (.hof) as itineraries on a map, the way a GPS
finds one: each stop placed on the map by its name (mapstops' stops.json), then the shortest
way along the roads (the map export's road centre lines) from each stop to the next.

Writes the same trip records as fetch_routes.py (name, line, terminus, stops, route,
stop_at), in metres from the export's origin.

python hof_routes.py <map.json> <stops.json> <out.json> <depot file.hof> [<depot file.hof> ...]
"""
import heapq
import json
import math
import os
import sys

from omsi_text import lines_of

map_json, stops_json, out_path = sys.argv[1:4]
hof_files = sys.argv[4:]
m = json.load(open(map_json, encoding='utf-8'))
ox, oy = m['origin']

# ---- the road graph: every point of every road a node, merged where roads meet ----
MERGE = 1.5     # points this close are one node (m)
JOIN = 8.0      # a road's end this close to another road's point is joined to it (m)
pts = []        # node -> (x, y)
grid = {}       # merge cell -> [node]
adj = []        # node -> [(node, length)]


def cell(x, y, size):
    return (int(math.floor(x / size)), int(math.floor(y / size)))


def node_at(x, y):
    cx, cy = cell(x, y, MERGE)
    for gx in (cx - 1, cx, cx + 1):
        for gy in (cy - 1, cy, cy + 1):
            for n in grid.get((gx, gy), ()):
                if math.hypot(pts[n][0] - x, pts[n][1] - y) <= MERGE:
                    return n
    pts.append((x, y))
    adj.append([])
    grid.setdefault((cx, cy), []).append(len(pts) - 1)
    return len(pts) - 1


def link(a, b):
    if a != b:
        d = math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
        adj[a].append((b, d))
        adj[b].append((a, d))


ends = []
for r in m['roads']:
    p = r['p']
    nodes = [node_at(p[i], p[i + 1]) for i in range(0, len(p) - 1, 2)]
    for a, b in zip(nodes, nodes[1:]):
        link(a, b)
    if nodes:
        ends += [nodes[0], nodes[-1]]

# a road that ends on another one's side (a T junction) has no point in common with it
coarse = {}
for n, (x, y) in enumerate(pts):
    coarse.setdefault(cell(x, y, JOIN), []).append(n)


def nearest(x, y, radius, skip=(), only=None):
    best, bd = None, radius
    cx, cy = cell(x, y, JOIN)
    reach = int(math.ceil(radius / JOIN))
    for gx in range(cx - reach, cx + reach + 1):
        for gy in range(cy - reach, cy + reach + 1):
            for n in coarse.get((gx, gy), ()):
                if n in skip or (only is not None and comp[n] != only):
                    continue
                d = math.hypot(pts[n][0] - x, pts[n][1] - y)
                if d < bd:
                    best, bd = n, d
    return best


for e in set(ends):
    own = {e} | {b for b, _ in adj[e]}
    n = nearest(pts[e][0], pts[e][1], JOIN, own)
    if n is not None:
        link(e, n)
# the connected pieces of the network: a stop is put on the biggest one, not on a scrap of
# road (a car park, a yard) that leads nowhere
comp = [-1] * len(pts)
sizes = []
for start in range(len(pts)):
    if comp[start] >= 0:
        continue
    comp[start] = len(sizes)
    stack, size = [start], 0
    while stack:
        n = stack.pop()
        size += 1
        for k, _ in adj[n]:
            if comp[k] < 0:
                comp[k] = comp[start]
                stack.append(k)
    sizes.append(size)
main = max(range(len(sizes)), key=lambda c: sizes[c])
print('road graph: %d nodes, %d pieces, the biggest %d nodes' % (len(pts), len(sizes), sizes[main]), flush=True)


def shortest(a, b):
    """The nodes of the shortest way from a to b (A*), or None."""
    tx, ty = pts[b]
    h = lambda n: math.hypot(pts[n][0] - tx, pts[n][1] - ty)
    dist = {a: 0.0}
    prev = {}
    todo = [(h(a), a)]
    while todo:
        _, n = heapq.heappop(todo)
        if n == b:
            way = [b]
            while way[-1] != a:
                way.append(prev[way[-1]])
            return way[::-1]
        for k, d in adj[n]:
            nd = dist[n] + d
            if nd < dist.get(k, math.inf):
                dist[k] = nd
                prev[k] = n
                heapq.heappush(todo, (nd + h(k), k))
    return None


# ---- the stops of the map by name (several objects: both sides of a street) ----
def key_of(s):
    """A stop name compared loosely: letter case, '-' and '_' as spaces, runs of spaces."""
    return ' '.join(s.lower().replace('-', ' ').replace('_', ' ').split())


places = {}
names = {}
for s in json.load(open(stops_json, encoding='utf-8')):
    k = key_of(s['name'])
    places.setdefault(k, []).append((s['x'] - ox, s['y'] - oy))
    names.setdefault(k, s['name'].strip())


def place_of(stop):
    """The map's stop a depot file's stop names: its name, or a name inside it. Some depot
    files list announcement idents (`14_PA_Chateau`, `A_14_Dep_Orsay-Ville Gare_EDF Campus`):
    the run of its '_' parts that is a stop's name, the earliest (then the longest) one.
    Gives the key of the map's stop, or None."""
    k = key_of(stop)
    if k in places:
        return k
    parts = [p for p in stop.split('_') if p.strip()]
    for i in range(len(parts)):
        for j in range(len(parts), i, -1):
            k = key_of(' '.join(parts[i:j]))
            if k in places:
                return k
    return None



def hof_trips(path):
    """(name, line, [stop names as the page gets them]) of a depot file: the trips' stop lists
    name a [busstop] by its ident (before any '#'), whose first string is the name shown."""
    ls = lines_of(path)
    shown = {}
    trips = []
    i = 0
    while i < len(ls):
        tag = ls[i].strip()
        if tag == '[busstop]' and i + 2 < len(ls):
            ident = ls[i + 1].strip()
            shown.setdefault(ident.lower(), ls[i + 2].strip() or ident)
        elif tag == '[infosystem_trip]' and i + 4 < len(ls):
            trips.append([ls[i + 2].strip(), ls[i + 4].strip(), []])
        elif tag == '[infosystem_busstop_list]' and trips and i + 1 < len(ls):
            try:
                n = int(ls[i + 1].strip())
            except ValueError:
                n = 0
            trips[-1][2] = [s.split('#')[0].strip() for s in ls[i + 2:i + 2 + n]]
        i += 1
    for t in trips:
        t[2] = [shown.get(s.lower(), s) for s in t[2]]
    return trips


out = []
seen = set()
for path in hof_files:
    for name, line, stops in hof_trips(path):
        # (the same stops in another depot file: the same itinerary)
        key = (line.lower(), tuple(s.lower() for s in stops))
        if key in seen:
            continue
        seen.add(key)
        keys = [place_of(s) for s in stops]
        found = [(k, places[p]) for k, p in enumerate(keys) if p]
        if len(found) < 2 or len(found) * 2 < len(stops):
            continue
        # the stop object of each name nearest the previous stop (the first: nearest the next)
        chosen = []
        for j, (k, cands) in enumerate(found):
            ref = chosen[-1][1] if chosen else found[1][1][0]
            chosen.append((k, min(cands, key=lambda c: math.hypot(c[0] - ref[0], c[1] - ref[1]))))
        route = []
        for (_, a), (_, b) in zip(chosen, chosen[1:]):
            na, nb = nearest(a[0], a[1], 80.0, only=main), nearest(b[0], b[1], 80.0, only=main)
            way = shortest(na, nb) if na is not None and nb is not None else None
            # (one entry per pair of placed stops, empty where no way was found: route[j] runs
            # from the j-th placed stop to the next)
            route.append([round(c, 1) for n in way for c in pts[n]] if way else [])
        out.append({'name': 'HOF %s: %s' % (os.path.basename(path)[:-4], name), 'line': line, 'terminus': '',
                    'stops': stops, 'route': route,
                    # (the names drawn on the map: the map's own where one was found)
                    'labels': [names[p] if p else s for p, s in zip(keys, stops)],
                    'stop_at': {str(k): [round(c[0], 1), round(c[1], 1)] for k, c in chosen}})
        print('%-60s line %-4s %2d of %2d stops on the map, %d of %d legs routed' % (
            out[-1]['name'][:60], line, len(chosen), len(stops), sum(1 for r in route if r), len(chosen) - 1), flush=True)

json.dump({'origin': [ox, oy], 'trips': out}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
print('wrote %d IBIS routes' % len(out))
