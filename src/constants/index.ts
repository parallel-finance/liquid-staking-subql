import { Vec, u16, u32 } from '@polkadot/types'

export const derivativeIndexList = api.consts.liquidStaking
  .derivativeIndexList as Vec<u16>

export const stakingCurrency = api.consts.liquidStaking.stakingCurrency as u32

export const liquidCurrency = api.consts.liquidStaking.liquidCurrency as u32

export const nativeCurrency = api.consts.currencyAdapter
  .getNativeCurrencyId as u32
