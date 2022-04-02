import { SubstrateEvent } from "@subql/types";
import { Vec, u16, Option } from "@polkadot/types";
import { BN_ZERO, BN } from "@polkadot/util";
import { PalletAssetsAssetAccount } from "@polkadot/types/lookup";
import { Metadata, Ledger, StakingAction } from "../types";
import { createAddress } from "../utils";
import { updateStakingAction } from "./stakingAction";

const derivativeIndexList = api.consts.liquidStaking
  .derivativeIndexList as Vec<u16>;

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
  const stakingCurrency = api.consts.liquidStaking.stakingCurrency;
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
