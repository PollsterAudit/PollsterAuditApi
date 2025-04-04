const fs = require('node:fs');

// Check if output exists
if (!fs.existsSync("./output/")) {
    fs.mkdirSync("./output/");
}
// Add CNAME
fs.writeFile("./output/CNAME", "api.pollsteraudit.ca", err => {
    if (err) {
        console.error(err);
    }
});
// Add empty index.html
fs.writeFile("./output/index.html", "", err => {
    if (err) {
        console.error(err);
    }
});