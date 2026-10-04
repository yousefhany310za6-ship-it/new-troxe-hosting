import { geoBounds } from 'd3';
import { feature } from 'topojson-client';
import land110m from 'world-atlas/land-110m.json';

// Land polygons bundled locally (55 kB TopoJSON) so the globe paints on the
// very first frame: no network wait, no empty-circle placeholder, and the
// rotation is visible immediately instead of spinning an invisible blank disc.

// Cache the parsed land data so remounts reuse it.
let landCache = null;

function pointInPolygon([x, y], ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}

function pointInFeature([x, y], geometry) {
    if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates;
        if (!pointInPolygon([x, y], rings[0])) return false;

        for (let i = 1; i < rings.length; i++) {
            if (pointInPolygon([x, y], rings[i])) return false;
        }
        return true;
    }

    if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) {
            if (!pointInPolygon([x, y], polygon[0])) continue;

            let inHole = false;
            for (let i = 1; i < polygon.length; i++) {
                if (pointInPolygon([x, y], polygon[i])) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
    }

    return false;
}

/**
 * Halftone dot field over land. This is the expensive part (a full-world
 * grid of point-in-polygon tests) — callers must run it off the critical
 * path (idle callback) and never during first paint.
 */
export function buildDotField(land, dotSpacing = 16) {
    const dots = [];
    const step = dotSpacing * 0.08;

    for (const feature of land.features) {
        const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(feature);

        for (let lng = minLng; lng <= maxLng; lng += step) {
            for (let lat = minLat; lat <= maxLat; lat += step) {
                if (pointInFeature([lng, lat], feature.geometry)) {
                    dots.push(lng, lat);
                }
            }
        }
    }

    return new Float32Array(dots);
}

export function getLandData(dotSpacing) {
    if (!landCache || landCache.spacing !== dotSpacing) {
        // `land` is a GeometryCollection, so this yields a FeatureCollection.
        const land = feature(land110m, land110m.objects.land);
        landCache = { land, dots: buildDotField(land, dotSpacing), spacing: dotSpacing };
    }

    return landCache;
}
