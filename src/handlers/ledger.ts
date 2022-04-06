import { derivativeIndexList } from "../constants";
import { Ledger } from "../types";

export function updateLedgerBlockHeight(height: number) {
  Promise.all(
    derivativeIndexList.map((index) => Ledger.get(index.toString()))
  ).then((ledgers) => {
    ledgers
      .filter((ledger) => !!ledger)
      .forEach(async (ledger) => {
        ledger.height = height;
        await ledger.save();
      });
  });
}
