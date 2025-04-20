import axios from 'axios';
import fs from 'node:fs';
import { loadJson, writeJsonToFile, getJsonFile, normalizePollingFirmName } from './utils.mjs';
import { WikipediaResolver } from "./sourceResolvers/WikipediaResolver.js";
import { setupWebpages } from "./webpages/Webpages.js";

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
            outputDir,
            mainDirectory,
            websiteDir,
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

        // Write data to api
        writeJsonToFile(mainDirectory, "index", index, true);
        writeJsonToFile(mainDirectory, "citations", citations, true);
        writeJsonToFile(mainDirectory, "parties", parties, true);
        writeJsonToFile(mainDirectory, "pollsters", pollsters, true);

        // Setup webpages
        setupWebpages(context);

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