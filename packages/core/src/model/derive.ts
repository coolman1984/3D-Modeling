import type { Polygon } from '../geometry/polygon.js';
import { clearanceEllipse, clearanceRectangle, doorSwingPolygon, ellipse, rectangle, type Footprint } from '../geometry/shapes.js';
import type { Door, ItemDefinition, ItemInstance, Size3 } from './types.js';

/**
 * The item's size as placed: width and depth on the floor (before its Z rotation) and height.
 * An item lying on its side swaps its height with the axis that now points up.
 */
export function placedSize(item: ItemInstance, definition: ItemDefinition): Size3 {
  const { w, d, h } = definition.size;
  if (item.tilt === 'x') return { w: h, d, h: w };
  if (item.tilt === 'y') return { w, d: h, h: d };
  return definition.size;
}

export function footprintOf(item: ItemInstance, definition: ItemDefinition): Footprint {
  const size = placedSize(item, definition);
  return { center: item.position, width: size.w, depth: size.d, rotation: item.rotation };
}

/** The floor area the item physically occupies. */
export function itemPolygon(item: ItemInstance, definition: ItemDefinition): Polygon {
  const footprint = footprintOf(item, definition);
  return definition.footprint === 'round' ? ellipse(footprint) : rectangle(footprint);
}

/** The item plus the free space it needs around it to be usable. */
export function itemClearancePolygon(item: ItemInstance, definition: ItemDefinition): Polygon {
  const footprint = footprintOf(item, definition);
  return definition.footprint === 'round'
    ? clearanceEllipse(footprint, definition.clearance)
    : clearanceRectangle(footprint, definition.clearance);
}

export function doorPolygon(door: Door): Polygon {
  return doorSwingPolygon(door);
}
