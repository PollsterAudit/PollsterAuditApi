const tabletojson = require('tabletojson').Tabletojson;
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('node:fs');

const config = require('../config.json');

const apiVersion = 1;
const outputDir = "./output/";
const baseUrl = "https://api.pollsteraudit.ca/";

async function getWikipediaPage(url) {
    return axios({
        method: "GET",
        url: url
    });
}

async function getTableFromWikipediaPage(wikipediaPage, headerName, options) {
    const $ = cheerio.load(wikipediaPage.data);

    // Find the header element that contains the name
    const checkHeaderName = headerName.trim().toUpperCase();
    const header = $('h1, h2, h3, h4, h5, h6')
        .filter((_, el) => $(el).text().trim().toUpperCase() === checkHeaderName);

    if (header.length) {
        let foundHeader = false;

        // Traverse all elements in document order.
        for (let el of $.root().find('h1, h2, h3, h4, h5, h6, table')) {
            if (!foundHeader) {
                if (el === header[0]) { // Check if this is the header element.
                    foundHeader = true;
                }
            } else if (el.tagName && el.tagName.toLowerCase() === 'table') {
                return tabletojson.convert($.html($(el)), options)[0];
            }
        }
        console.log('Failed to find a table after the header');
    } else {
        console.log('Header not found.');
    }
    return null;
}

// parseFloat() with some extra cleaning
function parseCleanFloat(item) {
    if (item == null) {
        return null;
    }
    const regex = /^±?(\d+\.?\d*),?(\d*\.?\d*),?(\d*\.?\d*)(?: .*|,)?$/gm;
    return parseFloat(item.replace(regex, `$1$2$3`));
}

function cleanPollingFirmName(item) {
    if (item == null) {
        return null;
    }
    const regex = /(.*?)(?:\[[a-zA-Z0-9]{0,2}\])?/gm;
    return item.replace(regex, `$1`);
}

function processTable(table, headings, ignoreColumns) {
    const newTable = [];
    let skipped = 0;
    main : for (let i = 0; i < table.length; i++) {
        const row = table[i];
        // TODO: -1 to account for tables that didn't fully populate all the data. Look at Margin of Error in 2011
        //  https://en.wikipedia.org/wiki/Opinion_polling_for_the_2011_Canadian_federal_election#Pre-campaign%20period
        if (Object.keys(row).length < headings.length - 1) {
            skipped++;
            continue; // Invalid table data (usually an info row)
        }
        const pollingFirm = row["" + headings.indexOf("PollingFirm")];
        if (pollingFirm == null) {
            // TODO: Log, and send a webhook so we can investigate
            skipped++;
            console.warn("Polling Firm is null - " + headings.indexOf("PollingFirm") + " - " + JSON.stringify(row));
            continue;
        }

        // TODO: temp fix for wikipedia including the election as the final row v
        if (pollingFirm === "" || pollingFirm.toLowerCase().includes("election")) {
            skipped++;
            continue; // Invalid table data (usually an info row)
        }
        let item = [];
        let innerSkipped = 0;
        for (let j = 0; j < headings.length; j++) {
            while(ignoreColumns.includes(j + innerSkipped)) {
                innerSkipped++;
            }
            const x = j + innerSkipped;
            const heading = headings[j];
            if (heading === "PollingFirm") {
                item[j] = cleanPollingFirmName(pollingFirm);
            } else if (heading === "Date") {
                const date = row["" + x];
                if (date === "") {
                    skipped++;
                    continue main; // Invalid table data (usually voting results (E.x. 1988))
                }
                item[j] = new Date(date).getTime();
            } else {
                item[j] = parseCleanFloat(row["" + x]);
            }
        }
        newTable[i - skipped] = item;
    }
    return newTable;
}

async function getWikipediaSection(page, year, sectionId, sectionName, options, manualTimes, index) {
    try {
        if (!("forceIndexAsNumber" in options)) {
            options["forceIndexAsNumber"] = true;
        }

        let from = Number.MAX_SAFE_INTEGER;
        let to = Number.MIN_SAFE_INTEGER;
        let headings = options["headings"];
        const table = await getTableFromWikipediaPage(page, sectionId, options);
        const processedTable = processTable(
            table,
            headings,
            ("ignoreColumns" in options ? options.ignoreColumns : [])
        );

        const dateIndex = headings.indexOf("Date");
        processedTable.forEach(element => {
            let time = element[dateIndex];
            if (time < from) {
                from = time;
            }
            if (time > to) {
                to = time;
            }
        });

        const processedTables = {};
        if (manualTimes) {
            for (let manualName in manualTimes) {
                const times = manualTimes[manualName];
                let timesFrom = Number.MIN_SAFE_INTEGER;
                let timesTo = Number.MAX_SAFE_INTEGER;
                if (times["from"]) {
                    timesFrom = new Date(times["from"]).getTime();
                }
                if (times["to"]) {
                    timesTo = new Date(times["to"]).getTime();
                }
                const manualTable = [];
                for (const item of processedTable) {
                    if (item[dateIndex] <= timesTo && item[dateIndex] >= timesFrom) {
                        manualTable.push(item);
                    }
                }
                processedTables[manualName] = manualTable;
            }
        } else {
            processedTables[sectionName] = processedTable;
        }

        for (let tableName in processedTables) {
            const dataTable = processedTables[tableName];
            const data = "{\"headings\": " + JSON.stringify(headings) +
                ",\"data\":" + JSON.stringify(dataTable, null, null) + " }";
            const id = tableName.toLowerCase().replace(" ", "_");
            const fileName = id + '.json';
            const directory = outputDir + "v" + apiVersion + "/" + year + "/";
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, {recursive: true});
            }
            fs.writeFile(directory + fileName, data, err => {
                if (err) {
                    console.error(err);
                }
            });
            if (!index[year]) {
                index[year] = {};
            }
            index[year][id] = {
                "name": tableName,
                "url": baseUrl + "v" + apiVersion + "/" + year + "/" + fileName,
                "range": [from, to]
            };
        }
    } catch (error) {
        console.error('Error fetching tables:', error);
    }
}

async function writeIndex(index) {
    const fileName = 'index.json';
    const directory = outputDir + "v" + apiVersion + "/";

    for (let year in index) {
        let yearElement = index[year];
        let from = Number.MAX_SAFE_INTEGER;
        let to = Number.MIN_SAFE_INTEGER;
        for (let period in yearElement) {
            let periodElement = yearElement[period];
            let range = periodElement["range"];
            if (range[0] < from) {
                from = range[0];
            }
            if (range[1] > to) {
                to = range[1];
            }
        }
        yearElement["range"] = [from, to];
    }

    const data = JSON.stringify(index);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFile(directory + fileName, data, err => {
        if (err) {
            console.error(err);
        }
    });
}

async function writeFromConfig(key) {
    const fileName = key + '.json';
    const directory = outputDir + "v" + apiVersion + "/";

    const data = JSON.stringify(config[key]);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFile(directory + fileName, data, err => {
        if (err) {
            console.error(err);
        }
    });
}

async function processWikipediaSource(page, year, source, chunkSource, index) {
    const sectionTables = chunkSource != null && "sectionTables" in chunkSource ?
        chunkSource["sectionTables"] : source["sectionTables"];
    const options = chunkSource != null && "options" in chunkSource ?
        chunkSource["options"] : source["options"];
    const manualTimes = chunkSource != null &&  "manualTimes" in chunkSource ?
        chunkSource["manualTimes"] : source["manualTimes"];
    // If section table is an object, it means we should rename the sections
    if (!Array.isArray(sectionTables)) {
        for (let sectionId in sectionTables) {
            await getWikipediaSection(page, year, sectionId, sectionTables[sectionId], options, manualTimes, index);
        }
    } else {
        for (const section of sectionTables) {
            await getWikipediaSection(page, year, section, section, options, manualTimes, index);
        }
    }
}

(async () => {
    const sources = config["sources"];
    let index = {};

    // Wikipedia
    const wikipedia = sources["wikipedia"];
    for (const source of wikipedia) {
        const url = source["url"];
        const year = source["year"];
        const page = await getWikipediaPage(url);
        if ("chunks" in source) {
            for (const chunk of source["chunks"]) {
                await processWikipediaSource(page, year, source, chunk, index);
            }
        } else {
            await processWikipediaSource(page, year, source, null, index);
        }
    }

    // Index
    await writeIndex(index);

    // Parties
    await writeFromConfig("parties");

    // Pollsters
    await writeFromConfig("pollsters");
})();