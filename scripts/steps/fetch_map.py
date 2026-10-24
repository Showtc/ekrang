"""The whole map as openOMSI's launcher service exports it (its `map` command, with the
surface): the roads' centre lines with their width and main-road flag, and the map's layers
(land classes, paved surfaces, houses, rails) in metres from the export's origin.

The layers come from the map cache openOMSI writes the first time it loads the map: drive
the map once in openOMSI before, or `layers` is empty (no vegetation, no water, no road
surfaces; the tiles then only have the roads' lines).

python fetch_map.py <openomsi.exe> <OMSI 2 root> <map folder name> <date> <out map.json>
"""
import json
import subprocess
import sys

exe, root, map_name, date, out_path = sys.argv[1:6]

proc = subprocess.Popen([exe, '--launcher-service', '--root', root], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
req = {'id': 0, 'cmd': 'map', 'map': 'maps/%s/global.cfg' % map_name, 'date': date, 'trip': '', 'surface': True}
proc.stdin.write((json.dumps(req) + '\n').encode())
proc.stdin.flush()
# (an answer: a JSON head line with the body's length, then the body)
head = json.loads(proc.stdout.readline())
body = proc.stdout.read(head['len'])
proc.stdin.write(b'{"id":-1,"cmd":"quit"}\n')
proc.stdin.close()
proc.wait(timeout=30)

d = json.loads(body)
if not d.get('roads'):
    sys.exit('the map export has no roads: is %s right (maps\\%s\\global.cfg)?' % (map_name, map_name))
layers = d.get('layers')
if not isinstance(layers, dict):
    print('warning: the export has no layers (the map is not in openOMSI\'s cache yet: drive it once)')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(body.decode('utf-8'))
print('wrote %s: %d roads, layers %s' % (out_path, len(d['roads']), 'yes' if isinstance(layers, dict) else 'no'))
