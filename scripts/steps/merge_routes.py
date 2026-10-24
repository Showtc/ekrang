"""The trips the GPS can show: the timetable's trips (place_missing.py's answer) and then the
depot files' IBIS routes (hof_routes.py's), these marked `hof` (their route is stop to stop).

python merge_routes.py <routes_tt_placed.json> <routes_hof.json> <out routes_all.json>
"""
import json
import sys

tt_path, hof_path, out_path = sys.argv[1:4]
tt = json.load(open(tt_path, encoding='utf-8'))
hof = json.load(open(hof_path, encoding='utf-8'))
if tt['origin'] != hof['origin']:
    sys.exit('the two files are not measured from the same origin (not the same map export?)')
for t in hof['trips']:
    t['hof'] = True
out = {'origin': tt['origin'], 'trips': tt['trips'] + hof['trips']}
json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
print('%d timetable trips, %d IBIS routes' % (len(tt['trips']), len(hof['trips'])))
