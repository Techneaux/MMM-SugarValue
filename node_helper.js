(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(require('request'), require('qs'), require('https')) :
    typeof define === 'function' && define.amd ? define(['request', 'qs', 'https'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.request, global.qs, global.https));
})(this, (function (request, qs, https) { 'use strict';

    function _interopNamespaceDefault(e) {
        var n = Object.create(null);
        if (e) {
            Object.keys(e).forEach(function (k) {
                if (k !== 'default') {
                    var d = Object.getOwnPropertyDescriptor(e, k);
                    Object.defineProperty(n, k, d.get ? d : {
                        enumerable: true,
                        get: function () { return e[k]; }
                    });
                }
            });
        }
        n.default = e;
        return Object.freeze(n);
    }

    var qs__namespace = /*#__PURE__*/_interopNamespaceDefault(qs);

    var DexcomTrend;
    (function (DexcomTrend) {
        DexcomTrend[DexcomTrend["NONE"] = 0] = "NONE";
        DexcomTrend[DexcomTrend["DOUBLE_UP"] = 1] = "DOUBLE_UP";
        DexcomTrend[DexcomTrend["SINGLE_UP"] = 2] = "SINGLE_UP";
        DexcomTrend[DexcomTrend["FORTYFIVE_UP"] = 3] = "FORTYFIVE_UP";
        DexcomTrend[DexcomTrend["FLAT"] = 4] = "FLAT";
        DexcomTrend[DexcomTrend["FORTYFIVE_DOWN"] = 5] = "FORTYFIVE_DOWN";
        DexcomTrend[DexcomTrend["SINGLE_DOWN"] = 6] = "SINGLE_DOWN";
        DexcomTrend[DexcomTrend["DOUBLE_DOWN"] = 7] = "DOUBLE_DOWN";
        DexcomTrend[DexcomTrend["NOT_COMPUTABLE"] = 8] = "NOT_COMPUTABLE";
        DexcomTrend[DexcomTrend["RATE_OUT_OF_RANGE"] = 9] = "RATE_OUT_OF_RANGE";
    })(DexcomTrend || (DexcomTrend = {}));

    var TREND_ENUM_MAP = {
        "0": DexcomTrend.NONE,
        "1": DexcomTrend.DOUBLE_UP,
        "2": DexcomTrend.SINGLE_UP,
        "3": DexcomTrend.FORTYFIVE_UP,
        "4": DexcomTrend.FLAT,
        "5": DexcomTrend.FORTYFIVE_DOWN,
        "6": DexcomTrend.SINGLE_DOWN,
        "7": DexcomTrend.DOUBLE_DOWN,
        "8": DexcomTrend.NOT_COMPUTABLE,
        "9": DexcomTrend.RATE_OUT_OF_RANGE,
        'NONE': DexcomTrend.NONE,
        'DOUBLEUP': DexcomTrend.DOUBLE_UP,
        'SINGLEUP': DexcomTrend.SINGLE_UP,
        'FORTYFIVEUP': DexcomTrend.FORTYFIVE_UP,
        'FLAT': DexcomTrend.FLAT,
        'FORTYFIVEDOWN': DexcomTrend.FORTYFIVE_DOWN,
        'SINGLEDOWN': DexcomTrend.SINGLE_DOWN,
        'DOUBLEDOWN': DexcomTrend.DOUBLE_DOWN,
        'NOT COMPUTABLE': DexcomTrend.NOT_COMPUTABLE,
        'RATE OUT OF RANGE': DexcomTrend.RATE_OUT_OF_RANGE
    };
    var DexcomReadingImpl = /** @class */ (function () {
        function DexcomReadingImpl(raw) {
            var dateMatch = raw.WT.match(/\((.*)\)/);
            this.date = dateMatch === null || dateMatch.length == 0 ? undefined : new Date(parseInt(dateMatch[1]));
            this.sugarMg = raw.Value;
            this.sugarMmol = Math.floor(10 * (raw.Value / 18.0)) / 10;
            this.trend = DexcomReadingImpl.convertTrend(raw.Trend);
        }
        DexcomReadingImpl.convertTrend = function (trend) {
            return trend === undefined ? DexcomTrend.NONE : TREND_ENUM_MAP[trend.toString().toUpperCase()];
        };
        return DexcomReadingImpl;
    }());

    var DexcomApiImpl = /** @class */ (function () {
        function DexcomApiImpl(server, username, password) {
            // Cached credentials to reduce API calls
            this._accountId = null; // Cached permanently until module restart
            this._sessionId = null; // Cached until it expires (non-200 response)
            this._server = server;
            this._username = username;
            this._password = password;
        }
        DexcomApiImpl.prototype.doPost = function (uri, body, callback) {
            var bodyAsString = body == undefined ? "" : JSON.stringify(body);
            console.log("POST", uri, bodyAsString);
            return request({
                uri: "https://" + uri,
                method: "POST",
                timeout: 20000,
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
            }, callback);
        };
        DexcomApiImpl.prototype.stripQuotes = function (body) {
            if (typeof body !== 'string' || body.length < 2) {
                return null;
            }
            if (body[0] !== '"' || body[body.length - 1] !== '"') {
                return null;
            }
            return body.substring(1, body.length - 1);
        };
        // Parse Dexcom error responses for better error messages
        DexcomApiImpl.prototype.parseErrorResponse = function (statusCode, error, body, step) {
            var message = step + " failed";
            var resolvedStatusCode = statusCode !== undefined ? statusCode : -1;
            // Try to parse Dexcom's JSON error response (contains Code, Message, SubCode)
            if (body && typeof body === 'string') {
                try {
                    var parsed = JSON.parse(body);
                    if (parsed.Message) {
                        message = step + ": " + parsed.Message;
                        if (parsed.Code)
                            message += " (" + parsed.Code + ")";
                    }
                }
                catch (e) {
                    // Not JSON, use raw error if available
                    if (error)
                        message = step + ": " + error;
                }
            }
            else if (error) {
                message = step + ": " + error;
            }
            return {
                statusCode: resolvedStatusCode,
                message: message
            };
        };
        DexcomApiImpl.prototype.authenticatePublisherAccount = function (callback) {
            return this.doPost(this._server + "/ShareWebServices/Services/General/AuthenticatePublisherAccount", {
                "accountName": this._username,
                "password": this._password,
                "applicationId": DexcomApiImpl.APPLICATION_ID
            }, callback);
        };
        DexcomApiImpl.prototype.loginById = function (accountId, callback) {
            return this.doPost(this._server + "/ShareWebServices/Services/General/LoginPublisherAccountById", {
                "accountId": accountId,
                "password": this._password,
                "applicationId": DexcomApiImpl.APPLICATION_ID
            }, callback);
        };
        DexcomApiImpl.prototype.fetchLatest = function (sessionId, maxCount, minutes, callback) {
            return this.doPost(this._server + "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?" + qs__namespace.stringify({
                sessionID: sessionId,
                minutes: minutes === undefined ? 1440 : Math.max(1, minutes),
                maxCount: maxCount === undefined ? 1 : Math.max(1, maxCount),
            }), undefined, callback);
        };
        /**
         * Fetch data with session + UUID caching to reduce API calls.
         * Single-try design: tries once with current cache state, clears caches on failure.
         * External retry wrapper (fetchDataWithRetry) handles all retries.
         *
         * - Cold start: 3 calls (auth → login → fetch)
         * - Normal poll: 1 call (fetch with cached session)
         * - Session expired: returns error, clears sessionId. Next retry does login → fetch.
         */
        DexcomApiImpl.prototype.fetchDataCached = function (callback, maxCount, minutes) {
            var _this = this;
            // Helper to handle fetch result
            var handleFetchResult = function (error, response, body) {
                if (!response) {
                    callback({ error: _this.parseErrorResponse(undefined, error, body, "Fetch readings"), readings: [] });
                }
                else if (error != null || response.statusCode !== 200) {
                    // Session invalid - clear it so next retry starts fresh
                    console.log("[" + new Date().toISOString() + "] Fetch failed, clearing session");
                    _this._sessionId = null;
                    callback({ error: _this.parseErrorResponse(response.statusCode, error, body, "Fetch readings"), readings: [] });
                }
                else {
                    try {
                        var rawReadings = JSON.parse(body);
                        callback({ error: undefined, readings: rawReadings.map(function (r) { return new DexcomReadingImpl(r); }) });
                    }
                    catch (parseError) {
                        callback({ error: _this.parseErrorResponse(response.statusCode, parseError, body, "Parse readings"), readings: [] });
                    }
                }
            };
            // Helper to handle login result then fetch
            var handleLoginResult = function (error, response, body) {
                if (!response) {
                    callback({ error: _this.parseErrorResponse(undefined, error, body, "Login"), readings: [] });
                }
                else if (error != null || response.statusCode !== 200) {
                    // AccountId may be stale - clear it so next retry does full auth
                    console.log("[" + new Date().toISOString() + "] Login failed, clearing accountId");
                    _this._accountId = null;
                    callback({ error: _this.parseErrorResponse(response.statusCode, error, body, "Login"), readings: [] });
                }
                else {
                    var sessionId = _this.stripQuotes(body);
                    if (!sessionId) {
                        callback({ error: _this.parseErrorResponse(response.statusCode, "Invalid session response", body, "Login"), readings: [] });
                        return;
                    }
                    _this._sessionId = sessionId;
                    console.log("[" + new Date().toISOString() + "] Session obtained");
                    _this.fetchLatest(_this._sessionId, maxCount, minutes, handleFetchResult);
                }
            };
            // Main logic - try with current cache state
            if (this._sessionId) {
                console.log("[" + new Date().toISOString() + "] Using cached session");
                this.fetchLatest(this._sessionId, maxCount, minutes, handleFetchResult);
            }
            else if (this._accountId) {
                console.log("[" + new Date().toISOString() + "] Using cached accountId, need new session");
                this.loginById(this._accountId, handleLoginResult);
            }
            else {
                console.log("[" + new Date().toISOString() + "] Cold start, full authentication");
                this.authenticatePublisherAccount(function (error, response, body) {
                    if (!response) {
                        callback({ error: _this.parseErrorResponse(undefined, error, body, "Authenticate"), readings: [] });
                    }
                    else if (error != null || response.statusCode !== 200) {
                        callback({ error: _this.parseErrorResponse(response.statusCode, error, body, "Authenticate"), readings: [] });
                    }
                    else {
                        var accountId = _this.stripQuotes(body);
                        if (!accountId) {
                            callback({ error: _this.parseErrorResponse(response.statusCode, "Invalid accountId response", body, "Authenticate"), readings: [] });
                            return;
                        }
                        _this._accountId = accountId;
                        console.log("[" + new Date().toISOString() + "] AccountId cached");
                        _this.loginById(_this._accountId, handleLoginResult);
                    }
                });
            }
        };
        DexcomApiImpl.APPLICATION_ID = "d89443d2-327c-4a6f-89e5-496bbb0317db";
        DexcomApiImpl.AGENT = "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0";
        DexcomApiImpl.CONTENT_TYPE = "application/json";
        DexcomApiImpl.ACCEPT = "application/json";
        return DexcomApiImpl;
    }());
    function DexcomApiFactory(server, username, password) {
        return new DexcomApiImpl(server, username, password);
    }

    var ModuleNotification;
    (function (ModuleNotification) {
        ModuleNotification["CONFIG"] = "CONFIG";
        ModuleNotification["DATA"] = "DATA";
        ModuleNotification["ALL_MODULES_STARTED"] = "ALL_MODULES_STARTED";
    })(ModuleNotification || (ModuleNotification = {}));

    var NodeHelper = require("node_helper");
    module.exports = NodeHelper.create({
        socketNotificationReceived: function (notification, payload) {
            var _this = this;
            switch (notification) {
                case ModuleNotification.CONFIG:
                    var config_1 = payload.config;
                    if (config_1 !== undefined) {
                        var api_1 = DexcomApiFactory(config_1.serverUrl, config_1.username, config_1.password);
                        setTimeout(function () {
                            _this.fetchData(api_1, config_1.updateSecs);
                        }, 500);
                    }
                    break;
            }
        },
        // stop: () => {
        //     stopped = true;
        // },
        fetchData: function (api, updateSecs) {
            var _this = this;
            var callbackInvoked = false;
            var timeoutMs = 70000; // 70 second timeout (3 attempts × 20s per request + ~7s backoff delays)
            // Set timeout to detect if API call gets stuck
            var timeoutId = setTimeout(function () {
                if (!callbackInvoked) {
                    console.error("[" + new Date().toISOString() + "] Dexcom API call timed out after " + timeoutMs + "ms");
                    _this._sendSocketNotification(ModuleNotification.DATA, {
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
                this.fetchDataWithRetry(api, function (response) {
                    callbackInvoked = true;
                    clearTimeout(timeoutId);
                    _this._sendSocketNotification(ModuleNotification.DATA, { apiResponse: response });
                }, 3, 1);
            }
            catch (error) {
                callbackInvoked = true; // Prevent timeout from also firing
                console.error("[" + new Date().toISOString() + "] Exception in fetchData:", error);
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
            setTimeout(function () {
                _this.fetchData(api, updateSecs);
            }, updateSecs * 1000);
        },
        // Retry wrapper - retries are silent (no UI update until final result)
        fetchDataWithRetry: function (api, callback, maxRetries, attempt) {
            var _this = this;
            api.fetchDataCached(function (response) {
                if (response.error && attempt < maxRetries) {
                    var delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
                    console.log("[" + new Date().toISOString() + "] Attempt " + attempt + "/" + maxRetries + " failed: " + response.error.message + ". Retrying in " + delay + "ms...");
                    setTimeout(function () {
                        _this.fetchDataWithRetry(api, callback, maxRetries, attempt + 1);
                    }, delay);
                }
                else {
                    // Only callback (which triggers UI update) on success or final failure
                    if (response.error) {
                        console.error("[" + new Date().toISOString() + "] All " + maxRetries + " attempts failed: " + response.error.message);
                    }
                    callback(response);
                }
            }, 1);
        },
        _sendSocketNotification: function (notification, payload) {
            console.log("Sending", notification, payload);
            if (this.sendSocketNotification !== undefined) {
                this.sendSocketNotification(notification, payload);
            }
            else {
                console.error("sendSocketNotification is not present");
            }
        },
    });

}));
