export interface ModelIdentity {
  vendor: string;
  family: string;
  id: string;
}

export function compareModelIdentity(left: ModelIdentity, right: ModelIdentity): number {
  const vendor = left.vendor.localeCompare(right.vendor);
  if (vendor !== 0) {
    return vendor;
  }
  const family = left.family.localeCompare(right.family);
  if (family !== 0) {
    return family;
  }
  return left.id.localeCompare(right.id);
}

export function pickDeterministicIdentity<T extends ModelIdentity>(models: readonly T[]): T | undefined {
  if (models.length === 0) {
    return undefined;
  }
  return [...models].sort(compareModelIdentity)[0];
}
