const { parseInfluxData, hexToRgb } = require('./utils');

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

            // Parse input data using utils.js
            const historyData = {};
            const lines = Array.isArray(msg.payload) ? msg.payload : [];
            if (!lines.length) {
                node.warn("Empty payload received", msg);
            }

            for (let item of lines) {
                try {
                    const parsed = parseInfluxData(item, (msg) => node.log(msg), {
                        lineRegex: /^(.+?) (value=[0-9.]+) ([0-9]+)$/ // Match history-template regex
                    });
                    if (!parsed) {
                        continue;
                    }

                    const { seriesName, value, timestamp } = parsed;
                    if (!seriesName || typeof seriesName !== 'string' || value === undefined || isNaN(value) || isNaN(timestamp)) {
                        node.log(`Skipped invalid data: seriesName=${seriesName}, value=${value}, timestamp=${timestamp}`);
                        continue;
                    }

                    // Snap digital signal values to 0 or 50
                    const seriesConfig = node.historyConfig.series.find(s => s.seriesName === seriesName) || {};
                    const finalValue = seriesConfig.isDigital ? (value > 0 ? 50 : 0) : value;

                    if (!historyData[seriesName]) {
                        historyData[seriesName] = [];
                    }
                    historyData[seriesName].push({
                        timestamp,
                        value: finalValue
                    });
                } catch (e) {
                    node.log(`Failed to parse item: ${JSON.stringify(item)}, error: ${e.message}`);
                }
            }

            let series = [{}];
            let data = [[]];

            for (let seriesName in historyData) {
                let seriesData = historyData[seriesName] || [];

                const seriesConfig = node.historyConfig.series.find(s => s.seriesName === seriesName) || {};
                const baseColor = seriesConfig.seriesColor || '#be1313';
                let gradientColors;

                if (baseColor.startsWith('#')) {
                    const rgb = hexToRgb(baseColor, (msg) => node.log(msg), { r: 190, g: 19, b: 19 });
                    gradientColors = [
                        { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` },
                        { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.125)` }
                    ];
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
                    gradientColors,
                    isDigital: seriesConfig.isDigital || false,
                    useAreaStyle: seriesConfig.useAreaStyle !== false
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
            if (!Object.keys(historyData).length) {
                node.warn("No valid data parsed for chart", msg);
            }

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
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 15;
      background: rgba(255, 255, 255, 0.9);
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
      font-size: 16px;
      font-weight: bold;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="loading">Compiling histories...</div>
  <div id="main"></div>
<script>
  try {
    const data = ${JSON.stringify(chartDataForECharts)};
    function hideLoading() {
      try {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) {
          loadingDiv.style.display = 'none';
        }
      } catch (e) {
        console.warn('Error hiding loading message:', e.message);
      }
    }
    if (!data.series || !data.data || data.series.length <= 1) {
      console.error('Invalid data format:', data);
      document.getElementById('main').innerHTML = '<h1>No Data Available</h1><p>Please check the data source.</p>';
      hideLoading();
    } else {
      const timestamps = data.data[0];
      const legendData = data.series.slice(1).map(s => s.label);
      const seriesData = data.data.slice(1).map((values, i) => {
        const isDigital = data.series[i + 1].isDigital;
        const useAreaStyle = data.series[i + 1].useAreaStyle;
        return {
          name: data.series[i + 1].label,
          type: 'line',
          step: isDigital ? 'end' : false,
          smooth: isDigital ? false : true,
          symbol: 'none',
          data: timestamps.map((t, j) => [t, values[j]]),
          lineStyle: { color: data.series[i + 1].color },
          itemStyle: { color: data.series[i + 1].color },
          areaStyle: useAreaStyle ? {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, data.series[i + 1].gradientColors),
            opacity: 0.7
          } : null,
          z: i + 1
        };
      });

      let dataMin = Infinity, dataMax = -Infinity;
      data.data.slice(1).forEach(values => {
        values.forEach(v => {
          if (typeof v === 'number' && !isNaN(v)) {
            dataMin = Math.min(dataMin, v);
            dataMax = Math.max(dataMax, v);
          }
        });
      });
      if (dataMin === Infinity) dataMin = 0;
      if (dataMax === -Infinity) dataMax = 100;
      const range = dataMax - dataMin;
      const padding = range * 0.5 || 10;
      let paddedMin = Number((dataMin - padding).toFixed(2));
      const paddedMax = Number((dataMax + padding).toFixed(2));
      if (dataMin >= 0 && paddedMin < -10) {
        paddedMin = -10;
      }
      console.log('yAxis min:', paddedMin, 'max:', paddedMax, 'dataMin:', dataMin, 'dataMax:', dataMax);

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
          { type: 'slider', xAxisIndex: 0, filterMode: 'none' },
          { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
          { type: 'inside', yAxisIndex: 0, filterMode: 'none', minValueSpan: paddedMin - 10, maxValueSpan: paddedMax + 10 }
        ],
        series: seriesData
      });
      hideLoading();
    }
  } catch (e) {
    console.error('Chart rendering error:', e);
    document.getElementById('main').innerHTML = '<h1>Chart Rendering Error</h1><p>Check console for details.</p>';
    hideLoading();
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