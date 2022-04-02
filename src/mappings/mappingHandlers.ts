import { SubstrateEvent, SubstrateBlock } from "@subql/types";
import { u128 } from "@polkadot/types";
import { Permill } from "@polkadot/types/interfaces";
import { PalletStakingStakingLedger } from "@polkadot/types/lookup";
import { Metadata, Ledger } from "../types";

import {
  updateMetadataTotalStakersAndStakingAction,
  updateMetadataTotalLocked,
  updateStakingAction,
} from "../handlers";

export async function handleBlock(block: SubstrateBlock): Promise<void> {
  const blockHash = block.block.header.hash.toString();

  const [totalReserves, exchangeRate, reserveFactor, marketCap] =
    await api.queryMulti<[u128, u128, Permill, u128]>([
      api.query.liquidStaking.totalReserves,
      api.query.liquidStaking.exchangeRate,
      api.query.liquidStaking.reserveFactor,
      api.query.liquidStaking.marketCap,
    ]);
  let record = await Metadata.get(blockHash);
  const parentRecord = await Metadata.get(
    block.block.header.parentHash.toString()
  );
  if (!record) {
    record = new Metadata(blockHash);
    record.totalStakers = parentRecord?.totalStakers
      ? parentRecord.totalStakers
      : 0;
  }
  record.blockHash = blockHash;
  record.totalReserves = totalReserves.toString();
  record.exchangeRate = exchangeRate.toString();
  record.reserveFactor = reserveFactor.toString();
  record.marketCap = marketCap.toString();
  record.timastamps = block.timestamp;
  record.height = block.block.header.number.toNumber();
  await record.save();
  await updateMetadataTotalLocked(blockHash);
}

export async function handleStakeEvent(event: SubstrateEvent) {
  await updateMetadataTotalStakersAndStakingAction(event);
}

export async function handleUnstakeEvent(event: SubstrateEvent) {
  await updateStakingAction(event);
}

export async function handleUpdateLedger(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash;
  const derivativeIndex = event.event.data[0];
  const stakingLedger = event.event.data[1] as PalletStakingStakingLedger;
  let ledgerRecord = await Ledger.get(derivativeIndex.toString());

  if (!ledgerRecord) {
    ledgerRecord = new Ledger(derivativeIndex.toString());
  }

  ledgerRecord.active = stakingLedger.active.toString();
  ledgerRecord.total = stakingLedger.total.toString();
  ledgerRecord.unlocking = stakingLedger.unlocking.map((item) => ({
    era: item.era.toNumber(),
    value: item.value.toString(),
  }));

  await ledgerRecord.save();
  await updateMetadataTotalLocked(blockHash);
}
