import { Config } from "./Config";
import { DexcomApiResponse } from "./dexcom";

export interface HistoryRequest {
    minutes: number;  // 180, 360, 720, 1440
}

export interface NotificationPayload {
    config?: Config;
    apiResponse?: DexcomApiResponse;
    historyRequest?: HistoryRequest;
    historyResponse?: DexcomApiResponse;
}
