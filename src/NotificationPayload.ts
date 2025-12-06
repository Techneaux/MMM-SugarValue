import { Config } from "./Config";
import { DexcomApiResponse } from "./dexcom";

export interface HistoryRequest {
    minutes: number;  // 180, 360, 720, 1440
    requestId: number;  // Unique ID to track request/response matching
}

export interface NotificationPayload {
    config?: Config;
    apiResponse?: DexcomApiResponse;
    historyRequest?: HistoryRequest;
    historyResponse?: DexcomApiResponse;
}
