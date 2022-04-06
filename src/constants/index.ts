import { Vec, u16 } from "@polkadot/types";

export const derivativeIndexList = api.consts.liquidStaking
  .derivativeIndexList as Vec<u16>;

export const stakingCurrency = api.consts.liquidStaking.stakingCurrency;
