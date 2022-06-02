import { SubstrateEvent, SubstrateBlock } from '@subql/types'
import { PalletStakingStakingLedger } from '@polkadot/types/lookup'
import { stakingCurrency, liquidCurrency, nativeCurrency } from '../constants'
import { Ledger, StakingPosition, FarmingPosition } from '../types'
import { BN } from '@polkadot/util'
import { AccountId } from '@polkadot/types/interfaces'
import { Rate, Balance, AssetId } from '@parallel-finance/types/interfaces'
import { Extrinsic } from '@polkadot/types/interfaces'
import {
  updateMetadataTotalStakersAndStakingAction,
  updateMetadataTotalLocked,
  updateStakingAction,
  updateBlockMetadatas
} from '../handlers'
import {
  createAddress,
  farmingPoolAccountId,
  toSubstrateAddress
} from '../utils'
import { Vec } from '@polkadot/types'

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
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const fromStake =
    event.extrinsic &&
    checkTransaction('liquidStaking', 'stake', event.extrinsic.extrinsic)
  const account = event.event.data[1] as AccountId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  await handleBuyOrder(account, amount, blockHeight, fromStake)
}

async function handleBuyOrder(
  account: AccountId,
  amount: Balance,
  blockHeight: number,
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
      lending: '0',
      farming: '0',
      avgExchangeRate: exchangeRate.toString(),
      balance: '0',
      blockHeight
    })
  }

  const newBalance = new BN(position.balance).add(amount.toBn())

  if (fromStake) {
    const newAvgExchangeRate = new BN(position.avgExchangeRate)
      .mul(
        new BN(position.balance)
          .add(new BN(position.lending))
          .add(new BN(position.farming))
      )
      .add(amount.toBn().mul(exchangeRate.toBn()))
      .div(
        newBalance.add(new BN(position.lending)).add(new BN(position.farming))
      )
    position.totalStaked = new BN(position.totalStaked)
      .add(amount.toBn())
      .toString()
    position.avgExchangeRate = newAvgExchangeRate.toString()
  }

  position.balance = newBalance.toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenBurned(event: SubstrateEvent) {
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const fromUnstake =
    event.extrinsic &&
    checkTransaction('liquidStaking', 'unstake', event.extrinsic.extrinsic)
  const account = event.event.data[1] as AccountId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  await handleSellOrder(account, amount, blockHeight, fromUnstake)
}

async function handleSellOrder(
  account: AccountId,
  amount: Balance,
  blockHeight: number,
  fromUnstake: boolean = false
) {
  const id = account.toString()
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  let position = await StakingPosition.get(id.toString())
  if (!position || amount.eq(new BN(0))) return

  const diff = new BN(position.balance).gt(amount.toBn())
    ? amount.toBn()
    : new BN(position.balance)

  if (fromUnstake) {
    const newTotalEarned = exchangeRate
      .toBn()
      .sub(new BN(position.avgExchangeRate))
      .mul(diff)
      .div(new BN('1000000000000000000'))
      .add(new BN(position.totalEarned))
    position.totalEarned = newTotalEarned.toString()
  }
  position.balance = new BN(position.balance).sub(diff).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenTransferred(event: SubstrateEvent) {
  const assetId = event.event.data[0] as AssetId
  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const from = event.event.data[1] as AccountId
  const to = event.event.data[2] as AccountId
  const fromSubstrateFmt = toSubstrateAddress(from)
  const toSubstrateFmt = toSubstrateAddress(to)
  const amount = event.event.data[3] as Balance
  const exchangeRate = (await api.query.liquidStaking.exchangeRate()) as Rate
  const blockHeight = event.block.block.header.number.toNumber()
  const moduleAddresses = [
    createAddress('par/loan'),
    createAddress('par/ammp'),
    createAddress('par/lqsk'),
    farmingPoolAccountId(assetId.toNumber())
  ]

  if (
    moduleAddresses.includes(fromSubstrateFmt) ||
    moduleAddresses.includes(toSubstrateFmt)
  ) {
    return
  }

  await handleSellOrder(from, amount, blockHeight)
  await handleBuyOrder(to, amount, blockHeight)
}

export async function handleSTokenTraded(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetIdIn = event.event.data[1] as AssetId
  const assetIdOut = event.event.data[2] as AssetId
  const amountIn = event.event.data[3] as Balance
  const amountOut = event.event.data[4] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetIdIn.eq(liquidCurrency) && !assetIdOut.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const isSell = assetIdIn.eq(liquidCurrency)
  if (isSell) {
    await handleSellOrder(account, amountIn, blockHeight)
  } else {
    await handleBuyOrder(account, amountOut, blockHeight)
  }
}

export async function handleSTokenDeposited(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  position.lending = new BN(position.lending).add(amount.toBn()).toString()
  position.balance = new BN(position.balance).sub(amount.toBn()).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenRedeemed(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  logEvent(event)

  // TODO: supply APY may cause this to underflow
  position.lending = (
    new BN(position.lending).gt(amount.toBn())
      ? new BN(position.lending).sub(amount.toBn())
      : new BN(0)
  ).toString()

  position.balance = new BN(position.balance).add(amount.toBn()).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenBorrowed(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  position.borrowing = new BN(position.borrowing).add(amount.toBn()).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenRepaid(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const amount = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  // TODO: borrow APY may cause this to underflow
  position.borrowing = (
    new BN(position.borrowing).gt(amount.toBn())
      ? new BN(position.borrowing).sub(amount.toBn())
      : new BN(0)
  ).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSTokenLiquidatedBorrow(event: SubstrateEvent) {
  const account = event.event.data[1] as AccountId
  const liquidationAssetId = event.event.data[2] as AssetId
  const collateralAssetId = event.event.data[3] as AssetId
  const repayAmount = event.event.data[4] as Balance
  const amount = event.event.data[5] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (
    !collateralAssetId.eq(liquidCurrency) &&
    !liquidationAssetId.eq(liquidCurrency)
  ) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  if (collateralAssetId.eq(liquidCurrency)) {
    // TODO: supply APY may cause this to underflow
    position.lending = (
      new BN(position.lending).gt(amount.toBn())
        ? new BN(position.lending).sub(amount.toBn())
        : new BN(0)
    ).toString()
  }

  if (liquidationAssetId.eq(liquidCurrency)) {
    // TODO: borrow APY may cause this to underflow
    position.borrowing = (
      new BN(position.borrowing).gt(repayAmount.toBn())
        ? new BN(position.borrowing).sub(repayAmount.toBn())
        : new BN(0)
    ).toString()
  }

  position.blockHeight = blockHeight

  await position.save()
}

export async function handleSupplierRewardDistributed(event: SubstrateEvent) {
  const assetId = event.event.data[0] as AssetId
  const supplier = event.event.data[1] as AccountId
  const rewardDelta = event.event.data[2] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  const id = supplier.toString()
  let farmingPosition = await FarmingPosition.get(id)
  if (!farmingPosition) {
    farmingPosition = FarmingPosition.create({
      id,
      accrued: '0',
      claimed: '0',
      blockHeight
    })
  }

  farmingPosition.accrued = new BN(farmingPosition.accrued)
    .add(rewardDelta.toBn())
    .toString()
  farmingPosition.blockHeight = blockHeight

  await farmingPosition.save()
}

export async function handleRewardPaid(event: SubstrateEvent) {
  const supplier = event.event.data[0] as AccountId
  const blockHeight = event.block.block.header.number.toNumber()

  const id = supplier.toString()
  const farmingPosition = await FarmingPosition.get(id)
  if (!farmingPosition) {
    return
  }

  logEvent(event)

  farmingPosition.claimed = new BN(farmingPosition.claimed)
    .add(new BN(farmingPosition.accrued))
    .toString()
  farmingPosition.accrued = '0'
  farmingPosition.blockHeight = blockHeight

  await farmingPosition.save()
}

export async function handleLiquidityAdded(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const baseAsset = event.event.data[1] as AssetId
  const quoteAsset = event.event.data[2] as AssetId
  const baseAmount = event.event.data[3] as Balance
  const quoteAmount = event.event.data[4] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!baseAsset.eq(liquidCurrency) && !quoteAsset.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  if (baseAsset.eq(liquidCurrency)) {
    await handleSellOrder(account, baseAmount, blockHeight)
  }

  if (quoteAsset.eq(liquidCurrency)) {
    await handleSellOrder(account, quoteAmount, blockHeight)
  }
}

export async function handleLiquidityRemoved(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const baseAsset = event.event.data[1] as AssetId
  const quoteAsset = event.event.data[2] as AssetId
  const baseAmount = event.event.data[4] as Balance
  const quoteAmount = event.event.data[5] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!baseAsset.eq(liquidCurrency) && !quoteAsset.eq(liquidCurrency)) {
    return
  }

  logEvent(event)

  if (baseAsset.eq(liquidCurrency)) {
    await handleBuyOrder(account, baseAmount, blockHeight)
  }

  if (quoteAsset.eq(liquidCurrency)) {
    await handleBuyOrder(account, quoteAmount, blockHeight)
  }
}

export async function handleFarmingRewardPaid(event: SubstrateEvent) {
  const supplier = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const rewardAssetId = event.event.data[2] as AssetId
  const amount = event.event.data[4] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency) || !rewardAssetId.eq(nativeCurrency)) {
    return
  }

  logEvent(event)

  const id = supplier.toString()
  let farmingPosition = await FarmingPosition.get(id)
  if (!farmingPosition) {
    farmingPosition = FarmingPosition.create({
      id,
      accrued: '0',
      claimed: '0',
      blockHeight
    })
  }

  farmingPosition.claimed = new BN(farmingPosition.claimed)
    .add(amount.toBn())
    .toString()
  farmingPosition.blockHeight = blockHeight

  await farmingPosition.save()
}

export async function handleFarmingDeposited(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const rewardAssetId = event.event.data[2] as AssetId
  const amount = event.event.data[4] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency) || !rewardAssetId.eq(nativeCurrency)) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  position.farming = new BN(position.farming).add(amount.toBn()).toString()
  position.balance = new BN(position.balance).sub(amount.toBn()).toString()
  position.blockHeight = blockHeight

  await position.save()
}

export async function handleFarmingWithdrew(event: SubstrateEvent) {
  const account = event.event.data[0] as AccountId
  const assetId = event.event.data[1] as AssetId
  const rewardAssetId = event.event.data[2] as AssetId
  const amount = event.event.data[4] as Balance
  const blockHeight = event.block.block.header.number.toNumber()

  if (!assetId.eq(liquidCurrency) || !rewardAssetId.eq(nativeCurrency)) {
    return
  }

  logEvent(event)

  const id = account.toString()
  const position = await StakingPosition.get(id)
  if (!position) {
    return
  }

  position.farming = new BN(position.farming).sub(amount.toBn()).toString()
  position.balance = new BN(position.balance).add(amount.toBn()).toString()
  position.blockHeight = blockHeight

  await position.save()
}

const checkTransaction = (
  sectionFilter: string,
  methodFilter: string,
  call: Extrinsic
) => {
  const { section, method } = call.registry.findMetaCall(call.callIndex)
  return (
    (section === sectionFilter && method === methodFilter) ||
    (section === 'utility' &&
      ['batchAll', 'batch'].includes(method) &&
      (call.args[0] as Vec<Extrinsic>).some((e) =>
        checkTransaction(sectionFilter, methodFilter, e)
      )) ||
    (section === 'proxy' &&
      method === 'proxy' &&
      checkTransaction(sectionFilter, methodFilter, call.args[2] as Extrinsic))
  )
}

const logEvent = (originalEvent: SubstrateEvent) => {
  const { event, extrinsic } = originalEvent
  logger.info(`Event: ${event.section}.${event.method}, Data: ${event.data}`)
  if (extrinsic) {
    const { section, method } = extrinsic.extrinsic.registry.findMetaCall(
      extrinsic.extrinsic.callIndex
    )
    logger.info(
      `Extrinsic: ${section}.${method}, Args: [${extrinsic.extrinsic.args}]`
    )
  }
}
