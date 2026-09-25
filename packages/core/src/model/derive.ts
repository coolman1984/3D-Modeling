import type { Polygon } from '../geometry/polygon.js';
import { clearanceEllipse, clearanceRectangle, doorSwingPolygon, ellipse, rectangle, type Footprint } from '../geometry/shapes.js';
import type { Door, ItemDefinition, ItemInstance } from './types.js';

export function footprintOf(item: ItemInstance, definition: ItemDefinition): Footprint {
  return { center: item.position, width: definition.size.w, depth: definition.size.d, rotation: item.rotation };
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
