import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  aabbsWithin,
  area,
  boundsOf,
  clearanceRectangle,
  containsPolygon,
  convexOverlap,
  doorSwingPolygon,
  isConvex,
  isCounterClockwise,
  isSimple,
  locatePoint,
  orientation,
  pointSegmentDistance,
  polygonDistance,
  rectangle,
  rotate,
  segmentSegmentDistance,
  segmentsCrossProperly,
  segmentsIntersect,
  signedArea,
  toCounterClockwise,
  vec,
  type Polygon,
} from '../src/index.js';

const M = 10_000; // ticks per metre

/** Axis-aligned rectangle from corner (x, y) with size w × h. */
function box(x: number, y: number, w: number, h: number): Polygon {
  return [vec(x, y), vec(x + w, y), vec(x + w, y + h), vec(x, y + h)];
}

/** An L-shaped room 10 m × 8 m with the top-right 4 m × 3 m corner cut away. */
const lRoom: Polygon = [vec(0, 0), vec(10 * M, 0), vec(10 * M, 5 * M), vec(6 * M, 5 * M), vec(6 * M, 8 * M), vec(0, 8 * M)];

const coord = fc.integer({ min: -1_000_000, max: 1_000_000 });
const size = fc.integer({ min: 100, max: 50_000 });
const angle = fc.integer({ min: 0, max: 359_999 });
const footprint = fc.record({
  center: fc.record({ x: coord, y: coord }),
  width: size,
  depth: size,
  rotation: angle,
});

describe('vectors', () => {
  it('rotates by exact right angles', () => {
    expect(rotate(vec(10, 0), 90_000)).toEqual(vec(0, 10));
    expect(rotate(vec(10, 0), 180_000)).toEqual(vec(-10, 0));
    expect(rotate(vec(20, 10), 90_000, vec(10, 10))).toEqual(vec(10, 20));
  });
});

describe('segments', () => {
  it('knows turn direction', () => {
    expect(orientation(vec(0, 0), vec(10, 0), vec(10, 10))).toBe(1);
    expect(orientation(vec(0, 0), vec(10, 0), vec(10, -10))).toBe(-1);
    expect(orientation(vec(0, 0), vec(10, 0), vec(20, 0))).toBe(0);
  });

  it('distinguishes proper crossing from touching', () => {
    expect(segmentsCrossProperly(vec(0, 0), vec(10, 10), vec(0, 10), vec(10, 0))).toBe(true);
    expect(segmentsCrossProperly(vec(0, 0), vec(10, 0), vec(10, 0), vec(10, 10))).toBe(false);
    expect(segmentsIntersect(vec(0, 0), vec(10, 0), vec(10, 0), vec(10, 10))).toBe(true);
    expect(segmentsIntersect(vec(0, 0), vec(10, 0), vec(5, 0), vec(20, 0))).toBe(true);
    expect(segmentsIntersect(vec(0, 0), vec(10, 0), vec(11, 0), vec(20, 0))).toBe(false);
  });

  it('measures point and segment distances', () => {
    expect(pointSegmentDistance(vec(5, 5), vec(0, 0), vec(10, 0))).toBe(5);
    expect(pointSegmentDistance(vec(13, 4), vec(0, 0), vec(10, 0))).toBe(5);
    expect(segmentSegmentDistance(vec(0, 0), vec(10, 0), vec(0, 7), vec(10, 7))).toBe(7);
    expect(segmentSegmentDistance(vec(0, 0), vec(10, 10), vec(0, 10), vec(10, 0))).toBe(0);
  });
});

describe('polygon measures', () => {
  it('computes area and orientation', () => {
    expect(signedArea(box(0, 0, 10 * M, 8 * M))).toBe(80 * M * M);
    expect(area(lRoom)).toBe(68 * M * M);
    expect(isCounterClockwise(lRoom)).toBe(true);
    expect(isCounterClockwise([...lRoom].reverse())).toBe(false);
    expect(signedArea(toCounterClockwise([...lRoom].reverse()))).toBe(68 * M * M);
  });

  it('recognises simple polygons', () => {
    expect(isSimple(lRoom)).toBe(true);
    expect(isSimple([vec(0, 0), vec(10, 0)])).toBe(false);
    expect(isSimple([vec(0, 0), vec(10, 0), vec(20, 0)])).toBe(false); // zero area
    expect(isSimple([vec(0, 0), vec(10, 10), vec(10, 0), vec(0, 10)])).toBe(false); // bow-tie
    expect(isSimple([vec(0, 0), vec(10, 0), vec(10, 0), vec(0, 10)])).toBe(false); // repeated vertex
    expect(isSimple([vec(0, 0), vec(20, 0), vec(10, 0), vec(10, 10)])).toBe(false); // folds back
  });

  it('recognises convex polygons', () => {
    expect(isConvex(box(0, 0, 5, 5))).toBe(true);
    expect(isConvex(lRoom)).toBe(false);
  });

  it('computes bounds', () => {
    expect(boundsOf(lRoom)).toEqual({ minX: 0, minY: 0, maxX: 10 * M, maxY: 8 * M });
    expect(aabbsWithin(boundsOf(box(0, 0, 10, 10)), boundsOf(box(10, 0, 10, 10)))).toBe(true);
    expect(aabbsWithin(boundsOf(box(0, 0, 10, 10)), boundsOf(box(15, 0, 10, 10)))).toBe(false);
    expect(aabbsWithin(boundsOf(box(0, 0, 10, 10)), boundsOf(box(15, 0, 10, 10)), 5)).toBe(true);
  });
});

describe('point location', () => {
  it('locates points in a concave room', () => {
    expect(locatePoint(lRoom, vec(2 * M, 2 * M))).toBe('inside');
    expect(locatePoint(lRoom, vec(8 * M, 7 * M))).toBe('outside'); // in the cut-away corner
    expect(locatePoint(lRoom, vec(10 * M, 2 * M))).toBe('boundary');
    expect(locatePoint(lRoom, vec(10 * M + 1, 2 * M))).toBe('boundary'); // within 0.2 mm
    expect(locatePoint(lRoom, vec(10 * M + 3, 2 * M))).toBe('outside');
  });
});

describe('containment', () => {
  it('accepts a table fully inside, including touching a wall', () => {
    expect(containsPolygon(lRoom, box(M, M, 2 * M, M))).toBe(true);
    expect(containsPolygon(lRoom, box(0, 0, 2 * M, M))).toBe(true);
  });

  it('rejects a table sticking into the cut-away corner', () => {
    expect(containsPolygon(lRoom, box(5 * M, 4 * M, 2 * M, 2 * M))).toBe(false);
  });

  it('rejects a shape whose corners are inside but that spans a notch', () => {
    const uRoom: Polygon = [vec(0, 0), vec(30, 0), vec(30, 30), vec(20, 30), vec(20, 10), vec(10, 10), vec(10, 30), vec(0, 30)];
    const bridge = box(5, 20, 20, 5); // corners sit in both arms, middle crosses the notch
    expect(bridge.every((p) => locatePoint(uRoom, p) === 'inside')).toBe(true);
    expect(containsPolygon(uRoom, bridge)).toBe(false);
  });

  it('tolerates rounding at the wall', () => {
    expect(containsPolygon(box(0, 0, 100, 100), box(-1, 0, 50, 50))).toBe(true);
    expect(containsPolygon(box(0, 0, 100, 100), box(-3, 0, 50, 50))).toBe(false);
  });
});

describe('convex overlap (separating axis)', () => {
  it('detects overlap and its depth', () => {
    const result = convexOverlap(box(0, 0, 100, 100), box(80, 10, 100, 50));
    expect(result.overlaps).toBe(true);
    expect(result.depth).toBeCloseTo(20);
  });

  it('treats touching as not overlapping', () => {
    expect(convexOverlap(box(0, 0, 100, 100), box(100, 0, 100, 100)).overlaps).toBe(false);
    expect(convexOverlap(box(0, 0, 100, 100), box(98, 0, 100, 100)).overlaps).toBe(false); // 0.2 mm
    expect(convexOverlap(box(0, 0, 100, 100), box(97, 0, 100, 100)).overlaps).toBe(true);
  });

  it('catches rotated rectangles whose bounding boxes overlap but shapes do not', () => {
    const diamond = rectangle({ center: vec(0, 0), width: 1000, depth: 1000, rotation: 45_000 });
    const nearCorner = box(400, 400, 300, 300);
    expect(aabbsWithin(boundsOf(diamond), boundsOf(nearCorner))).toBe(true);
    expect(convexOverlap(diamond, nearCorner).overlaps).toBe(false);
  });

  it('is symmetric', () => {
    fc.assert(
      fc.property(footprint, footprint, (a, b) => {
        const pa = rectangle(a);
        const pb = rectangle(b);
        expect(convexOverlap(pa, pb).overlaps).toBe(convexOverlap(pb, pa).overlaps);
      }),
    );
  });

  it('agrees with the distance function', () => {
    fc.assert(
      fc.property(footprint, footprint, (a, b) => {
        const pa = rectangle(a);
        const pb = rectangle(b);
        if (convexOverlap(pa, pb).overlaps) expect(polygonDistance(pa, pb)).toBe(0);
        if (polygonDistance(pa, pb) > 0) expect(convexOverlap(pa, pb).overlaps).toBe(false);
      }),
    );
  });
});

describe('distance between shapes', () => {
  it('measures the gap between two tables', () => {
    expect(polygonDistance(box(0, 0, 100, 100), box(150, 0, 100, 100))).toBe(50);
    expect(polygonDistance(box(0, 0, 100, 100), box(150, 0, 100, 100))).toBe(
      polygonDistance(box(150, 0, 100, 100), box(0, 0, 100, 100)),
    );
  });

  it('is zero when one shape contains the other', () => {
    expect(polygonDistance(box(0, 0, 100, 100), box(10, 10, 10, 10))).toBe(0);
  });
});

describe('item rectangles', () => {
  it('places an unrotated table exactly', () => {
    expect(rectangle({ center: vec(1000, 500), width: 2000, depth: 1000, rotation: 0 })).toEqual(box(0, 0, 2000, 1000));
  });

  it('swaps width and depth at 90°', () => {
    const turned = rectangle({ center: vec(0, 0), width: 2000, depth: 1000, rotation: 90_000 });
    expect(boundsOf(turned)).toEqual({ minX: -500, minY: -1000, maxX: 500, maxY: 1000 });
  });

  it('keeps area, convexity and orientation under any rotation', () => {
    fc.assert(
      fc.property(footprint, (f) => {
        const polygon = rectangle(f);
        expect(area(polygon)).toBeCloseTo(f.width * f.depth, 0);
        expect(isConvex(polygon)).toBe(true);
        expect(isCounterClockwise(polygon)).toBe(true);
      }),
    );
  });

  it('adds clearance on the correct sides and turns it with the item', () => {
    const f = { center: vec(0, 0), width: 1000, depth: 500, rotation: 0 };
    const c = { front: 1000, back: 0, left: 200, right: 0 };
    expect(boundsOf(clearanceRectangle(f, c))).toEqual({ minX: -700, minY: -250, maxX: 500, maxY: 1250 });
    // Facing west (+90°): front points to -X, left points to -Y.
    const west = clearanceRectangle({ ...f, rotation: 90_000 }, c);
    expect(boundsOf(west)).toEqual({ minX: -1250, minY: -700, maxX: 250, maxY: 500 });
  });

  it('clearance zone always contains the item', () => {
    const clearance = fc.record({
      front: fc.nat(5000),
      back: fc.nat(5000),
      left: fc.nat(5000),
      right: fc.nat(5000),
    });
    fc.assert(
      fc.property(footprint, clearance, (f, c) => {
        expect(containsPolygon(clearanceRectangle(f, c), rectangle(f), 1)).toBe(true);
      }),
    );
  });
});

describe('door swing', () => {
  const door = { hinge: vec(0, 0), width: 900, angle: 0, swing: 'left' as const };

  it('is a convex counter-clockwise quarter disc', () => {
    const swing = doorSwingPolygon(door);
    expect(isConvex(swing)).toBe(true);
    expect(isCounterClockwise(swing)).toBe(true);
    const quarterDisc = (Math.PI * 900 * 900) / 4;
    expect(area(swing)).toBeGreaterThanOrEqual(quarterDisc);
    expect(area(swing)).toBeLessThan(quarterDisc * 1.02);
  });

  it('covers every point of the true arc', () => {
    const swing = doorSwingPolygon(door);
    for (let deg = 0; deg <= 90; deg += 1) {
      const onArc = rotate(vec(900, 0), deg * 1000);
      expect(locatePoint(swing, onArc)).not.toBe('outside');
    }
  });

  it('opens to the correct side', () => {
    const left = boundsOf(doorSwingPolygon(door));
    expect(left.minY).toBeGreaterThanOrEqual(0);
    const right = doorSwingPolygon({ ...door, swing: 'right' });
    expect(boundsOf(right).maxY).toBeLessThanOrEqual(0);
    expect(isCounterClockwise(right)).toBe(true);
  });

  it('detects a chair inside the swing but not one behind the door', () => {
    const swing = doorSwingPolygon(door);
    expect(convexOverlap(swing, box(300, 300, 400, 400)).overlaps).toBe(true);
    expect(convexOverlap(swing, box(300, -700, 400, 400)).overlaps).toBe(false);
  });
});
