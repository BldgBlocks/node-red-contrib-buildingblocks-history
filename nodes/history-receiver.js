module.exports = function(RED) {
    // Define node for receiving and formatting time-series data
    function HistoryReceiverNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        this.seriesName = config.seriesName;
        this.storageType = config.storageType || 'memory';
        const node = this;

        node.on('input', function(msg) {
            // Validate configuration
            if (!node.historyConfig) {
                node.error("Missing history configuration", msg);
                return;
            }
            if (!node.seriesName) {
                node.error("Missing series name", msg);
                return;
            }
            if (!node.historyConfig.name) {
                node.error("Missing bucket name in history configuration", msg);
                return;
            }

            // Validate and parse payload as a number
            let payloadValue;
            try {
                payloadValue = parseFloat(msg.payload);
                if (isNaN(payloadValue)) {
                    node.warn(`Invalid payload value: ${msg.payload}`);
                    return;
                }
            } catch (e) {
                node.warn(`Payload parsing error: ${e.message}`);
                return;
            }

            // Construct line protocol with escaped measurement name and seriesName tag
            const escapedMeasurementName = node.seriesName.replace(/[, =]/g, '\\$&');
            const escapedSeriesName = node.seriesName.replace(/[, =]/g, '\\$&');
            const formattedValue = payloadValue.toFixed(2);
            const msNow = Date.now();
            const timestamp = msNow * 1e6;
            const line = `${escapedMeasurementName},seriesName=${escapedSeriesName} value=${formattedValue} ${timestamp}`;

            // Handle storage type
            if (node.storageType === 'memory') {
                const contextKey = `history_data_${node.historyConfig.name}`;
                let bucketData = node.context().flow.get(contextKey) || [];
                bucketData.push(line);

                const maxMemoryBytes = (node.historyConfig.maxMemoryMb || 10) * 1024 * 1024;
                let totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                while (totalSize > maxMemoryBytes && bucketData.length > 0) {
                    bucketData.shift();
                    totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                }

                node.context().flow.set(contextKey, bucketData);
            } else if (node.storageType === 'lineProtocol') {
                msg.payload = line;
                msg.table = escapedMeasurementName;
                node.send(msg);
            } else if (node.storageType === 'object') {
                msg.payload = {
                    table: escapedMeasurementName,
                    tags: [`seriesName=${node.seriesName}`],
                    value: parseFloat(formattedValue),
                    timestamp: timestamp
                };
                node.send(msg);
            }
        });
    }
    RED.nodes.registerType("history-receiver", HistoryReceiverNode);
};