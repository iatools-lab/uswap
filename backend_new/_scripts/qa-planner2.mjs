export default async function run(page, ui) {
  const result = {};

  // Se connecter
  const inputs = page.locator('input');
  await inputs.nth(0).fill('admin@upowa.org');
  await inputs.nth(1).fill(process.env.DEMO_PASSWORD ?? '');
  await page.getByRole('button', { name: /se connecter/i }).first().click();
  await page.waitForTimeout(3000);

  // Aller sur plannings
  await page.goto('http://127.0.0.1:5173/app/admin/plannings');
  await page.waitForTimeout(4000);

  // Inspecter le DOM profondÃ©ment
  result.url = page.url();
  result.rootHTML = await page.evaluate(() => {
    const root = document.getElementById('root') || document.body;
    return root.innerHTML.slice(0, 1500);
  });
  result.rootChildCount = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.children.length : -1;
  });
  result.bodyHTML = await page.evaluate(() => document.body.innerHTML.slice(0, 1000));
  result.scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((s) => s.src).filter(Boolean)
  );

  return result;
}
