import fs from "node:fs";
import { copyFile, writeToFile } from "../utils.mjs";

function htmlPreprocessor(html, variables) {
    const variableRegex = /{{(?<variableName>\w*?)}}/gm;
    return html.replace(variableRegex, (match, variableName) => {
        if (variableName in variables) {
            return variables[variableName];
        }
    });
}

function createLandingPages(context) {
    const currentDate = new Date();
    const dateModified = currentDate.toISOString().split('T')[0];
    // Create Main landing page
    fs.readFile(context.websiteDir + "index.html", "utf8", (err, data) => {
        if (err) {
            throw err;
        }
        const parts = [];
        let yearEndpoints = "";
        for (let year in context.index) {
            const pageUrl = context.baseUrl + "v" + context.apiVersion + "/" + year + "/";
            parts.push({
                "@type":"Dataset",
                "name": `Electoral Opinion Polling in ${year}`,
                "alternateName": `Vote Intention Dataset in ${year}`,
                "description": `Canadian Election Opinion Polling Dataset for the ${year} election year.`,
                "license": "https://github.com/PollsterAudit/PollsterAuditApi/blob/master/LICENSE",
                "spatialCoverage": "Canada",
                "countryOfOrigin": {
                    "@type": "Country",
                    "name": "Canada"
                },
                "isAccessibleForFree" : true,
                "isFamilyFriendly": true,
                "creator": {
                    "@type":"Organization",
                    "url": "https://pollsteraudit.ca/",
                    "name":"Pollster Audit",
                    "alternateName": "Pollster Audit API",
                    "contactPoint":{
                        "@type":"ContactPoint",
                        "email":"contact@pollsteraudit.ca"
                    },
                    "logo": {
                        "@type": "ImageObject",
                        "url": "https://pollsteraudit.ca/assets/favicon/PollsterAudit_Logo.png"
                    }
                },
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
        writeToFile(context.outputDir, "index.html", htmlPreprocessor(data, variables));
    });
    // Create year landing pages
    fs.readFile(context.websiteDir + "year-index.html", "utf8", (err, data) => {
        if (err) {
            throw err;
        }
        for (let year in context.index) {
            const distributions = [];
            let endpoints = "";
            const yearElement = context.index[year];
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
                    endpoints += `<li><strong><code>/v${context.apiVersion}/${year}/${period}.json</code>` +
                        `</strong><br/><a href="${periodElement["url"]}" target="_blank">View JSON</a><br/>` +
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
            writeToFile(context.mainDirectory + year + "/", "index.html", htmlPreprocessor(data, variables));
        }
    });
}

export function setupWebpages(context) {
    // Add CNAME
    writeToFile(context.outputDir, "CNAME", "api.pollsteraudit.ca", true);

    // Add api landing page - index.html
    createLandingPages(context);

    // Add stylesheet used by api pages
    copyFile(context.websiteDir + "style.css", context.outputDir + "style.css");

    // Add empty robots.txt
    writeToFile(context.outputDir, "robots.txt", "", true);
}