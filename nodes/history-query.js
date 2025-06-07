module.exports = function (RED) {
  function HistoryQueryNode(config) {
    RED.nodes.createNode(this, config);
    this.historyConfig = RED.nodes.getNode(config.historyConfig);
    this.bucket = config.bucket || "Undefined"; // Fallback for older flows
    const node = this;

    node.on("input", function (msg) {
      try {
        // Log input message safely
        node.log(`Input msg.bucket: ${msg.bucket}, msg.series: ${msg.series}`);

        // Use msg.bucket, historyConfig.name, or fallback to config.bucket
        let bucket = msg.bucket || (node.historyConfig && node.historyConfig.name) || node.bucket;
        if (!bucket || bucket === "Undefined") {
          node.error(`No valid bucket specified. msg.bucket: ${msg.bucket}, historyConfig.name: ${node.historyConfig && node.historyConfig.name}, config.bucket: ${node.bucket}`, msg);
          return;
        }
        node.log(`Using bucket: ${bucket}`);

        // Retrieve history data from flow context
        const flowContext = node.context().flow;
        if (!flowContext) {
          node.error("Flow context is not available", msg);
          return;
        }
        let historyData = flowContext.get(`history_data_${bucket}`) || [];
        node.log(`Raw History data (${historyData.length} items): ${JSON.stringify(historyData.slice(0, 5), null, 2)}`);

        // Extract series (priority: msg.series only)
        let series = [];
        if (msg.series) {
          series = Array.isArray(msg.series)
            ? msg.series
            : typeof msg.series === "string"
            ? msg.series.split(",").map(s => s.trim())
            : [];
          node.log(`Using msg.series: ${series}`);
        }

        // Parse line protocol strings only if msg.series is set
        let outputData = historyData;
        if (series.length > 0) {
          outputData = historyData.map(line => {
            try {
              // Example: sensor_data,seriesName=Return\ Temp value=75.20 1748989364782000000
              const parts = line.split(' ');
              if (parts.length < 3) throw new Error("Invalid line format");
              const [measurement, tags, ...rest] = parts;
              const fieldsAndTimestamp = rest.join(' ').split(' ');
              const timestamp = fieldsAndTimestamp.pop();
              const fields = fieldsAndTimestamp.join(' ');

              // Parse tags
              const tagParts = {};
              let currentTag = '';
              let isKey = true;
              tags.split(/(?<!\\),/).forEach(part => {
                if (isKey) {
                  currentTag = part;
                  tagParts[currentTag] = '';
                  isKey = false;
                } else {
                  tagParts[currentTag] = part.replace(/\\ /g, ' ').replace(/\\,/g, ',').replace(/\\=/g, '=');
                  isKey = true;
                }
              });

              // Parse fields
              const fieldParts = {};
              let currentField = '';
              isKey = true;
              fields.split(/(?<!\\),/).forEach(part => {
                if (isKey) {
                  currentField = part;
                  fieldParts[currentField] = '';
                  isKey = false;
                } else {
                  fieldParts[currentField] = parseFloat(part);
                  isKey = true;
                }
              });

              return {
                seriesName: tagParts.seriesName,
                value: fieldParts.value,
                time: parseInt(timestamp) / 1e6 // Nanoseconds to milliseconds
              };
            } catch (e) {
              node.log(`Failed to parse line: ${line}, error: ${e.message}`);
              return null;
            }
          }).filter(item => item && item.seriesName && series.includes(item.seriesName));

          node.log(`Filtered parsed data (${outputData.length} items): ${JSON.stringify(outputData.slice(0, 5), null, 2)}`);
        }

        // Set msg.payload (raw strings unless msg.series is set)
        msg.payload = outputData;
        node.send(msg);
      } catch (e) {
        node.error(`Failed to fetch data: ${e.message}`, msg);
      }
    });
  }
  RED.nodes.registerType("history-query", HistoryQueryNode);
};