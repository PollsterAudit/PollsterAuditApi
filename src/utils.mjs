import fs from "node:fs";

//region File Handling
function loadJson(path) {
    return JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
}

function writeJsonToFile(directory, name, data, log = false) {
    const fileName = name + '.json';
    if (log) {
        console.log(`Writing ${fileName}`);
    }
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFile(directory + fileName, JSON.stringify(data), err => {
        if (err) {
            throw err;
        }
    });
}

function writeToFile(directory, fileName, contents, log = false) {
    if (log) {
        console.log(`Writing ${fileName}`);
    }
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFile(directory + fileName, contents, err => {
        if (err) {
            throw err;
        }
    });
}

function copyFile(from, to) {
    fs.copyFile(from, to, (err) => {
        if (err) {
            throw err;
        }
    });
}

function getJsonFile(path) {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : null;
}
//endregion

//region Structure creations
//region Citations
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
//endregion
//endregion

//region Cleaning
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
    // Removes citations - E.x. Ekos[3]
    const regex = /(.*?)(?:\[[a-zA-Z0-9]{0,2}\])?/gm;
    return item.replace(regex, `$1`);
}

function normalizePollingFirmName(name) {
    return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
//endregion

export { loadJson, writeJsonToFile, writeToFile, copyFile, getJsonFile, createCitation, setupCitations,
    parseCleanFloat, cleanPollingFirmName, normalizePollingFirmName };