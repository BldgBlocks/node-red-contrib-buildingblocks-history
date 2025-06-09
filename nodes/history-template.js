module.exports = function(RED) {
    function HistoryTemplateNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        this.name = config.name;
        const node = this;

        node.on('input', function(msg) {
            if (!node.historyConfig) {
                node.error("No history configuration defined", msg);
                return;
            }
            const bucket = node.historyConfig.name;
            if (!bucket) {
                node.error("No bucket defined in history configuration", msg);
                return;
            }

            // Parse input data (line protocol or JSON objects)
            const historyData = {};
            const lines = Array.isArray(msg.payload) ? msg.payload : [];

            for (let item of lines) {
                try {
                    let seriesName, value, timestamp;
                    if (typeof item === 'string') {
                        // Parse line protocol
                        const match = item.match(/^(.+?) (value=[0-9.]+) ([0-9]+)$/);
                        if (!match) {
                            node.log(`Skipped invalid line: ${item}`);
                            continue;
                        }
                        const [_, measurementTags, fields, ts] = match;

                        const tagPairs = measurementTags.split(/(?<!\\),/);
                        const tags = {};
                        tagPairs.forEach(pair => {
                            const [key, val] = pair.split(/(?<!\\)=/);
                            if (key && val) {
                                tags[key] = val.replace(/\\ /g, ' ').replace(/\\,/g, ',').replace(/\\=/g, '=');
                            }
                        });

                        const fieldPairs = fields.split(/(?<!\\),/);
                        const values = {};
                        fieldPairs.forEach(pair => {
                            const [key, val] = pair.split(/(?<!\\)=/);
                            if (key && val) {
                                values[key] = parseFloat(val);
                            }
                        });

                        seriesName = tags.seriesName || tagPairs[0];
                        value = values.value;
                        timestamp = parseInt(ts) / 1e6; // ns to ms
                    } else if (typeof item === 'object' && item !== null) {
                        // Parse JSON object
                        seriesName = item.seriesName || item._measurement || item.measurement;
                        value = item.value !== undefined ? item.value :
                                item._value !== undefined ? parseFloat(item._value) :
                                item.Value !== undefined ? parseFloat(item.Value) : undefined;
                        // Handle timestamp
                        const time = item.time || item._time || item.Time;
                        if (!time) {
                            node.log(`Skipped object missing time: ${JSON.stringify(item)}`);
                            continue;
                        }
                        timestamp = typeof time === 'string' ? new Date(time + (time.includes('Z') ? '' : 'Z')).getTime() :
                                    typeof time === 'number' ? time / 1e6 :
                                    parseInt(time) / 1e6;
                    } else {
                        node.log(`Skipped invalid item: ${JSON.stringify(item)}`);
                        continue;
                    }

                    if (!seriesName || typeof seriesName !== 'string' || value === undefined || isNaN(value) || isNaN(timestamp)) {
                        node.log(`Skipped invalid data: seriesName=${seriesName}, value=${value}, timestamp=${timestamp}`);
                        continue;
                    }

                    if (!historyData[seriesName]) {
                        historyData[seriesName] = [];
                    }
                    historyData[seriesName].push({
                        timestamp,
                        value
                    });
                } catch (e) {
                    node.log(`Failed to parse item: ${JSON.stringify(item)}, error: ${e.message}`);
                }
            }

            let series = [{}];
            let data = [[]];

            // Function to convert hex to RGB
            const hexToRgb = (hex) => {
                const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
                hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            };

            for (let seriesName in historyData) {
                let seriesData = historyData[seriesName] || [];

                const seriesConfig = node.historyConfig.series.find(s => s.seriesName === seriesName) || {};
                const baseColor = seriesConfig.seriesColor || '#be1313';
                let gradientColors;

                if (baseColor.startsWith('#')) {
                    const rgb = hexToRgb(baseColor);
                    if (rgb) {
                        gradientColors = [
                            { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` },
                            { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.125)` }
                        ];
                    } else {
                        gradientColors = [
                            { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                            { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                        ];
                    }
                } else if (baseColor.startsWith('rgb')) {
                    const rgbMatch = baseColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                    if (rgbMatch) {
                        const [, r, g, b] = rgbMatch;
                        gradientColors = [
                            { offset: 0, color: `rgba(${r}, ${g}, ${b}, 0.5)` },
                            { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0.125)` }
                        ];
                    } else {
                        gradientColors = [
                            { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                            { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                        ];
                    }
                } else {
                    gradientColors = [
                        { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                        { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                    ];
                }

                series.push({ 
                    label: seriesName,
                    units: seriesConfig.seriesUnits || '',
                    color: baseColor,
                    gradientColors
                });
                let values = [];

                for (let i = 0; i < seriesData.length; i++) {
                    if (i >= data[0].length) {
                        const ts = seriesData[i].timestamp;
                        data[0].push(ts);
                        for (let j = 1; j < data.length; j++) {
                            while (data[j].length < data[0].length) {
                                data[j].push(NaN);
                            }
                        }
                    }
                    values.push(seriesData[i].value !== null && !isNaN(seriesData[i].value) ? seriesData[i].value : NaN);
                }

                data.push(values);
            }

            for (let i = 1; i < data.length; i++) {
                while (data[i].length < data[0].length) {
                    data[i].push(NaN);
                }
            }

            const chartDataForECharts = { series, data };

            const timeSpan = msg.timeSpan ? parseInt(msg.timeSpan) : 604800;

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ECharts - ${bucket}</title>
  <script src="/echarts.min.js"></script>
  <style>
    html, body { margin: 0; padding: 0; font-family: sans-serif; }
    #main { width: 100vw; height: 100vh; }
    #controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 10;
      background: white;
      padding: 5px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="controls">
    <select id="timeSpan" onchange="updateChart()">
      <option value="86400" ${timeSpan === 86400 ? 'selected' : ''}>Last Day</option>
      <option value="604800" ${timeSpan === 604800 ? 'selected' : ''}>Last Week</option>
      <option value="2592000" ${timeSpan === 2592000 ? 'selected' : ''}>Last Month</option>
    </select>
  </div>
  <div id="main"></div>
<script>
  const data = ${JSON.stringify(chartDataForECharts)};
  function updateChart() {
    const timeSpan = parseInt(document.getElementById('timeSpan').value);
    const url = new URL(window.location);
    url.searchParams.set('timeSpan', timeSpan);
    window.location = url.toString();
  }
  if (!data.series || !data.data || data.series.length <= 1) {
    console.error('Invalid data format:', data);
    document.getElementById('main').innerHTML = '<h1>No Data Available</h1><p>Please check the data source.</p>';
  } else {
    const timestamps = data.data[0];
    const legendData = data.series.slice(1).map(s => s.label);
    const seriesData = data.data.slice(1).map((values, i) => ({
      name: data.series[i + 1].label,
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: timestamps.map((t, j) => [t, values[j]]),
      lineStyle: { color: data.series[i + 1].color },
      itemStyle: { color: data.series[i + 1].color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, data.series[i + 1].gradientColors),
        opacity: 0.7
      },
      z: i + 1
    }));

    let dataMin = Infinity, dataMax = -Infinity;
    data.data.slice(1).forEach(values => {
      values.forEach(v => {
        if (!isNaN(v)) {
          dataMin = Math.min(dataMin, v);
          dataMax = Math.max(dataMax, v);
        }
      });
    });
    if (dataMin === Infinity) dataMin = 0;
    if (dataMax === -Infinity) dataMax = 100;
    const range = dataMax - dataMin;
    const padding = range * 0.5 || 10;
    const paddedMin = Number((dataMin - padding).toFixed(2));
    const paddedMax = Number((dataMax + padding).toFixed(2));

    const yAxisName = data.series.slice(1).map(s => s.units).filter(u => u).join(', ') || 'Value';

    const chart = echarts.init(document.getElementById('main'), null, { renderer: 'svg' });
    chart.setOption({
      animation: false,
      title: { text: '${bucket}', left: 'center' },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', snap: true },
        formatter: function(params) {
          const timestamp = params[0].value[0];
          const date = new Date(timestamp);
          let result = date.toLocaleString('en-US', { hour12: true });
          params.forEach(p => {
            const series = data.series[p.seriesIndex + 1];
            const value = p.value[1];
            if (value !== null && !isNaN(value)) {
              result += '<br/>' + series.label + ': ' + value.toFixed(2) + ' ' + (series.units || '');
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
          formatter: function(value) {
            return new Date(value).toLocaleString('en-US', {
              hour12: true,
              hour: 'numeric',
              minute: '2-digit'
            });
          }
        }
      },
      yAxis: { type: 'value', name: yAxisName, min: paddedMin, max: paddedMax },
      toolbox: { feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: {} } },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, filterMode: 'filter' },
        { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'filter', minValueSpan: paddedMin - 10, maxValueSpan: paddedMax + 10 }
      ],
      series: seriesData
    });
  }
</script>
</body>
</html>
`;
            msg.payload = html;
            msg.statusCode = 200;
            node.send(msg);
        });
    }
    RED.nodes.registerType("history-template", HistoryTemplateNode);
};