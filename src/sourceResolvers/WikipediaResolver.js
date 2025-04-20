import {SourceResolver} from "./SourceResolver.js";
import * as cheerio from "cheerio";
import {
    cleanPollingFirmName,
    createCitation,
    normalizePollingFirmName,
    parseCleanFloat,
    writeToFile
} from "../utils.mjs";
import {Tabletojson as tabletojson} from "tabletojson";

/**
 * The Wikipedia Resolver.
 * This resolver handles extracting data from wikipedia tables.
 *
 * @author FX
 */
export class WikipediaResolver extends SourceResolver {
    constructor(context) {
        super(context,"wikipedia");
    }

    shouldAttemptToGetFromLastDeploy(source) {
        return "locked" in source && source["locked"];
    }

    getSourceKey(source) {
        return source["year"];
    }

    getSources(sourcesObject) {
        return sourcesObject;
    }

    getUrl(source) {
        return source["url"];
    }

    async forEachChunk(source, chunkCallback) {
        if ("chunks" in source) {
            for (const chunk of source["chunks"]) {
                await chunkCallback(chunk);
            }
        } else {
            await chunkCallback(null);
        }
    }

    async processChunkIntoSections(source, key, chunk, sectionCallback) {
        const sectionTables = chunk != null && "sectionTables" in chunk ?
            chunk["sectionTables"] : source["sectionTables"];
        const options = chunk != null && "options" in chunk ?
            chunk["options"] : source["options"];
        const manualTimes = chunk != null &&  "manualTimes" in chunk ?
            chunk["manualTimes"] : source["manualTimes"];

        options["forceIndexAsNumber"] = true;
        options["stripHtmlFromCells"] = false; // False so that we can extract url's from sources/citations

        // If section table is an object, it means we should rename the sections
        if (!Array.isArray(sectionTables)) {
            for (let sectionId in sectionTables) {
                await sectionCallback({
                    id: sectionId,
                    name: sectionTables[sectionId],
                    options: options,
                    manualTimes: manualTimes
                });
            }
        } else {
            for (const sectionId of sectionTables) {
                await sectionCallback({
                    id: sectionId,
                    name: sectionId,
                    options: options,
                    manualTimes: manualTimes
                });
            }
        }
    }

    async processSection(page, source, year, section, citations) {
        const headings = section.options["headings"];
        let processedTable;
        try {
            const $ = cheerio.load(page.data);
            const table = await this.getTableFromWikipediaPage($, section.id, section.options);
            processedTable = await this.processTable(
                $,
                table,
                headings,
                citations,
                ("ignoreColumns" in section.options ? section.options.ignoreColumns : [])
            );
        } catch (error) {
            console.log("Error fetching/processing tables! - " + year + " - " + section.id);
            throw error;
        }
        if (processedTable.length === 0) {
            throw new Error(`Error fetching tables for year ${year} with sectionId ${section.id}! - no tables!`);
        }
        try {
            const dateIndex = headings.indexOf("Date");
            const processedTables = {};
            const processedTableRanges = {};
            if (section.manualTimes) {
                for (let manualName in section.manualTimes) {
                    const times = section.manualTimes[manualName];
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
                processedTables[section.name] = processedTable;
                processedTable.forEach(element => {
                    let time = element[dateIndex];
                    if (time < from) {
                        from = time;
                    }
                    if (time > to) {
                        to = time;
                    }
                });
                processedTableRanges[section.name] = [from, to];
            }

            for (let tableName in processedTables) {
                const dataTable = processedTables[tableName];
                const data = "{\"headings\": " + JSON.stringify(headings) +
                    ",\"data\":" + JSON.stringify(dataTable, null, null) + " }";
                const id = tableName.toLowerCase().replace(" ", "_");
                const fileName = id + '.json';
                const directory = this.context.mainDirectory + year + "/";
                writeToFile(directory, fileName, data);
                if (!this.context.index[year]) {
                    this.context.index[year] = {};
                }
                this.context.index[year][id] = {
                    "name": tableName,
                    "url": this.context.baseUrl + "v" + this.context.apiVersion + "/" + year + "/" + fileName,
                    "range": processedTableRanges[tableName]
                };
            }
        } catch (error) {
            console.log("Error processing table data!");
            throw error;
        }
    }

    applyFinalChanges() {
        for (let year in this.context.index) {
            let yearElement = this.context.index[year];
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

    async getTableFromWikipediaPage($, headerName, options) {
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

    getWikipediaDateAndSourceExt($ref) {
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

    async processTable($, table, headings, citations, ignoreColumns) {
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
                                const dateAndSourceExt = this.getWikipediaDateAndSourceExt($child);
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
                console.warn(
                    "Polling Firm is null - " + headings.indexOf("PollingFirm") + " - " + JSON.stringify(row)
                );
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
                    if (!this.context.pollsterIndex.includes(normalizedFirmName)) {
                        this.context.pollsterIndex.push(normalizedFirmName);
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
}