import { DexcomReading, DexcomTrend, DexcomApiResponse } from "./dexcom";
import { Config } from "./Config";
import { NotificationPayload } from "./NotificationPayload";
import { ModuleNotification } from "./ModuleNotification";
import moment from 'moment';

declare var Chart: any;  // Chart.js loaded via CDN

interface MagicMirrorApi {
    config?: Config;
    getStyles?(): string[],
    updateDom?(): void;
    notificationReceived?(notification: string, payload: any, sender: any): void;
    socketNotificationReceived?(notification: ModuleNotification, payload: NotificationPayload): void;
    sendSocketNotification?(notification: ModuleNotification, payload: NotificationPayload): void;
}

interface MagicMirrorOptions extends MagicMirrorApi {
    defaults: Config;
    message: string | undefined;
    isError: boolean;  // Track if current message is an error
    reading: DexcomReading | undefined;
    clockSpan: HTMLSpanElement | undefined;

    // Modal state
    isModalOpen: boolean;
    modalElement: HTMLDivElement | undefined;
    chartInstance: any;
    selectedTimeRange: number;
    isLoadingHistory: boolean;
    historyRequestId: number;

    getDom: () => HTMLDivElement;
    getScripts: () => string[];
    start: () => void;
    _sendSocketNotification(notification: string, payload: NotificationPayload): void;
    _updateDom(): void;
    _createIcon(className: string): HTMLSpanElement;
    _openModal(): void;
    _closeModal(): void;
    _createModalDom(): HTMLDivElement;
    _renderChart(readings: DexcomReading[]): void;
    _requestHistoryData(minutes: number): void;
    _updateTimeRangeButtons(minutes: number): void;
}

interface MagicMirrorModule {
    register(name: string, options: MagicMirrorOptions): void;
}

declare var Module: MagicMirrorModule;

Module.register("MMM-SugarValue", {
    defaults: {
        "usServerUrl": "share1.dexcom.com",
        "euServerUrl": "shareous1.dexcom.com",
        "server": "us",
        "updateSecs": 300,
        "units": "mmol"
    } as Config,
    getStyles(): string[] {
        return[ 'sugarvalue.css' ]
    },
    getScripts(): string[] {
        return [
            "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
        ];
    },
    message: "Loading...",
    isError: false,
    reading: undefined,
    clockSpan: undefined,
    // Modal state
    isModalOpen: false,
    modalElement: undefined,
    chartInstance: undefined,
    selectedTimeRange: 180,
    isLoadingHistory: false,
    historyRequestId: 0,
    getDom(): HTMLDivElement {
        const wrapper: HTMLDivElement = document.createElement("div");
        wrapper.className = "mmm-sugar-value";

        // Add click handler to open modal
        wrapper.addEventListener("click", (e) => {
            e.stopPropagation();
            this._openModal();
        });

        if (this.message !== undefined) {
            wrapper.innerText = this.message;
            // Style error messages with red text
            if (this.isError) {
                wrapper.className += " dimmed light small text-danger";
            }
        } else if (this.reading == undefined) {
            wrapper.innerText = "Reading not available";
        } else if (this.config !== undefined) {
            const reading: HTMLDivElement = document.createElement("div");
            const date: HTMLDivElement = document.createElement("div");

            if (this.reading.date !== undefined) {
                date.innerText = moment(this.reading.date).fromNow();
                date.className = "dimmed small";
            }

            const sugar: HTMLSpanElement = document.createElement("span");
            const units: HTMLSpanElement = document.createElement("span");
            sugar.className = "bright medium";
            units.className = "dimmed small";
            let sugarValue: number;
            if (this.config.units === "mg") {
                sugarValue = this.reading.sugarMg;
                sugar.innerText = this.reading.sugarMg.toString();
                units.innerText = " mg/dL";
            } else {
                sugarValue = this.reading.sugarMmol;
                sugar.innerText = this.reading.sugarMmol.toString();
                units.innerText = " mmol/L";
            }

            if (this.config.lowlimit !== undefined && sugarValue <= this.config.lowlimit) {
                sugar.className += " text-danger";
            }

            if (this.config.highlimit !== undefined && sugarValue >= this.config.highlimit) {
                sugar.className += " text-warning";
            }

            const trend: HTMLSpanElement = document.createElement("span");
            trend.className = "small";

            switch (this.reading.trend) {
                case DexcomTrend.DOUBLE_DOWN:
                    trend.appendChild(this._createIcon("fa-arrow-down"));
                    trend.appendChild(this._createIcon("fa-arrow-down"));
                    trend.className += " text-warning";
                    break;
                case DexcomTrend.DOUBLE_UP:
                    trend.appendChild(this._createIcon("fa-arrow-up"));
                    trend.appendChild(this._createIcon("fa-arrow-up"));
                    trend.className += " text-warning";
                    break;
                case DexcomTrend.FLAT:
                    trend.appendChild(this._createIcon("fa-arrow-right"));
                    break;
                case DexcomTrend.FORTYFIVE_DOWN:
                    trend.appendChild(this._createIcon("fa-arrow-right fa-rotate-45"));
                    break;
                case DexcomTrend.FORTYFIVE_UP:
                    trend.appendChild(this._createIcon("fa-arrow-up fa-rotate-45"));
                    break;
                case DexcomTrend.NONE:
                    break;
                case DexcomTrend.NOT_COMPUTABLE:
                    trend.appendChild(this._createIcon("fa-question-circle"));
                    break;
                case DexcomTrend.RATE_OUT_OF_RANGE:
                    trend.appendChild(this._createIcon("fa-exclamation-triangle"));
                    break;
                case DexcomTrend.SINGLE_DOWN:
                    trend.appendChild(this._createIcon("fa-arrow-down"));
                    break;
                case DexcomTrend.SINGLE_UP:
                    trend.appendChild(this._createIcon("fa-arrow-up"));
                    break;
            }

            reading.appendChild(trend);
            reading.appendChild(sugar);
            reading.appendChild(units);
            wrapper.appendChild(reading);
            wrapper.appendChild(date);
            this.clockSpan = date;
        }
        return wrapper;
    },
    start():void {
        console.log("Starting");
        const config: Config | undefined = this.config;
        if (config == undefined) {
            this.message = "Configuration is not defined";
        } else {
            config.serverUrl = config.server === "us" ? config.usServerUrl : config.euServerUrl;
            if (config.username === undefined || config.password === undefined) {
                this.message = "Username or password not configured";
            } else {
                this.message = this.message;
            }
        }
        this._updateDom();
        setInterval(() => {
            if (this.clockSpan !== undefined && this.reading !== undefined && this.reading.date !== undefined) {
                this.clockSpan.textContent = moment(this.reading.date).fromNow();
            }
        }, 30000);
    },
    notificationReceived(notification: string, payload: any, sender: any): void {
        if (notification === "ALL_MODULES_STARTED") {
            this._sendSocketNotification(ModuleNotification.CONFIG, { config: this.config } );
        }
    },
    socketNotificationReceived(notification: ModuleNotification, payload: NotificationPayload): void {
        if (notification === ModuleNotification.DATA) {
            const apiResponse: DexcomApiResponse | undefined = payload.apiResponse;
            if (apiResponse !== undefined) {
                if (apiResponse.error !== undefined) {
                    // Format error message with status code
                    const statusCode = apiResponse.error.statusCode;
                    const errorMsg = apiResponse.error.message;
                    this.message = statusCode === -1
                        ? errorMsg  // Network errors don't need status code shown
                        : `${errorMsg} (HTTP ${statusCode})`;
                    this.isError = true;
                } else {
                    this.reading = apiResponse.readings.length > 0 ? apiResponse.readings[0] : undefined;
                    this.message = undefined;
                    this.isError = false;
                }
                // Always update the main display
                this._updateDom();
                // If modal is open, refresh the chart with latest data
                if (this.isModalOpen) {
                    this._requestHistoryData(this.selectedTimeRange);
                }
            }
        }
        if (notification === ModuleNotification.HISTORY_DATA) {
            // Ignore outdated responses (race condition prevention)
            const requestId = payload.historyRequest ? payload.historyRequest.requestId : undefined;
            if (requestId !== undefined && requestId !== this.historyRequestId) {
                return; // Ignore outdated response
            }

            this.isLoadingHistory = false;

            // Hide loading indicator
            const loading = document.getElementById("sugar-loading");
            if (loading) {
                loading.classList.add("hidden");
            }

            const historyResponse = payload.historyResponse;
            if (historyResponse && !historyResponse.error) {
                this._renderChart(historyResponse.readings);
            } else if (historyResponse && historyResponse.error) {
                console.error("History fetch error:", historyResponse.error);
                // Show error in chart area
                const chartContainer = document.getElementById("sugar-history-chart");
                if (chartContainer && chartContainer.parentElement) {
                    // Remove any existing error messages first
                    const existingError = chartContainer.parentElement.querySelector('.sugar-chart-error');
                    if (existingError) {
                        existingError.remove();
                    }

                    const errorDiv = document.createElement("div");
                    errorDiv.className = "sugar-chart-error";
                    errorDiv.textContent = "Failed to load history data";
                    chartContainer.parentElement.appendChild(errorDiv);
                }
            }
        }
    },
    _sendSocketNotification(notification: ModuleNotification, payload: NotificationPayload): void {
        if (this.sendSocketNotification !== undefined) {
            this.sendSocketNotification(notification, payload);
        } else {
            console.error("sendSocketNotification is not present");
        }
    },
    _updateDom(): void {
        if (this.updateDom !== undefined) {
            this.updateDom();
        }
    },
    _createIcon(className: string): HTMLSpanElement {
        const icon:HTMLSpanElement = document.createElement("span");
        icon.className = "fa fa-fw " + className;
        return icon;
    },
    _openModal(): void {
        if (this.isModalOpen) return;

        this.isModalOpen = true;
        this.selectedTimeRange = 180;  // Default 3 hours

        // Create and append modal to body (not module wrapper)
        this.modalElement = this._createModalDom();
        document.body.appendChild(this.modalElement);

        // Request initial history data
        this._requestHistoryData(this.selectedTimeRange);
    },
    _closeModal(): void {
        if (!this.isModalOpen) return;

        this.isModalOpen = false;

        // Destroy chart instance to prevent memory leaks
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = undefined;
        }

        // Remove modal from DOM
        if (this.modalElement) {
            document.body.removeChild(this.modalElement);
            this.modalElement = undefined;
        }
    },
    _createModalDom(): HTMLDivElement {
        const self = this;

        const overlay = document.createElement("div");
        overlay.className = "sugar-modal-overlay";
        overlay.id = "sugar-history-modal";

        // Click outside to close
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                self._closeModal();
            }
        });

        const modal = document.createElement("div");
        modal.className = "sugar-modal";

        // Header with title and close button
        const header = document.createElement("div");
        header.className = "sugar-modal-header";

        const title = document.createElement("h3");
        title.textContent = "Glucose History";

        const closeBtn = document.createElement("button");
        closeBtn.className = "sugar-modal-close";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => self._closeModal());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Time range selector buttons
        const timeSelector = document.createElement("div");
        timeSelector.className = "sugar-time-selector";

        const timeRanges = [
            { label: "3h", minutes: 180 },
            { label: "6h", minutes: 360 },
            { label: "12h", minutes: 720 },
            { label: "24h", minutes: 1440 }
        ];

        timeRanges.forEach(range => {
            const btn = document.createElement("button");
            btn.className = "sugar-time-btn";
            btn.dataset.minutes = range.minutes.toString();
            btn.textContent = range.label;
            if (range.minutes === self.selectedTimeRange) {
                btn.classList.add("active");
            }
            btn.addEventListener("click", () => {
                self._requestHistoryData(range.minutes);
            });
            timeSelector.appendChild(btn);
        });

        // Chart container
        const chartContainer = document.createElement("div");
        chartContainer.className = "sugar-chart-container";

        const canvas = document.createElement("canvas");
        canvas.id = "sugar-history-chart";
        chartContainer.appendChild(canvas);

        // Loading indicator
        const loading = document.createElement("div");
        loading.className = "sugar-loading";
        loading.id = "sugar-loading";
        loading.textContent = "Loading...";
        chartContainer.appendChild(loading);

        modal.appendChild(header);
        modal.appendChild(timeSelector);
        modal.appendChild(chartContainer);
        overlay.appendChild(modal);

        return overlay;
    },
    _renderChart(readings: DexcomReading[]): void {
        const canvas = document.getElementById("sugar-history-chart") as HTMLCanvasElement;
        if (!canvas) return;

        // Destroy existing chart if present
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        // Sort readings by date (oldest first for chronological graph)
        // Note: dates may be strings after JSON serialization through socket
        const sortedReadings = [...readings].sort((a, b) => {
            const dateA = a.date ? new Date(a.date as any).getTime() : 0;
            const dateB = b.date ? new Date(b.date as any).getTime() : 0;
            return dateA - dateB;
        });

        const usesMg = this.config && this.config.units === "mg";
        const unitLabel = usesMg ? "mg/dL" : "mmol/L";

        // Prepare chart data as {x: timestamp, y: value} for linear time scale
        const chartData = sortedReadings.map(r => ({
            x: r.date ? new Date(r.date as any).getTime() : Date.now(),
            y: usesMg ? r.sugarMg : r.sugarMmol
        }));

        // Handle empty data case FIRST (before calculations that use Math.min/max)
        if (chartData.length === 0) {
            const chartContainer = document.getElementById("sugar-history-chart");
            if (chartContainer && chartContainer.parentElement) {
                // Remove any existing error messages first
                const existingError = chartContainer.parentElement.querySelector('.sugar-chart-error');
                if (existingError) {
                    existingError.remove();
                }
                const noDataDiv = document.createElement("div");
                noDataDiv.className = "sugar-chart-error";
                noDataDiv.textContent = "No data available for this time range";
                chartContainer.parentElement.appendChild(noDataDiv);
            }
            return;
        }

        // Use actual data bounds for x-axis (no padding, no rounding)
        const timestamps = chartData.map(d => d.x);
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);

        // Get threshold limits for annotations
        const lowLimit = this.config ? this.config.lowlimit : undefined;
        const highLimit = this.config ? this.config.highlimit : undefined;

        // Build threshold line annotations
        const annotations: any = {};

        if (lowLimit !== undefined) {
            annotations.lowLine = {
                type: 'line',
                yMin: lowLimit,
                yMax: lowLimit,
                borderColor: '#dc3545',
                borderWidth: 2,
                borderDash: [5, 5]
            };
        }

        if (highLimit !== undefined) {
            annotations.highLine = {
                type: 'line',
                yMin: highLimit,
                yMax: highLimit,
                borderColor: '#ffc107',
                borderWidth: 2,
                borderDash: [5, 5]
            };
        }

        // Build chart configuration
        const chartConfig: any = {
            type: 'line',
            data: {
                datasets: [{
                    label: `Glucose (${unitLabel})`,
                    data: chartData,
                    borderColor: '#4fc3f7',
                    backgroundColor: '#4fc3f7',
                    fill: false,
                    showLine: false,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    clip: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false
                    },
                    datalabels: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: minTime,
                        max: maxTime,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#aaa',
                            stepSize: 3600000, // 1 hour in milliseconds
                            callback: function(value: number) {
                                return moment(value).format("h A");
                            }
                        }
                    },
                    y: {
                        position: 'right',
                        min: usesMg ? 0 : 0,
                        max: usesMg ? 450 : 25,
                        afterBuildTicks: function(axis: any) {
                            if (usesMg) {
                                // Ticks at 50, 100, 150, 200, 250, 300, 350, 400
                                axis.ticks = [50, 100, 150, 200, 250, 300, 350, 400].map(v => ({ value: v }));
                            } else {
                                axis.ticks = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20].map(v => ({ value: v }));
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        border: {
                            display: true,
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#aaa',
                            callback: function(value: number) {
                                // Show labels for 50, 100, 150, 200, 250, 300, 350, 400
                                if (usesMg) {
                                    return [50, 100, 150, 200, 250, 300, 350, 400].indexOf(value) >= 0 ? value : '';
                                } else {
                                    return [5, 10, 15, 20].indexOf(value) >= 0 ? value : '';
                                }
                            }
                        }
                    }
                }
            }
        };

        // Draw custom lines using afterDraw hook
        chartConfig.plugins = [{
            afterDraw: (chart: any) => {
                const ctx = chart.ctx;
                const yAxis = chart.scales.y;
                const xAxis = chart.scales.x;

                // Draw top and bottom border lines
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.lineWidth = 1;
                // Top line
                ctx.moveTo(xAxis.left, yAxis.top);
                ctx.lineTo(xAxis.right, yAxis.top);
                // Bottom line
                ctx.moveTo(xAxis.left, yAxis.bottom);
                ctx.lineTo(xAxis.right, yAxis.bottom);
                ctx.stroke();
                ctx.restore();

                // Draw threshold lines if configured
                if (lowLimit !== undefined) {
                    const yPos = yAxis.getPixelForValue(lowLimit);
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = '#dc3545';
                    ctx.lineWidth = 2;
                    ctx.moveTo(xAxis.left, yPos);
                    ctx.lineTo(xAxis.right, yPos);
                    ctx.stroke();
                    ctx.restore();
                }

                if (highLimit !== undefined) {
                    const yPos = yAxis.getPixelForValue(highLimit);
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = '#ffc107';
                    ctx.lineWidth = 2;
                    ctx.moveTo(xAxis.left, yPos);
                    ctx.lineTo(xAxis.right, yPos);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }];

        // Create chart
        this.chartInstance = new Chart(canvas, chartConfig);
    },
    _requestHistoryData(minutes: number): void {
        this.selectedTimeRange = minutes;
        this.isLoadingHistory = true;
        this.historyRequestId = Date.now();

        // Update button states
        this._updateTimeRangeButtons(minutes);

        // Show loading indicator
        const loading = document.getElementById("sugar-loading");
        if (loading) {
            loading.classList.remove("hidden");
        }

        // Send request to backend
        this._sendSocketNotification(ModuleNotification.REQUEST_HISTORY, {
            historyRequest: { minutes, requestId: this.historyRequestId }
        });
    },
    _updateTimeRangeButtons(minutes: number): void {
        const buttons = document.querySelectorAll(".sugar-time-btn");
        buttons.forEach(btn => {
            const btnMinutes = parseInt((btn as HTMLButtonElement).dataset.minutes || "0");
            if (btnMinutes === minutes) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }
});

