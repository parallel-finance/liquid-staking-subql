import { SubstrateEvent, SubstrateBlock } from '@subql/types'
import { PalletStakingStakingLedger } from '@polkadot/types/lookup'
import { stakingCurrency, liquidCurrency } from '../constants'
import { Ledger, StakingPosition, FarmingPosition } from '../types'
import { BN } from '@polkadot/util'
import { AccountId } from '@polkadot/types/interfaces'
import { Rate, Balance, AssetId } from '@parallel-finance/types/interfaces'
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
  // TODO: ignore crosschain for now, then this happens
  // only when users stake
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const account = event.event.data[1] as AccountId
  const amount = event.event.data[2] as Balance

  await handleBuyOrder(account, amount, true)
}

async function handleBuyOrder(
  account: AccountId,
  amount: Balance,
  fromStake: boolean = false
) {
  if (amount.eq(new BN(0))) {
    return
  }
  const id = account.toString()
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  let position = await StakingPosition.get(id)
  if (!position) {
    position = StakingPosition.create({
      id,
      totalStaked: '0',
      totalEarned: '0',
      avgExchangeRate: '1000000000000000000',
      balance: '0'
    })
  }

  const newBalance = new BN(position.balance).add(amount.toBn())
  position.balance = newBalance.toString()

  if (fromStake) {
    const newAvgExchangeRate = new BN(position.avgExchangeRate)
      .mul(new BN(position.balance))
      .add(amount.toBn().mul(exchangeRate.toBn()))
      .div(newBalance)
    position.totalStaked = new BN(position.totalStaked)
      .add(amount.toBn())
      .toString()
    position.avgExchangeRate = newAvgExchangeRate.toString()
  }

  await position.save()
}

export async function handleSTokenBurned(event: SubstrateEvent) {
  // TODO: ignore crosschain for now, then this happens
  // only when users unstake
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const account = event.event.data[1] as AccountId
  const amount = event.event.data[2] as Balance

  await handleSellOrder(account, amount, true)
}

async function handleSellOrder(
  account: AccountId,
  amount: Balance,
  fromUnstake: boolean = false
) {
  const id = account.toString()
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  let position = await StakingPosition.get(id.toString())
  if (!position || amount.eq(new BN(0))) return

  const diff = new BN(position.balance).gt(amount.toBn())
    ? amount.toBn()
    : new BN(position.balance)

  position.balance = new BN(position.balance).sub(diff).toString()
  if (fromUnstake) {
    const newTotalEarned = exchangeRate
      .toBn()
      .sub(new BN(position.avgExchangeRate))
      .mul(diff)
      .div(new BN(1e18))
      .add(new BN(position.totalEarned))
    position.totalEarned = newTotalEarned.toString()
  }

  await position.save()
}

export async function handleSTokenTransferred(event: SubstrateEvent) {
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const from = event.event.data[1] as AccountId
  const to = event.event.data[2] as AccountId
  const amount = event.event.data[3] as Balance
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  const loansAddress = createAddress('par/loan')
  const ammAddress = createAddress('par/ammp')

  if (
    from.toString() == loansAddress ||
    to.toString() == loansAddress ||
    from.toString() == ammAddress ||
    to.toString() == ammAddress
  ) {
    return
  }

  await handleSellOrder(from, amount)
  await handleBuyOrder(to, amount)
}

export async function handleSTokenTraded(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetIdIn = event.event.data[1] as AssetId
  const assetIdOut = event.event.data[2] as AssetId
  const amountIn = event.event.data[3] as Balance
  const amountOut = event.event.data[4] as Balance

  if (!assetIdIn.eq(liquidCurrency) && !assetIdOut.eq(liquidCurrency)) {
    return
  }

  const isSell = assetIdIn.eq(liquidCurrency)
  if (isSell) {
    await handleSellOrder(account, amountIn)
  } else {
    await handleBuyOrder(account, amountOut)
  }
}

export async function handleSTokenBorrowed(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  await handleBuyOrder(account, amount)
}

export async function handleSTokenRepaid(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  await handleSellOrder(account, amount)
}

export async function handleSupplierRewardDistributed(event: SubstrateEvent) {
  const assetId = event.event.data[0] as AssetId
  const supplier = event.event.data[1] as AccountId
  const rewardDelta = event.event.data[2] as Balance

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const id = supplier.toString()
  let farmingPosition = await FarmingPosition.get(id)
  if (!farmingPosition) {
    farmingPosition = FarmingPosition.create({
      id,
      accrued: '0',
      claimed: '0'
    })
  }

  farmingPosition.accrued = new BN(farmingPosition.accrued)
    .add(rewardDelta.toBn())
    .toString()

  await farmingPosition.save()
}

export async function handleRewardPaid(event: SubstrateEvent) {
  const supplier = event.event.data[0] as AccountId

  const id = supplier.toString()
  const farmingPosition = await FarmingPosition.get(id)
  if (!farmingPosition) {
    return
  }

  farmingPosition.claimed = new BN(farmingPosition.claimed)
    .add(new BN(farmingPosition.accrued))
    .toString()
  farmingPosition.accrued = '0'

  await farmingPosition.save()
}

export async function handleLiquidityAdded(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const baseAsset = event.event.data[1] as AssetId
  const quoteAsset = event.event.data[2] as AssetId
  const baseAmount = event.event.data[3] as Balance
  const quoteAmount = event.event.data[4] as Balance

  if (!baseAsset.eq(liquidCurrency) && !quoteAsset.eq(liquidCurrency)) {
    return
  }

  if (baseAsset.eq(liquidCurrency)) {
    await handleSellOrder(account, baseAmount)
  }

  if (quoteAsset.eq(liquidCurrency)) {
    await handleSellOrder(account, quoteAmount)
  }
}

export async function handleLiquidityRemoved(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const baseAsset = event.event.data[1] as AssetId
  const quoteAsset = event.event.data[2] as AssetId
  const baseAmount = event.event.data[3] as Balance
  const quoteAmount = event.event.data[4] as Balance

  if (!baseAsset.eq(liquidCurrency) && !quoteAsset.eq(liquidCurrency)) {
    return
  }

  if (baseAsset.eq(liquidCurrency)) {
    await handleBuyOrder(account, baseAmount)
  }

  if (quoteAsset.eq(liquidCurrency)) {
    await handleBuyOrder(account, quoteAmount)
  }
}
