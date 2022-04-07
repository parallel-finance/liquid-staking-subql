import { SubstrateEvent } from "@subql/types";
import { stakingCurrency, liquidCurrency } from "../constants";
import { StakingAction } from "../types";

export async function updateStakingAction(event: SubstrateEvent) {
  const blockHash = event.block.block.header.hash.toString();
  const { hash, args, signer } = event.extrinsic.extrinsic;
  const address = signer.toString();
  const extrinsicHash = hash.toString();
  const id = `${event.idx}-${extrinsicHash}`;
  const type = event.event.method;
  const amount = args[0].toString();
  const timestamp = event.block.timestamp;
  const record = StakingAction.create({
    id,
    metadataId: blockHash,
    blockHeight: event.block.block.header.number.toNumber(),
    address: address,
    extrinsicHash,
    type,
    amount,
    timestamp,
    assetId:
      type === "Staked"
        ? stakingCurrency.toNumber()
        : liquidCurrency.toNumber(),
  });
  await record.save();
}
