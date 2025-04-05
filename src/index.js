const tabletojson = require('tabletojson').Tabletojson;
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('node:fs');

const apiVersion = 1;
const outputDir = "./output/";

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
async function getOpinionPollingSection(sectionName) {
    const url = 'https://en.wikipedia.org/wiki/Opinion_polling_for_the_2025_Canadian_federal_election';
    try {
        const headings = ["PollingFirm", "Date", "CPC", "LPC", "NDP", "BQ", "PPC", "GPC", "Others",
            "MarginOfError", "SampleSize", "Lead"];
        const table = await getTableFromWikipediaPage(url, sectionName, {
            forceIndexAsNumber: true,
            ignoreColumns: [2, 12],
            headings: headings
        });
        const data = "{\"headings\": " + JSON.stringify(headings) +
            ",\"data\":" + JSON.stringify(processTable(table), null, null) + " }";
        const fileName = sectionName.toLowerCase().replace(" ", "_") + '.json';
        const directory = outputDir + "v" + apiVersion + "/2025/";
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        fs.writeFile(directory + fileName, data, err => {
            if (err) {
                console.error(err);
            }
        });
    } catch (error) {
        console.error('Error fetching tables:', error);
    }
}

(async () => {
    await getOpinionPollingSection('Campaign period');
    await getOpinionPollingSection('Pre-campaign period');
})();