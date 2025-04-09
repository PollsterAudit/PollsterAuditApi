const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const config_schema = require("../schema/config.schema.json");
const config = require("../config.json");

const ajv = new Ajv({allErrors: true});
addFormats(ajv);
const validate = ajv.compile(config_schema);

const valid = validate(config)
if (!valid) {
    console.log(validate.errors)
    throw new Error("Config validation failed.");
}