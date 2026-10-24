"""Reading OMSI's text files (.hof, .ttp, Busstops.cfg ...): most are Windows-1252, some are
UTF-16 (the HOF Suite writes them so) or UTF-8, told apart by their byte order mark.
"""


def read_text(path):
    b = open(path, 'rb').read()
    if b.startswith(b'\xff\xfe') or b.startswith(b'\xfe\xff'):
        return b.decode('utf-16', errors='replace')
    if b.startswith(b'\xef\xbb\xbf'):
        return b[3:].decode('utf-8', errors='replace')
    return b.decode('cp1252', errors='replace')


def lines_of(path):
    """The file's lines, without their line ends."""
    return read_text(path).splitlines()
