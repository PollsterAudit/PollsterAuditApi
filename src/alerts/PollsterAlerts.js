import { getJsonFile, normalizePollingFirmName, writeJsonToFile } from "../utils.mjs";
import axios from "axios";

const newPollsterDiscordWebhook = process.env.NEW_POLLSTER_DISCORD_WEBHOOK;

export function identifyUntaggedPollsters(context, pollsters, hasApiDir) {
    const knownUntaggedPollsters = hasApiDir ?
        getJsonFile(context.apiDir + "_data/v" + context.apiVersion + "/untagged-pollsters.json", []) : []
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
    const newUntaggedList = [];
    const newUntaggedPollsters = [];
    // Check which pollsters are untagged
    for (let pollster of context.pollsterIndex) {
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
        if (!newPollsterDiscordWebhook) {
            console.error("Unable to post untagged pollsters to discord webhook. Webhook isn't set!");
            console.log("New Pollster" + (newUntaggedPollsters.length > 1 ? "s" : "") + ":");
            console.log(description);
            return;
        }
        axios.post(newPollsterDiscordWebhook, params, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).catch(function (error) {
            throw error;
        });
    }
    if (newUntaggedList.length > 0) {
        writeJsonToFile(context.mainDirectory + "_data/v" + context.apiVersion + "/", "untagged-pollsters", newUntaggedList);
    }
}