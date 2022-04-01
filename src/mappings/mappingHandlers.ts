import { SubstrateEvent, SubstrateBlock } from "@subql/types";
import { u128 } from "@polkadot/types";
import { Permill } from "@polkadot/types/interfaces";
import { PalletStakingStakingLedger } from "@polkadot/types/lookup";
import { Metadata, StakingAction, Ledger } from "../types";

import {
  updateMetadataTotalStakers,
  updateMetadataTotalStaked,
  updateStaker,
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
  if (!record) {
    record = new Metadata(blockHash);
    record.totalStakers = 0;
  }
  record.blockHash = blockHash;
  record.totalReserves = totalReserves.toString();
  record.exchangeRate = exchangeRate.toString();
  record.reserveFactor = reserveFactor.toString();
  record.marketCap = marketCap.toString();
  record.timastamps = block.timestamp;
  await record.save();
  await updateMetadataTotalStaked(blockHash);
}

export async function updateStakingAction(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash.toString();
  const { hash, args, signer } = event.extrinsic.extrinsic;
  const address = signer.toString();
  const id = `${blockHash}-${address}`;
  const extrinsicHash = hash.toString();
  const type = event.event.method;
  const amount = args[0].toString();
  const timestamp = event.block.timestamp;
  const record = StakingAction.create({
    id,
    blockHashId: blockHash,
    addressId: address,
    extrinsicHash,
    type,
    amount,
    timestamp,
  });
  await record.save();
}

export async function handleStakeEvent(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash.toString();
  const address = event.extrinsic.extrinsic.signer.toString();
  await updateStaker(address);
  await updateMetadataTotalStakers(blockHash, address);
  await updateStakingAction(event);
}

export async function handleUnstakeEvent(event: SubstrateEvent) {
  await updateStakingAction(event);
}

export async function handleUpLedger(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash;
  const [derivativeIndex, stakingLedger] = event.event.data;
  let ledgerRecord = await Ledger.get(derivativeIndex.toString());

  if (!ledgerRecord) {
    ledgerRecord = new Ledger(derivativeIndex.toString());
  }

  ledgerRecord.active = (
    stakingLedger as PalletStakingStakingLedger
  ).active.toString();
  ledgerRecord.total = (
    stakingLedger as PalletStakingStakingLedger
  ).total.toString();

  await ledgerRecord.save();
  await updateMetadataTotalStaked(blockHash);
}
