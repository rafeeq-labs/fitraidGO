import type { FamilyDef } from './FamilyDef.js';
import { civic } from './families/civic.js';
import { merchantL1, merchantL2, merchantL3 } from './families/merchant.js';
import {
  residentialL1,
  residentialL2,
  residentialL3,
} from './families/residential.js';
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
  // Civic ignores the requested level and always builds its one tier. It also offers three variants
  // at every level rather than the kit's 3/4/3, which used to be a name check in variantCount.
  civic: { levels: [civic, civic, civic], singleTier: true, variants: () => 3 },
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
