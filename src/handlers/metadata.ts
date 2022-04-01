import { Vec, u16, Option } from "@polkadot/types";
import { BN_ZERO, BN } from "@polkadot/util";
import { PalletAssetsAssetAccount } from "@polkadot/types/lookup";
import { Metadata, Staker, Ledger } from "../types";
import { createAddress } from "../utils";

const derivativeIndexList = api.consts.liquidStaking
  .derivativeIndexList as Vec<u16>;

export async function updateMetadataTotalStakers(blockHash, stakerAddress) {
  let metadataRecord = await Metadata.get(blockHash);
  if (!metadataRecord) {
    metadataRecord = new Metadata(blockHash);
    metadataRecord.totalStakers = 0;
  }
  if (!(await Staker.get(stakerAddress))) {
    metadataRecord.totalStakers += 1;
  }
  await metadataRecord.save();
}

export async function updateMetadataTotalStaked(blockHash) {
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
    metadataRecord.totalStaked = result.totalBonded
      .add(result.totalUnbonding)
      .add(balance)
      .sub(new BN(metadataRecord.totalReserves))
      .toString();
    metadataRecord.save();
  });
}
