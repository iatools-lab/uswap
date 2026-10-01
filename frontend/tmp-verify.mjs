export default async function run(page, ui) {
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#demo-profile option"))
      .map((o) => o.value)
      .filter(Boolean),
  );

  return {
    count: options.length,
    options,
    hasFictitious: options.some((e) => e.includes("example.com")),
    hasDemoUsers: options.some((e) => e.includes("demo.user.")),
  };
}
