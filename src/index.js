import fs from 'node:fs';
import { loadJson, writeJsonToFile, getJsonFile } from './utils.mjs';
import { WikipediaResolver } from "./sourceResolvers/WikipediaResolver.js";
import { setupWebpages } from "./webpages/Webpages.js";
import { identifyUntaggedPollsters } from "./alerts/PollsterAlerts.js";

const parties = loadJson('../config/parties.json')["parties"];
const pollsters = loadJson('../config/pollsters.json')["pollsters"];
const sources = loadJson('../config/sources.json')["sources"];

const apiVersion = 1;
const websiteDir = "./website/";
const outputDir = "./output/";
const apiDir = "./api/";
const baseUrl = "https://api.pollsteraudit.ca/";

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

        // Find untagged pollsters
        identifyUntaggedPollsters(context, pollsters, hasApiDir);
    } catch (error) {
        console.error('An error has occurred:', error);
        throw error;
    }
}

index()
    .then(() => console.log("Finished"))
    .catch(err => { throw err; });