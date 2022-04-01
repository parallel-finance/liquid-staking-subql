import { SubstrateEvent } from "@subql/types";
import { StakingAction } from "../types";

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
