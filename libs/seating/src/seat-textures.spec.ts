import { getSeatTextureKind } from './seat-textures';

describe('getSeatTextureKind priority order', () => {
  it('prioritizes unsellable over all other properties', () => {
    // Unsellable beats accessibility and view obstruction
    expect(getSeatTextureKind('Wheelchair', 'Severe', false)).toBe('unsellable');
    expect(getSeatTextureKind('Companion', 'Partial', false)).toBe('unsellable');
    expect(getSeatTextureKind('ReducedMobility', 'None', false)).toBe('unsellable');
    expect(getSeatTextureKind('None', 'Severe', false)).toBe('unsellable');
    expect(getSeatTextureKind(null, null, false)).toBe('unsellable');
  });

  it('prioritizes accessibility over view obstruction when sellable', () => {
    expect(getSeatTextureKind('Wheelchair', 'Severe', true)).toBe('wheelchair');
    expect(getSeatTextureKind('Wheelchair', 'Partial', null)).toBe('wheelchair');
    expect(getSeatTextureKind('Companion', 'Severe', true)).toBe('companion');
    expect(getSeatTextureKind('ReducedMobility', 'Severe', true)).toBe('reducedMobility');
  });

  it('resolves accessibility kinds correctly', () => {
    expect(getSeatTextureKind('Wheelchair', null, true)).toBe('wheelchair');
    expect(getSeatTextureKind('Companion', null, true)).toBe('companion');
    expect(getSeatTextureKind('ReducedMobility', null, true)).toBe('reducedMobility');
  });

  it('resolves view obstruction kinds when accessibility is None or absent', () => {
    expect(getSeatTextureKind('None', 'Severe', true)).toBe('obstructedSevere');
    expect(getSeatTextureKind(null, 'Severe', true)).toBe('obstructedSevere');
    expect(getSeatTextureKind(undefined, 'Severe', undefined)).toBe('obstructedSevere');

    expect(getSeatTextureKind('None', 'Partial', true)).toBe('obstructedPartial');
    expect(getSeatTextureKind(null, 'Partial', true)).toBe('obstructedPartial');
    expect(getSeatTextureKind(undefined, 'Partial', undefined)).toBe('obstructedPartial');
  });

  it('defaults to regular when no special properties apply', () => {
    expect(getSeatTextureKind(null, null, null)).toBe('regular');
    expect(getSeatTextureKind(undefined, undefined, undefined)).toBe('regular');
    expect(getSeatTextureKind('None', 'None', true)).toBe('regular');
  });

  it('prioritizes the sales status over every geometry property, sold beating held', () => {
    expect(getSeatTextureKind('Wheelchair', 'Severe', true, 'Sold')).toBe('sold');
    expect(getSeatTextureKind('Wheelchair', 'Severe', true, 'Held')).toBe('held');
    expect(getSeatTextureKind('Wheelchair', 'Severe', true, 'NotForSale')).toBe('unsellable');
  });

  it('lets an available sales status fall through to the usual geometry-based texture', () => {
    expect(getSeatTextureKind('Wheelchair', 'Severe', true, 'Available')).toBe('wheelchair');
    expect(getSeatTextureKind(null, null, true, 'Available')).toBe('regular');
    expect(getSeatTextureKind(null, null, true, null)).toBe('regular');
    expect(getSeatTextureKind(null, null, true, undefined)).toBe('regular');
  });
});
