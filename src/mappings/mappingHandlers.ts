import { SubstrateEvent, SubstrateBlock } from '@subql/types'
import { PalletStakingStakingLedger } from '@polkadot/types/lookup'
import { stakingCurrency, liquidCurrency } from '../constants'
import { Ledger, Position } from '../types'
import { BN } from '@polkadot/util'
import { AccountId } from '@polkadot/types/interfaces'
import { Rate, Balance, CurrencyId } from '@parallel-finance/types/interfaces'
import {
  updateMetadataTotalStakersAndStakingAction,
  updateMetadataTotalLocked,
  updateStakingAction,
  updateBlockMetadatas
} from '../handlers'
import { createAddress } from '../utils'

export async function handleBlock(block: SubstrateBlock): Promise<void> {
  await updateBlockMetadatas(block)
}

export async function handleStakeEvent(event: SubstrateEvent) {
  await updateMetadataTotalStakersAndStakingAction(event)
}

export async function handleUnstakeEvent(event: SubstrateEvent) {
  await updateStakingAction(event)
}

export async function handleUpdateLedger(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash
  const derivativeIndex = event.event.data[0]
  const stakingLedger = event.event.data[1] as PalletStakingStakingLedger
  let ledgerRecord = await Ledger.get(derivativeIndex.toString())

  if (!ledgerRecord) {
    ledgerRecord = new Ledger(derivativeIndex.toString())
  }

  ledgerRecord.active = stakingLedger.active.toString()
  ledgerRecord.total = stakingLedger.total.toString()
  ledgerRecord.unlocking = stakingLedger.unlocking.map((item) => ({
    era: item.era.toNumber(),
    value: item.value.toString()
  }))
  ledgerRecord.assetId = stakingCurrency.toNumber()

  await ledgerRecord.save()
  await updateMetadataTotalLocked(blockHash)
}

export async function handleSTokenIssued(event: SubstrateEvent) {
  const assetId = event.event.data[0] as CurrencyId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const id = event.event.data[1].toString()
  const amount = event.event.data[2] as Balance
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate

  let position = await Position.get(id)
  if (!position)
    return await Position.create({
      id,
      earned: '0',
      avgExchangeRate: exchangeRate.toString(),
      balance: amount.toString()
    })

  const newBalance = new BN(position.balance).sub(amount.toBn())
  const newAvgExchangeRate = new BN(position.avgExchangeRate)
    .mul(new BN(position.balance))
    .add(amount.toBn().mul(exchangeRate.toBn()))
    .div(newBalance)

  position.balance = newBalance.toString()
  position.avgExchangeRate = newAvgExchangeRate.toString()

  await position.save()
}

export async function handleSTokenBurned(event: SubstrateEvent) {
  const assetId = event.event.data[0] as CurrencyId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const id = event.event.data[1].toString()
  const amount = event.event.data[2] as Balance
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate

  let position = await Position.get(id.toString())
  if (!position) return

  const newBalance = new BN(position.balance).sub(amount.toBn())
  const newEarned = new BN(position.earned).add(
    exchangeRate.toBn().sub(new BN(position.avgExchangeRate)).mul(amount.toBn())
  )

  position.balance = newBalance.toString()
  position.earned = newEarned.toString()

  await position.save()
}

export async function handleSTokenTransferred(event: SubstrateEvent) {
  const assetId = event.event.data[0] as CurrencyId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const from = event.event.data[1].toString()
  const to = event.event.data[2].toString()
  const amount = event.event.data[3] as Balance
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  const loansAddress = createAddress('par/loan')
  const ammAddress = createAddress('par/ammp')

  // TODO: handle this
  if (
    from == loansAddress ||
    to == loansAddress ||
    from == ammAddress ||
    to == ammAddress
  ) {
    return
  }

  const fromPosition = await Position.get(from)
  if (!fromPosition) return
  const toPosition = await Position.get(to)
  if (!toPosition) {
    await Position.create({
      id: to,
      earned: '0',
      avgExchangeRate: exchangeRate.toString(),
      balance: amount.toString()
    })
  } else {
    const newBalance = new BN(toPosition.balance).add(amount.toBn())
    toPosition.avgExchangeRate = new BN(toPosition.avgExchangeRate)
      .mul(new BN(toPosition.balance))
      .add(amount.toBn().mul(exchangeRate.toBn()))
      .div(newBalance)
      .toString()
    toPosition.balance = newBalance.toString()
  }

  const newEarned = new BN(fromPosition.earned).add(
    exchangeRate
      .toBn()
      .sub(new BN(fromPosition.avgExchangeRate))
      .mul(amount.toBn())
  )
  const newBalance = new BN(fromPosition.balance).sub(amount.toBn())

  fromPosition.balance = newBalance.toString()
  fromPosition.earned = newEarned.toString()

  await toPosition.save()
  await fromPosition.save()
}
