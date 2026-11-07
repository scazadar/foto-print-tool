#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Fotodruck contributors
#
# Wraps one HEVC frame into a minimal HEIF/HEIC file (test fixture):
#   ffmpeg -f lavfi -i testsrc2=size=640x480 -frames:v 1 -pix_fmt yuv420p -c:v libx265 -x265-params keyint=1 -f hevc frame.hevc
#   python3 make-heic.py frame.hevc sample.heic 640 480

import struct, sys

data = open(sys.argv[1], 'rb').read()
W, H = int(sys.argv[3]), int(sys.argv[4])

# split Annex B stream into NAL units
nals, i = [], 0
starts = []
while True:
    j = data.find(b'\x00\x00\x01', i)
    if j < 0: break
    starts.append(j + 3); i = j + 3
for k, s in enumerate(starts):
    e = (starts[k + 1] - 3) if k + 1 < len(starts) else len(data)
    nal = data[s:e]
    while nal.endswith(b'\x00'): nal = nal[:-1]
    nals.append(nal)
typ = lambda n: (n[0] >> 1) & 0x3f
vps = [n for n in nals if typ(n) == 32]; sps = [n for n in nals if typ(n) == 33]; pps = [n for n in nals if typ(n) == 34]
slices = [n for n in nals if typ(n) < 32]
assert vps and sps and pps and slices, [typ(n) for n in nals]

def rbsp(n):
    out, z = bytearray(), 0
    for b in n:
        if z >= 2 and b == 3: z = 0; continue
        out.append(b); z = z + 1 if b == 0 else 0
    return bytes(out)
r = rbsp(sps[0])[2:]  # skip NAL header
ptl = r[1:13]         # after vps id / max_sub_layers / nesting byte

def box(t, payload): return struct.pack('>I', 8 + len(payload)) + t + payload
def fullbox(t, v, f, payload): return box(t, struct.pack('>I', (v << 24) | f) + payload)

hvcc = bytes([1]) + ptl[0:1] + ptl[1:5] + ptl[5:11] + ptl[11:12]
hvcc += struct.pack('>H', 0xF000) + bytes([0xFC, 0xFD, 0xF8, 0xF8]) + struct.pack('>H', 0) + bytes([0x0F])
arrays = [(32, vps[0]), (33, sps[0]), (34, pps[0])]
hvcc += bytes([len(arrays)])
for t, n in arrays:
    hvcc += bytes([0x80 | t]) + struct.pack('>H', 1) + struct.pack('>H', len(n)) + n

mdat_payload = b''.join(struct.pack('>I', len(n)) + n for n in slices)

ftyp = box(b'ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heic')
hdlr = fullbox(b'hdlr', 0, 0, struct.pack('>I', 0) + b'pict' + b'\x00' * 12 + b'\x00')
pitm = fullbox(b'pitm', 0, 0, struct.pack('>H', 1))
infe = fullbox(b'infe', 2, 0, struct.pack('>HH', 1, 0) + b'hvc1' + b'\x00')
iinf = fullbox(b'iinf', 0, 0, struct.pack('>H', 1) + infe)
ipco = box(b'ipco', box(b'hvcC', hvcc) + fullbox(b'ispe', 0, 0, struct.pack('>II', W, H)))
ipma = fullbox(b'ipma', 0, 0, struct.pack('>I', 1) + struct.pack('>HB', 1, 2) + bytes([0x81, 0x02]))
iprp = box(b'iprp', ipco + ipma)

def build(offset):
    iloc = fullbox(b'iloc', 0, 0, bytes([0x44, 0x00]) + struct.pack('>H', 1) + struct.pack('>HHH', 1, 0, 1) + struct.pack('>II', offset, len(mdat_payload)))
    meta = fullbox(b'meta', 0, 0, hdlr + pitm + iloc + iinf + iprp)
    return ftyp + meta
head = build(0)
head = build(len(head) + 8)
open(sys.argv[2], 'wb').write(head + box(b'mdat', mdat_payload))
print('ok', len(head) + 8 + len(mdat_payload))
