import Mom from "moment";
import { SubstrateBlock } from "@subql/types";

type CacheData = {
  block: number;
  timestamp: Date;
};

function createCache() {
  let data: CacheData;
  return {
    get: () => {
      return data;
    },
    set: ({ block, timestamp }: CacheData): CacheData => {
      return (data = {
        block,
        timestamp,
      });
    },
  };
}

const hourCache = createCache();
const utcTime = (timestamp: Date, keepLocalTime: boolean = true) =>
  Mom(timestamp).utc(keepLocalTime);

function now() {
  return Mom().utc(false);
}

type TimeUnit = "months" | "weeks" | "days" | "hours" | "minutes" | "seconds";

function diffTime(timestamp: Date, unit: TimeUnit = "days"): number {
  return now().diff(utcTime(timestamp), unit);
}

export function startOf(timestamp: Date, unit: TimeUnit = "days") {
  return utcTime(timestamp).startOf(unit);
}

function endOf(timestamp: Date, unit: TimeUnit = "days") {
  return utcTime(timestamp).endOf(unit);
}

function hitEndOfDay(timestamp: Date): boolean {
  return endOf(timestamp).diff(timestamp, "seconds") <= 24;
}

function hitHourTime(timestamp: Date, lastTime: any, off: number = 1) {
  const startHour = startOf(timestamp, "hours");
  const blockTime = utcTime(timestamp);
  const isStartBlock = blockTime.diff(startHour, "seconds") <= 12;
  const overHour = blockTime.diff(utcTime(lastTime), "hours") >= 1;
  const isOk = isStartBlock || overHour;

  if (!isOk) return false;

  if (off === 1 && isOk) return true;

  if (startHour.diff(utcTime(timestamp).startOf("days")) % off === 0) {
    return true;
  }
  return false;
}

enum SnapshotPolicy {
  Hourly,
  Blockly,
}

function getPolicy(timestamp: Date): SnapshotPolicy {
  const diffDays = diffTime(timestamp, "days");
  if (diffDays > 1) {
    // keep hourly snapshot
    return SnapshotPolicy.Hourly;
  }
  // keep block snapshot
  return SnapshotPolicy.Blockly;
}

function handlePolicy(blockHeight: number, timestamp: Date): boolean {
  try {
    // day end snapshot may be loss for block blocked over 24 seconds
    if (hitEndOfDay(timestamp)) return true;
    const policy = getPolicy(timestamp);
    switch (policy) {
      case SnapshotPolicy.Hourly:
        const start = Date.now();
        let cache = hourCache.get();
        if (cache === undefined) {
          cache = hourCache.set({
            block: blockHeight,
            timestamp: utcTime(timestamp).subtract(1, "hours").toDate(),
          });
        }
        if (hitHourTime(timestamp, cache.timestamp, 1)) {
          logger.debug(
            `hourly snapshot policy: ${blockHeight}-${timestamp}\n last cache: %o`,
            cache
          );
          hourCache.set({ block: blockHeight, timestamp });
          return true;
        }
        break;
      case SnapshotPolicy.Blockly:
        logger.debug(`blockly snapshot policy`);
        return true;
    }
    return false;
  } catch (e: any) {
    logger.error(`handle block policy error: ${e.message}`);
    return true;
  }
}

const blockHandleWrapper = async (
  block: SubstrateBlock,
  handler: (block: SubstrateBlock) => Promise<void>
) => {
  const blockHeight = block.block.header.number.toNumber();
  const timestamp = block.timestamp;
  const isHandle = handlePolicy(blockHeight, timestamp);
  if (!isHandle) {
    return;
  }
  await handler(block);
};

export default blockHandleWrapper;
