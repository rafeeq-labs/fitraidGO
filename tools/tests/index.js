// Entry point so `node --test tools/tests/` works on Node builds whose test runner resolves a
// directory argument as a module rather than searching it. `npm test` uses the glob form
// (tools/tests/*.test.mjs), which does not match this file, so tests are never registered twice.

import './mercator.test.mjs';
import './ribbon.test.mjs';
import './roadGraph.test.mjs';
import './triangulate.test.mjs';
import './plots.test.mjs';
import './build-tile.test.mjs';
import './tile-integrity.test.mjs';
