import axios from 'axios';
import fs from 'node:fs';
import { loadJson, writeJsonToFile, writeToFile, copyFile, getJsonFile, normalizePollingFirmName } from './utils.mjs';
import {WikipediaResolver} from "./sourceResolvers/WikipediaResolver.js";

const newPollsterDiscordWebhook = process.env.NEW_POLLSTER_DISCORD_WEBHOOK;

const parties = loadJson('../config/parties.json')["parties"];
const pollsters = loadJson('../config/pollsters.json')["pollsters"];
const sources = loadJson('../config/sources.json')["sources"];

const apiVersion = 1;
const websiteDir = "./website/";
const outputDir = "./output/";
const apiDir = "./api/";
const apiDataDir = apiDir + "_data/";
const baseUrl = "https://api.pollsteraudit.ca/";

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

function htmlPreprocessor(html, variables) {
    const variableRegex = /{{(?<variableName>\w*?)}}/gm;
    return html.replace(variableRegex, (match, variableName) => {
        if (variableName in variables) {
            return variables[variableName];
        }
    });
}

function createLandingPages(directory, index) {
    const currentDate = new Date();
    const dateModified = currentDate.toISOString().split('T')[0];
    // Create Main landing page
    fs.readFile(websiteDir + "index.html", "utf8", (err, data) => {
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
    fs.readFile(websiteDir + "year-index.html", "utf8", (err, data) => {
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

        // Context passed to the resolvers
        const context = {
            baseUrl,
            mainDirectory,
            apiDir,
            apiVersion,
            apiIndex,
            apiCitations,
            index,
            citations,
            pollsterIndex
        };

        // Create resolvers
        const resolvers = [
            new WikipediaResolver(context)
        ];

        // Run resolvers
        for (const resolver of resolvers) {
            if (resolver.canResolve(sources)) {
                await resolver.resolve(sources);
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
        copyFile(websiteDir + "style.css", outputDir + "style.css");

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