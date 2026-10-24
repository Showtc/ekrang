"""Places the stops of the timetable trips that the map export could not place: a stop whose
object is not on the map (the timetable names an id no tile has).

- A bus stop object of the same name near the route (mapstops' stops.json): that one.
- Else a point on the route between the placed stops before and after it, as far along as the
  timetable's station links (StnLinks.cfg lengths) say, or halfway without them.

python place_missing.py <routes_tt.json> <stops.json> <map folder> <out.json>
"""
import json
import math
import os
import sys

from omsi_text import lines_of

routes_path, stops_path, map_dir, out_path = sys.argv[1:5]
d = json.load(open(routes_path, encoding='utf-8'))
ox, oy = d['origin']
tt = os.path.join(map_dir, 'TTData')




# station link lengths: (from id, to id) -> metres
links = {}
ls = lines_of(os.path.join(tt, 'StnLinks.cfg'))
for i, l in enumerate(ls):
    if l.strip() == '[StnLink]' and i + 3 < len(ls):
        try:
            links[(int(ls[i + 2]), int(ls[i + 3]))] = float(ls[i + 1])
        except ValueError:
            pass

by_name = {}
for s in json.load(open(stops_path, encoding='utf-8')):
    by_name.setdefault(s['name'].strip().lower(), []).append((s['x'] - ox, s['y'] - oy))


def station_ids(trip_name):
    ids = []
    ls = lines_of(os.path.join(tt, trip_name + '.ttp'))
    for i, l in enumerate(ls):
        if l.strip() in ('[station_typ2]', '[station]') and i + 1 < len(ls):
            try:
                ids.append(int(ls[i + 1].strip()))
            except ValueError:
                pass
    return ids


by_name_count = along_count = 0
for t in d['trips']:
    if not t['route']:
        continue
    # the route as one line, and how far along each of its points lies
    line = [(p[i], p[i + 1]) for p in t['route'] for i in range(0, len(p) - 1, 2)]
    run = [0.0]
    for a, b in zip(line, line[1:]):
        run.append(run[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))

    def along(at, start):
        """The point of the route nearest `at`, from point `start` on: its index."""
        best, bd = start, math.inf
        for i in range(start, len(line)):
            dd = math.hypot(line[i][0] - at[0], line[i][1] - at[1])
            if dd < bd:
                best, bd = i, dd
            elif bd < 40 and dd > bd + 200:
                break
        return best

    def to_route(at):
        return min(math.hypot(q[0] - at[0], q[1] - at[1]) for q in line)

    # same-named stop objects first
    for k, name in enumerate(t['stops']):
        if str(k) in t['stop_at']:
            continue
        cands = [c for c in by_name.get(name.strip().lower(), []) if to_route(c) < 120]
        if cands:
            t['stop_at'][str(k)] = list(min(cands, key=to_route))
            by_name_count += 1

    # then the rest along the route, between the placed stops around them
    ids = station_ids(t['name'])
    n = len(t['stops'])
    placed = sorted(int(k) for k in t['stop_at'])
    pos = {}
    start = 0
    for k in placed:
        pos[k] = along(t['stop_at'][str(k)], start)
        start = pos[k]
    for k in range(n):
        if k in pos:
            continue
        before = max([p for p in placed if p < k], default=None)
        after = min([p for p in placed if p > k], default=None)
        if before is None or after is None:
            continue
        # the share of the way from `before` to `after` that lies before stop k
        legs = [links.get((ids[j], ids[j + 1])) if j + 1 < len(ids) else None for j in range(before, after)]
        if all(l is not None for l in legs) and sum(legs) > 0:
            share = sum(legs[:k - before]) / sum(legs)
        else:
            share = (k - before) / (after - before)
        target = run[pos[before]] + share * (run[pos[after]] - run[pos[before]])
        i = pos[before]
        while i + 1 < len(run) and run[i + 1] < target:
            i += 1
        t['stop_at'][str(k)] = [round(line[i][0], 1), round(line[i][1], 1)]
        along_count += 1

json.dump(d, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
left = sum(1 for t in d['trips'] for k in range(len(t['stops'])) if str(k) not in t['stop_at'])
print('placed %d by name, %d along the route; %d still without a place' % (by_name_count, along_count, left))
