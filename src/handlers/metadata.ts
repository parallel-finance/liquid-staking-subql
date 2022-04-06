import { SubstrateEvent, SubstrateBlock } from "@subql/types";
import { Vec, u16, u128, Option } from "@polkadot/types";
import { Permill } from "@polkadot/types/interfaces";
import { PalletAssetsAssetAccount } from "@polkadot/types/lookup";
import { BN_ZERO, BN } from "@polkadot/util";
import { Metadata, Ledger, StakingAction } from "../types";
import { createAddress } from "../utils";
import { updateStakingAction } from "./stakingAction";
import { derivativeIndexList, stakingCurrency } from "../constants";
import { updateLedgerBlockHeight } from "./ledger";

export async function updateBlockMetadatas(
  block: SubstrateBlock
): Promise<void> {
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
  record.timestamp = block.timestamp;
  record.blockHeight = block.block.header.number.toNumber();
  await record.save();
  await updateMetadataTotalLocked(blockHash);
  await updateLedgerBlockHeight(block.block.header.number.toNumber());
}

export async function updateMetadataTotalStakersAndStakingAction(
  event: SubstrateEvent
) {
  const blockHash = event.block.block.header.hash.toString();
  const address = event.extrinsic.extrinsic.signer.toString();
  const parentRecord = await Metadata.get(
    event.block.block.header.parentHash.toString()
  );
  let metadataRecord = await Metadata.get(blockHash);
  if (!metadataRecord) {
    metadataRecord = new Metadata(blockHash);
    metadataRecord.totalStakers = parentRecord?.totalStakers
      ? parentRecord.totalStakers
      : 0;
  }
  if ((await StakingAction.getByAddress(address)).length === 0) {
    metadataRecord.totalStakers += 1;
  }
  await metadataRecord.save();
  await updateStakingAction(event);
}

export async function updateMetadataTotalLocked(blockHash) {
  const poolAccount = createAddress("par/lqsk");
  const { balance } = await (
    await api.query.assets.account<Option<PalletAssetsAssetAccount>>(
      stakingCurrency,
      poolAccount
    )
  ).unwrapOrDefault();
  const metadataRecord = await Metadata.get(blockHash);

  Promise.all(
    derivativeIndexList.map((index) => Ledger.get(index.toString()))
  ).then((ledgers) => {
    const result = ledgers
      .filter((ledger) => !!ledger)
      .reduce(
        (acc, ledger) => {
          acc.totalBonded = acc.totalBonded.add(new BN(ledger.active));
          acc.totalUnbonding = acc.totalUnbonding
            .add(new BN(ledger.total))
            .sub(new BN(ledger.active));
          return acc;
        },
        { totalBonded: BN_ZERO, totalUnbonding: BN_ZERO }
      );
    metadataRecord.totalLocked = result.totalBonded
      .add(result.totalUnbonding)
      .add(balance)
      .sub(new BN(metadataRecord.totalReserves))
      .toString();
    metadataRecord.save();
  });
}
