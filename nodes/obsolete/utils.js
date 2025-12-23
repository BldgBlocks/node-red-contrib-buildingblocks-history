// This method parses an InfluxDB line protocol string (e.g., "Furnace,historyGroup=logic value=80 1234567890000000") 
// into a structured object containing seriesName, value, and timestamp. It is designed for InfluxDB data with numerical 
// values (e.g., 0, 80, or floats), matching the history-template node’s requirements. The method uses a regex to extract 
// measurement tags, fields, and timestamp, delegating tag and field parsing to parseTags and parseFields. It prioritizes 
// seriesName extraction from tags (seriesName, _measurement, or first tag) and converts timestamps from nanoseconds to 
// milliseconds. Error handling includes regex mismatch, invalid tags/fields, and logging via a customizable callback. 
// The regex is configurable for flexibility but defaults to numerical values only.
function parseLineProtocol(item, logCallback = console.log, lineRegex = /^(.+?) (value=[0-9.]+) ([0-9]+)$/) {
    if (typeof item !== 'string') {
        logCallback(`Invalid input: Expected string, got ${typeof item}`);
        return null;
    }

    const match = item.match(lineRegex);
    if (!match) {
        logCallback(`Skipped invalid line: ${item}`);
        return null;
    }

    const [, measurementTags, fields, ts] = match;

    // Parse tags
    const tags = parseTags(measurementTags, logCallback);
    if (!tags) {
        logCallback(`No valid tags parsed from: ${measurementTags}`);
        return null;
    }

    // Parse fields
    const values = parseFields(fields, logCallback);
    if (!values || values.value === undefined) {
        logCallback(`No valid value field parsed from: ${fields}`);
        return null;
    }

    // Extract seriesName (priority: seriesName, _measurement, first tag)
    const seriesName = tags.seriesName || tags._measurement || Object.keys(tags)[0];
    if (!seriesName) {
        logCallback(`No valid seriesName found in tags: ${JSON.stringify(tags)}`);
        return null;
    }

    return {
        seriesName,
        value: values.value,
        timestamp: parseInt(ts) / 1e6 // Convert ns to ms
    };
}

// This method extracts key-value pairs from an InfluxDB line protocol measurementTags string 
// (e.g., "Furnace,historyGroup=logic,tag0=output"). It splits the string into pairs using configurable regex patterns 
// to handle escaped commas and equals signs, then parses each pair into a key-value object, unescaping special characters. 
// It supports robust error handling, logging failures via a customizable callback, and returns null for invalid inputs. 
// The method is essential for mapping InfluxDB data to series names (e.g., extracting seriesName or _measurement tags).
function parseTags(measurementTags, logCallback = console.log, tagSplitRegex = /(?<!\\),/, pairSplitRegex = /(?<!\\)=/) {
    try {
        const tagPairs = measurementTags.split(tagSplitRegex);
        const tags = {};
        tagPairs.forEach(pair => {
            const [key, val] = pair.split(pairSplitRegex);
            if (key && val) {
                tags[key] = val.replace(/\\ /g, ' ').replace(/\\,/g, ',').replace(/\\=/g, '=');
            }
        });
        return Object.keys(tags).length > 0 ? tags : null;
    } catch (e) {
        logCallback(`Failed to parse tags: ${measurementTags}, error: ${e.message}`);
        return null;
    }
}

// This method parses field key-value pairs from an InfluxDB line protocol fields string (e.g., "value=80"). 
// It splits the string into pairs using configurable regex patterns and converts values to floats, as required for 
// numerical data (e.g., 0, 80, or floats for temperature). Error handling includes logging invalid pairs or parsing 
// errors via a customizable callback, returning null for failures. The method is optimized for numerical values, 
// aligning with the history-template node’s data format.
function parseFields(fields, logCallback = console.log, fieldSplitRegex = /(?<!\\),/, pairSplitRegex = /(?<!\\)=/) {
    try {
        const fieldPairs = fields.split(fieldSplitRegex);
        const values = {};
        fieldPairs.forEach(pair => {
            const [key, val] = pair.split(pairSplitRegex);
            if (key && val) {
                values[key] = parseFloat(val);
            }
        });
        return Object.keys(values).length > 0 ? values : null;
    } catch (e) {
        logCallback(`Failed to parse fields: ${fields}, error: ${e.message}`);
        return null;
    }
}

// This method parses an InfluxDB JSON object (e.g., { _measurement: "Call_Cool", _value: 80, _time: "2025-06-21T18:50:00Z" })
// into a structured object with seriesName, value, and timestamp. It uses configurable field arrays to extract seriesName, 
// value, and timestamp, supporting multiple field names for flexibility. It converts numerical strings to floats and handles 
// timestamps from ISO strings or nanoseconds to milliseconds. Error handling includes logging missing or invalid fields via 
// a customizable callback, returning null for failures. The method is designed for InfluxDB JSON query results, ensuring 
// numerical values like _value=80 are correctly parsed.
function parseJsonObject(item, logCallback = console.log, config = {}) {
    const {
        valueFields = ['_value', 'value', 'Value'],
        timeFields = ['_time', 'time', 'Time'],
        seriesNameFields = ['seriesName', '_measurement', 'measurement']
    } = config;

    if (typeof item !== 'object' || item === null) {
        logCallback(`Skipped non-object item: ${JSON.stringify(item)}`);
        return null;
    }

    // Extract seriesName
    let seriesName = null;
    for (const field of seriesNameFields) {
        if (item[field] && typeof item[field] === 'string') {
            seriesName = item[field];
            break;
        }
    }
    if (!seriesName) {
        logCallback(`No valid seriesName found in item: ${JSON.stringify(item)}`);
        return null;
    }

    // Extract value
    let value = undefined;
    for (const field of valueFields) {
        if (item[field] !== undefined) {
            value = typeof item[field] === 'string' && !isNaN(parseFloat(item[field])) ? parseFloat(item[field]) : item[field];
            break;
        }
    }
    if (value === undefined) {
        logCallback(`No valid value found in item: ${JSON.stringify(item)}`);
        return null;
    }

    // Extract timestamp
    let timestamp = null;
    let time = null;
    for (const field of timeFields) {
        if (item[field] !== undefined) {
            time = item[field];
            break;
        }
    }
    if (!time) {
        logCallback(`Skipped object missing time: ${JSON.stringify(item)}`);
        return null;
    }

    if (typeof time === 'string') {
        timestamp = new Date(time + (time.includes('Z') ? '' : 'Z')).getTime();
    } else if (typeof time === 'number') {
        timestamp = time / 1e6; // Convert ns to ms
    } else {
        timestamp = parseInt(time) / 1e6; // Fallback
    }

    if (isNaN(timestamp)) {
        logCallback(`Invalid timestamp in item: ${JSON.stringify(item)}`);
        return null;
    }

    return {
        seriesName,
        value,
        timestamp
    };
}

// This method converts a hex color code (e.g., "#be1313") to an RGB object ({ r, g, b }) for ECharts styling, such as 
// gradient colors. It supports 3-digit and 6-digit hex codes, expanding shorthand formats (e.g., #fff to #ffffff). The 
// default RGB value is set to { r: 190, g: 19, b: 19 } to match the history-template node’s fallback. Error handling logs 
// parsing failures via a customizable callback, returning the default RGB object if the hex code is invalid. This method 
// ensures consistent color visualization based on seriesColor from the history-config node.
function hexToRgb(hex, logCallback = console.log, defaultRgb = { r: 190, g: 19, b: 19 }) {
    try {
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : defaultRgb;
    } catch (e) {
        logCallback(`Failed to parse hex color: ${hex}, error: ${e.message}`);
        return defaultRgb;
    }
}

// This method dispatches to parseLineProtocol or parseJsonObject based on the input type (string or object), providing 
// a unified interface for parsing InfluxDB data. It supports numerical values and uses a regex optimized for the 
// history-template node’s data format. The method accepts a configuration object to customize field names and regex patterns, 
// with error handling via a customizable logging callback. It is designed to process InfluxDB query results for ECharts 
// visualization, ensuring reliable parsing of data like _measurement=Call_Cool, _value=80.
function parseInfluxData(item, logCallback = console.log, config = {}) {
    const {
        valueFields = ['_value', 'value', 'Value'],
        timeFields = ['_time', 'time', 'Time'],
        seriesNameFields = ['seriesName', '_measurement', 'measurement'],
        lineRegex = /^(.+?) (value=[0-9.]+) ([0-9]+)$/
    } = config;

    if (typeof item === 'string') {
        return parseLineProtocol(item, logCallback, lineRegex);
    } else if (typeof item === 'object' && item !== null) {
        return parseJsonObject(item, logCallback, { valueFields, timeFields, seriesNameFields });
    } else {
        logCallback(`Skipped invalid item: ${JSON.stringify(item)}`);
        return null;
    }
}

module.exports = {
    parseLineProtocol,
    parseTags,
    parseFields,
    parseJsonObject,
    hexToRgb,
    parseInfluxData
};