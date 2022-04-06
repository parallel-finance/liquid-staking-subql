import { SubstrateEvent, SubstrateBlock } from "@subql/types";
import { PalletStakingStakingLedger } from "@polkadot/types/lookup";
import { Ledger } from "../types";
import { blockHandleWrapper } from "../utils";

import {
  updateMetadataTotalStakersAndStakingAction,
  updateMetadataTotalLocked,
  updateStakingAction,
  updateBlockMetadatas,
} from "../handlers";

export async function handleBlock(block: SubstrateBlock): Promise<void> {
  await blockHandleWrapper(block, updateBlockMetadatas);
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
