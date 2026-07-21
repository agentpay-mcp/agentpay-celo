import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";

export const ASSIGNED_CELO_ATTRIBUTION_TAG_PATTERN = /^celo_[a-z0-9_]{1,27}$/;

const HEX_CALLDATA_PATTERN = /^0x(?:[a-fA-F0-9]{2})*$/;

export function isAssignedCeloAttributionTag(value: string | undefined): value is string {
  return typeof value === "string" && ASSIGNED_CELO_ATTRIBUTION_TAG_PATTERN.test(value);
}

export function assertAssignedCeloAttributionTag(value: string): string {
  if (!isAssignedCeloAttributionTag(value)) {
    throw new Error(
      "Celo attribution tag must be an assigned celo_ code using 6-32 lowercase letters, digits, or underscores.",
    );
  }
  return value;
}

export function appendCeloAttributionTag(calldata: string, assignedTag: string): `0x${string}` {
  if (!HEX_CALLDATA_PATTERN.test(calldata)) {
    throw new Error("Transaction calldata must be an even-length 0x-prefixed hex value.");
  }

  const data = calldata as `0x${string}`;
  if (fromDataSuffix(data) !== null) {
    throw new Error("Transaction calldata already contains an ERC-8021 attribution suffix.");
  }

  const suffix = toDataSuffix(assertAssignedCeloAttributionTag(assignedTag));
  return `${data}${suffix.slice(2)}` as `0x${string}`;
}
