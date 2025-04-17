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

function createCitation(url, date, sourceExt = null) {
    const citation = {
        "url": url,
        "date": date
    };
    if (sourceExt) {
        citation["sourceExt"] = sourceExt;
    }
    return citation;
}

function getWikipediaDateAndSourceExt($ref) {
    let sourceExt = null;
    const openUrl = $ref.find('.reference-text span[title]');
    if (openUrl) {
        const openUrlTitle = openUrl.attr('title');
        if (openUrlTitle) {
            const searchParams = new URLSearchParams(openUrlTitle);
            searchParams.forEach((value, key) => {
                if (key !== "rft.date") {
                    if (sourceExt == null) {
                        sourceExt = {};
                    }
                    sourceExt[key] = value;
                }
            });
            if (searchParams.get("rft.date") !== null) {
                return [searchParams.get("rft.date"), sourceExt];
            }
        }
    }
    // Failed to find a valid openUrl, attempt to parse the date from the accessdate. Skip other source extensions
    const accessdate = $ref.find('.reference-text cite .reference-accessdate');
    if (accessdate) {
        const rawText = accessdate.text().trim();
        const cleaned = rawText.replace(/^\.?\s*Retrieved\s*/i, '').trim();
        if (cleaned && cleaned !== "") {
            return [new Date(cleaned).toISOString().substring(0, 10), sourceExt];
        }
    }

    return [null, sourceExt];
}

async function getTableFromWikipediaPage($, headerName, options) {
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

function processTable($, table, headings, citations, ignoreColumns) {
    const idToUrlMap = {};
    const citationMap = {};

    // Find references early
    const citationKey = "" + headings.indexOf("Citation");
    for (let i = 0; i < table.length; i++) {
        const row = table[i];
        if (row) {
            const citation = row[citationKey];
            if (citation) {
                const $citation = cheerio.load(citation);
                if ($citation !== null) {
                    const citationText = $citation.text().trim();
                    if (citationText !== null && citationText !== '') {
                        // Find and replace citation reference with url
                        const href = $citation('a').first().attr('href');
                        if (href) {
                            const citationId = href.replace(/^#/, '');
                            if (!(citationId in citationMap)) {
                                citationMap[citationId] = [];
                            }
                            citationMap[citationId].push(i);
                        }
                    }
                }
            }
        }
    }

    // Loop through each .references block, and map references to id's
    if (Object.keys(citationMap).length > 0) {
        $('.references').each((_, el) => {
            $(el).children('[id]').each((_, child) => { // Each reference
                const $child = $(child);
                const id = $child.attr('id');
                if (id && citationMap[id]) { // Due to early check, we can skip most of these
                    // Find the href inside .reference-text > cite > a
                    const hrefElem = $child.find('.reference-text cite a[href]');
                    if (hrefElem) {
                        const url = hrefElem.attr('href');
                        if (url) {
                            const dateAndSourceExt = getWikipediaDateAndSourceExt($child);
                            const urlData = [url, dateAndSourceExt[0], dateAndSourceExt[1]];
                            for (const i of citationMap[id]) {
                                idToUrlMap[i] = urlData;
                            }
                        }
                    }
                }
            });
        });
    }

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

        // Strip remaining HTML from row
        for (const key in row) {
            if (key === citationKey) {
                continue;
            }
            row[key] = cheerio.load(row[key]).text();
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
            } else if (heading === "Citation") {
                if (i in idToUrlMap) {
                    // Replace citation url
                    const urlData = idToUrlMap[i];
                    item[j] = urlData[0]; // Change row from citation reference to link
                    citations.push(createCitation(urlData[0], urlData[1], urlData[2]));
                } else {
                    item[j] = "";
                }
            } else if (heading === "PollingMethod") {
                item[j] = row["" + x];
            } else {
                item[j] = parseCleanFloat(row["" + x]);
            }
        }
        newTable[i - skipped] = item;
    }
    return newTable;
}

async function getWikipediaSection(page, year, sectionId, sectionName, options, manualTimes, index, citations) {
    try {
        options["forceIndexAsNumber"] = true;
        options["stripHtmlFromCells"] = false; // False so that we can extract url's from sources/citations

        let from = Number.MAX_SAFE_INTEGER;
        let to = Number.MIN_SAFE_INTEGER;
        let headings = options["headings"];
        const $ = cheerio.load(page.data);
        const table = await getTableFromWikipediaPage($, sectionId, options);
        const processedTable = processTable(
            $,
            table,
            headings,
            citations,
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
    console.log("Writing Index");
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

async function writeCitations(citations) {
    console.log("Writing Citations");
    const fileName = 'citations.json';
    const directory = outputDir + "v" + apiVersion + "/";

    const data = JSON.stringify(citations);
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
    console.log("Writing " + key);
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

async function processWikipediaSource(page, year, source, chunkSource, index, citations) {
    const sectionTables = chunkSource != null && "sectionTables" in chunkSource ?
        chunkSource["sectionTables"] : source["sectionTables"];
    const options = chunkSource != null && "options" in chunkSource ?
        chunkSource["options"] : source["options"];
    const manualTimes = chunkSource != null &&  "manualTimes" in chunkSource ?
        chunkSource["manualTimes"] : source["manualTimes"];
    // If section table is an object, it means we should rename the sections
    if (!Array.isArray(sectionTables)) {
        for (let sectionId in sectionTables) {
            await getWikipediaSection(page, year, sectionId, sectionTables[sectionId], options, manualTimes,
                index, citations);
        }
    } else {
        for (const section of sectionTables) {
            await getWikipediaSection(page, year, section, section, options, manualTimes, index, citations);
        }
    }
}

function setupCitations(citations, year, source, sourceUrl) {
    let innerCitations = citations;
    if (!(year in innerCitations)) {
        innerCitations[year] = {};
    }
    innerCitations = innerCitations[year];
    if (!(source in innerCitations)) {
        innerCitations[source] = {};
    }
    innerCitations = innerCitations[source];
    if (!(sourceUrl in innerCitations)) {
        innerCitations[sourceUrl] = {};
    }
    innerCitations[sourceUrl] = [];
    return innerCitations[sourceUrl];
}

const index = async () => {
    console.log("Start indexing");
    try {
        const hasApiDir = fs.existsSync("../api")
        const sources = config["sources"];
        const index = {};
        const citations = {};

        // Wikipedia
        const wikipedia = sources["wikipedia"];
        for (const source of wikipedia) {
            const year = source["year"];
            if (hasApiDir && "locked" in source && source["locked"]) {
                const dir = "../api/v" + apiVersion + "/" + year;
                if (fs.existsSync(dir)) {
                    fs.cp(dir, "../output/v" + apiVersion + "/" + year, {recursive: true}, (e) => {
                        console.log("Copied data for year " + year + " from last commit!");
                    });
                    continue; // Skip this year
                }
            }
            const url = source["url"];

            let innerCitations = setupCitations(citations, year, "wikipedia", url);

            const page = await getWikipediaPage(url);
            if ("chunks" in source) {
                for (const chunk of source["chunks"]) {
                    await processWikipediaSource(page, year, source, chunk, index, innerCitations);
                }
            } else {
                await processWikipediaSource(page, year, source, null, index, innerCitations);
            }
        }

        // Index
        await writeIndex(index);

        // Citations
        await writeCitations(citations);

        // Parties
        await writeFromConfig("parties");

        // Pollsters
        await writeFromConfig("pollsters");
    } catch (error) {
        console.error('An error has occurred:', error);
    }
}

index()
    .then(() => console.log("Finished"))
    .catch(err => console.log(err));