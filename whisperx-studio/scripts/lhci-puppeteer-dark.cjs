/**
 * Lighthouse CI — forcer le thème sombre (prefers-color-scheme: dark) pour les audits
 * (contraste, couleurs) alignés sur le CSS @media (prefers-color-scheme: dark).
 *
 * @param {import('puppeteer').Browser} browser
 */
module.exports = async function lhciPuppeteerDark(browser) {
  const apply = async (page) => {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  };

  browser.on("targetcreated", async (target) => {
    if (target.type() !== "page") {
      return;
    }
    try {
      const page = await target.page();
      if (page) {
        await apply(page);
      }
    } catch {
      /* cible non-page ou fermée trop tôt */
    }
  });

  try {
    const pages = await browser.pages();
    for (const page of pages) {
      await apply(page);
    }
  } catch {
    /* ignore */
  }
};
