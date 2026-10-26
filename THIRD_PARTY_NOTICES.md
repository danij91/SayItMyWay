# External materials

The root MIT license covers the original SayItMyWay software. It does not grant rights to third-party trademarks, source websites, or materials beyond their own terms.

- **ECB exchange rates:** `extension/data/eurofxref-2026-10-23.xml` preserves the bundled source; `extension/currency-rates.js` contains its fallback rates. Current rates are fetched from the European Central Bank. Source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml. Consult https://www.ecb.europa.eu/services/disclaimer/html/index.en.html for ECB terms. Rates are reference information, not a settlement quote or ECB endorsement.
- **Crimson Desert / MapGenie examples:** `extension/data/dictionary.json` is a historical source-only fixture, excluded from production packaging and fresh-install defaults. It retains per-entry source, evidence and verification status. Game and website names belong to their respective owners. This project is independent of Pearl Abyss and MapGenie; inclusion does not make every translation official. `examples/crimson-desert-ar-test.json` is a test translation.
- **Development dependencies:** packages installed by `npm ci` retain their individual licenses. See `package-lock.json` for exact versions and each package's license for redistribution terms. They are not automatically relicensed by this project.
- **GitHub mark:** the footer icon identifies a link to GitHub. GitHub trademarks remain the property of GitHub; no endorsement is implied.
