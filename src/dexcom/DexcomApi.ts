import { DexcomApiCallback } from "./DexcomApiCallback";

export interface DexcomApi {
    fetchDataCached(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void;
}
