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

    private stripQuotes(quotedString: string): string {
        return quotedString.substring(1, quotedString.length - 1);
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
                let accountId: string = this.stripQuotes(body as string);

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
                        let sessionId: string = this.stripQuotes(_body as string);

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
     * - Cold start: 3 calls (auth → login → fetch)
     * - Normal poll: 1 call (fetch with cached session)
     * - Session expired: 2 calls (login with cached UUID → fetch)
     */
    public fetchDataCached(callback: DexcomApiCallback, maxCount?: number, minutes?: number): void {
        if (this._sessionId) {
            // Try with cached session first
            this.fetchLatest(this._sessionId, maxCount, minutes, (error: any, response: request.Response, body: any) => {
                if (error != null || (response && response.statusCode !== 200)) {
                    // Session expired or error, clear session only (keep accountId for faster re-auth)
                    console.log(`[${new Date().toISOString()}] Session expired or fetch failed, re-authenticating...`);
                    this._sessionId = null;
                    this.fetchDataCached(callback, maxCount, minutes); // Retry with cached accountId
                } else if (!response) {
                    // No response object - network error
                    callback({
                        error: this.parseErrorResponse(undefined, error, body, "Fetch readings"),
                        readings: []
                    });
                } else {
                    // Success with cached session
                    try {
                        const rawReadings: DexcomRawReading[] = JSON.parse(body);
                        callback({
                            error: undefined,
                            readings: rawReadings.map(reading => new DexcomReadingImpl(reading))
                        });
                    } catch (parseError) {
                        callback({
                            error: this.parseErrorResponse(response.statusCode, parseError, body, "Parse readings"),
                            readings: []
                        });
                    }
                }
            });
        } else if (this._accountId) {
            // Have cached accountId, just need new session (2 API calls instead of 3)
            console.log(`[${new Date().toISOString()}] Using cached accountId, fetching new session...`);
            this.loginById(this._accountId, (error: any, response: request.Response, body: any) => {
                if (error != null || (response && response.statusCode !== 200)) {
                    // Login failed, clear accountId and do full auth
                    console.log(`[${new Date().toISOString()}] Login with cached accountId failed, doing full auth...`);
                    this._accountId = null;
                    this.fetchDataCached(callback, maxCount, minutes);
                } else if (!response) {
                    // No response object - network error
                    callback({
                        error: this.parseErrorResponse(undefined, error, body, "Login"),
                        readings: []
                    });
                } else {
                    this._sessionId = this.stripQuotes(body as string);
                    console.log(`[${new Date().toISOString()}] New session obtained`);
                    this.fetchDataCached(callback, maxCount, minutes); // Now fetch with new session
                }
            });
        } else {
            // Cold start: do full auth flow and cache both
            console.log(`[${new Date().toISOString()}] Cold start, doing full authentication...`);
            this.authenticatePublisherAccount((error: any, response: request.Response, body: any) => {
                if (error != null || (response && response.statusCode !== 200)) {
                    callback({
                        error: this.parseErrorResponse(response ? response.statusCode : undefined, error, body, "Authenticate"),
                        readings: []
                    });
                } else if (!response) {
                    // No response object - network error
                    callback({
                        error: this.parseErrorResponse(undefined, error, body, "Authenticate"),
                        readings: []
                    });
                } else {
                    this._accountId = this.stripQuotes(body as string);
                    console.log(`[${new Date().toISOString()}] Account UUID cached`);
                    this.fetchDataCached(callback, maxCount, minutes); // Continue with login
                }
            });
        }
    }
}

export function DexcomApiFactory(server: string, username: string, password: string): DexcomApi {
    return new DexcomApiImpl(server, username, password);
}
