import { randomInt } from "node:crypto";

const MIN_SEED = 1;
const MAX_SEED_EXCLUSIVE = 0x1_0000_0000;

export function generateSeed(randomInteger = randomInt) {
  return randomInteger(MIN_SEED, MAX_SEED_EXCLUSIVE);
}
