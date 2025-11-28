import { DexcomApiCallback } from "./DexcomApiCallback";

export interface DexcomApi {
    fetchData(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void;
    fetchDataCached(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void;
}
