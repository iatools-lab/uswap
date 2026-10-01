export default async function run(page, ui) {
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#demo-profile option")).map((o) => ({
      text: o.textContent,
      value: o.value,
    })),
  );

  const direct = await page.evaluate(async () => {
    try {
      const res = await fetch("http://localhost:3000/public/profiles");
      const body = await res.text();
      return { ok: res.ok, status: res.status, head: body.slice(0, 200) };
    } catch (e) {
      return { error: String(e && e.message) };
    }
  });

  return { options, direct };
}
