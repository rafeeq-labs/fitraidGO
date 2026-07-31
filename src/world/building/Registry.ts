import type { FamilyDef } from './FamilyDef.js';
import { apartmentL1, apartmentL2, apartmentL3 } from './families/apartment.js';
import { civic } from './families/civic.js';
import { craftshopL1, craftshopL2, craftshopL3 } from './families/craftshop.js';
import { innL1, innL2, innL3, innLevel0 } from './families/inn.js';
import { merchantL1, merchantL2, merchantL3 } from './families/merchant.js';
import {
  residentialL1,
  residentialL2,
  residentialL3,
} from './families/residential.js';
import {
  townhallL1,
  townhallL2,
  townhallL3,
  townhallLevel0,
} from './families/townhall.js';
import { workshopL1, workshopL2, workshopL3 } from './families/workshop.js';

/**
 * Every building family, as a table.
 *
 * The dispatcher this replaces ended in an unguarded `else` that built a workshop, so adding a
 * member to the family union produced no type error and silently built a smithy instead. Deriving
 * the union FROM this table inverts that: a family name that has no definition is not a name the
 * type system will accept, because the union is literally the table's keys. That is strictly
 * stronger than an exhaustive Record check, which still lets you write the name first and forget
 * the recipe.
 */
export const FAMILIES = {
  residential: { levels: [residentialL1, residentialL2, residentialL3] },
  merchant: { levels: [merchantL1, merchantL2, merchantL3] },
  workshop: { levels: [workshopL1, workshopL2, workshopL3] },
  // --- wave 1: masonry and timber only, so the registry itself is what is under test here ---
  // These four need no new material and no new sub-assembly beyond the mansard roof. If seven
  // families dispatch correctly and the original four still hash identical, the architecture is
  // sound before any risk is taken on thatch, crops, water wheels or rock faces.
  apartment: { levels: [apartmentL1, apartmentL2, apartmentL3] },
  craftshop: { levels: [craftshopL1, craftshopL2, craftshopL3] },
  // The inn is the only family whose empty plot is FURNISHED rather than bare - a fire pit, log
  // seats and a lantern post - which is exactly what `level0` exists to override.
  inn: { levels: [innL1, innL2, innL3], level0: innLevel0 },
  // The town hall's empty plot is a PAVED civic square, not a lawn - the one family whose yard is
  // fully occupied from L0, which is why its ladder leans entirely on height and material.
  townhall: {
    levels: [townhallL1, townhallL2, townhallL3],
    level0: townhallLevel0,
    ground: 'hardstand',
  },

  // Civic ignores the requested level and always builds its one tier. It also offers three variants
  // at every level rather than the kit's 3/4/3, which used to be a name check in variantCount.
  //
  // The gate is the fix for a latent crash. Because civic bypassed level gating entirely, a shallow
  // parcel got the full hall regardless, and its rear wall left the kerb: buildPlotChannels THREW
  // from assertContained on every plot 10 m deep or less. Nothing caught it because the containment
  // checker carried a hard-coded family list that civic was not on. Measured, the hall is contained
  // from 6.25 m of buildable depth and escapes at 5.92, so that is the threshold, and it is repeated
  // across levels 1-3 so the downgrade walk lands on 0 - a parcel that cannot carry the hall stays a
  // surveyed plot rather than getting a squeezed one.
  civic: {
    levels: [civic, civic, civic],
    singleTier: true,
    variants: () => 3,
    gate: { minDepth: [0, 6.25, 6.25, 6.25] },
  },
} satisfies Record<string, FamilyDef>;

export type BuildingFamily = keyof typeof FAMILIES;

/**
 * The enumeration order for every tool that walks the families.
 *
 * Read from the table rather than repeated, because it was repeated in three places - the ladder
 * sheet, the containment checker and the geometry hash - and a family missing from one of them is
 * a family that ships unchecked.
 */
export const BUILDING_FAMILIES = Object.keys(FAMILIES) as readonly BuildingFamily[];

/**
 * The table widened to the interface.
 *
 * `satisfies` deliberately keeps each entry's literal type so the union above can be derived from
 * the keys, but that also means a member which omits `gate` has no `gate` property to read at all.
 * Reading the table through the interface is what makes the optional fields addressable, and it
 * still checks every entry against FamilyDef at the definition site.
 */
const TABLE: Record<BuildingFamily, FamilyDef> = FAMILIES;

export function familyDef(family: BuildingFamily): FamilyDef {
  return TABLE[family];
}
