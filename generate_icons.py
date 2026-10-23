"""
generate_icons.py
Generates placeholder PNG icons for QA Cache Cleaner at 16x16, 32x32, 48x48, 128x128.
Uses only the Python standard library (no Pillow required).
Writes valid minimal PNG files with a colored background and 'Q' initial.
"""
import struct
import zlib
import os

def write_png(filepath, size, bg_rgb, text_rgb=(255, 255, 255)):
    """Write a flat-color PNG with a centered cross/Q marker."""
    w = h = size
    # Build raw pixel rows (RGB, no alpha – simpler PNG)
    br, bg_, bb = bg_rgb
    tr, tg, tb  = text_rgb

    def pixel(r, g, b):
        return bytes([r, g, b])

    # Draw a simplified "cache-clear" icon:
    # - Solid background
    # - White border ring (1-2px)
    # - Centered "Q" letter drawn with pixels

    rows = []
    cx = w // 2
    cy = h // 2
    r_outer = (size // 2) - 1
    r_inner = r_outer - max(1, size // 10)

    for y in range(h):
        row = bytearray()
        for x in range(w):
            dx = x - cx
            dy = y - cy
            dist = (dx*dx + dy*dy) ** 0.5

            # Draw circular ring
            if r_inner <= dist <= r_outer:
                row += bytes([tr, tg, tb])
            # Draw small cross inside
            elif abs(dx) <= max(1, size // 16) and abs(dy) <= r_inner * 0.6:
                row += bytes([tr, tg, tb])
            elif abs(dy) <= max(1, size // 16) and abs(dx) <= r_inner * 0.6:
                row += bytes([tr, tg, tb])
            else:
                row += bytes([br, bg_, bb])
        rows.append(row)

    # PNG file structure
    def make_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    # IHDR: width, height, bit depth=8, color type=2 (RGB)
    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT: compress the raw pixel data (with filter byte 0 per row)
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    compressed = zlib.compress(raw, 9)
    idat = make_chunk(b'IDAT', compressed)

    iend = make_chunk(b'IEND', b'')

    png = b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend

    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'wb') as f:
        f.write(png)
    print(f'  Written: {filepath} ({len(png)} bytes)')


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir  = os.path.join(script_dir, 'icons')

    # QA blue: #2563eb → rgb(37, 99, 235)
    BG  = (37, 99, 235)
    FG  = (255, 255, 255)

    sizes = [16, 32, 48, 128]
    print('Generating icons...')
    for sz in sizes:
        out = os.path.join(icons_dir, f'icon{sz}.png')
        write_png(out, sz, BG, FG)
    print('Done.')
