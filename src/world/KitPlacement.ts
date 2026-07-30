import { getPiece, withTransform, type KitContext, type KitPlacement } from './KitTypes.js';

/**
 * Data-driven placement: looking a piece up by the name a biome kit used, and reading the loose
 * option bag the registry signature carries.
 *
 * The transform push/pop across every channel lives in KitTypes.withTransform; this module is only
 * the name lookup and the option accessors that props and the scatterer share.
 */

export type PieceOptions = Record<string, number | boolean> | undefined;

/** Places a registered piece. False if no piece answers to that name. */
export function placePiece(
  ctx: KitContext,
  name: string,
  at: KitPlacement = {},
  options?: PieceOptions
): boolean {
  const piece = getPiece(name);
  if (!piece) return false;
  withTransform(ctx, () => piece(ctx, options), at);
  return true;
}

export function opt(options: PieceOptions, key: string, fallback: number): number {
  const v = options?.[key];
  return typeof v === 'number' ? v : fallback;
}

export function flag(options: PieceOptions, key: string, fallback: boolean): boolean {
  const v = options?.[key];
  return typeof v === 'boolean' ? v : fallback;
}
