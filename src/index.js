import { Tabletojson as tabletojson } from 'tabletojson';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import { loadJson, writeJsonToFile, writeToFile, copyFile, getJsonFile, createCitation, setupCitations,
    parseCleanFloat, cleanPollingFirmName, normalizePollingFirmName } from './utils.mjs';

const newPollsterDiscordWebhook = process.env.NEW_POLLSTER_DISCORD_WEBHOOK;

const parties = loadJson('../config/parties.json')["parties"];
const pollsters = loadJson('../config/pollsters.json')["pollsters"];
const sources = loadJson('../config/sources.json')["sources"];

const apiVersion = 1;
const outputDir = "./output/";
const apiDir = "./api/";
const apiDataDir = apiDir + "_data/";
const baseUrl = "https://api.pollsteraudit.ca/";

async function getWikipediaPage(url) {
    return axios({
        method: "GET",
        url: url
    });
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
                const el2 = $(el);
                // Prevents the sidebar from being selected, visible in 1980
                if (!el2.attr("class").includes("sidebar")) {
                    return tabletojson.convert($.html(el2), options)[0];
                }
            }
        }
        console.log('Failed to find a table after the header');
    } else {
        console.log('Header not found.');
    }
    return null;
}

function processTable($, table, headings, citations, pollsterIndex, ignoreColumns) {
    const idToUrlMap = {};
    const citationMap = {};
    const directCitationMap = {};

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
                            if (href === citationId) { // Not using wikipedia citations, using direct link
                                directCitationMap[i] = href;
                            } else {
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
            let $row = cheerio.load("<div>" + row[key] + "</div>");
            row[key] = $row('div').prop('innerText');
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
                const cleanFirmName = cleanPollingFirmName(pollingFirm);
                item[j] = cleanFirmName;
                const normalizedFirmName = normalizePollingFirmName(cleanFirmName);
                if (!pollsterIndex.includes(normalizedFirmName)) {
                    pollsterIndex.push(normalizedFirmName);
                }
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
                } else if (i in directCitationMap) {
                    item[j] = directCitationMap[i];
                    citations.push(createCitation(directCitationMap[i], null, null));
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

function htmlPreprocessor(html, variables) {
    const variableRegex = /{{(?<variableName>\w*?)}}/gm;
    return html.replace(variableRegex, (match, variableName) => {
        if (variableName in variables) {
            return variables[variableName];
        }
    });
}

async function getWikipediaSection(page, year, sectionId, sectionName, options,
                                   manualTimes, index, citations, pollsterIndex) {
    options["forceIndexAsNumber"] = true;
    options["stripHtmlFromCells"] = false; // False so that we can extract url's from sources/citations

    const headings = options["headings"];
    let processedTable;
    try {
        const $ = cheerio.load(page.data);
        const table = await getTableFromWikipediaPage($, sectionId, options);
        processedTable = processTable(
            $,
            table,
            headings,
            citations,
            pollsterIndex,
            ("ignoreColumns" in options ? options.ignoreColumns : [])
        );
    } catch (error) {
        console.log("Error fetching/processing tables! - " + year + " - " + sectionId);
        throw error;
    }
    if (processedTable.length === 0) {
        throw new Error(`Error fetching tables for year ${year} with sectionId ${sectionId}! - no tables!`);
    }
    try {
        const dateIndex = headings.indexOf("Date");
        const processedTables = {};
        const processedTableRanges = {};
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
                let from = Number.MAX_SAFE_INTEGER;
                let to = Number.MIN_SAFE_INTEGER;
                const manualTable = [];
                for (const item of processedTable) {
                    const time = item[dateIndex];
                    if (time <= timesTo && time >= timesFrom) {
                        manualTable.push(item);
                        if (time < from) {
                            from = time;
                        }
                        if (time > to) {
                            to = time;
                        }
                    }
                }
                processedTables[manualName] = manualTable;
                processedTableRanges[manualName] = [from, to];
            }
        } else {
            let from = Number.MAX_SAFE_INTEGER;
            let to = Number.MIN_SAFE_INTEGER;
            processedTables[sectionName] = processedTable;
            processedTable.forEach(element => {
                let time = element[dateIndex];
                if (time < from) {
                    from = time;
                }
                if (time > to) {
                    to = time;
                }
            });
            processedTableRanges[sectionName] = [from, to];
        }

        for (let tableName in processedTables) {
            const dataTable = processedTables[tableName];
            const data = "{\"headings\": " + JSON.stringify(headings) +
                ",\"data\":" + JSON.stringify(dataTable, null, null) + " }";
            const id = tableName.toLowerCase().replace(" ", "_");
            const fileName = id + '.json';
            const directory = outputDir + "v" + apiVersion + "/" + year + "/";
            writeToFile(directory, fileName, data);
            if (!index[year]) {
                index[year] = {};
            }
            index[year][id] = {
                "name": tableName,
                "url": baseUrl + "v" + apiVersion + "/" + year + "/" + fileName,
                "range": processedTableRanges[tableName]
            };
        }
    } catch (error) {
        console.log("Error processing table data!");
        throw error;
    }
}

function applyRangesToIndex(index) {
    for (let year in index) {
        let yearElement = index[year];
        if ("range" in yearElement) {
            continue;
        }
        let from = Number.MAX_SAFE_INTEGER;
        let to = Number.MIN_SAFE_INTEGER;
        for (let period in yearElement) {
            const periodElement = yearElement[period];
            const range = periodElement["range"];
            if (range[0] < from) {
                from = range[0];
            }
            if (range[1] > to) {
                to = range[1];
            }
        }
        yearElement["range"] = [from, to];
    }
}

async function processWikipediaSource(page, year, source, chunkSource, index, citations, pollsterIndex) {
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
                index, citations, pollsterIndex);
        }
    } else {
        for (const section of sectionTables) {
            await getWikipediaSection(page, year, section, section, options, manualTimes, index,
                citations, pollsterIndex);
        }
    }
}

function createLandingPages(directory, index) {
    const currentDate = new Date();
    const dateModified = currentDate.toISOString().split('T')[0];
    // Create Main landing page
    fs.readFile("./src/website/index.html", "utf8", (err, data) => {
        if (err) {
            throw err;
        }
        const parts = [];
        let yearEndpoints = "";
        for (let year in index) {
            const pageUrl = baseUrl + "v" + apiVersion + "/" + year + "/";
            parts.push({
                "@type":"Dataset",
                "url": pageUrl,
            });
            yearEndpoints += `<li><strong>${year}</strong><br/>` +
                `<a href="${pageUrl}">View Page</a><br/>` +
                `<small>Dataset of all opinion polling done for the ${year} election</small></li>`;
        }
        const variables = {
            "dateModified": dateModified,
            "parts": JSON.stringify(parts, null, 2),
            "yearEndpoint": yearEndpoints,
            "currentYear": currentDate.getFullYear()
        }
        writeToFile(outputDir, "index.html", htmlPreprocessor(data, variables));
    });
    // Create year landing pages
    fs.readFile("./src/website/year-index.html", "utf8", (err, data) => {
        if (err) {
            throw err;
        }
        for (let year in index) {
            const distributions = [];
            let endpoints = "";
            const yearElement = index[year];
            for (let period in yearElement) {
                if (period !== "range") {
                    const periodElement = yearElement[period];
                    const from = (new Date(periodElement["range"][0])).toISOString().split('T')[0];
                    const to = (new Date(periodElement["range"][1])).toISOString().split('T')[0];
                    distributions.push({
                        "@type":"DataDownload",
                        "encodingFormat":"JSON",
                        "contentUrl": periodElement["url"],
                        "name": year + " - " + periodElement["name"],
                        "dateModified": dateModified,
                        "temporalCoverage": from + "/" + to
                    });
                    endpoints += `<li><strong><code>/v${apiVersion}/${year}/${period}.json</code></strong><br/>` +
                        `<a href="${periodElement["url"]}" target="_blank">View JSON</a><br/>` +
                        `<small>Get opinion polling data between ${from} and ${to}</small></li>`;
                }
            }
            const from = new Date(yearElement["range"][0]).toISOString().split('T')[0];
            const to = new Date(yearElement["range"][1]).toISOString().split('T')[0];
            const keywords = `"${year}"`;
            const variables = {
                "dateModified": dateModified,
                "year": year,
                "keywords": keywords,
                "currentYear": currentDate.getFullYear(),
                "distributions": JSON.stringify(distributions, null, 2),
                "endpoints": endpoints,
                "temporalCoverage": from + "/" + to
            }
            writeToFile(directory + year + "/", "index.html", htmlPreprocessor(data, variables));
        }
    });
}

function identifyUntaggedPollsters(directory, pollsterIndex, knownUntaggedPollsters) {
    const knownPollsters = ["voting results", "market opinion research"];
    // Populate known pollsters
    for (let pollster of pollsters) {
        knownPollsters.push(normalizePollingFirmName(pollster.name));
        if ("alternatives" in pollster) {
            for (let alternative of pollster["alternatives"]) {
                knownPollsters.push(normalizePollingFirmName(alternative));
            }
        }
    }
    if (knownUntaggedPollsters === null) {
        knownUntaggedPollsters = [];
    }
    const newUntaggedList = [];
    const newUntaggedPollsters = [];
    // Check which pollsters are untagged
    for (let pollster of pollsterIndex) {
        if (!knownPollsters.includes(pollster)) {
            // Add pollster
            newUntaggedList.push(pollster);
            if (!knownUntaggedPollsters.includes(pollster)) {
                newUntaggedPollsters.push(pollster);
                knownUntaggedPollsters.push(pollster);
            }
            console.log("Unknown pollster: " + pollster);
        }
    }
    if (newUntaggedPollsters.length > 0) {
        let description = "";
        for (let pollster of newUntaggedPollsters) {
            if (description !== "") {
                description += "\n";
            }
            description += "• " + pollster
        }
        const params = {
            username: "Auditor",
            avatar_url: "https://pollsteraudit.ca/assets/favicon/PollsterAudit_Logo.png",
            content: "<@&1363180448825606234>",
            embeds: [
                {
                    "title": "New Pollster" + (newUntaggedPollsters.length > 1 ? "s" : ""),
                    "color": 14022436,
                    "description": description
                }
            ]
        };
        axios.post(newPollsterDiscordWebhook, params, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).catch(function (error) {
            throw error;
        });
    }
    if (newUntaggedList.length > 0) {
        writeJsonToFile(directory, "untagged-pollsters", newUntaggedList);
    }
}

const index = async () => {
    console.log("Start indexing");
    try {
        const hasApiDir = fs.existsSync(apiDir)
        const index = {};
        const citations = {};
        const pollsterIndex = [];

        const mainDirectory = outputDir + "v" + apiVersion + "/";

        const apiIndex = hasApiDir ? getJsonFile(apiDir + "v" + apiVersion + "/index.json") : null;
        const apiCitations = hasApiDir ? getJsonFile(apiDir + "v" + apiVersion + "/citations.json") : null;

        // Wikipedia
        const wikipedia = sources["wikipedia"];
        for (const source of wikipedia) {
            const year = source["year"];
            if (hasApiDir && "locked" in source && source["locked"]) {
                const dir = apiDir + "v" + apiVersion + "/" + year;

                if (fs.existsSync(dir) && year in apiIndex) {
                    fs.cpSync(dir, outputDir + "v" + apiVersion + "/" + year, {recursive: true});
                    console.log("Copied data for year " + year + " from last commit!");
                    index[year] = apiIndex[year];
                    citations[year] = apiCitations[year];
                    continue; // Skip this year
                }
            }
            const url = source["url"];

            const innerCitations = setupCitations(citations, year, "wikipedia", url);
            const page = await getWikipediaPage(url);

            if ("chunks" in source) {
                for (const chunk of source["chunks"]) {
                    await processWikipediaSource(page, year, source, chunk, index, innerCitations, pollsterIndex);
                }
            } else {
                await processWikipediaSource(page, year, source, null, index, innerCitations, pollsterIndex);
            }
        }

        // Index
        applyRangesToIndex(index);
        writeJsonToFile(mainDirectory, "index", index, true);

        // Citations
        writeJsonToFile(mainDirectory, "citations", citations, true);

        // Parties
        writeJsonToFile(mainDirectory, "parties", parties, true);

        // Pollsters
        writeJsonToFile(mainDirectory, "pollsters", pollsters, true);

        // Add CNAME
        writeToFile(outputDir, "CNAME", "api.pollsteraudit.ca", true);

        // Add api landing page - index.html
        createLandingPages(mainDirectory, index);

        // Add stylesheet used by api pages
        copyFile("./src/website/style.css", outputDir + "style.css");

        // Add empty robots.txt
        writeToFile(outputDir, "robots.txt", "", true);

        const untaggedPollstersPath = apiDataDir + "v" + apiVersion + "/untagged-pollsters.json";
        identifyUntaggedPollsters(
            mainDirectory,
            pollsterIndex,
            hasApiDir ? getJsonFile(untaggedPollstersPath) : null
        );
    } catch (error) {
        console.error('An error has occurred:', error);
        throw error;
    }
}

index()
    .then(() => console.log("Finished"))
    .catch(err => { throw err; });