import request from "request";
import * as qs from "qs";
import https from "https";
import { DexcomApi } from "./DexcomApi";
import { DexcomApiCallback } from "./DexcomApiCallback";
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

    private login(callback?: request.RequestCallback): request.Request {
        return this.doPost(
            this._server + "/ShareWebServices/Services/General/LoginPublisherAccountByName",
            {
                "accountName": this._username,
                "password": this._password,
                "applicationId": DexcomApiImpl.APPLICATION_ID
            } as AuthRequestBody,
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
                let accountId: string = (body as string).substring(1, (body as string).length - 1);
                
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
                        let sessionId: string = (_body as string).substring(1, (_body as string).length - 1);
                        
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
}

export function DexcomApiFactory(server: string, username: string, password: string): DexcomApi {
    return new DexcomApiImpl(server, username, password);
}
