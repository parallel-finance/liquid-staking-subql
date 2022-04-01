import { Staker } from "../types";

export async function updateStaker(address) {
  if (!(await Staker.get(address))) {
    const record = new Staker(address);
    await record.save();
  }
}
