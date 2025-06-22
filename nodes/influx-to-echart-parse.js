module.exports = function(RED) {
    const utils = require('./utils');

    function InfluxToEchartParseNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        const node = this;

        node.on('input', function(msg) {
            if (!node.historyConfig) {
                node.error("No history configuration defined", msg);
                return;
            }

            // Parse InfluxDB data
            const historyData = {};
            const lines = Array.isArray(msg.payload) ? msg.payload : [];
            node.warn(`Input data: ${JSON.stringify(lines)}`);

            const logCallback = (message) => node.log(message);
            const parseConfig = {
                valueFields: ['_value', 'value'],
                timeFields: ['_time', 'time'],
                seriesNameFields: ['seriesName', '_field', '_measurement']
            };

            for (let item of lines) {
                try {
                    const parsed = utils.parseInfluxData(item, logCallback, parseConfig);
                    if (!parsed) continue;

                    const { seriesName, value, timestamp } = parsed;
                    if (!historyData[seriesName]) historyData[seriesName] = [];
                    historyData[seriesName].push({ timestamp, value });
                } catch (e) {
                    node.log(`Failed to parse item: ${JSON.stringify(item)}, error: ${e.message}`);
                }
            }

            node.warn(`Parsed historyData: ${JSON.stringify(historyData)}`);

            // Prepare ECharts configuration
            const legendData = [];
            const seriesData = [];
            let dataMin = Infinity, dataMax = -Infinity;
            let hasBooleanSeries = false;

            for (let seriesName in historyData) {
                let seriesDataPoints = historyData[seriesName] || [];
                const seriesConfig = node.historyConfig.series.find(s => s.seriesName === seriesName) || {};
                const isBooleanSeries = seriesConfig.seriesYtype === 'category' || 
                    seriesDataPoints.some(p => p.value === true || p.value === false);
                if (isBooleanSeries) hasBooleanSeries = true;

                const baseColor = seriesConfig.seriesColor || node.historyConfig.defaultColor || 'rgba(128, 128, 128, 1)';
                let gradientColors = [
                    { offset: 0, color: baseColor.replace(/rgba?\([^,]+,[^,]+,[^,]+,\s*[\d.]+\)/, m => m.replace(/[\d.]+$/, '0.5')) },
                    { offset: 1, color: baseColor.replace(/rgba?\([^,]+,[^,]+,[^,]+,\s*[\d.]+\)/, m => m.replace(/[\d.]+$/, '0.125')) }
                ];

                if (baseColor.startsWith('#')) {
                    const rgb = utils.hexToRgb(baseColor, logCallback, { r: 128, g: 128, b: 128 });
                    gradientColors = [
                        { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` },
                        { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.125)` }
                    ];
                }

                if (!isBooleanSeries) {
                    seriesDataPoints.forEach(point => {
                        if (point.value !== null && !isNaN(point.value)) {
                            dataMin = Math.min(dataMin, point.value);
                            dataMax = Math.max(dataMax, point.value);
                        }
                    });
                }

                legendData.push(seriesName);
                seriesData.push({
                    name: seriesName,
                    type: 'line',
                    smooth: isBooleanSeries ? false : true,
                    step: isBooleanSeries ? 'middle' : false,
                    symbol: 'none',
                    yAxisIndex: isBooleanSeries ? (hasBooleanSeries ? 1 : 0) : 0,
                    data: seriesDataPoints.map(point => [
                        point.timestamp,
                        isBooleanSeries ? (point.value === true ? 1 : point.value === false ? 0 : null) : point.value
                    ]),
                    lineStyle: { color: baseColor },
                    itemStyle: { color: baseColor },
                    areaStyle: isBooleanSeries ? null : {
                        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: gradientColors }
                    }
                });
            }

            // Default min/max
            if (dataMin === Infinity) dataMin = node.historyConfig.defaultMin || 0;
            if (dataMax === -Infinity) dataMax = node.historyConfig.defaultMax || 100;
            const range = dataMax - dataMin;
            const padding = range * (node.historyConfig.paddingRatio || 0.1) || 10;
            const paddedMin = Number((dataMin - padding).toFixed(2));
            const paddedMax = Number((dataMax + padding).toFixed(2));

            // Units
            const numericalUnits = node.historyConfig.series
                .filter(s => s.seriesYtype !== 'category')
                .map(s => s.seriesUnits)
                .filter(u => u)
                .join(', ') || node.historyConfig.defaultUnits || 'Value';
            const booleanUnits = node.historyConfig.series
                .filter(s => s.seriesYtype === 'category')
                .map(s => s.seriesUnits)
                .filter(u => u)
                .join(', ') || 'State';

            // Dynamic yAxis
            const yAxis = [
                {
                    type: 'value',
                    name: numericalUnits,
                    min: paddedMin,
                    max: paddedMax,
                    position: 'left'
                }
            ];
            if (hasBooleanSeries) {
                yAxis.push({
                    type: 'category',
                    name: booleanUnits,
                    data: ['OFF', 'ON'],
                    position: 'right',
                    axisLabel: { formatter: value => value }
                });
            }

            // Adjust yAxisIndex
            seriesData.forEach(series => {
                series.yAxisIndex = series.step === 'middle' && hasBooleanSeries ? 1 : 0;
            });

            // ECharts configuration
            msg.payload = {
                title: { text: node.historyConfig.name || 'Chart', left: 'center' },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'cross', snap: true },
                    formatter: function(params) {
                        const timestamp = params[0]?.value[0];
                        if (!timestamp) return '';
                        const date = new Date(timestamp);
                        let result = date.toLocaleString('en-US', { hour12: true });
                        params.forEach(p => {
                            const series = seriesData[p.seriesIndex];
                            const value = p.value[1];
                            if (value !== null && (series.yAxisIndex === (hasBooleanSeries ? 1 : 0) || !isNaN(value))) {
                                const displayValue = series.yAxisIndex === (hasBooleanSeries ? 1 : 0) ? (value === 1 ? 'ON' : 'OFF') : value.toFixed(2);
                                const units = series.yAxisIndex === (hasBooleanSeries ? 1 : 0) ? booleanUnits : numericalUnits;
                                result += `<br/>${series.name}: ${displayValue} ${units}`;
                            }
                        });
                        return result;
                    }
                },
                legend: { data: legendData, top: 30, type: 'scroll' },
                xAxis: {
                    type: 'time',
                    name: 'Time',
                    axisLabel: {
                        formatter: value => new Date(value).toLocaleString('en-US', {
                            hour12: true,
                            hour: 'numeric',
                            minute: '2-digit'
                        })
                    }
                },
                yAxis: yAxis,
                toolbox: { feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: {} } },
                dataZoom: [
                    { type: 'slider', xAxisIndex: 0, filterMode: 'filter' },
                    { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
                    { type: 'inside', yAxisIndex: 0, filterMode: 'filter', minValueSpan: paddedMin - 10, maxValueSpan: paddedMax + 10 }
                ],
                series: seriesData
            };

            node.warn(`ECharts config: ${JSON.stringify(msg.payload)}`);
            node.send(msg);
        });
    }

    RED.nodes.registerType("influx-to-echart-parse", InfluxToEchartParseNode);
};