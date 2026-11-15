/**
 * Arena layout selection. Obstacle geometry lives in `SpawnLogic` (it needs the arena maths);
 * this module only picks a layout from the `maps.json` table and cycles through it.
 */
import { MAPS, type GameMap, type MapsData } from '../config';

/** The map with this id, falling back to the configured default and then the first layout. */
export function getMap(id: string, data: MapsData = MAPS): GameMap {
  const found = data.maps.find((map) => map.id === id);
  if (found) return found;
  return data.maps.find((map) => map.id === data.defaultMap) ?? data.maps[0];
}

/** Next/previous layout in table order, wrapping at both ends. */
export function cycleMap(id: string, direction: 1 | -1, data: MapsData = MAPS): GameMap {
  const count = data.maps.length;
  if (count === 0) return getMap(id, data);
  const current = data.maps.findIndex((map) => map.id === id);
  const index = current < 0 ? 0 : current;
  return data.maps[(((index + direction) % count) + count) % count];
}
