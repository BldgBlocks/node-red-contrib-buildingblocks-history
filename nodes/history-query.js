module.exports = function (RED) {
    function HistoryQueryNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        this.bucket = config.bucket || "Undefined";
        const node = this;

        node.on("input", function (msg) {
            try {

                let bucket = msg.bucket || (node.historyConfig && node.historyConfig.name) || node.bucket;
                if (!bucket || bucket === "Undefined") {
                    node.error(`No valid bucket specified. msg.bucket: ${msg.bucket}, historyConfig.name: ${node.historyConfig && node.historyConfig.name}, config.bucket: ${node.bucket}`, msg);
                    return;
                }

                const historyContext = node.context().global;
                if (!historyContext) {
                    node.error("History (global) context is not available", msg);
                    return;
                }
                let historyData = historyContext.get(`history_data_${bucket}`) || [];

                let series = [];
                if (msg.series) {
                    series = Array.isArray(msg.series)
                        ? msg.series
                        : typeof msg.series === "string"
                        ? msg.series.split(",").map(s => s.trim())
                        : [];
                }

                let outputData = historyData;
                if (series.length > 0) {
                    outputData = historyData.map(line => {
                        try {
                            // Parse line protocol: measurement,tags field=value timestamp
                            const match = line.match(/^(.+?) (value=[0-9.]+) ([0-9]+)$/);
                            if (!match) throw new Error("Invalid line format");
                            const [_, measurementTags, fields, timestamp] = match;

                            // Split measurement and tags
                            const tagParts = {};
                            let currentTag = '';
                            let isKey = true;
                            measurementTags.split(/(?<!\\),/).forEach(part => {
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
                }

                msg.payload = outputData;
                node.send(msg);
            } catch (e) {
                node.error(`Failed to fetch data: ${e.message}`, msg);
            }
        });
    }
    RED.nodes.registerType("history-query", HistoryQueryNode);
};