const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

function validateConfigs(configId) {
    const schema = require(`../schema/${configId}.schema.json`);
    const config = require(`../config/${configId}.json`);
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