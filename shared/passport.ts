// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Guide lines for passport photos, as horizontal bands measured in mm from
 * the top edge of the picture.
 *
 * DE/EU (35 × 45 mm): face height (chin to top of the head) 32–36 mm, nose on
 * the centre line, see the photo template ("Passbildschablone") of the
 * Bundesdruckerei / Auswärtiges Amt. Rejection limit: below 27 mm or above
 * 40 mm. The eye band follows ICAO 9303 (eyes 50–70 % of the picture height
 * measured from the bottom edge). Check the bands against the current
 * official template before relying on them.
 *
 * US (2 × 2 in): head 1–1 3/8 in (25–35 mm), eye height 1 1/8–1 3/8 in
 * (28–35 mm) from the bottom edge (U.S. Department of State).
 */

export interface GuideBand {
  key: 'crown' | 'eyes' | 'chin';
  /** from the top edge, mm */
  top: number;
  bottom: number;
}

export interface PassportGuides {
  widthMm: number;
  heightMm: number;
  bands: GuideBand[];
  /** vertical centre line */
  centerLine: boolean;
}

export function passportGuides(kind: 'eu' | 'us'): PassportGuides {
  if (kind === 'us') {
    const h = 50.8;
    return {
      widthMm: 50.8,
      heightMm: h,
      centerLine: true,
      bands: [
        { key: 'eyes', top: h - 34.925, bottom: h - 28.575 },
        // chin at about 1/8 in above the bottom edge region, head 25–35 mm above it
        { key: 'chin', top: h - 9, bottom: h - 6 },
        { key: 'crown', top: h - 9 - 35, bottom: h - 6 - 25 },
      ],
    };
  }
  const h = 45;
  return {
    widthMm: 35,
    heightMm: h,
    centerLine: true,
    bands: [
      // chin about 4–5 mm above the bottom edge; with a 32–36 mm face the crown lands 4–9 mm below the top
      { key: 'chin', top: 40, bottom: 41 },
      { key: 'crown', top: 4, bottom: 9 },
      { key: 'eyes', top: h - 0.7 * h, bottom: h - 0.5 * h },
    ],
  };
}
