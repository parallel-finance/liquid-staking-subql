import { AccountId, AssetId } from '@parallel-finance/types/interfaces'
import { encodeAddress } from '@polkadot/keyring'
import { stringToU8a, bnToU8a, u8aConcat } from '@polkadot/util'
import { blake2AsU8a, decodeAddress } from '@polkadot/util-crypto'

const EMPTY_U8A_32 = new Uint8Array(32)

export const createAddress = (id: string): string =>
  encodeAddress(
    u8aConcat(stringToU8a(`modl${id}`), EMPTY_U8A_32).subarray(0, 32)
  )

export const loansFarmingRewardAccountId = (): string => {
  const entropy = blake2AsU8a(
    u8aConcat(
      stringToU8a('loans/farming'),
      decodeAddress(createAddress('par/loan'))
    ),
    256
  )
  return encodeAddress(entropy)
}

export const farmingPoolAccountId = (assetId: number): string => {
  const entropy = blake2AsU8a(
    u8aConcat(
      stringToU8a('modlpy/liquidity'),
      decodeAddress(createAddress('par/farm')),
      bnToU8a(assetId, 32).reverse()
    ),
    256
  )
  return encodeAddress(entropy)
}

export const toSubstrateAddress = (a: AccountId): string => {
  return encodeAddress(decodeAddress(a.toString(), false), 42)
}
