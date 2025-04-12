# 📡 Pollster Audit API

<p align="center">

[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/PollsterAudit/PollsterAuditApi/run.yml)](https://github.com/PollsterAudit/PollsterAuditApi/actions)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](https://github.com/PollsterAudit/PollsterAuditApi/blob/main/LICENSE)
![Hits Of Code](https://hitsofcode.com/github/pollsteraudit/pollsterauditapi?branch=master)
[![Discord](https://img.shields.io/discord/1359947804981858324?logo=discord)](https://discord.gg/6grVnjE3DC)
[![Open Collective backers and sponsors](https://img.shields.io/opencollective/all/pollster-audit)](https://opencollective.com/pollster-audit)

</p>

The **Pollster Audit API** powers [PollsterAudit.ca](https://www.pollsteraudit.ca) by providing a **clean, public dataset of Canadian opinion polling**, updated hourly and accessible at [api.pollsteraudit.ca](https://api.pollsteraudit.ca).

Polling shapes public perception and political strategy—yet the data is often scattered, messy, or hidden. This API collects, structures, and publishes **historical and current Canadian election polling data** to make it more transparent and accessible for everyone: researchers, journalists, and citizens alike.

> 🛠️ As with all Pollster Audit tools, this API is **fully open-source** because transparency should apply not only to pollsters—but to those who hold them accountable.

---

## 🌐 Live API

The API is hosted live at: [https://api.pollsteraudit.ca](https://api.pollsteraudit.ca)

Main endpoints:
- [`/v1/index.json`](https://api.pollsteraudit.ca/v1/index.json) – Index of all available polling data
- [`/v1/citations.json`](https://api.pollsteraudit.ca/v1/citations.json) – Contains all citations used within this dataset
- [`/v1/parties.json`](https://api.pollsteraudit.ca/v1/parties.json) – Contains information about all the parties found within the dataset
- [`/v1/pollsters.json`](https://api.pollsteraudit.ca/v1/pollsters.json) – Contains information about most* pollsters found within the dataset

\* All pollsters will be included soon

The API is automatically regenerated **every hour** via [GitHub Actions](https://github.com/PollsterAudit/PollsterAuditApi/actions), and served from the [`api` branch](https://github.com/PollsterAudit/PollsterAuditApi/tree/api).

---

## 📦 Current Data Source

- 🗳️ **Wikipedia (English)**: We currently parse data from Wikipedia’s electoral opinion polling pages for Canada.
- 🧪 **Federal polling only** for now (national voting intention).
- 🌎 **Plans for expansion**:
    - Provincial-level polling
    - Issue-based and leadership polling
    - Direct parsing from pollster websites (less reliance on third parties)
    - Automatically updating wikipedia with polls from credible sources

We prioritize **verifiable and transparent sources** and aim to include citations for all polling data.   

That's why we currently use Wikipedia as our main data source. The contributors on those pages put a lot of work into maintaining them and following wikipedia's guidelines. 
Resulting in unbiased polls with full coverage. One of our long-term goals is to automate a lot of the work done by these superstars.

---

## 🚀 Getting Started (for Developers)

To run the API locally:

1. **Clone the repo**
   ```bash
   git clone https://github.com/PollsterAudit/PollsterAuditApi.git
   cd PollsterAuditApi
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the data collection**
   ```bash
   npm start
   ```

This will generate the `/output` folder locally, which mirrors* what gets published at [api.pollsteraudit.ca](https://api.pollsteraudit.ca).  
\* excluding `CNAME` & `index.html`, you can run `npm run api` to also make these files.

---

## 🌐 Translations

This repository contains code and data only, but is part of the larger bilingual [PollsterAudit](https://github.com/PollsterAudit) project. We welcome localization efforts for future data categories (e.g. poll question phrasing, region names).

---

## 🤝 Contributing

We welcome contributions from:

- Developers (parsers, validators, API improvements, etc...)
- Researchers (suggesting data sources, structures, and extra data we should process)
- Citizens (flagging errors or omissions)

To contribute:

- Fork the repo
- Create a branch
- Submit a pull request

Check out [open issues](https://github.com/PollsterAudit/PollsterAuditApi/issues) or open a new one to suggest features or report bugs.

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See [LICENSE](LICENSE) for full details.

All raw data comes from public sources. Use it freely, but cite responsibly.

---

## 📫 Contact

Have questions or suggestions?

- 📧 Email: [contact@pollsteraudit.ca](mailto:contact@pollsteraudit.ca)
- 👾 Discord: https://discord.gg/6grVnjE3DC
- 💬 Github Discussions: https://github.com/PollsterAudit/PollsterAuditApi/discussions

---

## 🧭 Why This API Matters

Polling data is public information—but it's often buried in PDFs, websites, or behind paywalls. 
This API makes Canadian polling more **structured**, **searchable**, and **verifiable** for everyone.

> Let’s make election data as transparent as the decisions it’s meant to inform.

