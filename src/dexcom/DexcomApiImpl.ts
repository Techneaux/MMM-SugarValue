import request from "request";
import * as qs from "qs";
import https from "https";
import { DexcomApi } from "./DexcomApi";
import { DexcomApiCallback } from "./DexcomApiCallback";
import { DexcomApiError } from "./DexcomApiError";
import { DexcomRawReading } from "./DexcomRawReading";
import { DexcomReadingImpl } from "./DexcomReadingImpl";

interface AuthRequestBody {
    accountName: string;
    password: string;
    applicationId: string;
}

interface LoginByIdRequestBody {
    accountId: string;
    password: string;
    applicationId: string;
}

interface FetchDataQueryParams {
    sessionID: string;
    minutes: number;
    maxCount: number;
}

class DexcomApiImpl implements DexcomApi {
    private readonly _server: string;
    private readonly _username: string;
    private readonly _password: string;

    // Cached credentials to reduce API calls
    private _accountId: string | null = null;  // Cached permanently until module restart
    private _sessionId: string | null = null;  // Cached until it expires (non-200 response)

    private static readonly APPLICATION_ID: string = "d89443d2-327c-4a6f-89e5-496bbb0317db";
    private static readonly AGENT: string = "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0";
    private static readonly CONTENT_TYPE: string = "application/json";
    private static readonly ACCEPT: string = "application/json";

    constructor(server: string, username: string, password: string) {
        this._server = server;
        this._username = username;
        this._password = password;
    }

    private doPost(uri: string, body: any, callback?: request.RequestCallback): request.Request {
        let bodyAsString: string = body == undefined ? "" : JSON.stringify(body);
        console.log("POST", uri, bodyAsString);
        return request(
            {
                uri: "https://" + uri,
                method: "POST",
                timeout: 20000, // 20 second timeout for network requests
                agent: new https.Agent({
                    host: this._server,
                    port: 443,
                    path: '/',
                    rejectUnauthorized: false
                  }),
                headers: {
                    'User-Agent': DexcomApiImpl.AGENT,
                    'Content-Type': DexcomApiImpl.CONTENT_TYPE,
                    'Content-Length': bodyAsString == undefined ? 0 : bodyAsString.length,
                    'Accept': DexcomApiImpl.ACCEPT
                },
                body: bodyAsString
            },
            callback
        );
    }

    private stripQuotes(body: any): string | null {
        if (typeof body !== 'string' || body.length < 2) {
            return null;
        }
        if (body[0] !== '"' || body[body.length - 1] !== '"') {
            return null;
        }
        return body.substring(1, body.length - 1);
    }

    // Parse Dexcom error responses for better error messages
    private parseErrorResponse(statusCode: number | undefined, error: any, body: any, step: string): DexcomApiError {
        let message = `${step} failed`;
        const resolvedStatusCode = statusCode !== undefined ? statusCode : -1;

        // Try to parse Dexcom's JSON error response (contains Code, Message, SubCode)
        if (body && typeof body === 'string') {
            try {
                const parsed = JSON.parse(body);
                if (parsed.Message) {
                    message = `${step}: ${parsed.Message}`;
                    if (parsed.Code) message += ` (${parsed.Code})`;
                }
            } catch (e) {
                // Not JSON, use raw error if available
                if (error) message = `${step}: ${error}`;
            }
        } else if (error) {
            message = `${step}: ${error}`;
        }

        return {
            statusCode: resolvedStatusCode,
            message
        };
    }

    private authenticatePublisherAccount(callback?: request.RequestCallback): request.Request {
        return this.doPost(
            this._server + "/ShareWebServices/Services/General/AuthenticatePublisherAccount",
            {
                "accountName": this._username,
                "password": this._password,
                "applicationId": DexcomApiImpl.APPLICATION_ID
            } as AuthRequestBody,
            callback
        );
    }

    private loginById(accountId: string, callback?: request.RequestCallback): request.Request {
        return this.doPost(
            this._server + "/ShareWebServices/Services/General/LoginPublisherAccountById",
            {
                "accountId": accountId,
                "password": this._password,
                "applicationId": DexcomApiImpl.APPLICATION_ID
            } as LoginByIdRequestBody,
            callback
        );
    }

    private fetchLatest(sessionId: string, maxCount?: number, minutes?: number, callback?: request.RequestCallback): request.Request {
        return this.doPost(
            this._server + "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?"  + qs.stringify(
                {
                    sessionID: sessionId,
                    minutes: minutes === undefined ? 1440 : Math.max(1, minutes),
                    maxCount: maxCount === undefined ? 1 : Math.max(1, maxCount),
                } as FetchDataQueryParams
            ),
            undefined,
            callback
        );
    }

    public fetchData(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void {
        // Step 1: Authenticate to get account UUID
        this.authenticatePublisherAccount((error: any, response: request.Response, body: any) => {
            console.log(error);
            if (error != null || response.statusCode !== 200) {
                callback({
                    error: {
                        statusCode: response == undefined ? -1 : response.statusCode,
                        message: "Authenticate account fail: " + (error == undefined ? "" : error)
                    },
                    readings: []
                });
            } else {
                // Strip surrounding quotes from UUID
                const accountId = this.stripQuotes(body);
                if (!accountId) {
                    callback({
                        error: { statusCode: response.statusCode, message: "Invalid accountId response" },
                        readings: []
                    });
                    return;
                }

                // Step 2: Login with account UUID to get session ID
                this.loginById(accountId, (_error: any, _response: request.Response, _body: any) => {
                    console.log(_error);
                    if (_error != null || _response.statusCode !== 200) {
                        callback({
                            error: {
                                statusCode: _response == undefined ? -1 : _response.statusCode,
                                message: "Login fail: " + (_error == undefined ? "" : _error)
                            },
                            readings: []
                        });
                    } else {
                        // Strip surrounding quotes from session ID
                        const sessionId = this.stripQuotes(_body);
                        if (!sessionId) {
                            callback({
                                error: { statusCode: _response.statusCode, message: "Invalid session response" },
                                readings: []
                            });
                            return;
                        }

                        // Step 3: Fetch data with session ID
                        this.fetchLatest(sessionId, maxCount, minutes, (__error: any, __response: request.Response, __body: any) => {
                            if (__error != null || __response.statusCode !== 200) {
                                callback({
                                    error: {
                                        statusCode: __response == undefined ? -1 : __response.statusCode,
                                        message: "Fetch readings fail: " + (__error == undefined ? "" : __error)
                                    },
                                    readings: []
                                });
                            } else {
                                const rawReadings: DexcomRawReading[] = JSON.parse(__body);
                                callback({
                                    error: undefined,
                                    readings: rawReadings.map(reading => new DexcomReadingImpl(reading))
                                });
                            }
                        });
                    }
                });
            }
        });
    }

    /**
     * Fetch data with session + UUID caching to reduce API calls.
     * Single-try design: tries once with current cache state, clears caches on failure.
     * External retry wrapper (fetchDataWithRetry) handles all retries.
     *
     * - Cold start: 3 calls (auth → login → fetch)
     * - Normal poll: 1 call (fetch with cached session)
     * - Session expired: returns error, clears sessionId. Next retry does login → fetch.
     */
    public fetchDataCached(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void {
        // Helper to handle fetch result
        const handleFetchResult = (error: any, response: request.Response, body: any) => {
            if (!response) {
                callback({ error: this.parseErrorResponse(undefined, error, body, "Fetch readings"), readings: [] });
            } else if (error != null || response.statusCode !== 200) {
                // Session invalid - clear it so next retry starts fresh
                console.log(`[${new Date().toISOString()}] Fetch failed, clearing session`);
                this._sessionId = null;
                callback({ error: this.parseErrorResponse(response.statusCode, error, body, "Fetch readings"), readings: [] });
            } else {
                try {
                    const rawReadings: DexcomRawReading[] = JSON.parse(body);
                    callback({ error: undefined, readings: rawReadings.map(r => new DexcomReadingImpl(r)) });
                } catch (parseError) {
                    callback({ error: this.parseErrorResponse(response.statusCode, parseError, body, "Parse readings"), readings: [] });
                }
            }
        };

        // Helper to handle login result then fetch
        const handleLoginResult = (error: any, response: request.Response, body: any) => {
            if (!response) {
                callback({ error: this.parseErrorResponse(undefined, error, body, "Login"), readings: [] });
            } else if (error != null || response.statusCode !== 200) {
                // AccountId may be stale - clear it so next retry does full auth
                console.log(`[${new Date().toISOString()}] Login failed, clearing accountId`);
                this._accountId = null;
                callback({ error: this.parseErrorResponse(response.statusCode, error, body, "Login"), readings: [] });
            } else {
                const sessionId = this.stripQuotes(body);
                if (!sessionId) {
                    callback({ error: this.parseErrorResponse(response.statusCode, "Invalid session response", body, "Login"), readings: [] });
                    return;
                }
                this._sessionId = sessionId;
                console.log(`[${new Date().toISOString()}] Session obtained`);
                this.fetchLatest(this._sessionId, maxCount, minutes, handleFetchResult);
            }
        };

        // Main logic - try with current cache state
        if (this._sessionId) {
            console.log(`[${new Date().toISOString()}] Using cached session`);
            this.fetchLatest(this._sessionId, maxCount, minutes, handleFetchResult);
        } else if (this._accountId) {
            console.log(`[${new Date().toISOString()}] Using cached accountId, need new session`);
            this.loginById(this._accountId, handleLoginResult);
        } else {
            console.log(`[${new Date().toISOString()}] Cold start, full authentication`);
            this.authenticatePublisherAccount((error: any, response: request.Response, body: any) => {
                if (!response) {
                    callback({ error: this.parseErrorResponse(undefined, error, body, "Authenticate"), readings: [] });
                } else if (error != null || response.statusCode !== 200) {
                    callback({ error: this.parseErrorResponse(response.statusCode, error, body, "Authenticate"), readings: [] });
                } else {
                    const accountId = this.stripQuotes(body);
                    if (!accountId) {
                        callback({ error: this.parseErrorResponse(response.statusCode, "Invalid accountId response", body, "Authenticate"), readings: [] });
                        return;
                    }
                    this._accountId = accountId;
                    console.log(`[${new Date().toISOString()}] AccountId cached`);
                    this.loginById(this._accountId, handleLoginResult);
                }
            });
        }
    }
}

export function DexcomApiFactory(server: string, username: string, password: string): DexcomApi {
    return new DexcomApiImpl(server, username, password);
}
