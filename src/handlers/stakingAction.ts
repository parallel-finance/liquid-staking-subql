import { SubstrateEvent } from '@subql/types'
import { stakingCurrency, liquidCurrency } from '../constants'
import { StakingAction } from '../types'

export async function updateStakingAction(event: SubstrateEvent) {
  const [address, amount] = event.event.data.map((v) => v.toString())
  const extrinsicHash = event.extrinsic.extrinsic.hash.toString()
  const id = `${event.idx}-${extrinsicHash}`
  const type = event.event.method
  const timestamp = event.block.timestamp
  const record = StakingAction.create({
    id,
    metadataId: event.block.block.header.hash.toString(),
    blockHeight: event.block.block.header.number.toNumber(),
    address,
    extrinsicHash,
    type,
    amount,
    timestamp,
    assetId:
      type === 'Staked' ? stakingCurrency.toNumber() : liquidCurrency.toNumber()
  })
  await record.save()
}
