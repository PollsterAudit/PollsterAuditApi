import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { loadJson } from "./utils.mjs";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

function validateConfigs(configId) {
    const schema = loadJson(`../schema/${configId}.schema.json`);
    const config = loadJson(`../config/${configId}.json`);
    const validate = ajv.compile(schema);
    const valid = validate(config)
    if (!valid) {
        console.log(validate.errors)
        throw new Error(`${config.charAt(0).toUpperCase() + config.slice(1)} config validation failed.`);
    }
}

validateConfigs("parties");
validateConfigs("pollsters");
validateConfigs("sources");