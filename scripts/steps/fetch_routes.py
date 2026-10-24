"""Every timetable trip of a map with its line, terminus, stop names (as the game names them,
from Busstops.cfg) and its route and stop places as openOMSI's launcher service reads them.

python fetch_routes.py <openomsi.exe> <OMSI 2 root> <map folder name> <date> <out.json>
"""
import json
import os
import subprocess
import sys

from omsi_text import lines_of

exe, root, map_name, date, out_path = sys.argv[1:6]
tt = os.path.join(root, 'maps', map_name, 'TTData')




# object id -> stop name
names = {}
ls = lines_of(os.path.join(tt, 'Busstops.cfg'))
for i, l in enumerate(ls):
    if l.strip() == '[busstop]' and i + 3 < len(ls):
        try:
            names[int(ls[i + 3].strip())] = ls[i + 1].strip()
        except ValueError:
            pass

trips = []
for fn in sorted(os.listdir(tt)):
    if not fn.lower().endswith('.ttp'):
        continue
    ls = lines_of(os.path.join(tt, fn))
    terminus = line = ''
    # (object id, the name the trip file gives it): the game takes Busstops.cfg's name and,
    # for an object not in it, the old [station] block's own (omsi-sim station_name)
    stations = []
    for i, l in enumerate(ls):
        s = l.strip()
        if s == '[trip]' and i + 3 < len(ls):
            terminus, line = ls[i + 2].strip(), ls[i + 3].strip()
        elif s in ('[station_typ2]', '[station]') and i + 1 < len(ls):
            try:
                own = ls[i + 3].strip() if s == '[station]' and i + 3 < len(ls) else ''
                stations.append((int(ls[i + 1].strip()), own))
            except ValueError:
                pass
    if len(stations) >= 2:
        trips.append({'name': fn[:-4], 'line': line, 'terminus': terminus,
                      'stops': [names.get(x) or own for x, own in stations]})

proc = subprocess.Popen([exe, '--launcher-service', '--root', root], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
origin = None
for n, t in enumerate(trips):
    req = {'id': n, 'cmd': 'map', 'map': 'maps/%s/global.cfg' % map_name, 'date': date,
           'trip': t['name'], 'surface': False}
    proc.stdin.write((json.dumps(req) + '\n').encode())
    proc.stdin.flush()
    head = json.loads(proc.stdout.readline())
    body = proc.stdout.read(head['len'])
    d = json.loads(body)
    origin = d['origin']
    t['route'] = d['route']
    t['stop_at'] = {str(s['k']): s['at'] for s in d['stops']}
    print('%3d/%d %-32s %4d lane pieces, %2d of %2d stops placed' % (
        n + 1, len(trips), t['name'], len(t['route']), len(t['stop_at']), len(t['stops'])), flush=True)
proc.stdin.write(b'{"id":-1,"cmd":"quit"}\n')
proc.stdin.close()
proc.wait(timeout=30)

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({'origin': origin, 'trips': trips}, f, ensure_ascii=False)
print('wrote', out_path)
