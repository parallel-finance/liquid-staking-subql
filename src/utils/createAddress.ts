import { encodeAddress } from "@polkadot/keyring";
import { stringToU8a, u8aConcat } from "@polkadot/util";

const EMPTY_U8A_32 = new Uint8Array(32);

const createAddress = (id: string): string =>
  encodeAddress(
    u8aConcat(stringToU8a(`modl${id}`), EMPTY_U8A_32).subarray(0, 32)
  );

export default createAddress;
