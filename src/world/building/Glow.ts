import { UV } from '../KitPieces.js';
import { ACCENT_V } from '../KitTypes.js';

/** Shared by the crystal lamps in a yard and the braziers on a civic hall, so it sits on its own. */

/** Tags glow geometry as cold crystal rather than warm window gold; see ACCENT_V in KitTypes. */
export const CRYSTAL_GLOW = { uvScale: UV.glow, ao: 1, uvOffset: [0, ACCENT_V] as [number, number] };
