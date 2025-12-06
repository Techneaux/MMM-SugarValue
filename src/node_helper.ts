import { Config } from "./Config";
import { DexcomApi } from "./dexcom/DexcomApi";
import { DexcomApiResponse } from "./dexcom/DexcomApiResponse";
import { DexcomApiFactory } from "./dexcom/DexcomApiImpl";
import { ModuleNotification } from "./ModuleNotification";
import { NotificationPayload } from "./NotificationPayload";

const NodeHelper = require("node_helper");

interface MagicMirrorNodeHelperApi {
    socketNotificationReceived?(notification: ModuleNotification, payload: NotificationPayload): void;
    sendSocketNotification?(notification: ModuleNotification, payload: NotificationPayload): void;
}

interface ModuleNodeHelper extends MagicMirrorNodeHelperApi {
    api: DexcomApi | undefined;
    fetchData(api: DexcomApi, updateSecs: number): void;
    fetchDataWithRetry(api: DexcomApi, callback: (response: DexcomApiResponse) => void, maxRetries: number, attempt: number): void;
    fetchHistoryData(minutes: number): void;
    _sendSocketNotification(notification: ModuleNotification, payload: NotificationPayload): void;
}

module.exports = NodeHelper.create({
    api: undefined as DexcomApi | undefined,
    socketNotificationReceived(notification: ModuleNotification, payload: NotificationPayload) {
        switch (notification) {
            case ModuleNotification.CONFIG:
                const config: Config | undefined = payload.config;
                if (config !== undefined) {
                    this.api = DexcomApiFactory(config.serverUrl, config.username, config.password);

                    setTimeout(() => {
                        this.fetchData(this.api!, config.updateSecs);
                    }, 500);
                }
                break;
            case ModuleNotification.REQUEST_HISTORY:
                if (this.api && payload.historyRequest) {
                    this.fetchHistoryData(payload.historyRequest.minutes);
                }
                break;
        }
    },
    // stop: () => {
    //     stopped = true;
    // },
    fetchData(api: DexcomApi, updateSecs: number) {
        let callbackInvoked = false;
        const timeoutMs = 70000; // 70 second timeout (3 attempts × 20s per request + ~7s backoff delays)

        // Set timeout to detect if API call gets stuck
        const timeoutId = setTimeout(() => {
            if (!callbackInvoked) {
                console.error(`[${new Date().toISOString()}] Dexcom API call timed out after ${timeoutMs}ms`);
                this._sendSocketNotification(ModuleNotification.DATA, {
                    apiResponse: {
                        error: {
                            statusCode: -1,
                            message: "API request timed out after " + (timeoutMs / 1000) + " seconds"
                        },
                        readings: []
                    }
                });
            }
        }, timeoutMs);

        // Attempt to fetch data with retry logic
        try {
            this.fetchDataWithRetry(api, (response: DexcomApiResponse) => {
                callbackInvoked = true;
                clearTimeout(timeoutId);
                this._sendSocketNotification(ModuleNotification.DATA, { apiResponse: response });
            }, 3, 1);
        } catch (error) {
            callbackInvoked = true;  // Prevent timeout from also firing
            console.error(`[${new Date().toISOString()}] Exception in fetchData:`, error);
            clearTimeout(timeoutId);
            this._sendSocketNotification(ModuleNotification.DATA, {
                apiResponse: {
                    error: {
                        statusCode: -1,
                        message: "Exception in fetchData: " + error
                    },
                    readings: []
                }
            });
        }

        // Always schedule next poll, regardless of success/failure
        setTimeout(() => {
            this.fetchData(api, updateSecs);
        }, updateSecs * 1000);
    },

    // Retry wrapper - retries are silent (no UI update until final result)
    fetchDataWithRetry(api: DexcomApi, callback: (response: DexcomApiResponse) => void, maxRetries: number, attempt: number) {
        api.fetchDataCached((response: DexcomApiResponse) => {
            if (response.error && attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
                console.log(`[${new Date().toISOString()}] Attempt ${attempt}/${maxRetries} failed: ${response.error.message}. Retrying in ${delay}ms...`);
                setTimeout(() => {
                    this.fetchDataWithRetry(api, callback, maxRetries, attempt + 1);
                }, delay);
            } else {
                // Only callback (which triggers UI update) on success or final failure
                if (response.error) {
                    console.error(`[${new Date().toISOString()}] All ${maxRetries} attempts failed: ${response.error.message}`);
                }
                callback(response);
            }
        }, 1);
    },
    fetchHistoryData(minutes: number): void {
        if (!this.api) return;

        // Calculate maxCount: ~1 reading per 5 minutes
        const maxCount = Math.ceil(minutes / 5) + 1;

        this.api.fetchDataCached((response: DexcomApiResponse) => {
            this._sendSocketNotification(ModuleNotification.HISTORY_DATA, {
                historyResponse: response
            });
        }, maxCount, minutes);
    },
    _sendSocketNotification(notification: ModuleNotification, payload: NotificationPayload): void {
        console.log("Sending", notification, payload);
        if (this.sendSocketNotification !== undefined) {
            this.sendSocketNotification(notification, payload);
        } else {
            console.error("sendSocketNotification is not present");
        }
    },
} as ModuleNodeHelper);
