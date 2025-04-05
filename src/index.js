const tabletojson = require('tabletojson').Tabletojson;
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('node:fs');

const apiVersion = 1;
const outputDir = "./output/";
const baseUrl = "https://api.pollsteraudit.ca/";

async function getTableFromWikipediaPage(url, headerName, options) {
    const data = await axios({
        method: "GET",
        url: url
    });
    const $ = cheerio.load(data.data);

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

function processTable(table) {
    const newTable = [];
    let skipped = 0;
    for (let i = 0; i < table.length; i++) {
        const row = table[i];
        const pollingFirm = row["0"];
        // TODO: temp fix for wikipedia including the election as the final row v
        if (pollingFirm === "" || pollingFirm.includes("election")) {
            skipped++;
            continue; // Invalid table data (usually an info row)
        }
        newTable[i - skipped] = [
            pollingFirm,
            new Date(row["1"]).getTime(),
            parseCleanFloat(row["3"]),
            parseCleanFloat(row["4"]),
            parseCleanFloat(row["5"]),
            parseCleanFloat(row["6"]),
            parseCleanFloat(row["7"]),
            parseCleanFloat(row["8"]),
            parseCleanFloat(row["9"]),
            parseCleanFloat(row["10"]),
            parseCleanFloat(row["11"]),
            parseCleanFloat(row["13"])
        ];
    }
    return newTable;
}

// TODO: Rewrite to allow us to collect all election data, did this quickly to release the site.
//  We should be reading any configurable data from a config file
async function getOpinionPollingSection(page, path, sectionName, index) {
    try {
        let from = Number.MAX_SAFE_INTEGER;
        let to = Number.MIN_SAFE_INTEGER;
        const headings = ["PollingFirm", "Date", "CPC", "LPC", "NDP", "BQ", "PPC", "GPC", "Others",
            "MarginOfError", "SampleSize", "Lead"];
        const table = await getTableFromWikipediaPage(page, sectionName, {
            forceIndexAsNumber: true,
            ignoreColumns: [2, 12],
            headings: headings
        });
        const processedTable = processTable(table);
        processedTable.forEach((element) => {
            let time = element[1];
            if (time < from) {
                from = time;
            }
            if (time > to) {
                to = time;
            }
        })
        const data = "{\"headings\": " + JSON.stringify(headings) +
            ",\"data\":" + JSON.stringify(processedTable, null, null) + " }";
        const id = sectionName.toLowerCase().replace(" ", "_");
        const fileName = id + '.json';
        const directory = outputDir + "v" + apiVersion + path;
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        fs.writeFile(directory + fileName, data, err => {
            if (err) {
                console.error(err);
            }
        });
        index[id] = {"name": sectionName, "url": baseUrl + "v" + apiVersion + path + fileName, "range": [from, to]};
    } catch (error) {
        console.error('Error fetching tables:', error);
    }
}

async function writeIndex(index) {
    const fileName = 'index.json';
    const directory = outputDir + "v" + apiVersion + "/";
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

(async () => {
    let index = {};

    // 2025
    const opinionPolling2025 = 'https://en.wikipedia.org/wiki/Opinion_polling_for_the_2025_Canadian_federal_election';
    const path2025 = "/2025/";
    await getOpinionPollingSection(opinionPolling2025, path2025, 'Campaign period', index);
    await getOpinionPollingSection(opinionPolling2025, path2025, 'Pre-campaign period', index);

    // Index
    await writeIndex(index);
})();