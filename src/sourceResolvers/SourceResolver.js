import fs from "node:fs";
import axios from "axios";

/**
 * An abstract resolver class. <br>
 * This class handles the overall flow of resolving a data source.
 *
 * @author FX
 */
export class SourceResolver {
    constructor(context, sourceId) {
        this.context = context;
        this.sourceId = sourceId;
        this.hasLastDeploy = fs.existsSync(this.context.apiDir);
    }

    /**
     * Checks if the last deploy is present. <br>
     * Should be checked before attempting to get anything from the last deploy.
     *
     * @return {@code false} if the last deploy isn't present, otherwise {@code true}
     */
    isLastDeployPresent() {
        return this.hasLastDeploy;
    }

    /**
     * Call this to copy a file from the last deploy. <br>
     * Make sure to call {@link #isLastDeployPresent()} before calling this method.
     *
     * @return {@code false} if this file isn't present in the last deploy, otherwise {@code true}
     */
    copyDirectoryFromLastDeploy(key, fromDir, toDir) {
        if (fs.existsSync(fromDir)) {
            fs.cpSync(fromDir, toDir, {recursive: true});
            console.log("Copied data for " + this.keyToString(key) + " from last commit!");
            this.context.index[key] = this.context.apiIndex[key];
            this.context.citations[key] = this.context.apiCitations[key];
            return true;
        }
        return false;
    }

    /**
     * Attempts to get the source from the last deploy.
     *
     * @return {@code true} if it managed to get the source from the last deploy, otherwise {@code false}
     */
    attemptToGetFromLastDeploy(source, key) {
        if (key in this.context.apiIndex) {
            const fromDir = this.context.apiDir + "v" + this.context.apiVersion + "/" + key;
            const toDir = this.context.mainDirectory + key;
            return this.copyDirectoryFromLastDeploy(key, fromDir, toDir);
        }
        return false;
    }

    /**
     * @return {@code true} if we should attempt to get this source from the last deploy, otherwise {@code false}
     */
    shouldAttemptToGetFromLastDeploy(source) {
        throw new Error("Method 'shouldAttemptToGetFromLastDeploy()' is missing its implementation for class: " +
            this.constructor.name);
    }

    /**
     * Format the key for logging purposes.
     *
     * @return A string, or object which can be up into a string. Representing the source key.
     */
    keyToString(key) {
        return key;
    }

    /**
     * Gets the key used to index this source.
     *
     * @return an object that should be used as the key for this source.
     */
    getSourceKey(source) {
        throw new Error("Method 'getSourceKey()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * @return an iterable of sources, created from the data within the sources config at {@code sources."sourceId"}
     */
    getSources(sourcesObject) {
        throw new Error("Method 'getSources()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * Sets up the citations structure
     */
    setupCitations(key, citation) {
        let innerCitations = this.context.citations;
        if (!(key in innerCitations)) {
            innerCitations[key] = {};
        }
        innerCitations = innerCitations[key];
        if (!(this.sourceId in innerCitations)) {
            innerCitations[this.sourceId] = {};
        }
        innerCitations = innerCitations[this.sourceId];
        if (!(citation in innerCitations)) {
            innerCitations[citation] = {};
        }
        innerCitations[citation] = [];
        return innerCitations[citation];
    }

    /**
     * Gets the url for this source. This page will be downloaded and used to extract the necessary data.
     */
    getUrl(source) {
        throw new Error("Method 'getUrl()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * Calls the callback for each chunk found within the source. <br>
     * Chunk returned can be null, as long as it's handled in {@link #}
     */
    async forEachChunk(source, chunkCallback) {
        throw new Error("Method 'forEachChunk()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * Processes all the chunks.
     */
    async processChunkIntoSections(source, key, chunk, sectionCallback) {
        throw new Error("Method 'forEachChunk()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * Processes all the sections.
     */
    async processSection(response, source, key, section, citations) {
        throw new Error("Method 'processSection()' is missing its implementation for class: " + this.constructor.name);
    }

    /**
     * Apply the final changes before this resolver finishes.
     */
    applyFinalChanges() {}

    /**
     * Checks if this resolver can resolve any of these sources.
     */
    canResolve(sources) {
        return this.sourceId in sources;
    }

    /**
     * Resolves the sources. Usually only resolves a single source with a matching ID.<br>
     * Make sure to check {@link #canResolve} first.
     */
    async resolve(sources) {
        for (const source of this.getSources(sources[this.sourceId])) {
            const key = this.getSourceKey(source);
            if (this.hasLastDeploy && this.shouldAttemptToGetFromLastDeploy(source)) {
                if (this.attemptToGetFromLastDeploy(source, key)) {
                    continue; // Skip this source
                }
            }
            const url = this.getUrl(source);
            const innerCitations = this.setupCitations(key, url);
            const response = await axios({
                method: "GET",
                url: url,
                headers: {
                    "User-Agent": "PollsterAuditBot/1.0",
                }
            });

            await this.forEachChunk(source, async chunk => {
                await this.processChunkIntoSections(source, key, chunk, async section => {
                    await this.processSection(response, source, key, section, innerCitations);
                });
            });
        }
        this.applyFinalChanges();
    }
}